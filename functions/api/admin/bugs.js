// GET /api/admin/bugs?status=open|resolved
// PATCH /api/admin/bugs?id=xxx (toggle status)
// DELETE /api/admin/bugs?id=xxx
// POST /api/admin/bugs (clients submit)
import { json, requireAdmin, requireAuth, error, newId } from '../../_lib.js';

export async function onRequestGet(context) {
  const err = requireAdmin(context); if (err) return err;
  const u = new URL(context.request.url);
  const status = u.searchParams.get('status');
  const where = status && status !== 'all' ? 'WHERE status = ?' : '';
  const stmt = status && status !== 'all'
    ? context.env.DB.prepare(`SELECT * FROM bug_reports ${where} ORDER BY created_at DESC LIMIT 200`).bind(status)
    : context.env.DB.prepare(`SELECT * FROM bug_reports ORDER BY created_at DESC LIMIT 200`);
  const rows = await stmt.all();
  const summary = await context.env.DB.prepare("SELECT status, COUNT(*) c FROM bug_reports GROUP BY status").all();
  return json({ reports: rows.results || [], summary: summary.results || [] });
}

export async function onRequestPost(context) {
  const err = requireAuth(context); if (err) return err;
  const body = await context.request.json().catch(() => ({}));
  if (!body.description) return error('Description required');
  const id = newId('bug');
  await context.env.DB.prepare(
    "INSERT INTO bug_reports (id, client_id, reporter_email, category, description, page_url, created_at) VALUES (?,?,?,?,?,?,?)"
  ).bind(id, context.data.user.id, context.data.user.email, body.category || 'bug', body.description, body.page_url || '', Date.now()).run();
  return json({ ok: true });
}

export async function onRequestPatch(context) {
  const err = requireAdmin(context); if (err) return err;
  const u = new URL(context.request.url);
  const id = u.searchParams.get('id');
  if (!id) return error('Missing id');
  const r = await context.env.DB.prepare("SELECT status FROM bug_reports WHERE id = ?").bind(id).first();
  if (!r) return error('Not found', 404);
  const newStatus = r.status === 'open' ? 'resolved' : 'open';
  await context.env.DB.prepare(
    "UPDATE bug_reports SET status = ?, is_unread = 0, resolved_at = ? WHERE id = ?"
  ).bind(newStatus, newStatus === 'resolved' ? Date.now() : null, id).run();
  return json({ ok: true, status: newStatus });
}

export async function onRequestDelete(context) {
  const err = requireAdmin(context); if (err) return err;
  const u = new URL(context.request.url);
  const id = u.searchParams.get('id');
  if (!id) return error('Missing id');
  await context.env.DB.prepare("DELETE FROM bug_reports WHERE id = ?").bind(id).run();
  return json({ ok: true });
}
