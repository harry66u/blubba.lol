import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import { emptyInput } from '../src/shared/input';
import { MSG_SNAPSHOT, PROTOCOL_VERSION, type ServerMessage, type Snapshot, decodeSnapshot, encodeInputs } from '../src/shared/protocol';
import { Lobby } from '../src/server/lobby';
import { Room } from '../src/server/room';
import { KNOCKOUT_MAPS } from '../src/shared/maps';
import { BALANCE } from '../src/shared/balance';

let port = 0;
const lobby = new Lobby();
const server = createServer();
const wss = new WebSocketServer({ server, path: '/ws' });

beforeAll(async () => {
  wss.on('connection', (ws) => {
    ws.on('message', (d, bin) => lobby.handleMessage(ws, d as Buffer, bin));
    ws.on('close', () => lobby.handleClose(ws));
  });
  lobby.start();
  await new Promise<void>((r) => server.listen(0, r));
  port = (server.address() as AddressInfo).port;
});

afterAll(() => {
  lobby.stop();
  wss.close();
  server.close();
});

class TestClient {
  ws: WebSocket;
  msgs: ServerMessage[] = [];
  snaps: Snapshot[] = [];
  constructor() {
    this.ws = new WebSocket(`ws://localhost:${port}/ws`);
    this.ws.binaryType = 'arraybuffer';
    this.ws.on('message', (data, isBinary) => {
      if (isBinary) {
        const buf = data as ArrayBuffer;
        const v = new DataView(buf);
        if (v.getUint8(0) === MSG_SNAPSHOT) this.snaps.push(decodeSnapshot(v));
      } else {
        this.msgs.push(JSON.parse(String(data)));
      }
    });
  }
  open(): Promise<void> {
    return new Promise((r) => this.ws.once('open', () => r()));
  }
  send(o: unknown): void {
    this.ws.send(JSON.stringify(o));
  }
  async waitFor<T extends ServerMessage['type']>(type: T, ms = 3000): Promise<Extract<ServerMessage, { type: T }>> {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const m = this.msgs.find((x) => x.type === type);
      if (m) return m as Extract<ServerMessage, { type: T }>;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`timed out waiting for ${type}`);
  }
}

describe('server', () => {
  it('quick play joins a public room with bots and streams snapshots', async () => {
    const c = new TestClient();
    await c.open();
    c.send({ type: 'hello', v: PROTOCOL_VERSION, name: 'Tester', guestId: 'g1', join: { kind: 'quick' } });
    const welcome = await c.waitFor('welcome');
    expect(welcome.room.isPrivate).toBe(false);
    const roster = await c.waitFor('roster');
    expect(roster.players.filter((p) => p.bot).length).toBeGreaterThanOrEqual(3);
    await new Promise((r) => setTimeout(r, 300));
    expect(c.snaps.length).toBeGreaterThan(3);
    const last = c.snaps[c.snaps.length - 1];
    expect(last.selfId).toBe(welcome.you);
    expect(last.self).not.toBeNull();
    c.ws.close();
  });

  it('moves the player when inputs arrive', async () => {
    const c = new TestClient();
    await c.open();
    c.send({ type: 'hello', v: PROTOCOL_VERSION, name: 'Mover', guestId: 'g2', join: { kind: 'create', settings: { bots: false } } });
    await c.waitFor('welcome');
    await new Promise((r) => setTimeout(r, 150));
    const start = c.snaps[c.snaps.length - 1].self!;
    let seq = 0;
    for (let i = 0; i < 30; i++) {
      const f = emptyInput();
      f.seq = ++seq;
      f.moveZ = 1;
      f.yaw = start.yaw;
      c.ws.send(encodeInputs([f]));
      await new Promise((r) => setTimeout(r, 16));
    }
    await new Promise((r) => setTimeout(r, 200));
    const end = c.snaps[c.snaps.length - 1];
    expect(end.ackSeq).toBe(seq);
    const moved = Math.hypot(end.self!.px - start.px, end.self!.pz - start.pz);
    expect(moved).toBeGreaterThan(2);
    c.ws.close();
  });

  it('private rooms are joinable by code and the host can kick', async () => {
    const host = new TestClient();
    await host.open();
    host.send({ type: 'hello', v: PROTOCOL_VERSION, name: 'Host', guestId: 'h', join: { kind: 'create' } });
    const hw = await host.waitFor('welcome');
    expect(hw.room.isPrivate).toBe(true);
    expect(hw.room.code).toMatch(/^[A-Z0-9]{5}$/);
    const guest = new TestClient();
    await guest.open();
    guest.send({ type: 'hello', v: PROTOCOL_VERSION, name: 'Guest', guestId: 'guest-1', join: { kind: 'code', code: hw.room.code.toLowerCase() } });
    const gw = await guest.waitFor('welcome');
    expect(gw.room.code).toBe(hw.room.code);
    expect(gw.room.hostId).toBe(hw.you);
    host.send({ type: 'host', action: 'kick', id: gw.you });
    const err = await guest.waitFor('error');
    expect(err.code).toBe('kicked');
    // Kicked players can't come straight back.
    const again = new TestClient();
    await again.open();
    again.send({ type: 'hello', v: PROTOCOL_VERSION, name: 'Guest', guestId: 'guest-1', join: { kind: 'code', code: hw.room.code } });
    expect((await again.waitFor('error')).code).toBe('kicked');
    host.ws.close();
  });

  it('rejects unknown room codes and replaces bad names', async () => {
    const c = new TestClient();
    await c.open();
    c.send({ type: 'hello', v: PROTOCOL_VERSION, name: 'x', guestId: 'z', join: { kind: 'code', code: 'ZZZZZ' } });
    expect((await c.waitFor('error')).code).toBe('not_found');
    const d = new TestClient();
    await d.open();
    d.send({ type: 'hello', v: PROTOCOL_VERSION, name: 'fuckface', guestId: 'z2', join: { kind: 'quick' } });
    const w = await d.waitFor('welcome');
    expect(w.name).not.toMatch(/fuck/i);
    d.ws.close();
  });

  it('quick play for a team mode fills a 4v4 with bots on the right map', async () => {
    const c = new TestClient();
    await c.open();
    c.send({ type: 'hello', v: PROTOCOL_VERSION, name: 'Baller', guestId: 'b1', join: { kind: 'quick', mode: 'ball' } });
    const w = await c.waitFor('welcome');
    expect(w.room.settings.mode).toBe('ball');
    expect(w.room.mapId).toBe('ballArena');
    await new Promise((r) => setTimeout(r, 150));
    const roster = [...c.msgs].reverse().find((m): m is Extract<ServerMessage, { type: 'roster' }> => m.type === 'roster')!;
    expect(roster.players.length).toBe(8);
    expect(roster.players.filter((p) => p.team === 0).length).toBe(4);
    const snap = c.snaps[c.snaps.length - 1];
    expect(snap.mode?.ball).toBeTruthy();
    expect(snap.mode?.teamScores).toEqual([0, 0]);
    c.ws.close();
  });

  it('quick play Sudden Death fills to 6 with bots; someone joining mid-match waits it out', async () => {
    const a = new TestClient();
    await a.open();
    a.send({ type: 'hello', v: PROTOCOL_VERSION, name: 'Lasty', guestId: 'sd1', join: { kind: 'quick', mode: 'suddenDeath' } });
    const w = await a.waitFor('welcome');
    expect(w.room.settings.mode).toBe('suddenDeath');
    await new Promise((r) => setTimeout(r, 150));
    const lastRoster = (c: TestClient) => [...c.msgs].reverse().find((m): m is Extract<ServerMessage, { type: 'roster' }> => m.type === 'roster')!;
    expect(lastRoster(a).players.length).toBe(6);
    // Clients get the server's shrink schedule with the match.
    const match = [...a.msgs].reverse().find((m): m is Extract<ServerMessage, { type: 'match' }> => m.type === 'match')!;
    expect(match.phase).toBe('playing');
    expect(match.collapse.filter((s) => s.announce).length).toBeGreaterThanOrEqual(3);
    // Pretend the round has been going for a while, then a second player arrives.
    const room = lobby.rooms.get(w.room.code)!;
    room.sim.matchStartedAt -= 20;
    room.sim.sdRoundStartedAt -= 20;
    const b = new TestClient();
    await b.open();
    b.send({ type: 'hello', v: PROTOCOL_VERSION, name: 'Latey', guestId: 'sd2', join: { kind: 'quick', mode: 'suddenDeath' } });
    const bw = await b.waitFor('welcome');
    expect(bw.room.code).toBe(w.room.code);
    await new Promise((r) => setTimeout(r, 150));
    const roster = lastRoster(b).players;
    expect(roster.find((p) => p.id === bw.you)?.out).toBe(true);
    expect(roster.find((p) => p.id === w.you)?.out).toBeFalsy();
    // Nobody still in the fight was removed to make room: the extra bot waits for the next round.
    expect(roster.filter((p) => p.bot).length).toBe(5);
    a.ws.close();
    b.ws.close();
  });

  it('quick play on a picked map shares a room on that map, or opens one', async () => {
    const join = async (guestId: string, map?: string, mode = 'knockout') => {
      const c = new TestClient();
      await c.open();
      c.send({ type: 'hello', v: PROTOCOL_VERSION, name: 'Picker', guestId, join: { kind: 'quick', mode, map } });
      return { c, w: await c.waitFor('welcome') };
    };
    const a = await join('m1', 'candy');
    expect(a.w.room.mapId).toBe('candy');
    const b = await join('m2', 'candy');
    expect(b.w.room.code).toBe(a.w.room.code);
    const c = await join('m3', 'moonBase');
    expect(c.w.room.mapId).toBe('moonBase');
    expect(c.w.room.code).not.toBe(a.w.room.code);
    // Nonsense picks mean any map; modes with their own arena ignore the pick.
    const d = await join('m4', 'ballArena');
    expect(KNOCKOUT_MAPS).toContain(d.w.room.mapId);
    const e = await join('m5', 'candy', 'ball');
    expect(e.w.room.mapId).toBe('ballArena');
    for (const x of [a, b, c, d, e]) x.c.ws.close();
  });

  it('open rooms are public with no bots, and kept apart from bot-filled rooms', async () => {
    const join = async (guestId: string, open: boolean) => {
      const c = new TestClient();
      await c.open();
      c.send({ type: 'hello', v: PROTOCOL_VERSION, name: 'Opener', guestId, join: { kind: 'quick', mode: 'teamKnockout', open } });
      return { c, w: await c.waitFor('welcome') };
    };
    const a = await join('o1', true);
    expect(a.w.room.isPrivate).toBe(false);
    expect(a.w.room.settings.bots).toBe(false);
    const r = await a.c.waitFor('roster');
    expect(r.players.some((p) => p.bot)).toBe(false);
    // A second open-room player lands in the same room, no code needed; a regular player doesn't.
    const b = await join('o2', true);
    expect(b.w.room.code).toBe(a.w.room.code);
    const c = await join('o3', false);
    expect(c.w.room.code).not.toBe(a.w.room.code);
    expect(c.w.room.settings.bots).toBe(true);
    for (const x of [a, b, c]) x.c.ws.close();
  });

  it('private rooms wait in the lobby until the host starts, and go back after the match', async () => {
    const host = new TestClient();
    await host.open();
    host.send({ type: 'hello', v: PROTOCOL_VERSION, name: 'Hosty', guestId: 'h1', join: { kind: 'create', settings: { mode: 'ball', bots: false } } });
    const hw = await host.waitFor('welcome');
    const room = lobby.rooms.get(hw.room.code)!;
    const friend = new TestClient();
    await friend.open();
    friend.send({ type: 'hello', v: PROTOCOL_VERSION, name: 'Buddy', guestId: 'h2', join: { kind: 'code', code: hw.room.code } });
    await friend.waitFor('welcome');
    await new Promise((r) => setTimeout(r, 300));
    // Two players in, but nothing starts until the host says so.
    expect(room.sim.phase).toBe('waiting');
    friend.send({ type: 'host', action: 'start' });
    await new Promise((r) => setTimeout(r, 150));
    expect(room.sim.phase).toBe('waiting');
    // The host names the teams (rude words are dropped), then starts.
    host.send({ type: 'host', action: 'settings', settings: { teamNames: ['Gusty Bois', 'fuckers'] } });
    await new Promise((r) => setTimeout(r, 150));
    expect(room.settings.teamNames).toEqual(['Gusty Bois', '']);
    expect(room.sim.phase).toBe('waiting');
    friend.send({ type: 'host', action: 'settings', settings: { teamNames: ['Nope', 'Nope'] } });
    host.send({ type: 'host', action: 'start' });
    await new Promise((r) => setTimeout(r, 150));
    expect(room.settings.teamNames).toEqual(['Gusty Bois', '']);
    expect(room.sim.phase).toBe('playing');
    // After the results the room goes back to the lobby instead of starting another match.
    room.sim.endMatch();
    room.sim.phaseEndsAt = room.sim.time;
    await new Promise((r) => setTimeout(r, 150));
    expect(room.sim.phase).toBe('waiting');
    host.ws.close();
    friend.ws.close();
  });

  it('PLAY AGAIN: the host restarts a private room right away; a public room waits for everyone', async () => {
    const host = new TestClient();
    await host.open();
    host.send({ type: 'hello', v: PROTOCOL_VERSION, name: 'Againy', guestId: 'pa1', join: { kind: 'create', settings: { bots: false } } });
    const hw = await host.waitFor('welcome');
    const room = lobby.rooms.get(hw.room.code)!;
    const friend = new TestClient();
    await friend.open();
    friend.send({ type: 'hello', v: PROTOCOL_VERSION, name: 'Pal', guestId: 'pa2', join: { kind: 'code', code: hw.room.code } });
    const fw = await friend.waitFor('welcome');
    host.send({ type: 'host', action: 'start' });
    await new Promise((r) => setTimeout(r, 150));
    expect(room.sim.phase).toBe('playing');
    room.sim.endMatch();
    expect(room.sim.phase).toBe('results');
    // A guest pressing it only says they're ready...
    friend.send({ type: 'again' });
    const ready = await host.waitFor('again');
    expect(ready.ids).toEqual([fw.you]);
    expect(room.sim.phase).toBe('results');
    // ...the host pressing it starts the next match now.
    host.send({ type: 'again' });
    await new Promise((r) => setTimeout(r, 150));
    expect(room.sim.phase).toBe('playing');
    host.ws.close();
    friend.ws.close();

    // A public room with bots: the lone human pressing it skips the wait.
    const solo = new TestClient();
    await solo.open();
    solo.send({ type: 'hello', v: PROTOCOL_VERSION, name: 'Solo', guestId: 'pa3', join: { kind: 'quick', mode: 'suddenDeath' } });
    const sw = await solo.waitFor('welcome');
    const pub = lobby.rooms.get(sw.room.code)!;
    await new Promise((r) => setTimeout(r, 150));
    if (pub.sim.phase !== 'playing') pub.sim.startMatch();
    pub.sim.endMatch();
    const before = pub.sim.phaseEndsAt;
    expect(before).toBeGreaterThan(pub.sim.time + 5);
    solo.send({ type: 'again' });
    await new Promise((r) => setTimeout(r, 200));
    expect(lobby.rooms.get(sw.room.code)!.sim.phase).toBe('playing');
    solo.ws.close();
  });

  it('challenge links make a private 1v1 that the first visitor joins', async () => {
    const a = new TestClient();
    await a.open();
    a.send({ type: 'hello', v: PROTOCOL_VERSION, name: 'Challenger', guestId: 'c1', join: { kind: 'challenge' } });
    const aw = await a.waitFor('welcome');
    expect(aw.room.challenge).toBe(true);
    expect(aw.room.isPrivate).toBe(true);
    expect(aw.room.settings.mode).toBe('duel');
    // A sparring bot keeps the challenger busy until the rival shows up.
    const r1 = await a.waitFor('roster');
    expect(r1.players.filter((p) => p.bot).length).toBe(1);
    const b = new TestClient();
    await b.open();
    b.send({ type: 'hello', v: PROTOCOL_VERSION, name: 'Rival', guestId: 'c2', join: { kind: 'code', code: aw.room.code } });
    await b.waitFor('welcome');
    await new Promise((r) => setTimeout(r, 150));
    const roster = [...b.msgs].reverse().find((m): m is Extract<ServerMessage, { type: 'roster' }> => m.type === 'roster')!;
    expect(roster.players.length).toBe(2);
    expect(roster.players.some((p) => p.bot)).toBe(false);
    const c = new TestClient();
    await c.open();
    c.send({ type: 'hello', v: PROTOCOL_VERSION, name: 'Third', guestId: 'c3', join: { kind: 'code', code: aw.room.code } });
    expect((await c.waitFor('error')).code).toBe('full');
    a.ws.close();
    b.ws.close();
  });
});

describe('map rotation', () => {
  const fakeWs = () => ({ readyState: 1, OPEN: 1, bufferedAmount: 0, send() {}, close() {} }) as unknown as WebSocket;
  const endResults = (room: Room) => {
    room.sim.phase = 'results';
    room.sim.phaseEndsAt = room.sim.time;
    room.tick();
  };

  it('public rooms rotate through every knockout map, but stay on a map someone picked while they are in', () => {
    const room = new Room('ROTAT', false, { mode: 'knockout', mapId: 'candy' });
    const picker = room.join(fakeWs(), 'Picker', 'p1', undefined, undefined, 'candy')!;
    room.join(fakeWs(), 'Anyone', 'p2');
    endResults(room);
    expect(room.settings.mapId).toBe('candy');
    room.leave(picker.playerId);
    const seen = [room.settings.mapId];
    for (let i = 0; i < KNOCKOUT_MAPS.length; i++) {
      endResults(room);
      seen.push(room.settings.mapId);
    }
    expect(seen[1]).toBe(KNOCKOUT_MAPS[(KNOCKOUT_MAPS.indexOf('candy') + 1) % KNOCKOUT_MAPS.length]);
    expect(new Set(seen)).toEqual(new Set(KNOCKOUT_MAPS));
  });
});

describe('Team Knockout lobby', () => {
  const join = async (name: string, guestId: string, join: object) => {
    const c = new TestClient();
    await c.open();
    c.send({ type: 'hello', v: PROTOCOL_VERSION, name, guestId, join });
    const w = await c.waitFor('welcome');
    return { c, w };
  };
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const lastLobby = (c: TestClient) => [...c.msgs].reverse().find((m) => m.type === 'teamLobby') as Extract<ServerMessage, { type: 'teamLobby' }> | undefined;

  it('public rooms play on Face-Off with no bots, and start only when teams are full enough and everyone is ready', async () => {
    const T = BALANCE.modes.teamKnockout;
    const countdown = T.countdown;
    T.countdown = 0.3;
    try {
      const players = [];
      for (let i = 0; i < 3; i++) players.push(await join(`Teamy${i}`, `tk-open-${i}`, { kind: 'quick', mode: 'teamKnockout', open: true }));
      const room = lobby.rooms.get(players[0].w.room.code)!;
      expect(players.every((p) => p.w.room.code === room.code)).toBe(true);
      expect(room.settings.mapId).toBe('faceoff');
      expect(room.sim.bots.size).toBe(0);
      await wait(150);
      // Three players can't make two teams of two: still in the lobby, whatever anyone does.
      for (const p of players) p.c.send({ type: 'team', action: 'ready', ready: true });
      await wait(600);
      expect(room.sim.phase).toBe('waiting');
      expect(lastLobby(players[0].c)?.lobby.waiting).toMatch(/1 more player/);
      // A fourth: 2 v 2, but they aren't ready yet.
      const fourth = await join('Teamy3', 'tk-open-3', { kind: 'quick', mode: 'teamKnockout', open: true });
      players.push(fourth);
      await wait(150);
      const teams = [...room.sim.players.values()].map((p) => p.team);
      expect(teams.filter((t) => t === 0)).toHaveLength(2);
      expect(teams.filter((t) => t === 1)).toHaveLength(2);
      expect(room.sim.phase).toBe('waiting');
      expect(lastLobby(fourth.c)?.lobby.waiting).toMatch(/1 to ready up/);
      // Someone switching sides leaves the other team short (3 v 1): the countdown can't start.
      fourth.c.send({ type: 'team', action: 'ready', ready: true });
      const home = room.sim.players.get(players[0].w.you)!.team;
      players[0].c.send({ type: 'team', action: 'join', team: 1 - home });
      await wait(600);
      expect(room.sim.phase).toBe('waiting');
      expect(lastLobby(players[0].c)?.lobby.waiting).toBe('Need 2 per team: 1 more player');
      // Back again: even, all ready, a short countdown, and the match is on.
      players[0].c.send({ type: 'team', action: 'join', team: home });
      await wait(150);
      expect(lastLobby(players[0].c)?.lobby.startsAt).toBeGreaterThan(0);
      await wait(700);
      expect(room.sim.phase).toBe('playing');
      // After the results it's back to the team lobby, with nobody ready.
      room.sim.endMatch();
      room.sim.phaseEndsAt = room.sim.time;
      await wait(200);
      expect(room.sim.phase).toBe('waiting');
      expect(lastLobby(players[0].c)?.lobby.ready).toEqual([]);
      for (const p of players) p.c.ws.close();
    } finally {
      T.countdown = countdown;
    }
  });

  it('teams are dealt again after a match (evenly), unless the host locked them', async () => {
    const host = await join('Dealer', 'tk-redeal-h', { kind: 'create', settings: { mode: 'teamKnockout', bots: true } });
    const room = lobby.rooms.get(host.w.room.code)!;
    await wait(200);
    const teams = () => [...room.sim.players.values()].map((p) => `${p.id}:${p.team}`).join(',');
    const even = () => {
      const t = [...room.sim.players.values()].map((p) => p.team);
      return Math.abs(t.filter((x) => x === 0).length - t.filter((x) => x === 1).length) <= 1;
    };
    // A few matches: the lineup changes at least once, and it's always even.
    let changed = false;
    for (let i = 0; i < 4 && !changed; i++) {
      const before = teams();
      room.sim.startMatch();
      room.sim.endMatch();
      room.sim.phaseEndsAt = room.sim.time;
      await wait(150);
      expect(room.sim.phase).toBe('waiting');
      expect(even()).toBe(true);
      changed = teams() !== before;
    }
    expect(changed).toBe(true);
    // Locked: the teams stay as they are.
    host.c.send({ type: 'host', action: 'lock', locked: true });
    await wait(100);
    const locked = teams();
    room.sim.startMatch();
    room.sim.endMatch();
    room.sim.phaseEndsAt = room.sim.time;
    await wait(150);
    expect(teams()).toBe(locked);
    host.c.ws.close();
  });

  it('private rooms: bots only when the host turns them on; the host can shuffle and lock the teams', async () => {
    const host = await join('Capt', 'tk-priv-h', { kind: 'create', settings: { mode: 'teamKnockout' } });
    const room = lobby.rooms.get(host.w.room.code)!;
    expect(room.settings.mapId).toBe('faceoff');
    expect(room.settings.bots).toBe(false);
    expect(room.sim.bots.size).toBe(0);
    const friend = await join('Mate', 'tk-priv-f', { kind: 'code', code: room.code });
    // START does nothing here: the team lobby decides.
    host.c.send({ type: 'host', action: 'start' });
    await wait(150);
    expect(room.sim.phase).toBe('waiting');
    // Bots on: they fill both teams evenly, and they're always ready.
    host.c.send({ type: 'host', action: 'settings', settings: { bots: true } });
    await wait(200);
    expect(room.sim.bots.size).toBeGreaterThan(0);
    const count = (t: number) => [...room.sim.players.values()].filter((p) => p.team === t).length;
    expect(Math.abs(count(0) - count(1))).toBeLessThanOrEqual(1);
    // Locked: nobody can switch sides.
    host.c.send({ type: 'host', action: 'lock', locked: true });
    await wait(100);
    const f = room.sim.players.get(friend.w.you)!;
    const before = f.team;
    friend.c.send({ type: 'team', action: 'join', team: 1 - before });
    await wait(150);
    expect(f.team).toBe(before);
    expect(lastLobby(friend.c)?.lobby.locked).toBe(true);
    // Only the host shuffles, and teams stay even.
    friend.c.send({ type: 'host', action: 'shuffle' });
    host.c.send({ type: 'host', action: 'shuffle' });
    await wait(150);
    expect(Math.abs(count(0) - count(1))).toBeLessThanOrEqual(1);
    const humans = [host.w.you, friend.w.you].map((id) => room.sim.players.get(id)!.team);
    // Two humans are dealt one per side.
    expect(new Set(humans).size).toBe(2);
    host.c.ws.close();
    friend.c.ws.close();
  });
});

describe('Any mode (the default PLAY)', () => {
  it('puts everyone who just presses PLAY in the same Sudden Death room, with no bots', async () => {
    const join = async (guestId: string, open: boolean) => {
      const c = new TestClient();
      await c.open();
      c.send({ type: 'hello', v: PROTOCOL_VERSION, name: 'Anyone', guestId, join: { kind: 'quick', mode: 'suddenDeath', any: true, open, map: 'pier' } });
      return { c, w: await c.waitFor('welcome') };
    };
    const a = await join('any-1', true);
    const b = await join('any-2', false);
    const c = await join('any-3', true);
    expect(a.w.room.settings.mode).toBe('suddenDeath');
    expect(a.w.room.isPrivate).toBe(false);
    expect(b.w.room.code).toBe(a.w.room.code);
    expect(c.w.room.code).toBe(a.w.room.code);
    // Real players only, even for someone whose Bots switch is on.
    expect(a.w.room.settings.bots).toBe(false);
    const room = lobby.rooms.get(a.w.room.code)!;
    expect(room.sim.bots.size).toBe(0);
    for (const x of [a, b, c]) x.c.ws.close();
  });
});
