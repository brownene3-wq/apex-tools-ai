// POST /api/auth/reset-password — { token, password }
// Validates the token, updates the password, signs the user in.
import { json, error, newId, hashPassword, setSessionCookie, logUsage } from '../../_lib.js';

export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(() => ({}));
  const token = body.token || '';
  const password = body.password || '';

  if (!token || !password) return error('Token and password required');
  if (password.length < 8) return error('Password must be at least 8 characters');

  const tokenRow = await env.DB.prepare(
    'SELECT email, expires_at, used FROM magic_links WHERE token = ?'
  ).bind(token).first();

  if (!tokenRow || tokenRow.used) return error('This reset link is invalid or already used.', 400);
  if (tokenRow.expires_at < Date.now()) return error('This reset link has expired. Request a new one.', 400);
  if (!tokenRow.email?.startsWith('reset:')) return error('Invalid reset token.', 400);

  const email = tokenRow.email.replace('reset:', '');
  const client = await env.DB.prepare('SELECT id FROM clients WHERE email = ?').bind(email).first();
  if (!client) return error('Account not found.', 404);

  const passwordHash = await hashPassword(password);
  const now = Date.now();
  await env.DB.prepare(
    'UPDATE clients SET password_hash = ?, password_set_at = ?, updated_at = ? WHERE id = ?'
  ).bind(passwordHash, now, now, client.id).run();

  // Mark token used
  await env.DB.prepare('UPDATE magic_links SET used = 1 WHERE token = ?').bind(token).run();

  // Invalidate all existing sessions for this user (force re-login on other devices)
  await env.DB.prepare('DELETE FROM sessions WHERE client_id = ?').bind(client.id).run();

  // Create a fresh session and sign them in
  const sessionId = newId('sess');
  const expiresAt = now + 30 * 24 * 60 * 60 * 1000;
  await env.DB.prepare(
    'INSERT INTO sessions (id, client_id, expires_at, ip, user_agent, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(sessionId, client.id, expiresAt, request.headers.get('CF-Connecting-IP') || '', request.headers.get('User-Agent') || '', now).run();

  await env.DB.prepare('UPDATE clients SET last_login = ? WHERE id = ?').bind(now, client.id).run();
  await logUsage(env, client.id, 'password_reset');

  const isAdmin = await env.DB.prepare('SELECT is_admin FROM clients WHERE id = ?').bind(client.id).first();

  return json({ ok: true, redirect: isAdmin?.is_admin ? '/admin/' : '/dashboard/' }, 200, {
    'Set-Cookie': setSessionCookie(sessionId),
  });
}
