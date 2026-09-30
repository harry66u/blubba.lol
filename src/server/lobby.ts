import type { WebSocket } from 'ws';
import { BALANCE } from '../shared/balance';
import { RANKED } from '../shared/economy';
import { MODE_IDS, type ModeId } from '../shared/game/modes';
import { KNOCKOUT_MAPS, homeMapFor } from '../shared/maps';
import type { Loadout } from '../shared/loadout';
import { checkName, randomGuestName } from '../shared/names';
import { type ClientMessage, type JoinRequest, PROTOCOL_VERSION, type ServerMessage } from '../shared/protocol';
import { type Conn, type Identity, Room } from './room';
import { Store, accountKey, guestKey, validGuestId } from './store';

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

/** A quick-play map pick that fits the mode (Ball, Pump and Team Knockout have their own maps), or null for any map. */
export function wantedMap(mode: ModeId, map: unknown): string | null {
  return typeof map === 'string' && homeMapFor(mode) === null && KNOCKOUT_MAPS.includes(map) ? map : null;
}

/** Someone waiting for a ranked opponent. */
/** A friend in a match (or the ranked queue). */
export interface Presence {
  code: string;
  mode: ModeId;
  joinable: boolean;
  isPrivate: boolean;
  queue?: boolean;
}

interface Queued {
  ws: WebSocket;
  name: string;
  guestId: string;
  identity: Identity;
  accountId: number;
  rating: number;
  since: number;
  loadout?: Loadout;
}

/** Owns every room, matches players into them, and runs the fixed-rate game loop. */
export class Lobby {
  readonly rooms = new Map<string, Room>();
  private readonly connRoom = new Map<WebSocket, { room: Room; conn: Conn }>();
  private queue: Queued[] = [];
  private timers: NodeJS.Timeout[] = [];
  private lastTime = 0;
  private acc = 0;

  constructor(readonly store: Store = new Store(':memory:')) {}

  start(): void {
    const dt = 1 / BALANCE.tickRate;
    this.lastTime = performance.now();
    // A short interval with an accumulator keeps a steady 60 Hz despite timer jitter.
    this.timers.push(
      setInterval(() => {
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
              room.tickFailures = 0;
            } catch (err) {
              console.error(`[room ${room.code}] tick failed`, err);
              if (++room.tickFailures >= 3) {
                console.error(`[room ${room.code}] closing after repeated failures`);
                room.abandon();
              }
            }
          }
        }
        if (steps === 5) this.acc = 0; // fell far behind; drop time rather than spiral
      }, 4),
    );
    this.timers.push(setInterval(() => this.sweep(), 10_000));
    this.timers.push(setInterval(() => this.matchmake(), 1000));
    this.timers.push(setInterval(() => this.store.prune(), 6 * 3600_000));
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  private sweep(): void {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      if (room.closed) {
        this.rooms.delete(code);
        continue;
      }
      if (room.humanCount > 0) continue;
      const ttl = room.isPrivate && !room.ranked ? EMPTY_PRIVATE_TTL_MS : 0;
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
   * for 1v1 that means the room where someone is already waiting (sparring with a bot). With a
   * map picked, only rooms on that map count, and if there are none a new room opens on it. New
   * rooms without a pick start on a random knockout map. `any` (the menu's default queue) takes
   * the busiest room whether or not it has bots, so everyone who just presses PLAY plays together.
   */
  findPublicRoom(mode: ModeId = 'knockout', map: string | null = null, open = false, any = false): Room {
    const want = wantedMap(mode, map);
    let best: Room | null = null;
    for (const r of this.rooms.values()) {
      if (r.isPrivate || r.mode !== mode || !r.canJoin()) continue;
      // Open rooms (no bots) and regular public rooms (bots fill in) are kept apart, except for
      // the everyone-together queue.
      if (!any && r.settings.bots === open) continue;
      if (want && r.settings.mapId !== want) continue;
      if (!best || r.humanCount > best.humanCount) best = r;
    }
    if (best) return best;
    const mapId = want ?? homeMapFor(mode) ?? KNOCKOUT_MAPS[Math.floor(Math.random() * KNOCKOUT_MAPS.length)];
    const room = new Room(this.newCode(), false, { mode, mapId, bots: !open }, this.store);
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
      if (entry || this.queue.some((q) => q.ws === ws)) return;
      this.hello(ws, msg);
      return;
    }
    if (entry) entry.room.onJson(entry.conn, msg);
  }

  /** Guests can't borrow a registered player's name. */
  private guestName(raw: string): string {
    const check = checkName(raw);
    if (!check.ok) return randomGuestName();
    if (!this.store.accountByName(check.name)) return check.name;
    for (let i = 0; i < 10; i++) {
      const alt = `${check.name.slice(0, 13)}${Math.floor(Math.random() * 90 + 10)}`;
      if (checkName(alt).ok && !this.store.accountByName(alt)) return alt;
    }
    return randomGuestName();
  }

  private hello(ws: WebSocket, msg: Extract<ClientMessage, { type: 'hello' }>): void {
    const fail = (code: Extract<ServerMessage, { type: 'error' }>['code'], message: string) => {
      ws.send(JSON.stringify({ type: 'error', code, message } satisfies ServerMessage));
      ws.close(4000, code);
    };
    if (msg.v !== PROTOCOL_VERSION) return fail('version', 'A new version of Blubba is out. Refresh the page!');
    const guestId = validGuestId(msg.guestId) ? msg.guestId : '';
    const account = this.store.sessionAccount(msg.token);
    const name = account ? account.name : this.guestName(typeof msg.name === 'string' ? msg.name : '');
    const identity: Identity = { key: account ? accountKey(account.id) : guestId ? guestKey(guestId) : null, accountId: account?.id ?? null };
    const join: JoinRequest = msg.join && typeof msg.join === 'object' ? msg.join : { kind: 'quick' };

    if (join.kind === 'ranked') {
      if (!account) return fail('account_required', 'Ranked needs a free account. Sign up from the main menu — your progress comes with you.');
      const busy = this.queue.some((q) => q.accountId === account.id) || [...this.rooms.values()].some((r) => r.ranked && !r.closed && [...r.conns.values()].some((c) => c.accountId === account.id));
      if (busy) return fail('already', "You're already in a ranked match or queue (maybe in another tab).");
      const profile = this.store.profile(accountKey(account.id));
      this.queue.push({ ws, name, guestId, identity, accountId: account.id, rating: profile.rating, since: Date.now(), loadout: msg.loadout });
      this.sendQueueStatus();
      return;
    }

    let room: Room | undefined;
    /** The map this player picked for quick play (the room stays on it while they're in). */
    let picked: string | null = null;
    if (join.kind === 'code') {
      room = this.rooms.get(normalizeCode(String(join.code ?? '')));
      if (!room || room.closed || room.ranked) return fail('not_found', "That room doesn't exist anymore. Check the code or start a new room.");
      if (room.kicked.has(guestId) || (identity.key && room.kicked.has(identity.key))) return fail('kicked', 'The host removed you from this room.');
      if (!room.canJoin()) return fail('full', room.mode === 'duel' ? 'That 1v1 already has two players.' : 'That room is full (10 players).');
    } else if (join.kind === 'create') {
      room = new Room(this.newCode(), true, join.settings ?? {}, this.store);
      this.rooms.set(room.code, room);
    } else if (join.kind === 'challenge') {
      // A private 1v1: the code goes out as a link and the first person to open it is your opponent.
      room = new Room(this.newCode(), true, { mode: 'duel' }, this.store);
      room.challenge = true;
      room.sim.autoStart = true;
      this.rooms.set(room.code, room);
    } else {
      const mode = typeof join.mode === 'string' && (MODE_IDS as readonly string[]).includes(join.mode) ? join.mode : 'knockout';
      const any = join.any === true;
      picked = any ? null : wantedMap(mode, join.map);
      room = this.findPublicRoom(mode, picked, join.open === true, any);
    }
    const conn = room.join(ws, name, guestId, msg.loadout, identity, picked);
    if (!conn) return fail('full', 'That room is full (10 players).');
    this.connRoom.set(ws, { room, conn });
  }

  // --- Ranked matchmaking ----------------------------------------------------------------------

  /** Pairs queued players by rating; the window widens the longer they wait. */
  matchmake(now = Date.now()): void {
    this.queue = this.queue.filter((q) => q.ws.readyState === q.ws.OPEN);
    const waiting = [...this.queue].sort((a, b) => a.since - b.since);
    const used = new Set<Queued>();
    for (const a of waiting) {
      if (used.has(a)) continue;
      let best: Queued | null = null;
      let bestGap = Infinity;
      for (const b of waiting) {
        if (b === a || used.has(b) || b.accountId === a.accountId) continue;
        const wait = (now - Math.min(a.since, b.since)) / 1000;
        const window = wait >= RANKED.anyoneAfterSec ? Infinity : RANKED.baseWindow + RANKED.windowPerSec * wait;
        const gap = Math.abs(a.rating - b.rating);
        if (gap <= window && gap < bestGap) {
          best = b;
          bestGap = gap;
        }
      }
      if (best) {
        used.add(a);
        used.add(best);
        this.startRanked(a, best);
      }
    }
    this.queue = this.queue.filter((q) => !used.has(q));
    this.sendQueueStatus(now);
  }

  private sendQueueStatus(now = Date.now()): void {
    for (const q of this.queue) {
      const msg: ServerMessage = { type: 'queue', seconds: Math.round((now - q.since) / 1000), searching: this.queue.length, rating: q.rating };
      if (q.ws.readyState === q.ws.OPEN) q.ws.send(JSON.stringify(msg));
    }
  }

  private startRanked(a: Queued, b: Queued): void {
    const room = new Room(this.newCode(), true, { mode: 'duel', bots: false }, this.store);
    room.ranked = true;
    room.sim.autoStart = true;
    room.sim.fixedLineup = true;
    this.rooms.set(room.code, room);
    for (const q of [a, b]) {
      const conn = room.join(q.ws, q.name, q.guestId, q.loadout, q.identity);
      if (conn) this.connRoom.set(q.ws, { room, conn });
    }
    room.rankedLocked = true;
  }

  get queued(): number {
    return this.queue.length;
  }

  // --- Connections ---------------------------------------------------------------------------

  handleClose(ws: WebSocket): void {
    this.queue = this.queue.filter((q) => q.ws !== ws);
    const entry = this.connRoom.get(ws);
    if (!entry) return;
    this.connRoom.delete(ws);
    entry.room.leave(entry.conn.playerId);
  }

  setRtt(ws: WebSocket, rtt: number): void {
    const entry = this.connRoom.get(ws);
    if (entry) entry.conn.rtt = rtt;
  }

  /** A purchase or equip happened over the API: show it in any match that player is in. */
  profileChanged(key: string): void {
    for (const room of this.rooms.values()) {
      for (const conn of room.conns.values()) if (conn.key === key) room.applyProfile(conn);
    }
  }

  /** Where each of these accounts is playing right now (for friends lists). */
  presence(ids: Set<number>): Map<number, Presence> {
    const out = new Map<number, Presence>();
    for (const room of this.rooms.values()) {
      if (room.closed) continue;
      for (const c of room.conns.values()) {
        if (c.accountId === null || !ids.has(c.accountId)) continue;
        out.set(c.accountId, { code: room.code, mode: room.mode, joinable: !room.ranked && room.canJoin(), isPrivate: room.isPrivate });
      }
    }
    for (const q of this.queue) if (ids.has(q.accountId)) out.set(q.accountId, { code: '', mode: 'duel', joinable: false, isPrivate: false, queue: true });
    return out;
  }

  stats() {
    let humans = 0;
    for (const r of this.rooms.values()) humans += r.humanCount;
    return { rooms: this.rooms.size, players: humans, rankedQueue: this.queue.length };
  }
}
