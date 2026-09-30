import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import { Api, type FriendView } from '../src/server/api';
import { Lobby } from '../src/server/lobby';
import { MAX_FRIENDS, Store } from '../src/server/store';
import { PROTOCOL_VERSION, type ServerMessage } from '../src/shared/protocol';

const store = new Store(':memory:');
const api = new Api(store);
const lobby = new Lobby(store);
api.presence = (ids) => lobby.presence(ids);
const server = createServer((req, res) => void api.handle(req, res, new URL(req.url ?? '/', 'http://x').pathname));
const wss = new WebSocketServer({ server, path: '/ws' });
let base = '';

beforeAll(async () => {
  wss.on('connection', (ws) => {
    ws.on('message', (d, bin) => lobby.handleMessage(ws, d as Buffer, bin));
    ws.on('close', () => lobby.handleClose(ws));
  });
  lobby.start();
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  lobby.stop();
  wss.close();
  server.close();
});

async function call(path: string, token: string, body?: unknown) {
  const r = await fetch(base + path, body === undefined ? { headers: { authorization: `Bearer ${token}` } } : { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  return { status: r.status, body: (await r.json()) as { friends: FriendView[]; added?: string; message?: string } };
}

async function register(name: string): Promise<{ token: string; id: number }> {
  const r = await fetch(`${base}/api/account/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, password: 'password123' }) });
  const token = ((await r.json()) as { token: string }).token;
  const me = (await (await fetch(`${base}/api/me`, { headers: { authorization: `Bearer ${token}` } })).json()) as { account: { id: number } };
  return { token, id: me.account.id };
}

describe('friends', () => {
  it('request, accept, see each other online and in a match, join by code, and unfriend', async () => {
    const a = await register('Friendly');
    const b = await register('Buddyboy');
    // Guests can't; unknown names and yourself are refused.
    expect((await fetch(`${base}/api/friends`)).status).toBe(401);
    expect((await call('/api/friends/add', a.token, { name: 'Nobodyhere' })).status).toBe(400);
    expect((await call('/api/friends/add', a.token, { name: 'friendly' })).status).toBe(400);

    const sent = await call('/api/friends/add', a.token, { name: 'buddyboy' });
    expect(sent.body.added).toBe('sent');
    expect(sent.body.friends).toMatchObject([{ id: b.id, status: 'outgoing' }]);
    const bList = await call('/api/friends', b.token);
    expect(bList.body.friends).toMatchObject([{ id: a.id, name: 'Friendly', status: 'incoming' }]);
    // Only the one asked can accept.
    expect((await call('/api/friends/accept', a.token, { id: b.id })).status).toBe(404);
    const acc = await call('/api/friends/accept', b.token, { id: a.id });
    expect(acc.body.friends[0].status).toBe('friends');
    // B has had the game open just now: online.
    expect((await call('/api/friends', a.token)).body.friends[0].online).toBe(true);

    // B plays in a room: A sees the mode and gets a code to join.
    const ws = new WebSocket(`${base.replace('http', 'ws')}/ws`);
    const msgs: ServerMessage[] = [];
    ws.on('message', (d, bin) => {
      if (!bin) msgs.push(JSON.parse(String(d)));
    });
    await new Promise((r) => ws.once('open', r));
    ws.send(JSON.stringify({ type: 'hello', v: PROTOCOL_VERSION, name: 'x', guestId: 'guest-friendsb1', join: { kind: 'create', settings: { mode: 'teamKnockout' } }, token: b.token }));
    for (let i = 0; i < 100 && !msgs.some((m) => m.type === 'welcome'); i++) await new Promise((r) => setTimeout(r, 10));
    const code = (msgs.find((m) => m.type === 'welcome') as Extract<ServerMessage, { type: 'welcome' }>).room.code;
    const seen = (await call('/api/friends', a.token)).body.friends[0];
    expect(seen.playing).toMatchObject({ code, mode: 'teamKnockout', joinable: true, private: true });
    ws.close();

    // Asking someone who already asked you makes you friends straight away.
    const c = await register('Crossask');
    await call('/api/friends/add', c.token, { name: 'Friendly' });
    expect((await call('/api/friends/add', a.token, { name: 'Crossask' })).body.added).toBe('friends');

    await call('/api/friends/remove', a.token, { id: b.id });
    expect((await call('/api/friends', b.token)).body.friends).toEqual([]);
  });

  it('join a friend wherever they are, and invite friends into your match', async () => {
    const a = await register('Followme');
    const b = await register('Follower');
    const stranger = await register('Strangeone');
    await call('/api/friends/add', a.token, { name: 'Follower' });
    await call('/api/friends/accept', b.token, { id: a.id });
    // Not in a match yet: nothing to invite them into.
    expect((await call('/api/friends/invite', a.token, { id: b.id })).status).toBe(400);
    const connect = async (token: string, join: unknown, guestId: string) => {
      const ws = new WebSocket(`${base.replace('http', 'ws')}/ws`);
      const msgs: ServerMessage[] = [];
      ws.on('message', (d, bin) => {
        if (!bin) msgs.push(JSON.parse(String(d)));
      });
      await new Promise((r) => ws.once('open', r));
      ws.send(JSON.stringify({ type: 'hello', v: PROTOCOL_VERSION, name: 'x', guestId, join, token }));
      for (let i = 0; i < 100 && !msgs.some((m) => m.type === 'welcome' || m.type === 'error'); i++) await new Promise((r) => setTimeout(r, 10));
      return { ws, msg: msgs.find((m) => m.type === 'welcome' || m.type === 'error')! };
    };
    const host = await connect(a.token, { kind: 'quick', mode: 'teamKnockout', open: true }, 'guest-follow-a');
    const code = (host.msg as Extract<ServerMessage, { type: 'welcome' }>).room.code;
    // A invites B: B sees it on their list, with the mode.
    expect((await call('/api/friends/invite', a.token, { id: b.id })).status).toBe(200);
    expect((await call('/api/friends/invite', a.token, { id: stranger.id })).status).toBe(404);
    const seen = (await call('/api/friends', b.token)).body.friends.find((f) => f.id === a.id)!;
    expect(seen.invite?.mode).toBe('teamKnockout');
    // B follows A straight into their room; a stranger can't.
    const follow = await connect(b.token, { kind: 'friend', id: a.id }, 'guest-follow-b');
    expect(follow.msg.type).toBe('welcome');
    expect((follow.msg as Extract<ServerMessage, { type: 'welcome' }>).room.code).toBe(code);
    const nope = await connect(stranger.token, { kind: 'friend', id: a.id }, 'guest-follow-c');
    expect(nope.msg).toMatchObject({ type: 'error', code: 'not_found' });
    // Together now: the invite is spent.
    expect((await call('/api/friends', b.token)).body.friends.find((f) => f.id === a.id)!.invite).toBeUndefined();
    for (const x of [host, follow, nope]) x.ws.close();
  });

  it('caps friends and requests', () => {
    const s = new Store(':memory:');
    const ids: number[] = [];
    for (let i = 0; i <= MAX_FRIENDS + 1; i++) {
      s.db.prepare("INSERT INTO accounts (name, name_lower, pass, recovery, created_at) VALUES (?, ?, 'x', 'x', 0)").run(`p${i}`, `p${i}`);
      ids.push(i + 1);
    }
    for (let i = 1; i <= MAX_FRIENDS; i++) expect(s.requestFriend(ids[0], `p${i}`).ok).toBe(true);
    const over = s.requestFriend(ids[0], `p${MAX_FRIENDS + 1}`);
    expect(over.ok).toBe(false);
  });
});
