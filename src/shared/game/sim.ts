import { BALANCE } from '../balance';
import { type InputFrame, emptyInput } from '../input';
import type { MapDef } from '../maps/types';
import {
  ALL_FEATURES,
  MODE_CLIMB,
  MODE_DEAD,
  MODE_HANG,
  MODE_HELD,
  MODE_NORMAL,
  type PlayerState,
  StepResult,
  type StepContext,
  type WeaponStats,
  createPlayerState,
  copyPlayerState,
  depenetrate,
  eyeHeight,
  grappleLocked,
  grappleScale,
  inflationMass,
  lookDir,
  playerHeight,
  playerRadius,
  releaseLedge,
  stepPlayer,
} from '../player';
import { World } from '../world';
import {
  DEFAULT_LOADOUT,
  type Loadout,
  PART_SLOTS,
  type PartId,
  SLOT_PARTS,
  UTILITY_IDS,
  type UtilityId,
  WEAPON_IDS,
  computeWeaponStats,
  sanitizeLoadout,
  utilityCooldown,
  weaponIndex,
} from '../loadout';
import { pelletDirs, pelletFalloff, shotDir, spreadAt } from '../shots';
import { BOT_NAMES, BotBrain } from './bot';
import type { ModeState } from '../protocol';
import { COSMETIC_SLOTS, type Cosmetics, DEFAULT_COSMETICS, ITEMS } from '../economy';
import { type BallEvent, BallGame, type ModeId, PumpGame, isTeamMode } from './modes';
import { CHAOS_KINDS, type ChaosEvent, type ChaosKind, type Environment, NORMAL_ENV, chaosDuration, envAt } from './chaos';
import { collapsePlan } from './shrink';
import type { GameEvent, LootKind } from './events';
import { type AirMine, LOOT_KINDS, type LootCrate, type Tornado, floorBelow, lostBelow, pickLootSpot, rollLoot, stepCrate, stepTornado } from './loot';
import { UltSystem } from './ultSim';
import { ULT_IDS, isUltProjectile, randomUlt, ultIndex, ultMassMult, ultPowerMult } from './ults';

export type { ModeId } from './modes';
export type MatchPhase = 'waiting' | 'playing' | 'results';

export interface MatchStats {
  kos: number;
  deaths: number;
  falls: number;
  hits: number;
  shots: number;
  longestLaunch: number;
  chainKos: number;
  timesPopped: number;
  bestCombo: number;
  throws: number;
  stomps: number;
  goals: number;
  /** Seconds spent filling your own team's pump. */
  pumpTime: number;
  /** Knockouts of whoever wore the crown (for daily challenges). */
  crownKos: number;
}

export interface SimPlayer {
  id: number;
  name: string;
  color: number;
  isBot: boolean;
  /** Team modes: the bot's twin on the other team (same skill and loadout), or -1. */
  twinId: number;
  /** Last time they stood on solid (not bouncy) ground in control: a knockout before that is still their attacker's. */
  footedAt: number;
  state: PlayerState;
  lastInput: InputFrame;
  queue: InputFrame[];
  lastSeq: number;
  /** Ticks of simulation this player is owed (input processing budget). */
  owed: number;
  /** Ticks simulated with a held input during a lag spike, not yet made up by real frames. */
  synth: number;
  score: number;
  stats: MatchStats;
  lastAttacker: number;
  lastAttackTime: number;
  respawnAt: number;
  /** Where the current launch started, for "longest launch" stats. */
  launchFromX: number;
  launchFromZ: number;
  launchBy: number;
  launchStartTick: number;
  joinedAt: number;
  /** Team (0 or 1) in team modes, -1 in free-for-all. */
  team: number;
  /** Air combo tracking: who is juggling this player and how many hits so far. */
  comboBy: number;
  comboCount: number;
  comboTime: number;
  loadout: Loadout;
  /** Applied at the next respawn so you can't swap weapons mid-fight. */
  pendingLoadout: Loadout | null;
  weapon: WeaponStats;
  /** Recent positions for lag-compensated hitscan (ring buffer indexed by tick). */
  history: { tick: number; px: number; py: number; pz: number; inflation: number; mode: number }[];
  /** Knockouts in a row without being knocked out (for the crown). */
  streak: number;
  /** Whoever last knocked this player out (revenge target). */
  nemesis: number;
  /** Chain reaction credit: who started the chain that last hit this player. */
  chainBy: number;
  chainTime: number;
  chainCool: Map<number, number>;
  koTimes: number[];
  /** Sim time until which this player is turned into an ult character (bigger hitbox). */
  bigUntil: number;
  /** Who hit this player, and when (sim time): for ult assists. Cleared on knockout. */
  hitBy: Map<number, number>;
  /** Inflation before a max-pressure event (-1 when not in one). */
  savedInflation: number;
  /** Last time each target got a "blow" event from this player's leaf blower. */
  blowEvents: Map<number, number>;
  streaming: boolean;
  /** Pop Gun corks count as a quarter of a shot / hit each in match stats (these hold the remainder). */
  lightShots: number;
  lightHits: number;
  /** Looks only; never read by the simulation. */
  cos: Cosmetics;
  /**
   * Sudden Death: when this player was popped out of the current round (Infinity while still in;
   * -Infinity when they joined after it started and wait for the next one).
   */
  outAt: number;
  /** Sudden Death: rounds won this match (first to BALANCE.modes.suddenDeath.roundsToWin takes it). */
  roundWins: number;
  /** Sudden Death: knockouts and hits at the start of this round (the round's time-limit tie-break). */
  roundBase: { kos: number; hits: number };
}

/** Thrown or fired objects. Kind 0 is a weapon shot; the rest are utilities. */
export const PROJ_AIR = 0;
export const PROJ_AIR_GRENADE = 1;
export const PROJ_VACUUM = 2;
export const PROJ_PAD = 3;
export const PROJ_WALL = 4;
export const PROJ_MINE = 5;
export const PROJ_HELIUM = 6;

/** Projectile kind each thrown utility flies as (-1: not thrown). */
const UTIL_PROJ: Record<UtilityId, number> = {
  bouncePad: PROJ_PAD,
  airGrenade: PROJ_AIR_GRENADE,
  vacuumGrenade: PROJ_VACUUM,
  inflatableWall: PROJ_WALL,
  airMine: PROJ_MINE,
  heliumBomb: PROJ_HELIUM,
  tornado: -1,
};

/** A Helium Bomb's cloud: enemies who touch it start floating (once per cloud). */
export interface HeliumCloud {
  id: number;
  owner: number;
  x: number;
  y: number;
  z: number;
  until: number;
  touched: Set<number>;
}

/** A tornado on the server, plus when it caught each player (it lets go after a while). */
export interface SimTornado extends Tornado {
  caught: Map<number, number>;
}

export interface VacuumField {
  x: number;
  y: number;
  z: number;
  owner: number;
  until: number;
}

export interface Pickup {
  id: number;
  kind: 'soda' | 'pin';
  x: number;
  y: number;
  z: number;
  active: boolean;
  respawnAt: number;
}

export interface DynamicSolidInfo {
  id: number;
  min: [number, number, number];
  max: [number, number, number];
  expires: number;
  raft: boolean;
}

export interface Projectile {
  id: number;
  owner: number;
  /** PROJ_* kind. */
  weapon: number;
  /** Seconds until a grenade goes off (utilities only). */
  fuse: number;
  /** Horizontal direction it was thrown (walls face this way). */
  throwX: number;
  throwZ: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  radius: number;
  power: number;
  charge: number;
  gravity: number;
  expires: number;
  blastRadius: number;
  inflation: number;
  knockback: number;
  /** Pop Gun corks: hits push and inflate a little instead of launching. */
  light?: boolean;
  /** Weapon index of a weapon shot (for visuals). */
  wi?: number;
  /** Homing target id and turn rate in rad/s (ult rockets, shots fired during The Chase). */
  homing?: number;
  turn?: number;
  /** Fired by an ult (its hits don't refill the ult meter). */
  ult?: boolean;
  /**
   * Lag compensation: how many ticks behind the present the shooter saw everyone else when they
   * fired. Hits are checked against where players were that long ago, so a shot that's on target
   * on your screen hits (see stepProjectiles).
   */
  lag?: number;
}

/** Most a projectile's hit check looks back in time for the shooter's view (ticks, ~0.4 s). */
export const PROJ_REWIND_MAX = 24;

export interface SimOptions {
  map: MapDef;
  mode?: ModeId;
  durationSec?: number;
  features?: Partial<StepContext['features']>;
}

export interface ReplayData {
  victim: number;
  by: number;
  distance: number;
  ko: boolean;
  /** Frames at 30 fps: [tick, then per player: id, x, y, z, yaw, inflation %, flags]. */
  frames: number[][];
}

export interface MatchAward {
  key: 'longestLaunch' | 'mostKos' | 'mostChain' | 'mostPopped' | 'bestCombo';
  id: number;
  value: number;
}

export interface MatchResult {
  winnerId: number;
  mode: ModeId;
  /** Team modes: final team scores (goals, knockouts, or pump fill %) and the winning team (-1 = draw). */
  teams: { scores: [number, number]; winner: number } | null;
  /** Sudden Death standings also carry each player's round wins. */
  standings: { id: number; name: string; score: number; stats: MatchStats; isBot: boolean; roundWins?: number }[];
  longestLaunch: { id: number; distance: number } | null;
  awards: MatchAward[];
  replay: ReplayData | null;
  /** Sudden Death: round wins needed to take the match, and how many rounds were played. */
  rounds?: { target: number; played: number };
}

/** Sudden Death round state for clients (sent with the match message). */
export interface RoundInfo {
  /** Current round (1 = first). */
  n: number;
  /** Round wins needed to take the match. */
  target: number;
  /** The round is decided and the next one (or the results) is coming up. */
  intermission: boolean;
}

/**
 * How much of a weapon's inflation a shot of this power adds. Quick taps inflate nearly as much as
 * a full charge; charging mostly buys launch power.
 */
export function shotInflation(power: number): number {
  return power + (1 - power) * BALANCE.inflation.tapBonus;
}

function newStats(): MatchStats {
  return { kos: 0, deaths: 0, falls: 0, hits: 0, shots: 0, longestLaunch: 0, chainKos: 0, timesPopped: 0, bestCombo: 0, throws: 0, stomps: 0, goals: 0, pumpTime: 0, crownKos: 0 };
}

const MAX_QUEUE = 12;
const MAX_BEHIND = 6;
const MAX_AHEAD = 2;

/**
 * The authoritative game simulation. Owns the world, players, projectiles, and match rules. The
 * server wraps it with networking; tests drive it directly.
 */
export class GameSim {
  readonly map: MapDef;
  readonly world: World;
  readonly players = new Map<number, SimPlayer>();
  readonly projectiles: Projectile[] = [];
  events: GameEvent[] = [];
  tick = 0;
  time = 0;
  readonly dt = 1 / BALANCE.tickRate;
  mode: ModeId;
  durationSec: number;
  phase: MatchPhase = 'waiting';
  /**
   * Starts a match by itself once two players are in, and the next one after the results (public
   * rooms). Private rooms turn this off: they sit in the lobby ('waiting', where nothing counts)
   * until the host calls startMatch, and go back there after every match.
   */
  autoStart = true;
  /** Team Knockout's lobby: players pick their sides between matches (see balanceTeams). */
  teamPick = false;
  /** Ranked: one match with the same two players, no joining, leaving forfeits. */
  fixedLineup = false;
  matchStartedAt = 0;
  phaseEndsAt = 0;
  matchNumber = 0;
  lastResult: MatchResult | null = null;
  features: StepContext['features'];
  private nextProjectileId = 1;
  private readonly stepOut = new StepResult();
  private readonly ctx: StepContext;
  /** Called whenever the match phase changes (the server uses it to broadcast). */
  onPhaseChange: (() => void) | null = null;
  readonly bots = new Map<number, BotBrain>();
  readonly vacuums: VacuumField[] = [];
  /** Ultimate abilities (meter, lock-ons, Crop Duster clouds, Robot Mode rockets). */
  readonly ults = new UltSystem(this);
  readonly pickups: Pickup[] = [];
  readonly dynamicSolids = new Map<number, DynamicSolidInfo>();
  /** Floor loot: supply crates drifting down or waiting on the ground. */
  readonly crates: LootCrate[] = [];
  readonly mines: AirMine[] = [];
  readonly heliumClouds: HeliumCloud[] = [];
  readonly tornados: SimTornado[] = [];
  /** Supply drops on/off (tests that need a quiet map can switch them off). */
  lootEnabled = true;
  private nextLootAt = Infinity;
  private nextLootId = 1;
  private nextGadgetId = 1;
  private readonly lostY: number;
  private nextPinAt = 0;
  private nextPadId = 1000;
  /** Random events: the one running now and the one announced next. */
  chaosCurrent: ChaosEvent | null = null;
  chaosNext: ChaosEvent | null = null;
  private nextChaosAt = Infinity;
  private lastChaosKind: ChaosKind | null = null;
  /** 0 = off, 0.5 = rare, 1 = normal, 2 = frequent (private room hosts pick). */
  eventMult = 1;
  crownId = -1;
  /** Team scores (team knockouts or goals). */
  teamScores: [number, number] = [0, 0];

  /** A team's score in its own units: knockouts, goals, or (Pump) its giant's fill 0..1. */
  teamScoreOf(team: number): number {
    const t = team === 1 ? 1 : 0;
    return this.pumpGame ? this.pumpGame.fill[t] : this.teamScores[t];
  }
  readonly ballGame: BallGame | null;
  readonly pumpGame: PumpGame | null;
  private finalAnnounced = false;
  private firstKo = false;
  private pendingEnd = false;
  /** Next stage of the world's collapse plan to announce. */
  private shrinkNext = 0;
  /** Sudden Death: players still in (for "N left" events) and when the current round wraps up. */
  private sdAlive = 0;
  private sdEndAt = Infinity;
  /** Sudden Death: the current round (1 = first; 0 before a match) and when it started. */
  sdRound = 0;
  sdRoundStartedAt = 0;
  /** Sudden Death: the round is decided; the next round (or the results) starts at sdEndAt. */
  sdIntermission = false;
  /** Sudden Death: someone reached the round wins needed, so the results follow this round. */
  private sdMatchOver = false;
  private readonly env: Environment = { ...NORMAL_ENV };
  /** Rolling recording of the last few seconds (for the longest-launch replay). */
  private replayBuf: number[][] = [];
  private bestReplay: ReplayData | null = null;
  private replayIds: Set<number> = new Set();
  private replayPostRoll = 0;
  /** Center of the main play area; bots recover toward it. */
  readonly homePoint: { x: number; y: number; z: number };

  constructor(opts: SimOptions) {
    this.map = opts.map;
    this.world = new World(opts.map);
    this.mode = opts.mode ?? 'knockout';
    this.durationSec = opts.durationSec ?? BALANCE.match.durationSec;
    this.features = { ...ALL_FEATURES, ...opts.features };
    this.ctx = { world: this.world, dt: this.dt, weapon: computeWeaponStats('airCannon', []), features: this.features };
    this.map.pickups.forEach(([x, y, z], i) => this.pickups.push({ id: i, kind: 'soda', x, y, z, active: true, respawnAt: 0 }));
    this.ballGame = this.mode === 'ball' && this.map.ball ? new BallGame(this.map, this.world) : null;
    this.pumpGame = this.mode === 'pump' && this.map.pumps ? new PumpGame(this.map) : null;
    if (this.mode === 'duel') this.durationSec = opts.durationSec ?? BALANCE.modes.duel.durationSec;
    // Sudden Death always has the same short cap (its shrinking schedule is built around it).
    if (this.mode === 'suddenDeath') this.durationSec = BALANCE.modes.suddenDeath.durationSec;
    this.scheduleNextPin();
    this.lostY = lostBelow(this.map);
    const n = this.map.spawns.length;
    this.homePoint = {
      x: this.map.spawns.reduce((a, s) => a + s[0], 0) / n,
      y: this.map.spawns.reduce((a, s) => a + s[1], 0) / n,
      z: this.map.spawns.reduce((a, s) => a + s[2], 0) / n,
    };
  }


  // --- Players -----------------------------------------------------------------------------

  addPlayer(name: string, opts: { isBot?: boolean; color?: number; id?: number; loadout?: Loadout; team?: number; cos?: Cosmetics } = {}): SimPlayer {
    const id = opts.id ?? this.freeId();
    const state = createPlayerState();
    state.mode = MODE_DEAD;
    const p: SimPlayer = {
      id,
      name,
      color: opts.color ?? this.freeColor(),
      isBot: !!opts.isBot,
      twinId: -1,
      footedAt: 0,
      state,
      lastInput: emptyInput(),
      queue: [],
      lastSeq: 0,
      owed: 0,
      synth: 0,
      score: 0,
      stats: newStats(),
      lastAttacker: -1,
      lastAttackTime: -999,
      respawnAt: this.time,
      launchFromX: 0,
      launchFromZ: 0,
      launchBy: -1,
      launchStartTick: 0,
      joinedAt: this.time,
      team: -1,
      comboBy: -1,
      comboCount: 0,
      comboTime: -999,
      loadout: sanitizeLoadout(opts.loadout ?? DEFAULT_LOADOUT),
      pendingLoadout: null,
      weapon: computeWeaponStats('airCannon', []),
      history: [],
      blowEvents: new Map(),
      streaming: false,
      lightShots: 0,
      lightHits: 0,
      streak: 0,
      nemesis: -1,
      chainBy: -1,
      chainTime: -999,
      chainCool: new Map(),
      koTimes: [],
      bigUntil: 0,
      hitBy: new Map(),
      savedInflation: -1,
      cos: { ...(opts.cos ?? DEFAULT_COSMETICS) },
      outAt: Infinity,
      roundWins: 0,
      roundBase: { kos: 0, hits: 0 },
    };
    p.weapon = computeWeaponStats(p.loadout.weapon, p.loadout.parts);
    if (this.teams) p.team = opts.team ?? this.smallerTeam();
    this.players.set(id, p);
    if (this.suddenDeath && this.phase === 'playing' && (this.sdIntermission || this.time > this.sdRoundStartedAt + BALANCE.modes.suddenDeath.joinGrace)) {
      // Sudden Death is one life per round: late arrivals watch until the next round.
      p.outAt = -Infinity;
      p.respawnAt = Infinity;
    } else this.respawn(p);
    this.updatePhase();
    this.checkSurvivors();
    return p;
  }

  /**
   * Adds a bot. With a `twin` (team modes), it copies that bot's skill and loadout and plays for
   * the other team, so the bots never tip a match one way (random skill and weapon splits decided
   * every bot-filled Team Knockout match in testing).
   */
  addBot(skill = 0.5, twin?: SimPlayer): SimPlayer {
    const used = new Set([...this.players.values()].map((p) => p.name));
    const name = BOT_NAMES.find((n) => !used.has(n)) ?? `Bot ${this.players.size + 1}`;
    // Bots bring a mix of weapons and utilities so every loadout shows up in public games.
    const pick = <T,>(xs: readonly T[]) => xs[Math.floor(Math.random() * xs.length)];
    const utils = [...UTILITY_IDS].sort(() => Math.random() - 0.5);
    // About half of them tinker with one or two weapon parts.
    const parts: Partial<Record<(typeof PART_SLOTS)[number], PartId>> = {};
    const tinker = Math.random() < 0.5 ? 1 + Math.floor(Math.random() * 2) : 0;
    for (let i = 0; i < tinker; i++) {
      const slot = pick(PART_SLOTS);
      parts[slot] = pick(SLOT_PARTS[slot].slice(1));
    }
    const loadout = twin ? { ...twin.loadout } : sanitizeLoadout({ weapon: pick(WEAPON_IDS), parts, utils: [utils[0], utils[1]], ult: pick(ULT_IDS) });
    // Bots dress up too, so every look shows up in public games.
    const cos = { ...DEFAULT_COSMETICS };
    for (const slot of COSMETIC_SLOTS) {
      if (slot === 'color' || Math.random() < 0.4) continue;
      // Level rewards stay special: bots don't wear them.
      const options = ITEMS.filter((i) => i.slot === slot && !i.levelReq);
      cos[slot] = pick(options).id;
    }
    const p = this.addPlayer(name, { isBot: true, loadout, cos });
    this.bots.set(p.id, new BotBrain(skill, p.id * 7919 + this.tick));
    if (twin && this.teams) {
      p.twinId = twin.id;
      twin.twinId = p.id;
      if (twin.team === 0 || twin.team === 1) this.setTeam(p.id, twin.team === 0 ? 1 : 0);
    }
    return p;
  }

  removePlayer(id: number): void {
    const p = this.players.get(id);
    if (!p) return;
    const twin = this.players.get(p.twinId);
    if (twin) twin.twinId = -1;
    this.releaseInvolving(p);
    this.players.delete(id);
    this.bots.delete(id);
    // Their gadgets leave with them (a newcomer could get the same id).
    for (let i = this.mines.length - 1; i >= 0; i--) if (this.mines[i].owner === id) this.removeMine(i, false);
    for (const t of this.tornados) if (t.owner === id) t.until = this.tick;
    for (const c of this.heliumClouds) if (c.owner === id) c.until = this.time;
    for (const other of this.players.values()) {
      if (other.lastAttacker === id) other.lastAttacker = -1;
    }
    this.balanceTeams();
    this.updatePhase();
    this.checkSurvivors();
  }

  private freeId(): number {
    for (let i = 0; i < 255; i++) if (!this.players.has(i)) return i;
    throw new Error('room full');
  }

  private freeColor(): number {
    const used = new Set([...this.players.values()].map((p) => p.color));
    for (let i = 0; i < 10; i++) if (!used.has(i)) return i;
    return Math.floor(Math.random() * 10);
  }

  /** Changes a player's loadout; it takes effect when they next respawn. */
  setLoadout(id: number, raw: unknown): void {
    const p = this.players.get(id);
    if (!p) return;
    const l = sanitizeLoadout(raw);
    if (p.state.mode === MODE_DEAD || this.phase === 'waiting') {
      p.loadout = l;
      p.pendingLoadout = null;
      p.weapon = computeWeaponStats(l.weapon, l.parts);
      p.state.ammo = p.weapon.ammo;
      p.state.charging = 0;
      p.state.charge = 0;
      p.state.reloadTimer = 0;
      this.emitLoadout(p);
    } else {
      p.pendingLoadout = l;
    }
  }

  private emitLoadout(p: SimPlayer): void {
    this.events.push({ t: 'loadout', tick: this.tick, id: p.id, weapon: p.loadout.weapon, parts: { ...p.loadout.parts }, utils: [...p.loadout.utils], ult: p.loadout.ult });
  }

  get teams(): boolean {
    return isTeamMode(this.mode);
  }

  get suddenDeath(): boolean {
    return this.mode === 'suddenDeath';
  }

  /** Sudden Death: popped out of this round, or waiting for the next one. */
  isOut(p: SimPlayer): boolean {
    return this.suddenDeath && p.outAt !== Infinity;
  }

  /** Sudden Death round state for clients (null in other modes or outside a match). */
  roundInfo(): RoundInfo | null {
    if (!this.suddenDeath || this.phase === 'waiting' || this.sdRound === 0) return null;
    return { n: this.sdRound, target: BALANCE.modes.suddenDeath.roundsToWin, intermission: this.sdIntermission || this.phase === 'results' };
  }

  /** The host can start a match: the room is in the lobby and there's someone to play against. */
  canStart(): boolean {
    return this.phase === 'waiting' && this.players.size >= 2;
  }

  private smallerTeam(): number {
    let a = 0;
    let b = 0;
    for (const p of this.players.values()) {
      if (p.team === 0) a++;
      else if (p.team === 1) b++;
    }
    return a < b ? 0 : b < a ? 1 : Math.random() < 0.5 ? 0 : 1;
  }

  /** Team scores for the snapshot (pump mode reports fill instead). */
  modeState(): ModeState | null {
    if (!this.teams) return null;
    const b = this.ballGame?.ball;
    return {
      teamScores: [...this.teamScores],
      ball: b ? { x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy, vz: b.vz, inPlay: this.ballGame!.inPlay } : null,
      pump: this.pumpGame ? { fill: [...this.pumpGame.fill], states: [...this.pumpGame.states] } : null,
    };
  }

  /**
   * Moves bots (then the newest humans) between teams until they're even. In a team lobby
   * (`teamPick`, between matches) people pick their own side, so only bots are moved.
   */
  balanceTeams(): void {
    if (!this.teams) return;
    const botsOnly = this.teamPick && this.phase === 'waiting';
    for (let guard = 0; guard < 10; guard++) {
      const t0 = [...this.players.values()].filter((p) => p.team === 0);
      const t1 = [...this.players.values()].filter((p) => p.team === 1);
      if (Math.abs(t0.length - t1.length) <= 1) return;
      const big = t0.length > t1.length ? t0 : t1;
      const mover = big.find((p) => p.isBot) ?? (botsOnly ? undefined : big.sort((a, b) => b.joinedAt - a.joinedAt)[0]);
      if (!mover) return;
      mover.team = 1 - mover.team;
      if (mover.state.mode !== MODE_DEAD) this.respawn(mover);
    }
  }

  /** Puts a player on a team (the team lobby); they come back in at that team's base. */
  setTeam(id: number, team: 0 | 1): void {
    const p = this.players.get(id);
    if (!p || !this.teams || p.team === team) return;
    p.team = team;
    if (p.state.mode !== MODE_DEAD) this.respawn(p);
  }

  /** True if `a` may hit/push `b` (no friendly fire in team modes). */
  isEnemy(a: number, b: number): boolean {
    if (a === b) return false;
    if (!this.teams) return true;
    const pa = this.players.get(a);
    const pb = this.players.get(b);
    return !pa || !pb || pa.team !== pb.team;
  }

  humanCount(): number {
    let n = 0;
    for (const p of this.players.values()) if (!p.isBot) n++;
    return n;
  }

  queueInput(id: number, frame: InputFrame): void {
    const p = this.players.get(id);
    if (!p) return;
    // Drop stale or duplicate frames.
    if (frame.seq <= p.lastSeq && p.lastSeq !== 0) return;
    const last = p.queue[p.queue.length - 1];
    if (last && frame.seq <= last.seq) return;
    p.queue.push(frame);
    while (p.queue.length > MAX_QUEUE) p.queue.shift();
  }

  // --- Main loop ---------------------------------------------------------------------------

  /** Advances the whole game by one fixed tick. */
  step(): void {
    this.tick++;
    this.time = this.tick * this.dt;
    this.world.setTime(this.time);

    this.stepMatch();
    this.updateShrink();
    this.updateChaos();
    this.ctx.env = envAt([this.chaosCurrent, this.chaosNext], this.tick, this.env);

    for (const [id, brain] of this.bots) {
      const p = this.players.get(id);
      if (p) p.queue.push(brain.think(this, p));
    }

    for (const p of this.players.values()) {
      if (p.state.mode === MODE_DEAD) {
        // Keep consuming input so counters stay in sync while waiting to respawn.
        this.drainInputs(p);
        if (this.phase !== 'results' && this.time >= p.respawnAt) this.respawn(p);
        continue;
      }
      this.processInputs(p);
    }
    this.world.setTime(this.time);

    this.updateHolds();
    this.separatePlayers();
    this.chainReactions();
    this.stepProjectiles();
    this.stepVacuums();
    this.ults.step();
    this.stepModes();
    this.stepPickups();
    this.stepLoot();
    this.stepGadgets();
    this.expireDynamics();
    this.recordHistory();
    this.trackFooting();
    this.recordReplayFrame();
    this.checkBlastZones();
    // After every knockout this tick, so players popped together count as going out together.
    this.checkSurvivors();
  }

  private drainInputs(p: SimPlayer): void {
    p.owed = 0;
    p.synth = 0;
    let last: InputFrame | undefined;
    while (p.queue.length) last = p.queue.shift();
    if (last) {
      p.lastSeq = last.seq;
      // Counters must follow the client even while dead so no phantom presses appear later.
      this.ctx.weapon = p.weapon;
      stepPlayer(p.state, last, this.ctx, this.stepOut);
      p.lastInput = last;
    }
  }

  private processInputs(p: SimPlayer): void {
    if (p.isBot) {
      // Bots produce exactly one frame per tick.
      const f = p.queue.shift() ?? p.lastInput;
      this.applyInput(p, f);
      return;
    }
    p.owed += 1;
    // Frames for ticks already simulated with a held input (a lag spike) are dropped when they
    // finally arrive, so the spike doesn't leave a lasting input delay. Presses are counters, so
    // the next frame still carries them.
    while (p.synth > 0 && p.queue.length > 1) {
      p.queue.shift();
      p.synth--;
    }
    const n = Math.min(p.queue.length, Math.max(0, p.owed + MAX_AHEAD), 4);
    for (let i = 0; i < n; i++) {
      const f = p.queue.shift()!;
      // Stagger world time so moving platforms carry correctly when catching up.
      this.world.setTime(this.time - (n - 1 - i) * this.dt);
      this.applyInput(p, f);
      p.owed -= 1;
    }
    if (p.owed > MAX_BEHIND) {
      // The client is starving us (lag spike). Keep simulating with its last held input so it
      // cannot freeze in mid-air.
      this.world.setTime(this.time);
      while (p.owed > MAX_BEHIND) {
        this.applyInput(p, p.lastInput, true);
        p.owed -= 1;
        p.synth = Math.min(p.synth + 1, 30);
      }
    }
  }

  private applyInput(p: SimPlayer, f: InputFrame, synthetic = false): void {
    const s = p.state;
    if (!synthetic) {
      p.lastSeq = f.seq;
      p.lastInput = f;
    }
    const out = this.stepOut;
    this.ctx.weapon = p.weapon;
    stepPlayer(s, f, this.ctx, out);
    this.handleStepResult(p, out, f);
  }

  private handleStepResult(p: SimPlayer, out: StepResult, input: InputFrame): void {
    const s = p.state;
    const tick = this.tick;
    this.ults.afterStep(p, out);
    if (out.fired?.ult) {
      this.ults.fireBigBlow(p, out.fired, input.seq);
    } else if (out.fired) {
      const f = out.fired;
      // Mega Blast shots hit harder (and projectiles are bigger with a wider blast); so does Juice.
      const boost = ultPowerMult(s);
      const hard = (f.mega ? f.power * BALANCE.streaks.megaKnockback : f.power) * boost;
      switch (p.weapon.kind) {
        case 'cone':
          this.ults.bendAim(p, f);
          this.fireCone(p, f.ox, f.oy, f.oz, f.dx, f.dy, f.dz, hard, input.viewTick);
          break;
        case 'hitscan':
          this.ults.bendAim(p, f);
          this.fireHitscan(p, f.dx, f.dy, f.dz, hard, input.viewTick);
          break;
        case 'spread':
          this.fireSpread(p, f.dx, f.dy, f.dz, hard, f.charge, input.viewTick);
          break;
        default:
          this.spawnShot(p, f.ox, f.oy, f.oz, f.dx, f.dy, f.dz, f.power, f.charge, input.seq, f.mega, boost, input.viewTick);
      }
    }
    p.streaming = out.stream > 0;
    if (out.stream > 0) this.blow(p, out.stream, input.viewTick);
    if (out.util1) this.useUtility(p, 0);
    if (out.util2) this.useUtility(p, 1);
    if (out.jumped) this.events.push({ t: 'move', tick, id: p.id, kind: out.springJump ? 'spring' : 'jump', x: s.px, y: s.py, z: s.pz });
    if (out.doubleJumped) this.events.push({ t: 'move', tick, id: p.id, kind: 'djump', x: s.px, y: s.py, z: s.pz });
    if (out.dashed) {
      this.events.push({
        t: 'move',
        tick,
        id: p.id,
        kind: out.slid ? 'slide' : 'dash',
        x: s.px,
        y: s.py,
        z: s.pz,
        // Deterministic "rare extra-long" fart so every client hears the same one.
        long: (tick * 7 + p.id * 13) % 23 === 0,
      });
    }
    if (out.techEscape) this.events.push({ t: 'move', tick, id: p.id, kind: 'tech', x: s.px, y: s.py, z: s.pz });
    if (out.landed > 6) this.events.push({ t: 'move', tick, id: p.id, kind: 'land', x: s.px, y: s.py, z: s.pz, v: out.landed });
    if (out.bounced) this.events.push({ t: 'move', tick, id: p.id, kind: 'bounce', x: s.px, y: s.py, z: s.pz });
    if (out.wallBounce) this.events.push({ t: 'move', tick, id: p.id, kind: 'wall', x: s.px, y: s.py, z: s.pz });
    if (out.padBounce >= 0) this.events.push({ t: 'move', tick, id: p.id, kind: 'pad', x: s.px, y: s.py, z: s.pz });
    if (out.ledgeGrab) this.events.push({ t: 'move', tick, id: p.id, kind: 'ledge', x: s.px, y: s.py, z: s.pz });
    if (out.climbed) this.events.push({ t: 'move', tick, id: p.id, kind: 'climb', x: s.px, y: s.py, z: s.pz });
    if (out.braced) this.events.push({ t: 'brace', tick, id: p.id });
    if (out.reloadStart) this.events.push({ t: 'reload', tick, id: p.id });
    if (out.taunt) this.events.push({ t: 'taunt', tick, id: p.id, n: (tick + p.id) % 4 });
    if (out.escapeAttempt) this.tryEscape(p);
    if (out.throwIntent && s.holding >= 0 && s.holdTimer >= BALANCE.grab.minHold) this.throwHeld(p);
    if (out.grabIntent) this.tryGrab(p);
    if (out.grapple) this.tryGrapple(p);
    if (out.landed > 0 && this.features.ledge) this.tryStomp(p);
    if (s.onGround && p.comboCount > 0 && this.time - p.comboTime > 0.1) p.comboCount = 0;
    if (s.launchTimer <= 0 && p.launchBy >= 0 && s.onGround) {
      this.finishLaunch(p);
    }
  }

  // --- Projectiles -------------------------------------------------------------------------

  newProjectileId(): number {
    const id = this.nextProjectileId;
    this.nextProjectileId = (this.nextProjectileId % 65535) + 1;
    return id;
  }

  private spawnShot(p: SimPlayer, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, power: number, charge: number, clientSeq: number, mega = false, boost = 1, viewTick = 0): void {
    const M = BALANCE.streaks;
    const w = p.weapon;
    const id = this.newProjectileId();
    // Lobbed weapons (the Balloon Mortar) launch a little above the aim.
    const d = shotDir(w, dx, dy, dz, this.tmpDir);
    const proj: Projectile = {
      id,
      owner: p.id,
      weapon: PROJ_AIR,
      fuse: 0,
      throwX: 0,
      throwZ: 0,
      x: ox,
      y: oy,
      z: oz,
      vx: d.x * w.projSpeed,
      vy: d.y * w.projSpeed,
      vz: d.z * w.projSpeed,
      radius: w.projRadius * (0.75 + 0.25 * power) * (mega ? M.megaRadius : 1),
      power,
      charge,
      gravity: w.projGravity,
      expires: this.time + w.projLifetime,
      blastRadius: w.blastRadius * (0.8 + 0.2 * power) * (mega ? M.megaBlast : 1),
      inflation: w.inflation,
      knockback: w.knockback * (mega ? M.megaKnockback : 1) * boost,
      light: w.light > 0,
      wi: weaponIndex(w.id),
      lag: viewTick > 0 ? Math.max(0, Math.min(PROJ_REWIND_MAX, this.tick - Math.round(viewTick))) : 0,
    };
    // The Chase: your shots curve toward whoever you're hunting.
    const homing = this.ults.homing(p);
    if (homing) {
      proj.homing = homing.home;
      proj.turn = homing.turn;
    }
    this.projectiles.push(proj);
    // Pop Gun corks count as a quarter shot each (like their hits) so accuracy stays comparable.
    if (proj.light) {
      p.lightShots += 0.25;
      if (p.lightShots >= 1) {
        p.lightShots -= 1;
        p.stats.shots++;
      }
    } else p.stats.shots++;
    this.events.push({
      t: 'shot',
      tick: this.tick,
      id: proj.id,
      owner: p.id,
      w: 0,
      x: ox,
      y: oy,
      z: oz,
      vx: proj.vx,
      vy: proj.vy,
      vz: proj.vz,
      r: proj.radius,
      power,
      cs: clientSeq,
      g: proj.gravity > 0 ? proj.gravity : undefined,
      wi: proj.wi,
      ...(homing ?? {}),
    });
  }

  private readonly tmpDir = { x: 0, y: 0, z: 0 };

  private stepProjectiles(): void {
    const dt = this.dt;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      if (pr.weapon !== PROJ_AIR && !isUltProjectile(pr.weapon)) {
        if (this.stepThrown(pr)) this.projectiles.splice(i, 1);
        continue;
      }
      this.ults.steer(pr, dt);
      const speed = Math.hypot(pr.vx, pr.vy, pr.vz);
      const steps = Math.max(1, Math.ceil((speed * dt) / (pr.radius * 0.8)));
      const sdt = dt / steps;
      let done = false;
      for (let k = 0; k < steps && !done; k++) {
        pr.vy -= pr.gravity * sdt;
        pr.x += pr.vx * sdt;
        pr.y += pr.vy * sdt;
        pr.z += pr.vz * sdt;
        // Direct hits on players, where the shooter saw them (lag compensation, like the Pump
        // Rifle's rewind): the shot flies in the shooter's view of the match, and a hit lands on
        // the target's body where it is now.
        for (const p of this.players.values()) {
          if (p.id === pr.owner || p.state.mode === MODE_DEAD || !this.isEnemy(pr.owner, p.id)) continue;
          let body = p.state;
          if (pr.lag) {
            const past = this.stateAt(p, this.tick - pr.lag);
            if (past !== p.state) {
              if (past.mode === MODE_DEAD) continue;
              body = this.projScratch;
              body.px = past.px;
              body.py = past.py;
              body.pz = past.pz;
              body.inflation = past.inflation;
            }
          }
          const hit = capsuleSphere(body, pr.x, pr.y, pr.z, pr.radius, this.hitR(p), this.hitH(p));
          if (hit) {
            if (body !== p.state) {
              hit.x += p.state.px - body.px;
              hit.y += p.state.py - body.py;
              hit.z += p.state.pz - body.pz;
            }
            if (pr.light) this.tapHit(pr, p, hit);
            else this.directHit(pr, p, hit);
            done = true;
            break;
          }
        }
        if (done) break;
        const ball = this.ballGame;
        if (ball && ball.inPlay) {
          const b = ball.ball;
          const d = Math.hypot(pr.x - b.x, pr.y - b.y, pr.z - b.z);
          if (d < pr.radius + b.r) {
            const sp = Math.hypot(pr.vx, pr.vy, pr.vz) || 1;
            const k = BALANCE.modes.ball.shotImpulse * pr.power * pr.knockback;
            ball.impulse((pr.vx / sp) * k, (pr.vy / sp) * k + (pr.light ? 0.3 : 2), (pr.vz / sp) * k, pr.owner);
            if (pr.light) this.popCork(pr);
            else this.explode(pr, pr.x, pr.y, pr.z, -1);
            done = true;
            break;
          }
        }
        // World: use a smaller core radius so big air blobs can skim floors.
        if (this.world.sphereHit(pr.x, pr.y, pr.z, pr.radius * 0.45) >= 0) {
          if (pr.light) this.popCork(pr);
          else this.explode(pr, pr.x, pr.y, pr.z, -1);
          done = true;
        }
      }
      if (!done && this.time >= pr.expires) {
        this.events.push({ t: 'fizzle', tick: this.tick, id: pr.id, x: pr.x, y: pr.y, z: pr.z });
        done = true;
      }
      if (done) this.projectiles.splice(i, 1);
    }
  }

  private directHit(pr: Projectile, target: SimPlayer, hit: CapsuleHit): void {
    const K = BALANCE.knockback;
    const s = target.state;
    const h = playerHeight(s);
    const cy = s.py + h * 0.5;
    // Direction from the impact point through the body's center, bent by the shot's travel.
    let dx = s.px - hit.x;
    let dy = cy - hit.y;
    let dz = s.pz - hit.z;
    const l = Math.hypot(dx, dy, dz) || 1;
    const sp = Math.hypot(pr.vx, pr.vy, pr.vz) || 1;
    const b = K.travelBias;
    dx = (dx / l) * (1 - b) + (pr.vx / sp) * b;
    dy = (dy / l) * (1 - b) + (pr.vy / sp) * b;
    dz = (dz / l) * (1 - b) + (pr.vz / sp) * b;
    const low = hit.y < s.py + h * K.lowHitFraction;
    const power = pr.power * pr.knockback;
    this.applyHit(target, pr.owner, dx, dy, dz, power, pr.inflation * shotInflation(pr.power), { direct: true, low, x: hit.x, y: hit.y, z: hit.z, ult: pr.ult });
    this.explode(pr, hit.x, hit.y, hit.z, target.id);
  }

  /**
   * Pop Gun cork: a small push along its flight and a little air. No launch, no hit-stop and no
   * combo, so a spray builds pressure instead of juggling. Stronger on inflated targets, like
   * knockback.
   */
  private tapHit(pr: Projectile, target: SimPlayer, hit: CapsuleHit): void {
    const K = BALANCE.knockback;
    const Br = BALANCE.brace;
    const s = target.state;
    if (s.spawnProt > 0) {
      this.events.push({ t: 'shield', tick: this.tick, target: target.id, x: hit.x, y: hit.y, z: hit.z });
      this.popCork(pr);
      return;
    }
    const braced = s.braceTimer > 0;
    const inflBefore = s.inflation;
    s.inflation = Math.min(BALANCE.inflation.max, s.inflation + pr.inflation * pr.power * (braced ? Br.inflationMult : 1));
    s.sinceHit = 0;
    // Corks fill the ult meter (and count for assists) like any other hit.
    this.ults.onHit(target, pr.owner, s.inflation - inflBefore, false);
    if (s.mode !== MODE_HELD) {
      const sp = Math.hypot(pr.vx, pr.vy, pr.vz) || 1;
      let dx = pr.vx / sp;
      let dy = Math.max(0, pr.vy / sp) + 0.25;
      let dz = pr.vz / sp;
      const l = Math.hypot(dx, dy, dz) || 1;
      dx /= l;
      dy /= l;
      dz /= l;
      const speed = ((pr.power * pr.knockback * (K.base + K.growth * Math.pow(s.inflation, K.growthExp))) / inflationMass(s.inflation)) * (braced ? Br.knockbackMult : 1);
      // A second cork in quick succession shakes a hanging player off the ledge.
      if ((s.mode === MODE_HANG || s.mode === MODE_CLIMB) && s.blownTimer > 0) releaseLedge(s, 0);
      if (s.hitStop > 0) {
        s.hsVx += dx * speed;
        s.hsVy += dy * speed;
        s.hsVz += dz * speed;
      } else {
        s.vx += dx * speed;
        s.vy = Math.max(s.vy, 0) + dy * speed;
        s.vz += dz * speed;
      }
      s.blownTimer = Math.max(s.blownTimer, 0.15);
      if (s.onGround && s.vy > 0) {
        s.onGround = 0;
        s.groundId = -1;
      }
    }
    depenetrate(s, this.world);
    target.lastAttacker = pr.owner;
    target.lastAttackTime = this.time;
    if (target.launchBy !== pr.owner) {
      target.launchBy = pr.owner;
      target.launchFromX = s.px;
      target.launchFromZ = s.pz;
      target.launchStartTick = this.tick;
    }
    const a = this.players.get(pr.owner);
    if (a) {
      a.lightHits += 0.25;
      if (a.lightHits >= 1) {
        a.lightHits -= 1;
        a.stats.hits++;
      }
    }
    this.events.push({ t: 'tap', tick: this.tick, id: pr.id, attacker: pr.owner, target: target.id, x: hit.x, y: hit.y, z: hit.z, infl: s.inflation });
  }

  /** A cork that hit the world (or a shield): it just pops. */
  private popCork(pr: Projectile): void {
    this.events.push({ t: 'fizzle', tick: this.tick, id: pr.id, x: pr.x, y: pr.y, z: pr.z });
  }

  private explode(pr: Projectile, x: number, y: number, z: number, skipId: number): void {
    const K = BALANCE.knockback;
    const R = pr.blastRadius;
    this.events.push({ t: 'boom', tick: this.tick, id: pr.id, x, y, z, r: R, power: pr.power, owner: pr.owner, ...(pr.weapon ? { k: pr.weapon } : {}) });
    this.pushBall(x, y, z, R, BALANCE.modes.ball.splashImpulse * pr.power * pr.knockback, pr.owner);
    for (const p of this.players.values()) {
      if (p.id === skipId || p.state.mode === MODE_DEAD) continue;
      const s = p.state;
      const r = playerRadius(s);
      const h = playerHeight(s);
      // Distance from blast center to the body's axis segment.
      const ay = Math.max(s.py + r, Math.min(s.py + h - r, y));
      const d = Math.max(0, Math.hypot(x - s.px, y - ay, z - s.pz) - r);
      if (d > R) continue;
      const f = 1 - d / R;
      const falloff = K.splashEdge + (1 - K.splashEdge) * f;
      let dx = s.px - x;
      let dy = s.py + h * 0.5 - y;
      let dz = s.pz - z;
      const l = Math.hypot(dx, dy, dz) || 1;
      dx /= l;
      dy /= l;
      dz /= l;
      if (p.id === pr.owner) {
        // Your own ult blasts never launch you (a Big Blow in your face would be a free self-knockout).
        if (!pr.ult) this.blastJump(p, dx, dy, dz, falloff, pr.charge);
      } else {
        const power = pr.power * pr.knockback * K.splashMult * falloff;
        this.applyHit(p, pr.owner, dx, dy, dz, power, pr.inflation * shotInflation(pr.power) * K.splashMult * falloff, {
          direct: false,
          low: false,
          x,
          y,
          z,
          ult: pr.ult,
        });
      }
    }
  }

  /** Your own blast launches you but never inflates you. */
  private blastJump(p: SimPlayer, dx: number, dy: number, dz: number, falloff: number, charge: number): void {
    const s = p.state;
    if (s.mode !== MODE_NORMAL) return;
    const BJ = BALANCE.blastJump;
    const speed = BJ.speed * (BJ.minPower + (1 - BJ.minPower) * charge) * falloff * p.weapon.blastJump;
    if (s.vy < 0) s.vy = 0;
    s.vx += dx * speed;
    s.vy += Math.max(dy, 0.35) * speed;
    s.vz += dz * speed;
    s.onGround = 0;
    s.slideTimer = 0;
    this.events.push({ t: 'blastjump', tick: this.tick, id: p.id });
  }

  applyHit(
    target: SimPlayer,
    attackerId: number,
    dx: number,
    dy: number,
    dz: number,
    power: number,
    inflationAdd: number,
    info: { direct: boolean; low: boolean; x: number; y: number; z: number; ult?: boolean },
  ): void {
    const K = BALANCE.knockback;
    const s = target.state;
    if (s.mode === MODE_DEAD) return;
    if (attackerId >= 0 && attackerId !== target.id && !this.isEnemy(attackerId, target.id)) return;
    if (s.spawnProt > 0) {
      this.events.push({ t: 'shield', tick: this.tick, target: target.id, x: info.x, y: info.y, z: info.z });
      return;
    }
    // Getting hit breaks any grab you're part of.
    this.releaseInvolving(target);
    // Hit again mid-freeze: the first hit's knockback lands now and this one stacks on top.
    if (s.hitStop > 0) {
      s.vx += s.hsVx;
      s.vy += s.hsVy;
      s.vz += s.hsVz;
      s.hsVx = s.hsVy = s.hsVz = 0;
      s.hitStop = 0;
    }
    const wasAirborne = !s.onGround;
    if (attackerId >= 0 && attackerId !== target.id && target.comboBy === attackerId && wasAirborne && this.time - target.comboTime <= BALANCE.combo.window) {
      target.comboCount++;
    } else {
      target.comboCount = 1;
    }
    target.comboBy = attackerId;
    target.comboTime = this.time;
    const braced = s.braceTimer > 0;
    const Br = BALANCE.brace;
    const attacker = this.players.get(attackerId);
    // A pin pops anyone already at maximum inflation, instantly.
    if (attacker && attacker !== target && attacker.state.pinTimer > 0 && s.inflation >= BALANCE.inflation.max - 1e-6) {
      attacker.state.pinTimer = 0;
      target.lastAttacker = attacker.id;
      target.lastAttackTime = this.time;
      this.events.push({ t: 'pop', tick: this.tick, id: attacker.id, target: target.id, x: s.px, y: s.py + playerHeight(s) * 0.5, z: s.pz });
      this.knockout(target, 'pin');
      return;
    }
    const inflBefore = s.inflation;
    s.inflation = Math.min(BALANCE.inflation.max, s.inflation + inflationAdd * (braced ? Br.inflationMult : 1));
    const mass = inflationMass(s.inflation) * ultMassMult(s);
    // Floating in helium, you have nothing to brace your feet against.
    const floaty = s.heliumTimer > 0 ? BALANCE.utilities.heliumBomb.knockbackMult : 1;
    const maxed = s.inflation >= BALANCE.inflation.max - 1e-6 ? K.maxedMult : 1;
    const speed = ((power * (K.base + K.growth * Math.pow(s.inflation, K.growthExp))) / mass) * (braced ? Br.knockbackMult : 1) * floaty * maxed;

    // Normalize and guarantee some lift so targets leave the ground.
    let l = Math.hypot(dx, dy, dz) || 1;
    dx /= l;
    dy /= l;
    dz /= l;
    if (dy < K.minUp) {
      const hl = Math.hypot(dx, dz);
      const hs = Math.sqrt(1 - K.minUp * K.minUp);
      if (hl > 1e-4) {
        dx = (dx / hl) * hs;
        dz = (dz / hl) * hs;
      } else {
        dx = 0;
        dz = 0;
      }
      dy = K.minUp;
      l = 1;
    }

    if (s.mode === MODE_HANG || s.mode === MODE_CLIMB) releaseLedge(s, 0);
    // A weaker hit on someone already flying adds to the launch instead of replacing it (so a
    // little poke can't rescue a player on their way off the map).
    const flying = s.hitStop > 0 ? Math.hypot(s.hsVx, s.hsVy, s.hsVz) : Math.hypot(s.vx, s.vy, s.vz);
    const weaker = s.launchTimer > 0 && flying > speed;
    const keep = weaker ? Math.max(K.keepVelocity, 1 - speed / flying) : K.keepVelocity;
    if (s.hitStop > 0) {
      s.vx = s.hsVx;
      s.vy = s.hsVy;
      s.vz = s.hsVz;
    }
    s.vx = s.vx * keep + dx * speed;
    s.vy = Math.max(0, s.vy) * keep + dy * speed;
    s.vz = s.vz * keep + dz * speed;
    s.onGround = 0;
    s.groundId = -1;
    s.slideTimer = 0;
    s.dashTimer = 0;
    s.launchTimer = Math.max(weaker ? s.launchTimer : 0, Math.min(K.hitstunMax, Math.max(K.hitstunMin, speed * K.hitstunPerSpeed)));
    s.launchElapsed = 0;
    s.sinceHit = 0;
    if (K.hitStopBase > 0) {
      s.hsVx = s.vx;
      s.hsVy = s.vy;
      s.hsVz = s.vz;
      s.vx = s.vy = s.vz = 0;
      s.hitStop = Math.min(K.hitStopMax, K.hitStopBase + speed * K.hitStopPerSpeed);
    }
    if (info.low) {
      s.doubledTimer = K.doubleOverTime;
      s.charging = 0;
      s.charge = 0;
    }
    if (braced) {
      s.braceCool *= 1 - Br.successRefund;
    }
    // Growing can push the hitbox into walls; nudge back out.
    depenetrate(s, this.world);

    if (attackerId >= 0 && attackerId !== target.id) {
      target.lastAttacker = attackerId;
      target.lastAttackTime = this.time;
      const a = this.players.get(attackerId);
      if (a) {
        a.stats.hits++;
        a.stats.bestCombo = Math.max(a.stats.bestCombo, target.comboCount);
      }
    }
    target.launchFromX = s.px;
    target.launchFromZ = s.pz;
    target.launchStartTick = this.tick;
    target.launchBy = attackerId;
    this.ults.onHit(target, attackerId, s.inflation - inflBefore, !!info.ult);

    this.events.push({
      t: 'hit',
      tick: this.tick,
      target: target.id,
      attacker: attackerId,
      x: info.x,
      y: info.y,
      z: info.z,
      dx,
      dy,
      dz,
      speed,
      direct: info.direct,
      low: info.low,
      braced,
      infl: s.inflation,
      gain: s.inflation - inflBefore,
      combo: target.comboCount,
    });
  }

  private finishLaunch(p: SimPlayer, dead = false): void {
    const s = p.state;
    const dist = Math.hypot(s.px - p.launchFromX, s.pz - p.launchFromZ);
    const attacker = this.players.get(p.launchBy);
    if (attacker && attacker.id !== p.id && dist > attacker.stats.longestLaunch) {
      attacker.stats.longestLaunch = dist;
    }
    if (attacker && attacker.id !== p.id && this.phase === 'playing' && dist > (this.bestReplay?.distance ?? 4)) this.captureReplay(p, attacker, dist, dead);
    if (!dead) p.launchBy = -1;
  }

  private recordReplayFrame(): void {
    if (this.tick % 2 !== 0) return;
    const f: number[] = [this.tick];
    for (const p of this.players.values()) {
      const s = p.state;
      if (s.mode === MODE_DEAD) continue;
      const r2 = (v: number) => Math.round(v * 100) / 100;
      let flags = 0;
      if (s.onGround) flags |= 1;
      if (s.launchTimer > 0) flags |= 2;
      if (s.charging) flags |= 8;
      if (s.doubledTimer > 0) flags |= 16;
      f.push(p.id, r2(s.px), r2(s.py), r2(s.pz), r2(s.yaw), Math.round(s.inflation * 100), flags);
    }
    this.replayBuf.push(f);
    if (this.replayBuf.length > 300) this.replayBuf.shift();
    if (this.replayPostRoll > 0 && this.bestReplay) {
      this.replayPostRoll--;
      this.bestReplay.frames.push(this.filterFrame(f));
    }
  }

  private filterFrame(f: number[]): number[] {
    const out = [f[0]];
    for (let i = 1; i < f.length; i += 7) if (this.replayIds.has(f[i])) out.push(...f.slice(i, i + 7));
    return out;
  }

  /** Keeps a copy of the last few seconds around a new longest launch. */
  private captureReplay(victim: SimPlayer, by: SimPlayer, distance: number, ko: boolean): void {
    const from = victim.launchStartTick - 30;
    const frames = this.replayBuf.filter((f) => f[0] >= from).slice(-180);
    if (frames.length < 5) return;
    // Only the players near the action.
    const ids = new Set<number>([victim.id, by.id]);
    const first = frames[0];
    const vi = first.indexOf(victim.id, 1);
    const vx = vi > 0 ? first[vi + 1] : victim.state.px;
    const vz = vi > 0 ? first[vi + 3] : victim.state.pz;
    for (let i = 1; i < first.length; i += 7) {
      if (Math.hypot(first[i + 1] - vx, first[i + 3] - vz) < 25) ids.add(first[i]);
    }
    this.replayIds = ids;
    this.bestReplay = { victim: victim.id, by: by.id, distance, ko, frames: frames.map((f) => this.filterFrame(f)) };
    this.replayPostRoll = ko ? 12 : 20;
  }

  // --- Weapons ---------------------------------------------------------------------------

  /** Air Horn: instant cone blast in front of you. */
  private fireCone(p: SimPlayer, _ox: number, _oy: number, _oz: number, dx: number, dy: number, dz: number, power: number, viewTick = 0): void {
    const w = p.weapon;
    const s = p.state;
    const ex = s.px;
    const ey = s.py + eyeHeight(s);
    const ez = s.pz;
    // Judged against where targets were on the shooter's screen, like the Pump Rifle.
    const rewind = this.rewindTick(viewTick);
    p.stats.shots++;
    this.events.push({ t: 'honk', tick: this.tick, id: p.id, x: ex, y: ey, z: ez, dx, dy, dz, power, range: w.range, cone: w.cone });
    const ball = this.ballGame;
    if (ball && ball.inPlay) {
      const b = ball.ball;
      const bx = b.x - ex;
      const by = b.y - ey;
      const bz = b.z - ez;
      const bd = Math.hypot(bx, by, bz) || 1;
      const ang = Math.acos(Math.max(-1, Math.min(1, (bx * dx + by * dy + bz * dz) / bd))) - Math.atan2(b.r, bd);
      if (bd - b.r < w.range && ang < w.cone) {
        const k = BALANCE.modes.ball.shotImpulse * power * w.knockback * (1 - 0.5 * Math.min(1, bd / w.range));
        ball.impulse((dx * 0.6 + (bx / bd) * 0.4) * k, (dy * 0.6 + (by / bd) * 0.4) * k + 2, (dz * 0.6 + (bz / bd) * 0.4) * k, p.id);
      }
    }
    for (const o of this.players.values()) {
      if (o === p || o.state.mode === MODE_DEAD || !this.isEnemy(p.id, o.id)) continue;
      const t = o.state;
      const at = rewind < this.tick ? this.stateAt(o, rewind) : t;
      if (at.mode === MODE_DEAD) continue;
      const r = playerRadius(t) * this.hitR(o);
      const h = playerHeight(t) * this.hitH(o);
      const ay = Math.max(at.py + r, Math.min(at.py + h - r, ey));
      let vx = at.px - ex;
      let vy = ay - ey;
      let vz = at.pz - ez;
      const d = Math.hypot(vx, vy, vz) || 0.001;
      if (d - r > w.range) continue;
      vx /= d;
      vy /= d;
      vz /= d;
      const ang = Math.acos(Math.max(-1, Math.min(1, vx * dx + vy * dy + vz * dz))) - Math.atan2(r, d);
      if (ang > w.cone) continue;
      if (this.world.raycast(ex, ey, ez, vx, vy, vz, Math.max(0, d - r))) continue;
      const falloff = 1 - 0.5 * Math.max(0, Math.min(1, (d - 2) / Math.max(0.1, w.range - 2)));
      this.applyHit(o, p.id, dx * 0.5 + vx * 0.5, dy * 0.5 + vy * 0.5, dz * 0.5 + vz * 0.5, power * w.knockback * falloff, w.inflation * shotInflation(power) * falloff, {
        direct: true,
        low: false,
        x: t.px - vx * r,
        y: ay,
        z: t.pz - vz * r,
      });
    }
  }

  /** Pump Rifle: lag-compensated hitscan, judged against what the shooter saw. */
  private fireHitscan(p: SimPlayer, dx: number, dy: number, dz: number, power: number, viewTick: number): void {
    const w = p.weapon;
    const s = p.state;
    const K = BALANCE.knockback;
    const ex = s.px;
    const ey = s.py + eyeHeight(s);
    const ez = s.pz;
    const rewind = viewTick > 0 ? Math.max(this.tick - 40, Math.min(this.tick, Math.round(viewTick))) : this.tick;
    let best: SimPlayer | null = null;
    let bestT = w.range;
    const scratch = this.scratchState;
    let bestPast: { px: number; py: number; pz: number; inflation: number } | null = null;
    for (const o of this.players.values()) {
      if (o === p || o.state.mode === MODE_DEAD || !this.isEnemy(p.id, o.id)) continue;
      const past = this.stateAt(o, rewind);
      if (past.mode === MODE_DEAD) continue;
      copyPlayerState(scratch, o.state);
      scratch.px = past.px;
      scratch.py = past.py;
      scratch.pz = past.pz;
      scratch.inflation = past.inflation;
      const t = rayCapsule(ex, ey, ez, dx, dy, dz, scratch, playerRadius(scratch) * this.hitR(o) + w.rayRadius, this.hitH(o));
      if (t !== null && t < bestT) {
        bestT = t;
        best = o;
        bestPast = past;
      }
    }
    const wh = this.world.raycast(ex, ey, ez, dx, dy, dz, w.range);
    let endT = wh ? wh.dist : w.range;
    p.stats.shots++;
    const ballT = this.ballGame?.ray(ex, ey, ez, dx, dy, dz, endT) ?? null;
    if (ballT !== null && ballT < endT && ballT < bestT) {
      const k = BALANCE.modes.ball.shotImpulse * power * w.knockback;
      this.ballGame!.impulse(dx * k, dy * k + 2, dz * k, p.id);
      best = null;
      endT = ballT;
    }
    if (best && bestPast && bestT < endT) {
      endT = bestT;
      const t = best.state;
      // Impact on the rewound body, moved to where the target is now.
      const ix = ex + dx * bestT + (t.px - bestPast.px);
      const iy = ey + dy * bestT + (t.py - bestPast.py);
      const iz = ez + dz * bestT + (t.pz - bestPast.pz);
      const h = playerHeight(t);
      let hx = t.px - ix;
      let hy = t.py + h * 0.5 - iy;
      let hz = t.pz - iz;
      const l = Math.hypot(hx, hy, hz) || 1;
      const b = K.travelBias;
      hx = (hx / l) * (1 - b) + dx * b;
      hy = (hy / l) * (1 - b) + dy * b;
      hz = (hz / l) * (1 - b) + dz * b;
      const low = iy < t.py + h * K.lowHitFraction;
      this.applyHit(best, p.id, hx, hy, hz, power * w.knockback, w.inflation * shotInflation(power), { direct: true, low, x: ix, y: iy, z: iz });
    }
    this.events.push({ t: 'tracer', tick: this.tick, id: p.id, x: ex, y: ey, z: ez, x2: ex + dx * endT, y2: ey + dy * endT, z2: ez + dz * endT, hit: !!best && bestT <= endT, power });
  }

  private readonly scratchState = createPlayerState();
  /** Where a player was, for a lag-compensated projectile hit check (only position and size are read). */
  private readonly projScratch = createPlayerState();
  private readonly pelletBuf: number[] = [];
  private readonly pelletScratch: PlayerState[] = [];

  /**
   * Bubble Shotgun: a fixed ring of pellets, judged (lag compensated) against what the shooter
   * saw. Each target takes one combined hit sized by how many pellets landed and how far they flew.
   */
  private fireSpread(p: SimPlayer, dx: number, dy: number, dz: number, power: number, charge: number, viewTick: number): void {
    const w = p.weapon;
    const s = p.state;
    const K = BALANCE.knockback;
    const ex = s.px;
    const ey = s.py + eyeHeight(s);
    const ez = s.pz;
    const spread = spreadAt(w, charge);
    const dirs = pelletDirs(dx, dy, dz, spread, w.pellets, this.pelletBuf);
    const rewind = viewTick > 0 ? Math.max(this.tick - 40, Math.min(this.tick, Math.round(viewTick))) : this.tick;
    const targets: { o: SimPlayer; past: { px: number; py: number; pz: number }; st: PlayerState; n: number; dist: number; ix: number; iy: number; iz: number; low: number }[] = [];
    for (const o of this.players.values()) {
      if (o === p || o.state.mode === MODE_DEAD || !this.isEnemy(p.id, o.id)) continue;
      const past = this.stateAt(o, rewind);
      if (past.mode === MODE_DEAD) continue;
      const st = this.pelletScratch[targets.length] ?? (this.pelletScratch[targets.length] = createPlayerState());
      st.px = past.px;
      st.py = past.py;
      st.pz = past.pz;
      st.inflation = past.inflation;
      targets.push({ o, past, st, n: 0, dist: 0, ix: 0, iy: 0, iz: 0, low: 0 });
    }
    const ball = this.ballGame?.inPlay ? this.ballGame : null;
    let ballPellets = 0;
    const ends: number[] = [];
    for (let k = 0; k < dirs.length; k += 3) {
      const px = dirs[k];
      const py = dirs[k + 1];
      const pz = dirs[k + 2];
      const wh = this.world.raycast(ex, ey, ez, px, py, pz, w.range);
      let bestT = wh ? wh.dist : w.range;
      let best: (typeof targets)[number] | null = null;
      for (const t of targets) {
        const tt = rayCapsule(ex, ey, ez, px, py, pz, t.st, playerRadius(t.st) * this.hitR(t.o) + w.rayRadius, this.hitH(t.o));
        if (tt !== null && tt < bestT) {
          bestT = tt;
          best = t;
        }
      }
      const bt = ball ? ball.ray(ex, ey, ez, px, py, pz, bestT) : null;
      if (bt !== null && bt < bestT) {
        best = null;
        bestT = bt;
        ballPellets++;
      }
      if (best) {
        const iy = ey + py * bestT;
        best.n++;
        best.dist += bestT;
        best.ix += ex + px * bestT;
        best.iy += iy;
        best.iz += ez + pz * bestT;
        if (iy < best.st.py + playerHeight(best.st) * K.lowHitFraction) best.low++;
      }
      ends.push(Math.round(bestT * 10) / 10);
    }
    p.stats.shots++;
    if (ball && ballPellets > 0) {
      const k = (BALANCE.modes.ball.shotImpulse * power * w.knockback * ballPellets) / w.pellets;
      ball.impulse(dx * k, dy * k + 2, dz * k, p.id);
    }
    let hits = 0;
    for (const t of targets) {
      if (!t.n) continue;
      hits += t.n;
      const frac = t.n / w.pellets;
      const fall = pelletFalloff(w, t.dist / t.n);
      const cur = t.o.state;
      // Average impact on the rewound body, moved to where the target is now.
      const ix = t.ix / t.n + (cur.px - t.past.px);
      const iy = t.iy / t.n + (cur.py - t.past.py);
      const iz = t.iz / t.n + (cur.pz - t.past.pz);
      const h = playerHeight(cur);
      let hx = cur.px - ix;
      let hy = cur.py + h * 0.5 - iy;
      let hz = cur.pz - iz;
      const l = Math.hypot(hx, hy, hz) || 1;
      const b = K.travelBias;
      hx = (hx / l) * (1 - b) + dx * b;
      hy = (hy / l) * (1 - b) + dy * b;
      hz = (hz / l) * (1 - b) + dz * b;
      this.applyHit(t.o, p.id, hx, hy, hz, power * w.knockback * frac * fall, w.inflation * shotInflation(power) * frac * fall, { direct: true, low: t.low * 2 > t.n, x: ix, y: iy, z: iz });
    }
    this.events.push({ t: 'pellets', tick: this.tick, id: p.id, x: ex, y: ey, z: ez, dx, dy, dz, spread, power, ends, hits });
  }

  /** Leaf Blower: push everyone in the stream this step. */
  private blow(p: SimPlayer, strength: number, viewTick = 0): void {
    const w = p.weapon;
    const s = p.state;
    const K = BALANCE.knockback;
    const rewind = this.rewindTick(viewTick);
    const d0 = lookDir(s.yaw, s.pitch, { x: 0, y: 0, z: 0 });
    const ex = s.px;
    const ey = s.py + eyeHeight(s);
    const ez = s.pz;
    const ball = this.ballGame;
    if (ball && ball.inPlay) {
      const b = ball.ball;
      const bx = b.x - ex;
      const by = b.y - ey;
      const bz = b.z - ez;
      const bd = Math.hypot(bx, by, bz) || 1;
      const ang = Math.acos(Math.max(-1, Math.min(1, (bx * d0.x + by * d0.y + bz * d0.z) / bd))) - Math.atan2(b.r, bd);
      if (bd - b.r < w.range && ang < w.cone) {
        const a = BALANCE.modes.ball.streamAccel * strength * (1 - 0.6 * Math.min(1, bd / w.range)) * this.dt;
        ball.impulse(d0.x * a, d0.y * a + a * 0.2, d0.z * a, p.id);
      }
    }
    for (const o of this.players.values()) {
      if (o === p || !this.isEnemy(p.id, o.id)) continue;
      const t = o.state;
      if (t.mode === MODE_DEAD || t.mode === MODE_HELD || t.spawnProt > 0) continue;
      // Aimed where the shooter saw them (the stream still pushes them where they are now).
      const at = rewind < this.tick ? this.stateAt(o, rewind) : t;
      const r = playerRadius(t) * this.hitR(o);
      const h = playerHeight(t) * this.hitH(o);
      const ay = Math.max(at.py + r, Math.min(at.py + h - r, ey));
      let vx = at.px - ex;
      let vy = ay - ey;
      let vz = at.pz - ez;
      const d = Math.hypot(vx, vy, vz) || 0.001;
      if (d - r > w.range) continue;
      vx /= d;
      vy /= d;
      vz /= d;
      const ang = Math.acos(Math.max(-1, Math.min(1, vx * d0.x + vy * d0.y + vz * d0.z))) - Math.atan2(r, d);
      if (ang > w.cone) continue;
      if (this.world.raycast(ex, ey, ez, vx, vy, vz, Math.max(0, d - r))) continue;
      const falloff = 1 - 0.6 * Math.min(1, d / w.range);
      const accel = (w.knockback * strength * falloff * ultPowerMult(s) * (K.base + K.growth * t.inflation)) / K.base / (inflationMass(t.inflation) * ultMassMult(t));
      let px = d0.x * 0.7 + vx * 0.3;
      let py = d0.y * 0.7 + vy * 0.3 + 0.2;
      let pz = d0.z * 0.7 + vz * 0.3;
      const pl = Math.hypot(px, py, pz) || 1;
      px /= pl;
      py /= pl;
      pz /= pl;
      if ((t.mode === MODE_HANG || t.mode === MODE_CLIMB) && strength > 0.6) releaseLedge(t, 0);
      t.vx += px * accel * this.dt;
      t.vy += py * accel * this.dt;
      t.vz += pz * accel * this.dt;
      t.blownTimer = 0.15;
      const inflBefore = t.inflation;
      t.inflation = Math.min(BALANCE.inflation.max, t.inflation + w.inflation * strength * falloff * this.dt);
      this.ults.onHit(o, p.id, t.inflation - inflBefore, false);
      t.sinceHit = 0;
      o.lastAttacker = p.id;
      o.lastAttackTime = this.time;
      if (o.launchBy !== p.id) {
        o.launchBy = p.id;
        o.launchFromX = t.px;
        o.launchFromZ = t.pz;
        o.launchStartTick = this.tick;
      }
      const lastEv = p.blowEvents.get(o.id) ?? -1;
      if (this.time - lastEv > 0.35) {
        p.blowEvents.set(o.id, this.time);
        // Each gust counts as a hit (Sudden Death's time-up tiebreak goes by hits).
        p.stats.hits++;
        this.events.push({ t: 'blow', tick: this.tick, id: p.id, target: o.id });
      }
    }
  }

  /** Who has their feet under them (see knockout credit). */
  private trackFooting(): void {
    for (const p of this.players.values()) {
      const s = p.state;
      if (s.onGround && s.launchTimer <= 0 && !((this.world.solids[s.groundId]?.bounce ?? 0) > 0)) p.footedAt = this.time;
    }
  }

  private recordHistory(): void {
    for (const p of this.players.values()) {
      const s = p.state;
      p.history.push({ tick: this.tick, px: s.px, py: s.py, pz: s.pz, inflation: s.inflation, mode: s.mode });
      if (p.history.length > 45) p.history.shift();
    }
  }

  /** The tick a shot is judged at: what the shooter saw (at most 40 ticks back), or now. */
  private rewindTick(viewTick: number): number {
    return viewTick > 0 ? Math.max(this.tick - 40, Math.min(this.tick, Math.round(viewTick))) : this.tick;
  }

  private stateAt(p: SimPlayer, tick: number): { px: number; py: number; pz: number; inflation: number; mode: number } {
    for (let i = p.history.length - 1; i >= 0; i--) {
      if (p.history[i].tick <= tick) return p.history[i];
    }
    return p.state;
  }

  // --- Utilities -------------------------------------------------------------------------

  private useUtility(p: SimPlayer, slot: 0 | 1): void {
    const s = p.state;
    const id = p.loadout.utils[slot];
    const key = slot === 0 ? 'u1Cool' : 'u2Cool';
    if (s[key] > 0 || s.mode !== MODE_NORMAL || s.holding >= 0) return;
    s[key] = utilityCooldown(id);
    s.spawnProt = 0;
    const U = BALANCE.utilities;
    // An inflatable wall thrown while falling with nothing below becomes a raft under your feet.
    if (id === 'inflatableWall' && !s.onGround && this.world.groundBelow(s.px, s.py, s.pz, 12) === null) {
      this.deployRaft(p);
      return;
    }
    if (id === 'tornado') {
      this.spawnTornado(p);
      return;
    }
    const d = lookDir(s.yaw, s.pitch, { x: 0, y: 0, z: 0 });
    const speed = (U[id] as { throwSpeed: number }).throwSpeed;
    const ox = s.px + d.x * 0.6;
    const oy = s.py + eyeHeight(s) + d.y * 0.6 - 0.2;
    const oz = s.pz + d.z * 0.6;
    const hl = Math.hypot(d.x, d.z) || 1;
    const proj: Projectile = {
      id: this.newProjectileId(),
      owner: p.id,
      weapon: UTIL_PROJ[id],
      fuse: 'fuse' in U[id] ? (U[id] as { fuse: number }).fuse : 99,
      throwX: d.x / hl,
      throwZ: d.z / hl,
      x: ox,
      y: oy,
      z: oz,
      vx: d.x * speed + s.vx * 0.3,
      vy: d.y * speed + 4,
      vz: d.z * speed + s.vz * 0.3,
      radius: 0.35,
      power: 1,
      charge: 1,
      gravity: U.gravity,
      expires: this.time + 6,
      blastRadius: 0,
      inflation: 0,
      knockback: 0,
    };
    this.projectiles.push(proj);
    this.events.push({ t: 'shot', tick: this.tick, id: proj.id, owner: p.id, w: proj.weapon, x: ox, y: oy, z: oz, vx: proj.vx, vy: proj.vy, vz: proj.vz, r: proj.radius, power: 1, g: proj.gravity });
  }

  private readonly sweepOut = { d: 0, hit: -1 };

  /** Moves a thrown utility. Returns true when it's gone (exploded, deployed, or lost). */
  private stepThrown(pr: Projectile): boolean {
    const dt = this.dt;
    const half = pr.radius;
    pr.fuse -= dt;
    pr.vy -= pr.gravity * dt;
    const grenade = pr.weapon === PROJ_AIR_GRENADE || pr.weapon === PROJ_VACUUM || pr.weapon === PROJ_HELIUM;
    // Grenades go off on contact with a player.
    if (grenade) {
      for (const p of this.players.values()) {
        if (p.id === pr.owner || p.state.mode === MODE_DEAD || !this.isEnemy(pr.owner, p.id)) continue;
        if (capsuleSphere(p.state, pr.x, pr.y, pr.z, pr.radius, this.hitR(p), this.hitH(p))) {
          this.detonate(pr);
          return true;
        }
      }
    }
    let bounced = false;
    let landed = false;
    const box = (): [number, number, number, number, number, number] => [pr.x - half, pr.y - half, pr.z - half, pr.x + half, pr.y + half, pr.z + half];
    for (const axis of [1, 0, 2] as const) {
      const v = axis === 0 ? pr.vx : axis === 1 ? pr.vy : pr.vz;
      const b = box();
      this.world.sweepAxis(axis, v * dt, b[0], b[1], b[2], b[3], b[4], b[5], this.sweepOut);
      if (axis === 0) pr.x += this.sweepOut.d;
      else if (axis === 1) pr.y += this.sweepOut.d;
      else pr.z += this.sweepOut.d;
      if (this.sweepOut.hit >= 0) {
        if (axis === 1 && v < 0) {
          landed = true;
          if (Math.abs(pr.vy) > 3) bounced = true;
          pr.vy = -pr.vy * 0.35;
          pr.vx *= 0.7;
          pr.vz *= 0.7;
        } else if (axis === 1) {
          pr.vy = 0;
        } else {
          if (axis === 0) pr.vx = -pr.vx * 0.4;
          else pr.vz = -pr.vz * 0.4;
          bounced = true;
        }
      }
    }
    if ((pr.weapon === PROJ_PAD || pr.weapon === PROJ_WALL || pr.weapon === PROJ_MINE) && landed) {
      if (pr.weapon === PROJ_PAD) this.deployPad(pr);
      else if (pr.weapon === PROJ_MINE) this.deployMine(pr);
      else this.deployWall(pr);
      return true;
    }
    if (bounced) this.events.push({ t: 'proj', tick: this.tick, id: pr.id, x: pr.x, y: pr.y, z: pr.z, vx: pr.vx, vy: pr.vy, vz: pr.vz });
    if (grenade && pr.fuse <= 0) {
      this.detonate(pr);
      return true;
    }
    if (this.time >= pr.expires || pr.y < this.map.blast.minY) {
      this.events.push({ t: 'fizzle', tick: this.tick, id: pr.id, x: pr.x, y: pr.y, z: pr.z });
      return true;
    }
    return false;
  }

  private detonate(pr: Projectile): void {
    const U = BALANCE.utilities;
    if (pr.weapon === PROJ_VACUUM) {
      const until = this.time + U.vacuumGrenade.duration;
      this.vacuums.push({ x: pr.x, y: pr.y, z: pr.z, owner: pr.owner, until });
      this.events.push({ t: 'vacuum', tick: this.tick, id: pr.id, x: pr.x, y: pr.y, z: pr.z, until: Math.round(until / this.dt) });
      return;
    }
    if (pr.weapon === PROJ_HELIUM) {
      const until = this.time + U.heliumBomb.cloudTime;
      this.heliumClouds.push({ id: pr.id, owner: pr.owner, x: pr.x, y: pr.y, z: pr.z, until, touched: new Set() });
      this.events.push({ t: 'helium', tick: this.tick, id: pr.id, owner: pr.owner, x: pr.x, y: pr.y, z: pr.z, r: U.heliumBomb.radius, until: Math.round(until / this.dt) });
      return;
    }
    const G = U.airGrenade;
    this.events.push({ t: 'boom', tick: this.tick, id: pr.id, x: pr.x, y: pr.y, z: pr.z, r: G.radius, power: 1.3, owner: pr.owner, k: pr.weapon });
    this.blastAt(pr.x, pr.y, pr.z, G.radius, G.knockback, G.inflation, pr.owner);
  }

  /** Pushes the ball away from a blast center. */
  pushBall(x: number, y: number, z: number, radius: number, impulse: number, by: number): void {
    const ball = this.ballGame;
    if (!ball || !ball.inPlay) return;
    const b = ball.ball;
    const dx = b.x - x;
    const dy = b.y - y;
    const dz = b.z - z;
    const d = Math.hypot(dx, dy, dz);
    if (d > radius + b.r || d < 1e-3) return;
    const f = 1 - Math.max(0, d - b.r) / radius;
    ball.impulse((dx / d) * impulse * f, ((dy / d) * 0.7 + 0.3) * impulse * f, (dz / d) * impulse * f, by);
  }

  /** Outward blast used by the Air Grenade: full power at the center, 30% at the edge. */
  private blastAt(x: number, y: number, z: number, radius: number, knockback: number, inflation: number, owner: number): void {
    this.pushBall(x, y, z, radius, BALANCE.modes.ball.splashImpulse * 1.3, owner);
    for (const p of this.players.values()) {
      const s = p.state;
      if (s.mode === MODE_DEAD) continue;
      const r = playerRadius(s);
      const h = playerHeight(s);
      const ay = Math.max(s.py + r, Math.min(s.py + h - r, y));
      const d = Math.max(0, Math.hypot(x - s.px, y - ay, z - s.pz) - r);
      if (d > radius) continue;
      const falloff = 0.3 + 0.7 * (1 - d / radius);
      let dx = s.px - x;
      let dy = s.py + h * 0.5 - y;
      let dz = s.pz - z;
      const l = Math.hypot(dx, dy, dz) || 1;
      dx /= l;
      dy /= l;
      dz /= l;
      if (p.id === owner) this.blastJump(p, dx, dy, dz, falloff, 1);
      else this.applyHit(p, owner, dx, dy, dz, knockback * falloff, inflation * falloff, { direct: false, low: false, x, y, z });
    }
  }

  private stepVacuums(): void {
    const V = BALANCE.utilities.vacuumGrenade;
    for (let i = this.vacuums.length - 1; i >= 0; i--) {
      const f = this.vacuums[i];
      if (this.time >= f.until) {
        this.vacuums.splice(i, 1);
        continue;
      }
      for (const p of this.players.values()) {
        const s = p.state;
        if (p.id === f.owner || s.mode !== MODE_NORMAL || s.spawnProt > 0 || (f.owner >= 0 && !this.isEnemy(f.owner, p.id))) continue;
        const cy = s.py + playerHeight(s) * 0.5;
        let dx = f.x - s.px;
        let dy = f.y - cy;
        let dz = f.z - s.pz;
        const d = Math.hypot(dx, dy, dz);
        if (d > V.radius || d < 0.6) continue;
        dx /= d;
        dy /= d;
        dz /= d;
        const accel = (V.pull * (1 - (d / V.radius) * 0.5)) / (inflationMass(s.inflation) * ultMassMult(s));
        s.vx += dx * accel * this.dt;
        s.vy += (dy * accel + (dy > 0 ? 6 : 0)) * this.dt;
        s.vz += dz * accel * this.dt;
        s.blownTimer = 0.15;
        if (f.owner >= 0) {
          p.lastAttacker = f.owner;
          p.lastAttackTime = this.time;
        }
      }
    }
  }

  private deployPad(pr: Projectile): void {
    const U = BALANCE.utilities.bouncePad;
    const id = this.nextPadId++;
    const until = this.time + U.lifetime;
    const y = pr.y - pr.radius;
    this.world.addPad({ x: pr.x, y, z: pr.z, half: U.half, strength: U.strength, owner: pr.owner, expires: until }, id);
    this.events.push({ t: 'pad', tick: this.tick, id, x: pr.x, y, z: pr.z, half: U.half, strength: U.strength, until: Math.round(until / this.dt) });
  }

  private deployWall(pr: Projectile): void {
    const W = BALANCE.utilities.inflatableWall;
    const y = pr.y - pr.radius;
    const alongX = Math.abs(pr.throwX) >= Math.abs(pr.throwZ);
    const hx = alongX ? W.thickness / 2 : W.width / 2;
    const hz = alongX ? W.width / 2 : W.thickness / 2;
    this.addSolid([pr.x - hx, y, pr.z - hz], [pr.x + hx, y + W.height, pr.z + hz], W.lifetime, false);
  }

  private deployRaft(p: SimPlayer): void {
    const W = BALANCE.utilities.inflatableWall;
    const s = p.state;
    const top = s.py - 0.05;
    const h = W.raftSize / 2;
    this.addSolid([s.px - h, top - W.thickness, s.pz - h], [s.px + h, top, s.pz + h], W.raftLifetime, true);
    if (s.vy < -12) s.vy = -12;
  }

  private addSolid(min: [number, number, number], max: [number, number, number], life: number, raft: boolean): void {
    const id = this.world.addDynamicSolid({ min, max, ledge: true });
    const until = this.time + life;
    this.dynamicSolids.set(id, { id, min, max, expires: until, raft });
    this.events.push({ t: 'solid', tick: this.tick, id, min, max, until: Math.round(until / this.dt), raft });
    // Anyone caught inside gets squeezed out.
    for (const p of this.players.values()) if (p.state.mode === MODE_NORMAL) depenetrate(p.state, this.world);
  }

  private expireDynamics(): void {
    for (const [id, d] of this.dynamicSolids) {
      if (d.expires <= this.time) {
        this.world.setSolidAt(id, null);
        this.dynamicSolids.delete(id);
        this.events.push({ t: 'solidGone', tick: this.tick, id });
        for (const p of this.players.values()) {
          if (p.state.groundId === id) p.state.onGround = 0;
          if (p.state.hangId === id && (p.state.mode === MODE_HANG || p.state.mode === MODE_CLIMB)) releaseLedge(p.state, 0);
        }
      }
    }
    for (const pad of [...this.world.pads]) {
      if (pad.expires <= this.time) {
        this.world.removePad(pad.id);
        this.events.push({ t: 'padGone', tick: this.tick, id: pad.id });
      }
    }
  }

  // --- Pickups ------------------------------------------------------------------------------

  private scheduleNextPin(): void {
    const P = BALANCE.pickups;
    this.nextPinAt = this.time + P.pinIntervalMin + Math.random() * (P.pinIntervalMax - P.pinIntervalMin);
  }

  private stepPickups(): void {
    const P = BALANCE.pickups;
    // Pickups whose floor sank away (collapsing maps) go with it instead of hovering over the void.
    const grounded = (k: { x: number; y: number; z: number }) => this.world.groundBelow(k.x, k.y + 0.5, k.z, 2) !== null;
    if (this.time >= this.nextPinAt && this.pickups.length) {
      const pinOut = this.pickups.some((k) => k.kind === 'pin' && k.active) || [...this.players.values()].some((p) => p.state.pinTimer > 0);
      const spots = this.pickups.filter(grounded);
      if (!pinOut && spots.length) {
        const k = spots[Math.floor(Math.random() * spots.length)];
        k.kind = 'pin';
        k.active = true;
        this.events.push({ t: 'pickup', tick: this.tick, id: k.id, kind: 'pin', x: k.x, y: k.y, z: k.z, active: true, by: -1 });
      }
      this.scheduleNextPin();
    }
    for (const k of this.pickups) {
      if (k.active && this.tick % 30 === k.id % 30 && !grounded(k)) {
        k.active = false;
        k.kind = 'soda';
        k.respawnAt = this.time + P.sodaRespawn;
        this.events.push({ t: 'pickup', tick: this.tick, id: k.id, kind: 'soda', x: k.x, y: k.y, z: k.z, active: false, by: -1 });
        continue;
      }
      if (!k.active) {
        if (this.time >= k.respawnAt && grounded(k)) {
          k.active = true;
          k.kind = 'soda';
          this.events.push({ t: 'pickup', tick: this.tick, id: k.id, kind: 'soda', x: k.x, y: k.y, z: k.z, active: true, by: -1 });
        }
        continue;
      }
      for (const p of this.players.values()) {
        const s = p.state;
        if (s.mode === MODE_DEAD || s.mode === MODE_HELD) continue;
        if (Math.hypot(s.px - k.x, s.pz - k.z) > P.radius + playerRadius(s) || s.py > k.y + 1.6 || s.py + playerHeight(s) < k.y) continue;
        if (k.kind === 'soda') {
          s.dashCharges = BALANCE.dash.charges;
          s.dashRecharge = 0;
        } else {
          s.pinTimer = P.pinDuration;
        }
        this.events.push({ t: 'pickup', tick: this.tick, id: k.id, kind: k.kind, x: k.x, y: k.y, z: k.z, active: false, by: p.id });
        k.active = false;
        k.kind = 'soda';
        k.respawnAt = this.time + P.sodaRespawn;
        break;
      }
    }
  }

  // --- Floor loot ----------------------------------------------------------------------------

  private scheduleLoot(first: boolean): void {
    const L = BALANCE.loot;
    this.nextLootAt = this.time + (first ? L.firstDrop : L.intervalMin) + Math.random() * (L.intervalMax - L.intervalMin) * (first ? 0.3 : 1);
  }

  /** Drops a supply crate at a random walkable spot (or near `near`). Returns it, or null if no spot was found. */
  dropLoot(near?: { x: number; y: number; z: number; r: number }, forced: LootKind | null = null, height: number = BALANCE.loot.dropHeight): LootCrate | null {
    const L = BALANCE.loot;
    const spot = pickLootSpot(this.world, this.map, Math.random, this.crates, near);
    if (!spot) return null;
    const c: LootCrate = { id: this.nextLootId++, x: spot.x, y: spot.y + height, z: spot.z, falling: true, fall: L.fallSpeed, ground: -1, landedAt: Infinity, forced };
    this.crates.push(c);
    this.events.push({ t: 'loot', tick: this.tick, id: c.id, x: c.x, y: c.y, z: c.z, groundY: spot.y, fall: c.fall });
    return c;
  }

  /** Debug: drop a crate (optionally with a chosen effect) a few meters from a player, from low up. */
  debugDropLoot(id: number, kind?: string): LootCrate | null {
    const p = this.players.get(id);
    if (!p || p.state.mode === MODE_DEAD) return null;
    const s = p.state;
    const forced = LOOT_KINDS.find((k) => k === kind) ?? null;
    return this.dropLoot({ x: s.px, y: s.py, z: s.pz, r: 6 }, forced, 9);
  }

  private stepLoot(): void {
    const L = BALANCE.loot;
    if (this.phase === 'playing' && this.lootEnabled && this.time >= this.nextLootAt) {
      this.scheduleLoot(false);
      if (this.crates.length < L.maxCrates) this.dropLoot();
    }
    for (let i = this.crates.length - 1; i >= 0; i--) {
      const c = this.crates[i];
      const r = stepCrate(c, this.world, this.dt, this.lostY);
      if (r === 'land') {
        c.landedAt = this.time;
        this.events.push({ t: 'lootLand', tick: this.tick, id: c.id, x: c.x, y: c.y, z: c.z });
      }
      if (r === 'lost' || (!c.falling && this.time >= c.landedAt + L.lifetime)) {
        this.events.push({ t: 'lootGone', tick: this.tick, id: c.id, x: c.x, y: c.y, z: c.z, why: r === 'lost' ? 'lost' : 'expired' });
        this.crates.splice(i, 1);
        continue;
      }
      for (const p of this.players.values()) {
        const st = p.state;
        if (st.mode === MODE_DEAD || st.mode === MODE_HELD) continue;
        if (Math.hypot(st.px - c.x, st.pz - c.z) > L.radius + playerRadius(st)) continue;
        if (st.py > c.y + 1.3 || st.py + playerHeight(st) < c.y - 0.2) continue;
        const kind = c.forced ?? rollLoot(Math.random, { inflation: st.inflation, stream: p.weapon.kind === 'stream', gadgetsReady: st.u1Cool <= 0 && st.u2Cool <= 0 });
        this.applyLoot(p, kind);
        this.events.push({ t: 'lootGrab', tick: this.tick, id: c.id, by: p.id, kind, x: c.x, y: c.y, z: c.z });
        this.crates.splice(i, 1);
        break;
      }
    }
  }

  /** What a crate does to whoever grabs it. */
  applyLoot(p: SimPlayer, kind: LootKind): void {
    const L = BALANCE.loot;
    const s = p.state;
    switch (kind) {
      case 'deflate':
        s.inflation = Math.max(0, s.inflation - L.deflate);
        if (p.savedInflation >= 0) p.savedInflation = Math.max(0, p.savedInflation - L.deflate);
        break;
      case 'mega':
        s.megaShots = Math.min(9, s.megaShots + L.megaShots);
        break;
      case 'turbo':
        s.turboTimer = Math.max(s.turboTimer, L.turboSeconds);
        s.ammo = p.weapon.ammo;
        s.reloadTimer = 0;
        break;
      case 'gadgets':
        s.u1Cool = 0;
        s.u2Cool = 0;
        break;
      case 'feather':
        s.floatTimer = L.featherSeconds;
        break;
      case 'spring':
        s.springJumps = L.springJumps;
        break;
    }
  }

  // --- Gadgets in the world (Air Mines, helium clouds, tornados) -----------------------------

  private deployMine(pr: Projectile): void {
    const M = BALANCE.utilities.airMine;
    const y = pr.y - pr.radius;
    const ground = floorBelow(this.world, pr.x, y + 0.1, pr.z, 0.5);
    if (!ground) {
      this.events.push({ t: 'fizzle', tick: this.tick, id: pr.id, x: pr.x, y: pr.y, z: pr.z });
      return;
    }
    // One mine per player: a new one replaces the old.
    for (let i = this.mines.length - 1; i >= 0; i--) {
      if (this.mines[i].owner === pr.owner) this.removeMine(i, false);
    }
    const m: AirMine = { id: this.nextGadgetId++, owner: pr.owner, x: pr.x, y: ground.maxY, z: pr.z, ground: ground.id, armAt: this.time + M.armTime, expires: this.time + M.lifetime };
    this.mines.push(m);
    this.events.push({ t: 'mine', tick: this.tick, id: m.id, proj: pr.id, owner: m.owner, x: m.x, y: m.y, z: m.z, arm: Math.round(m.armAt / this.dt) });
  }

  private removeMine(i: number, boom: boolean): void {
    const m = this.mines[i];
    this.mines.splice(i, 1);
    this.events.push({ t: 'mineGone', tick: this.tick, id: m.id, owner: m.owner, x: m.x, y: m.y, z: m.z, boom });
  }

  /** Air Mine blast: launches everyone nearby up and out (its owner gets a blast jump). */
  private mineBlast(m: AirMine): void {
    const M = BALANCE.utilities.airMine;
    const cx = m.x;
    const cy = m.y + 0.3;
    const cz = m.z;
    this.pushBall(cx, cy, cz, M.radius, BALANCE.modes.ball.splashImpulse * 1.2, m.owner);
    const out = Math.sqrt(1 - M.lift * M.lift);
    for (const p of this.players.values()) {
      const s = p.state;
      if (s.mode === MODE_DEAD) continue;
      const r = playerRadius(s);
      const h = playerHeight(s);
      const ay = Math.max(s.py + r, Math.min(s.py + h - r, cy));
      const d = Math.max(0, Math.hypot(cx - s.px, cy - ay, cz - s.pz) - r);
      if (d > M.radius) continue;
      const falloff = 0.4 + 0.6 * (1 - d / M.radius);
      let hx = s.px - cx;
      let hz = s.pz - cz;
      const hl = Math.hypot(hx, hz);
      if (hl > 1e-3) {
        hx /= hl;
        hz /= hl;
      } else {
        hx = hz = 0;
      }
      if (p.id === m.owner) this.blastJump(p, hx * out, M.lift, hz * out, falloff, 1);
      else this.applyHit(p, m.owner, hx * out, M.lift, hz * out, M.knockback * falloff, M.inflation * falloff, { direct: false, low: false, x: cx, y: cy, z: cz });
    }
  }

  private spawnTornado(p: SimPlayer): void {
    const T = BALANCE.utilities.tornado;
    const s = p.state;
    const fx = -Math.sin(s.yaw);
    const fz = -Math.cos(s.yaw);
    const x = s.px + fx * 1.2;
    const z = s.pz + fz * 1.2;
    const g = this.world.groundBelow(x, s.py + 0.5, z, 4);
    const until = this.tick + Math.round(T.duration / this.dt);
    const t: SimTornado = { id: this.nextGadgetId++, owner: p.id, x, y: g ?? s.py, z, dx: fx, dz: fz, speed: T.speed, until, caught: new Map() };
    this.tornados.push(t);
    this.events.push({ t: 'tornado', tick: this.tick, id: t.id, owner: t.owner, x: t.x, y: t.y, z: t.z, dx: t.dx, dz: t.dz, speed: t.speed, until });
  }

  private stepGadgets(): void {
    const dt = this.dt;
    // Air Mines ride their ground, time out, and go off under the first enemy to step close.
    const M = BALANCE.utilities.airMine;
    for (let i = this.mines.length - 1; i >= 0; i--) {
      const m = this.mines[i];
      const g = this.world.solid(m.ground);
      if (!g || !g.enabled || m.x < g.minX || m.x > g.maxX || m.z < g.minZ || m.z > g.maxZ || this.time >= m.expires) {
        this.removeMine(i, false);
        continue;
      }
      m.x += g.dX;
      m.z += g.dZ;
      m.y = g.maxY;
      if (this.time < m.armAt) continue;
      for (const p of this.players.values()) {
        const s = p.state;
        if (s.mode === MODE_DEAD || s.mode === MODE_HELD || s.spawnProt > 0 || !this.isEnemy(m.owner, p.id)) continue;
        if (Math.hypot(s.px - m.x, s.pz - m.z) > M.trigger + playerRadius(s)) continue;
        if (s.py > m.y + 2.2 || s.py + playerHeight(s) < m.y - 0.3) continue;
        this.removeMine(i, true);
        this.mineBlast(m);
        break;
      }
    }

    // Helium clouds: every enemy who touches one floats up for a while (once per cloud).
    const H = BALANCE.utilities.heliumBomb;
    for (let i = this.heliumClouds.length - 1; i >= 0; i--) {
      const c = this.heliumClouds[i];
      if (this.time >= c.until) {
        this.heliumClouds.splice(i, 1);
        continue;
      }
      for (const p of this.players.values()) {
        const s = p.state;
        if (c.touched.has(p.id) || s.mode === MODE_DEAD || s.mode === MODE_HELD || s.spawnProt > 0 || p.id === c.owner || !this.isEnemy(c.owner, p.id)) continue;
        const cy = s.py + playerHeight(s) * 0.5;
        if (Math.hypot(s.px - c.x, cy - c.y, s.pz - c.z) > H.radius + playerRadius(s)) continue;
        c.touched.add(p.id);
        if (s.mode === MODE_HANG || s.mode === MODE_CLIMB) releaseLedge(s, 0);
        s.heliumTimer = H.float;
        s.vy = Math.max(s.vy, H.popUp);
        s.onGround = 0;
        s.groundId = -1;
        s.slideTimer = 0;
        this.credit(p, c.owner);
        this.events.push({ t: 'floaty', tick: this.tick, id: p.id, by: c.owner, until: this.tick + Math.round(H.float / dt) });
      }
    }

    // Tornados roll along, swirling up anyone they catch.
    const T = BALANCE.utilities.tornado;
    for (let i = this.tornados.length - 1; i >= 0; i--) {
      const t = this.tornados[i];
      stepTornado(t, this.world, dt);
      if (this.tick >= t.until || t.y < this.lostY) {
        this.tornados.splice(i, 1);
        this.events.push({ t: 'tornadoGone', tick: this.tick, id: t.id, x: t.x, y: t.y, z: t.z });
        continue;
      }
      for (const p of this.players.values()) {
        const s = p.state;
        if (p.id === t.owner || s.mode === MODE_DEAD || s.mode === MODE_HELD || s.spawnProt > 0 || !this.isEnemy(t.owner, p.id)) continue;
        // Dashing breaks free, and nobody gets whirled for more than `holdMax` by one tornado.
        const since = t.caught.get(p.id);
        if (s.dashTimer > 0 || (since !== undefined && this.time - since > T.holdMax)) continue;
        const r = playerRadius(s);
        let ux = s.px - t.x;
        let uz = s.pz - t.z;
        const d = Math.hypot(ux, uz);
        if (d > T.radius + r || s.py > t.y + T.height || s.py + playerHeight(s) < t.y - 1) continue;
        if (d > 1e-3) {
          ux /= d;
          uz /= d;
        } else {
          ux = 1;
          uz = 0;
        }
        if (s.mode === MODE_HANG || s.mode === MODE_CLIMB) releaseLedge(s, 0);
        // Steer the velocity (relative to the moving column) toward a whirl around it
        // (counter-clockwise from above) with a slight inward drift. Lighter, more inflated
        // players get gripped faster and whirled harder.
        const mass = inflationMass(s.inflation);
        const k = Math.min(1, (T.grip * dt) / mass);
        const spin = T.spin * (1 + T.spinInflation * s.inflation);
        const tvx = t.dx * t.speed;
        const tvz = t.dz * t.speed;
        const rvx = s.vx - tvx;
        const rvz = s.vz - tvz;
        let vt = -rvx * uz + rvz * ux;
        vt += (spin - vt) * k;
        // Held in orbit, drifting slowly toward the middle.
        const vr = -1.5 * Math.min(1, d / T.radius);
        s.vx = tvx + ux * vr - uz * vt;
        s.vz = tvz + uz * vr + ux * vt;
        if (s.py < t.y + T.height * 0.75 && s.vy < T.lift) s.vy = Math.min(T.lift, s.vy + T.liftAccel * dt);
        s.onGround = 0;
        s.groundId = -1;
        s.slideTimer = 0;
        s.blownTimer = 0.15;
        s.inflation = Math.min(BALANCE.inflation.max, s.inflation + T.inflation * dt);
        s.sinceHit = 0;
        if (since === undefined) {
          t.caught.set(p.id, this.time);
          // Caught: you're tumbling (dash out once the launch lockout passes).
          s.launchElapsed = 0;
          this.events.push({ t: 'swept', tick: this.tick, id: t.id, target: p.id, x: s.px, y: s.py, z: s.pz });
        }
        s.launchTimer = Math.max(s.launchTimer, 0.2);
        this.credit(p, t.owner);
      }
    }
  }

  /** Gives `by` credit for launching `p` (knockout credit and longest-launch stats). */
  private credit(p: SimPlayer, by: number): void {
    if (by < 0) return;
    const s = p.state;
    p.lastAttacker = by;
    p.lastAttackTime = this.time;
    if (p.launchBy !== by) {
      p.launchBy = by;
      p.launchFromX = s.px;
      p.launchFromZ = s.pz;
      p.launchStartTick = this.tick;
    }
  }

  /** Debug: swap a player's gadgets right away (ignores unlocks). */
  debugSetUtilities(id: number, utils: unknown): void {
    const p = this.players.get(id);
    if (!p) return;
    p.loadout = sanitizeLoadout({ ...p.loadout, utils });
    if (p.pendingLoadout) p.pendingLoadout = { ...p.pendingLoadout, utils: p.loadout.utils };
    p.state.u1Cool = 0;
    p.state.u2Cool = 0;
    this.emitLoadout(p);
  }

  private resetEntities(): void {
    this.vacuums.length = 0;
    for (const c of this.crates) this.events.push({ t: 'lootGone', tick: this.tick, id: c.id, x: c.x, y: c.y, z: c.z, why: 'reset' });
    this.crates.length = 0;
    while (this.mines.length) this.removeMine(this.mines.length - 1, false);
    this.heliumClouds.length = 0;
    for (const t of this.tornados) this.events.push({ t: 'tornadoGone', tick: this.tick, id: t.id, x: t.x, y: t.y, z: t.z });
    this.tornados.length = 0;
    this.scheduleLoot(true);
    for (const id of this.dynamicSolids.keys()) {
      this.world.setSolidAt(id, null);
      this.events.push({ t: 'solidGone', tick: this.tick, id });
    }
    this.dynamicSolids.clear();
    for (const pad of [...this.world.pads]) {
      if (pad.owner >= 0) {
        this.world.removePad(pad.id);
        this.events.push({ t: 'padGone', tick: this.tick, id: pad.id });
      }
    }
    for (const k of this.pickups) {
      k.kind = 'soda';
      k.active = true;
      this.events.push({ t: 'pickup', tick: this.tick, id: k.id, kind: 'soda', x: k.x, y: k.y, z: k.z, active: true, by: -1 });
    }
    this.scheduleNextPin();
  }

  /** Everything a player joining mid-match needs to see the current world. */
  entitySnapshot(): {
    pickups: Pickup[];
    solids: DynamicSolidInfo[];
    pads: { id: number; x: number; y: number; z: number; half: number; strength: number; until: number }[];
    chaos: (ChaosEvent | null)[];
    crownId: number;
    crates: { id: number; x: number; y: number; z: number; falling: boolean; fall: number }[];
    mines: { id: number; owner: number; x: number; y: number; z: number; arm: number }[];
    tornados: Tornado[];
  } {
    return {
      chaos: [this.chaosCurrent, this.chaosNext],
      crownId: this.crownId,
      crates: this.crates.map((c) => ({ id: c.id, x: c.x, y: c.y, z: c.z, falling: c.falling, fall: c.fall })),
      mines: this.mines.map((m) => ({ id: m.id, owner: m.owner, x: m.x, y: m.y, z: m.z, arm: Math.round(m.armAt / this.dt) })),
      tornados: this.tornados.map((t) => ({ id: t.id, owner: t.owner, x: t.x, y: t.y, z: t.z, dx: t.dx, dz: t.dz, speed: t.speed, until: t.until })),
      pickups: this.pickups.map((k) => ({ ...k })),
      solids: [...this.dynamicSolids.values()].map((d) => ({ ...d, expires: Math.round(d.expires / this.dt) })),
      pads: this.world.pads.filter((p) => p.owner >= 0).map((p) => ({ id: p.id, x: p.x, y: p.y, z: p.z, half: p.half, strength: p.strength, until: Math.round(p.expires / this.dt) })),
    };
  }

  // --- Modes -----------------------------------------------------------------------------

  private stepModes(): void {
    const ball = this.ballGame;
    if (ball && this.phase === 'waiting') {
      // In the lobby the ball can be knocked around, but a goal doesn't count: it just goes back.
      const ev = ball.step(this.dt, this.time, this.players.values());
      if (ev?.kind === 'goal') this.onBallEvent({ kind: 'out' });
      else if (ev) this.onBallEvent(ev);
    }
    if (this.phase !== 'playing') return;
    if (ball) {
      const ev = ball.step(this.dt, this.time, this.players.values());
      if (ev) this.onBallEvent(ev);
    }
    if (this.pumpGame) {
      const list = [...this.players.values()].map((p) => ({ id: p.id, team: p.team, state: p.state }));
      const winner = this.pumpGame.step(this.dt, list);
      for (const id of this.pumpGame.pumping) {
        const p = this.players.get(id);
        if (!p) continue;
        p.stats.pumpTime += this.dt;
        this.ults.onPump(p, this.dt);
      }
      if (winner !== null) {
        this.events.push({ t: 'pumpFull', tick: this.tick, team: winner });
        this.pendingEnd = true;
      }
    }
  }

  private onBallEvent(ev: BallEvent): void {
    const b = this.ballGame!.ball;
    if (ev.kind === 'goal') {
      this.teamScores[ev.team]++;
      const scorer = this.players.get(ev.scorer);
      // Own goals don't count toward a player's goals.
      if (scorer && scorer.team === ev.team) {
        scorer.score++;
        scorer.stats.goals++;
        this.ults.onGoal(scorer);
      }
      this.events.push({ t: 'goal', tick: this.tick, team: ev.team, scorer: ev.scorer, x: b.x, y: b.y, z: b.z });
      if (this.teamScores[ev.team] >= BALANCE.modes.ball.goalTarget) this.pendingEnd = true;
    } else if (ev.kind === 'out') {
      this.events.push({ t: 'ballOut', tick: this.tick, x: b.x, y: b.y, z: b.z });
    } else {
      this.events.push({ t: 'ballReset', tick: this.tick });
    }
  }

  // --- Player interactions -----------------------------------------------------------------

  /** Grab key: stomp a hanging player's hands, or grab someone in front of you. */
  private tryGrab(p: SimPlayer): void {
    const s = p.state;
    const G = BALANCE.grab;
    if (s.mode !== MODE_NORMAL || s.holding >= 0 || s.doubledTimer > 0) return;
    if (this.features.ledge && this.tryStomp(p)) return;
    if (!this.features.grab || s.grabCool > 0) return;
    const r = playerRadius(s);
    const fx = -Math.sin(s.yaw);
    const fz = -Math.cos(s.yaw);
    let best: SimPlayer | null = null;
    let bestD = Infinity;
    for (const o of this.players.values()) {
      if (o === p || !this.isEnemy(p.id, o.id)) continue;
      const t = o.state;
      if (t.mode !== MODE_NORMAL && t.mode !== MODE_HANG) continue;
      if (t.spawnProt > 0 || t.heldBy >= 0) continue;
      const dx = t.px - s.px;
      const dz = t.pz - s.pz;
      const dy = t.py + playerHeight(t) * 0.5 - (s.py + playerHeight(s) * 0.5);
      const horiz = Math.hypot(dx, dz);
      if (horiz > r + playerRadius(t) + G.range) continue;
      if (Math.abs(dy) > playerHeight(s) * 0.8 + 0.5) continue;
      if (horiz > 0.3 && (dx * fx + dz * fz) / horiz < Math.cos(G.cone)) continue;
      if (horiz < bestD && this.clearBetween(s, t)) {
        bestD = horiz;
        best = o;
      }
    }
    if (!best) {
      if (s.onGround) s.grabCool = G.whiffCooldown;
      return;
    }
    this.startGrab(p, best);
  }

  /** Nothing solid between two players' middles (no grabbing through a wall). */
  clearBetween(a: PlayerState, b: PlayerState): boolean {
    const ay = a.py + playerHeight(a) * 0.5;
    const dx = b.px - a.px;
    const dy = b.py + playerHeight(b) * 0.5 - ay;
    const dz = b.pz - a.pz;
    const d = Math.hypot(dx, dy, dz);
    if (d < 0.05) return true;
    return this.world.raycast(a.px, ay, a.pz, dx / d, dy / d, dz / d, d) === null;
  }

  /** ABAG's hug: grabs his chase target on contact (see UltSim.stepChases). */
  hug(p: SimPlayer, target: SimPlayer): void {
    this.startGrab(p, target);
    this.events.push({ t: 'bag', tick: this.tick, id: p.id, target: target.id });
  }

  private startGrab(p: SimPlayer, target: SimPlayer): void {
    const s = p.state;
    const t = target.state;
    if (s.pinTimer > 0 && t.inflation >= BALANCE.inflation.max - 1e-6) {
      s.pinTimer = 0;
      target.lastAttacker = p.id;
      target.lastAttackTime = this.time;
      this.events.push({ t: 'pop', tick: this.tick, id: p.id, target: target.id, x: t.px, y: t.py + playerHeight(t) * 0.5, z: t.pz });
      this.knockout(target, 'pin');
      return;
    }
    if (t.mode === MODE_HANG || t.mode === MODE_CLIMB) releaseLedge(t, 0);
    if (t.holding >= 0) this.releaseHold(target);
    t.mode = MODE_HELD;
    t.heldBy = p.id;
    t.holdTimer = 0;
    t.escapeUsed = 0;
    t.charging = 0;
    t.charge = 0;
    t.launchTimer = 0;
    t.dashTimer = 0;
    t.slideTimer = 0;
    t.zipTimer = 0;
    t.vx = t.vy = t.vz = 0;
    t.onGround = 0;
    s.holding = target.id;
    s.holdTimer = 0;
    s.charging = 0;
    s.charge = 0;
    target.lastAttacker = p.id;
    target.lastAttackTime = this.time;
    // Falling with nothing below you: this is a take-you-with-me.
    const drag = !s.onGround && s.vy < 0 && this.world.groundBelow(s.px, s.py, s.pz, 40) === null;
    this.events.push({ t: 'grab', tick: this.tick, id: p.id, target: target.id, drag });
  }

  /** Keeps held players in the grabber's arms and handles automatic throws. */
  private updateHolds(): void {
    const G = BALANCE.grab;
    for (const p of this.players.values()) {
      const s = p.state;
      if (s.holding < 0) continue;
      const target = this.players.get(s.holding);
      if (!target || target.state.heldBy !== p.id || target.state.mode !== MODE_HELD || s.mode !== MODE_NORMAL) {
        this.releaseHold(p);
        continue;
      }
      const t = target.state;
      const fx = -Math.sin(s.yaw);
      const fz = -Math.cos(s.yaw);
      const dist = playerRadius(s) + playerRadius(t) + 0.1;
      t.px = s.px + fx * dist;
      t.py = s.py + 0.4;
      t.pz = s.pz + fz * dist;
      t.vx = s.vx;
      t.vy = s.vy;
      t.vz = s.vz;
      t.yaw = s.yaw + Math.PI;
      depenetrate(t, this.world);
      t.mode = MODE_HELD;
      t.onGround = 0;
      if (s.onGround && s.holdTimer >= G.maxHold) this.throwHeld(p);
      else if (!s.onGround && s.holdTimer >= G.maxDragHold) this.releaseHold(p);
    }
  }

  private throwHeld(p: SimPlayer): void {
    const s = p.state;
    const target = this.players.get(s.holding);
    const G = BALANCE.grab;
    if (!target) {
      this.releaseHold(p);
      return;
    }
    const dir = lookDir(s.yaw, Math.max(s.pitch, G.throwMinPitch), { x: 0, y: 0, z: 0 });
    this.releaseHold(p);
    const t = target.state;
    p.stats.throws++;
    this.events.push({ t: 'throw', tick: this.tick, id: p.id, target: target.id });
    this.applyHit(target, p.id, dir.x, dir.y, dir.z, G.throwPower * this.ults.throwMult(p, target), G.throwInflation, {
      direct: true,
      low: false,
      x: t.px,
      y: t.py + playerHeight(t) * 0.5,
      z: t.pz,
    });
  }

  /** Lets go of whoever this player is holding. The held player keeps the grabber's momentum. */
  private releaseHold(p: SimPlayer): void {
    const s = p.state;
    const tid = s.holding;
    s.holding = -1;
    s.holdTimer = 0;
    s.grabCool = Math.max(s.grabCool, BALANCE.grab.cooldown);
    const target = this.players.get(tid);
    if (target && target.state.heldBy === p.id) {
      const t = target.state;
      t.heldBy = -1;
      t.holdTimer = 0;
      if (t.mode === MODE_HELD) t.mode = MODE_NORMAL;
      t.vx = s.vx;
      t.vy = s.vy;
      t.vz = s.vz;
      t.onGround = 0;
    }
  }

  /** Breaks any grab this player is part of (as grabber or as the one being held). */
  private releaseInvolving(p: SimPlayer): void {
    const s = p.state;
    if (s.holding >= 0) this.releaseHold(p);
    if (s.heldBy >= 0) {
      const g = this.players.get(s.heldBy);
      if (g && g.state.holding === p.id) this.releaseHold(g);
      else {
        s.heldBy = -1;
        if (s.mode === MODE_HELD) s.mode = MODE_NORMAL;
      }
    }
  }

  /** One well-timed dash breaks free. Early or late presses use up your only attempt. */
  private tryEscape(p: SimPlayer): void {
    const t = p.state;
    const G = BALANCE.grab;
    if (t.mode !== MODE_HELD || t.heldBy < 0 || t.escapeUsed) return;
    t.escapeUsed = 1;
    const g = this.players.get(t.heldBy);
    if (!g) return;
    if (t.holdTimer >= G.escapeStart && t.holdTimer <= G.escapeEnd && t.dashCharges >= 1) {
      if (t.dashCharges >= BALANCE.dash.charges) t.dashRecharge = BALANCE.dash.rechargeTime;
      t.dashCharges -= 1;
      this.releaseHold(g);
      const gs = g.state;
      const fx = -Math.sin(gs.yaw);
      const fz = -Math.cos(gs.yaw);
      t.vx = fx * G.escapePush;
      t.vy = 5;
      t.vz = fz * G.escapePush;
      gs.vx -= fx * 4;
      gs.vz -= fz * 4;
      this.events.push({ t: 'escape', tick: this.tick, id: p.id, from: g.id });
    } else {
      this.events.push({ t: 'escapeFail', tick: this.tick, id: p.id, early: t.holdTimer < G.escapeStart });
    }
  }

  /** Landing on, or pressing grab next to, a hanging player's hands knocks them off. */
  private tryStomp(p: SimPlayer): boolean {
    const s = p.state;
    const L = BALANCE.ledge;
    if (s.mode !== MODE_NORMAL || !s.onGround) return false;
    for (const o of this.players.values()) {
      if (o === p || !this.isEnemy(p.id, o.id)) continue;
      const h = o.state;
      if (h.mode !== MODE_HANG) continue;
      if (Math.abs(s.py - h.hangY) > 0.6) continue;
      if (Math.hypot(s.px - h.hangX, s.pz - h.hangZ) > playerRadius(s) + L.stompReach) continue;
      releaseLedge(h, -L.stompDropSpeed);
      h.vx = h.hangNx * 2;
      h.vz = h.hangNz * 2;
      h.launchTimer = L.stompStun;
      h.launchElapsed = 0;
      h.regrabCool = 1;
      o.lastAttacker = p.id;
      o.lastAttackTime = this.time;
      o.launchBy = p.id;
      o.launchFromX = h.px;
      o.launchFromZ = h.pz;
      o.launchStartTick = this.tick;
      p.stats.stomps++;
      this.events.push({ t: 'stomp', tick: this.tick, id: p.id, target: o.id, x: h.hangX, y: h.hangY, z: h.hangZ });
      return true;
    }
    return false;
  }

  /** Grapple: pull an enemy toward you, or pull yourself to a surface. */
  private tryGrapple(p: SimPlayer): void {
    const s = p.state;
    const G = BALANCE.grapple;
    if (!this.features.grapple || s.grappleCool > 0 || s.mode !== MODE_NORMAL || s.holding >= 0 || grappleLocked(s)) return;
    const d = lookDir(s.yaw, s.pitch, { x: 0, y: 0, z: 0 });
    const ex = s.px;
    const ey = s.py + eyeHeight(s);
    const ez = s.pz;
    const range = G.range * grappleScale(s, G.rangeAtMax);
    let target: SimPlayer | null = null;
    let bestT = range;
    for (const o of this.players.values()) {
      if (o === p || !this.isEnemy(p.id, o.id)) continue;
      const t = o.state;
      if (t.mode === MODE_DEAD || t.mode === MODE_HELD || t.spawnProt > 0) continue;
      const hit = rayCapsule(ex, ey, ez, d.x, d.y, d.z, t, playerRadius(t) * this.hitR(o) + G.aimForgiveness, this.hitH(o));
      if (hit !== null && hit < bestT) {
        bestT = hit;
        target = o;
      }
    }
    const wh = this.world.raycast(ex, ey, ez, d.x, d.y, d.z, range);
    if (target && (!wh || bestT < wh.dist)) {
      const t = target.state;
      if (t.mode === MODE_HANG || t.mode === MODE_CLIMB) releaseLedge(t, 0);
      const cy = t.py + playerHeight(t) * 0.5;
      let dx = ex - t.px;
      let dy = ey - cy;
      let dz = ez - t.pz;
      const l = Math.hypot(dx, dy, dz) || 1;
      dx /= l;
      dy /= l;
      dz /= l;
      t.vx = dx * G.pullSpeed;
      t.vy = dy * G.pullSpeed + G.pullUp;
      t.vz = dz * G.pullSpeed;
      t.onGround = 0;
      t.groundId = -1;
      t.slideTimer = 0;
      t.dashTimer = 0;
      t.zipTimer = 0;
      t.launchTimer = Math.max(t.launchTimer, G.pullHitstun);
      t.launchElapsed = 0;
      target.lastAttacker = p.id;
      target.lastAttackTime = this.time;
      target.launchBy = p.id;
      target.launchFromX = t.px;
      target.launchFromZ = t.pz;
      target.launchStartTick = this.tick;
      // Reeled in, they don't crash into you as if you'd been hit by them.
      const noChain = this.time + G.pullHitstun + 0.3;
      target.chainCool.set(p.id, noChain);
      p.chainCool.set(target.id, noChain);
      s.grappleCool = G.cooldown;
      this.events.push({ t: 'grapple', tick: this.tick, id: p.id, target: target.id, x: t.px, y: cy, z: t.pz, miss: false });
    } else if (wh) {
      const h = playerHeight(s);
      s.zipTimer = G.zipMaxTime;
      s.zipX = wh.x + wh.nx * (playerRadius(s) + 0.3);
      s.zipY = wh.y + wh.ny * 0.6 + (wh.ny > 0.5 ? h * 0.5 : 0.3);
      s.zipZ = wh.z + wh.nz * (playerRadius(s) + 0.3);
      s.onGround = 0;
      s.grappleCool = G.cooldown;
      this.events.push({ t: 'grapple', tick: this.tick, id: p.id, target: -1, x: wh.x, y: wh.y, z: wh.z, miss: false });
    } else {
      s.grappleCool = G.missCooldown;
      this.events.push({ t: 'grapple', tick: this.tick, id: p.id, target: -1, x: ex + d.x * G.range, y: ey + d.y * G.range, z: ez + d.z * G.range, miss: true });
    }
  }


  private separatePlayers(): void {
    const list = [...this.players.values()].filter((p) => p.state.mode === MODE_NORMAL);
    const k = Math.min(1, BALANCE.player.separationStrength * this.dt);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i].state;
        const b = list[j].state;
        const ra = playerRadius(a);
        const rb = playerRadius(b);
        const dx = b.px - a.px;
        const dz = b.pz - a.pz;
        const d = Math.hypot(dx, dz);
        const minD = ra + rb;
        if (d >= minD) continue;
        if (a.py + playerHeight(a) <= b.py || b.py + playerHeight(b) <= a.py) continue;
        const nx = d > 1e-4 ? dx / d : 1;
        const nz = d > 1e-4 ? dz / d : 0;
        const push = (minD - d) * 0.5 * k;
        a.px -= nx * push;
        a.pz -= nz * push;
        b.px += nx * push;
        b.pz += nz * push;
        depenetrate(a, this.world);
        depenetrate(b, this.world);
      }
    }
  }

  // --- Knockouts and respawns --------------------------------------------------------------

  private checkBlastZones(): void {
    const B = this.map.blast;
    for (const p of this.players.values()) {
      const s = p.state;
      if (s.mode === MODE_DEAD) continue;
      if (s.px < B.minX || s.px > B.maxX || s.py < B.minY || s.py > B.maxY || s.pz < B.minZ || s.pz > B.maxZ) {
        this.knockout(p);
      }
    }
  }

  /** Turbo Tank at 3 pops in one life, Mega Blast at 5, both again at 8. */
  streakReward(p: SimPlayer): void {
    const B = BALANCE.streaks;
    const s = p.state;
    if (s.mode === MODE_DEAD) return;
    const n = p.streak;
    const turbo = n === B.turboAt || n === B.bothAt;
    const mega = n === B.megaAt || n === B.bothAt;
    if (!turbo && !mega) return;
    if (turbo) {
      s.turboTimer = B.turboSeconds;
      s.ammo = p.weapon.ammo;
      s.reloadTimer = 0;
      s.dashCharges = BALANCE.dash.charges;
      s.dashRecharge = 0;
    }
    if (mega) s.megaShots = B.megaShots;
    this.events.push({ t: 'streak', tick: this.tick, id: p.id, kind: turbo && mega ? 'both' : turbo ? 'turbo' : 'mega', n });
  }

  knockout(p: SimPlayer, tag?: string): void {
    const s = p.state;
    this.releaseInvolving(p);
    // The last attacker gets the knockout within a few seconds of their hit, or for longer if the
    // victim never got their feet back under them since (bouncing around a bouncy castle, say).
    const since = this.time - p.lastAttackTime;
    const credit = p.lastAttacker >= 0 && (since <= BALANCE.knockback.creditWindow || (p.footedAt < p.lastAttackTime && since <= BALANCE.knockback.creditWindowAirborne));
    let killer = credit ? this.players.get(p.lastAttacker) : undefined;
    let points = 0;
    const tags: string[] = tag ? [tag] : [];
    if (!killer && this.mode === 'duel' && this.phase === 'playing') {
      // In a 1v1, falling off on your own still scores for your rival.
      for (const q of this.players.values()) {
        if (q !== p) {
          killer = q;
          tags.push('sd');
          break;
        }
      }
    }
    if (killer && killer !== p && this.phase === 'playing') {
      // One knockout, one point: the crown, the final seconds and revenge are callouts, not
      // bonus points, so the score is always just the knockout count.
      points = BALANCE.scoring.knockout;
      if (this.crownId === p.id) {
        tags.push('crown');
        killer.stats.crownKos++;
      }
      if (this.isFinal()) tags.push('final');
      if (killer.nemesis === p.id) {
        tags.push('revenge');
        killer.nemesis = -1;
      }
      if (p.chainBy === killer.id && this.time - p.chainTime < 4) {
        tags.push('chain');
        killer.stats.chainKos++;
      }
      killer.koTimes = killer.koTimes.filter((t) => t > this.time - BALANCE.multiKo.window);
      killer.koTimes.push(this.time);
      const n = killer.koTimes.length;
      if (n === 2) tags.push('double');
      else if (n === 3) tags.push('triple');
      else if (n >= 4) tags.push('multi');
      if (!this.firstKo) {
        this.firstKo = true;
        tags.push('first');
      }
      if (this.mode === 'ball' || this.mode === 'pump') points = 0;
      if (this.mode === 'teamKnockout' && killer.team >= 0) this.teamScores[killer.team as 0 | 1] += points;
      killer.score += points;
      killer.stats.kos++;
      this.ults.onKo(killer, p);
      killer.streak++;
      this.streakReward(killer);
      p.nemesis = killer.id;
    }
    if (killer && p.launchBy === killer.id) this.finishLaunch(p, true);
    // In the lobby (waiting for the host, or for a second player) knockouts aren't recorded.
    if (this.phase !== 'waiting') {
      p.stats.deaths++;
      p.stats.timesPopped++;
      if (!killer) p.stats.falls++;
    }
    p.streak = 0;
    this.events.push({
      t: 'ko',
      tick: this.tick,
      victim: p.id,
      killer: killer ? killer.id : -1,
      x: s.px,
      y: s.py,
      z: s.pz,
      vx: s.vx,
      vy: s.vy,
      vz: s.vz,
      points,
      tags,
    });
    s.mode = MODE_DEAD;
    s.vx = s.vy = s.vz = 0;
    s.charging = 0;
    s.charge = 0;
    p.respawnAt = this.time + BALANCE.match.respawnDelay;
    if (this.mode === 'duel' && killer && killer.stats.kos >= BALANCE.modes.duel.target && this.phase === 'playing') this.pendingEnd = true;
    // Knockout: first to the target; Team Knockout: first team to theirs.
    if (this.mode === 'knockout' && killer && killer.score >= BALANCE.modes.knockout.target && this.phase === 'playing') this.pendingEnd = true;
    if (this.mode === 'teamKnockout' && killer && killer.team >= 0 && this.teamScores[killer.team as 0 | 1] >= BALANCE.modes.teamKnockout.target && this.phase === 'playing') this.pendingEnd = true;
    p.lastAttacker = -1;
    p.launchBy = -1;
    p.chainBy = -1;
    p.savedInflation = -1;
    if (this.suddenDeath && this.phase === 'playing' && p.outAt === Infinity) {
      // One life per round: out (spectating) until the next round.
      p.outAt = this.time;
      p.respawnAt = Infinity;
    }
    this.updateCrown();
  }

  /**
   * Sudden Death: tells everyone how many are left after someone goes out, and decides the round
   * once one player (or nobody, if the last ones went out together) is left.
   */
  private checkSurvivors(): void {
    if (!this.suddenDeath || this.phase !== 'playing' || this.sdIntermission) return;
    const alive = [...this.players.values()].filter((p) => p.outAt === Infinity);
    const dropped = alive.length < this.sdAlive;
    this.sdAlive = alive.length;
    if (!dropped) return;
    this.events.push({ t: 'survivors', tick: this.tick, left: alive.map((p) => p.id) });
    if (alive.length <= 1) this.decideRound(false);
  }

  /**
   * Sudden Death round placing: whoever lasted longest. If the round's time runs out with several
   * still in (or the last ones go out together): most knockouts this round, then most hits landed
   * this round, then fewest knockouts taken this match.
   */
  private roundOrder(a: SimPlayer, b: SimPlayer): number {
    const kos = (p: SimPlayer) => p.stats.kos - p.roundBase.kos;
    const hits = (p: SimPlayer) => p.stats.hits - p.roundBase.hits;
    return order(a.outAt, b.outAt) || kos(b) - kos(a) || hits(b) - hits(a) || a.stats.deaths - b.stats.deaths || a.id - b.id;
  }

  /**
   * Sudden Death: the round is over. Its winner gets a round point, everyone sees the score, and
   * after a short beat the next round starts (or the results, once someone has enough wins).
   */
  private decideRound(timeUp: boolean): void {
    const SD = BALANCE.modes.suddenDeath;
    const winner = [...this.players.values()].sort((a, b) => this.roundOrder(a, b))[0];
    if (winner) winner.roundWins++;
    this.sdMatchOver = !!winner && winner.roundWins >= SD.roundsToWin;
    this.sdIntermission = true;
    this.sdEndAt = this.time + (this.sdMatchOver ? SD.winnerDelay : SD.roundBreak);
    // The clock counts down to the next round.
    this.phaseEndsAt = this.sdEndAt;
    const wins = [...this.players.values()]
      .sort((a, b) => b.roundWins - a.roundWins || (a === winner ? -1 : b === winner ? 1 : a.id - b.id))
      .map((p): [number, number] => [p.id, p.roundWins]);
    this.events.push({ t: 'round', tick: this.tick, n: this.sdRound, winner: winner?.id ?? -1, wins, over: this.sdMatchOver, timeUp });
    this.onPhaseChange?.();
  }

  /** Sudden Death: everyone back in, the map back in one piece, and a fresh round clock. */
  private startRound(): void {
    this.sdRound++;
    this.sdRoundStartedAt = this.time;
    this.sdIntermission = false;
    this.sdMatchOver = false;
    this.sdEndAt = Infinity;
    this.phaseEndsAt = this.time + this.durationSec;
    this.world.setCollapse(collapsePlan(this.mode, this.map, this.phaseEndsAt, this.durationSec));
    this.shrinkNext = 0;
    this.world.setTime(this.time);
    this.finalAnnounced = false;
    this.pendingEnd = false;
    this.sdAlive = this.players.size;
    for (const p of this.players.values()) {
      p.outAt = Infinity;
      p.roundBase = { kos: p.stats.kos, hits: p.stats.hits };
      p.savedInflation = -1;
      this.respawn(p);
    }
    this.projectiles.length = 0;
    this.ults.reset();
    this.resetEntities();
  }

  private updateCrown(): void {
    const min = BALANCE.crown.minStreak;
    const holder = this.players.get(this.crownId);
    let best = holder && holder.streak >= min && holder.state.mode !== MODE_DEAD ? holder : null;
    for (const p of this.players.values()) {
      if (p.streak >= min && (!best || p.streak > best.streak)) best = p;
    }
    const id = best ? best.id : -1;
    if (id !== this.crownId) {
      this.crownId = id;
      this.events.push({ t: 'crown', tick: this.tick, id });
    }
  }

  isFinal(): boolean {
    return this.phase === 'playing' && !this.sdIntermission && this.time >= this.phaseEndsAt - BALANCE.final.seconds;
  }

  // --- Chaos ---------------------------------------------------------------------------------

  private scheduleChaos(first: boolean): void {
    const C = BALANCE.chaos;
    // Sudden Death has no random events: the shrinking map is its event, and with one life a
    // random gust shouldn't decide who's out (Max Pressure does nothing when everyone is at 100%).
    if (this.eventMult <= 0 || this.suddenDeath) {
      this.nextChaosAt = Infinity;
      return;
    }
    const base = first ? C.firstEventAfter : C.eventInterval;
    this.nextChaosAt = this.time + (base + (Math.random() * 2 - 1) * C.eventJitter) / this.eventMult;
  }

  /** Forces the next random event (host "chaos now" button and tests). */
  triggerChaos(kind: ChaosKind, dirX = 1, dirZ = 0): void {
    const ticks = (sec: number) => Math.round(sec * BALANCE.tickRate);
    const start = this.tick + ticks(BALANCE.chaos.warning);
    this.chaosNext = { kind, announceTick: this.tick, startTick: start, endTick: start + ticks(chaosDuration(kind)), dirX, dirZ };
    this.events.push({ t: 'chaos', tick: this.tick, ...this.chaosNext });
  }

  private updateChaos(): void {
    const C = BALANCE.chaos;
    if (this.phase !== 'playing') {
      if (this.chaosCurrent) this.endChaos(this.chaosCurrent);
      this.chaosCurrent = null;
      this.chaosNext = null;
      return;
    }
    if (!this.chaosNext && !this.chaosCurrent && this.time >= this.nextChaosAt - C.warning && this.time < this.phaseEndsAt - C.quietEnd && !this.shrinkBusy(C.warning + 2)) {
      const kinds = CHAOS_KINDS.filter((k) => k !== this.lastChaosKind);
      const kind = kinds[Math.floor(Math.random() * kinds.length)];
      const dirs: [number, number][] = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ];
      const [dirX, dirZ] = dirs[Math.floor(Math.random() * 4)];
      this.lastChaosKind = kind;
      this.triggerChaos(kind, dirX, dirZ);
    }
    if (this.chaosNext && this.tick >= this.chaosNext.startTick) {
      this.chaosCurrent = this.chaosNext;
      this.chaosNext = null;
      if (this.chaosCurrent.kind === 'maxInflate') {
        for (const p of this.players.values()) {
          if (p.state.mode === MODE_DEAD) continue;
          p.savedInflation = p.state.inflation;
          p.state.inflation = BALANCE.inflation.max;
          depenetrate(p.state, this.world);
        }
      }
    }
    if (this.chaosCurrent && this.tick >= this.chaosCurrent.endTick) {
      this.endChaos(this.chaosCurrent);
      this.chaosCurrent = null;
      this.scheduleChaos(false);
    }
    if (!this.finalAnnounced && this.isFinal()) {
      this.finalAnnounced = true;
      this.events.push({ t: 'final', tick: this.tick });
    }
  }

  private endChaos(e: ChaosEvent): void {
    if (e.kind !== 'maxInflate') return;
    for (const p of this.players.values()) {
      if (p.savedInflation >= 0) {
        p.state.inflation = p.savedInflation;
        p.savedInflation = -1;
      }
    }
  }

  /** A launched player crashing into someone launches them too; the original shooter gets credit. */
  private chainReactions(): void {
    const C = BALANCE.chain;
    const list = [...this.players.values()].filter((p) => p.state.mode === MODE_NORMAL || p.state.mode === MODE_HANG || p.state.mode === MODE_CLIMB);
    for (const a of list) {
      const sa = a.state;
      if (sa.mode !== MODE_NORMAL) continue;
      const speed = Math.hypot(sa.vx, sa.vy, sa.vz);
      if (speed < C.minSpeed || !(sa.launchTimer > 0 || (a.launchBy >= 0 && !sa.onGround))) continue;
      const ra = playerRadius(sa);
      const ha = playerHeight(sa);
      for (const b of list) {
        if (b === a) continue;
        const sb = b.state;
        if (sb.spawnProt > 0) continue;
        if ((a.chainCool.get(b.id) ?? -1) > this.time) continue;
        const dx = sb.px - sa.px;
        const dz = sb.pz - sa.pz;
        const d = Math.hypot(dx, dz);
        if (d > ra + playerRadius(sb) + 0.15) continue;
        if (sa.py + ha < sb.py || sb.py + playerHeight(sb) < sa.py) continue;
        const owner = a.launchBy >= 0 && a.launchBy !== b.id ? a.launchBy : a.id;
        a.chainCool.set(b.id, this.time + C.cooldown);
        b.chainCool.set(a.id, this.time + C.cooldown);
        let hx = (sa.vx / speed) * 0.7 + (d > 0.01 ? (dx / d) * 0.3 : 0);
        let hy = (sa.vy / speed) * 0.7;
        let hz = (sa.vz / speed) * 0.7 + (d > 0.01 ? (dz / d) * 0.3 : 0);
        const hl = Math.hypot(hx, hy, hz) || 1;
        hx /= hl;
        hy /= hl;
        hz /= hl;
        const power = Math.min(1.5, speed * C.powerPerSpeed);
        sa.vx *= C.keep;
        sa.vy *= C.keep;
        sa.vz *= C.keep;
        this.events.push({ t: 'chain', tick: this.tick, id: a.id, target: b.id, by: owner, x: (sa.px + sb.px) / 2, y: sa.py + ha * 0.5, z: (sa.pz + sb.pz) / 2 });
        this.applyHit(b, owner, hx, hy, hz, power, C.inflation, { direct: false, low: false, x: sb.px - hx * 0.4, y: sb.py + playerHeight(sb) * 0.5, z: sb.pz - hz * 0.4 });
        b.chainBy = owner;
        b.chainTime = this.time;
      }
    }
  }

  /** Hitbox radius multiplier: bigger while turned into an ult character. */
  hitR(p: SimPlayer): number {
    return this.time < p.bigUntil ? BALANCE.ults.transformHitbox.radius : 1;
  }

  /** Hitbox height multiplier: taller while turned into an ult character. */
  hitH(p: SimPlayer): number {
    return this.time < p.bigUntil ? BALANCE.ults.transformHitbox.height : 1;
  }

  respawn(p: SimPlayer): void {
    const s = p.state;
    const lastUlt = ULT_IDS[s.ultKind];
    p.bigUntil = 0;
    // The ult meter carries over from life to life.
    const keep = { cJump: s.cJump, cDash: s.cDash, cBrace: s.cBrace, cGrab: s.cGrab, cGrapple: s.cGrapple, cReload: s.cReload, cU1: s.cU1, cU2: s.cU2, cTaunt: s.cTaunt, cUlt: s.cUlt, ult: s.ult, yaw: s.yaw };
    const fresh = createPlayerState();
    Object.assign(s, fresh, keep);
    if (p.pendingLoadout) {
      p.loadout = p.pendingLoadout;
      p.pendingLoadout = null;
      this.emitLoadout(p);
    }
    p.weapon = computeWeaponStats(p.loadout.weapon, p.loadout.parts);
    // Ults are dealt at random each spawn (all equally likely), never the same one twice in a row.
    s.ultKind = ultIndex(randomUlt(lastUlt));
    s.hoverTimer = p.weapon.hoverTime;
    const sp = this.pickSpawn(p.id);
    s.px = sp[0];
    s.py = sp[1] + 0.01;
    s.pz = sp[2];
    // Face the middle of the map so nobody spawns staring at a drop.
    s.yaw = Math.atan2(-(this.homePoint.x - sp[0]), -(this.homePoint.z - sp[2]));
    s.mode = MODE_NORMAL;
    s.onGround = 1;
    // Sudden Death: one life, so a little longer to get your bearings.
    s.spawnProt = this.suddenDeath ? BALANCE.modes.suddenDeath.spawnProtection : BALANCE.match.spawnProtection;
    s.ammo = p.weapon.ammo;
    p.lastAttacker = -1;
    p.launchBy = -1;
    this.events.push({ t: 'spawn', tick: this.tick, id: p.id, x: s.px, y: s.py, z: s.pz });
  }

  private pickSpawn(forId: number): [number, number, number, number] {
    const me = this.players.get(forId);
    const teamSpawns = me && me.team >= 0 ? this.map.teamSpawns?.[me.team] : undefined;
    const spawns: [number, number, number, number][] = teamSpawns ? teamSpawns.map(([x, y, z]) => [x, y, z, 0]) : this.map.spawns;
    let best = spawns[0];
    let bestScore = -Infinity;
    // Never spawn on a piece that has fallen away (or crumbled off the deck).
    const standing = (list: [number, number, number, number][]) => list.filter(([x, y, z]) => this.world.groundBelow(x, y + 0.1, z, 0.6) !== null);
    let onMap = standing(spawns);
    if (!onMap.length && teamSpawns?.length) {
      // A team's home has sunk (the end of a match on a map with separate bases): come back in at
      // whichever of the map's other spawns are closest to home.
      const hx = teamSpawns.reduce((a, s) => a + s[0], 0) / teamSpawns.length;
      const hz = teamSpawns.reduce((a, s) => a + s[2], 0) / teamSpawns.length;
      onMap = standing(this.map.spawns)
        .sort((a, b) => Math.hypot(a[0] - hx, a[2] - hz) - Math.hypot(b[0] - hx, b[2] - hz))
        .slice(0, 2);
    }
    for (const sp of onMap.length ? onMap : spawns) {
      let minD = 1e9;
      for (const o of this.players.values()) {
        if (o.id === forId || o.state.mode === MODE_DEAD) continue;
        minD = Math.min(minD, Math.hypot(o.state.px - sp[0], o.state.py - sp[1], o.state.pz - sp[2]));
      }
      // Slight randomness so players don't always spawn in the same spot.
      const score = minD + Math.random() * 4;
      if (score > bestScore) {
        bestScore = score;
        best = sp;
      }
    }
    return best;
  }

  // --- Match flow --------------------------------------------------------------------------

  private updatePhase(): void {
    if (this.phase === 'waiting' && this.autoStart && this.players.size >= 2) this.startMatch();
    else if (this.phase === 'playing' && this.players.size < 2 && this.fixedLineup) {
      // Ranked: someone left, so whoever is still here wins.
      this.endMatch();
    } else if (this.phase === 'playing' && this.players.size < 2) {
      this.toLobby();
    }
  }

  /** Sudden Death players who were out (or waiting) come back while nobody is playing a match. */
  private freeTheOut(): void {
    for (const p of this.players.values()) {
      if (p.outAt === Infinity) continue;
      p.outAt = Infinity;
      if (p.state.mode === MODE_DEAD) p.respawnAt = this.time;
    }
  }

  /**
   * Back to the lobby ('waiting'): no match running, nothing counts, and the map is whole again.
   * Whatever match was running is dropped without results.
   */
  toLobby(): void {
    this.phase = 'waiting';
    this.world.setCollapse(null);
    this.world.setTime(this.time);
    this.freeTheOut();
    this.resetMatchState();
    this.pendingEnd = false;
    this.sdRound = 0;
    this.sdIntermission = false;
    this.sdMatchOver = false;
    this.sdEndAt = Infinity;
    this.onPhaseChange?.();
  }

  /** Scores, stats and per-match mode state back to zero (a new match, or the lobby). */
  private resetMatchState(): void {
    this.crownId = -1;
    this.finalAnnounced = false;
    this.firstKo = false;
    this.teamScores = [0, 0];
    this.ballGame?.reset();
    this.pumpGame?.reset();
    for (const p of this.players.values()) {
      p.score = 0;
      p.stats = newStats();
      p.streak = 0;
      p.nemesis = -1;
      p.koTimes = [];
      p.roundWins = 0;
      p.roundBase = { kos: 0, hits: 0 };
    }
  }

  startMatch(): void {
    this.phase = 'playing';
    this.matchNumber++;
    this.matchStartedAt = this.time;
    this.phaseEndsAt = this.time + this.durationSec;
    this.world.setCollapse(collapsePlan(this.mode, this.map, this.phaseEndsAt, this.durationSec));
    this.shrinkNext = 0;
    this.world.setTime(this.time);
    this.chaosCurrent = null;
    this.chaosNext = null;
    this.lastChaosKind = null;
    this.scheduleChaos(true);
    this.bestReplay = null;
    this.replayPostRoll = 0;
    this.pendingEnd = false;
    this.resetMatchState();
    // Team modes: teams are evened out as the match starts (people may have joined in the lobby).
    this.balanceTeams();
    for (const p of this.players.values()) p.state.ult = 0;
    if (this.suddenDeath) {
      this.sdRound = 0;
      this.startRound();
    } else {
      for (const p of this.players.values()) {
        p.savedInflation = -1;
        p.outAt = Infinity;
        this.respawn(p);
      }
      this.projectiles.length = 0;
      this.ults.reset();
      this.resetEntities();
    }
    this.onPhaseChange?.();
  }

  private stepMatch(): void {
    if (this.phase === 'playing' && this.suddenDeath) {
      // Sudden Death runs rounds: the clock running out decides a round, not the match.
      if (!this.sdIntermission && this.time >= this.phaseEndsAt) this.decideRound(true);
      if (this.sdIntermission && this.time >= this.sdEndAt) {
        if (this.sdMatchOver) this.endMatch();
        else {
          this.startRound();
          this.onPhaseChange?.();
        }
      }
    } else if (this.phase === 'playing' && (this.time >= this.phaseEndsAt || this.pendingEnd)) {
      this.pendingEnd = false;
      this.endMatch();
    } else if (this.phase === 'results' && this.time >= this.phaseEndsAt && !this.fixedLineup) {
      // Public rooms roll straight into the next match; private rooms go back to the lobby.
      if (this.autoStart && this.players.size >= 2) {
        this.world.setCollapse(null);
        this.startMatch();
      } else this.toLobby();
    }
  }

  /** Announces each stage of the map shrinking a few seconds before it starts. */
  private updateShrink(): void {
    if (this.phase !== 'playing') return;
    const plan = this.world.plan;
    while (this.shrinkNext < plan.length) {
      const st = plan[this.shrinkNext];
      if (this.time < st.at - st.warn) break;
      this.shrinkNext++;
      if (st.announce) this.events.push({ t: 'shrink', tick: this.tick, startTick: Math.round(st.at / this.dt), sink: [...st.sink], deck: st.deck });
    }
  }

  /** True while a shrink is being announced or has just started (random events wait for it). */
  private shrinkBusy(lead: number): boolean {
    for (const st of this.world.plan) {
      if (st.announce && this.time >= st.at - st.warn - lead && this.time < st.at + 8) return true;
    }
    return false;
  }

  /** Moves the end of the running match (debug), keeping the collapse schedule in step with it. */
  endIn(seconds: number): void {
    if (this.phase !== 'playing') return;
    this.phaseEndsAt = this.time + seconds;
    this.world.setCollapse(collapsePlan(this.mode, this.map, this.phaseEndsAt, this.durationSec));
    const plan = this.world.plan;
    this.shrinkNext = 0;
    while (this.shrinkNext < plan.length && plan[this.shrinkNext].at <= this.time) this.shrinkNext++;
  }

  endMatch(): void {
    const sd = this.suddenDeath;
    // Sudden Death: most round wins, then most knockouts, fewest times popped, most hits.
    const sdOrder = (a: SimPlayer, b: SimPlayer) => b.roundWins - a.roundWins || b.stats.kos - a.stats.kos || a.stats.deaths - b.stats.deaths || b.stats.hits - a.stats.hits || a.id - b.id;
    const standings = [...this.players.values()]
      .sort((a, b) => (sd ? sdOrder(a, b) : b.score - a.score || b.stats.kos - a.stats.kos || a.stats.deaths - b.stats.deaths))
      .map((p) => ({ id: p.id, name: p.name, score: p.score, stats: { ...p.stats }, isBot: p.isBot, ...(sd ? { roundWins: p.roundWins } : {}) }));
    let longest: MatchResult['longestLaunch'] = null;
    for (const s of standings) {
      if (s.stats.longestLaunch > 0 && (!longest || s.stats.longestLaunch > longest.distance)) longest = { id: s.id, distance: s.stats.longestLaunch };
    }
    const awards: MatchAward[] = [];
    const best = (key: MatchAward['key'], f: (s: MatchStats) => number) => {
      let top: MatchAward | null = null;
      for (const s of standings) {
        const v = f(s.stats);
        if (v > 0 && (!top || v > top.value)) top = { key, id: s.id, value: v };
      }
      if (top) awards.push(top);
    };
    if (longest) awards.push({ key: 'longestLaunch', id: longest.id, value: Math.round(longest.distance * 10) / 10 });
    best('mostKos', (s) => s.kos);
    best('mostChain', (s) => s.chainKos);
    best('bestCombo', (s) => (s.bestCombo >= 2 ? s.bestCombo : 0));
    best('mostPopped', (s) => s.timesPopped);
    let teams: MatchResult['teams'] = null;
    if (this.teams) {
      const scores: [number, number] = this.pumpGame ? [Math.round(this.pumpGame.fill[0] * 100), Math.round(this.pumpGame.fill[1] * 100)] : [...this.teamScores];
      teams = { scores, winner: scores[0] > scores[1] ? 0 : scores[1] > scores[0] ? 1 : -1 };
    }
    const winnerId = teams ? (standings.find((s) => this.players.get(s.id)?.team === teams!.winner)?.id ?? -1) : (standings[0]?.id ?? -1);
    this.lastResult = { winnerId, mode: this.mode, teams, standings, longestLaunch: longest, awards, replay: this.bestReplay };
    if (sd) this.lastResult.rounds = { target: BALANCE.modes.suddenDeath.roundsToWin, played: this.sdRound };
    this.phase = 'results';
    this.sdIntermission = false;
    this.sdEndAt = Infinity;
    this.phaseEndsAt = this.time + (sd ? BALANCE.modes.suddenDeath.resultsSec : BALANCE.match.resultsSec);
    this.onPhaseChange?.();
  }

  timeLeft(): number {
    if (this.phase === 'waiting') return this.durationSec;
    return Math.max(0, this.phaseEndsAt - this.time);
  }

  drainEvents(): GameEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }
}

// --- Geometry helpers ------------------------------------------------------------------------

/** Descending comparison that copes with infinities (Infinity - Infinity is NaN). */
function order(a: number, b: number): number {
  return a === b ? 0 : a > b ? -1 : 1;
}

export interface CapsuleHit {
  x: number;
  y: number;
  z: number;
}

/** Sphere vs. the player's vertical capsule. Returns the impact point on the body surface. */
export function capsuleSphere(s: PlayerState, x: number, y: number, z: number, r: number, rScale = 1, hScale = 1): CapsuleHit | null {
  const pr = playerRadius(s) * rScale;
  const h = playerHeight(s) * hScale;
  const ay = Math.max(s.py + pr, Math.min(s.py + h - pr, y));
  const dx = x - s.px;
  const dy = y - ay;
  const dz = z - s.pz;
  const d = Math.hypot(dx, dy, dz);
  if (d > pr + r) return null;
  if (d < 1e-5) return { x: s.px, y: ay, z: s.pz };
  return { x: s.px + (dx / d) * pr, y: ay + (dy / d) * pr, z: s.pz + (dz / d) * pr };
}

/** Distance along a ray to a player's capsule (with the given radius, height scaled by hScale), or null if it misses. */
export function rayCapsule(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, s: PlayerState, r: number, hScale = 1): number | null {
  const h = playerHeight(s) * hScale;
  const y0 = s.py + r;
  const y1 = Math.max(y0, s.py + h - r);
  // Closest approach between the ray and the capsule's vertical axis: refine twice.
  let ay = Math.max(y0, Math.min(y1, oy));
  let t = 0;
  for (let i = 0; i < 3; i++) {
    t = Math.max(0, (s.px - ox) * dx + (ay - oy) * dy + (s.pz - oz) * dz);
    ay = Math.max(y0, Math.min(y1, oy + dy * t));
  }
  const cx = ox + dx * t - s.px;
  const cy = oy + dy * t - ay;
  const cz = oz + dz * t - s.pz;
  const d2 = cx * cx + cy * cy + cz * cz;
  if (d2 > r * r) return null;
  // Step back to the surface.
  return Math.max(0, t - Math.sqrt(r * r - d2));
}
