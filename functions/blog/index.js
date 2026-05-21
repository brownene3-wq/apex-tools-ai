// SSR /blog (and /es/blog) — list of published posts.
import { escapeHtml, fmtDate } from '../_blog.js';

export async function onRequest(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const lang = url.pathname.startsWith('/es') ? 'es' : 'en';
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const perPage = 10;
  const offset = (page - 1) * perPage;

  const rows = await env.DB.prepare(
    `SELECT id, title, slug, excerpt, cover_image_url, author_name, tag, language, published_at
     FROM blog_posts WHERE status = 'published' AND COALESCE(language,'en') = ?
     ORDER BY published_at DESC LIMIT ? OFFSET ?`
  ).bind(lang, perPage, offset).all().catch(() => ({ results: [] }));
  const posts = rows.results || [];

  const totalRow = await env.DB.prepare(
    "SELECT COUNT(*) c FROM blog_posts WHERE status='published' AND COALESCE(language,'en') = ?"
  ).bind(lang).first().catch(() => ({ c: 0 }));
  const total = totalRow?.c || 0;
  const totalPages = Math.max(1, Math.ceil(total / perPage));

  const t = lang === 'es' ? {
    title: 'Blog · Apex Tools AI',
    desc: 'Artículos sobre IA para consultorios dentales, recepcionistas AI bilingües y crecimiento de prácticas.',
    h1: 'Blog',
    sub: 'Ideas sobre recepcionistas AI, marketing dental y crecimiento de consultorios.',
    readMore: 'Leer más',
    empty: 'Aún no hay artículos publicados. ¡Vuelva pronto!',
    prev: 'Anterior',
    next: 'Siguiente',
  } : {
    title: 'Blog · Apex Tools AI',
    desc: 'Articles on AI for dental practices, bilingual AI receptionists, and practice growth.',
    h1: 'Blog',
    sub: 'Ideas on AI receptionists, dental marketing, and practice growth.',
    readMore: 'Read more',
    empty: 'No posts published yet. Check back soon!',
    prev: 'Previous',
    next: 'Next',
  };

  const baseUrl = `https://apextoolsai.com${lang === 'es' ? '/es' : ''}/blog`;
  const altLang = lang === 'es' ? 'en' : 'es';
  const altBase = `https://apextoolsai.com${altLang === 'es' ? '/es' : ''}/blog`;

  const postCards = posts.map(p => `
    <article class="bg-white rounded-2xl border border-navy-100 overflow-hidden hover:shadow-xl transition-shadow">
      ${p.cover_image_url ? `<a href="${baseUrl}/${escapeHtml(p.slug)}"><img src="${escapeHtml(p.cover_image_url)}" alt="${escapeHtml(p.title)}" class="w-full h-48 object-cover" loading="lazy"></a>` : ''}
      <div class="p-6">
        ${p.tag ? `<span class="inline-block bg-accent-50 text-accent-700 text-xs font-semibold px-3 py-1 rounded-full mb-3">${escapeHtml(p.tag)}</span>` : ''}
        <h2 class="font-display text-xl font-bold text-navy-900 mb-2 leading-tight"><a href="${baseUrl}/${escapeHtml(p.slug)}" class="hover:text-accent-600 transition-colors">${escapeHtml(p.title)}</a></h2>
        ${p.excerpt ? `<p class="text-navy-600 text-sm mb-4 line-clamp-3">${escapeHtml(p.excerpt)}</p>` : ''}
        <div class="flex items-center justify-between text-xs text-navy-500">
          <span>${escapeHtml(p.author_name || 'Apex Tools AI')} · ${fmtDate(p.published_at, lang)}</span>
          <a href="${baseUrl}/${escapeHtml(p.slug)}" class="font-semibold text-accent-600 hover:text-accent-700">${t.readMore} →</a>
        </div>
      </div>
    </article>
  `).join('');

  const pagination = totalPages > 1 ? `
    <nav class="flex items-center justify-center gap-3 mt-12">
      ${page > 1 ? `<a href="${baseUrl}?page=${page-1}" class="px-4 py-2 rounded-full bg-white border border-navy-200 text-sm font-semibold hover:bg-navy-50">← ${t.prev}</a>` : ''}
      <span class="text-sm text-navy-500">${page} / ${totalPages}</span>
      ${page < totalPages ? `<a href="${baseUrl}?page=${page+1}" class="px-4 py-2 rounded-full bg-white border border-navy-200 text-sm font-semibold hover:bg-navy-50">${t.next} →</a>` : ''}
    </nav>` : '';

  const html = `<!DOCTYPE html>
<html lang="${lang}">
<head>
<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-ZDRHSN0YYR"></script>
<script>
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', 'G-ZDRHSN0YYR');
</script>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(t.title)}</title>
<meta name="description" content="${escapeHtml(t.desc)}">
<link rel="canonical" href="${baseUrl}${page>1?`?page=${page}`:''}">
<link rel="alternate" hreflang="${lang}" href="${baseUrl}">
<link rel="alternate" hreflang="${altLang}" href="${altBase}">
<link rel="alternate" hreflang="x-default" href="https://apextoolsai.com/blog">
<link rel="alternate" type="application/rss+xml" title="Apex Tools AI Blog" href="${baseUrl}/rss.xml">
<meta property="og:title" content="${escapeHtml(t.title)}">
<meta property="og:description" content="${escapeHtml(t.desc)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${baseUrl}">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/apex-logo.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Plus+Jakarta+Sans:wght@600;700;800&display=swap" rel="stylesheet">
<script src="https://cdn.tailwindcss.com"></script>
<script>tailwind.config={theme:{extend:{fontFamily:{sans:['Inter','system-ui','sans-serif'],display:['Plus Jakarta Sans','sans-serif']},colors:{navy:{50:'#f0f4f9',100:'#dbe5f1',500:'#475569',600:'#1e3a5f',700:'#172a4a',900:'#0a1628'},accent:{50:'#fff7ed',400:'#fb923c',500:'#f97316',600:'#ea580c',700:'#c2410c'}}}}}</script>
</head>
<body class="font-sans bg-navy-50/30">
<header class="sticky top-0 z-50 bg-white/95 backdrop-blur-lg border-b border-navy-100">
  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between">
    <a href="${lang==='es'?'/es/':'/'}" class="flex items-center gap-2 font-display font-extrabold text-navy-900"><img src="/apex-logo.png" alt="Apex Tools AI" class="w-8 h-8"> Apex Tools AI</a>
    <nav class="text-sm font-semibold flex items-center gap-5"><a href="${lang==='es'?'/es/':'/'}" class="text-navy-700 hover:text-accent-600">${lang==='es'?'Inicio':'Home'}</a><a href="${baseUrl}" class="text-accent-600">Blog</a><a href="${lang==='es'?'/es/#pricing':'/#pricing'}" class="text-navy-700 hover:text-accent-600">${lang==='es'?'Precios':'Pricing'}</a></nav>
  </div>
</header>
<section class="bg-gradient-to-b from-white to-navy-50/50 py-16 lg:py-20">
  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
    <h1 class="font-display text-4xl lg:text-5xl font-extrabold text-navy-900 mb-3">${escapeHtml(t.h1)}</h1>
    <p class="text-lg text-navy-600 max-w-2xl mx-auto">${escapeHtml(t.sub)}</p>
  </div>
</section>
<main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
  ${posts.length === 0 ? `<p class="text-center text-navy-500 py-20">${escapeHtml(t.empty)}</p>` : `<div class="grid md:grid-cols-2 lg:grid-cols-3 gap-6">${postCards}</div>${pagination}`}
</main>
<footer class="bg-navy-900 text-white/70 py-10 mt-20">
  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row gap-4 items-center justify-between text-sm">
    <div>© ${new Date().getFullYear()} Apex Tools AI</div>
    <div class="flex gap-5"><a href="/privacy.html" class="hover:text-white">Privacy</a><a href="/terms.html" class="hover:text-white">Terms</a><a href="${baseUrl}/rss.xml" class="hover:text-white">RSS</a></div>
  </div>
</footer>
<script src="/chatbot.js?v=20260519c" defer></script>
</body>
</html>`;

  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300, s-maxage=600' } });
}
