import type { WebSocket } from 'ws';
import { BALANCE } from '../shared/balance';
import { GameSim } from '../shared/game/sim';
import { emptyInput } from '../shared/input';
import { KNOCKOUT_MAPS, MAPS, getMap, mapForMode } from '../shared/maps';
import { MODE_IDS, type ModeId } from '../shared/game/modes';
import { type Loadout, sanitizeLoadout, weaponIndex } from '../shared/loadout';
import { MODE_DEAD } from '../shared/player';
import { DEFAULT_COSMETICS, QUICK_CHAT, REPORT_REASONS, levelForXp, unlockedAt } from '../shared/economy';
import { randomGuestName } from '../shared/names';
import { allowedLoadout, applyRanked, awardMatch } from './progress';
import { type Store, accountKey } from './store';
import {
  type ClientMessage,
  MSG_INPUTS,
  PROTOCOL_VERSION,
  type RoomInfo,
  type RoomSettings,
  type RosterEntry,
  type ServerMessage,
  EVENT_MULT,
  decodeInputs,
  encodeSnapshot,
} from '../shared/protocol';

/** Who a connection is, for saving progress. */
export interface Identity {
  /** Profile key ('a:<id>' or 'g:<guestId>'); null means nothing is saved. */
  key: string | null;
  accountId: number | null;
}

export interface Conn {
  ws: WebSocket;
  playerId: number;
  guestId: string;
  name: string;
  rtt: number;
  /** Input messages received in the current second (flood protection). */
  inputMsgs: number;
  key: string | null;
  accountId: number | null;
  /** Recent quick-chat times (rate limit). */
  chatTimes: number[];
  /** Players this connection already reported (one report each). */
  reported: Set<number>;
}

const CHAT_MIN_GAP_MS = 1200;
const CHAT_BURST = 4;
const CHAT_BURST_WINDOW_MS = 10_000;
const MAX_REPORTS = 5;
/** Distinct players reporting a name before it gets swapped for a safe one. */
const NAME_REPORTS_TO_RENAME = 3;

const DEFAULT_SETTINGS: RoomSettings = {
  mode: 'knockout',
  mapId: 'dealership',
  durationSec: BALANCE.match.durationSec,
  bots: true,
  events: 'normal',
};

/** One match room: a GameSim plus the sockets of the humans playing in it. */
export class Room {
  readonly sim: GameSim;
  readonly conns = new Map<number, Conn>();
  readonly kicked = new Set<string>();
  settings: RoomSettings;
  hostId = -1;
  emptySince = Date.now();
  private rosterDirty = true;
  private lastRosterAt = 0;
  private pendingEvents: ServerMessage[] = [];

  /** Public rooms rotate through the knockout maps between matches. */
  private rotation = 0;
  /** Challenge rooms: the code is shared as a 1v1 link. */
  challenge = false;
  /** Ranked 1v1: fixed lineup, rating on the line, closes after one match. */
  ranked = false;
  /** Set once both ranked players are in; nobody else can join. */
  rankedLocked = false;
  /** Ranked players' profile keys by player id (kept after someone leaves, for forfeits). */
  readonly rankedKeys = new Map<number, string>();
  private rankedSettled = false;
  /** The lobby drops closed rooms on its next sweep. */
  closed = false;
  /** Ticks in a row that threw (the lobby closes the room after a few). */
  tickFailures = 0;
  private readonly nameReports = new Map<number, Set<string>>();

  constructor(
    readonly code: string,
    readonly isPrivate: boolean,
    settings: Partial<RoomSettings> = {},
    readonly store: Store | null = null,
  ) {
    const clean = sanitizeSettings(settings);
    // 1v1s are shorter unless the host picked a length.
    if (clean.mode === 'duel' && clean.durationSec === undefined) clean.durationSec = BALANCE.modes.duel.durationSec;
    this.settings = fitMap({ ...DEFAULT_SETTINGS, ...clean });
    this.rotation = Math.max(0, KNOCKOUT_MAPS.indexOf(this.settings.mapId));
    this.sim = this.makeSim();
  }

  get mode(): ModeId {
    return this.settings.mode;
  }

  /** Most humans this room takes (a 1v1 room holds two). */
  get capacity(): number {
    return this.mode === 'duel' ? 2 : BALANCE.match.maxPlayers;
  }

  private makeSim(): GameSim {
    const sim = new GameSim({
      map: getMap(this.settings.mapId),
      mode: this.settings.mode,
      durationSec: this.settings.durationSec,
    });
    sim.eventMult = EVENT_MULT[this.settings.events];
    sim.onPhaseChange = () => {
      this.broadcastJson(this.matchMessage());
      this.rosterDirty = true;
      if (sim.phase === 'results' && sim === this.sim) this.awardMatch();
    };
    return sim;
  }

  get humanCount(): number {
    return this.conns.size;
  }

  get playerCount(): number {
    return this.sim.players.size;
  }

  info(): RoomInfo {
    return {
      code: this.code,
      isPrivate: this.isPrivate,
      hostId: this.hostId,
      mapId: this.settings.mapId,
      settings: this.settings,
      features: { ...this.sim.features },
      challenge: this.challenge,
      ranked: this.ranked,
    };
  }

  canJoin(): boolean {
    return this.humanCount < this.capacity && !this.rankedLocked && !this.closed;
  }

  /** Mods and utilities this connection has unlocked. */
  private allowed(conn: { key: string | null }): { parts: string[]; utils: string[] } {
    return conn.key && this.store ? allowedLoadout(this.store.profile(conn.key)) : unlockedAt(1);
  }

  /** Your chosen color if nobody else here is wearing it. */
  private colorFor(cosColor: string, playerId: number): number | undefined {
    const idx = Number(cosColor.split('.')[1]);
    if (!Number.isInteger(idx)) return undefined;
    for (const p of this.sim.players.values()) if (p.id !== playerId && p.color === idx) return undefined;
    return idx;
  }

  join(ws: WebSocket, name: string, guestId: string, loadout?: Loadout, identity: Identity = { key: null, accountId: null }): Conn | null {
    if (!this.canJoin()) return null;
    // Make room by removing a bot if needed.
    if (this.playerCount >= BALANCE.match.maxPlayers) this.removeOneBot();
    const profile = identity.key && this.store ? this.store.profile(identity.key) : null;
    const cos = profile ? { ...profile.cosmetics } : { ...DEFAULT_COSMETICS };
    const clean = sanitizeLoadout(loadout, this.allowed(identity));
    const p = this.sim.addPlayer(name, { loadout: clean, cos, color: this.colorFor(cos.color, -1) });
    const conn: Conn = { ws, playerId: p.id, guestId, name, rtt: 0, inputMsgs: 0, key: identity.key, accountId: identity.accountId, chatTimes: [], reported: new Set() };
    this.conns.set(p.id, conn);
    if (this.ranked && identity.key) this.rankedKeys.set(p.id, identity.key);
    if (this.hostId < 0 || !this.conns.has(this.hostId)) this.hostId = p.id;
    this.send(conn, { type: 'welcome', v: PROTOCOL_VERSION, you: p.id, room: this.info(), tick: this.sim.tick, name });
    this.send(conn, this.matchMessage());
    this.send(conn, { type: 'entities', ...this.sim.entitySnapshot() });
    this.rosterDirty = true;
    this.balanceBots();
    // A real opponent arrived for a 1v1 that was warming up against a bot: start fresh.
    if (this.mode === 'duel' && this.humanCount === 2) this.sim.startMatch();
    this.broadcastJson({ type: 'room', room: this.info() });
    return conn;
  }

  /** Re-reads a player's saved looks (after they buy or equip something). */
  applyProfile(conn: Conn): void {
    if (!conn.key || !this.store) return;
    const p = this.sim.players.get(conn.playerId);
    if (!p) return;
    p.cos = { ...this.store.profile(conn.key).cosmetics };
    const color = this.colorFor(p.cos.color, p.id);
    if (color !== undefined) p.color = color;
    this.rosterDirty = true;
  }

  leave(playerId: number): void {
    const conn = this.conns.get(playerId);
    if (!conn) return;
    this.conns.delete(playerId);
    // Ranked: leaving mid-match forfeits (the sim ends the match and the other player wins).
    this.sim.removePlayer(playerId);
    if (this.hostId === playerId) {
      const next = this.conns.keys().next();
      this.hostId = next.done ? -1 : next.value;
      this.broadcastJson({ type: 'room', room: this.info() });
    }
    if (this.conns.size === 0) this.emptySince = Date.now();
    this.rosterDirty = true;
    this.balanceBots();
  }

  /** How many bots this room wants right now. */
  private wantedBots(): number {
    if (!this.settings.bots || this.ranked) return 0;
    const humans = this.humanCount;
    // 1v1: a sparring bot keeps you busy until a real opponent shows up.
    if (this.mode === 'duel') return humans === 1 ? 1 : 0;
    // Team modes fill out to 4v4; everything else keeps a few bots around.
    const fill = MODE_INFO_TEAMS.has(this.mode) ? BALANCE.modes.teamFill : BALANCE.match.publicBotFill;
    const want = Math.max(0, fill - humans);
    // Nine humans in a team mode get one bot for an even 5v5.
    return MODE_INFO_TEAMS.has(this.mode) && (humans + want) % 2 === 1 ? want + 1 : want;
  }

  /** Public rooms keep a few bots around so there is always someone to blast. */
  balanceBots(): void {
    const want = this.wantedBots();
    let bots = this.sim.bots.size;
    while (bots < want && this.playerCount < BALANCE.match.maxPlayers) {
      // A spread of skill so new players can win fights and good players still get a challenge.
      const skill = [0.25, 0.45, 0.65, 0.35][bots % 4];
      this.sim.addBot(skill);
      bots++;
    }
    while (bots > want) {
      // Mid-match in Sudden Death only bots that are already out can go; the rest leave after it.
      if (!this.removeOneBot(this.sim.suddenDeath && this.sim.phase === 'playing')) break;
      bots--;
    }
    this.sim.balanceTeams();
    this.rosterDirty = true;
  }

  /** Removes a bot, preferring one that's knocked out right now so no fight loses a player. */
  private removeOneBot(onlyDead = false): boolean {
    const ids = [...this.sim.bots.keys()].reverse();
    const id = ids.find((b) => this.sim.players.get(b)?.state.mode === MODE_DEAD) ?? (onlyDead ? undefined : ids[0]);
    if (id === undefined) return false;
    this.sim.removePlayer(id);
    return true;
  }

  onBinary(conn: Conn, data: ArrayBuffer | Buffer): void {
    const buf = data instanceof ArrayBuffer ? data : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    const view = new DataView(buf);
    if (view.byteLength < 2) return;
    if (view.getUint8(0) !== MSG_INPUTS) return;
    conn.inputMsgs++;
    if (conn.inputMsgs > 150) return; // flood protection (~2.5x the normal rate)
    const frames = decodeInputs(view, emptyInput);
    for (const f of frames) this.sim.queueInput(conn.playerId, f);
  }

  onJson(conn: Conn, msg: ClientMessage): void {
    switch (msg.type) {
      case 'ping':
        if (typeof msg.t === 'number') this.send(conn, { type: 'pong', t: msg.t, tick: this.sim.tick });
        break;
      case 'debug':
        if (process.env.BUBBA_DEBUG !== '1') return;
        if (msg.action === 'chaos' && ['fan', 'lowGravity', 'ice', 'maxInflate'].includes(msg.kind)) {
          this.sim.triggerChaos(msg.kind as 'fan', 1, 0);
        } else if (msg.action === 'bots' && typeof msg.count === 'number') {
          while (this.sim.bots.size < msg.count && this.playerCount < BALANCE.match.maxPlayers) this.sim.addBot(0.5);
          this.rosterDirty = true;
        } else if (msg.action === 'streak' && typeof msg.count === 'number') {
          // Pretend you just reached a knockout streak (to see its reward).
          const p = this.sim.players.get(conn.playerId);
          if (p) {
            p.streak = msg.count;
            this.sim.streakReward(p);
          }
        } else if (msg.action === 'loot') {
          if (msg.far) this.sim.dropLoot();
          else this.sim.debugDropLoot(conn.playerId, typeof msg.kind === 'string' ? msg.kind : undefined);
        } else if (msg.action === 'gadgets' && Array.isArray(msg.utils)) {
          this.sim.debugSetUtilities(conn.playerId, msg.utils);
        } else if (msg.action === 'endIn' && typeof msg.seconds === 'number') {
          // Jump the match clock forward (to see the map shrink or the final 30 seconds).
          this.sim.endIn(msg.seconds);
          this.broadcastJson(this.matchMessage());
        }
        break;
      case 'loadout':
        this.sim.setLoadout(conn.playerId, sanitizeLoadout(msg.loadout, this.allowed(conn)));
        break;
      case 'chat':
        this.chat(conn, msg.id);
        break;
      case 'report':
        this.report(conn, msg.target, msg.reason);
        break;
      case 'host':
        if (conn.playerId !== this.hostId || !this.isPrivate || this.ranked) return;
        if (msg.action === 'kick' && typeof msg.id === 'number') this.kick(msg.id);
        else if (msg.action === 'settings' && msg.settings && typeof msg.settings === 'object') this.applySettings(msg.settings);
        else if (msg.action === 'restart') this.sim.startMatch();
        break;
      default:
        break;
    }
  }

  kick(id: number): void {
    const target = this.conns.get(id);
    if (!target || id === this.hostId) return;
    this.kicked.add(target.guestId);
    if (target.key) this.kicked.add(target.key);
    this.send(target, { type: 'error', code: 'kicked', message: 'The host removed you from this room.' });
    target.ws.close(4001, 'kicked');
    this.leave(id);
  }

  private applySettings(raw: Partial<RoomSettings>): void {
    const next = fitMap({ ...this.settings, ...sanitizeSettings(raw) });
    const needNewSim = next.mapId !== this.settings.mapId || next.mode !== this.settings.mode;
    this.settings = next;
    if (needNewSim) this.rebuild();
    else {
      // Sudden Death always runs its own fixed length.
      if (!this.sim.suddenDeath) this.sim.durationSec = next.durationSec;
      this.sim.eventMult = EVENT_MULT[next.events];
    }
    this.balanceBots();
    this.broadcastJson({ type: 'room', room: this.info() });
    this.sim.startMatch();
  }

  /** Swaps in a fresh match on the current map and mode, carrying the humans over. */
  private rebuild(): void {
    const old = this.sim;
    const fresh = this.makeSim();
    // Keep the clock running so clients' tick estimates stay valid.
    fresh.tick = old.tick;
    fresh.time = old.time;
    (this as { sim: GameSim }).sim = fresh;
    for (const p of old.players.values()) {
      if (p.isBot) continue;
      const np = fresh.addPlayer(p.name, { id: p.id, color: p.color, loadout: p.loadout });
      // Carry press counters so the client's next input isn't read as a burst of presses.
      for (const k of ['cJump', 'cDash', 'cBrace', 'cGrab', 'cGrapple', 'cReload', 'cU1', 'cU2', 'cTaunt'] as const) np.state[k] = p.state[k];
      np.lastSeq = p.lastSeq;
    }
    this.broadcastJson({ type: 'entities', ...fresh.entitySnapshot() });
  }

  /** Public knockout rooms move to the next map when the results screen ends. */
  private rotateMap(): void {
    this.rotation = (this.rotation + 1) % KNOCKOUT_MAPS.length;
    this.settings = { ...this.settings, mapId: KNOCKOUT_MAPS[this.rotation] };
    this.rebuild();
    this.balanceBots();
    this.broadcastJson({ type: 'room', room: this.info() });
    this.rosterDirty = true;
  }

  /** Quick chat: a preset index, rate limited, broadcast to the room. */
  private chat(conn: Conn, id: unknown): void {
    if (typeof id !== 'number' || !Number.isInteger(id) || id < 0 || id >= QUICK_CHAT.length) return;
    const now = Date.now();
    conn.chatTimes = conn.chatTimes.filter((t) => now - t < CHAT_BURST_WINDOW_MS);
    const last = conn.chatTimes[conn.chatTimes.length - 1] ?? 0;
    if (now - last < CHAT_MIN_GAP_MS || conn.chatTimes.length >= CHAT_BURST) return;
    conn.chatTimes.push(now);
    this.broadcastJson({ type: 'chat', from: conn.playerId, id });
  }

  /** Saves a report. Several players reporting a name swaps it for a safe random one. */
  private report(conn: Conn, target: unknown, reason: unknown): void {
    if (typeof target !== 'number' || target === conn.playerId) return;
    if (!(REPORT_REASONS as readonly unknown[]).includes(reason)) return;
    const victim = this.conns.get(target);
    if (!victim || conn.reported.has(target) || conn.reported.size >= MAX_REPORTS) return;
    conn.reported.add(target);
    const reporterKey = conn.key ?? `anon:${conn.guestId || conn.playerId}`;
    this.store?.addReport(reporterKey, victim.key ?? `anon:${victim.guestId}`, victim.name, this.code, String(reason));
    if (reason === 'face') {
      // Enough different players reporting a face scan hides it until an admin looks.
      if (victim.accountId !== null && this.store?.reportFace(victim.accountId, reporterKey)) {
        this.rosterDirty = true;
        this.send(victim, { type: 'renamed', name: victim.name, message: 'Other players reported your face scan, so it is hidden until a moderator checks it.' });
      }
      return;
    }
    if (reason !== 'name') return;
    const set = this.nameReports.get(target) ?? new Set<string>();
    set.add(reporterKey);
    this.nameReports.set(target, set);
    if (set.size >= NAME_REPORTS_TO_RENAME) {
      this.nameReports.delete(target);
      if (victim.accountId !== null) this.store?.flagAccount(victim.accountId);
      const name = randomGuestName();
      victim.name = name;
      const p = this.sim.players.get(target);
      if (p) p.name = name;
      this.send(victim, { type: 'renamed', name, message: 'Other players reported your name, so it was changed. Pick a friendly name next time!' });
      this.rosterDirty = true;
    }
  }

  /** Match over: hand out XP, coins and unlocks, and settle ranked ratings. */
  private awardMatch(): void {
    const sim = this.sim;
    const r = sim.lastResult;
    if (!r || !this.store) return;
    const store = this.store;
    const matchSeconds = Math.max(1, sim.time - sim.matchStartedAt);
    const ratings = new Map<number, { before: number; after: number }>();
    if (this.ranked && !this.rankedSettled && this.rankedKeys.size === 2) {
      this.rankedSettled = true;
      const [a, b] = [...this.rankedKeys.entries()];
      const sa = r.standings.find((s) => s.id === a[0]);
      const sb = r.standings.find((s) => s.id === b[0]);
      // Whoever is missing from the standings left early and forfeits.
      const aWins = !sb || (sa && sa.score > sb.score);
      const bWins = !sa || (sb && sb.score > sa.score);
      if (aWins || bWins) {
        const [w, l] = aWins ? [a, b] : [b, a];
        const [rw, rl] = applyRanked(store, w[1], l[1]);
        ratings.set(w[0], rw);
        ratings.set(l[0], rl);
      }
    }
    const top = r.standings[0];
    for (const conn of this.conns.values()) {
      if (!conn.key) continue;
      const standing = r.standings.find((s) => s.id === conn.playerId);
      const p = sim.players.get(conn.playerId);
      if (!standing || !p) continue;
      const secondsPlayed = Math.min(matchSeconds, sim.time - Math.max(sim.matchStartedAt, p.joinedAt));
      // Sudden Death: the last one standing wins even without a single pop (everyone else fell).
      const won = r.teams
        ? p.team === r.teams.winner
        : r.mode === 'suddenDeath'
          ? r.winnerId === conn.playerId
          : r.winnerId === conn.playerId && !!top && top.score > 0 && (r.standings[1]?.score ?? -1) < top.score;
      // Where they finished (1 = winner); people who joined after the start watched and don't place.
      const place = p.outAt === -Infinity ? 0 : r.standings.indexOf(standing) + 1;
      const acc = conn.accountId !== null ? store.accountById(conn.accountId) : null;
      // Sudden Death rounds are short: the base reward goes by time against a full-length round
      // (so short rounds don't pay more per minute), and a round played start to finish counts
      // even when it was over before the usual minimum time.
      const sd = r.mode === 'suddenDeath';
      const report = awardMatch(store, conn.key, acc?.name ?? null, !!acc, {
        mode: r.mode,
        stats: standing.stats,
        secondsPlayed,
        matchSeconds: sd ? Math.max(matchSeconds, sim.durationSec) : matchSeconds,
        won,
        place,
        wholeMatch: sd && place > 0,
      });
      const rating = ratings.get(conn.playerId);
      if (rating) report.rating = rating;
      this.send(conn, { type: 'progress', report });
    }
    this.rosterDirty = true;
  }

  /** Ranked rooms close after one match; everyone goes back to the menu. */
  private closeRanked(): void {
    for (const conn of [...this.conns.values()]) {
      this.send(conn, { type: 'error', code: 'ranked_over', message: 'Ranked match complete. Queue again for another!' });
      conn.ws.close(4002, 'ranked_over');
    }
    this.conns.clear();
    this.closed = true;
  }

  /**
   * Something in this room keeps failing: close it. Players' clients reconnect by themselves and
   * land in a fresh room.
   */
  abandon(): void {
    for (const conn of [...this.conns.values()]) conn.ws.close(1011, 'Room error');
    this.conns.clear();
    this.closed = true;
  }

  /** Called once per server tick. */
  tick(): void {
    const s = this.sim;
    if (this.closed) return;
    if (this.ranked && s.phase === 'results' && s.time + s.dt >= s.phaseEndsAt) {
      this.closeRanked();
      return;
    }
    if (!this.isPrivate && mapForMode(this.mode) === null && s.phase === 'results' && s.time + s.dt >= s.phaseEndsAt && this.humanCount > 0) {
      this.rotateMap();
    } else if (s.suddenDeath && s.phase === 'results' && s.time + s.dt >= s.phaseEndsAt) {
      // Sudden Death keeps extra bots through a match (see balanceBots); settle up before the next.
      this.balanceBots();
    }
    this.sim.step();
    const events = this.sim.drainEvents();
    if (events.length) {
      this.pendingEvents.push({ type: 'ev', list: events });
      if (events.some((e) => e.t === 'ko')) this.rosterDirty = true;
    }
    const sendRate = Math.round(BALANCE.tickRate / BALANCE.snapshotRate);
    if (this.sim.tick % sendRate === 0) this.flush();
  }

  private flush(): void {
    for (const msg of this.pendingEvents) this.broadcastJson(msg);
    this.pendingEvents.length = 0;
    const now = Date.now();
    if (this.rosterDirty || now - this.lastRosterAt > 3000) {
      this.broadcastJson({ type: 'roster', players: this.roster() });
      this.rosterDirty = false;
      this.lastRosterAt = now;
    }
    const crown = this.sim.crownId;
    const modeState = this.sim.modeState();
    const all = [...this.sim.players.values()].map((p) => ({ id: p.id, state: p.state, weapon: weaponIndex(p.loadout.weapon), streaming: p.streaming, crowned: p.id === crown }));
    for (const conn of this.conns.values()) {
      conn.inputMsgs = Math.max(0, conn.inputMsgs - Math.round(BALANCE.tickRate / BALANCE.snapshotRate) * 1.25);
      const me = this.sim.players.get(conn.playerId);
      if (!me) continue;
      const others = all.filter((p) => p.id !== conn.playerId);
      const buf = encodeSnapshot(this.sim.tick, me.lastSeq, me.id, me.state, others, modeState);
      if (conn.ws.readyState === conn.ws.OPEN && conn.ws.bufferedAmount < 256 * 1024) conn.ws.send(buf);
    }
  }

  private faceOf(conn: Conn | undefined): RosterEntry['face'] {
    const v = conn && this.store ? this.store.faceVersion(conn.accountId) : undefined;
    return v !== undefined && conn?.accountId != null ? { account: conn.accountId, v } : undefined;
  }

  roster(): RosterEntry[] {
    return [...this.sim.players.values()].map((p) => {
      const conn = this.conns.get(p.id);
      const profile = conn?.key && this.store ? this.store.profile(conn.key) : null;
      return {
      id: p.id,
      name: p.name,
      color: p.color,
      bot: p.isBot,
      team: p.team,
      cos: p.cos,
      level: profile ? levelForXp(profile.xp).level : p.isBot ? 0 : 1,
      face: this.faceOf(conn),
      rating: this.ranked && profile ? profile.rating : undefined,
      out: this.sim.isOut(p) || undefined,
      score: p.score,
      kos: p.stats.kos,
      deaths: p.stats.deaths,
      ping: Math.round(conn?.rtt ?? 0),
      };
    });
  }

  matchMessage(): ServerMessage {
    const s = this.sim;
    return {
      type: 'match',
      phase: s.phase,
      endsAtTick: s.phase === 'waiting' ? 0 : Math.round(s.phaseEndsAt / s.dt),
      number: s.matchNumber,
      result: s.phase === 'results' ? s.lastResult : null,
      collapse: [...s.world.plan],
    };
  }

  send(conn: Conn, msg: ServerMessage): void {
    if (conn.ws.readyState === conn.ws.OPEN) conn.ws.send(JSON.stringify(msg));
  }

  broadcastJson(msg: ServerMessage): void {
    const text = JSON.stringify(msg);
    for (const c of this.conns.values()) if (c.ws.readyState === c.ws.OPEN) c.ws.send(text);
  }

  isAlive(id: number): boolean {
    const p = this.sim.players.get(id);
    return !!p && p.state.mode !== MODE_DEAD;
  }
}

const MODE_INFO_TEAMS = new Set<ModeId>(['teamKnockout', 'ball', 'pump']);

/** Ball and Pump have their own arenas; the knockout modes can't use those. */
export function fitMap(s: RoomSettings): RoomSettings {
  const forced = mapForMode(s.mode);
  if (forced) return { ...s, mapId: forced };
  if (!KNOCKOUT_MAPS.includes(s.mapId)) return { ...s, mapId: KNOCKOUT_MAPS[0] };
  return s;
}

export function sanitizeSettings(raw: Partial<RoomSettings>): Partial<RoomSettings> {
  const out: Partial<RoomSettings> = {};
  if (typeof raw.mode === 'string' && (MODE_IDS as readonly string[]).includes(raw.mode)) out.mode = raw.mode;
  if (typeof raw.mapId === 'string' && Object.hasOwn(MAPS, raw.mapId)) out.mapId = raw.mapId;
  if (typeof raw.durationSec === 'number' && Number.isFinite(raw.durationSec)) {
    out.durationSec = Math.round(Math.max(BALANCE.match.minDurationSec, Math.min(BALANCE.match.maxDurationSec, raw.durationSec)) / 30) * 30;
  }
  if (typeof raw.bots === 'boolean') out.bots = raw.bots;
  if (typeof raw.events === 'string' && raw.events in EVENT_MULT) out.events = raw.events;
  return out;
}
