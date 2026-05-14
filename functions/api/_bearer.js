// Bearer-token auth helper for public-write API endpoints (blog posts, etc).
// Tokens are stored as SHA-256 hashes in api_tokens table.
import { json } from '../_lib.js';

const hashToken = async (token) => {
  const data = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
};

export const requireBearer = async (context) => {
  const { request, env } = context;
  const h = request.headers.get('authorization') || request.headers.get('Authorization') || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return { error: json({ error: 'missing bearer token' }, 401) };
  const token = m[1].trim();
  if (!token) return { error: json({ error: 'empty token' }, 401) };
  const hash = await hashToken(token);
  const row = await env.DB.prepare(
    'SELECT id, name, scopes, revoked_at FROM api_tokens WHERE token_hash = ? LIMIT 1'
  ).bind(hash).first().catch(() => null);
  if (!row) return { error: json({ error: 'invalid token' }, 401) };
  if (row.revoked_at) return { error: json({ error: 'token revoked' }, 401) };
  // Fire-and-forget update last_used_at
  context.waitUntil?.(env.DB.prepare('UPDATE api_tokens SET last_used_at = ? WHERE id = ?').bind(Date.now(), row.id).run().catch(() => {}));
  return { token_id: row.id, name: row.name, scopes: row.scopes };
};

export const hashTokenExport = hashToken;
