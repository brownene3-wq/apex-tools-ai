// POST /api/account/delete — { password } — soft-delete the account (status=cancelled, scrub PII)
import { json, error, requireAuth, verifyPassword, clearSessionCookie, logUsage } from '../../_lib.js';

export async function onRequestPost(context) {
  const authErr = requireAuth(context); if (authErr) return authErr;
  const body = await context.request.json().catch(() => ({}));
  const password = body.password || '';
  const id = context.data.user.id;

  const c = await context.env.DB.prepare('SELECT password_hash, is_admin FROM clients WHERE id = ?').bind(id).first();
  if (c?.is_admin) return error('Admin accounts cannot be deleted from the dashboard. Contact support.', 403);
  if (!c?.password_hash) return error('Password verification required to delete the account.', 400);
  const ok = await verifyPassword(password, c.password_hash);
  if (!ok) return error('Password is incorrect.', 401);

  const now = Date.now();
  // Soft delete: scrub PII, mark cancelled, clear sessions
  await context.env.DB.prepare(
    `UPDATE clients SET status = 'cancelled', email = ?, full_name = NULL, business_name = NULL,
            business_address = NULL, phone = NULL, password_hash = NULL, password_set_at = NULL,
            updated_at = ? WHERE id = ?`
  ).bind(`deleted-${id}@deleted.local`, now, id).run();
  await context.env.DB.prepare('DELETE FROM sessions WHERE client_id = ?').bind(id).run();
  await context.env.DB.prepare('DELETE FROM client_integrations WHERE client_id = ?').bind(id).run();
  await logUsage(context.env, id, 'account_deleted');

  return json({ ok: true }, 200, {
    'Set-Cookie': clearSessionCookie(),
  });
}
