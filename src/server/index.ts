import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { brotliCompressSync, gzipSync, constants as zlibConstants } from 'node:zlib';
import { WebSocketServer } from 'ws';
import { Api } from './api';
import { Lobby } from './lobby';
import { Store } from './store';

const PORT = Number(process.env.PORT ?? 8080);
const DEV = process.env.BUBBA_DEV === '1';
const CLIENT_DIR = resolve(process.env.BUBBA_CLIENT_DIR ?? 'dist/client');

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
};

interface StaticFile {
  body: Buffer;
  gzip: Buffer | null;
  br: Buffer | null;
  type: string;
  immutable: boolean;
}

/** Loads the built client into memory with precompressed variants for fast first loads. */
function loadStatic(dir: string): Map<string, StaticFile> {
  const files = new Map<string, StaticFile>();
  const walk = (d: string, prefix: string) => {
    let entries: string[] = [];
    try {
      entries = readdirSync(d);
    } catch {
      return;
    }
    for (const name of entries) {
      const full = join(d, name);
      const url = `${prefix}/${name}`;
      if (statSync(full).isDirectory()) {
        walk(full, url);
        continue;
      }
      const body = readFileSync(full);
      const type = TYPES[extname(name)] ?? 'application/octet-stream';
      const compressible = /text|javascript|json|svg|manifest/.test(type) && body.length > 512;
      files.set(url, {
        body,
        type,
        gzip: compressible ? gzipSync(body, { level: 9 }) : null,
        br: compressible ? brotliCompressSync(body, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 } }) : null,
        immutable: url.startsWith('/assets/'),
      });
    }
  };
  walk(dir, '');
  return files;
}

const files = DEV ? new Map<string, StaticFile>() : loadStatic(CLIENT_DIR);
if (!DEV && !files.has('/index.html')) {
  console.warn(`[bubba] no client build found in ${CLIENT_DIR}; run "npm run build" first`);
}

const store = new Store();
const api = new Api(store);
const lobby = new Lobby(store);
api.onProfileChange = (key) => lobby.profileChanged(key);
lobby.start();

function serveStatic(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? '/', 'http://x');
  let path: string;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400, { 'content-type': 'text/plain' });
    res.end('Bad request');
    return;
  }
  if (path === '/api/health') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ ok: true, ...lobby.stats() }));
    return;
  }
  if (path.startsWith('/api/')) {
    void api.handle(req, res, path);
    return;
  }
  let file = files.get(path);
  if (!file) {
    // Room links (/r/CODE), challenge links (/c/CODE) and everything else load the app shell.
    path = '/index.html';
    file = files.get(path);
  }
  if (!file) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found. Build the client with "npm run build".');
    return;
  }
  const accept = String(req.headers['accept-encoding'] ?? '');
  const headers: Record<string, string> = {
    'content-type': file.type,
    'cache-control': file.immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    vary: 'accept-encoding',
    'x-content-type-options': 'nosniff',
  };
  let body = file.body;
  if (file.br && accept.includes('br')) {
    body = file.br;
    headers['content-encoding'] = 'br';
  } else if (file.gzip && accept.includes('gzip')) {
    body = file.gzip;
    headers['content-encoding'] = 'gzip';
  }
  headers['content-length'] = String(body.length);
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
}

const server = createServer(serveStatic);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024, perMessageDeflate: false });

wss.on('connection', (ws) => {
  ws.binaryType = 'nodebuffer';
  let alive = true;
  let pingSent = 0;
  ws.on('pong', () => {
    alive = true;
    lobby.setRtt(ws, Date.now() - pingSent);
  });
  const heartbeat = setInterval(() => {
    if (!alive) {
      ws.terminate();
      return;
    }
    alive = false;
    pingSent = Date.now();
    ws.ping();
  }, 5000);
  ws.on('message', (data, isBinary) => lobby.handleMessage(ws, data as Buffer, isBinary));
  ws.on('close', () => {
    clearInterval(heartbeat);
    lobby.handleClose(ws);
  });
  ws.on('error', () => ws.close());
});

server.listen(PORT, () => {
  console.log(`[bubba] server listening on http://localhost:${PORT}${DEV ? ' (dev: client served by Vite on :5173)' : ''}`);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    lobby.stop();
    wss.close();
    store.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000).unref();
  });
}
