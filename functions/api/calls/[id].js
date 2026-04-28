// GET /api/calls/:id — full call details
import { json, requireAuth, error } from '../../_lib.js';

export async function onRequestGet(context) {
  const err = requireAuth(context); if (err) return err;
  const { env, params } = context;
  const clientId = context.data.user.id;

  const row = await env.DB.prepare(
    'SELECT * FROM call_logs WHERE id = ? AND client_id = ?'
  ).bind(params.id, clientId).first();
  if (!row) return error('Call not found', 404);
  return json({ call: row });
}
