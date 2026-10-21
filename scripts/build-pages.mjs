// Builds the static Books, Series and individual book pages, sitemap.xml and robots.txt
// from data.json. Run automatically by .github/workflows/build-pages.yml whenever
// data.json changes. Never edits data.json, index.html or the admin.
import fs from 'node:fs';
import path from 'node:path';

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
[hidden]{display:none!important}`;

const SOCIAL_LABELS = { amazon: 'Amazon', patreon: 'Patreon', tiktok: 'TikTok', instagram: 'Instagram', facebook: 'Facebook', discord: 'Discord', goodreads: 'Goodreads' };
const sameAs = Object.keys(SOCIAL_LABELS).map((k) => socials[k]).filter((u) => /^https?:\/\//.test(u || ''));
const latestNewsletter = data.latestNewsletter || socials.newsletter || '';

const page = ({ title, description, canonical, current, body, jsonld = [], image = '' }) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${SITE}${canonical}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${AUTHOR}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${SITE}${canonical}">
<meta property="og:image" content="${esc(image && /^https?:/.test(image) ? image : SITE + '/PageIcon.png')}">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/PageIcon.png">
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
<a class="nav-link" href="/#reviews">Reviews</a>
</nav>
${socials.newsletter ? `<a class="nav-join" href="${esc(socials.newsletter)}" target="_blank" rel="noopener">Join the Newsletter</a>` : ''}
</div></header>
${body}
<footer class="footer">
<a class="brand" href="/">Raven DeNoir</a>
<nav aria-label="Footer"><a href="/">Home</a><a href="/books/">All Books</a>${latestNewsletter ? `<a href="${esc(latestNewsletter)}">Latest Newsletter</a>` : ''}</nav>
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
const urls = ['/', '/books/', ...seriesList.map((s) => s.url), ...books.map((b) => b.url)];
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

console.log(`Built ${books.length} book pages, ${seriesList.length} series pages, /books/, sitemap (${urls.length} URLs).`);
