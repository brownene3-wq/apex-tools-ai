// POST /api/admin/set-vapi — admin sets vapi_assistant_id and twilio number for a client
import { json, requireAdmin, error } from '../../_lib.js';

export async function onRequestPost(context) {
  const err = requireAdmin(context); if (err) return err;
  const body = await context.request.json().catch(() => ({}));
  if (!body.client_id) return error('client_id required');

  const updates = {};
  if ('vapi_assistant_id' in body) updates.vapi_assistant_id = body.vapi_assistant_id;
  if ('twilio_phone_number' in body) updates.twilio_phone_number = body.twilio_phone_number;
  if ('plan' in body) updates.plan = body.plan;
  if ('status' in body) updates.status = body.status;
  if ('is_founding_client' in body) updates.is_founding_client = body.is_founding_client ? 1 : 0;
  if ('stripe_customer_id' in body) updates.stripe_customer_id = body.stripe_customer_id;

  if (!Object.keys(updates).length) return error('Nothing to update');

  const setClause = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  const values = Object.values(updates);

  await context.env.DB.prepare(
    `UPDATE clients SET ${setClause}, updated_at = ? WHERE id = ?`
  ).bind(...values, Date.now(), body.client_id).run();

  return json({ ok: true });
}
