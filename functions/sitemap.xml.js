// Dynamic /sitemap.xml — homepage(s), terms/privacy, plus all published blog posts.
import { escapeHtml } from './_blog.js';

export async function onRequest(context) {
  const { env } = context;
  const today = new Date().toISOString().slice(0, 10);
  const urls = [
    { loc: 'https://apextoolsai.com/', lastmod: today, priority: '1.0', changefreq: 'weekly' },
    { loc: 'https://apextoolsai.com/es/', lastmod: today, priority: '1.0', changefreq: 'weekly' },
    { loc: 'https://apextoolsai.com/blog', lastmod: today, priority: '0.8', changefreq: 'daily' },
    { loc: 'https://apextoolsai.com/es/blog', lastmod: today, priority: '0.8', changefreq: 'daily' },
    { loc: 'https://apextoolsai.com/privacy.html', lastmod: today, priority: '0.3', changefreq: 'yearly' },
    { loc: 'https://apextoolsai.com/terms.html', lastmod: today, priority: '0.3', changefreq: 'yearly' },
  ];
  const posts = await env.DB.prepare(
    "SELECT slug, language, published_at FROM blog_posts WHERE status='published' ORDER BY published_at DESC LIMIT 5000"
  ).all().catch(() => ({ results: [] }));
  for (const p of posts.results || []) {
    const lang = p.language || 'en';
    const base = `https://apextoolsai.com${lang === 'es' ? '/es' : ''}/blog/${p.slug}`;
    urls.push({
      loc: base,
      lastmod: new Date(p.published_at).toISOString().slice(0, 10),
      priority: '0.7',
      changefreq: 'monthly',
    });
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url>
    <loc>${escapeHtml(u.loc)}</loc>
    <lastmod>${u.lastmod}</lastmod>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`).join('\n')}
</urlset>`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=600' } });
}
