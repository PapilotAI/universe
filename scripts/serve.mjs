// Serves dist/ locally at http://127.0.0.1:4410/universe/ for previewing the site.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { DIST } from './lib.mjs';

const port = Number(process.env.PORT || 4410);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.pdf': 'application/pdf', '.zip': 'application/zip', '.xml': 'application/xml' };
http.createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  let file = path.join(DIST, decodeURIComponent(url.pathname));
  if (!file.startsWith(DIST)) { response.writeHead(403).end(); return; }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { response.writeHead(404, { 'content-type': types['.html'] }); fs.createReadStream(path.join(DIST, 'universe', '404.html')).pipe(response); return; }
  response.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(response);
}).listen(port, '127.0.0.1', () => console.log(`Universe preview: http://127.0.0.1:${port}/universe/`));
