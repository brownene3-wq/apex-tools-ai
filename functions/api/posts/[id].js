// GET   /api/posts/{id}  — fetch one post (public if published)
// PATCH /api/posts/{id}  — update / publish (Bearer auth)
import { json } from '../../_lib.js';
import { requireBearer } from '../_bearer.js';

const safe = (v, max = 5000) => v == null ? null : String(v).slice(0, max);

export async function onRequestGet(context) {
  const { env, params } = context;
  const id = params.id;
  // Allow lookup by id OR by slug
  let row = await env.DB.prepare(
    'SELECT id, title, slug, excerpt, content, cover_image_url, author_name, tag, status, language, seo_title, seo_description, canonical_url, published_at, created_at, updated_at FROM blog_posts WHERE id = ? OR slug = ? LIMIT 1'
  ).bind(id, id).first().catch(() => null);
  if (!row) return json({ error: 'not found' }, 404);
  if (row.status !== 'published') return json({ error: 'not found' }, 404);
  return json({ post: row });
}

export async function onRequestPatch(context) {
  const auth = await requireBearer(context); if (auth.error) return auth.error;
  const { env, params, request } = context;
  const id = params.id;
  const body = await request.json().catch(() => ({}));
  const allowed = ['title', 'slug', 'excerpt', 'content', 'cover_image_url', 'author_name', 'tag', 'status', 'language', 'seo_title', 'seo_description', 'canonical_url'];
  const updates = {};
  for (const k of allowed) if (k in body) updates[k] = safe(body[k], 200000);
  if (!Object.keys(updates).length) return json({ error: 'nothing to update' }, 400);
  if (updates.status === 'published') {
    const existing = await env.DB.prepare("SELECT published_at FROM blog_posts WHERE id = ?").bind(id).first().catch(() => null);
    if (existing && !existing.published_at) updates.published_at = Date.now();
  }
  const setClause = Object.keys(updates).map(k => `${k} = ?`).join(', ') + ', updated_at = ?';
  const values = [...Object.values(updates), Date.now(), id];
  const result = await env.DB.prepare(`UPDATE blog_posts SET ${setClause} WHERE id = ?`).bind(...values).run();
  if (!result.success && !result.meta?.changes) return json({ error: 'not found' }, 404);
  const row = await env.DB.prepare("SELECT id, slug, status, language FROM blog_posts WHERE id = ?").bind(id).first();
  return json({ ok: true, post: row, url: row ? `https://apextoolsai.com${row.language === 'es' ? '/es' : ''}/blog/${row.slug}` : null });
}
