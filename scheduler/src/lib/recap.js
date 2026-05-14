/**
 * Sunday weekly recap → emails Albert at hello@apextoolsai.com.
 *
 * v1 (this implementation) is deliberately blog-focused — we don't have a
 * GA4 service-account connector wired in yet. The email pulls:
 *   - Posts published this week (via /api/posts)
 *   - Total post count + this week's % of total
 *   - A short Claude-generated commentary + 1 recommendation
 *
 * Future enhancement: add GA4 traffic, demo-line call count, Cal.com bookings.
 * Slots are already noted in the prompt so we can stitch them in later.
 */

import { listPosts } from "./apex.js";
import { claudeChat } from "./anthropic.js";
import { sendEmail } from "./resend.js";
import RECAP_PROMPT from "../prompts/sunday-recap.md";

const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

export async function sundayRecap({ env, ctx }) {
  const posts = await listPosts(env, { limit: 200 });
  const cutoff = Date.now() - SEVEN_DAYS;

  const thisWeek = posts.filter(p => {
    const ts = toEpoch(p.published_at || p.created_at);
    return ts >= cutoff;
  });

  const weekStart = new Date(cutoff).toISOString().slice(0, 10);

  const userPrompt = [
    `Week starting: ${weekStart}`,
    `Total blog posts (all-time): ${posts.length}`,
    `Posts published this week: ${thisWeek.length}`,
    "",
    thisWeek.length
      ? "Titles published this week:\n" + thisWeek.map(p => `  - ${p.title}  (${env.SITE_BASE}/blog/${p.slug})`).join("\n")
      : "No posts published this week.",
    "",
    "Write the recap email body (Markdown). Include:",
    "  1. One-line traffic summary placeholder (since GA4 isn't wired yet, write 'GA4 traffic — not yet connected to scheduler')",
    "  2. List of this week's posts",
    "  3. One concrete recommendation for next week",
    "Keep it under 250 words. Conversational. No fluff.",
  ].join("\n");

  const body = await claudeChat({
    env,
    system: RECAP_PROMPT,
    user: userPrompt,
    maxTokens: 1200,
    temperature: 0.5,
  });

  const subject = `Apex Tools AI — Weekly Recap (week of ${weekStart})`;

  ctx?.waitUntil?.(
    sendEmail(env, {
      to: env.RECAP_EMAIL_TO || "hello@apextoolsai.com",
      from: env.RECAP_EMAIL_FROM,
      subject,
      text: body,
      html: markdownToBasicHtml(body),
    }).catch(e => console.error("[recap]", e.message))
  );

  return { ok: true, postsThisWeek: thisWeek.length, weekStart };
}

function toEpoch(v) {
  if (!v) return 0;
  if (typeof v === "number") return v < 1e12 ? v * 1000 : v;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : 0;
}

// Lightweight Markdown → HTML for the recap email body. Headings, bold,
// italics, links, line breaks. Not for general use.
function markdownToBasicHtml(md) {
  let h = String(md || "");
  h = h.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  h = h.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  h = h.replace(/^## (.+)$/gm, "<h2>$1</h2>");
  h = h.replace(/^# (.+)$/gm, "<h1>$1</h1>");
  h = h.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  h = h.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  h = h.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  h = h.replace(/\n\n/g, "</p><p>");
  return "<p>" + h + "</p>";
}
