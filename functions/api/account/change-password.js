// POST /api/account/change-password — { current_password, new_password }
import { json, error, requireAuth, hashPassword, verifyPassword, logUsage } from '../../_lib.js';

export async function onRequestPost(context) {
  const authErr = requireAuth(context); if (authErr) return authErr;
  const body = await context.request.json().catch(() => ({}));
  const current = body.current_password || '';
  const next = body.new_password || '';
  if (!current || !next) return error('Current and new password are required');
  if (next.length < 8) return error('New password must be at least 8 characters');
  if (current === next) return error('New password must be different from current password');

  const id = context.data.user.id;
  const c = await context.env.DB.prepare('SELECT password_hash FROM clients WHERE id = ?').bind(id).first();
  if (!c?.password_hash) return error('No password set on this account. Use Forgot Password to set one.', 400);
  const ok = await verifyPassword(current, c.password_hash);
  if (!ok) return error('Current password is incorrect.', 401);

  const newHash = await hashPassword(next);
  const now = Date.now();
  await context.env.DB.prepare(
    'UPDATE clients SET password_hash = ?, password_set_at = ?, updated_at = ? WHERE id = ?'
  ).bind(newHash, now, now, id).run();

  await logUsage(context.env, id, 'password_changed');
  return json({ ok: true });
}
