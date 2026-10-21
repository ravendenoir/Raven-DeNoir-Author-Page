// Builds the static Books, Series, book pages, the blog, sitemap.xml and robots.txt
// from data.json and content/posts/ (blog posts written in Blog Desk). Run automatically by .github/workflows/build-pages.yml whenever
// data.json changes. Never edits data.json, index.html or the admin.
import fs from 'node:fs';
import path from 'node:path';
import { md } from './md.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SITE = 'https://ravendenoir.com';
const AUTHOR = 'Raven DeNoir';
const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'data.json'), 'utf8'));
const catalog = (data.catalog || []).filter((b) => b && b.title);
const socials = data.socials || {};
const today = new Date().toISOString().slice(0, 10);
// Optional descriptions kept outside the admin, in content/descriptions.json
const descPath = path.join(ROOT, 'content', 'descriptions.json');
const DESC = fs.existsSync(descPath) ? JSON.parse(fs.readFileSync(descPath, 'utf8')) : {};
const bookDesc = (DESC.books) || {};
const seriesDesc = (DESC.series) || {};
const paras = (t) => String(t || '').split(/\n+/).map((x) => x.trim()).filter(Boolean).map((x) => `<p>${esc(x)}</p>`).join('');
const snippet = (t, n = 155) => { t = String(t || '').replace(/\s+/g, ' ').trim(); if (t.length <= n) return t; t = t.slice(0, n); return t.slice(0, t.lastIndexOf(' ')).replace(/[,;:\-–—]+$/, '') + '…'; };

// ---------- helpers ----------
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const slugify = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/&/g, ' and ').replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'book';
const isoDate = (d) => {
  d = String(d || '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10);
  const us = d.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (us) return `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
  return '';
};
const fmtDate = (d) => (d ? new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '');
const isSeries = (s) => s && !/^standalone$/i.test(s.trim());
const write = (rel, content) => {
  const f = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, content);
};
const amazonHref = (u) => (/^https?:\/\//i.test(u || '') ? u : '');

// ---------- books (stable, unique slugs) ----------
const used = new Set();
const books = catalog.map((b) => {
  let slug = slugify(b.title);
  if (used.has(slug)) slug = slugify(b.title + ' ' + (b.series || ''));
  let n = 2;
  while (used.has(slug)) slug = slugify(b.title) + '-' + n++;
  used.add(slug);
  const date = isoDate(b.publishDate);
  const series = (b.series || '').trim();
  const order = Number(b.seriesOrder) || null;
  return {
    ...b, slug, date, series, order,
    released: !date || date <= today,
    url: `/books/${slug}/`,
    seriesSlug: isSeries(series) ? slugify(series) : '',
    description: b.synopsis || b.description || (bookDesc[b.id] && bookDesc[b.id].description) || ''
  };
});

// covers stored inline (data: URLs) are written out as files so pages stay small
for (const b of books) {
  const m = /^data:image\/(png|jpe?g|webp);base64,(.+)$/i.exec(b.coverUrl || '');
  if (m) {
    const ext = m[1].toLowerCase().replace('jpeg', 'jpg');
    write(`books/${b.slug}/cover.${ext}`, Buffer.from(m[2], 'base64'));
    b.cover = `/books/${b.slug}/cover.${ext}`;
  } else b.cover = b.coverUrl || '';
}

const seriesMap = new Map();
for (const b of books) {
  if (!b.seriesSlug) continue;
  if (!seriesMap.has(b.seriesSlug)) seriesMap.set(b.seriesSlug, { name: b.series, slug: b.seriesSlug, books: [] });
  seriesMap.get(b.seriesSlug).books.push(b);
}
const readingOrder = (a, b) => (a.order ?? 999) - (b.order ?? 999) || (a.date || '').localeCompare(b.date || '') || a.title.localeCompare(b.title);
const seriesList = [...seriesMap.values()]
  .map((s) => ({ ...s, books: s.books.sort(readingOrder), url: `/series/${s.slug}/` }))
  .sort((a, b) => b.books.length - a.books.length || a.name.localeCompare(b.name));

// ---------- blog posts (written in Blog Desk, saved as content/posts/<slug>.json) ----------
// A post goes live once its date arrives, so a future date schedules it (the daily build publishes it).
const POSTS_DIR = path.join(ROOT, 'content/posts');
const localUrl = (u) => (u || '').startsWith(SITE) ? u.slice(SITE.length) : (u || '');
const posts = (fs.existsSync(POSTS_DIR) ? fs.readdirSync(POSTS_DIR) : []).filter((f) => f.endsWith('.json')).map((f) => {
  try { const p = JSON.parse(fs.readFileSync(path.join(POSTS_DIR, f), 'utf8')); return { ...p, slug: slugify(p.slug || f.replace(/\.json$/, '')), date: isoDate(p.date) || today }; } catch (e) { console.warn('Skipping bad post ' + f + ': ' + e.message); return null; }
}).filter((p) => p && p.title && p.status !== 'draft' && p.date <= today)
  .sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title))
  .map((p) => ({ ...p, url: `/blog/${p.slug}/`, cover: localUrl(p.cover), excerpt: p.excerpt || snippet(String(p.body || '').replace(/[#>*_\[\]()!-]/g, ' '), 160) }));
const absUrl = (u) => (/^https?:/.test(u || '') ? u : SITE + (u || ''));

const metaLine = (b) => (b.seriesSlug ? `${b.series}${b.order ? ', Book ' + b.order : ''}` : 'Standalone');

// ---------- shared layout ----------
const CSS = `:root{--bg:#080808;--bg2:#0f0f0f;--bg3:#161616;--gold:#c9a535;--gold-l:#e8c55a;--text:#e8e0d0;--dim:#b5ad9f;--border:#222;--border2:#3a3a3a;--pink:#ff6fbc;--blue:#4fd0f5}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--text);font-family:'Montserrat',sans-serif;font-size:15px;line-height:1.65}
a{color:inherit;text-decoration:none}a:hover{color:var(--gold-l)}
img{display:block;max-width:100%}
.nav{background:var(--bg2);border-bottom:1px solid var(--border);position:sticky;top:0;z-index:50}
.nav-in{max-width:1160px;margin:0 auto;padding:0 20px;min-height:56px;display:flex;align-items:center;gap:20px;flex-wrap:wrap}
.brand{font-family:'Cormorant Garamond',serif;font-size:21px;font-weight:600;color:var(--gold);letter-spacing:.04em;white-space:nowrap}
.nav-links{display:flex;gap:2px;overflow-x:auto;flex:1;min-width:0}
.nav-join{flex-shrink:0;margin-left:auto;padding:8px 14px;border:1px solid var(--gold);border-radius:4px;color:var(--gold);font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;white-space:nowrap}.nav-join:hover{background:var(--gold);color:#000}
@media(max-width:640px){.nav-links{order:3;flex:1 1 100%}.brand{font-size:18px}}
.nav-link{padding:10px 12px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--dim);white-space:nowrap}
.nav-link[aria-current]{color:var(--text);box-shadow:inset 0 -2px 0 var(--gold)}
.wrap{max-width:1160px;margin:0 auto;padding:40px 20px 64px}
.crumbs{font-size:12px;color:var(--dim);margin-bottom:14px}.crumbs a{color:var(--dim)}
h1{font-family:'Cormorant Garamond',serif;font-weight:600;font-size:clamp(34px,6vw,52px);line-height:1.05;color:var(--gold);margin-bottom:12px}
h2{font-family:'Cormorant Garamond',serif;font-weight:600;font-size:28px;color:var(--gold)}
.lede{max-width:720px;color:#ddd5c6;margin-bottom:28px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:28px 20px}
.card{display:flex;flex-direction:column;gap:7px}
.cover{width:100%;aspect-ratio:2/3;object-fit:cover;border-radius:4px;border:1px solid var(--border);background:var(--bg3)}
.card h3{font-size:14px;font-weight:700;line-height:1.3}
.meta{font-size:12px;color:var(--dim)}
.badges{display:flex;flex-wrap:wrap;gap:6px;min-height:20px}
.badge{padding:2px 7px;border-radius:3px;font-size:10px;font-weight:800;letter-spacing:.05em;text-transform:uppercase}
.b-soon{color:var(--pink);background:rgba(233,30,140,.14)}.b-top{color:#080808;background:var(--gold)}.b-ku{color:var(--blue);background:rgba(0,180,230,.12)}
.btn{display:inline-block;padding:12px 22px;border-radius:4px;font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}
.btn-gold{background:var(--gold);color:#080808}.btn-gold:hover{background:var(--gold-l);color:#080808}
.btn-line{border:1px solid var(--border2)}
.filters{display:flex;flex-wrap:wrap;gap:14px;align-items:flex-end;padding:16px;background:var(--bg2);border:1px solid var(--border);border-radius:6px;margin-bottom:14px}
.filters label{display:flex;flex-direction:column;gap:6px;font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--dim);flex:1 1 200px}
.filters input,.filters select{height:44px;padding:0 12px;background:var(--bg);border:1px solid var(--border2);border-radius:4px;color:var(--text);font:15px 'Montserrat',sans-serif}
.chips{display:flex;flex-wrap:wrap;gap:8px;flex:1 1 100%}
.chip{min-height:44px;padding:0 16px;border-radius:22px;border:1px solid var(--border2);background:transparent;color:var(--text);font:700 13px 'Montserrat',sans-serif;cursor:pointer}
.chip[aria-pressed=true]{background:var(--gold);border-color:var(--gold);color:#080808}
.count{font-size:13px;color:var(--dim);margin-bottom:20px}
.group{margin-bottom:40px}.group-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 16px;padding-bottom:10px;border-bottom:1px solid #2a2a2a;margin-bottom:18px}
.group-head a.more{margin-left:auto;font-size:13px;font-weight:700;color:var(--gold-l)}
.book{display:flex;flex-wrap:wrap;gap:40px;align-items:flex-start}
.book .cover{flex:0 1 300px;width:300px;max-width:100%}
.book-info{flex:1 1 380px;min-width:0;display:flex;flex-direction:column;gap:14px}
.facts{display:grid;grid-template-columns:max-content 1fr;gap:6px 18px;font-size:14px}.facts dt{color:var(--dim)}
.order{list-style:none;display:flex;flex-wrap:wrap;justify-content:center;gap:24px 18px}
.order li{display:flex;flex-direction:column;gap:6px;min-width:0;width:150px}
.order .cv{position:relative;display:block}
.order img{width:100%;aspect-ratio:2/3;object-fit:cover;border-radius:4px;border:1px solid var(--border);background:var(--bg3)}
.num{position:absolute;top:6px;left:6px;min-width:28px;height:28px;padding:0 6px;border-radius:14px;background:rgba(8,8,8,.85);border:1px solid var(--gold);color:var(--gold);font-size:13px;font-weight:800;display:flex;align-items:center;justify-content:center}
.order h3{font-size:13px;font-weight:700;line-height:1.3}
.order .meta{font-size:11px}
@media(max-width:640px){.grid{grid-template-columns:repeat(3,minmax(0,1fr));gap:20px 10px}.card h3{font-size:12px}.card .meta{font-size:11px}.card .badge{font-size:9px;padding:2px 5px}.group{margin-bottom:28px}.order{gap:18px 10px}.order li{width:calc((100% - 20px) / 3)}.order h3{font-size:12px}.order .badge{font-size:9px;padding:2px 5px}.wrap{padding-top:24px}.synopsis{font-size:15px}}
.footer{background:var(--bg2);border-top:1px solid var(--border);padding:36px 20px;text-align:center;display:flex;flex-direction:column;gap:12px;align-items:center}
.footer nav{display:flex;flex-wrap:wrap;justify-content:center;gap:4px 18px;font-size:13px}
.footer .soc a{color:var(--dim)}
.copy{font-size:12px;color:#9a9284}
.synopsis{max-width:720px;color:#ddd5c6;font-size:16px;line-height:1.75}.synopsis p{margin-bottom:12px}
[hidden]{display:none!important}
.post-list{display:flex;flex-wrap:wrap;justify-content:center;gap:24px;margin-top:8px}
.post-card{flex:0 1 340px;display:flex;flex-direction:column;background:var(--bg2);border:1px solid var(--border);border-radius:6px;overflow:hidden;transition:border-color .2s,transform .2s}
.post-card:hover{border-color:var(--gold);transform:translateY(-2px);color:inherit}
.pc-img{display:block;aspect-ratio:16/9;overflow:hidden;background:var(--bg3)}.pc-img img{width:100%;height:100%;object-fit:cover}
.pc-body{display:flex;flex-direction:column;gap:8px;padding:18px 20px 20px;flex:1}
.pc-date{font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--dim)}
.pc-title{font-family:'Cormorant Garamond',serif;font-size:24px;font-weight:600;line-height:1.15;color:var(--gold)}
.pc-ex{font-size:14px;color:#ddd5c6;flex:1}.pc-more{font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--gold-l)}
.blog-empty{max-width:560px;margin:24px auto 0;text-align:center;border:1px dashed var(--border2);border-radius:6px;padding:32px 24px;color:var(--dim)}
.blog-empty p{margin-bottom:18px}
.post article,.post .crumbs,.post-book,.post-news{max-width:720px;margin-left:auto;margin-right:auto}
.post-date{font-size:12px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--dim);margin-bottom:6px}
.post-cover{max-width:100%;max-height:560px;width:auto;margin:18px auto 8px;border-radius:4px;border:1px solid var(--border)}
.post-body{font-size:17px;line-height:1.75;color:#ddd5c6;margin-top:22px}
.post-body p,.post-body ul,.post-body ol,.post-body blockquote,.post-body figure{margin-bottom:.9em}
.post-body h2{font-size:clamp(26px,4vw,32px);margin:1.5em 0 .45em;line-height:1.2}
.post-body h2::after{content:'';display:block;width:44px;height:2px;background:var(--gold);opacity:.6;margin-top:10px}
.post-body h3{font-family:'Cormorant Garamond',serif;font-size:23px;color:var(--gold);margin:1.3em 0 .35em}
.post-body>h2:first-child,.post-body>h3:first-child{margin-top:.4em}
.post-body ul,.post-body ol{padding-left:1.4em}.post-body li{margin-bottom:.35em}
.post-body a{color:var(--gold-l);text-decoration:underline}
.post-body blockquote{border-left:2px solid var(--gold);padding:4px 0 4px 20px;font-family:'Cormorant Garamond',serif;font-style:italic;font-size:22px;color:var(--gold-l)}
.post-body img{max-width:100%;height:auto;border-radius:4px;margin:0 auto}
.post-body figcaption{text-align:center;font-size:13px;color:var(--dim);margin-top:8px}
.post-body hr{border:0;text-align:center;margin:1.4em 0}.post-body hr::after{content:'✦';color:var(--gold);opacity:.7}
.post-cta{margin:1.1em 0 1.3em}.post-body .post-cta a{display:inline-block;padding:11px 22px;border:1px solid var(--gold);border-radius:4px;color:var(--gold);font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;text-decoration:none}
.post-body .post-cta a:hover{background:var(--gold);color:#080808}
.post-book{margin-top:48px;display:flex;gap:24px;align-items:center;background:var(--bg2);border:1px solid var(--border);border-radius:6px;padding:22px}
.post-book img{width:120px;height:auto;border-radius:3px;border:1px solid var(--border)}
.post-book h2{font-size:26px;margin:2px 0 4px}.post-book .meta{margin-bottom:14px}
.label{font-size:11px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:var(--dim)}
.post-news{margin-top:36px;padding-top:22px;border-top:1px solid var(--border);color:var(--dim)}.post-news a{color:var(--gold-l);font-weight:700}
.post-more{margin-top:64px}.post-more h2{text-align:center;margin-bottom:10px}
.pager{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-top:40px;padding-top:20px;border-top:1px solid var(--border);font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}.pager a{color:var(--gold)}.pager-n{color:var(--dim)}
@media(max-width:640px){.post-list .post-card{flex-basis:100%}.post-book{flex-direction:column;text-align:center}.post-body{font-size:16px}}`;

const SOCIAL_LABELS = { amazon: 'Amazon', patreon: 'Patreon', tiktok: 'TikTok', instagram: 'Instagram', facebook: 'Facebook', discord: 'Discord', goodreads: 'Goodreads' };
const sameAs = Object.keys(SOCIAL_LABELS).map((k) => socials[k]).filter((u) => /^https?:\/\//.test(u || ''));
const latestNewsletter = data.latestNewsletter || socials.newsletter || '';
// The working sign-up link is the "Newsletter Sign-up" button under Raven's photo; use it everywhere.
const signupCta = (data.ctaButtons || []).find((c) => c && /^https?:/i.test(c.url || '') && /sign.?up|join/i.test(c.label || '') && !/previous/i.test(c.label || ''));
const newsletterUrl = (signupCta && signupCta.url) || socials.newsletter || '';

const page = ({ title, description, canonical, current, body, jsonld = [], image = '', type = 'website', noindex = false }) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${SITE}${canonical}">${noindex ? '\n<meta name="robots" content="noindex">' : ''}
<meta property="og:type" content="${type}">
<meta property="og:site_name" content="${AUTHOR}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${SITE}${canonical}">
<meta property="og:image" content="${esc(image ? absUrl(image) : SITE + '/PageIcon.png')}">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/PageIcon.png">${posts.length ? `\n<link rel="alternate" type="application/rss+xml" title="Raven DeNoir Blog" href="${SITE}/blog/feed.xml">` : ''}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;600&family=Montserrat:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>${CSS}</style>
${jsonld.map((j) => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, '\\u003c')}</script>`).join('\n')}
</head>
<body>
<header class="nav"><div class="nav-in">
<a class="brand" href="/">RAVEN DENOIR</a>
<nav class="nav-links" aria-label="Main">
<a class="nav-link" href="/">Home</a>
<a class="nav-link" href="/books/"${current === 'books' ? ' aria-current="page"' : ''}>Books</a>
<a class="nav-link" href="/books/#all-series"${current === 'series' ? ' aria-current="page"' : ''}>Series</a>
<a class="nav-link" href="/blog/"${current === 'blog' ? ' aria-current="page"' : ''}>Blog</a>
<a class="nav-link" href="/#reviews">Reviews</a>
</nav>
</div></header>
${body}
<footer class="footer">
<a class="brand" href="/">Raven DeNoir</a>
<nav aria-label="Footer"><a href="/">Home</a><a href="/books/">All Books</a><a href="/blog/">Blog</a>${latestNewsletter ? `<a href="${esc(latestNewsletter)}">Latest Newsletter</a>` : ''}</nav>
<nav class="soc" aria-label="Social">${Object.keys(SOCIAL_LABELS).filter((k) => socials[k]).map((k) => `<a href="${esc(socials[k])}" target="_blank" rel="noopener">${SOCIAL_LABELS[k]}</a>`).join('')}</nav>
<div class="copy">© ${new Date().getFullYear()} Raven DeNoir. All rights reserved.</div>
</footer>
</body>
</html>
`;

const person = { '@type': 'Person', name: AUTHOR, url: SITE + '/', ...(sameAs.length ? { sameAs } : {}) };

const badges = (b) => [
  !b.released ? `<span class="badge b-soon">Coming ${esc(fmtDate(b.date).replace(/, \d{4}$/, ''))}</span>` : '',
  b.isTopSeller ? '<span class="badge b-top">Top Seller</span>' : '',
  b.isKuFave ? '<span class="badge b-ku">KU Favorite</span>' : ''
].join('');

const card = (b) => `<article class="card" data-title="${esc((b.title + ' ' + b.series).toLowerCase())}" data-series="${esc(b.series)}" data-soon="${b.released ? 0 : 1}" data-top="${b.isTopSeller ? 1 : 0}" data-ku="${b.isKuFave ? 1 : 0}" data-date="${esc(b.date)}">
<a href="${b.url}"><img class="cover" src="${esc(b.cover)}" alt="${esc(b.title)} by Raven DeNoir, book cover" loading="lazy" width="300" height="450"></a>
<div class="badges">${badges(b)}</div>
<h3><a href="${b.url}">${esc(b.title)}</a></h3>
<p class="meta">${esc(metaLine(b))}</p>
<p class="meta">${b.date ? (b.released ? 'Published ' : 'Releases ') + esc(fmtDate(b.date)) : ''}</p>
</article>`;

// ---------- /books/ ----------
const standalones = books.filter((b) => !b.seriesSlug).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
const groupsHtml = seriesList.map((s) => `<section class="group" data-group>
<div class="group-head"><h2>${esc(s.name)}</h2><span class="meta">${s.books.length} ${s.books.length === 1 ? 'book' : 'books'}</span><a class="more" href="${s.url}">${esc(s.name)} reading order</a></div>
<div class="grid">${s.books.map(card).join('\n')}</div>
</section>`).join('\n') + (standalones.length ? `<section class="group" data-group>
<div class="group-head"><h2>Standalones</h2><span class="meta">${standalones.length} ${standalones.length === 1 ? 'book' : 'books'}</span></div>
<div class="grid">${standalones.map(card).join('\n')}</div>
</section>` : '');

const seriesOptions = seriesList.map((s) => `<option value="${esc(s.name)}">${esc(s.name)} (${s.books.length})</option>`).join('') + (standalones.length ? `<option value="__standalone">Standalones (${standalones.length})</option>` : '');

const booksBody = `<main class="wrap">
<p class="crumbs"><a href="/">Home</a> / Books</p>
<h1>Books by Raven DeNoir</h1>
<p class="lede">All ${books.length} Raven DeNoir books in one place: BWWM dark mafia romance, contemporary romance, shifter paranormal romance and erotic romance, grouped by series in reading order.</p>
<div class="filters" role="search">
<label>Search titles or series<input id="q" type="search" placeholder="e.g. Dark Vows" autocomplete="off"></label>
<label>Series<select id="series"><option value="">All series</option>${seriesOptions}</select></label>
<div class="chips" role="group" aria-label="Show">
<button type="button" class="chip" data-f="all" aria-pressed="true">All</button>
<button type="button" class="chip" data-f="now" aria-pressed="false">Available now</button>
<button type="button" class="chip" data-f="soon" aria-pressed="false">Coming soon</button>
<button type="button" class="chip" data-f="top" aria-pressed="false">Top Sellers</button>
<button type="button" class="chip" data-f="ku" aria-pressed="false">KU Favorites</button>
</div>
</div>
<p class="count" id="count" aria-live="polite">Showing all ${books.length} books</p>
<div id="all-series">${groupsHtml}</div>
<p id="none" class="count" hidden>No books match. Clear the search or pick another series.</p>
</main>
<script>
(function(){var q=document.getElementById('q'),s=document.getElementById('series'),c=document.getElementById('count'),none=document.getElementById('none'),f='all';
var cards=[].slice.call(document.querySelectorAll('.card')),total=cards.length;
function run(){var t=q.value.trim().toLowerCase(),sv=s.value,n=0;
cards.forEach(function(el){var d=el.dataset,ok=(!t||d.title.indexOf(t)>-1)&&(!sv||(sv==='__standalone'?el.closest('[data-group]').querySelector('h2').textContent==='Standalones':d.series===sv))&&(f==='all'||(f==='now'&&d.soon==='0')||(f==='soon'&&d.soon==='1')||(f==='top'&&d.top==='1')||(f==='ku'&&d.ku==='1'));el.hidden=!ok;if(ok)n++;});
[].forEach.call(document.querySelectorAll('[data-group]'),function(g){g.hidden=!g.querySelector('.card:not([hidden])');});
c.textContent=n===total?'Showing all '+total+' books':'Showing '+n+' of '+total+' books';none.hidden=n>0;}
q.addEventListener('input',run);s.addEventListener('change',run);
[].forEach.call(document.querySelectorAll('.chip'),function(b){b.addEventListener('click',function(){f=b.dataset.f;[].forEach.call(document.querySelectorAll('.chip'),function(x){x.setAttribute('aria-pressed',x===b?'true':'false');});run();});});
var p=new URLSearchParams(location.search);if(p.get('series')){s.value=p.get('series');run();}})();
</script>`;

write('books/index.html', page({
  title: 'Books by Raven DeNoir | Complete Catalog and Series Reading Order',
  description: `Browse all ${books.length} romance novels by Raven DeNoir, including Vows & Vengeance, So, About Last Night and The Ache. Series reading order, new releases and preorders.`,
  canonical: '/books/', current: 'books', body: booksBody,
  jsonld: [{ '@context': 'https://schema.org', '@type': 'CollectionPage', name: 'Books by Raven DeNoir', url: SITE + '/books/', author: person,
    mainEntity: { '@type': 'ItemList', numberOfItems: books.length, itemListElement: books.map((b, i) => ({ '@type': 'ListItem', position: i + 1, url: SITE + b.url, name: b.title })) } }]
}));

// ---------- /series/<slug>/ ----------
for (const s of seriesList) {
  const released = s.books.filter((b) => b.released).length;
  const first = s.books.find((b) => b.order === 1) || s.books[0];
  const body = `<main class="wrap">
<p class="crumbs"><a href="/">Home</a> / <a href="/books/">Books</a> / ${esc(s.name)}</p>
<h1>${esc(s.name)}</h1>
<p class="lede">The ${esc(s.name)} series by Raven DeNoir: ${s.books.length} ${s.books.length === 1 ? 'book' : 'books'} in reading order${released < s.books.length ? `, ${s.books.length - released} coming soon` : ''}.${first ? ` Start with <a href="${first.url}" style="color:var(--gold-l)">${esc(first.title)}</a>.` : ''}</p>
${seriesDesc[s.name] ? `<div class="synopsis" style="margin-bottom:28px">${paras(seriesDesc[s.name])}</div>` : ''}
<ol class="order">
${s.books.map((b) => `<li><a class="cv" href="${b.url}"><img src="${esc(b.cover)}" alt="${esc(b.title)} cover" loading="lazy" width="200" height="300">${b.order ? `<span class="num" aria-label="Book ${b.order}">${b.order}</span>` : ''}</a><h3><a href="${b.url}">${esc(b.title)}</a></h3>${b.released ? `<p class="meta">${esc(fmtDate(b.date).replace(/^(\w+) \d+, /, '$1 '))}</p>` : `<div class="badges">${badges(b)}</div>`}</li>`).join('\n')}
</ol>
</main>`;
  write(`series/${s.slug}/index.html`, page({
    title: `${s.name} Series Reading Order | Raven DeNoir`,
    description: seriesDesc[s.name] ? snippet(`${s.name} reading order: ${seriesDesc[s.name]}`) : `All ${s.books.length} books in the ${s.name} series by Raven DeNoir, in reading order${first ? `, starting with ${first.title}` : ''}.`,
    canonical: s.url, current: 'series', body, image: first?.cover,
    jsonld: [{ '@context': 'https://schema.org', '@type': 'BookSeries', name: s.name, url: SITE + s.url, author: person,
      hasPart: s.books.map((b) => ({ '@type': 'Book', name: b.title, url: SITE + b.url, ...(b.order ? { position: b.order } : {}) })) }]
  }));
}

// ---------- /books/<slug>/ ----------
for (const b of books) {
  const s = b.seriesSlug ? seriesList.find((x) => x.slug === b.seriesSlug) : null;
  const idx = s ? s.books.indexOf(b) : -1;
  const prev = idx > 0 ? s.books[idx - 1] : null;
  const next = s && idx < s.books.length - 1 ? s.books[idx + 1] : null;
  const buy = amazonHref(b.amazonUrl);
  const body = `<main class="wrap">
<p class="crumbs"><a href="/">Home</a> / <a href="/books/">Books</a>${s ? ` / <a href="${s.url}">${esc(s.name)}</a>` : ''} / ${esc(b.title)}</p>
<div class="book">
<img class="cover" src="${esc(b.cover)}" alt="${esc(b.title)} by Raven DeNoir, book cover" width="300" height="450">
<div class="book-info">
<div class="badges">${badges(b)}</div>
<h1>${esc(b.title)}</h1>
<p class="meta" style="font-size:15px">by <a href="/" style="color:var(--text)">Raven DeNoir</a>${s ? ` · <a href="${s.url}" style="color:var(--gold-l)">${esc(s.name)}${b.order ? ', Book ' + b.order : ''}</a>` : ''}</p>
${b.description ? `<div class="synopsis">${paras(b.description)}</div>` : ''}
<dl class="facts">
${s ? `<dt>Series</dt><dd><a href="${s.url}">${esc(s.name)}</a>${b.order ? ', Book ' + b.order : ''}</dd>` : '<dt>Series</dt><dd>Standalone</dd>'}
${b.date ? `<dt>${b.released ? 'Published' : 'Release date'}</dt><dd>${esc(fmtDate(b.date))}</dd>` : ''}
</dl>
${buy ? `<p><a class="btn btn-gold" href="${esc(buy)}" target="_blank" rel="noopener">${b.released ? 'Buy on Amazon' : 'Preorder on Amazon'}</a></p>` : ''}
${s && (prev || next) ? `<p class="meta" style="display:flex;flex-wrap:wrap;gap:8px 24px">${prev ? `<a href="${prev.url}">← ${esc(prev.title)}</a>` : ''}${next ? `<a href="${next.url}">${esc(next.title)} →</a>` : ''}</p>` : ''}
</div>
</div>
</main>`;
  const series = s ? { isPartOf: { '@type': 'BookSeries', name: s.name, url: SITE + s.url }, ...(b.order ? { position: b.order } : {}) } : {};
  write(`books/${b.slug}/index.html`, page({
    title: `${b.title}${s ? ` (${s.name}${b.order ? ' Book ' + b.order : ''})` : ''} by Raven DeNoir`,
    description: b.description ? snippet(b.description) : `${b.title} by Raven DeNoir${s ? `, ${s.name}${b.order ? ' Book ' + b.order : ''}` : ''}. ${b.released ? 'Available now' : 'Coming ' + fmtDate(b.date)} on Amazon.`,
    canonical: b.url, current: 'books', body, image: b.cover,
    jsonld: [{ '@context': 'https://schema.org', '@type': 'Book', name: b.title, url: SITE + b.url, author: person,
      ...(b.cover && /^https?:/.test(b.cover) ? { image: b.cover } : {}),
      ...(b.date && b.released ? { datePublished: b.date } : {}),
      ...(/2nd edition|second edition/i.test(b.title) ? { bookEdition: 'Second Edition' } : {}),
      ...(b.description ? { description: snippet(b.description, 300) } : {}),
      ...(buy ? { sameAs: buy } : {}), ...series }]
  }));
}

// ---------- /blog/ ----------
const norm = (t) => String(t).replace(/[*#_\s]+/g, ' ').trim().toLowerCase();
const dropTitle = (body, title) => { const parts = String(body || '').replace(/\r\n?/g, '\n').split(/\n{2,}/); return parts.length > 1 && norm(parts[0]) === norm(title) ? parts.slice(1).join('\n\n') : body; };
const postCard = (p) => `<a class="post-card" href="${p.url}">${p.cover ? `<span class="pc-img"><img src="${esc(p.cover)}" alt="" loading="lazy"></span>` : ''}<span class="pc-body"><span class="pc-date">${esc(fmtDate(p.date))}</span><span class="pc-title">${esc(p.title)}</span><span class="pc-ex">${esc(p.excerpt)}</span><span class="pc-more">Read more →</span></span></a>`;
const blogEmpty = `<div class="blog-empty"><p>The first post is on its way: release news, behind-the-book notes and the men who don't play fair.</p>${newsletterUrl ? `<a class="btn btn-gold" href="${esc(newsletterUrl)}" target="_blank" rel="noopener">Get it in your inbox</a>` : ''}</div>`;
fs.rmSync(path.join(ROOT, 'blog'), { recursive: true, force: true });
// The blog page shows 3 posts at a time, newest first; older posts move to /blog/page/2/, /blog/page/3/ …
const PER_PAGE = 3;
const blogPages = Math.max(1, Math.ceil(posts.length / PER_PAGE));
for (let n = 1; n <= blogPages; n++) {
  const url = n === 1 ? '/blog/' : `/blog/page/${n}/`;
  const slice = posts.slice((n - 1) * PER_PAGE, n * PER_PAGE);
  const pager = blogPages > 1 ? `<nav class="pager" aria-label="More posts">${n > 1 ? `<a href="${n === 2 ? '/blog/' : `/blog/page/${n - 1}/`}">← Newer posts</a>` : '<span></span>'}<span class="pager-n">Page ${n} of ${blogPages}</span>${n < blogPages ? `<a href="/blog/page/${n + 1}/">Older posts →</a>` : '<span></span>'}</nav>` : '';
  write(url.slice(1) + 'index.html', page({
    title: n === 1 ? 'Blog | Raven DeNoir' : `Blog, page ${n} | Raven DeNoir`,
    description: 'Release news, behind-the-book notes and updates from Raven DeNoir, author of BWWM dark mafia and dark romance.',
    canonical: url, current: 'blog', noindex: !posts.length, image: slice.find((p) => p.cover)?.cover,
    jsonld: [{ '@context': 'https://schema.org', '@type': 'Blog', name: 'Raven DeNoir Blog', url: SITE + '/blog/', author: person, blogPost: slice.map((p) => ({ '@type': 'BlogPosting', headline: p.title, url: SITE + p.url, datePublished: p.date })) }],
    body: `<main class="wrap">
<p class="crumbs"><a href="/">Home</a> / ${n === 1 ? 'Blog' : `<a href="/blog/">Blog</a> / Page ${n}`}</p>
<h1>From the Blog</h1>
${n === 1 ? '<p class="lede">Release news, behind-the-book notes and updates from the House of DeNoir.</p>' : ''}
${slice.length ? `<div class="post-list">${slice.map(postCard).join('')}</div>` : blogEmpty}
${pager}
</main>`
  }));
}
for (const p of posts) {
  const book = p.bookId ? books.find((b) => b.id === p.bookId) : null;
  const more = posts.filter((x) => x !== p).slice(0, 2);
  const buy = book ? amazonHref(book.amazonUrl) : '';
  write(`blog/${p.slug}/index.html`, page({
    title: `${p.title} | Raven DeNoir`, description: snippet(p.excerpt), canonical: p.url, current: 'blog', type: 'article', image: p.cover || book?.cover,
    jsonld: [{ '@context': 'https://schema.org', '@type': 'BlogPosting', headline: p.title, url: SITE + p.url, datePublished: p.date, ...(p.updated ? { dateModified: isoDate(p.updated) } : {}),
      description: snippet(p.excerpt, 300), author: person, publisher: person, ...(p.cover ? { image: absUrl(p.cover) } : {}), mainEntityOfPage: SITE + p.url }],
    body: `<main class="wrap post">
<p class="crumbs"><a href="/">Home</a> / <a href="/blog/">Blog</a> / ${esc(p.title)}</p>
<article>
<p class="post-date"><time datetime="${p.date}">${esc(fmtDate(p.date))}</time></p>
<h1>${esc(p.title)}</h1>
${p.cover ? `<img class="post-cover" src="${esc(p.cover)}" alt="${esc(p.coverAlt || p.title)}">` : ''}
<div class="post-body">${md(dropTitle(p.body, p.title))}</div>
</article>
${book ? `<aside class="post-book"><a href="${book.url}"><img src="${esc(book.cover)}" alt="${esc(book.title)} by Raven DeNoir, book cover" width="300" height="450"></a><div><p class="label">The Book</p><h2><a href="${book.url}">${esc(book.title)}</a></h2><p class="meta">${esc(metaLine(book))} · ${book.released ? 'Available now' : 'Coming ' + esc(fmtDate(book.date))}</p>${buy ? `<a class="btn btn-gold" href="${esc(buy)}" target="_blank" rel="noopener">${book.released ? 'Read on Amazon' : 'Preorder on Amazon'}</a>` : ''}</div></aside>` : ''}
${newsletterUrl ? `<p class="post-news">Want the next one in your inbox? <a href="${esc(newsletterUrl)}" target="_blank" rel="noopener">Join the newsletter →</a></p>` : ''}
${more.length ? `<section class="post-more"><h2>More from the Blog</h2><div class="post-list">${more.map(postCard).join('')}</div></section>` : ''}
</main>`
  }));
}
// latest posts for the homepage's blog column
write('blog/index.json', JSON.stringify({ posts: posts.slice(0, 3).map((p) => ({ title: p.title, url: p.url, date: p.date, dateLabel: fmtDate(p.date), excerpt: snippet(p.excerpt, 110), cover: p.cover })), total: posts.length }));
if (posts.length) {
  const x = (t) => esc(t);
  write('blog/feed.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>Raven DeNoir Blog</title><link>${SITE}/blog/</link><description>Release news and behind-the-book notes from Raven DeNoir</description>\n${posts.slice(0, 20).map((p) => `<item><title>${x(p.title)}</title><link>${SITE}${p.url}</link><guid>${SITE}${p.url}</guid><pubDate>${new Date(p.date + 'T12:00:00Z').toUTCString()}</pubDate><description>${x(p.excerpt)}</description></item>`).join('\n')}\n</channel></rss>\n`);
}

// ---------- remove pages for books/series no longer in data.json ----------
for (const dir of ['books', 'series']) {
  const keep = new Set(dir === 'books' ? books.map((b) => b.slug) : seriesList.map((s) => s.slug));
  const base = path.join(ROOT, dir);
  if (!fs.existsSync(base)) continue;
  for (const name of fs.readdirSync(base)) {
    const p = path.join(base, name);
    if (fs.statSync(p).isDirectory() && !keep.has(name)) fs.rmSync(p, { recursive: true });
  }
}

// ---------- lookup used by the homepage to link covers to book and series pages ----------
write('books/index.json', JSON.stringify({
  books: Object.fromEntries(books.filter((b) => b.id).map((b) => [b.id, b.url])),
  series: seriesList.map((s) => { const first = s.books.find((b) => b.order === 1) || s.books[0]; return { name: s.name, url: s.url, count: s.books.length, first: first.title, cover: first.cover }; })
}));

// ---------- sitemap.xml + robots.txt ----------
const urls = ['/', '/books/', ...seriesList.map((s) => s.url), ...books.map((b) => b.url), ...(posts.length ? ['/blog/', ...Array.from({ length: Math.ceil(posts.length / 3) - 1 }, (_, i) => `/blog/page/${i + 2}/`), ...posts.map((p) => p.url)] : [])];
if (fs.existsSync(path.join(ROOT, 'merch.html'))) urls.push('/merch.html');
write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${SITE}${u}</loc></url>`).join('\n')}
</urlset>
`);
write('robots.txt', `User-agent: *
Allow: /

Sitemap: ${SITE}/sitemap.xml
`);

console.log(`Built ${books.length} book pages, ${seriesList.length} series pages, /books/, ${posts.length} blog posts, sitemap (${urls.length} URLs).`);
