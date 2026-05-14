// Minimal Markdown -> HTML renderer for blog posts. Safe-by-default escaping.
const esc = (s) => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

const inline = (txt) => {
  let s = esc(txt);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(?<![*\w])\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>');
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  return s;
};

export const renderMarkdown = (md) => {
  if (!md) return '';
  const lines = String(md).split(/\r?\n/);
  const out = [];
  let inList = null; // 'ul' | 'ol' | null
  let inCode = false; let codeBuf = [];
  let para = [];
  const flushPara = () => { if (para.length) { out.push('<p>' + inline(para.join(' ')) + '</p>'); para = []; } };
  const flushList = () => { if (inList) { out.push(`</${inList}>`); inList = null; } };
  for (const raw of lines) {
    const line = raw;
    if (/^```/.test(line)) {
      if (inCode) { out.push('<pre><code>' + esc(codeBuf.join('\n')) + '</code></pre>'); codeBuf = []; inCode = false; }
      else { flushPara(); flushList(); inCode = true; }
      continue;
    }
    if (inCode) { codeBuf.push(line); continue; }
    if (/^\s*$/.test(line)) { flushPara(); flushList(); continue; }
    const h = line.match(/^(#{1,6})\s+(.+)$/);
    if (h) { flushPara(); flushList(); const lvl = h[1].length; out.push(`<h${lvl}>${inline(h[2])}</h${lvl}>`); continue; }
    if (/^\s*[-*+]\s+/.test(line)) {
      flushPara(); if (inList !== 'ul') { flushList(); out.push('<ul>'); inList = 'ul'; }
      out.push('<li>' + inline(line.replace(/^\s*[-*+]\s+/, '')) + '</li>');
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      flushPara(); if (inList !== 'ol') { flushList(); out.push('<ol>'); inList = 'ol'; }
      out.push('<li>' + inline(line.replace(/^\s*\d+\.\s+/, '')) + '</li>');
      continue;
    }
    if (/^>\s?/.test(line)) {
      flushPara(); flushList(); out.push('<blockquote>' + inline(line.replace(/^>\s?/, '')) + '</blockquote>'); continue;
    }
    para.push(line);
  }
  flushPara(); flushList();
  if (inCode && codeBuf.length) out.push('<pre><code>' + esc(codeBuf.join('\n')) + '</code></pre>');
  return out.join('\n');
};

export const escapeHtml = esc;

export const fmtDate = (ts, lang = 'en') => {
  if (!ts) return '';
  return new Date(ts).toLocaleDateString(lang === 'es' ? 'es-US' : 'en-US', { year: 'numeric', month: 'long', day: 'numeric' });
};
