// Callbacks API
// GET  /api/callbacks?status=new           — list (filter by status)
// POST /api/callbacks                      — manual entry from dashboard
// PATCH /api/callbacks/:id (in [id].js)    — update status / notes

import { json, requireAuth } from '../_lib.js';

export async function onRequestGet(context) {
  const err = requireAuth(context); if (err) return err;
  const { env, request } = context;
  const u = new URL(request.url);
  const clientId = context.data.user.id;

  const status = u.searchParams.get('status');
  const limit = Math.min(parseInt(u.searchParams.get('limit') || '100'), 200);

  let where = 'client_id = ?';
  const params = [clientId];
  if (status && status !== 'all') { where += ' AND status = ?'; params.push(status); }

  const rowsStmt = env.DB.prepare(
    `SELECT id, call_log_id, caller_name, caller_phone, reason, language, preferred_time,
            status, notes, created_at, resolved_at, resolved_by
     FROM callbacks WHERE ${where}
     ORDER BY CASE status WHEN 'new' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END,
              created_at DESC
     LIMIT ?`
  ).bind(...params, limit);

  const countsStmt = env.DB.prepare(
    `SELECT
       COALESCE(SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END), 0) AS new_count,
       COALESCE(SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END), 0) AS in_progress_count,
       COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0) AS completed_count,
       COUNT(*) AS total_count
     FROM callbacks WHERE client_id = ?`
  ).bind(clientId);

  try {
    const [rows, counts] = await Promise.all([rowsStmt.all(), countsStmt.first()]);
    return json({
      callbacks: rows.results || [],
      counts: {
        new: Number(counts?.new_count) || 0,
        in_progress: Number(counts?.in_progress_count) || 0,
        completed: Number(counts?.completed_count) || 0,
        total: Number(counts?.total_count) || 0,
      },
    });
  } catch (e) {
    // Table doesn't exist yet (first deploy) — return empty
    if (/no such table/i.test(e?.message || '')) {
      return json({ callbacks: [], counts: { new: 0, in_progress: 0, completed: 0, total: 0 } });
    }
    throw e;
  }
}

export async function onRequestPost(context) {
  const err = requireAuth(context); if (err) return err;
  const { env, request } = context;
  const clientId = context.data.user.id;
  const body = await request.json().catch(() => ({}));

  const phone = (body.caller_phone || '').trim();
  if (!phone) return json({ error: 'caller_phone required' }, 400);

  const id = 'cb_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  await env.DB.prepare(
    `INSERT INTO callbacks (id, client_id, call_log_id, caller_name, caller_phone,
       reason, language, preferred_time, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', ?)`
  ).bind(
    id, clientId, body.call_log_id || null, body.caller_name || null, phone,
    body.reason || null, body.language || 'en', body.preferred_time || null, Date.now()
  ).run();

  return json({ success: true, id });
}
