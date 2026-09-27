import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import { emptyInput } from '../src/shared/input';
import { MSG_SNAPSHOT, PROTOCOL_VERSION, type ServerMessage, type Snapshot, decodeSnapshot, encodeInputs } from '../src/shared/protocol';
import { Lobby } from '../src/server/lobby';

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
});
