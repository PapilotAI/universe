// Checks every manifest and file list; exits non-zero on the first broken template.
import { loadTemplates, loadVenues } from './lib.mjs';

const templates = loadTemplates(process.argv.slice(2));
let failed = 0;
for (const template of templates) {
  if (!template.errors.length) { console.log(`ok   ${template.id}@${template.manifest.version} (${template.files.length} files)`); continue; }
  failed++;
  console.error(`FAIL ${template.id}`);
  for (const error of template.errors) console.error(`     - ${error}`);
}
if (!templates.length) console.log('No templates yet.');
if (!process.argv[2]) {
  const { venues, errors } = loadVenues(templates.map(template => template.id));
  for (const error of errors) console.error(`FAIL ${error}`);
  if (errors.length) failed++;
  else console.log(`ok   ${venues.length} venues`);
}
if (failed) { console.error('Fix the problems above.'); process.exit(1); }
