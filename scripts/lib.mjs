// Shared loading and validation for templates/<id>/papilot.toml + files/.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'smol-toml';

export const ROOT = path.resolve(import.meta.dirname, '..');
export const TEMPLATES = path.join(ROOT, 'templates');
export const BUILD = path.join(ROOT, 'build');
export const DIST = path.join(ROOT, 'dist');

export const CATEGORIES = ['thesis', 'conference', 'journal', 'article', 'report', 'cv', 'slides', 'letter'];
export const ENGINES = ['pdflatex', 'xelatex', 'lualatex'];
export const LOCALES = ['zh-CN'];
const LIMITS = { files: 600, total: 30 * 1024 * 1024, file: 12 * 1024 * 1024 };
// Build output and editor/OS litter never belong in a starting project.
const JUNK = /(^|\/)(\.DS_Store|Thumbs\.db|__MACOSX|\.git|\.github|\.gitignore|\.gitattributes|\.latexmkrc|latexmkrc|Makefile|makefile|.*\.(aux|log|out|fls|fdb_latexmk|synctex\.gz|synctex|bbl|blg|bcf|run\.xml|toc|lof|lot|xdv|idx|ind|ilg|nav|snm|vrb|zip|exe|sh|bat|ps1|py))$/;
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VERSION = /^\d+(?:\.\d+){0,2}(?:-[0-9A-Za-z.]+)?$/;
const SPDX = /^(?:[A-Za-z0-9.+-]+|LicenseRef-[A-Za-z0-9.-]+)(?:\s+(?:OR|AND|WITH)\s+[A-Za-z0-9.+-]+)*$/;

function text(errors, where, value, { max = 200, optional = false } = {}) {
  if (value === undefined && optional) return;
  if (typeof value !== 'string' || !value.trim()) errors.push(`${where} must be a non-empty string`);
  else if (value.length > max) errors.push(`${where} must be at most ${max} characters`);
  else if (/\n/.test(value) && max <= 200) errors.push(`${where} must be a single line`);
}

function url(errors, where, value, optional = false) {
  if (value === undefined && optional) return;
  try { if (!/^https:$/.test(new URL(value).protocol)) throw new Error(); } catch { errors.push(`${where} must be an https URL`); }
}

export function validateManifest(manifest, id) {
  const errors = [];
  const m = manifest ?? {};
  if (m.id !== id) errors.push(`id must be "${id}" (the directory name)`);
  if (typeof m.id !== 'string' || !ID.test(m.id)) errors.push('id must be lowercase kebab-case');
  if (typeof m.version !== 'string' || !VERSION.test(m.version)) errors.push('version must look like 2026, 7.6 or 1.2.3');
  text(errors, 'name', m.name, { max: 80 });
  text(errors, 'description', m.description, { max: 200 });
  if (!CATEGORIES.includes(m.category)) errors.push(`category must be one of ${CATEGORIES.join(', ')}`);
  if (!Array.isArray(m.tags) || m.tags.length > 12 || m.tags.some(tag => typeof tag !== 'string' || !tag.trim() || tag.length > 40)) errors.push('tags must be a list of at most 12 short strings');
  if (!Array.isArray(m.languages) || !m.languages.length || m.languages.some(language => typeof language !== 'string' || !/^[a-z]{2}(?:-[A-Z][a-z]{3})?$/.test(language))) errors.push('languages must list ISO codes such as "en" or "zh"');
  if (typeof m.license !== 'string' || !SPDX.test(m.license)) errors.push('license must be an SPDX expression or LicenseRef-…');
  if (typeof m.license === 'string' && m.license.startsWith('LicenseRef-')) text(errors, 'license_note', m.license_note, { max: 600 });
  if (typeof m.main !== 'string' || !/^[^/\\][^\\]*\.tex$/.test(m.main) || m.main.split('/').includes('..')) errors.push('main must be a relative .tex path inside files/');
  if (!ENGINES.includes(m.engine)) errors.push(`engine must be one of ${ENGINES.join(', ')}`);
  if (m.organization !== undefined) text(errors, 'organization', m.organization, { max: 80 });
  if (m.venue !== undefined) {
    text(errors, 'venue.name', m.venue?.name, { max: 40 });
    if (!Number.isInteger(m.venue?.year) || m.venue.year < 2000 || m.venue.year > 2100) errors.push('venue.year must be a year');
    url(errors, 'venue.url', m.venue?.url, true);
  }
  if (!m.upstream || typeof m.upstream !== 'object') errors.push('upstream must describe where the files came from');
  else {
    url(errors, 'upstream.url', m.upstream.url);
    url(errors, 'upstream.homepage', m.upstream.homepage, true);
    text(errors, 'upstream.version', m.upstream.version, { max: 80, optional: true });
    if (m.upstream.sha256 !== undefined && !/^[a-f0-9]{64}$/.test(m.upstream.sha256)) errors.push('upstream.sha256 must be a hex SHA-256');
    if (m.upstream.commit !== undefined && !/^[a-f0-9]{40}$/.test(m.upstream.commit)) errors.push('upstream.commit must be a full Git SHA');
  }
  for (const locale of LOCALES) if (m[locale] !== undefined) {
    text(errors, `${locale}.name`, m[locale].name, { max: 80, optional: true });
    text(errors, `${locale}.description`, m[locale].description, { max: 200, optional: true });
  }
  if (m.setup !== undefined) text(errors, 'setup.notes', m.setup?.notes, { max: 1200 });
  const known = new Set(['id', 'version', 'name', 'description', 'category', 'tags', 'languages', 'license', 'license_note', 'main', 'engine', 'organization', 'venue', 'upstream', 'setup', ...LOCALES]);
  for (const key of Object.keys(m)) if (!known.has(key)) errors.push(`unknown key "${key}"`);
  return errors;
}

// Lists template files relative to files/, refusing links and litter.
export function listFiles(base) {
  const files = [], errors = [];
  let total = 0;
  const walk = relative => {
    for (const entry of fs.readdirSync(path.join(base, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) { errors.push(`${rel} is a symbolic link`); continue; }
      if (JUNK.test(rel)) { errors.push(`${rel} looks like build output or tooling; remove it`); continue; }
      if (entry.isDirectory()) { walk(rel); continue; }
      if (!entry.isFile()) { errors.push(`${rel} is not a regular file`); continue; }
      if (/[\\:*?"<>|\x00-\x1f]/.test(rel)) { errors.push(`${rel} has characters that break on Windows`); continue; }
      const size = fs.statSync(path.join(base, rel)).size;
      if (size > LIMITS.file) errors.push(`${rel} is larger than ${LIMITS.file / 1024 / 1024} MB`);
      total += size;
      files.push(rel);
    }
  };
  if (!fs.existsSync(base)) return { files, errors: ['files/ is missing'] };
  walk('');
  if (files.length > LIMITS.files) errors.push(`more than ${LIMITS.files} files`);
  if (total > LIMITS.total) errors.push(`files total more than ${LIMITS.total / 1024 / 1024} MB`);
  const lower = new Map();
  for (const file of files) {
    const key = file.toLowerCase();
    if (lower.has(key)) errors.push(`${file} and ${lower.get(key)} differ only in case`);
    lower.set(key, file);
  }
  return { files, errors };
}

export function loadTemplate(id) {
  const dir = path.join(TEMPLATES, id), errors = [];
  let manifest;
  try { manifest = parse(fs.readFileSync(path.join(dir, 'papilot.toml'), 'utf8')); }
  catch (error) { return { id, dir, errors: [`papilot.toml: ${error.message}`] }; }
  errors.push(...validateManifest(manifest, id));
  const { files, errors: fileErrors } = listFiles(path.join(dir, 'files'));
  errors.push(...fileErrors);
  if (typeof manifest.main === 'string' && !files.includes(manifest.main)) errors.push(`main file ${manifest.main} is not in files/`);
  if (typeof manifest.main === 'string' && files.includes(manifest.main.replace(/\.tex$/, '.pdf'))) errors.push(`${manifest.main.replace(/\.tex$/, '.pdf')} is the compiled paper; remove it`);
  return { id, dir, manifest, files, errors, hash: errors.length ? '' : contentHash(dir, files) };
}

export function loadTemplates(ids) {
  const all = fs.existsSync(TEMPLATES) ? fs.readdirSync(TEMPLATES, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort() : [];
  for (const id of ids ?? []) if (!all.includes(id)) throw new Error(`Unknown template: ${id}`);
  return (ids?.length ? ids : all).map(loadTemplate);
}

// Changes to the manifest or any file produce a new build.
export function contentHash(dir, files) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(path.join(dir, 'papilot.toml')));
  for (const file of files) { hash.update('\0' + file + '\0'); hash.update(fs.readFileSync(path.join(dir, 'files', file))); }
  return hash.digest('hex');
}

export const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');

// ---- Venues ---------------------------------------------------------------
// venues/*.toml list conferences. Each points at the template its call for papers requires,
// so hundreds of venues share a few dozen templates. A venue whose template is its own kit
// (template = id) only adds its CCF data to that template.
export const VENUES = path.join(ROOT, 'venues');
export const AREAS = {
  arch: ['Architecture, parallel & storage systems', '计算机体系结构/并行与分布计算/存储系统'],
  net: ['Computer networks', '计算机网络'],
  sec: ['Network & information security', '网络与信息安全'],
  se: ['Software engineering, systems software & PL', '软件工程/系统软件/程序设计语言'],
  db: ['Databases, data mining & IR', '数据库/数据挖掘/内容检索'],
  tcs: ['Theory of computing', '计算机科学理论'],
  cg: ['Graphics & multimedia', '计算机图形学与多媒体'],
  ai: ['Artificial intelligence', '人工智能'],
  hci: ['HCI & ubiquitous computing', '人机交互与普适计算'],
  mx: ['Interdisciplinary & emerging', '交叉/综合/新兴'],
  pl: ['Programming languages', '程序设计语言'],
};
const CONFIDENCE = ['high', 'medium', 'low'];

export function validateVenue(venue, templates) {
  const errors = [], v = venue ?? {}, where = `venue ${v.id ?? '?'}`;
  if (typeof v.id !== 'string' || !ID.test(v.id)) errors.push(`${where}: id must be lowercase kebab-case`);
  text(errors, `${where}: abbr`, v.abbr, { max: 40 });
  text(errors, `${where}: name`, v.name, { max: 200 });
  if (!templates.has(v.template)) errors.push(`${where}: template "${v.template}" does not exist`);
  if (v.ccf !== undefined && !['A', 'B', 'C'].includes(v.ccf)) errors.push(`${where}: ccf must be A, B or C`);
  if (!(v.area in AREAS)) errors.push(`${where}: area must be one of ${Object.keys(AREAS).join(', ')}`);
  if (v.topics !== undefined && (!Array.isArray(v.topics) || v.topics.some(topic => !(topic in AREAS)))) errors.push(`${where}: topics must list area ids`);
  text(errors, `${where}: publisher`, v.publisher, { max: 80, optional: true });
  if (v.year !== undefined && (!Number.isInteger(v.year) || v.year < 2000 || v.year > 2100)) errors.push(`${where}: year must be a year`);
  url(errors, `${where}: cfp`, v.cfp, true);
  if (!CONFIDENCE.includes(v.confidence)) errors.push(`${where}: confidence must be high, medium or low`);
  text(errors, `${where}: note`, v.note, { max: 300, optional: true });
  const known = new Set(['id', 'abbr', 'name', 'template', 'ccf', 'area', 'topics', 'publisher', 'year', 'cfp', 'confidence', 'note']);
  for (const key of Object.keys(v)) if (!known.has(key)) errors.push(`${where}: unknown key "${key}"`);
  return errors;
}

export function loadVenues(templateIds) {
  const templates = new Set(templateIds), venues = [], errors = [], seen = new Map();
  if (!fs.existsSync(VENUES)) return { venues, errors };
  for (const file of fs.readdirSync(VENUES).filter(name => name.endsWith('.toml')).sort()) {
    let data;
    try { data = parse(fs.readFileSync(path.join(VENUES, file), 'utf8')); } catch (error) { errors.push(`venues/${file}: ${error.message}`); continue; }
    for (const venue of data.venues ?? []) {
      errors.push(...validateVenue(venue, templates).map(error => `venues/${file}: ${error}`));
      if (seen.has(venue.id)) errors.push(`venues/${file}: venue ${venue.id} is also in venues/${seen.get(venue.id)}`);
      else if (templates.has(venue.id) && venue.template !== venue.id) errors.push(`venues/${file}: venue ${venue.id} has the id of another template`);
      seen.set(venue.id, file);
      venues.push(venue);
    }
  }
  return { venues, errors };
}
