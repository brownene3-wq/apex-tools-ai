/**
 * Resend transactional email wrapper.
 *
 * Used for:
 *   - Sunday weekly recap → hello@apextoolsai.com
 *   - Per-cron success notifications (title + URL of new post)
 *   - Per-cron error notifications (stack trace summary)
 */

const API_URL = "https://api.resend.com/emails";

export async function sendEmail(env, { to, subject, html, text, from }) {
  if (!env.RESEND_API_KEY) {
    console.warn("[resend] RESEND_API_KEY not set — skipping email");
    return { skipped: true };
  }
  const payload = {
    from: from || env.RECAP_EMAIL_FROM || "Apex Tools AI <hello@apextoolsai.com>",
    to: Array.isArray(to) ? to : [to],
    subject,
  };
  if (html) payload.html = html;
  if (text) payload.text = text;

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + env.RESEND_API_KEY,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Resend ${res.status}: ${txt.slice(0, 300)}`);
  }
  return await res.json();
}
