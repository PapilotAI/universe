import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listFiles, validateManifest } from '../scripts/lib.mjs';

const valid = {
  id: 'neurips', version: '2026', name: 'NeurIPS 2026', description: 'Official style.', category: 'conference',
  tags: ['machine learning'], languages: ['en'], license: 'LicenseRef-NeurIPS', license_note: 'Distributed by the NeurIPS Foundation for author use.',
  main: 'neurips_2026.tex', engine: 'pdflatex', venue: { name: 'NeurIPS', year: 2026, url: 'https://neurips.cc/' },
  upstream: { url: 'https://media.neurips.cc/Styles.zip', sha256: 'a'.repeat(64) },
};

test('a complete manifest is valid', () => assert.deepEqual(validateManifest(valid, 'neurips'), []));

test('manifest mistakes are reported', () => {
  const errors = validateManifest({ ...valid, id: 'NeurIPS', engine: 'tectonic', main: '../x.tex', license_note: undefined, extra: 1, upstream: { url: 'http://x' } }, 'neurips');
  for (const pattern of [/id must be "neurips"/, /engine must be/, /main must be/, /license_note/, /unknown key "extra"/, /upstream.url/]) assert.ok(errors.some(error => pattern.test(error)), `${pattern} in ${errors.join('; ')}`);
});

test('build output, tooling and links are refused in files/', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'universe-files-'));
  try {
    fs.mkdirSync(path.join(dir, 'figures'));
    fs.writeFileSync(path.join(dir, 'main.tex'), 'x'); fs.writeFileSync(path.join(dir, 'figures/plot.pdf'), 'x');
    fs.writeFileSync(path.join(dir, 'main.aux'), 'x'); fs.writeFileSync(path.join(dir, 'Makefile'), 'x');
    fs.symlinkSync('main.tex', path.join(dir, 'link.tex'));
    const { files, errors } = listFiles(dir);
    assert.deepEqual(files, ['figures/plot.pdf', 'main.tex']);
    assert.equal(errors.length, 3);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
