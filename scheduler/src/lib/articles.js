/**
 * Article generation pipeline.
 *
 * Each of the 3 article tasks (Tuesday SEO, Thursday case study, Saturday
 * comparison) shares a single core pipeline. They only differ in:
 *   1. The system prompt template (loaded from src/prompts/*.md)
 *   2. The tag (AI Receptionists / Case Study / etc.)
 *   3. The "topic rotation" set the LLM picks from
 *
 * Pipeline:
 *   1. GET /api/posts → fetch existing titles
 *   2. Build the system+user messages with current date + existing titles
 *   3. Call Claude (JSON mode) — must return:
 *        { title, slug, excerpt, content (Markdown), tag, target_keyword,
 *          cover_image_url, seo_title, seo_description, language }
 *   4. Validate against quality bar (≥ 1500 words, has CTA, no AI disclaimers,
 *      pricing matches, no fake compliance claims, not a duplicate title)
 *   5. POST /api/posts with status="published"
 *   6. Email Albert (title + public URL + word count)
 *
 * Returns: { ok, slug, url, wordCount, title, target_keyword }
 */

import { claudeJson } from "./anthropic.js";
import { listPosts, createPost, titleAlreadyExists } from "./apex.js";
import { notifySuccess } from "./notify.js";
import TUESDAY_PROMPT from "../prompts/tuesday-article.md";
import THURSDAY_PROMPT from "../prompts/thursday-article.md";
import SATURDAY_PROMPT from "../prompts/saturday-comparison.md";

const VALID_TAGS = new Set(["AI Receptionists", "Dental Marketing", "Case Study", "Tutorial", "Other"]);

const QUALITY_BAR = {
  minWords: 1500,
  forbiddenPhrases: [
    /as an ai\b/i,
    /i am claude\b/i,
    /i'?m an ai\b/i,
    /\bI cannot\b.{0,40}\bopinion/i,  // weasel
  ],
  requiredTokens: [
    /\(954\)\s*475[-\s]?6922/, // demo line
  ],
  forbiddenCompliance: [
    /\bhipaa\s+(?:certified|certifies|certification|approved)/i,
    /\bfda\s+approved/i,
  ],
  pricingTokens: [/\$400/, /\$450|\$100/], // at least one of $450 or $100 should appear too
};

export async function publishTuesdayArticle({ env, ctx }) {
  return runArticleTask({ env, ctx, taskName: "tuesday-article", systemPrompt: TUESDAY_PROMPT, defaultTag: "AI Receptionists" });
}
export async function publishThursdayArticle({ env, ctx }) {
  return runArticleTask({ env, ctx, taskName: "thursday-article", systemPrompt: THURSDAY_PROMPT, defaultTag: "Case Study" });
}
export async function publishSaturdayComparison({ env, ctx }) {
  return runArticleTask({ env, ctx, taskName: "saturday-comparison", systemPrompt: SATURDAY_PROMPT, defaultTag: "AI Receptionists" });
}

async function runArticleTask({ env, ctx, taskName, systemPrompt, defaultTag }) {
  // 1. Existing posts → avoid duplicate titles.
  const existing = await listPosts(env, { limit: 100 });
  const existingTitles = existing.map(p => p.title).filter(Boolean);

  // 2. User prompt = current context.
  const today = new Date();
  const userPrompt = [
    `Today's date: ${today.toISOString().slice(0, 10)} (${today.toLocaleDateString("en-US", { weekday: "long" })})`,
    ``,
    `Existing post titles (DO NOT DUPLICATE — pick a different topic):`,
    existingTitles.length ? existingTitles.map(t => `  - ${t}`).join("\n") : "  (none — blog is empty)",
    ``,
    `Write ONE new article now. Return strict JSON only.`,
  ].join("\n");

  // 3. Generate.
  const draft = await claudeJson({
    env,
    system: systemPrompt,
    user: userPrompt,
    maxTokens: 8000,
    temperature: 0.7,
  });

  // 4. Validate.
  const validation = validateArticle(draft, existingTitles);
  if (!validation.ok) {
    throw new Error(`Article failed quality bar: ${validation.reasons.join("; ")}`);
  }

  // 5. Publish.
  const payload = {
    title: draft.title,
    slug: draft.slug,                                    // server will re-slugify / uniqueify
    excerpt: draft.excerpt,
    content: draft.content,
    cover_image_url: draft.cover_image_url || null,
    author_name: "Albert Brown",
    tag: VALID_TAGS.has(draft.tag) ? draft.tag : defaultTag,
    language: draft.language || "en",
    status: "published",
    seo_title: draft.seo_title || draft.title,
    seo_description: draft.seo_description || draft.excerpt,
  };
  const result = await createPost(env, payload);

  const wordCount = countWords(draft.content);
  const url = result.url || `${env.SITE_BASE}/blog/${result.slug}`;

  // 6. Notify.
  ctx?.waitUntil?.(
    notifySuccess(env, taskName, {
      title: draft.title,
      url,
      wordCount,
      tag: payload.tag,
      target_keyword: draft.target_keyword,
    }).catch(e => console.error("[notify]", e.message))
  );

  return {
    ok: true,
    slug: result.slug,
    url,
    title: draft.title,
    wordCount,
    target_keyword: draft.target_keyword,
    tag: payload.tag,
  };
}

function validateArticle(draft, existingTitles) {
  const reasons = [];
  if (!draft.title) reasons.push("missing title");
  if (!draft.content) reasons.push("missing content");
  if (!draft.excerpt) reasons.push("missing excerpt");

  if (draft.title && titleAlreadyExists(existingTitles.map(t => ({ title: t })), draft.title)) {
    reasons.push("duplicate title: " + draft.title);
  }

  const wc = countWords(draft.content || "");
  if (wc < QUALITY_BAR.minWords) reasons.push(`word count ${wc} < ${QUALITY_BAR.minWords}`);

  for (const re of QUALITY_BAR.forbiddenPhrases) {
    if (re.test(draft.content || "")) reasons.push(`forbidden phrase: ${re}`);
  }
  for (const re of QUALITY_BAR.requiredTokens) {
    if (!re.test(draft.content || "")) reasons.push(`missing required token: ${re}`);
  }
  for (const re of QUALITY_BAR.forbiddenCompliance) {
    if (re.test(draft.content || "")) reasons.push(`fake compliance claim: ${re}`);
  }
  if (!QUALITY_BAR.pricingTokens[0].test(draft.content || "")) {
    reasons.push("missing pricing token: $400");
  }
  return { ok: reasons.length === 0, reasons, wordCount: wc };
}

function countWords(s) {
  return String(s || "").trim().split(/\s+/).filter(Boolean).length;
}
