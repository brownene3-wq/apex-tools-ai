// GET /api/account — return profile + notification prefs
// PATCH /api/account — update profile fields
import { json, error, requireAuth } from '../_lib.js';

export async function onRequestGet(context) {
  const authErr = requireAuth(context); if (authErr) return authErr;
  const id = context.data.user.id;
  const c = await context.env.DB.prepare(
    `SELECT id, email, full_name, business_name, business_address, phone, practice_type, language_pref,
            timezone, notify_call_summary, notify_appointment, notify_urgent, notify_weekly_report, notify_billing,
            plan, status, is_admin, is_founding_client, password_set_at, last_login, created_at
     FROM clients WHERE id = ?`
  ).bind(id).first();
  return json({ ok: true, account: c });
}

export async function onRequestPatch(context) {
  const authErr = requireAuth(context); if (authErr) return authErr;
  const id = context.data.user.id;
  const body = await context.request.json().catch(() => ({}));
  const allowed = ['full_name', 'business_name', 'business_address', 'phone', 'practice_type', 'language_pref', 'timezone',
                   'notify_call_summary', 'notify_appointment', 'notify_urgent', 'notify_weekly_report', 'notify_billing'];
  const updates = [];
  const values = [];
  for (const key of allowed) {
    if (body[key] !== undefined) {
      updates.push(`${key} = ?`);
      values.push(typeof body[key] === 'boolean' ? (body[key] ? 1 : 0) : body[key]);
    }
  }
  if (!updates.length) return error('No valid fields to update');
  updates.push('updated_at = ?');
  values.push(Date.now());
  values.push(id);
  await context.env.DB.prepare(`UPDATE clients SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();
  return json({ ok: true });
}
