// Builds dist/universe/: the gallery, one page per template, v1/index.json and an
// immutable ZIP + preview per template version. Run compile first.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { zipSync } from 'fflate';
import { AREAS, BUILD, DIST, ROOT, loadTemplates, loadVenues, sha256 } from './lib.mjs';

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
  // A sharper first page for the template's own page, rendered once per compile.
  const cover = path.join(build, 'cover.png');
  if (compiled && (!fs.existsSync(cover) || fs.statSync(cover).mtimeMs < fs.statSync(path.join(build, 'preview.pdf')).mtimeMs)) {
    const render = spawnSync('pdftoppm', ['-png', '-singlefile', '-f', '1', '-l', '1', '-scale-to', '1600', path.join(build, 'preview.pdf'), path.join(build, 'cover')], { encoding: 'utf8' });
    if (render.status !== 0) console.warn(`${id}: no cover (${(render.stderr || render.error?.message || '').trim()}); the thumbnail is used instead.`);
  }
  const hasCover = compiled && fs.existsSync(cover);
  if (hasCover) fs.copyFileSync(cover, path.join(out, base, 'cover.png'));
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
    ...(hasCover ? { cover: base + '/cover.png' } : {}),
    ...(m.setup?.notes ? { setup: m.setup.notes.trim() } : {}),
    page: `templates/${id}/`,
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

// Venues reuse their template's files; a venue that is its own kit only gains CCF data.
const { venues, errors: venueErrors } = loadVenues(templates.map(template => template.id));
if (venueErrors.length) { console.error(venueErrors.join('\n')); process.exit(1); }
const byId = new Map(entries.map(entry => [entry.id, entry]));
for (const v of venues) {
  const family = byId.get(v.template);
  const venue = { name: v.abbr, ...(v.year ? { year: v.year } : {}), ...(v.cfp ? { url: v.cfp } : {}), ...(v.ccf ? { ccf: v.ccf } : {}), area: v.area, ...(v.topics ? { topics: v.topics } : {}), ...(v.publisher ? { publisher: v.publisher } : {}), full: v.name, basis: v.confidence, ...(v.note ? { note: v.note } : {}) };
  if (v.template === v.id) { family.venue = { ...family.venue, ...venue, name: family.venue?.name ?? v.abbr, year: family.venue?.year ?? v.year }; continue; }
  // A venue is a conference whatever category its template has (STOC uses the generic article).
  const { id, name, description, i18n, tags, organization, setup, page, venue: _, category: __, ...shared } = family;
  entries.push({
    id: v.id, version: family.version, name: v.year ? `${v.abbr} ${v.year}` : v.abbr, description: v.name, category: 'conference',
    tags: [v.abbr, ...(v.ccf ? [`CCF-${v.ccf}`] : []), v.area, ...(v.topics ?? [])].slice(0, 12),
    ...shared, venue, template: family.id, ...(setup ? { setup } : {}), page: `conferences/${v.id}/`,
  });
}

const order = { thesis: 0, conference: 1, journal: 2 };
entries.sort((a, b) => (order[a.category] ?? 9) - (order[b.category] ?? 9) || a.name.localeCompare(b.name));
fs.writeFileSync(path.join(out, 'v1', 'index.json'), JSON.stringify({ schema: 1, generated: new Date().toISOString(), templates: entries }, null, 2) + '\n');

// ---- Static pages ---------------------------------------------------------
// Pages use absolute /universe/ paths: the site only ever lives there (locally too).
const U = '/universe/', MAIN = 'https://papilot.ai/';
const REPO = 'https://github.com/PapilotAI/universe';

const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const both = (en, zh) => zh && zh !== en ? `<span lang="en">${esc(en)}</span><span lang="zh-CN">${esc(zh)}</span>` : esc(en);
// Main-site links go to its Chinese pages for Chinese readers (the privacy notice is bilingual).
const link = (href, en, zh, zhHref = href.replace(MAIN, MAIN + 'zh-CN/')) => `<a href="${href}" lang="en">${esc(en)}</a><a href="${zhHref}" lang="zh-CN">${esc(zh)}</a>`;
const L = {
  all: ['All', '全部'], thesis: ['Theses', '学位论文'], conference: ['Conferences', '会议'], journal: ['Journals', '期刊'], slides: ['Slides', '演示文稿'], poster: ['Posters', '海报'], cv: ['CVs', '简历'], book: ['Books', '书籍'], other: ['Other', '其他'],
  thesisOne: ['Thesis', '学位论文'], conferenceOne: ['Conference', '会议论文'], journalOne: ['Journal', '期刊论文'], slidesOne: ['Slides', '演示文稿'], posterOne: ['Poster', '海报'], cvOne: ['CV', '简历'], bookOne: ['Book', '书籍'], otherOne: ['Template', '模板'],
  tagline: ['LaTeX templates for papers, theses, slides, posters and CVs.', '论文、学位论文、演示文稿、海报与简历的 LaTeX 模板。'],
  search: ['Search templates', '搜索模板'], open: ['Open in Papilot', '在 Papilot 中打开'], download: ['Download ZIP', '下载 ZIP'],
  preview: ['Preview PDF', '预览 PDF'], version: ['Version', '版本'], license: ['License', '许可'], engine: ['Engine', '编译引擎'],
  main: ['Main file', '主文件'], source: ['Source', '来源'], sample: ['Sample', '示例'], languages: ['Languages', '语言'], archive: ['Archive', '压缩包'],
  notStated: ['Not stated', '未声明'], publicDomain: ['Public domain', '公有领域'], note: ['Read the note', '查看说明'],
  noApp: ['No Papilot yet?', '还没有 Papilot？'], getApp: ['Download it free', '免费下载'],
  empty: ['No templates match.', '没有匹配的模板。'], notFound: ['Page not found', '找不到页面'], back: ['All templates', '全部模板'],
  licenses: ['Templates keep their own licenses', '模板遵循各自的许可'],
  missing: ['Missing a template or a conference?', '没找到需要的模板或会议？'], contribute: ['Add it on GitHub', '在 GitHub 上提交'], contributeShort: ['Contribute', '贡献模板'],
  templatesTitle: ['Templates', '模板'],
  category: ['Document type', '文档类型'], reset: ['Clear filters', '清除筛选'],
  demo: ['Try online demo', '体验在线演示'],
  basis: ['Format source', '格式依据'], basis_high: ['The call for papers', '征稿通知原文'], basis_medium: ['A past edition or the publisher', '往届或出版方说明'], basis_low: ['Inferred from the publisher; check the call before submitting', '按出版方惯例推断，投稿前请核对征稿通知'],
  template: ['Template', '模板'], ccf: ['CCF recommended', 'CCF 推荐'], publisher: ['Publisher', '出版方'], cfp: ['Call for papers', '征稿通知'], usedBy: ['Used by', '使用此模板的会议'], privacy: ['Privacy notice', '隐私声明'], blog: ['Blog', '博客'], downloads: ['Download', '下载'],
};
const label = key => both(...L[key]);
const ENGINE = { pdflatex: 'pdfLaTeX', xelatex: 'XeLaTeX', lualatex: 'LuaLaTeX' };
const LANGUAGE = { zh: ['Chinese', '中文'], en: ['English', '英文'] };
const zh = (entry, key) => entry.i18n?.['zh-CN']?.[key];
const GROUPS = ['thesis', 'conference', 'journal', 'slides', 'poster', 'cv', 'book'];
const group = entry => GROUPS.includes(entry.category) ? entry.category : 'other';
// The publisher when the name does not already say it (ACM, IEEE, ...), else the kind of template.
const source = entry => entry.organization && !entry.name.includes(entry.organization) ? esc(entry.organization) : label(group(entry) + 'One');
const meta = entry => `${source(entry)} · ${ENGINE[entry.engine]}`;
const search = entry => [entry.id, entry.name, zh(entry, 'name'), entry.organization, entry.venue?.name, ENGINE[entry.engine], ...L[group(entry)], ...L[group(entry) + 'One'], ...entry.tags].filter(Boolean).join(' ').toLowerCase();
const licenseText = entry => entry.license.split(/\s+(AND|OR)\s+/).filter((part, index) => index % 2 === 0).map(part =>
  part === 'LicenseRef-PublicDomain' ? label('publicDomain') : part.startsWith('LicenseRef-') ? label('notStated') : esc(part)).join(' + ');
const sourceUrl = entry => entry.upstream.homepage ?? entry.venue?.url ?? entry.upstream.url;
const shortUrl = url => { const parsed = new URL(url); return (parsed.hostname.replace(/^www\./, '') + parsed.pathname).replace(/\/$/, ''); };
const megabytes = bytes => bytes < 1e6 ? `${Math.max(1, Math.round(bytes / 1e3))} KB` : `${(bytes / 1e6).toFixed(1)} MB`;
const pngSize = file => { const head = fs.readFileSync(file).subarray(16, 24); return [head.readUInt32BE(0), head.readUInt32BE(4)]; };
const ariaLabel = (en, zh) => `aria-label="${esc(en)}" data-label-en="${esc(en)}" data-label-zh="${esc(zh)}"`;
const ICON = {
  github: '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg>',
  demo: '<svg class="demo-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m10 8 6 4-6 4Z" fill="currentColor" stroke="none"/></svg>',
  universe: '<svg class="universe-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><g class="universe-orbit"><g transform="rotate(-25 12 12)"><ellipse cx="12" cy="12" rx="10" ry="4"/><circle class="universe-planet" cx="12" cy="12" r="5.5"/><path d="M2 12a10 4 0 0 0 20 0" stroke-linecap="round"/></g></g><path d="M19 2v3m-1.5-1.5h3" stroke-linecap="round"/></svg>',
  search: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  download: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11m-5-5 5 5 5-5M5 20h14"/></svg>',
  pdf: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg>',
  moon: '<svg class="icon-moon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11Z"/></svg>',
  sun: '<svg class="icon-sun" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  globe: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
  external: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
  check: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
};

function page({ title, titleZh = title, description, canonical, body, image, current = 'page' }) {
  return `<!doctype html>
<html lang="en" data-lang="en" data-title-en="${esc(title)}" data-title-zh="${esc(titleZh)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${SITE}${canonical}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${image ?? MAIN + 'assets/social-preview.png'}">
<meta name="theme-color" content="#f7f8fb" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#111214" media="(prefers-color-scheme: dark)">
<link rel="icon" type="image/png" href="${U}assets/favicon.png">
<link rel="stylesheet" href="${U}assets/universe.css">
<script>try{var r=document.documentElement,s=localStorage.getItem('papilot-lang'),t=localStorage.getItem('papilot-theme');r.dataset.lang=s?(/^zh/.test(s)?'zh-CN':'en'):(/^zh/i.test(navigator.language)?'zh-CN':'en');r.lang=r.dataset.lang;if(t==='dark'||t==='light')r.dataset.theme=t}catch(e){}</script>
</head>
<body>
<header class="topbar"><div class="wrap topbar-inner">
  <a class="brand" href="${MAIN}" aria-label="Papilot"><img class="brand-mark" src="${U}assets/logo.svg" alt="" width="26" height="26"><span class="brand-name">Papilot</span></a>
  <nav class="nav" ${ariaLabel("Navigation", "页面导航")}><a class="topbar-universe" href="${U}" aria-current="${current}">${ICON.universe}<span>Universe</span></a>${link(MAIN + 'blog/', ...L.blog)}</nav>
  <div class="topbar-actions">
    <a class="try-demo topbar-demo" href="${MAIN}demo">${ICON.demo}${label('demo')}</a>
    <button class="icon-button theme-button" type="button" id="theme-button" aria-pressed="false" ${ariaLabel("Dark mode", "深色模式")} hidden>${ICON.moon}${ICON.sun}</button>
    <div class="lang-menu" hidden>
      <button class="icon-button" type="button" id="lang-button" aria-haspopup="menu" aria-expanded="false" aria-controls="lang-list" ${ariaLabel("Language", "语言")}>${ICON.globe}</button>
      <div class="lang-list" id="lang-list" role="menu" aria-labelledby="lang-button" hidden><button type="button" role="menuitemradio" data-set-lang="en" aria-checked="false">English${ICON.check}</button><button type="button" role="menuitemradio" data-set-lang="zh-CN" aria-checked="false">简体中文${ICON.check}</button></div>
    </div>
    <a class="button github-link" href="https://github.com/PapilotAI/papilot" aria-label="GitHub">${ICON.github}<span>GitHub</span></a>
  </div>
</div></header>
<main>${body}</main>
<footer class="footer"><div class="wrap footer-inner">
  <a class="brand" href="${MAIN}"><img class="brand-mark" src="${U}assets/logo.svg" alt="" width="22" height="22">Papilot</a>
  <nav aria-label="Links"><a href="${U}">Universe</a>${link(MAIN + 'blog/', ...L.blog)}${link(MAIN + '#download', ...L.downloads)}<a href="https://github.com/PapilotAI/papilot">GitHub</a><a href="${REPO}/blob/main/CONTRIBUTING.md" rel="noopener">${label('contributeShort')}</a>${link(MAIN + 'privacy/', ...L.privacy, MAIN + 'privacy/')}</nav>
  <p>${label('licenses')} · © 2026 PapilotAI</p>
</div></footer>
<script src="${U}assets/universe.js" defer></script>
</body>
</html>
`;
}

// Show each template once; conference names also match their underlying template.
const kits = entries.filter(entry => !entry.template);
const chineseOrder = new Map(kits.map((entry, index) => [entry.id, index]));
// Chinese-language university theses remain available, but do not lead the English gallery.
const chineseThesis = entry => entry.category === 'thesis' && entry.languages.includes('zh');
const englishKits = [...kits].sort((a, b) => Number(chineseThesis(a)) - Number(chineseThesis(b)));
const isVenue = entry => !!(entry.template || entry.venue?.area);
// Keep the related-conference links on detail pages alphabetical.
const conferenceEntries = entries.filter(isVenue).sort((a, b) => a.venue.name.localeCompare(b.venue.name, 'en', { sensitivity: 'base' }));
const usedBy = new Map();
for (const entry of conferenceEntries) { const family = entry.template ?? entry.id; usedBy.set(family, [...(usedBy.get(family) ?? []), entry]); }
const categories = [...GROUPS, 'other'].filter(key => kits.some(entry => group(entry) === key));
const count = key => key === 'all' ? kits.length : kits.filter(entry => group(entry) === key).length;
const venueSearch = entry => [entry.venue.name, entry.venue.full, entry.description, entry.venue.publisher, entry.template ?? entry.id, `ccf ${entry.venue.ccf ?? ''}`, ...AREAS[entry.venue.area], ...(entry.venue.topics ?? []).flatMap(topic => AREAS[topic])].filter(Boolean).join(' ').toLowerCase();
const cardSearch = entry => [search(entry), ...(usedBy.get(entry.id) ?? []).map(venueSearch)].join(' ');
const card = (entry, index) => `<a class="card" href="${U}${entry.page}" data-order-en="${index}" data-order-zh="${chineseOrder.get(entry.id)}" data-group="${group(entry)}" data-search="${esc(cardSearch(entry))}">
  <article><div class="sheet">${entry.thumbnail ? `<img src="${U}${entry.thumbnail}" alt="" loading="lazy" decoding="async">` : ''}</div>
  <header class="card-text"><h3 class="card-title">${both(entry.name, zh(entry, 'name'))}</h3><p class="card-meta">${meta(entry)}</p></header></article>
</a>`;
fs.writeFileSync(path.join(out, 'index.html'), page({
  title: 'Papilot Universe', canonical: '',
  description: 'LaTeX templates for theses and conference papers. Start a new paper from any of them in Papilot.',
  body: `
<section class="hero"><div class="wrap hero-inner">
  <h1>${ICON.universe}<span>Universe</span></h1>
  <p class="hero-sub">${label('tagline')}</p>
  <div class="gallery-controls" data-gallery-controls hidden>
    <label class="search">${ICON.search}<input type="search" data-search-input autocomplete="off" spellcheck="false" ${ariaLabel(...L.search)} placeholder="${esc(L.search[0])}" data-placeholder-en="${esc(L.search[0])}" data-placeholder-zh="${esc(L.search[1])}"><kbd>/</kbd></label>
    <div class="filters" role="group" ${ariaLabel(...L.category)}>${['all', ...categories].map((key, index) => `<button type="button" data-filter="${key}" aria-pressed="${index === 0}">${label(key)}<span class="count" aria-hidden="true">${count(key)}</span></button>`).join('')}</div>
  </div>
</div></section>
<div class="wrap">
  <section class="templates" data-templates>
    <div class="section-head"><h2>${label('templatesTitle')}</h2><span class="count" data-template-count>${kits.length}</span></div>
    <p class="visually-hidden" data-order-status role="status" data-status-en="Templates reordered for English." data-status-zh="已按中文浏览顺序排列模板。"></p>
    <div class="grid" data-grid>${englishKits.map(card).join('\n')}</div>
  </section>
  <div class="empty" data-empty hidden><p role="status">${label('empty')}</p><button type="button" class="button" data-reset>${label('reset')}</button></div>
  <p class="contribute">${label('missing')} <a href="${REPO}/blob/main/CONTRIBUTING.md" rel="noopener">${label('contribute')} →</a></p>
</div>`,
}));

for (const entry of entries) {
  const dir = path.join(out, entry.page);
  fs.mkdirSync(dir, { recursive: true });
  const deep = `papilot://new?template=${encodeURIComponent(entry.id)}&version=${encodeURIComponent(entry.version)}`;
  const cover = entry.cover ?? entry.thumbnail, [width, height] = cover ? pngSize(path.join(out, cover)) : [];
  const family = entry.template ? byId.get(entry.template) : null, v = entry.venue;
  const users = usedBy.get(entry.id)?.filter(user => user.id !== entry.id) ?? [];
  const facts = [
    ...(family ? [['template', `<a href="${U}${family.page}">${both(family.name, zh(family, 'name'))}</a>`, 'wide']] : []),
    ...(v?.ccf ? [['ccf', both(`Class ${v.ccf}`, `${v.ccf} 类`)]] : []),
    ...(v?.publisher ? [['publisher', esc(v.publisher)]] : []),
    ...(v?.url && family ? [['cfp', `<a href="${esc(v.url)}" rel="noopener">${esc(shortUrl(v.url))}</a>${v.year ? ` · ${v.year}` : ''}`, 'wide']] : []),
    ...(family || v?.basis ? [['basis', label('basis_' + (v.basis ?? 'low')) + (v.note ? `<p class="license-note">${esc(v.note)}</p>` : ''), 'wide']] : []),
    ['version', esc(entry.version)],
    ['engine', ENGINE[entry.engine]],
    ['license', licenseText(entry) + (entry.license_note ? `<details class="license-note"><summary>${label('note')}</summary>${esc(entry.license_note)}</details>` : ''), 'wide'],
    ['main', `<code>${esc(entry.main)}</code>`],
    ['languages', `<span class="chips">${entry.languages.map(code => `<span class="chip">${LANGUAGE[code] ? both(...LANGUAGE[code]) : esc(code)}</span>`).join('')}</span>`],
    ...(entry.pages ? [['sample', both(`${entry.pages} ${entry.pages === 1 ? 'page' : 'pages'}`, `${entry.pages} 页`)]] : []),
    ['archive', both(`${entry.archive.files} files · ${megabytes(entry.archive.size)}`, `${entry.archive.files} 个文件 · ${megabytes(entry.archive.size)}`)],
    ...(family ? [] : [['source', `<a href="${esc(sourceUrl(entry))}" rel="noopener">${esc(shortUrl(sourceUrl(entry)))}</a>`, 'wide']]),
    ...(users.length ? [['usedBy', `<span class="chips">${users.map(user => `<a class="chip" href="${U}${user.page}">${esc(user.venue.name)}</a>`).join('')}</span>`, 'wide']] : []),
  ];
  const name = zh(entry, 'name') ?? entry.name;
  const eyebrow = family || v?.area
    ? `<span>${label('conferenceOne')}</span>${v?.publisher ? `<span>${esc(v.publisher)}</span>` : ''}`
    : `<span>${label(group(entry) + 'One')}</span>${entry.organization && entry.organization !== 'Papilot' ? `<span>${esc(entry.organization)}</span>` : ''}${entry.venue && !entry.name.includes(entry.venue.name) ? `<span>${esc(entry.venue.name)} ${esc(entry.venue.year)}</span>` : ''}`;
  const heading = family ? esc(entry.name) : both(entry.name, zh(entry, 'name'));
  const lead = family ? esc(v.full ?? entry.description) : both(entry.description, zh(entry, 'description'));
  fs.writeFileSync(path.join(dir, 'index.html'), page({
    title: `${entry.name} · Papilot Universe`, titleZh: `${name} · Papilot Universe`, canonical: entry.page, description: family ? `${v.full}: LaTeX template (${family.name}).` : entry.description,
    image: entry.thumbnail ? SITE + entry.thumbnail : undefined, current: 'true',
    body: `
<div class="wrap">
<nav class="crumbs" aria-label="Breadcrumb"><a href="${U}">Universe</a><span aria-hidden="true">/</span><span>${heading}</span></nav>
<article class="detail">
  <div class="stage">${cover ? `<a ${entry.preview ? `href="${U}${entry.preview}"` : ''} ${ariaLabel(...L.preview)}><div class="sheet"><img src="${U}${cover}" alt="" width="${width}" height="${height}"></div></a>` : ''}</div>
  <div class="detail-body">
    <p class="eyebrow">${eyebrow}</p>
    <h1>${heading}</h1>
    <p class="lead">${lead}</p>
    <div class="actions"><a class="button primary" href="${deep}">${label('open')}</a><a class="button" href="${U}${entry.archive.url}" download>${ICON.download}${label('download')}</a>${entry.preview ? `<a class="button" href="${U}${entry.preview}">${ICON.pdf}${label('preview')}</a>` : ''}</div>
    <p class="get-app">${label('noApp')} ${link(MAIN + '#download', ...L.getApp)}</p>
    <dl class="facts">${facts.map(([key, value, wide]) => `<div${wide ? ' class="wide"' : ''}><dt>${label(key)}</dt><dd>${value}</dd></div>`).join('')}</dl>
  </div>
</article>
</div>`,
  }));
}

fs.writeFileSync(path.join(out, '404.html'), page({ title: 'Not found · Papilot Universe', canonical: '', description: '', body: `<div class="wrap missing"><h1>${label('notFound')}</h1><a class="button" href="${U}">${label('back')}</a></div>` }));
for (const file of ['universe.css', 'universe.js', 'logo.svg', 'favicon.png']) fs.copyFileSync(path.join(ROOT, 'site', file), path.join(out, 'assets', file));
// Template pages used to live under /universe/t/<id>/.
fs.writeFileSync(path.join(DIST, '_redirects'), '/universe/t/* /universe/templates/:splat 301\n');
fs.writeFileSync(path.join(DIST, '_headers'), `/universe/v1/index.json
  Cache-Control: public, max-age=300
  Access-Control-Allow-Origin: *
/universe/v1/templates/*
  Cache-Control: public, max-age=31536000, immutable
  Access-Control-Allow-Origin: *
`);
fs.writeFileSync(path.join(out, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${['', ...entries.map(entry => entry.page)].map(loc => `  <url><loc>${SITE}${loc}</loc></url>`).join('\n')}\n</urlset>\n`);
console.log(`Built ${entries.length} template(s) into ${path.relative(ROOT, out)}/`);
