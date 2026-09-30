import type { WebSocket } from 'ws';
import { BALANCE } from '../shared/balance';
import { RANKED } from '../shared/economy';
import { MODE_IDS, type ModeId } from '../shared/game/modes';
import { KNOCKOUT_MAPS, homeMapFor } from '../shared/maps';
import type { Loadout } from '../shared/loadout';
import { checkName, randomGuestName } from '../shared/names';
import { type ClientMessage, type JoinRequest, PROTOCOL_VERSION, type QueueCounts, type ServerMessage } from '../shared/protocol';
import { type Conn, type Identity, Room } from './room';
import { Store, accountKey, guestKey, validGuestId } from './store';

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 5;
const EMPTY_PRIVATE_TTL_MS = 5 * 60 * 1000;
/** Public rooms this small get folded into a busier room of the same mode between matches. */
const MERGE_MAX_HUMANS = 3;
/** How long an invite link to a merged room still leads to where its players went. */
const ALIAS_TTL_MS = 30 * 60 * 1000;

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
  /** Codes of rooms that were merged into another one, so their invite links still work. */
  private readonly aliases = new Map<string, { code: string; until: number }>();
  private countsCache: { at: number; counts: QueueCounts } | null = null;
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
    this.timers.push(
      setInterval(() => {
        this.matchmake();
        this.consolidate();
      }, 1000),
    );
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
    for (const [code, a] of this.aliases) if (now > a.until || this.rooms.has(code)) this.aliases.delete(code);
  }

  /** A room by its code, following merges (an invite link to a room that was folded into another). */
  roomByCode(raw: string): Room | undefined {
    const code = normalizeCode(raw);
    const direct = this.rooms.get(code);
    if (direct && !direct.closed) return direct;
    let a = this.aliases.get(code);
    for (let hops = 0; a && hops < 5; hops++) {
      const r = this.rooms.get(a.code);
      if (r && !r.closed) return r;
      a = this.aliases.get(a.code);
    }
    return undefined;
  }

  private newCode(): string {
    for (let i = 0; i < 1000; i++) {
      const c = makeCode();
      if (!this.rooms.has(c)) return c;
    }
    throw new Error('no free room codes');
  }

  /**
   * Quick play for a mode: everyone who picks it plays together. The busiest public room of the
   * mode with space wins, whatever map or bots switch each player picked; between rooms just as
   * busy, one on your map (then one whose bots match your switch) goes first. A new room opens only
   * when every room of the mode is full, on your map (or the mode's own arena, or a random one).
   * `need` seats are needed together (a group); `code` is a room to go back to first (after a
   * dropped connection), reopened under the same code if the server restarted, so a group that
   * was playing together lands together again.
   */
  findPublicRoom(mode: ModeId = 'knockout', map: string | null = null, wantBots = false, need = 1, code?: string): Room {
    const want = wantedMap(mode, map);
    const back = code ? this.roomByCode(code) : undefined;
    if (back && !back.isPrivate && back.mode === mode && back.capacity - back.humanCount >= need && back.canJoin()) return back;
    let best: Room | null = null;
    let bestScore = -Infinity;
    for (const r of this.rooms.values()) {
      // Empty rooms are left over from people who went home (the sweep drops them): start fresh.
      if (r.isPrivate || r.mode !== mode || r.humanCount === 0 || !r.canJoin() || r.capacity - r.humanCount < need) continue;
      const score = r.humanCount * 4 + (want && r.settings.mapId === want ? 2 : 0) + (r.settings.bots === wantBots ? 1 : 0);
      if (score > bestScore) {
        best = r;
        bestScore = score;
      }
    }
    if (best) return best;
    const mapId = want ?? homeMapFor(mode) ?? KNOCKOUT_MAPS[Math.floor(Math.random() * KNOCKOUT_MAPS.length)];
    const reuse = code ? normalizeCode(code) : '';
    const fresh = reuse.length === CODE_LENGTH && !this.rooms.has(reuse) && !this.aliases.has(reuse) ? reuse : this.newCode();
    const room = new Room(fresh, false, { mode, mapId, bots: wantBots }, this.store);
    this.rooms.set(room.code, room);
    return room;
  }

  /**
   * Folds small public rooms into a busier room of the same mode, between matches (a room waiting
   * for players, or at the very end of its results), so two rooms that each wait for a second
   * player become one match. Players move together and keep their seat, loadout and votes; the
   * old code keeps leading to them.
   */
  consolidate(now = Date.now()): void {
    const rooms = [...this.rooms.values()].filter((r) => !r.isPrivate && !r.closed && r.humanCount > 0);
    for (const small of rooms) {
      const n = small.humanCount;
      if (n === 0 || n > MERGE_MAX_HUMANS || !small.betweenMatches) continue;
      let target: Room | null = null;
      for (const big of rooms) {
        if (big === small || big.closed || big.mode !== small.mode || !big.canJoin()) continue;
        // Only toward a busier room (or, between two just as busy, the one with the lower code).
        if (big.humanCount < n || (big.humanCount === n && big.code > small.code)) continue;
        if (big.capacity - big.humanCount < n) continue;
        if (!target || big.humanCount > target.humanCount) target = big;
      }
      if (target) this.moveAll(small, target, now);
    }
  }

  /** Moves every player in `from` into `to` over their open connections. */
  private moveAll(from: Room, to: Room, now = Date.now()): void {
    const reason = to.humanCount === 1 ? 'Found another player!' : `Found a match with ${to.humanCount} players!`;
    for (const conn of [...from.conns.values()]) {
      const p = from.sim.players.get(conn.playerId);
      const loadout = p ? (p.pendingLoadout ?? p.loadout) : undefined;
      from.send(conn, { type: 'moved', reason });
      from.leave(conn.playerId);
      this.connRoom.delete(conn.ws);
      const moved = to.join(conn.ws, conn.name, conn.guestId, loadout, { key: conn.key, accountId: conn.accountId }, conn.wantMap, conn.wantBots);
      if (moved) this.connRoom.set(conn.ws, { room: to, conn: moved });
      else conn.ws.close(4003, 'moved');
    }
    this.aliases.set(from.code, { code: to.code, until: now + ALIAS_TTL_MS });
    from.closed = true;
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
    /** Their Bots switch (quick play); joining by code or through a friend, you go along with the room. */
    let wantBots: boolean | undefined;
    if (join.kind === 'code') {
      room = this.roomByCode(String(join.code ?? ''));
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
    } else if (join.kind === 'friend') {
      // Following a friend into their match: wherever they are right now (the list can be seconds old).
      if (!account) return fail('account_required', 'Make a free account to join friends.');
      const friend = this.store.friends(account.id).find((f) => f.id === join.id && f.status === 'friends');
      if (!friend) return fail('not_found', "You can only join people on your friends list.");
      room = this.roomOfAccount(friend.id);
      if (!room || room.ranked) return fail('not_found', `${friend.name} isn't in a match right now.`);
      if (!room.canJoin()) return fail('full', `${friend.name}'s match is full. Try again in a moment!`);
    } else {
      const mode = typeof join.mode === 'string' && (MODE_IDS as readonly string[]).includes(join.mode) ? join.mode : 'knockout';
      // The menu's default queue ("Any mode") is real players only, on whatever map they're on.
      const any = join.any === true;
      picked = any ? null : wantedMap(mode, join.map);
      wantBots = !any && join.open !== true;
      room = this.findPublicRoom(mode, picked, wantBots, 1, typeof join.room === 'string' ? join.room : undefined);
    }
    const conn = room.join(ws, name, guestId, msg.loadout, identity, picked, wantBots);
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

  /** The room an account is playing in right now (not the ranked queue). */
  roomOfAccount(id: number): Room | undefined {
    for (const room of this.rooms.values()) {
      if (room.closed) continue;
      for (const c of room.conns.values()) if (c.accountId === id) return room;
    }
    return undefined;
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

  /** How many people are playing each mode right now (the menu's counts), cached for a moment. */
  counts(now = Date.now()): QueueCounts {
    if (this.countsCache && now - this.countsCache.at < 2000) return this.countsCache.counts;
    const modes: QueueCounts['modes'] = {};
    let online = this.queue.length;
    for (const r of this.rooms.values()) {
      if (r.closed || r.humanCount === 0) continue;
      online += r.humanCount;
      if (r.isPrivate) continue;
      const m = (modes[r.mode] ??= { playing: 0, waiting: 0 });
      if (r.sim.phase === 'waiting') m.waiting += r.humanCount;
      else m.playing += r.humanCount;
    }
    const counts: QueueCounts = { online, modes, ranked: this.queue.length };
    this.countsCache = { at: now, counts };
    return counts;
  }

  stats() {
    let humans = 0;
    for (const r of this.rooms.values()) humans += r.humanCount;
    return { rooms: this.rooms.size, players: humans, rankedQueue: this.queue.length };
  }
}
