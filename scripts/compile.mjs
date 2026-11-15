// Compiles each template with latexmk into build/<id>/: preview.pdf, thumbnail.png and
// the content hash it was built from, so unchanged templates are skipped.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { BUILD, loadTemplates } from './lib.mjs';

const args = process.argv.slice(2), force = args.includes('--force');
const templates = loadTemplates(args.filter(arg => !arg.startsWith('--')));
const flags = { pdflatex: '-pdf', xelatex: '-xelatex', lualatex: '-lualatex' };
// The same latexmk options Papilot builds papers with, including TeX's default
// restricted shell escape (which converts EPS figures), and a build/ output folder.
const OPTIONS = ['-norc', '-outdir=build', '-interaction=nonstopmode', '-halt-on-error', '-file-line-error'];
const tex = spawnSync('latexmk', ['-v'], { encoding: 'utf8' });
if (tex.status !== 0) { console.error('latexmk is not installed.'); process.exit(1); }
const texVersion = (spawnSync('tex', ['--version'], { encoding: 'utf8' }).stdout || '').split('\n')[0].trim();

let failed = 0;
for (const template of templates) {
  if (template.errors.length) { console.error(`FAIL ${template.id}: run npm run validate`); failed++; continue; }
  const out = path.join(BUILD, template.id), stamp = path.join(out, 'build.json');
  try {
    const previous = JSON.parse(fs.readFileSync(stamp, 'utf8'));
    // New compile options rebuild everything, even unchanged templates.
    if (!force && previous.hash === template.hash && previous.options === OPTIONS.join(' ') && fs.existsSync(path.join(out, 'preview.pdf')) && fs.existsSync(path.join(out, 'thumbnail.png'))) { console.log(`skip ${template.id} (unchanged)`); continue; }
  } catch { /* Not built yet. */ }
  fs.rmSync(out, { recursive: true, force: true });
  const work = path.join(out, 'work');
  fs.mkdirSync(work, { recursive: true });
  fs.cpSync(path.join(template.dir, 'files'), work, { recursive: true });
  const { main, engine } = template.manifest, folder = path.join(work, path.dirname(main)), started = Date.now();
  process.stdout.write(`tex  ${template.id} (${engine}) … `);
  const run = spawnSync('latexmk', [flags[engine], ...OPTIONS, path.basename(main)], { cwd: folder, encoding: 'utf8', timeout: 15 * 60_000, maxBuffer: 64 * 1024 * 1024 });
  const pdf = path.join(folder, 'build', path.basename(main).replace(/\.tex$/, '.pdf'));
  if (run.status !== 0 || !fs.existsSync(pdf)) {
    failed++;
    console.log('failed');
    const log = path.join(folder, 'build', path.basename(main).replace(/\.tex$/, '.log'));
    const lines = (fs.existsSync(log) ? fs.readFileSync(log, 'latin1') : (run.stdout || '') + (run.stderr || '') + (run.error?.message || '')).split('\n');
    const first = lines.findIndex(line => /^!|:\d+: /.test(line));
    console.error(lines.slice(first >= 0 ? Math.max(0, first - 2) : -40, first >= 0 ? first + 12 : undefined).join('\n'));
    continue;
  }
  fs.copyFileSync(pdf, path.join(out, 'preview.pdf'));
  const thumb = spawnSync('pdftoppm', ['-png', '-singlefile', '-f', '1', '-l', '1', '-scale-to', '720', pdf, path.join(out, 'thumbnail')], { encoding: 'utf8' });
  if (thumb.status !== 0) { failed++; console.log('no thumbnail'); console.error(thumb.stderr || thumb.error?.message); continue; }
  const pages = Number(/\nPages:\s+(\d+)/.exec(spawnSync('pdfinfo', [pdf], { encoding: 'utf8' }).stdout || '')?.[1]) || undefined;
  fs.rmSync(work, { recursive: true, force: true });
  fs.writeFileSync(stamp, JSON.stringify({ hash: template.hash, options: OPTIONS.join(' '), version: template.manifest.version, pages, tex: texVersion, seconds: Math.round((Date.now() - started) / 1000) }, null, 2) + '\n');
  console.log(`ok (${pages ?? '?'} pages, ${Math.round((Date.now() - started) / 1000)} s)`);
}
if (failed) { console.error(`${failed} template(s) failed to compile.`); process.exit(1); }
