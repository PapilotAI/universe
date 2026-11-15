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
