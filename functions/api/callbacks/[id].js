// PATCH /api/callbacks/:id   Update status or notes
// GET   /api/callbacks/:id   Get one callback

import { json, requireAuth } from '../../_lib.js';

export async function onRequestGet(context) {
  const err = requireAuth(context); if (err) return err;
  const { env, params } = context;
  const clientId = context.data.user.id;
  const row = await env.DB.prepare(
    `SELECT * FROM callbacks WHERE id = ? AND client_id = ?`
  ).bind(params.id, clientId).first();
  if (!row) return json({ error: 'not_found' }, 404);
  return json({ callback: row });
}

export async function onRequestPatch(context) {
  const err = requireAuth(context); if (err) return err;
  const { env, params, request } = context;
  const clientId = context.data.user.id;
  const userEmail = context.data.user.email;
  const body = await request.json().catch(() => ({}));

  const allowedStatus = ['new', 'in_progress', 'completed', 'no_answer', 'dismissed'];
  const updates = [];
  const vals = [];

  if (body.status && allowedStatus.includes(body.status)) {
    updates.push('status = ?');
    vals.push(body.status);
    if (['completed', 'dismissed', 'no_answer'].includes(body.status)) {
      updates.push('resolved_at = ?', 'resolved_by = ?');
      vals.push(Date.now(), userEmail);
    }
  }
  if (typeof body.notes === 'string') {
    updates.push('notes = ?');
    vals.push(body.notes);
  }
  if (!updates.length) return json({ error: 'nothing to update' }, 400);

  vals.push(params.id, clientId);
  const result = await env.DB.prepare(
    `UPDATE callbacks SET ${updates.join(', ')} WHERE id = ? AND client_id = ?`
  ).bind(...vals).run();
  if (!result.meta?.changes) return json({ error: 'not_found' }, 404);
  return json({ success: true });
}
