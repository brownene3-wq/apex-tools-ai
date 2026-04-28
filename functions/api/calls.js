// GET /api/calls?page=1&limit=50&q=&lang=&urgent=
import { json, requireAuth } from '../_lib.js';

export async function onRequestGet(context) {
  const err = requireAuth(context); if (err) return err;
  const { env, request } = context;
  const u = new URL(request.url);
  const clientId = context.data.user.id;

  const limit = Math.min(parseInt(u.searchParams.get('limit') || '50'), 200);
  const page = Math.max(1, parseInt(u.searchParams.get('page') || '1'));
  const offset = (page - 1) * limit;
  const lang = u.searchParams.get('lang');
  const urgent = u.searchParams.get('urgent');
  const q = u.searchParams.get('q');

  let where = 'client_id = ?';
  const params = [clientId];
  if (lang) { where += ' AND language = ?'; params.push(lang); }
  if (urgent === '1') { where += ' AND was_urgent = 1'; }
  if (q) { where += ' AND (caller_number LIKE ? OR transcript LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }

  const rowsStmt = env.DB.prepare(
    `SELECT id, caller_number, duration_seconds, language, ended_reason, was_appointment_booked, was_urgent, call_started_at, recording_url
     FROM call_logs WHERE ${where} ORDER BY call_started_at DESC LIMIT ? OFFSET ?`
  ).bind(...params, limit, offset);
  const countStmt = env.DB.prepare(`SELECT COUNT(*) as c FROM call_logs WHERE ${where}`).bind(...params);

  const [rows, count] = await Promise.all([rowsStmt.all(), countStmt.first()]);
  return json({ calls: rows.results || [], total: count?.c || 0, page, limit });
}
