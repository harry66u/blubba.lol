import type { WebSocket } from 'ws';
import { BALANCE } from '../shared/balance';
import { GameSim } from '../shared/game/sim';
import { emptyInput } from '../shared/input';
import { KNOCKOUT_MAPS, MAPS, getMap, mapForMode } from '../shared/maps';
import { MODE_IDS, type ModeId } from '../shared/game/modes';
import { type Loadout, weaponIndex } from '../shared/loadout';
import { MODE_DEAD } from '../shared/player';
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

export interface Conn {
  ws: WebSocket;
  playerId: number;
  guestId: string;
  name: string;
  rtt: number;
  /** Input messages received in the current second (flood protection). */
  inputMsgs: number;
}

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

  constructor(
    readonly code: string,
    readonly isPrivate: boolean,
    settings: Partial<RoomSettings> = {},
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
    };
  }

  canJoin(): boolean {
    return this.humanCount < this.capacity;
  }

  join(ws: WebSocket, name: string, guestId: string, loadout?: Loadout): Conn | null {
    if (!this.canJoin()) return null;
    // Make room by removing a bot if needed.
    if (this.playerCount >= BALANCE.match.maxPlayers) this.removeOneBot();
    const p = this.sim.addPlayer(name, { loadout });
    const conn: Conn = { ws, playerId: p.id, guestId, name, rtt: 0, inputMsgs: 0 };
    this.conns.set(p.id, conn);
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

  leave(playerId: number): void {
    const conn = this.conns.get(playerId);
    if (!conn) return;
    this.conns.delete(playerId);
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
    if (!this.settings.bots) return 0;
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
      this.removeOneBot();
      bots--;
    }
    this.sim.balanceTeams();
    this.rosterDirty = true;
  }

  private removeOneBot(): void {
    const id = [...this.sim.bots.keys()].pop();
    if (id !== undefined) this.sim.removePlayer(id);
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
        } else if (msg.action === 'endIn' && typeof msg.seconds === 'number') {
          // Jump the match clock forward (to see the final 30 seconds).
          this.sim.phaseEndsAt = this.sim.time + msg.seconds;
          this.sim.world.collapseStart = this.sim.phaseEndsAt - BALANCE.final.seconds;
          this.broadcastJson(this.matchMessage());
        }
        break;
      case 'loadout':
        this.sim.setLoadout(conn.playerId, msg.loadout);
        break;
      case 'host':
        if (conn.playerId !== this.hostId || !this.isPrivate) return;
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
      this.sim.durationSec = next.durationSec;
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

  /** Called once per server tick. */
  tick(): void {
    const s = this.sim;
    if (!this.isPrivate && mapForMode(this.mode) === null && s.phase === 'results' && s.time + s.dt >= s.phaseEndsAt && this.humanCount > 0) {
      this.rotateMap();
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

  roster(): RosterEntry[] {
    return [...this.sim.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      bot: p.isBot,
      team: p.team,
      score: p.score,
      kos: p.stats.kos,
      deaths: p.stats.deaths,
      ping: Math.round(this.conns.get(p.id)?.rtt ?? 0),
    }));
  }

  matchMessage(): ServerMessage {
    const s = this.sim;
    return {
      type: 'match',
      phase: s.phase,
      endsAtTick: s.phase === 'waiting' ? 0 : Math.round(s.phaseEndsAt / s.dt),
      number: s.matchNumber,
      result: s.phase === 'results' ? s.lastResult : null,
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
