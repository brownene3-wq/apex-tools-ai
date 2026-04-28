// GET /api/config — fetch current AI config for client
// PATCH /api/config — update fields and push to Vapi
import { json, requireAuth, error, logUsage } from '../_lib.js';
import { syncAssistant } from '../_vapi.js';

const ALLOWED_FIELDS = ['hours_json', 'services_json', 'insurance_json', 'faqs_json', 'voice_id', 'greeting', 'escalation_phone', 'language_pref', 'business_name', 'business_address', 'phone', 'practice_type'];

export async function onRequestGet(context) {
  const err = requireAuth(context); if (err) return err;
  const row = await context.env.DB.prepare(
    'SELECT email, full_name, business_name, business_address, phone, practice_type, language_pref, hours_json, services_json, insurance_json, faqs_json, voice_id, greeting, escalation_phone, twilio_phone_number, vapi_assistant_id FROM clients WHERE id = ?'
  ).bind(context.data.user.id).first();
  if (!row) return error('Client not found', 404);
  return json({ config: row });
}

export async function onRequestPatch(context) {
  const err = requireAuth(context); if (err) return err;
  const { env, request } = context;
  const body = await request.json().catch(() => ({}));

  const updates = {};
  for (const k of ALLOWED_FIELDS) if (k in body) updates[k] = body[k];
  if (!Object.keys(updates).length) return error('No valid fields to update');

  const setClause = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  const values = Object.values(updates);

  await env.DB.prepare(
    `UPDATE clients SET ${setClause}, updated_at = ? WHERE id = ?`
  ).bind(...values, Date.now(), context.data.user.id).run();

  await logUsage(env, context.data.user.id, 'config_changed', { fields: Object.keys(updates) });

  // Reload full client and sync to Vapi
  const client = await env.DB.prepare('SELECT * FROM clients WHERE id = ?').bind(context.data.user.id).first();
  let syncResult = null;
  if (client.vapi_assistant_id) {
    syncResult = await syncAssistant(env, client);
  }

  return json({
    ok: true,
    vapi_synced: !!syncResult?.ok,
    vapi_error: syncResult?.ok === false ? (syncResult.error || syncResult.data?.message) : null,
  });
}
