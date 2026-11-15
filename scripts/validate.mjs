// Checks every manifest and file list; exits non-zero on the first broken template.
import { loadTemplates } from './lib.mjs';

const templates = loadTemplates(process.argv.slice(2));
let failed = 0;
for (const template of templates) {
  if (!template.errors.length) { console.log(`ok   ${template.id}@${template.manifest.version} (${template.files.length} files)`); continue; }
  failed++;
  console.error(`FAIL ${template.id}`);
  for (const error of template.errors) console.error(`     - ${error}`);
}
if (!templates.length) console.log('No templates yet.');
if (failed) { console.error(`${failed} template(s) need fixing.`); process.exit(1); }
