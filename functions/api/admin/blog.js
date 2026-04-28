// GET /api/admin/blog — list posts
// POST /api/admin/blog — create
// PATCH /api/admin/blog?id=xxx — update
// DELETE /api/admin/blog?id=xxx — delete
import { json, requireAdmin, error, newId } from '../../_lib.js';

const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 80);

export async function onRequestGet(context) {
  const err = requireAdmin(context); if (err) return err;
  const rows = await context.env.DB.prepare("SELECT id, title, slug, excerpt, author_name, tag, status, published_at, created_at, updated_at FROM blog_posts ORDER BY created_at DESC LIMIT 200").all();
  return json({ posts: rows.results || [] });
}

export async function onRequestPost(context) {
  const err = requireAdmin(context); if (err) return err;
  const body = await context.request.json().catch(() => ({}));
  if (!body.title) return error('Title required');
  const id = newId('post');
  const slug = body.slug || slugify(body.title);
  const now = Date.now();
  await context.env.DB.prepare(
    "INSERT INTO blog_posts (id, title, slug, excerpt, content, cover_image_url, author_name, tag, status, published_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)"
  ).bind(id, body.title, slug, body.excerpt || '', body.content || '', body.cover_image_url || '', body.author_name || 'Albert Brown', body.tag || 'Other', body.status || 'draft', body.status === 'published' ? now : null, now, now).run();
  return json({ ok: true, id, slug });
}

export async function onRequestPatch(context) {
  const err = requireAdmin(context); if (err) return err;
  const u = new URL(context.request.url);
  const id = u.searchParams.get('id');
  if (!id) return error('Missing id');
  const body = await context.request.json().catch(() => ({}));
  const allowed = ['title', 'slug', 'excerpt', 'content', 'cover_image_url', 'author_name', 'tag', 'status'];
  const updates = {};
  for (const k of allowed) if (k in body) updates[k] = body[k];
  if (!Object.keys(updates).length) return error('Nothing to update');
  if (updates.status === 'published') updates.published_at = Date.now();
  const setClause = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  const values = Object.values(updates);
  await context.env.DB.prepare(`UPDATE blog_posts SET ${setClause}, updated_at = ? WHERE id = ?`).bind(...values, Date.now(), id).run();
  return json({ ok: true });
}

export async function onRequestDelete(context) {
  const err = requireAdmin(context); if (err) return err;
  const u = new URL(context.request.url);
  const id = u.searchParams.get('id');
  if (!id) return error('Missing id');
  await context.env.DB.prepare("DELETE FROM blog_posts WHERE id = ?").bind(id).run();
  return json({ ok: true });
}
