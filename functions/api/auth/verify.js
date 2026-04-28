// GET /api/auth/verify?token=...
// Validates magic link, creates session, redirects to /dashboard
import { error, newId, setSessionCookie } from '../../_lib.js';

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  if (!token) return error('Missing token');

  const link = await env.DB.prepare(
    'SELECT * FROM magic_links WHERE token = ? AND used = 0 AND expires_at > ?'
  ).bind(token, Date.now()).first();
  if (!link) return error('Invalid or expired link', 401);

  // Get client
  const client = await env.DB.prepare(
    'SELECT id, is_admin FROM clients WHERE email = ?'
  ).bind(link.email).first();
  if (!client) return error('Account not found', 404);

  // Mark link used
  await env.DB.prepare('UPDATE magic_links SET used = 1 WHERE token = ?').bind(token).run();

  // Create session (30 days)
  const sessionId = newId('sess');
  const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
  await env.DB.prepare(
    'INSERT INTO sessions (id, client_id, expires_at, ip, user_agent, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(
    sessionId,
    client.id,
    expiresAt,
    request.headers.get('CF-Connecting-IP') || '',
    request.headers.get('User-Agent') || '',
    Date.now()
  ).run();

  await env.DB.prepare('UPDATE clients SET last_login = ? WHERE id = ?')
    .bind(Date.now(), client.id).run();

  // Redirect: admin → /admin/, client → /dashboard/
  const dest = client.is_admin ? '/admin/' : '/dashboard/';

  return new Response(null, {
    status: 302,
    headers: {
      'Location': dest,
      'Set-Cookie': setSessionCookie(sessionId),
    },
  });
}
