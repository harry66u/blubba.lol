import type { WebSocket } from 'ws';
import { BALANCE } from '../shared/balance';
import { GameSim } from '../shared/game/sim';
import { emptyInput } from '../shared/input';
import { KNOCKOUT_MAPS, MAPS, getMap, homeMapFor, mapsForMode } from '../shared/maps';
import { MODE_IDS, type ModeId } from '../shared/game/modes';
import { type LobbySeat, MAX_PER_SIDE, checkTeamLobby, shuffleTeams } from '../shared/game/teamLobby';
import { ULT_IDS, ultIndex } from '../shared/game/ults';
import { type Loadout, sanitizeLoadout, weaponIndex } from '../shared/loadout';
import { MODE_DEAD } from '../shared/player';
import { DEFAULT_COSMETICS, QUICK_CHAT, REPORT_REASONS, levelForXp, unlockedAt } from '../shared/economy';
import { randomGuestName, isNameBlocked } from '../shared/names';
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
  type TeamLobbyState,
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
  /** The map they picked for quick play (null: any map): their vote when a public room moves on to its next map. */
  wantMap: string | null;
  /** Public rooms: they want bots filling the empty spots (bots play while everyone here does). */
  wantBots: boolean;
  /** When they last flipped their bots vote (flipping is rate limited: bots joining and leaving is churn). */
  botsVoteAt: number;
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
  /** Players who pressed PLAY AGAIN on the results (cleared when the next match starts). */
  private readonly againVotes = new Set<number>();
  /** Team Knockout's lobby before each match (see stepTeamLobby): who's ready, the host's lock, the countdown. */
  private readonly lobbyReady = new Set<number>();
  private teamsLocked = false;
  private lobbyStartsAt = 0;
  private lobbyAutoReadyAt = 0;
  private lobbySent = '';

  constructor(
    readonly code: string,
    readonly isPrivate: boolean,
    settings: Partial<RoomSettings> = {},
    readonly store: Store | null = null,
  ) {
    const clean = sanitizeSettings(settings);
    // 1v1s are shorter unless the host picked a length.
    if (clean.mode === 'duel' && clean.durationSec === undefined) clean.durationSec = BALANCE.modes.duel.durationSec;
    // A mode with a map of its own starts there; Team Knockout has no bots unless asked for.
    if (clean.mode && clean.mapId === undefined) clean.mapId = homeMapFor(clean.mode) ?? undefined;
    if (clean.mode === 'teamKnockout' && clean.bots === undefined) clean.bots = false;
    if (clean.mapId === undefined) delete clean.mapId;
    this.settings = fitMap({ ...DEFAULT_SETTINGS, ...clean });
    this.rotation = Math.max(0, KNOCKOUT_MAPS.indexOf(this.settings.mapId));
    this.sim = this.makeSim();
  }

  get mode(): ModeId {
    return this.settings.mode;
  }

  /** Team Knockout picks teams and readies up in a lobby before every match. */
  get usesTeamLobby(): boolean {
    return this.settings.mode === 'teamKnockout' && !this.ranked && !this.challenge;
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
    // Private rooms wait in the lobby for the host's START (challenges and ranked start by themselves).
    // Team Knockout starts from its team lobby once everyone's ready, public or private.
    sim.autoStart = !this.usesTeamLobby && (!this.isPrivate || this.challenge || this.ranked);
    sim.teamPick = this.usesTeamLobby;
    let lastPhase = sim.phase;
    sim.onPhaseChange = () => {
      if (sim.phase !== 'results') this.againVotes.clear();
      // Bots someone voted off during the match leave now it's over.
      if (sim === this.sim && sim.phase !== 'playing' && this.refreshBots()) this.broadcastJson({ type: 'room', room: this.info() });
      if (sim.phase === 'waiting') this.resetTeamLobby(lastPhase === 'results' || lastPhase === 'playing');
      lastPhase = sim.phase;
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
      botVotes: this.votesBots ? [...this.conns.values()].filter((c) => c.wantBots).map((c) => c.playerId) : undefined,
    };
  }

  /** Public rooms decide bots by vote (private rooms leave it to the host; ranked never has any). */
  get votesBots(): boolean {
    return !this.isPrivate && !this.ranked;
  }

  /**
   * Between matches with nobody to play: waiting for players (not counting down to a start), or
   * the last moments of a results screen. The lobby moves people out of small rooms like this into
   * a busier one of the same mode.
   */
  get betweenMatches(): boolean {
    const s = this.sim;
    if (s.phase === 'waiting') return !this.lobbyStartsAt;
    return s.phase === 'results' && s.phaseEndsAt - s.time < 1.5;
  }

  /**
   * Public rooms: bots fill the empty spots while every player here wants them (the menu's Bots
   * switch, and the same switch in the pause menu and the team lobby), so one pool of players per
   * mode can hold people who want bots and people who don't. Bots never vanish in the middle of a
   * fight: switching them off waits for the match to end.
   */
  private refreshBots(): boolean {
    if (!this.votesBots) return false;
    const want = this.conns.size > 0 && [...this.conns.values()].every((c) => c.wantBots);
    if (want === this.settings.bots) return false;
    if (!want && this.sim.phase === 'playing' && this.sim.bots.size > 0) return false;
    this.settings = { ...this.settings, bots: want };
    this.balanceBots();
    return true;
  }

  canJoin(): boolean {
    return this.humanCount < this.capacity && !this.rankedLocked && !this.closed;
  }

  /** Mods and utilities this connection has unlocked. */
  private allowed(conn: { key: string | null }): { parts: string[]; utils: string[] } {
    if (!conn.key || !this.store) return unlockedAt(1);
    return this.store.unlocksAll(conn.key) ? unlockedAt(this.store.unlockLevel(conn.key)) : allowedLoadout(this.store.profile(conn.key));
  }

  /** Your chosen color if nobody else here is wearing it. */
  private colorFor(cosColor: string, playerId: number): number | undefined {
    const idx = Number(cosColor.split('.')[1]);
    if (!Number.isInteger(idx)) return undefined;
    for (const p of this.sim.players.values()) if (p.id !== playerId && p.color === idx) return undefined;
    return idx;
  }

  join(
    ws: WebSocket,
    name: string,
    guestId: string,
    loadout?: Loadout,
    identity: Identity = { key: null, accountId: null },
    wantMap: string | null = null,
    wantBots = this.settings.bots,
  ): Conn | null {
    if (!this.canJoin()) return null;
    // Make room by removing a bot if needed.
    if (this.playerCount >= BALANCE.match.maxPlayers) this.removeOneBot();
    const profile = identity.key && this.store ? this.store.profile(identity.key) : null;
    const cos = profile ? { ...profile.cosmetics } : { ...DEFAULT_COSMETICS };
    const clean = sanitizeLoadout(loadout, this.allowed(identity));
    const p = this.sim.addPlayer(name, { loadout: clean, cos, color: this.colorFor(cos.color, -1) });
    const conn: Conn = { ws, playerId: p.id, guestId, name, rtt: 0, inputMsgs: 0, key: identity.key, accountId: identity.accountId, chatTimes: [], reported: new Set(), wantMap, wantBots, botsVoteAt: 0 };
    this.conns.set(p.id, conn);
    if (this.ranked && identity.key) this.rankedKeys.set(p.id, identity.key);
    if (this.hostId < 0 || !this.conns.has(this.hostId)) this.hostId = p.id;
    this.send(conn, { type: 'welcome', v: PROTOCOL_VERSION, you: p.id, room: this.info(), tick: this.sim.tick, name });
    this.send(conn, this.matchMessage());
    this.send(conn, { type: 'entities', ...this.sim.entitySnapshot() });
    this.rosterDirty = true;
    this.lobbySent = '';
    this.refreshBots();
    this.balanceBots();
    // A real opponent arrived for a 1v1 that was warming up against a bot: start fresh.
    if (this.mode === 'duel' && this.humanCount === 2 && this.sim.autoStart) this.sim.startMatch();
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
    this.againVotes.delete(playerId);
    this.lobbyReady.delete(playerId);
    // Ranked: leaving mid-match forfeits (the sim ends the match and the other player wins).
    this.sim.removePlayer(playerId);
    if (this.hostId === playerId) {
      const next = this.conns.keys().next();
      this.hostId = next.done ? -1 : next.value;
      this.broadcastJson({ type: 'room', room: this.info() });
    }
    if (this.conns.size === 0) this.emptySince = Date.now();
    this.rosterDirty = true;
    if (this.refreshBots() || this.votesBots) this.broadcastJson({ type: 'room', room: this.info() });
    this.balanceBots();
    // Whoever is left may all be waiting on PLAY AGAIN already.
    this.checkAgain();
  }

  /**
   * PLAY AGAIN on the results screen. The host of a private room starts the next match right
   * away; anywhere else the wait ends as soon as every player in the room has pressed it.
   */
  private playAgain(playerId: number): void {
    if (this.sim.phase !== 'results' || this.ranked || this.challenge) return;
    if (this.isPrivate && playerId === this.hostId) {
      this.startNextNow();
      return;
    }
    this.againVotes.add(playerId);
    this.broadcastJson({ type: 'again', ids: [...this.againVotes] });
    this.checkAgain();
  }

  private checkAgain(): void {
    if (this.sim.phase !== 'results' || this.ranked || this.challenge || this.conns.size === 0 || this.againVotes.size === 0) return;
    for (const id of this.conns.keys()) if (!this.againVotes.has(id)) return;
    this.startNextNow();
  }

  private startNextNow(): void {
    const s = this.sim;
    if (this.usesTeamLobby) {
      // Team Knockout goes back to its team lobby, where pressing PLAY AGAIN counts as ready.
      const again = [...this.againVotes];
      s.toLobby();
      for (const id of again) if (this.conns.has(id)) this.lobbyReady.add(id);
      return;
    }
    if (s.autoStart) {
      // Cut the results short: the next tick moves on just as if the countdown ran out (new map included).
      s.phaseEndsAt = Math.min(s.phaseEndsAt, s.time);
    } else {
      s.toLobby();
      // Sudden Death settles its extra bots between matches (see tick).
      if (s.suddenDeath) this.balanceBots();
      if (s.canStart()) s.startMatch();
    }
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
    const teams = MODE_INFO_TEAMS.has(this.mode);
    while (bots < want && this.playerCount < BALANCE.match.maxPlayers) {
      // A spread of skill so new players can win fights and good players still get a challenge.
      const skill = [0.25, 0.45, 0.65, 0.35][(teams ? bots >> 1 : bots) % 4];
      const bot = this.sim.addBot(skill);
      bots++;
      // Team modes add bots in twins (same skill and loadout, one per team) so they're fair.
      if (teams && bots < want && this.playerCount < BALANCE.match.maxPlayers) {
        this.sim.addBot(skill, bot);
        bots++;
      }
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
        } else if (msg.action === 'ult') {
          // Fill ult meters (yours, or everyone's), optionally switching your ult first.
          const kind = ULT_IDS.find((u) => u === msg.kind);
          for (const p of this.sim.players.values()) {
            if (!msg.all && p.id !== conn.playerId) continue;
            if (kind && p.id === conn.playerId) {
              p.loadout = { ...p.loadout, ult: kind };
              if (p.pendingLoadout) p.pendingLoadout = { ...p.pendingLoadout, ult: kind };
              p.state.ultKind = ultIndex(kind);
            }
            p.state.ult = 1;
          }
        } else if (msg.action === 'gather') {
          // Line the bots up in front of you (to try ults on them).
          const me = this.sim.players.get(conn.playerId);
          let i = 0;
          for (const id of this.sim.bots.keys()) {
            const b = this.sim.players.get(id);
            if (!me || !b || b.state.mode === MODE_DEAD) continue;
            const a = me.state.yaw + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 0.3;
            const d = 6 + (i % 3) * 2.5;
            const x = me.state.px - Math.sin(a) * d;
            const z = me.state.pz - Math.cos(a) * d;
            const ground = this.sim.world.groundBelow(x, me.state.py + 3, z, 10);
            if (ground === null) continue;
            Object.assign(b.state, { px: x, py: ground + 0.01, pz: z, vx: 0, vy: 0, vz: 0, onGround: 1, launchTimer: 0 });
            i++;
          }
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
      case 'again':
        this.playAgain(conn.playerId);
        break;
      case 'team':
        this.teamAction(conn, msg);
        break;
      case 'bots':
        if (!this.votesBots || typeof msg.on !== 'boolean' || conn.wantBots === msg.on || Date.now() - conn.botsVoteAt < 400) return;
        conn.botsVoteAt = Date.now();
        conn.wantBots = msg.on;
        this.refreshBots();
        this.broadcastJson({ type: 'room', room: this.info() });
        break;
      case 'report':
        this.report(conn, msg.target, msg.reason);
        break;
      case 'host':
        if (conn.playerId !== this.hostId || !this.isPrivate || this.ranked) return;
        if (msg.action === 'kick' && typeof msg.id === 'number') this.kick(msg.id);
        else if (msg.action === 'settings' && msg.settings && typeof msg.settings === 'object') this.applySettings(msg.settings);
        else if (msg.action === 'restart') {
          // Team Knockout restarts through its lobby (teams and ready checks first).
          if (this.usesTeamLobby) this.sim.toLobby();
          else this.sim.startMatch();
        } else if (msg.action === 'start' && this.sim.canStart() && !this.usesTeamLobby) this.sim.startMatch();
        else if (msg.action === 'shuffle' && this.usesTeamLobby && this.sim.phase === 'waiting') {
          for (const [id, team] of shuffleTeams(this.seats())) this.sim.setTeam(id, team);
          this.lobbyStartsAt = 0;
          this.rosterDirty = true;
        } else if (msg.action === 'lock' && this.usesTeamLobby) this.teamsLocked = msg.locked === true;
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
    const clean = sanitizeSettings(raw);
    const merged = { ...this.settings, ...clean };
    if (clean.mode && clean.mode !== this.settings.mode) {
      // A mode with a map of its own moves there (unless the host picked a map as well), and Team
      // Knockout starts without bots unless the host switches them on.
      if (!clean.mapId) merged.mapId = homeMapFor(clean.mode) ?? merged.mapId;
      if (clean.mode === 'teamKnockout' && clean.bots === undefined) merged.bots = false;
      this.teamsLocked = false;
    }
    const next = fitMap(merged);
    const needNewSim = next.mapId !== this.settings.mapId || next.mode !== this.settings.mode;
    // Renaming the teams doesn't touch the match.
    const onlyNames = !needNewSim && next.durationSec === this.settings.durationSec && next.bots === this.settings.bots && next.events === this.settings.events;
    this.settings = next;
    if (onlyNames) {
      this.broadcastJson({ type: 'room', room: this.info() });
      return;
    }
    if (needNewSim) this.rebuild();
    else {
      // Sudden Death always runs its own fixed length.
      if (!this.sim.suddenDeath) this.sim.durationSec = next.durationSec;
      this.sim.eventMult = EVENT_MULT[next.events];
    }
    this.balanceBots();
    this.broadcastJson({ type: 'room', room: this.info() });
    // Private rooms go back to the lobby until the host starts; others start right away.
    if (this.sim.autoStart) this.sim.startMatch();
    else this.sim.toLobby();
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
    // The fresh match may sit waiting for players: clients must hear it's no longer the results.
    this.broadcastJson(this.matchMessage());
  }

  /**
   * Where a public knockout room goes when the results screen ends: the map most players here
   * picked on the menu (ties take turns), or the next map in the rotation when nobody picked one.
   */
  nextMap(): string {
    const votes = new Map<string, number>();
    for (const c of this.conns.values()) if (c.wantMap && KNOCKOUT_MAPS.includes(c.wantMap)) votes.set(c.wantMap, (votes.get(c.wantMap) ?? 0) + 1);
    const n = KNOCKOUT_MAPS.length;
    const from = Math.max(0, KNOCKOUT_MAPS.indexOf(this.settings.mapId));
    if (!votes.size) return KNOCKOUT_MAPS[(this.rotation + 1) % n];
    const top = Math.max(...votes.values());
    // The first top pick after the current map, so two maps with a vote each take turns.
    for (let i = 1; i <= n; i++) {
      const m = KNOCKOUT_MAPS[(from + i) % n];
      if (votes.get(m) === top) return m;
    }
    return this.settings.mapId;
  }

  private rotateMap(): void {
    const next = this.nextMap();
    this.rotation = Math.max(0, KNOCKOUT_MAPS.indexOf(next));
    if (next === this.settings.mapId) return;
    this.settings = { ...this.settings, mapId: next };
    this.rebuild();
    this.balanceBots();
    this.broadcastJson({ type: 'room', room: this.info() });
    this.rosterDirty = true;
  }

  // --- Team Knockout lobby ---------------------------------------------------------------------

  private seats(): LobbySeat[] {
    return [...this.sim.players.values()].map((p) => ({ id: p.id, team: p.team, bot: p.isBot, twin: p.twinId >= 0 ? p.twinId : undefined }));
  }

  /**
   * Back in the lobby: nobody's ready yet, and everyone gets the new state. After a match the
   * teams are dealt again (evenly, humans spread across both sides) unless the host locked them;
   * players can still switch before readying up.
   */
  private resetTeamLobby(afterMatch = false): void {
    this.lobbyReady.clear();
    this.lobbyStartsAt = 0;
    this.lobbyAutoReadyAt = 0;
    this.lobbySent = '';
    if (afterMatch && this.usesTeamLobby && !this.teamsLocked) {
      for (const [id, team] of shuffleTeams(this.seats())) this.sim.setTeam(id, team);
      this.rosterDirty = true;
    }
  }

  /** Picking a side or readying up (only between matches). */
  private teamAction(conn: Conn, msg: Extract<ClientMessage, { type: 'team' }>): void {
    if (!this.usesTeamLobby || this.sim.phase !== 'waiting') return;
    if (msg.action === 'ready') {
      if (msg.ready === true) this.lobbyReady.add(conn.playerId);
      else this.lobbyReady.delete(conn.playerId);
      return;
    }
    const team = msg.team;
    if ((team !== 0 && team !== 1) || this.teamsLocked) return;
    const p = this.sim.players.get(conn.playerId);
    if (!p || p.team === team) return;
    // A side can take half the room; bots there step across to make space.
    const humans = [...this.sim.players.values()].filter((q) => q.team === team && !q.isBot).length;
    if (humans >= MAX_PER_SIDE) return;
    this.sim.setTeam(p.id, team);
    this.sim.balanceTeams();
    // Teams changed: a countdown already running starts over, so everyone sees the new sides.
    this.lobbyStartsAt = 0;
    this.rosterDirty = true;
  }

  /**
   * Runs the lobby between Team Knockout matches: once both teams have enough players, they're
   * even, and every human is ready, a short countdown starts the match (anything changing stops
   * it). In public rooms, idle players can't hold everyone up: once the teams are fine, everyone
   * counts as ready after a while.
   */
  private stepTeamLobby(): void {
    const s = this.sim;
    if (s.phase !== 'waiting') return;
    const T = BALANCE.modes.teamKnockout;
    for (const id of this.lobbyReady) if (!this.conns.has(id)) this.lobbyReady.delete(id);
    let check = checkTeamLobby(this.seats(), this.lobbyReady);
    if (!this.isPrivate && check.teamsOk && !check.ok) {
      if (!this.lobbyAutoReadyAt) this.lobbyAutoReadyAt = s.tick + T.autoReady * BALANCE.tickRate;
      else if (s.tick >= this.lobbyAutoReadyAt) {
        for (const id of this.conns.keys()) this.lobbyReady.add(id);
        check = checkTeamLobby(this.seats(), this.lobbyReady);
      }
    }
    if (check.ok || !check.teamsOk) this.lobbyAutoReadyAt = 0;
    if (!check.ok) this.lobbyStartsAt = 0;
    else if (!this.lobbyStartsAt) this.lobbyStartsAt = s.tick + T.countdown * BALANCE.tickRate;
    else if (s.tick >= this.lobbyStartsAt) {
      this.lobbyStartsAt = 0;
      s.startMatch();
      return;
    }
    const state: TeamLobbyState = {
      ready: [...this.lobbyReady].sort((a, b) => a - b),
      locked: this.teamsLocked,
      startsAt: this.lobbyStartsAt,
      autoReadyAt: this.lobbyAutoReadyAt,
      minPerSide: T.minPerSide,
      waiting: check.ok ? '' : check.waiting,
    };
    const key = JSON.stringify(state);
    if (key === this.lobbySent) return;
    this.lobbySent = key;
    this.broadcastJson({ type: 'teamLobby', lobby: state });
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
    if (reason === 'face' || reason === 'decal') {
      // Enough different players reporting a face scan (or decal) hides it until an admin looks.
      if (victim.accountId !== null && this.store?.reportImage(reason, victim.accountId, reporterKey)) {
        this.rosterDirty = true;
        this.send(victim, { type: 'renamed', name: victim.name, message: `Other players reported your ${reason === 'face' ? 'face scan' : 'decal'}, so it is hidden until a moderator checks it.` });
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
    if (!this.isPrivate && homeMapFor(this.mode) === null && s.phase === 'results' && s.time + s.dt >= s.phaseEndsAt && this.humanCount > 0) {
      this.rotateMap();
    } else if (s.suddenDeath && s.phase === 'results' && s.time + s.dt >= s.phaseEndsAt) {
      // Sudden Death keeps extra bots through a match (see balanceBots); settle up before the next.
      this.balanceBots();
    }
    this.sim.step();
    if (this.usesTeamLobby) this.stepTeamLobby();
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

  private faceOf(conn: Conn | undefined, kind: 'face' | 'decal' = 'face'): RosterEntry['face'] {
    const v = conn && this.store ? this.store.imageVersion(kind, conn.accountId) : undefined;
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
      decal: this.faceOf(conn, 'decal'),
      acc: conn?.accountId ?? undefined,
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
      round: s.roundInfo(),
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

/**
 * Ball and Pump have their own arenas; the knockout modes can't use those. Team Knockout plays on
 * its own map or any knockout map.
 */
export function fitMap(s: RoomSettings): RoomSettings {
  const ok = mapsForMode(s.mode);
  if (!ok.includes(s.mapId)) return { ...s, mapId: homeMapFor(s.mode) ?? ok[0] };
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
  if (Array.isArray(raw.teamNames) && raw.teamNames.length === 2) out.teamNames = [cleanTeamName(raw.teamNames[0]), cleanTeamName(raw.teamNames[1])];
  return out;
}

/** A team name the host typed: up to 16 plain characters, nothing rude ('' = the default name). */
export function cleanTeamName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const s = raw
    .replace(/[^\p{L}\p{N} '!?.&\-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 16)
    .trim();
  return s && !isNameBlocked(s) ? s : '';
}
