import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { extname } from 'node:path';

const mime = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
};
const root = new URL('../dist/', import.meta.url);
const files = (await readdir(root)).filter(name => ['.html', '.css', '.js'].includes(extname(name)));
files.push(...(await readdir(new URL('assets/', root))).filter(name => mime[extname(name)]).map(name => 'assets/' + name));
const assets = Object.fromEntries(await Promise.all(files.sort().map(async name => [
  '/' + name, [mime[extname(name)], (await readFile(new URL(name, root))).toString('base64')],
])));
const domain = await readFile(new URL('domain.js', root), 'utf8');
const api = (await readFile(new URL('../server/api.js', import.meta.url), 'utf8')).replace(/^import .*?;\r?\n/, '');
const worker = `${domain}\n${api}
const assets = ${JSON.stringify(assets)};
export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path.startsWith('/api/')) return handleApi(request, env);
    if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', {status: 405});
    const asset = assets[path === '/' ? '/index.html' : path];
    if (!Array.isArray(asset)) return new Response('Page not found', {status: 404});
    const [type, encoded] = asset;
    const body = request.method === 'HEAD' ? null : Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
    return new Response(body, {headers: {
      'Content-Type': type, 'X-Content-Type-Options': 'nosniff',
      'Cache-Control': type.startsWith('image/') || type === 'font/woff2' ? 'public, max-age=3600' : 'no-cache',
    }});
  },
};
`;
await mkdir(new URL('server/', root), { recursive: true });
await writeFile(new URL('server/index.js', root), worker);
