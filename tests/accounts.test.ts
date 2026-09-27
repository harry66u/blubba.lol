import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import { Api } from '../src/server/api';
import { Lobby } from '../src/server/lobby';
import { Store, accountKey } from '../src/server/store';
import { PROTOCOL_VERSION, type ServerMessage } from '../src/shared/protocol';

const store = new Store(':memory:');
const api = new Api(store);
const lobby = new Lobby(store);
api.onProfileChange = (key) => lobby.profileChanged(key);
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
  base = `localhost:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  lobby.stop();
  wss.close();
  server.close();
});

class Client {
  ws: WebSocket;
  msgs: ServerMessage[] = [];
  closed = false;
  constructor() {
    this.ws = new WebSocket(`ws://${base}/ws`);
    this.ws.on('message', (data, isBinary) => {
      if (!isBinary) this.msgs.push(JSON.parse(String(data)));
    });
    this.ws.on('close', () => (this.closed = true));
  }
  open(): Promise<void> {
    return new Promise((r) => this.ws.once('open', () => r()));
  }
  send(o: unknown): void {
    this.ws.send(JSON.stringify(o));
  }
  async waitFor<T extends ServerMessage['type']>(type: T, pred: (m: Extract<ServerMessage, { type: T }>) => boolean = () => true, ms = 4000): Promise<Extract<ServerMessage, { type: T }>> {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const m = this.msgs.find((x) => x.type === type && pred(x as Extract<ServerMessage, { type: T }>));
      if (m) return m as Extract<ServerMessage, { type: T }>;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`timed out waiting for ${type}`);
  }
}

async function register(name: string): Promise<string> {
  const r = await fetch(`http://${base}/api/account/register`, { method: 'POST', body: JSON.stringify({ name, password: 'password123' }) });
  const b = (await r.json()) as { token: string };
  return b.token;
}

async function hello(c: Client, join: unknown, extra: Record<string, unknown> = {}) {
  await c.open();
  c.send({ type: 'hello', v: PROTOCOL_VERSION, name: 'Player', guestId: `guest-${Math.random().toString(36).slice(2, 12)}`, join, ...extra });
}

describe('accounts in the game', () => {
  it('uses the account name, gates loadouts by level, and pays out at match end', async () => {
    const token = await register('Zoomer');
    const c = new Client();
    await hello(c, { kind: 'create', settings: { bots: true } }, { token, name: 'ignored', loadout: { weapon: 'pumpRifle', mods: ['longBarrel'], utils: ['vacuumGrenade', 'bouncePad'] } });
    const w = await c.waitFor('welcome');
    expect(w.name).toBe('Zoomer');
    const room = lobby.rooms.get(w.room.code)!;
    const me = room.sim.players.get(w.you)!;
    // Level 1: weapon is fine, locked mod and utility are dropped.
    expect(me.loadout.weapon).toBe('pumpRifle');
    expect(me.loadout.mods).toEqual([]);
    expect(me.loadout.utils).not.toContain('vacuumGrenade');
    const roster = await c.waitFor('roster');
    expect(roster.players.find((p) => p.id === w.you)?.level).toBe(1);
    expect(roster.players.find((p) => p.bot)?.cos).toBeTruthy();

    // Pretend we played a full match with some knockouts, then end it.
    await new Promise((r) => setTimeout(r, 100));
    room.sim.matchStartedAt = room.sim.time - 200;
    me.joinedAt = room.sim.time - 200;
    me.stats.shots = 20;
    me.stats.kos = 5;
    me.score = 50;
    room.sim.phaseEndsAt = room.sim.time;
    const prog = await c.waitFor('progress');
    expect(prog.report.reward.xp).toBeGreaterThan(100);
    expect(prog.report.levelAfter).toBeGreaterThanOrEqual(2);
    expect(prog.report.unlocked).toContain('wideNozzle');
    expect(prog.report.profile.stats.matches).toBe(1);
    expect(prog.report.profile.coins).toBeGreaterThan(0);
    const saved = store.profile(accountKey(store.accountByName('zoomer')!.id));
    expect(saved.stats.kos).toBe(5);
    c.ws.close();
  });

  it('guests cannot take an account name', async () => {
    const c = new Client();
    await hello(c, { kind: 'quick' }, { name: 'Zoomer' });
    const w = await c.waitFor('welcome');
    expect(w.name).not.toBe('Zoomer');
    expect(w.name.toLowerCase()).not.toBe('zoomer');
    c.ws.close();
  });

  it('shows purchases in a running match', async () => {
    const token = await register('Shopper');
    const key = accountKey(store.accountByName('Shopper')!.id);
    store.profile(key).coins = 1000;
    const c = new Client();
    await hello(c, { kind: 'create' }, { token });
    const w = await c.waitFor('welcome');
    await fetch(`http://${base}/api/store/buy`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ itemId: 'hat.viking' }) });
    const r = await c.waitFor('roster', (m) => m.players.some((p) => p.id === w.you && p.cos.hat === 'hat.viking'));
    expect(r).toBeTruthy();
    c.ws.close();
  });

  it('quick chat is presets only and rate limited', async () => {
    const a = new Client();
    await hello(a, { kind: 'create' });
    const w = await a.waitFor('welcome');
    const b = new Client();
    await hello(b, { kind: 'code', code: w.room.code });
    await b.waitFor('welcome');
    a.send({ type: 'chat', id: 0 });
    a.send({ type: 'chat', id: 1 }); // too soon: dropped
    a.send({ type: 'chat', id: 99 }); // not a preset: dropped
    a.send({ type: 'chat', text: 'hello' });
    await b.waitFor('chat');
    await new Promise((r) => setTimeout(r, 300));
    const chats = b.msgs.filter((m) => m.type === 'chat');
    expect(chats).toEqual([{ type: 'chat', from: w.you, id: 0 }]);
    a.ws.close();
    b.ws.close();
  });

  it('reports are saved and three name reports rename the player', async () => {
    const target = new Client();
    await hello(target, { kind: 'create' }, { name: 'Grumbles' });
    const tw = await target.waitFor('welcome');
    const others: Client[] = [];
    for (let i = 0; i < 3; i++) {
      const o = new Client();
      await hello(o, { kind: 'code', code: tw.room.code });
      await o.waitFor('welcome');
      o.send({ type: 'report', target: tw.you, reason: 'name' });
      o.send({ type: 'report', target: tw.you, reason: 'name' }); // duplicate: ignored
      others.push(o);
    }
    const renamed = await target.waitFor('renamed');
    expect(renamed.name).not.toBe('Grumbles');
    expect(store.reports().filter((r) => r.target_name === 'Grumbles').length).toBe(3);
    for (const c of [target, ...others]) c.ws.close();
  });

  it('ranked needs an account, pairs two players, and settles ratings (leaving forfeits)', async () => {
    const guest = new Client();
    await hello(guest, { kind: 'ranked' });
    expect((await guest.waitFor('error')).code).toBe('account_required');

    const t1 = await register('RankA');
    const t2 = await register('RankB');
    const a = new Client();
    await hello(a, { kind: 'ranked' }, { token: t1 });
    await a.waitFor('queue');
    const again = new Client();
    await hello(again, { kind: 'ranked' }, { token: t1 });
    expect((await again.waitFor('error')).code).toBe('already');

    const b = new Client();
    await hello(b, { kind: 'ranked' }, { token: t2 });
    const aw = await a.waitFor('welcome', undefined, 4000);
    const bw = await b.waitFor('welcome', undefined, 4000);
    expect(aw.room.ranked).toBe(true);
    expect(aw.room.code).toBe(bw.room.code);
    const room = lobby.rooms.get(aw.room.code)!;
    expect(room.sim.bots.size).toBe(0);
    // Nobody else can walk in.
    const c = new Client();
    await hello(c, { kind: 'code', code: aw.room.code });
    expect((await c.waitFor('error')).code).toBe('not_found');

    // B rage-quits mid-match: A wins by forfeit.
    b.ws.close();
    const prog = await a.waitFor('progress');
    expect(prog.report.rating?.after).toBeGreaterThan(prog.report.rating!.before);
    const pa = store.profile(accountKey(store.accountByName('RankA')!.id));
    const pb = store.profile(accountKey(store.accountByName('RankB')!.id));
    expect(pa.rating).toBeGreaterThan(1000);
    expect(pb.rating).toBeLessThan(1000);
    expect(pa.rankedGames).toBe(1);
    const lb = await fetch(`http://${base}/api/leaderboard`).then((r) => r.json());
    expect(lb.players[0].name).toBe('RankA');
    a.ws.close();
  });
});
