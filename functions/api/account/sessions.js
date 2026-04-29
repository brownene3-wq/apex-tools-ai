// GET /api/account/sessions — list active sessions for current user
// DELETE /api/account/sessions?id=... — revoke a session
import { json, error, requireAuth } from '../../_lib.js';

export async function onRequestGet(context) {
  const authErr = requireAuth(context); if (authErr) return authErr;
  const id = context.data.user.id;
  const rows = await context.env.DB.prepare(
    'SELECT id, expires_at, ip, user_agent, created_at FROM sessions WHERE client_id = ? AND expires_at > ? ORDER BY created_at DESC'
  ).bind(id, Date.now()).all();
  // Get current session id from cookie
  const cookie = context.request.headers.get('Cookie') || '';
  const m = cookie.match(/apex_session=([^;]+)/);
  const currentSessionId = m ? m[1] : null;
  const sessions = (rows.results || []).map(s => ({ ...s, is_current: s.id === currentSessionId }));
  return json({ ok: true, sessions });
}

export async function onRequestDelete(context) {
  const authErr = requireAuth(context); if (authErr) return authErr;
  const id = context.data.user.id;
  const url = new URL(context.request.url);
  const sessionId = url.searchParams.get('id');
  if (!sessionId) return error('Session id required');
  const cookie = context.request.headers.get('Cookie') || '';
  const m = cookie.match(/apex_session=([^;]+)/);
  if (m && m[1] === sessionId) return error('Cannot revoke the current session — sign out instead.', 400);
  await context.env.DB.prepare('DELETE FROM sessions WHERE id = ? AND client_id = ?').bind(sessionId, id).run();
  return json({ ok: true });
}
