// POST /api/auth/signup — { email, password, full_name?, business_name? }
// Creates a new client account with password and signs them in.
import { json, error, newId, hashPassword, setSessionCookie, logUsage } from '../../_lib.js';

export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(() => ({}));
  const email = (body.email || '').trim().toLowerCase();
  const password = body.password || '';
  const fullName = (body.full_name || '').trim();
  const businessName = (body.business_name || '').trim();

  if (!email || !email.includes('@')) return error('Valid email required');
  if (password.length < 8) return error('Password must be at least 8 characters');

  // Check existing
  const existing = await env.DB.prepare('SELECT id, password_hash FROM clients WHERE email = ?').bind(email).first();
  if (existing?.password_hash) {
    return error('An account with this email already exists. Please sign in instead.', 409);
  }

  const passwordHash = await hashPassword(password);
  const now = Date.now();
  let clientId;

  if (existing) {
    // Account exists from a magic-link signup but has no password yet — set password
    clientId = existing.id;
    await env.DB.prepare(
      'UPDATE clients SET password_hash = ?, password_set_at = ?, full_name = COALESCE(NULLIF(?, ""), full_name), business_name = COALESCE(NULLIF(?, ""), business_name), updated_at = ? WHERE id = ?'
    ).bind(passwordHash, now, fullName, businessName, now, clientId).run();
  } else {
    clientId = newId('cli');
    await env.DB.prepare(
      'INSERT INTO clients (id, email, full_name, business_name, password_hash, password_set_at, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(clientId, email, fullName || null, businessName || null, passwordHash, now, 'pending', now, now).run();
  }

  // Create session
  const sessionId = newId('sess');
  const expiresAt = now + 30 * 24 * 60 * 60 * 1000;
  await env.DB.prepare(
    'INSERT INTO sessions (id, client_id, expires_at, ip, user_agent, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(sessionId, clientId, expiresAt, request.headers.get('CF-Connecting-IP') || '', request.headers.get('User-Agent') || '', now).run();

  await env.DB.prepare('UPDATE clients SET last_login = ? WHERE id = ?').bind(now, clientId).run();
  await logUsage(env, clientId, 'signup');

  return json({ ok: true, redirect: '/dashboard/' }, 200, {
    'Set-Cookie': setSessionCookie(sessionId),
  });
}
