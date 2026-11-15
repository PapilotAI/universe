// Builds dist/universe/: the gallery, one page per template, v1/index.json and an
// immutable ZIP + preview per template version. Run compile first.
import fs from 'node:fs';
import path from 'node:path';
import { zipSync } from 'fflate';
import { BUILD, DIST, ROOT, loadTemplates, sha256 } from './lib.mjs';

const args = process.argv.slice(2), allowMissing = args.includes('--allow-missing');
const published = args.find(arg => arg.startsWith('--published='))?.slice('--published='.length);
const SITE = 'https://papilot.ai/universe/', out = path.join(DIST, 'universe');
const templates = loadTemplates();
const broken = templates.filter(template => template.errors.length);
if (broken.length) { console.error(`Invalid templates: ${broken.map(template => template.id).join(', ')}. Run npm run validate.`); process.exit(1); }

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'v1', 'templates'), { recursive: true });
fs.mkdirSync(path.join(out, 'assets'), { recursive: true });

// DOS timestamps are local time; a local-time date keeps ZIP bytes identical across time zones.
const MTIME = new Date(1980, 0, 1, 12);
const entries = [];
for (const template of templates) {
  const { id, manifest: m } = template, build = path.join(BUILD, id);
  let stamp;
  try { stamp = JSON.parse(fs.readFileSync(path.join(build, 'build.json'), 'utf8')); } catch { /* Not compiled. */ }
  const compiled = stamp?.hash === template.hash;
  if (!compiled && !allowMissing) { console.error(`${id} is not compiled at its current content. Run npm run compile.`); process.exit(1); }
  const files = {};
  for (const file of template.files) files[file] = [fs.readFileSync(path.join(template.dir, 'files', file)), { mtime: MTIME }];
  const zip = zipSync(files, { level: 9 });
  const base = `v1/templates/${id}/${m.version}`;
  fs.mkdirSync(path.join(out, base), { recursive: true });
  fs.writeFileSync(path.join(out, base + '.zip'), zip);
  if (compiled) for (const file of ['preview.pdf', 'thumbnail.png']) fs.copyFileSync(path.join(build, file), path.join(out, base, file));
  entries.push({
    id, version: m.version, name: m.name, description: m.description,
    ...(m['zh-CN'] ? { i18n: { 'zh-CN': m['zh-CN'] } } : {}),
    category: m.category, tags: m.tags, languages: m.languages,
    ...(m.organization ? { organization: m.organization } : {}),
    ...(m.venue ? { venue: m.venue } : {}),
    license: m.license, ...(m.license_note ? { license_note: m.license_note } : {}),
    main: m.main, engine: m.engine,
    upstream: m.upstream,
    archive: { url: base + '.zip', sha256: sha256(zip), size: zip.length, files: template.files.length },
    ...(compiled ? { thumbnail: base + '/thumbnail.png', preview: base + '/preview.pdf', pages: stamp.pages } : {}),
    ...(m.setup?.notes ? { setup: m.setup.notes.trim() } : {}),
    page: `t/${id}/`,
  });
}

// A published version is immutable: changed files need a new version number.
if (published) {
  const response = await fetch(published).catch(() => null);
  if (response?.ok) {
    const live = new Map((await response.json()).templates.map(entry => [entry.id, entry]));
    const reused = entries.filter(entry => live.get(entry.id)?.version === entry.version && live.get(entry.id).archive.sha256 !== entry.archive.sha256);
    if (reused.length) { console.error(`Changed without a version bump: ${reused.map(entry => entry.id).join(', ')}`); process.exit(1); }
  } else console.log(`Published index not reachable (${response?.status ?? 'offline'}); skipping the version check.`);
}

const order = { thesis: 0, conference: 1, journal: 2 };
entries.sort((a, b) => (order[a.category] ?? 9) - (order[b.category] ?? 9) || a.name.localeCompare(b.name));
fs.writeFileSync(path.join(out, 'v1', 'index.json'), JSON.stringify({ schema: 1, generated: new Date().toISOString(), templates: entries }, null, 2) + '\n');

// ---- Static pages ---------------------------------------------------------
const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const both = (en, zh) => zh && zh !== en ? `<span lang="en">${esc(en)}</span><span lang="zh-CN">${esc(zh)}</span>` : esc(en);
const L = {
  all: ['All', '全部'], thesis: ['Theses', '学位论文'], conference: ['Conferences', '会议'], journal: ['Journals', '期刊'], other: ['Other', '其他'],
  search: ['Search templates', '搜索模板'], open: ['Open in Papilot', '在 Papilot 中打开'], download: ['Download ZIP', '下载 ZIP'],
  preview: ['Preview PDF', '预览 PDF'], version: ['Version', '版本'], license: ['License', '许可'], engine: ['Engine', '编译'],
  main: ['Main file', '主文件'], source: ['Source', '来源'], custom: ['Custom', '自定义'], get: ['Get Papilot', '下载 Papilot'], back: ['All templates', '全部模板'],
  empty: ['No templates match.', '没有匹配的模板。'], notFound: ['Template not found.', '找不到这个模板。'], submit: ['Add a template', '提交模板'],
};
const label = key => both(...L[key]);
const ENGINE = { pdflatex: 'pdfLaTeX', xelatex: 'XeLaTeX', lualatex: 'LuaLaTeX' };
const zh = (entry, key) => entry.i18n?.['zh-CN']?.[key];
// Where the template comes from, unless the name already says it; then its engine.
const meta = entry => { const from = entry.venue ? `${entry.venue.name} ${entry.venue.year}` : entry.organization ?? ''; return from && !entry.name.includes(from) ? from : ENGINE[entry.engine]; };
const group = entry => ['thesis', 'conference', 'journal'].includes(entry.category) ? entry.category : 'other';
const search = entry => [entry.id, entry.name, zh(entry, 'name'), entry.organization, entry.venue?.name, ...entry.tags].filter(Boolean).join(' ').toLowerCase();

function page({ title, description, canonical, body, depth }) {
  const up = '../'.repeat(depth);
  return `<!doctype html>
<html lang="en" data-lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${SITE}${canonical}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<link rel="icon" type="image/png" href="${up}assets/favicon.png">
<link rel="stylesheet" href="${up}assets/universe.css">
<script>try{var l=localStorage.getItem('papilot-universe-lang')||(/^zh/i.test(navigator.language)?'zh-CN':'en');document.documentElement.dataset.lang=l;document.documentElement.lang=l}catch(e){}</script>
</head>
<body>
<header class="bar"><div class="wrap bar-inner">
  <a class="brand" href="${up}"><img src="${up}assets/logo.svg" alt="" width="24" height="24"><span>Papilot</span><span class="brand-sub">Universe</span></a>
  <nav class="bar-actions"><button type="button" class="lang" data-lang-toggle aria-label="Language"><span lang="en">中文</span><span lang="zh-CN">EN</span></button><a class="pill" href="https://papilot.ai/#download">${label('get')}</a></nav>
</div></header>
<main class="wrap">${body}</main>
<script src="${up}assets/universe.js" defer></script>
</body>
</html>
`;
}

const categories = ['thesis', 'conference', 'journal', 'other'].filter(key => entries.some(entry => group(entry) === key));
const card = entry => `<a class="card" href="${entry.page}" data-group="${group(entry)}" data-search="${esc(search(entry))}">
  <div class="thumb">${entry.thumbnail ? `<img src="${entry.thumbnail}" alt="" loading="lazy">` : ''}</div>
  <div class="card-body"><strong>${both(entry.name, zh(entry, 'name'))}</strong><span>${esc(meta(entry))}</span></div>
</a>`;
fs.writeFileSync(path.join(out, 'index.html'), page({
  title: 'Papilot Universe', canonical: '', depth: 0,
  description: 'LaTeX templates for theses and conference papers. Start a new paper from any of them in Papilot.',
  body: `
<section class="hero"><h1>Universe</h1>
  <div class="tools">
    <div class="segmented" role="tablist">${['all', ...categories].map((key, index) => `<button type="button" role="tab" data-filter="${key}" aria-selected="${index === 0}">${label(key)}</button>`).join('')}</div>
    <input class="search" type="search" data-search-input autocomplete="off" spellcheck="false" aria-label="${esc(L.search[0])}" placeholder="${esc(L.search[0])}" data-placeholder-zh="${esc(L.search[1])}">
  </div>
</section>
<section class="grid" data-grid>${entries.map(card).join('\n')}</section>
<p class="empty" data-empty hidden>${label('empty')}</p>
<footer class="foot"><a href="https://github.com/PapilotAI/universe">${label('submit')}</a></footer>`,
}));

for (const entry of entries) {
  const dir = path.join(out, 't', entry.id);
  fs.mkdirSync(dir, { recursive: true });
  const root = '../../', deep = `papilot://new?template=${encodeURIComponent(entry.id)}&version=${encodeURIComponent(entry.version)}`;
  const facts = [
    ['version', esc(entry.version)],
    ['license', entry.license_note ? `<span class="note" title="${esc(entry.license_note)}">${label('custom')}</span>` : esc(entry.license)],
    ['engine', ENGINE[entry.engine]],
    ['main', `<code>${esc(entry.main)}</code>`],
    ['source', `<a href="${esc(entry.upstream.homepage ?? entry.venue?.url ?? entry.upstream.url)}" rel="noopener">${esc(new URL(entry.upstream.homepage ?? entry.venue?.url ?? entry.upstream.url).hostname)}</a>`],
  ];
  fs.writeFileSync(path.join(dir, 'index.html'), page({
    title: `${entry.name} · Papilot Universe`, canonical: entry.page, depth: 2, description: entry.description,
    body: `
<a class="back" href="${root}">← ${label('back')}</a>
<article class="detail">
  <a class="detail-thumb" ${entry.preview ? `href="${root}${entry.preview}"` : ''}>${entry.thumbnail ? `<img src="${root}${entry.thumbnail}" alt="">` : ''}</a>
  <div class="detail-body">
    <p class="detail-meta">${esc(meta(entry))}</p>
    <h1>${both(entry.name, zh(entry, 'name'))}</h1>
    <p class="detail-description">${both(entry.description, zh(entry, 'description'))}</p>
    <div class="actions"><a class="pill primary" href="${deep}">${label('open')}</a><a class="pill" href="${root}${entry.archive.url}" download>${label('download')}</a>${entry.preview ? `<a class="pill ghost" href="${root}${entry.preview}">${label('preview')}</a>` : ''}</div>
    <dl class="facts">${facts.map(([key, value]) => `<div><dt>${label(key)}</dt><dd>${value}</dd></div>`).join('')}</dl>
  </div>
</article>`,
  }));
}

fs.writeFileSync(path.join(out, '404.html'), page({ title: 'Not found · Papilot Universe', canonical: '', depth: 0, description: '', body: `<p class="empty">${label('notFound')}</p><p class="empty"><a href="/universe/">← ${label('back')}</a></p>` }).replaceAll('href="assets/', 'href="/universe/assets/').replaceAll('src="assets/', 'src="/universe/assets/').replace('<a class="brand" href="">', '<a class="brand" href="/universe/">'));
for (const file of ['universe.css', 'universe.js', 'logo.svg', 'favicon.png']) fs.copyFileSync(path.join(ROOT, 'site', file), path.join(out, 'assets', file));
fs.writeFileSync(path.join(DIST, '_headers'), `/universe/v1/index.json
  Cache-Control: public, max-age=300
  Access-Control-Allow-Origin: *
/universe/v1/templates/*
  Cache-Control: public, max-age=31536000, immutable
  Access-Control-Allow-Origin: *
`);
fs.writeFileSync(path.join(out, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${['', ...entries.map(entry => entry.page)].map(loc => `  <url><loc>${SITE}${loc}</loc></url>`).join('\n')}\n</urlset>\n`);
console.log(`Built ${entries.length} template(s) into ${path.relative(ROOT, out)}/`);
