// GET    /api/admin/tokens          — list tokens
// POST   /api/admin/tokens          — create token (returns plaintext once)
// DELETE /api/admin/tokens?id=xxx   — revoke
import { json, requireAdmin, error, newId } from '../../_lib.js';

const sha256hex = async (s) => {
  const data = new TextEncoder().encode(s);
  const d = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(d)).map(b => b.toString(16).padStart(2, '0')).join('');
};

export async function onRequestGet(context) {
  const err = requireAdmin(context); if (err) return err;
  const rows = await context.env.DB.prepare(
    "SELECT id, name, scopes, created_at, last_used_at, revoked_at FROM api_tokens ORDER BY created_at DESC"
  ).all().catch(() => ({ results: [] }));
  return json({ tokens: rows.results || [] });
}

export async function onRequestPost(context) {
  const err = requireAdmin(context); if (err) return err;
  const body = await context.request.json().catch(() => ({}));
  if (!body.name) return error('name required');
  const id = newId('tok');
  // Token format: apx_<random>. Random part is 40 hex chars from getRandomValues.
  const rand = new Uint8Array(20);
  crypto.getRandomValues(rand);
  const token = 'apx_' + Array.from(rand).map(b => b.toString(16).padStart(2, '0')).join('');
  const hash = await sha256hex(token);
  await context.env.DB.prepare(
    "INSERT INTO api_tokens (id, token_hash, name, scopes, created_at) VALUES (?, ?, ?, ?, ?)"
  ).bind(id, hash, String(body.name).slice(0, 100), body.scopes ? String(body.scopes).slice(0, 200) : 'posts:write', Date.now()).run();
  return json({ ok: true, id, name: body.name, token, warning: 'Save this token now. It will not be shown again.' });
}

export async function onRequestDelete(context) {
  const err = requireAdmin(context); if (err) return err;
  const u = new URL(context.request.url);
  const id = u.searchParams.get('id');
  if (!id) return error('missing id');
  await context.env.DB.prepare("UPDATE api_tokens SET revoked_at = ? WHERE id = ?").bind(Date.now(), id).run();
  return json({ ok: true });
}
