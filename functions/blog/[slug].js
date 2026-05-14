// SSR /blog/{slug} (and /es/blog/{slug}) — full post page with proper meta tags
import { renderMarkdown, escapeHtml, fmtDate } from '../_blog.js';

export async function onRequest(context) {
  const { env, params, request } = context;
  const slug = params.slug;
  const url = new URL(request.url);
  const lang = url.pathname.startsWith('/es') ? 'es' : 'en';

  const post = await env.DB.prepare(
    `SELECT id, title, slug, excerpt, content, cover_image_url, author_name, tag, status, language, seo_title, seo_description, canonical_url, published_at
     FROM blog_posts WHERE slug = ? AND COALESCE(language,'en') = ? AND status = 'published' LIMIT 1`
  ).bind(slug, lang).first().catch(() => null);

  if (!post) {
    return new Response('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Not found</title></head><body style="font-family:Inter,sans-serif;text-align:center;padding:80px 20px;"><h1>Post not found</h1><p><a href="' + (lang==='es'?'/es/blog':'/blog') + '">← Back to Blog</a></p></body></html>',
      { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }

  const baseUrl = `https://apextoolsai.com${lang === 'es' ? '/es' : ''}/blog`;
  const postUrl = `${baseUrl}/${escapeHtml(post.slug)}`;
  const canonical = post.canonical_url || postUrl;
  const altLang = lang === 'es' ? 'en' : 'es';
  const altPost = await env.DB.prepare(
    `SELECT slug FROM blog_posts WHERE COALESCE(language,'en') = ? AND status='published' AND (slug = ? OR slug LIKE ?) LIMIT 1`
  ).bind(altLang, post.slug, post.slug + '%').first().catch(() => null);
  const altUrl = altPost ? `https://apextoolsai.com${altLang === 'es' ? '/es' : ''}/blog/${altPost.slug}` : null;
  const seoTitle = (post.seo_title || `${post.title} · Apex Tools AI`).slice(0, 200);
  const seoDesc = (post.seo_description || post.excerpt || (post.content || '').replace(/[#*`_>\[\]]/g, '').slice(0, 160)).slice(0, 300);
  const ogImg = post.cover_image_url || 'https://apextoolsai.com/apex-logo.png';

  const ldJson = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    "headline": post.title,
    "image": post.cover_image_url || undefined,
    "datePublished": new Date(post.published_at).toISOString(),
    "dateModified": new Date(post.published_at).toISOString(),
    "author": { "@type": "Person", "name": post.author_name || "Apex Tools AI" },
    "publisher": { "@type": "Organization", "name": "Apex Tools AI", "logo": { "@type": "ImageObject", "url": "https://apextoolsai.com/apex-logo.png" } },
    "mainEntityOfPage": { "@type": "WebPage", "@id": postUrl },
    "description": seoDesc,
    "inLanguage": lang,
  };

  const html = `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(seoTitle)}</title>
<meta name="description" content="${escapeHtml(seoDesc)}">
<link rel="canonical" href="${canonical}">
<link rel="alternate" hreflang="${lang}" href="${postUrl}">
${altUrl ? `<link rel="alternate" hreflang="${altLang}" href="${altUrl}">` : ''}
<meta property="og:title" content="${escapeHtml(post.title)}">
<meta property="og:description" content="${escapeHtml(seoDesc)}">
<meta property="og:type" content="article">
<meta property="og:url" content="${postUrl}">
<meta property="og:image" content="${escapeHtml(ogImg)}">
<meta property="article:published_time" content="${new Date(post.published_at).toISOString()}">
<meta property="article:author" content="${escapeHtml(post.author_name || 'Apex Tools AI')}">
${post.tag ? `<meta property="article:tag" content="${escapeHtml(post.tag)}">` : ''}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(post.title)}">
<meta name="twitter:description" content="${escapeHtml(seoDesc)}">
<meta name="twitter:image" content="${escapeHtml(ogImg)}">
<link rel="icon" href="/apex-logo.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Plus+Jakarta+Sans:wght@600;700;800&display=swap" rel="stylesheet">
<script src="https://cdn.tailwindcss.com"></script>
<script>tailwind.config={theme:{extend:{fontFamily:{sans:['Inter','system-ui','sans-serif'],display:['Plus Jakarta Sans','sans-serif']},colors:{navy:{50:'#f0f4f9',100:'#dbe5f1',500:'#475569',600:'#1e3a5f',700:'#172a4a',900:'#0a1628'},accent:{50:'#fff7ed',400:'#fb923c',500:'#f97316',600:'#ea580c',700:'#c2410c'}}}}}</script>
<script type="application/ld+json">${JSON.stringify(ldJson)}</script>
<style>
.prose h1,.prose h2,.prose h3{font-family:'Plus Jakarta Sans',sans-serif;color:#0a1628;font-weight:800;margin-top:1.5em;margin-bottom:.5em;line-height:1.2}
.prose h1{font-size:2rem}.prose h2{font-size:1.6rem}.prose h3{font-size:1.3rem}
.prose p{color:#334155;line-height:1.7;margin:1em 0}
.prose ul,.prose ol{margin:1em 0;padding-left:1.5em;color:#334155}.prose li{margin:.4em 0;line-height:1.7}
.prose a{color:#ea580c;text-decoration:underline;font-weight:600}.prose a:hover{color:#c2410c}
.prose code{background:#f1f5f9;padding:2px 6px;border-radius:4px;font-size:.9em;font-family:ui-monospace,monospace}
.prose pre{background:#0a1628;color:#fff;padding:1em;border-radius:8px;overflow-x:auto;margin:1.5em 0}
.prose pre code{background:none;color:inherit;padding:0}
.prose blockquote{border-left:4px solid #f97316;padding-left:1em;margin:1.5em 0;color:#475569;font-style:italic}
.prose strong{color:#0a1628}
</style>
</head>
<body class="font-sans bg-white">
<header class="sticky top-0 z-50 bg-white/95 backdrop-blur-lg border-b border-navy-100">
  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between">
    <a href="${lang==='es'?'/es/':'/'}" class="flex items-center gap-2 font-display font-extrabold text-navy-900"><img src="/apex-logo.png" alt="Apex Tools AI" class="w-8 h-8"> Apex Tools AI</a>
    <nav class="text-sm font-semibold flex items-center gap-5"><a href="${lang==='es'?'/es/':'/'}" class="text-navy-700 hover:text-accent-600">${lang==='es'?'Inicio':'Home'}</a><a href="${baseUrl}" class="text-accent-600">Blog</a><a href="${lang==='es'?'/es/#pricing':'/#pricing'}" class="text-navy-700 hover:text-accent-600">${lang==='es'?'Precios':'Pricing'}</a></nav>
  </div>
</header>
<main class="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
  <a href="${baseUrl}" class="text-sm font-semibold text-navy-500 hover:text-accent-600 mb-6 inline-block">← ${lang==='es'?'Volver al blog':'Back to blog'}</a>
  ${post.tag ? `<span class="inline-block bg-accent-50 text-accent-700 text-xs font-semibold px-3 py-1 rounded-full mb-4">${escapeHtml(post.tag)}</span>` : ''}
  <h1 class="font-display text-4xl lg:text-5xl font-extrabold text-navy-900 leading-tight mb-4">${escapeHtml(post.title)}</h1>
  <div class="text-sm text-navy-500 mb-8">${escapeHtml(post.author_name || 'Apex Tools AI')} · ${fmtDate(post.published_at, lang)}</div>
  ${post.cover_image_url ? `<img src="${escapeHtml(post.cover_image_url)}" alt="${escapeHtml(post.title)}" class="w-full rounded-2xl mb-8 shadow-lg">` : ''}
  <article class="prose max-w-none">
    ${renderMarkdown(post.content || '')}
  </article>
  <div class="mt-12 pt-8 border-t border-navy-100">
    <div class="bg-gradient-to-br from-navy-900 to-navy-700 text-white rounded-2xl p-8 text-center">
      <h2 class="font-display text-2xl font-extrabold mb-2">${lang==='es' ? '¿Listo para nunca perder otra llamada?' : 'Ready to never miss another patient call?'}</h2>
      <p class="text-white/80 mb-5">${lang==='es' ? 'Bilingüe EN/ES · 24/7 · Live en 5 días.' : 'Bilingual EN/ES · 24/7 · Live in 5 days.'}</p>
      <a href="${lang==='es'?'/es/#pricing':'/#pricing'}" class="inline-block bg-accent-500 hover:bg-accent-600 text-white font-bold px-6 py-3 rounded-full transition-colors">${lang==='es'?'Ver precios':'See pricing'}</a>
    </div>
  </div>
</main>
<footer class="bg-navy-900 text-white/70 py-10 mt-20">
  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row gap-4 items-center justify-between text-sm">
    <div>© ${new Date().getFullYear()} Apex Tools AI</div>
    <div class="flex gap-5"><a href="/privacy.html" class="hover:text-white">Privacy</a><a href="/terms.html" class="hover:text-white">Terms</a><a href="${baseUrl}/rss.xml" class="hover:text-white">RSS</a></div>
  </div>
</footer>
<script src="/chatbot.js" defer></script>
</body>
</html>`;

  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300, s-maxage=600' } });
}
