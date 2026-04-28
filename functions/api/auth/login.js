// POST /api/auth/login — { email, password }
// Verifies password, creates session.
import { json, error, newId, verifyPassword, setSessionCookie, logUsage } from '../../_lib.js';

export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(() => ({}));
  const email = (body.email || '').trim().toLowerCase();
  const password = body.password || '';

  if (!email || !password) return error('Email and password required');

  const client = await env.DB.prepare(
    'SELECT id, password_hash, is_admin FROM clients WHERE email = ?'
  ).bind(email).first();

  if (!client?.password_hash) {
    // No password set — could be a magic-link account or doesn't exist
    return error('Invalid email or password. (If you signed up via magic link, request a new one.)', 401);
  }

  const valid = await verifyPassword(password, client.password_hash);
  if (!valid) return error('Invalid email or password.', 401);

  const now = Date.now();
  const sessionId = newId('sess');
  const expiresAt = now + 30 * 24 * 60 * 60 * 1000;
  await env.DB.prepare(
    'INSERT INTO sessions (id, client_id, expires_at, ip, user_agent, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(sessionId, client.id, expiresAt, request.headers.get('CF-Connecting-IP') || '', request.headers.get('User-Agent') || '', now).run();

  await env.DB.prepare('UPDATE clients SET last_login = ? WHERE id = ?').bind(now, client.id).run();
  await logUsage(env, client.id, 'login');

  return json({ ok: true, redirect: client.is_admin ? '/admin/' : '/dashboard/' }, 200, {
    'Set-Cookie': setSessionCookie(sessionId),
  });
}
