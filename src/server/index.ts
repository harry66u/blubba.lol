import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { brotliCompressSync, gzipSync, constants as zlibConstants } from 'node:zlib';
import pg from 'pg';
import { WebSocketServer } from 'ws';
import { ADMIN_HTML } from './adminPage';
import { Api } from './api';
import { Lobby } from './lobby';
import { Store, validGuestId } from './store';

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
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
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
  console.warn(`[blubba] no client build found in ${CLIENT_DIR}; run "npm run build" first`);
}

const store = new Store();
await connectDatabase(store);
const api = new Api(store);
const lobby = new Lobby(store);
api.onProfileChange = (key) => lobby.profileChanged(key);
api.presence = (ids) => lobby.presence(ids);
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
    res.end(JSON.stringify({ ok: true, ...lobby.stats(), ...store.storageInfo() }));
    return;
  }
  if (path === '/api/counts') {
    // Who's on and playing what right now, for the menu (polled every few seconds; the guest id
    // counts the asker as online).
    const id = url.searchParams.get('id');
    if (validGuestId(id)) lobby.seeBrowsing(id);
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(lobby.counts()));
    return;
  }
  if (path === '/admin') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex', 'x-frame-options': 'DENY' });
    res.end(ADMIN_HTML);
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
  // One bad message must never take the whole server (and every match on it) down.
  ws.on('message', (data, isBinary) => {
    try {
      lobby.handleMessage(ws, data as Buffer, isBinary);
    } catch (err) {
      console.error('[ws] message handler failed', err);
    }
  });
  ws.on('close', () => {
    clearInterval(heartbeat);
    try {
      lobby.handleClose(ws);
    } catch (err) {
      console.error('[ws] close handler failed', err);
    }
  });
  ws.on('error', () => ws.close());
});

// Can't listen (port taken, no permission): exit so the host restarts us, rather than living on
// as a server nobody can reach.
server.on('error', (err) => {
  console.error('[blubba] server error:', err);
  process.exit(1);
});
server.listen(PORT, () => {
  console.log(`[blubba] server listening on http://localhost:${PORT}${DEV ? ' (dev: client served by Vite on :5173)' : ''}`);
});

// A bug somewhere shouldn't disconnect every player: log it and keep serving. If errors pour in,
// exit and let the host restart a clean process.
let crashes: number[] = [];
function survive(kind: string, err: unknown): void {
  console.error(`[blubba] ${kind}:`, err);
  const now = Date.now();
  crashes = crashes.filter((t) => now - t < 60_000);
  crashes.push(now);
  if (crashes.length > 50) {
    console.error('[blubba] too many errors in a minute; restarting');
    process.kill(process.pid, 'SIGTERM');
  }
}
process.on('uncaughtException', (err) => survive('uncaught exception', err));
process.on('unhandledRejection', (err) => survive('unhandled rejection', err));

let stopping = false;
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    if (stopping) return;
    stopping = true;
    lobby.stop();
    // 1012 "service restart": clients show "updating" and reconnect on their own.
    for (const c of wss.clients) c.close(1012, 'Server restarting');
    wss.close();
    server.close();
    // Finish saving to the database before exiting (hosts allow several seconds after SIGTERM).
    setTimeout(() => process.exit(0), 9000).unref();
    void store.shutdown(8000).finally(() => process.exit(0));
  });
}

/**
 * With DATABASE_URL set, accounts and progress are kept in Postgres, so they survive hosts that
 * wipe the disk on every restart or deploy. Waits (retrying) until the database answers, so a
 * new deploy only goes live once everyone's data is loaded.
 */
async function connectDatabase(store: Store): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    if (process.env.RENDER) {
      console.warn('[blubba] WARNING: no DATABASE_URL set. Accounts and progress are saved to this server\'s disk, which Render wipes on every restart and deploy unless a persistent disk is attached at /data. See README "Keeping accounts".');
    }
    return;
  }
  const parsed = new URL(url);
  const local = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
  const sslOff = parsed.searchParams.get('sslmode') === 'disable' || process.env.PGSSLMODE === 'disable';
  // Hosted Postgres (Supabase, Neon, ...) needs TLS; their certificates aren't in Node's default
  // store, so the connection is encrypted without verifying the chain.
  parsed.searchParams.delete('sslmode');
  const pool = new pg.Pool({ connectionString: parsed.toString(), ssl: local || sslOff ? false : { rejectUnauthorized: false }, max: 3, connectionTimeoutMillis: 10_000 });
  pool.on('error', (e) => console.error('[blubba] database connection error:', e.message));
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await store.attachMirror(pool);
      console.log(`[blubba] database ready (${parsed.hostname}): ${r.accounts} accounts, ${r.profiles} profiles${r.uploaded ? ' (uploaded from the local file)' : ''}`);
      return;
    } catch (e) {
      console.error(`[blubba] database not reachable (attempt ${attempt}), retrying in 3 s: ${e instanceof Error ? e.message : e}`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}
