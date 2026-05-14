/**
 * Daily QA sweep — runs every morning at 06:00 ET.
 *
 * Fetches all posts updated in the last 24 hours, audits each against the
 * same quality bar the publisher uses, and PATCHes failed posts back to
 * status="draft" so they disappear from /blog. Albert is emailed a summary.
 *
 * The publisher already validates before posting, so this is a safety net
 * that catches issues that snuck through (real-world API drift, future
 * prompt-bar relaxations, etc.).
 */

import { listPosts, patchPost } from "./apex.js";
import { claudeJson } from "./anthropic.js";
import { plainEmail } from "./notify.js";
import QA_PROMPT from "../prompts/daily-qa.md";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export async function dailyQaSweep({ env, ctx }) {
  const allPosts = await listPosts(env, { limit: 200 });
  const cutoff = Date.now() - ONE_DAY_MS;

  // Posts created or updated in the last 24h, only "published" status.
  const recent = allPosts.filter(p => {
    const ts = toEpoch(p.updated_at || p.created_at || p.published_at);
    return ts >= cutoff && (p.status === "published" || !p.status);
  });

  const results = [];
  for (const post of recent) {
    let verdict;
    try {
      verdict = await auditPost({ env, post });
    } catch (err) {
      verdict = { pass: false, reasons: ["audit error: " + err.message] };
    }

    if (!verdict.pass) {
      try {
        await patchPost(env, post.id || post.slug, { status: "draft" });
        results.push({ id: post.id, slug: post.slug, title: post.title, action: "unpublished", reasons: verdict.reasons });
      } catch (err) {
        results.push({ id: post.id, slug: post.slug, title: post.title, action: "unpublish-failed", reasons: verdict.reasons, error: err.message });
      }
    } else {
      results.push({ id: post.id, slug: post.slug, title: post.title, action: "passed" });
    }
  }

  const passed = results.filter(r => r.action === "passed").length;
  const unpub = results.filter(r => r.action === "unpublished").length;
  const errors = results.filter(r => r.action === "unpublish-failed").length;

  const summary = unpub === 0 && errors === 0
    ? `Apex daily QA: ${recent.length} post${recent.length === 1 ? "" : "s"} checked, all pass.`
    : `Apex daily QA: ${recent.length} checked, ${passed} pass, ${unpub} unpublished${errors ? `, ${errors} errors` : ""}.`;

  const detail = results.map(r => {
    if (r.action === "passed") return `  ✅ ${r.title}`;
    return `  ❌ ${r.title} — ${r.action}\n     reasons: ${(r.reasons || []).join("; ")}`;
  }).join("\n");

  // Only email Albert if there's something to act on (or weekly heartbeat — skipped here).
  if (unpub > 0 || errors > 0) {
    ctx?.waitUntil?.(
      plainEmail(env, {
        to: env.NOTIFY_EMAIL_TO || "hello@apextoolsai.com",
        subject: `[Apex Scheduler] Daily QA — ${unpub} post${unpub === 1 ? "" : "s"} unpublished`,
        body: summary + "\n\n" + detail,
      }).catch(e => console.error("[notify]", e.message))
    );
  }

  return { summary, results };
}

async function auditPost({ env, post }) {
  // Fast deterministic checks first — cheaper than calling Claude.
  const reasons = [];
  const text = String(post.content || "");
  const wc = text.trim().split(/\s+/).filter(Boolean).length;
  if (wc < 1500) reasons.push(`word count ${wc} < 1500`);
  if (/as an ai\b|i am claude\b|i'?m an ai\b/i.test(text)) reasons.push("AI disclaimer leak");
  if (/\bhipaa\s+(?:certified|certification|approved)/i.test(text)) reasons.push("fake HIPAA claim");
  if (/\bfda\s+approved/i.test(text)) reasons.push("fake FDA claim");
  if (!/\(954\)\s*475[-\s]?6922/.test(text)) reasons.push("demo phone (954) 475-6922 missing");
  if (!/\$400/.test(text)) reasons.push("pricing token $400 missing");

  if (reasons.length > 0) return { pass: false, reasons };

  // Pass deterministic — defer to Claude only for the subjective dimension.
  const user = [
    `Title: ${post.title}`,
    `Excerpt: ${post.excerpt || "(none)"}`,
    "",
    "Content:",
    text.slice(0, 12000),
  ].join("\n");
  const verdict = await claudeJson({
    env,
    system: QA_PROMPT,
    user,
    maxTokens: 600,
    temperature: 0.2,
  });
  return { pass: !!verdict.pass, reasons: verdict.reasons || [] };
}

function toEpoch(v) {
  if (!v) return 0;
  if (typeof v === "number") return v < 1e12 ? v * 1000 : v;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : 0;
}
