// GET /api/appointments?upcoming=1
import { json, requireAuth } from '../_lib.js';

export async function onRequestGet(context) {
  const err = requireAuth(context); if (err) return err;
  const { env, request } = context;
  const u = new URL(request.url);
  const upcoming = u.searchParams.get('upcoming') === '1';
  const clientId = context.data.user.id;

  const where = upcoming ? 'client_id = ? AND appointment_at >= ?' : 'client_id = ?';
  const params = upcoming ? [clientId, Date.now()] : [clientId];

  const rows = await env.DB.prepare(
    `SELECT * FROM appointments WHERE ${where} ORDER BY appointment_at ASC LIMIT 200`
  ).bind(...params).all();

  return json({ appointments: rows.results || [] });
}
