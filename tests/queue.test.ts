import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import { Lobby } from '../src/server/lobby';
import { Room } from '../src/server/room';
import { PROTOCOL_VERSION, type JoinRequest, type ServerMessage } from '../src/shared/protocol';

const lobby = new Lobby();
const server = createServer();
const wss = new WebSocketServer({ server, path: '/ws' });
let port = 0;

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

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

class Client {
  ws = new WebSocket(`ws://localhost:${port}/ws`);
  msgs: ServerMessage[] = [];
  constructor() {
    this.ws.on('message', (d, bin) => {
      if (!bin) this.msgs.push(JSON.parse(String(d)));
    });
  }
  async hello(join: JoinRequest, name = 'Queuer'): Promise<Extract<ServerMessage, { type: 'welcome' }>> {
    if (this.ws.readyState !== WebSocket.OPEN) await new Promise((r) => this.ws.once('open', r));
    this.ws.send(JSON.stringify({ type: 'hello', v: PROTOCOL_VERSION, name, guestId: `g-${Math.random().toString(36).slice(2, 10)}`, join }));
    return this.next('welcome');
  }
  /** The next message of a type after `from` messages (waits up to 3 s). */
  async next<T extends ServerMessage['type']>(type: T, from = 0): Promise<Extract<ServerMessage, { type: T }>> {
    for (let i = 0; i < 300; i++) {
      const m = this.msgs.slice(from).find((x) => x.type === type);
      if (m) return m as Extract<ServerMessage, { type: T }>;
      await wait(10);
    }
    throw new Error(`no ${type}`);
  }
  last<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }> | undefined {
    return [...this.msgs].reverse().find((x) => x.type === type) as Extract<ServerMessage, { type: T }> | undefined;
  }
  close(): void {
    this.ws.close();
  }
}

/** A public room made by hand, as if the lobby had opened a second one while the first was full. */
function extraRoom(code: string, mode: 'suddenDeath' | 'knockout' | 'teamKnockout' | 'pump'): Room {
  const room = new Room(code, false, { mode, bots: false });
  lobby.rooms.set(code, room);
  return room;
}

describe('queue', () => {
  it('folds a lonely room into a busier one of the same mode, and its code follows them', async () => {
    const big = extraRoom('BBBBB', 'suddenDeath');
    const small = extraRoom('SSSSS', 'suddenDeath');
    const a = new Client();
    const b = new Client();
    const c = new Client();
    await a.hello({ kind: 'code', code: 'BBBBB' });
    await b.hello({ kind: 'code', code: 'BBBBB' });
    const before = c.msgs.length;
    await c.hello({ kind: 'code', code: 'SSSSS' });
    // The small room is waiting for players: the next merge pass moves its player over.
    lobby.consolidate();
    const moved = await c.next('moved', before);
    expect(moved.reason).toMatch(/2 players/);
    const again = c.msgs.filter((m) => m.type === 'welcome');
    expect(again).toHaveLength(2);
    expect((again[1] as Extract<ServerMessage, { type: 'welcome' }>).room.code).toBe('BBBBB');
    expect(big.humanCount).toBe(3);
    expect(small.closed).toBe(true);
    // The old invite link leads to where everyone went.
    expect(lobby.roomByCode('SSSSS')).toBe(big);
    // A room in the middle of a match is left alone.
    const busy = extraRoom('PPPPP', 'suddenDeath');
    const d = new Client();
    const e = new Client();
    await d.hello({ kind: 'code', code: 'PPPPP' });
    await e.hello({ kind: 'code', code: 'PPPPP' });
    await wait(100);
    expect(busy.sim.phase).toBe('playing');
    lobby.consolidate();
    expect(busy.humanCount).toBe(2);
    for (const x of [a, b, c, d, e]) x.close();
  });

  it('never merges private rooms or rooms of another mode', async () => {
    await wait(100);
    const ko = extraRoom('KKKKK', 'knockout');
    const sd = extraRoom('DDDDD', 'suddenDeath');
    const a = new Client();
    const b = new Client();
    const c = new Client();
    await a.hello({ kind: 'code', code: 'KKKKK' });
    await b.hello({ kind: 'code', code: 'DDDDD' });
    await c.hello({ kind: 'create', settings: { mode: 'knockout' } });
    lobby.consolidate();
    await wait(50);
    expect(ko.humanCount).toBe(1);
    expect(sd.humanCount).toBe(1);
    expect(a.msgs.some((m) => m.type === 'moved') || b.msgs.some((m) => m.type === 'moved') || c.msgs.some((m) => m.type === 'moved')).toBe(false);
    for (const x of [a, b, c]) x.close();
  });

  it('a dropped connection goes back to the same room, even after a restart', async () => {
    // (Bots on, so the room is mid-match and nothing merges it away.)
    const a = new Client();
    const w = await a.hello({ kind: 'quick', mode: 'pump' });
    // Someone else is busier elsewhere, but you go back to your own room.
    const other = extraRoom('OOOOO', 'pump');
    const o1 = new Client();
    const o2 = new Client();
    await o1.hello({ kind: 'code', code: 'OOOOO' });
    await o2.hello({ kind: 'code', code: 'OOOOO' });
    const b = new Client();
    const back = await b.hello({ kind: 'quick', mode: 'pump', room: w.room.code });
    expect(back.room.code).toBe(w.room.code);
    // The room is gone (a server restart): it opens again under the same code.
    const gone = 'GGGGG';
    const c = new Client();
    const reopened = await c.hello({ kind: 'quick', mode: 'ball', room: gone });
    expect(reopened.room.code).toBe(gone);
    expect(reopened.room.settings.mode).toBe('ball');
    expect(other.humanCount).toBe(2);
    for (const x of [a, b, c, o1, o2]) x.close();
  });

  it('counts players by mode for the menu', async () => {
    const a = new Client();
    await a.hello({ kind: 'quick', mode: 'teamKnockout', open: true });
    await wait(50);
    const counts = lobby.counts(Date.now() + 10_000);
    expect(counts.modes.teamKnockout?.waiting).toBeGreaterThanOrEqual(1);
    expect(counts.online).toBeGreaterThanOrEqual(1);
    a.close();
  });

  it('a lone player whose room moves to the next map leaves the results screen', async () => {
    const a = new Client();
    const w = await a.hello({ kind: 'quick', mode: 'knockout', open: true, room: 'LLLLL' });
    const room = lobby.rooms.get(w.room.code)!;
    room.sim.startMatch();
    await wait(50);
    room.sim.endMatch();
    await wait(50);
    expect(a.last('match')?.phase).toBe('results');
    room.sim.phaseEndsAt = room.sim.time;
    await wait(150);
    expect(room.settings.mapId).not.toBe(w.room.mapId);
    expect(a.last('match')?.phase).toBe('waiting');
    a.close();
  });
});
