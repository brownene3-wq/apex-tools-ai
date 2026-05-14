// /blog/rss.xml — RSS 2.0 feed of latest published posts.
import { escapeHtml } from '../_blog.js';

export async function onRequest(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const lang = url.pathname.startsWith('/es') ? 'es' : 'en';
  const baseUrl = `https://apextoolsai.com${lang === 'es' ? '/es' : ''}/blog`;

  const rows = await env.DB.prepare(
    `SELECT title, slug, excerpt, content, author_name, published_at FROM blog_posts
     WHERE status='published' AND COALESCE(language,'en') = ?
     ORDER BY published_at DESC LIMIT 50`
  ).bind(lang).all().catch(() => ({ results: [] }));

  const items = (rows.results || []).map(p => `
    <item>
      <title>${escapeHtml(p.title)}</title>
      <link>${baseUrl}/${escapeHtml(p.slug)}</link>
      <guid isPermaLink="true">${baseUrl}/${escapeHtml(p.slug)}</guid>
      <pubDate>${new Date(p.published_at).toUTCString()}</pubDate>
      <author>${escapeHtml(p.author_name || 'Apex Tools AI')}</author>
      <description><![CDATA[${p.excerpt || (p.content||'').slice(0, 500)}]]></description>
    </item>`).join('');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>Apex Tools AI Blog${lang==='es'?' (Español)':''}</title>
<link>${baseUrl}</link>
<atom:link href="${baseUrl}/rss.xml" rel="self" type="application/rss+xml" />
<description>${lang==='es'?'IA para consultorios dentales y med spas. Recepcionistas AI bilingües.':'AI for dental practices and med spas. Bilingual AI receptionists.'}</description>
<language>${lang==='es'?'es-US':'en-US'}</language>
<lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
</channel>
</rss>`;
  return new Response(xml, { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8', 'Cache-Control': 'public, max-age=600' } });
}
