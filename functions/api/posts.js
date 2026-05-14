// POST /api/posts — create a blog post (Bearer auth)
// GET  /api/posts — list published posts (public)
import { json, newId } from '../_lib.js';
import { requireBearer } from './_bearer.js';

const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 100);
const safe = (v, max = 5000) => v == null ? null : String(v).slice(0, max);
const slugUnique = async (db, baseSlug, lang) => {
  let slug = baseSlug; let i = 1;
  while (true) {
    const row = await db.prepare('SELECT id FROM blog_posts WHERE slug = ? AND language = ?').bind(slug, lang).first().catch(() => null);
    if (!row) return slug;
    i += 1; slug = `${baseSlug}-${i}`;
    if (i > 50) return `${baseSlug}-${Date.now()}`;
  }
};

export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const lang = url.searchParams.get('language') || 'en';
  const tag = url.searchParams.get('tag');
  const limit = Math.min(50, parseInt(url.searchParams.get('limit') || '20', 10));
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10));
  let sql = "SELECT id, title, slug, excerpt, cover_image_url, author_name, tag, language, published_at FROM blog_posts WHERE status = 'published'";
  const binds = [];
  if (lang) { sql += " AND COALESCE(language,'en') = ?"; binds.push(lang); }
  if (tag) { sql += " AND tag = ?"; binds.push(tag); }
  sql += " ORDER BY published_at DESC LIMIT ? OFFSET ?";
  binds.push(limit, offset);
  const rows = await env.DB.prepare(sql).bind(...binds).all();
  const totalRow = await env.DB.prepare(
    `SELECT COUNT(*) c FROM blog_posts WHERE status='published'${lang?' AND COALESCE(language,\'en\') = ?':''}${tag?' AND tag = ?':''}`
  ).bind(...binds.slice(0, binds.length - 2)).first().catch(() => ({ c: 0 }));
  return json({ posts: rows.results || [], total: totalRow?.c || 0, limit, offset });
}

export async function onRequestPost(context) {
  const auth = await requireBearer(context); if (auth.error) return auth.error;
  const { env, request } = context;
  const body = await request.json().catch(() => ({}));
  if (!body.title) return json({ error: 'title required' }, 400);
  const lang = (body.language === 'es') ? 'es' : 'en';
  const baseSlug = body.slug ? slugify(body.slug) : slugify(body.title);
  const slug = await slugUnique(env.DB, baseSlug, lang);
  const id = newId('post');
  const now = Date.now();
  const status = body.status === 'published' ? 'published' : 'draft';
  await env.DB.prepare(
    `INSERT INTO blog_posts (id, title, slug, excerpt, content, cover_image_url, author_name, tag, status, language, seo_title, seo_description, canonical_url, published_at, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    id, safe(body.title, 300), slug, safe(body.excerpt, 500), safe(body.content, 200000),
    safe(body.cover_image_url, 500), safe(body.author_name, 100) || 'Albert Brown',
    safe(body.tag, 60) || 'Other', status, lang,
    safe(body.seo_title, 200), safe(body.seo_description, 400), safe(body.canonical_url, 500),
    status === 'published' ? now : null, now, now,
  ).run();
  return json({ ok: true, id, slug, language: lang, status, url: `https://apextoolsai.com${lang === 'es' ? '/es' : ''}/blog/${slug}` });
}
