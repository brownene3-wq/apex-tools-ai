// POST /api/auth/request-link  — { email }
// Creates a magic link, emails it. Returns 200 even if email doesn't exist (security).
import { json, error, newId, sendEmail } from '../../_lib.js';

export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(() => ({}));
  const email = (body.email || '').trim().toLowerCase();
  if (!email || !email.includes('@')) return error('Valid email required');

  // Get/create client
  let client = await env.DB.prepare('SELECT id FROM clients WHERE email = ?').bind(email).first();
  if (!client) {
    const id = newId('cli');
    const now = Date.now();
    await env.DB.prepare(
      'INSERT INTO clients (id, email, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(id, email, 'pending', now, now).run();
    client = { id };
  }

  // Create magic link
  const token = newId('mlk');
  const expiresAt = Date.now() + 15 * 60 * 1000; // 15 min
  await env.DB.prepare(
    'INSERT INTO magic_links (token, email, expires_at, created_at) VALUES (?, ?, ?, ?)'
  ).bind(token, email, expiresAt, Date.now()).run();

  const origin = new URL(request.url).origin;
  const link = `${origin}/api/auth/verify?token=${token}`;

  await sendEmail(env, {
    to: email,
    subject: 'Your Apex Tools AI sign-in link',
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 540px; margin: 0 auto; padding: 32px 24px;">
        <h2 style="color: #0a1628; font-weight: 800;">Sign in to Apex Tools AI</h2>
        <p style="color: #475569; line-height: 1.6;">Click the button below to sign in. This link expires in 15 minutes and can only be used once.</p>
        <a href="${link}" style="display:inline-block; background:#f97316; color:white; text-decoration:none; padding:14px 28px; border-radius:9999px; font-weight:600; margin:16px 0;">Sign In</a>
        <p style="color: #94a3b8; font-size:13px; line-height:1.5;">If you didn't request this, you can safely ignore this email.<br>For your security, only sign in from a device you trust.</p>
      </div>
    `,
  });

  return json({ ok: true });
}
