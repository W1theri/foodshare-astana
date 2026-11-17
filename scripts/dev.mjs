import { createReadStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleApi } from '../server/api.js';
import { openCatalogue } from '../server/sqlite.js';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
const data = process.env.FOODSHARE_DATA_DIR ?? fileURLToPath(new URL('../.foodshare/', import.meta.url));
const port = Number(process.env.FOODSHARE_PORT || 4173);
await mkdir(data, { recursive: true });
const db = await openCatalogue(resolve(data, 'catalogue.sqlite'));
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

createServer(async (request, response) => {
  if (request.url?.startsWith('/api/')) {
    try {
      const headers = new Headers();
      for (const key of ['origin', 'cookie', 'authorization', 'content-type', 'content-length']) {
        if (typeof request.headers[key] === 'string') headers.set(key, request.headers[key]);
      }
      const host = request.headers.host;
      if (host !== `localhost:${port}` && host !== `127.0.0.1:${port}`) {
        response.writeHead(403).end();
        return;
      }
      const body = request.method === 'POST' ? request : undefined;
      const input = new Request(`http://${host}${request.url}`, { method: request.method, headers, body, duplex: 'half' });
      const output = await handleApi(input, { DB: db, LOCAL_DEMO: true });
      response.writeHead(output.status, Object.fromEntries(output.headers));
      response.end(Buffer.from(await output.arrayBuffer()));
    } catch {
      response.writeHead(500).end();
    }
    return;
  }
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = resolve(root, pathname === '/' ? 'index.html' : '.' + pathname);
    const requested = relative(root, file);
    if (requested === '..' || requested.startsWith('..' + sep) || isAbsolute(requested)) {
      response.writeHead(403).end();
      return;
    }
    const info = await stat(file);
    if (!info.isFile()) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      'Content-Type': types[extname(file)] ?? 'application/octet-stream',
      'Content-Length': info.size,
      'Cache-Control': 'no-cache',
    });
    if (request.method === 'HEAD') response.end();
    else createReadStream(file).on('error', () => response.destroy()).pipe(response);
  } catch {
    response.writeHead(404).end();
  }
}).listen(port, '127.0.0.1', () => console.log(`FoodShare is running at http://localhost:${port}`));
