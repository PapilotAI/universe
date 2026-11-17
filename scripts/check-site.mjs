// Exercise the built gallery without contacting production or launching Papilot.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium, webkit } from 'playwright';
import { DIST, sha256 } from './lib.mjs';

const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.pdf': 'application/pdf', '.zip': 'application/zip' };
const server = http.createServer((request, response) => {
  let file = path.join(DIST, decodeURIComponent(new URL(request.url, 'http://localhost').pathname));
  if (!file.startsWith(DIST + path.sep)) { response.writeHead(403).end(); return; }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { response.writeHead(404).end(); return; }
  response.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(response);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = process.env.UNIVERSE_BROWSER_ENGINE === 'webkit'
  ? await webkit.launch({ headless: true })
  : await chromium.launch({ headless: true, ...(process.env.UNIVERSE_BROWSER_CHANNEL ? { channel: process.env.UNIVERSE_BROWSER_CHANNEL } : {}) });
const index = JSON.parse(fs.readFileSync(path.join(DIST, 'universe/v1/index.json'), 'utf8'));
const kits = index.templates.filter(entry => !entry.template);
const chineseThesisPaths = kits.filter(entry => entry.category === 'thesis' && entry.languages.includes('zh')).map(entry => '/universe/' + entry.page);
const catalogPaths = kits.map(entry => '/universe/' + entry.page);
const errors = [];
fs.mkdirSync('test-results/site', { recursive: true });
async function context(options = {}) {
  const value = await browser.newContext({ locale: 'en-US', ...options });
  // The font belongs to the main-site Worker; standalone previews use the CSS fallback.
  await value.route('**/fonts/**', route => route.abort());
  value.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  return value;
}
async function fits(page, width) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${width}: no page overflow`);
  for (const selector of ['.topbar-inner', '.topbar .brand', '.topbar-universe', '.topbar-actions', '.topbar-demo', '.github-link', '.filters', '.filters button', '.search', '.card', '.detail-body', '.stage', '.actions']) {
    for (const box of await page.locator(selector).evaluateAll(nodes => nodes.filter(node => node.checkVisibility()).map(node => ({ left: node.getBoundingClientRect().left, right: node.getBoundingClientRect().right, width: node.clientWidth, scroll: node.scrollWidth })))) {
      assert.ok(box.left >= 0 && box.right <= width + 1 && box.scroll <= box.width + 1, `${width}: ${selector} fits`);
    }
  }
}
async function selectedContrast(page) {
  const ratios = await page.locator('[data-filter][aria-pressed="true"]').evaluate(button => {
    const rgb = color => color.match(/[\d.]+/g).map(Number);
    const background = rgb(getComputedStyle(button).backgroundColor);
    const luminance = channels => channels.slice(0, 3).map(channel => {
      const value = channel / 255;
      return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
    }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
    return [button, button.querySelector('.count')].map(element => {
      const style = getComputedStyle(element), color = rgb(style.color);
      const alpha = (color[3] ?? 1) * Number(style.opacity);
      const foreground = color.slice(0, 3).map((channel, index) => channel * alpha + background[index] * (1 - alpha));
      const a = luminance(foreground), b = luminance(background);
      return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
    });
  });
  assert.ok(ratios.every(ratio => ratio >= 4.5), `selected filter label/count contrast: ${ratios.join(', ')}`);
}
async function galleryOrder(page, lang) {
  const paths = await page.locator('.card').evaluateAll(nodes => nodes.map(node => node.getAttribute('href')));
  assert.deepEqual([...paths].sort(), [...catalogPaths].sort(), 'every template remains available exactly once');
  if (lang === 'zh-CN') assert.deepEqual(paths, catalogPaths, 'Chinese retains its original order');
  else {
    assert.ok(chineseThesisPaths.length > 0, 'the catalog exercises Chinese thesis ordering');
    assert.deepEqual(paths.slice(-chineseThesisPaths.length), chineseThesisPaths, 'English puts Chinese theses last, including bilingual ones');
    assert.deepEqual(paths.slice(0, -chineseThesisPaths.length), catalogPaths.filter(path => !chineseThesisPaths.includes(path)), 'other templates retain their relative order');
  }
}
async function galleryCounts(page) {
  assert.equal(await page.locator('[data-venues], .venue-list, .venue').count(), 0, 'the gallery contains no conference list');
  for (const button of await page.locator('[data-filter]').all()) {
    const category = await button.getAttribute('data-filter');
    const expected = await page.locator(category === 'all' ? '.card' : `.card[data-group="${category}"]`).count();
    assert.equal(Number(await button.locator('.count').textContent()), expected, `${category} counts template cards only`);
  }
}
try {
  for (const lang of ['en', 'zh-CN']) for (const width of [320, 390, 600, 601, 720, 721, 1440]) for (const colorScheme of ['light', 'dark']) {
    const visitor = await context({ viewport: { width, height: 950 }, hasTouch: width < 720, colorScheme, reducedMotion: 'reduce' });
    await visitor.addInitScript(({ lang, origin }) => {
      if (location.origin === origin) localStorage.setItem('papilot-lang', lang);
    }, { lang, origin });
    const page = await visitor.newPage();
    await page.goto(origin + '/universe/');
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.locator('html').getAttribute('lang'), lang);
    assert.equal(await page.locator('.topbar-universe').innerText(), 'Universe');
    assert.equal(await page.locator('.topbar-universe').evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)');
    assert.equal(await page.locator('.topbar-universe svg').getAttribute('aria-hidden'), 'true');
    assert.equal(await page.getByRole('link', { name: lang === 'en' ? 'Try online demo' : '体验在线演示', exact: true }).getAttribute('href'), 'https://papilot.ai/demo');
    assert.equal(await page.getByRole('button', { name: lang === 'en' ? 'All' : '全部', exact: true }).getAttribute('aria-pressed'), 'true');
    await galleryOrder(page, lang);
    await galleryCounts(page);
    await selectedContrast(page);
    await fits(page, width);
    await page.screenshot({ path: `test-results/site/gallery-${lang}-${width}-${colorScheme}.png` });
    await visitor.close();
  }

  const visitor = await context({ viewport: { width: 1440, height: 950 }, reducedMotion: 'no-preference' });
  const page = await visitor.newPage();
  await page.goto(origin + '/universe/');
  const cards = page.locator('.card:visible');
  const total = await cards.count();
  const input = page.getByRole('searchbox', { name: 'Search templates' });
  await page.getByRole('button', { name: 'Conferences', exact: true }).click();
  assert.equal(await cards.count(), kits.filter(entry => entry.category === 'conference').length);
  assert.equal(await cards.evaluateAll(nodes => nodes.every(node => node.dataset.group === 'conference')), true);
  assert.equal(Number(await page.locator('[data-filter="conference"] .count').textContent()), await cards.count());
  const cv = page.getByRole('button', { name: 'CVs', exact: true });
  await cv.focus(); await cv.press('Space');
  assert.equal(await cv.getAttribute('aria-pressed'), 'true');
  assert.ok(await cards.count() > 0);
  assert.equal(await cards.evaluateAll(nodes => nodes.every(node => node.dataset.group === 'cv')), true);
  assert.equal(new URL(page.url()).searchParams.get('category'), 'cv');
  await input.fill('Jake');
  const filteredURL = page.url(), filteredPaths = await cards.evaluateAll(nodes => nodes.map(node => node.getAttribute('href')));
  const originalNodes = await page.locator('.card').evaluateAll(nodes => { window.originalGalleryNodes = nodes; return nodes.length; });
  for (const [label, lang] of [['简体中文', 'zh-CN'], ['English', 'en']]) {
    await page.locator('#lang-button').click();
    await page.getByRole('menuitemradio', { name: label }).click();
    await galleryOrder(page, lang);
    assert.equal(page.url(), filteredURL);
    assert.equal(await page.locator('[data-search-input]').inputValue(), 'Jake');
    assert.equal(await page.locator('[data-filter="cv"]').getAttribute('aria-pressed'), 'true');
    assert.deepEqual(await cards.evaluateAll(nodes => nodes.map(node => node.getAttribute('href'))), filteredPaths);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'lang-button');
    assert.equal(await page.evaluate(() => window.originalGalleryNodes.filter(node => node.isConnected).length), originalNodes, 'language changes retain the existing card nodes');
    assert.equal(await page.locator('[data-order-status]').innerText(), lang === 'en' ? 'Templates reordered for English.' : '已按中文浏览顺序排列模板。');
  }
  await input.fill('PLDI');
  assert.equal(await page.locator('[data-empty]').isVisible(), true);
  assert.equal(await page.locator('[data-templates]').isVisible(), false);
  await page.getByRole('button', { name: 'Clear filters' }).click();
  assert.equal(await input.inputValue(), '');
  assert.equal(await cards.count(), total);
  assert.equal(new URL(page.url()).search, '');
  assert.equal(await input.evaluate(el => el === document.activeElement), true);
  await galleryCounts(page);
  await input.fill('PLDI');
  const pldiFamily = index.templates.find(entry => entry.id === index.templates.find(entry => entry.id === 'pldi').template);
  assert.equal(await page.locator(`.card[href="/universe/${pldiFamily.page}"]`).isVisible(), true);
  assert.equal(Number(await page.locator('[data-filter="all"] .count').textContent()), await cards.count());
  assert.equal(Number(await page.locator('[data-template-count]').textContent()), await cards.count());
  await page.reload();
  assert.equal(await input.inputValue(), 'PLDI');
  // STOC uses the generic article kit; searching a conference must still find that card.
  await input.fill('Symposium on Theory of Computing');
  assert.equal(await page.locator('.card[href="/universe/templates/article/"]').isVisible(), true);
  assert.equal(Number(await page.locator('[data-filter="all"] .count').textContent()), await cards.count());
  await input.fill('no-such-template-9f861');
  assert.equal(await page.locator('[data-empty]').isVisible(), true);
  assert.equal(await cards.count(), 0);
  assert.equal(Number(await page.locator('[data-filter="all"] .count').textContent()), 0);
  await input.press('Escape');
  assert.equal(await cards.count(), total);
  await galleryCounts(page);
  await page.locator('#lang-button').click();
  await page.getByRole('menuitemradio', { name: '简体中文' }).click();
  assert.equal(await page.getByRole('searchbox', { name: '搜索模板' }).count(), 1);
  await page.getByRole('button', { name: '深色模式' }).click();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  await page.reload();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  assert.equal(await page.locator('html').getAttribute('lang'), 'zh-CN');
  await galleryOrder(page, 'zh-CN');

  await page.locator('.topbar-universe').hover();
  const orbit = page.locator('.topbar .universe-orbit');
  assert.equal(await orbit.evaluate(el => getComputedStyle(el).animationName), 'universe-orbit');
  assert.equal(await orbit.evaluate(el => getComputedStyle(el).animationIterationCount), '1');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await orbit.evaluate(el => getComputedStyle(el).animationName), 'none');
  await cards.first().hover();
  assert.equal(await cards.first().locator('.sheet').evaluate(el => getComputedStyle(el).transform), 'none');

  for (const templateId of ['jakes-resume', 'pldi']) {
    const entry = index.templates.find(entry => entry.id === templateId);
    assert.ok(entry, templateId);
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 950 });
      await page.goto(origin + '/universe/' + entry.page);
      await fits(page, width);
      const deep = new URL(await page.locator('.actions .primary').getAttribute('href'));
      assert.equal(deep.protocol, 'papilot:');
      assert.equal(deep.searchParams.get('template'), entry.id);
      assert.equal(deep.searchParams.get('version'), entry.version);
      assert.equal(await page.locator('.stage img').evaluate(img => img.complete && img.naturalWidth > 0), true);
      await page.screenshot({ path: `test-results/site/detail-${entry.id}-${width}.png` });
    }
    const archive = await page.request.get(origin + '/universe/' + entry.archive.url);
    assert.equal(archive.status(), 200);
    assert.equal(sha256(await archive.body()), entry.archive.sha256);
  }
  await visitor.close();

  const noJs = await context({ javaScriptEnabled: false, viewport: { width: 390, height: 950 } });
  const staticPage = await noJs.newPage();
  await staticPage.goto(origin + '/universe/');
  assert.equal(await staticPage.locator('[data-gallery-controls]').isVisible(), false);
  assert.equal(await staticPage.locator('#theme-button').isVisible(), false);
  assert.equal(await staticPage.locator('.card:visible').count(), total);
  await galleryOrder(staticPage, 'en');
  await galleryCounts(staticPage);
  const destination = await staticPage.locator('.card').first().getAttribute('href');
  await staticPage.locator('.card').first().click();
  await staticPage.waitForURL(origin + destination, { waitUntil: 'load' });
  await staticPage.locator('.actions .primary').waitFor({ state: 'visible' });
  assert.equal(await staticPage.locator('.actions .primary').isVisible(), true);
  await noJs.close();
  assert.deepEqual(errors, []);
  console.log('Site checks passed: card-only gallery and counts, conference-name search, EN/ZH ordering and language switching, 320–1440px, light/dark, categories, search and reset, shared URLs, preferences, reduced motion, details, archive checksums and no-JS browsing.');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
