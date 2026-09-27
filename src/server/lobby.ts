import type { WebSocket } from 'ws';
import { BALANCE } from '../shared/balance';
import { MODE_IDS, type ModeId } from '../shared/game/modes';
import { checkName, randomGuestName } from '../shared/names';
import { type ClientMessage, type JoinRequest, PROTOCOL_VERSION, type ServerMessage } from '../shared/protocol';
import { type Conn, Room } from './room';

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 5;
const EMPTY_PRIVATE_TTL_MS = 5 * 60 * 1000;

export function makeCode(rng: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < CODE_LENGTH; i++) s += CODE_ALPHABET[Math.floor(rng() * CODE_ALPHABET.length)];
  return s;
}

export function normalizeCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, CODE_LENGTH);
}

/** Owns every room, matches players into them, and runs the fixed-rate game loop. */
export class Lobby {
  readonly rooms = new Map<string, Room>();
  private readonly connRoom = new Map<WebSocket, { room: Room; conn: Conn }>();
  private timer: NodeJS.Timeout | null = null;
  private lastTime = 0;
  private acc = 0;

  start(): void {
    const dt = 1 / BALANCE.tickRate;
    this.lastTime = performance.now();
    // A short interval with an accumulator keeps a steady 60 Hz despite timer jitter.
    this.timer = setInterval(() => {
      const now = performance.now();
      this.acc += (now - this.lastTime) / 1000;
      this.lastTime = now;
      let steps = 0;
      while (this.acc >= dt && steps < 5) {
        this.acc -= dt;
        steps++;
        for (const room of this.rooms.values()) {
          try {
            room.tick();
          } catch (err) {
            console.error(`[room ${room.code}] tick failed`, err);
          }
        }
      }
      if (steps === 5) this.acc = 0; // fell far behind; drop time rather than spiral
    }, 4);
    setInterval(() => this.sweep(), 10_000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private sweep(): void {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      if (room.humanCount > 0) continue;
      const ttl = room.isPrivate ? EMPTY_PRIVATE_TTL_MS : 0;
      if (now - room.emptySince >= ttl) this.rooms.delete(code);
    }
  }

  private newCode(): string {
    for (let i = 0; i < 1000; i++) {
      const c = makeCode();
      if (!this.rooms.has(c)) return c;
    }
    throw new Error('no free room codes');
  }

  /**
   * Quick play for a mode. The busiest room with space wins so people end up playing together;
   * for 1v1 that means the room where someone is already waiting (sparring with a bot).
   */
  findPublicRoom(mode: ModeId = 'knockout'): Room {
    let best: Room | null = null;
    for (const r of this.rooms.values()) {
      if (r.isPrivate || r.mode !== mode || !r.canJoin()) continue;
      if (!best || r.humanCount > best.humanCount) best = r;
    }
    if (best) return best;
    const room = new Room(this.newCode(), false, { mode });
    this.rooms.set(room.code, room);
    return room;
  }

  handleMessage(ws: WebSocket, data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean): void {
    const entry = this.connRoom.get(ws);
    if (isBinary) {
      if (!entry) return;
      const buf = Array.isArray(data) ? Buffer.concat(data) : data;
      entry.room.onBinary(entry.conn, buf);
      return;
    }
    let msg: ClientMessage;
    try {
      msg = JSON.parse(String(data));
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return;
    if (msg.type === 'hello') {
      if (entry) return;
      this.hello(ws, msg);
      return;
    }
    if (entry) entry.room.onJson(entry.conn, msg);
  }

  private hello(ws: WebSocket, msg: Extract<ClientMessage, { type: 'hello' }>): void {
    const fail = (code: Extract<ServerMessage, { type: 'error' }>['code'], message: string) => {
      ws.send(JSON.stringify({ type: 'error', code, message } satisfies ServerMessage));
      ws.close(4000, code);
    };
    if (msg.v !== PROTOCOL_VERSION) return fail('version', 'A new version of Bubba is out. Refresh the page!');
    const guestId = typeof msg.guestId === 'string' ? msg.guestId.slice(0, 64) : '';
    const check = checkName(typeof msg.name === 'string' ? msg.name : '');
    const name = check.ok ? check.name : randomGuestName();
    const join: JoinRequest = msg.join && typeof msg.join === 'object' ? msg.join : { kind: 'quick' };

    let room: Room | undefined;
    if (join.kind === 'code') {
      room = this.rooms.get(normalizeCode(String(join.code ?? '')));
      if (!room) return fail('not_found', "That room doesn't exist anymore. Check the code or start a new room.");
      if (room.kicked.has(guestId)) return fail('kicked', 'The host removed you from this room.');
      if (!room.canJoin()) return fail('full', room.mode === 'duel' ? 'That 1v1 already has two players.' : 'That room is full (10 players).');
    } else if (join.kind === 'create') {
      room = new Room(this.newCode(), true, join.settings ?? {});
      this.rooms.set(room.code, room);
    } else if (join.kind === 'challenge') {
      // A private 1v1: the code goes out as a link and the first person to open it is your opponent.
      room = new Room(this.newCode(), true, { mode: 'duel' });
      room.challenge = true;
      this.rooms.set(room.code, room);
    } else {
      const mode = typeof join.mode === 'string' && (MODE_IDS as readonly string[]).includes(join.mode) ? join.mode : 'knockout';
      room = this.findPublicRoom(mode);
    }
    const conn = room.join(ws, name, guestId, msg.loadout);
    if (!conn) return fail('full', 'That room is full (10 players).');
    this.connRoom.set(ws, { room, conn });
  }

  handleClose(ws: WebSocket): void {
    const entry = this.connRoom.get(ws);
    if (!entry) return;
    this.connRoom.delete(ws);
    entry.room.leave(entry.conn.playerId);
  }

  setRtt(ws: WebSocket, rtt: number): void {
    const entry = this.connRoom.get(ws);
    if (entry) entry.conn.rtt = rtt;
  }

  stats() {
    let humans = 0;
    for (const r of this.rooms.values()) humans += r.humanCount;
    return { rooms: this.rooms.size, players: humans };
  }
}
