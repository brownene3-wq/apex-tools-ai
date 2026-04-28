// GET /api/admin/team — list members + invitations
// POST /api/admin/team/invite — invite by email
import { json, requireAdmin, error, newId, sendEmail } from '../../_lib.js';

export async function onRequestGet(context) {
  const err = requireAdmin(context); if (err) return err;
  const [members, invites] = await Promise.all([
    context.env.DB.prepare("SELECT * FROM team_members ORDER BY created_at DESC").all(),
    context.env.DB.prepare("SELECT * FROM team_invitations WHERE used = 0 AND expires_at > ? ORDER BY created_at DESC").bind(Date.now()).all(),
  ]);
  return json({ members: members.results || [], invitations: invites.results || [] });
}

export async function onRequestPost(context) {
  const err = requireAdmin(context); if (err) return err;
  const body = await context.request.json().catch(() => ({}));
  if (!body.email) return error('Email required');
  const role = body.role || 'viewer';
  const id = newId('inv');
  const token = newId();
  const expiresAt = Date.now() + 7 * 86400000;
  await context.env.DB.prepare(
    "INSERT INTO team_invitations (id, email, role, permissions_json, invite_token, expires_at, invited_by, created_at) VALUES (?,?,?,?,?,?,?,?)"
  ).bind(id, body.email, role, JSON.stringify(body.permissions || []), token, expiresAt, context.data.user.email, Date.now()).run();

  const origin = new URL(context.request.url).origin;
  await sendEmail(context.env, {
    to: body.email,
    subject: 'You were invited to join Apex Tools AI',
    html: `<p>${context.data.user.email} invited you to join Apex Tools AI as <strong>${role}</strong>.</p><p><a href="${origin}/admin/accept-invite.html?token=${token}">Accept invitation</a></p>`,
  });
  return json({ ok: true, invite_link: `${origin}/admin/accept-invite.html?token=${token}` });
}
