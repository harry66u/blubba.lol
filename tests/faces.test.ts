import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import { Api } from '../src/server/api';
import { Lobby } from '../src/server/lobby';
import { FACE_HIDE_REPORTS, Store } from '../src/server/store';
import { PROTOCOL_VERSION, type RosterEntry, type ServerMessage } from '../src/shared/protocol';

const ADMIN = 'test-admin-token-123';
const store = new Store(':memory:');
const api = new Api(store);
const lobby = new Lobby(store);
api.onProfileChange = (key) => lobby.profileChanged(key);
const server = createServer((req, res) => void api.handle(req, res, new URL(req.url ?? '/', 'http://x').pathname));
const wss = new WebSocketServer({ server, path: '/ws' });
let base = '';

beforeAll(async () => {
  process.env.BUBBA_ADMIN_TOKEN = ADMIN;
  wss.on('connection', (ws) => {
    ws.on('message', (d, bin) => lobby.handleMessage(ws, d as Buffer, bin));
    ws.on('close', () => lobby.handleClose(ws));
  });
  lobby.start();
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  delete process.env.BUBBA_ADMIN_TOKEN;
  lobby.stop();
  wss.close();
  server.close();
});

/** A stand-in PNG (the server checks the type and size, it doesn't decode pixels). */
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(400, 7)]);
const dataUrl = (b: Buffer, mime = 'image/png') => `data:${mime};base64,${b.toString('base64')}`;

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  const r = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
}

async function register(name: string): Promise<{ token: string; id: number }> {
  const r = await post('/api/account/register', { name, password: 'password123' });
  const token = r.body.token as string;
  const me = (await (await fetch(`${base}/api/me`, { headers: { authorization: `Bearer ${token}` } })).json()) as { account: { id: number } };
  return { token, id: me.account.id };
}

class Client {
  ws: WebSocket;
  msgs: ServerMessage[] = [];
  constructor() {
    this.ws = new WebSocket(`${base.replace('http', 'ws')}/ws`);
    this.ws.on('message', (data, isBinary) => {
      if (!isBinary) this.msgs.push(JSON.parse(String(data)));
    });
  }
  async join(join: unknown, token?: string): Promise<number> {
    await new Promise((r) => this.ws.once('open', r));
    this.ws.send(JSON.stringify({ type: 'hello', v: PROTOCOL_VERSION, name: 'Player', guestId: `guest-${Math.random().toString(36).slice(2, 12)}`, join, token }));
    const w = await this.waitFor((m) => m.type === 'welcome');
    return (w as Extract<ServerMessage, { type: 'welcome' }>).you;
  }
  async waitFor(pred: (m: ServerMessage) => boolean, ms = 4000): Promise<ServerMessage> {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const m = [...this.msgs].reverse().find(pred);
      if (m) return m;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error('timed out');
  }
  roster(id: number): RosterEntry | undefined {
    const r = [...this.msgs].reverse().find((m) => m.type === 'roster') as Extract<ServerMessage, { type: 'roster' }> | undefined;
    return r?.players.find((p) => p.id === id);
  }
}

describe('face scans', () => {
  it('only accounts can scan, only their own face, and only real images', async () => {
    const guest = await post('/api/face', { image: dataUrl(PNG), mine: true }, { 'x-guest-id': 'guest-abcdefgh' });
    expect(guest.status).toBe(401);
    const a = await register('FaceOwner');
    const auth = { authorization: `Bearer ${a.token}` };
    expect((await post('/api/face', { image: dataUrl(PNG) }, auth)).status).toBe(400);
    expect((await post('/api/face', { image: dataUrl(Buffer.alloc(400, 1)), mine: true }, auth)).status).toBe(400);
    expect((await post('/api/face', { image: dataUrl(PNG, 'image/gif'), mine: true }, auth)).status).toBe(400);
    const ok = await post('/api/face', { image: dataUrl(PNG), mine: true }, auth);
    expect(ok.status).toBe(200);
    const img = await fetch(`${base}/api/face/${a.id}`);
    expect(img.status).toBe(200);
    expect(img.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await img.arrayBuffer()).equals(PNG)).toBe(true);
    const me = (await (await fetch(`${base}/api/me`, { headers: auth })).json()) as { face: { version: number; hidden: boolean } };
    expect(me.face.version).toBeGreaterThan(0);
    expect(me.face.hidden).toBe(false);
    // Removing your own face.
    await post('/api/face/remove', {}, auth);
    expect((await fetch(`${base}/api/face/${a.id}`)).status).toBe(404);
  });

  it('shows in matches, hides after enough reports, and admins can remove, ban or restore any face', async () => {
    const a = await register('Scanned');
    const auth = { authorization: `Bearer ${a.token}` };
    await post('/api/face', { image: dataUrl(PNG), mine: true }, auth);
    const owner = new Client();
    const ownerId = await owner.join({ kind: 'create' }, a.token);
    const code = (owner.msgs.find((m) => m.type === 'welcome') as Extract<ServerMessage, { type: 'welcome' }>).room.code;
    await owner.waitFor((m) => m.type === 'roster' && !!m.players.find((p) => p.id === ownerId)?.face);
    expect(owner.roster(ownerId)?.face?.account).toBe(a.id);

    // Different players report it: it hides itself.
    const reporters: Client[] = [];
    for (let i = 0; i < FACE_HIDE_REPORTS; i++) {
      const c = new Client();
      await c.join({ kind: 'code', code });
      c.ws.send(JSON.stringify({ type: 'report', target: ownerId, reason: 'face' }));
      reporters.push(c);
    }
    await owner.waitFor((m) => m.type === 'roster' && !!m.players.find((p) => p.id === ownerId) && !m.players.find((p) => p.id === ownerId)!.face);
    expect((await fetch(`${base}/api/face/${a.id}`)).status).toBe(404);

    // The admin endpoints need the token.
    expect((await fetch(`${base}/api/admin/faces`)).status).toBe(404);
    const admin = { 'x-admin-token': ADMIN };
    const list = (await (await fetch(`${base}/api/admin/faces`, { headers: admin })).json()) as { faces: { id: number; hidden: boolean; reports: number }[] };
    expect(list.faces.find((f) => f.id === a.id)).toMatchObject({ hidden: true, reports: FACE_HIDE_REPORTS });
    expect((await fetch(`${base}/api/admin/face/${a.id}`, { headers: admin })).status).toBe(200);
    // Restore brings it back into the match.
    await post('/api/admin/face', { id: a.id, action: 'restore' }, admin);
    await owner.waitFor((m) => m.type === 'roster' && !!m.players.find((p) => p.id === ownerId)?.face);
    // Ban: gone, and no new uploads.
    await post('/api/admin/face', { id: a.id, action: 'ban' }, admin);
    expect((await fetch(`${base}/api/face/${a.id}`)).status).toBe(404);
    expect((await post('/api/face', { image: dataUrl(PNG), mine: true }, auth)).status).toBe(403);
    await owner.waitFor((m) => m.type === 'roster' && !!m.players.find((p) => p.id === ownerId) && !m.players.find((p) => p.id === ownerId)!.face);
    for (const c of [owner, ...reporters]) c.ws.close();
  });
});
