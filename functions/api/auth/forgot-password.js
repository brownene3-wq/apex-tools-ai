// POST /api/auth/forgot-password — { email }
// Creates a reset token (reuses magic_links table, prefixes token with 'reset:'),
// sends an email with a link to /reset-password.html?token=...
import { json, newId, sendEmail, escapeHtml } from '../../_lib.js';

export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(() => ({}));
  const email = (body.email || '').trim().toLowerCase();
  // Always return ok to prevent email-enumeration attacks
  if (!email || !email.includes('@')) {
    return json({ ok: true });
  }
  const client = await env.DB.prepare('SELECT id, full_name FROM clients WHERE email = ?').bind(email).first();
  if (!client) {
    return json({ ok: true });
  }
  const token = newId('reset');
  const now = Date.now();
  const expiresAt = now + 60 * 60 * 1000; // 1 hour
  await env.DB.prepare(
    'INSERT INTO magic_links (token, email, expires_at, used, created_at) VALUES (?, ?, ?, 0, ?)'
  ).bind(token, `reset:${email}`, expiresAt, now).run();

  const baseUrl = env.PUBLIC_BASE_URL || 'https://apextoolsai.com';
  const resetUrl = `${baseUrl}/reset-password?token=${token}`;
  const firstName = (client.full_name || '').split(' ')[0] || '';

  await sendEmail(env, {
    to: email,
    subject: 'Reset your Apex Tools AI password',
    html: `
      <div style="font-family: -apple-system, sans-serif; max-width: 540px; margin: 0 auto; padding: 32px 24px;">
        <h2 style="color: #0a1628;">Reset your password${firstName ? ', ' + escapeHtml(firstName) : ''}</h2>
        <p style="color: #475569; line-height: 1.6;">We received a request to reset the password for your Apex Tools AI account. Click the button below to choose a new password.</p>
        <a href="${resetUrl}" style="display:inline-block; background:#f97316; color:white; text-decoration:none; padding:14px 28px; border-radius:9999px; font-weight:600; margin:16px 0;">Reset Password</a>
        <p style="color: #475569; line-height: 1.6;">Or paste this link into your browser:<br><code style="font-size:12px; color:#1e3a5f;">${resetUrl}</code></p>
        <p style="color: #94a3b8; font-size:13px;">This link expires in 1 hour. If you didn't request a password reset, you can safely ignore this email — your password won't change.</p>
        <p style="color: #94a3b8; font-size:13px;">— Apex Tools AI</p>
      </div>
    `,
  });
  return json({ ok: true });
}
