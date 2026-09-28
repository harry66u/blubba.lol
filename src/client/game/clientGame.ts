import * as THREE from 'three';
import { BALANCE } from '../../shared/balance';
import { PLAYER_COLORS, TEAM_COLORS } from '../../shared/colors';
import { MODE_INFO, type ModeId, isTeamMode } from '../../shared/game/modes';
import { type Cosmetics, type ProgressReport, QUICK_CHAT, cosmeticKey } from '../../shared/economy';
import type { GameEvent } from '../../shared/game/events';
import { type InputFrame, emptyInput, quantizeInput } from '../../shared/input';
import { getMap } from '../../shared/maps';
import type { MapDef } from '../../shared/maps/types';
import {
  ALL_FEATURES,
  MODE_DEAD,
  MODE_HANG,
  MODE_HELD,
  type PlayerState,
  StepResult,
  type StepContext,
  createPlayerState,
  copyPlayerState,
  eyeHeight,
  inflationScale,
  lookDir,
  playerHeight,
  playerRadius,
  stepPlayer,
} from '../../shared/player';
import {
  FLAG_BRACING,
  FLAG_CHARGING,
  FLAG_CROWN,
  FLAG_DASHING,
  FLAG_DOUBLED,
  FLAG_GROUND,
  FLAG_LAUNCHED,
  FLAG_PIN,
  FLAG_POWERED,
  FLAG_PROTECTED,
  FLAG_STREAM,
  type ModeState,
  type PublicPlayer,
  type RoomInfo,
  type RosterEntry,
  type ServerMessage,
  type Snapshot,
} from '../../shared/protocol';
import { type MatchPhase, type MatchResult, rayCapsule } from '../../shared/game/sim';
import { World } from '../../shared/world';
import { DEFAULT_LOADOUT, type Loadout, UTILITY_INFO, WEAPON_IDS, WEAPON_INFO, type WeaponStats, computeWeaponStats, sanitizeLoadout } from '../../shared/loadout';
import { EntityView } from '../render/entities';
import { CHAOS_INFO, type ChaosEvent, type Environment, NORMAL_ENV, envAt } from '../../shared/game/chaos';
import { Announcer } from '../audio/announcer';
import { ReplayView } from './replayView';
import type { ReplayData } from '../../shared/game/sim';
import type { Audio } from '../audio/audio';
import { type Action, type InputManager, codeLabel } from '../input/input';
import type { Connection } from '../net/connection';
import { Effects, LandingCircles, type Projectile3D } from '../render/effects';
import { MapView } from '../render/mapView';
import { BeachBall } from '../render/beachBall';
import type { Renderer } from '../render/renderer';
import { type Look, TubeMan, defaultPose, type TubeManPose } from '../render/tubeMan';
import { ViewModel } from '../render/viewModel';
import { type Settings, saveSettings } from '../settings';
import { esc, hexColor } from '../ui/dom';
import type { Hud, Nametag } from '../ui/hud';
import type { TeamView } from '../ui/menus';
import { CHASE, aimFromCamera, chaseCamera, rebaseMove } from './chaseCam';
import { ServerClock } from './clock';
import { TipCoach } from '../ui/tips';
import { TOUCH_LABELS, type TouchControls } from '../input/touch';

interface HistoryEntry {
  seq: number;
  tick: number;
  input: InputFrame;
}

interface SnapEntry {
  tick: number;
  players: Map<number, PublicPlayer>;
  mode: ModeState | null;
}

interface RemoteView {
  id: number;
  man: TubeMan;
  pose: TubeManPose;
  tag: Nametag;
  color: number;
  name: string;
  bot: boolean;
  cur: PublicPlayer | null;
  lastTagText: string;
  lookKey: string;
}

const UTIL_ICONS: Record<string, string> = { 'Bounce Pad': '🟣', 'Air Grenade': '💥', 'Inflatable Wall': '🧱', 'Vacuum Grenade': '🌀' };

function lookOf(cos: Partial<Cosmetics> | undefined): Look {
  return { pattern: cosmeticKey(cos, 'pattern'), face: cosmeticKey(cos, 'face'), hat: cosmeticKey(cos, 'hat'), finish: cosmeticKey(cos, 'finish') };
}

const TAUNT_TEXT: Record<string, string> = { burp: 'BUURRP!', wave: 'HI!', spin: 'WHEEE!', noodle: 'NOODLE!', flex: 'FLEX!' };
/** Visual versions of every sound pack (the game is fully playable muted). */
const PACK_TEXT: Record<string, string> = { boing: 'BOING!', kazoo: 'BZZ-BZZ!', duck: 'QUACK!', slide: 'WHOOEEE!', trumpet: 'TA-DAA!' };

interface RemoteShot {
  id: number;
  g: number;
  tick: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  p3: Projectile3D;
}

interface LocalShot {
  p3: Projectile3D;
  serverId: number;
  life: number;
  exploded: boolean;
  boomAt: THREE.Vector3 | null;
}

export interface MatchInfo {
  phase: MatchPhase;
  endsAtTick: number;
  number: number;
  result: MatchResult | null;
}

const DT = 1 / BALANCE.tickRate;
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const tmpV3 = new THREE.Vector3();
const UP_ONE = new THREE.Vector3(0, 1, 0);
const tmpDir = { x: 0, y: 0, z: 0 };

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/**
 * Client-side match controller: predicts the local player, interpolates everyone else, turns
 * server events into effects and sounds, and drives the HUD.
 */
export class ClientGame {
  youId = -1;
  room: RoomInfo | null = null;
  map: MapDef;
  world: World;
  mapView: MapView;
  readonly effects = new Effects();
  readonly circles = new LandingCircles();
  readonly viewModel = new ViewModel(0xff3b5c);
  readonly entities = new EntityView();
  loadout: Loadout = { ...DEFAULT_LOADOUT };
  weapon: WeaponStats = computeWeaponStats('airCannon', []);
  private streamStrength = 0;
  readonly announcer = new Announcer();
  readonly replay: ReplayView;
  /** Random events we know about (current and announced), for prediction and visuals. */
  private chaos: ChaosEvent[] = [];
  private readonly envTmp: Environment = { ...NORMAL_ENV };
  crownId = -1;
  /** Latest per-mode state from the server (team scores, ball, pumps). */
  modeState: ModeState | null = null;
  private ball: BeachBall | null = null;
  /** Whoever last knocked you out. */
  nemesisId = -1;
  private debrisTimer = 0;
  private lastChaosShown: ChaosEvent | null = null;
  readonly clock = new ServerClock();
  pred: PlayerState = createPlayerState();
  private havePred = false;
  private prevX = 0;
  private prevY = 0;
  private prevZ = 0;
  private errX = 0;
  private errY = 0;
  private errZ = 0;
  private history: HistoryEntry[] = [];
  private seq = 0;
  private stepAcc = 0;
  private readonly stepOut = new StepResult();
  private readonly replayOut = new StepResult();
  private ctx: StepContext;
  roster = new Map<number, RosterEntry>();
  private remotes = new Map<number, RemoteView>();
  private snaps: SnapEntry[] = [];
  private pending: GameEvent[] = [];
  private remoteShots = new Map<number, RemoteShot>();
  private localShots = new Map<number, LocalShot>();
  private localByServer = new Map<number, number>();
  match: MatchInfo = { phase: 'waiting', endsAtTick: 0, number: 0, result: null };
  active = false;
  private renderTick = 0;
  private trauma = 0;
  private lastChainCallout = -99;
  private fovKick = 0;
  /** View punch: the camera kicks up when you fire and springs back (visual only, aim is unchanged). */
  private punch = 0;
  private punchV = 0;
  private deathAt = 0;
  private killerId = -1;
  private deathPos = new THREE.Vector3();
  private time = 0;
  private lastCharge = 0;
  private lastAmmo = 0;
  private attractAngle = 0;
  private pendingSend: InputFrame[] = [];
  private launchTips = 0;
  private wasLaunched = false;
  /** Your own character, drawn when the third-person camera is on. */
  private selfMan: TubeMan | null = null;
  private readonly selfPose = defaultPose();
  private selfLookKey = '';
  /** Where the camera sat last frame: third-person shots aim along its center ray. */
  private readonly camPos = new THREE.Vector3();
  /** Current chase-camera distance (pulls in instantly on walls, eases back out). */
  private camDist = 0;
  /** camPos follows you (false while spectating, until the first frame after respawning). */
  private camLive = false;
  private readonly aimOut = { yaw: 0, pitch: 0 };
  /** On-screen controls on phones and tablets (null elsewhere). */
  touch: TouchControls | null = null;
  /** First-use tooltips for the less obvious controls. */
  private readonly tips = new TipCoach((t, done) => this.hud.showTip(t, done));
  onMatchChange: ((m: MatchInfo) => void) | null = null;
  onRosterChange: (() => void) | null = null;
  onRoomChange: ((room: RoomInfo) => void) | null = null;
  onKicked: ((message: string) => void) | null = null;
  /** Rewards after a match (XP, coins, unlocks, rating). */
  onProgress: ((report: ProgressReport) => void) | null = null;
  onRenamed: ((name: string, message: string) => void) | null = null;
  lastProgress: ProgressReport | null = null;
  /** Players whose quick chat you've hidden (this session). */
  readonly muted = new Set<number>();
  showChat = true;

  constructor(
    readonly r: Renderer,
    readonly audio: Audio,
    readonly hud: Hud,
    readonly input: InputManager,
    readonly net: Connection,
    readonly settings: Settings,
  ) {
    this.map = getMap('dealership');
    this.world = new World(this.map);
    this.mapView = new MapView(this.map, this.world);
    this.ctx = this.makeCtx({ ...ALL_FEATURES });
    r.scene.add(this.mapView.root, this.effects.root, this.circles.root, this.entities.root);
    r.scene.add(r.camera);
    r.camera.add(this.viewModel.root);
    this.replay = new ReplayView(r.scene, this.effects);
    this.viewModel.root.visible = false;
    r.setTheme(this.map.theme);
    input.onAnyPress = (a) => this.tips.used(a);
    this.effects.camPos = r.camera.position;
  }

  private makeCtx(features: StepContext['features']): StepContext {
    return { world: this.world, dt: DT, weapon: this.weapon, features };
  }

  /** Your chosen loadout. The server applies changes when you next respawn. */
  setLoadout(l: Loadout, send: boolean): void {
    this.loadout = sanitizeLoadout(l);
    if (send && this.active) this.net.send({ type: 'loadout', loadout: this.loadout });
    if (!this.active) this.applyWeapon(this.loadout);
  }

  private applyWeapon(l: Loadout): void {
    this.weapon = computeWeaponStats(l.weapon, l.mods);
    this.ctx.weapon = this.weapon;
    this.viewModel.setWeapon(l.weapon);
    this.hud.setUtilities(l.utils.map((u) => UTILITY_INFO[u].name));
  }

  private setMap(id: string): void {
    if (this.map.id === id && this.mapView) return;
    this.r.scene.remove(this.mapView.root);
    this.mapView.dispose();
    this.map = getMap(id);
    this.world = new World(this.map);
    this.mapView = new MapView(this.map, this.world);
    this.r.scene.add(this.mapView.root);
    this.r.setTheme(this.map.theme);
    this.ctx = this.makeCtx(this.ctx.features);
    this.entities.clear();
    this.setupModeProps();
  }

  private setupModeProps(): void {
    if (this.ball) {
      this.r.scene.remove(this.ball.root);
      this.ball.dispose();
      this.ball = null;
    }
    if (this.map.ball) {
      this.ball = new BeachBall(this.map.ball.radius);
      this.ball.update(this.map.ball.spawn[0], this.map.ball.spawn[1], this.map.ball.spawn[2], 0, 0, true, 0, 1);
      this.r.scene.add(this.ball.root);
    }
    this.mapView.setTeamColors(this.teamColors);
    this.modeState = null;
  }

  get mode(): ModeId {
    return this.room?.settings.mode ?? 'knockout';
  }

  get teamMode(): boolean {
    return isTeamMode(this.mode);
  }

  /** Red/blue, or orange/blue with the colorblind-friendly option. */
  get teamColors(): number[] {
    return this.settings.colorblindTeams ? TEAM_COLORS.colorblind : TEAM_COLORS.standard;
  }

  teamOf(id: number): number {
    return this.roster.get(id)?.team ?? -1;
  }

  /** A teammate (shots pass through them; no aim assist or stomp hints). */
  isAlly(id: number): boolean {
    if (!this.teamMode || id === this.youId) return false;
    const t = this.teamOf(id);
    return t >= 0 && t === this.teamOf(this.youId);
  }

  /** Re-applies team colors after the colorblind setting changes. */
  refreshTeamColors(): void {
    this.mapView.setTeamColors(this.teamColors);
    for (const rv of this.remotes.values()) rv.color = -1; // forces a recolor on the next frame
    this.viewModel.setColor(this.colorOf(this.youId));
  }

  // --- Lifecycle ---------------------------------------------------------------------------

  enter(msg: Extract<ServerMessage, { type: 'welcome' }>): void {
    this.youId = msg.you;
    this.room = msg.room;
    this.setMap(msg.room.mapId);
    this.setupModeProps();
    this.applyWeapon(this.loadout);
    this.ctx = this.makeCtx(msg.room.features);
    this.hud.showAbilities(msg.room.features);
    this.entities.clear();
    for (let i = this.world.staticCount; i < this.world.solids.length; i++) this.world.setSolidAt(i, null);
    this.clock.reset();
    this.clock.observe(msg.tick, performance.now());
    this.havePred = false;
    this.history.length = 0;
    this.snaps.length = 0;
    this.pending.length = 0;
    this.seq = 0;
    this.pred = createPlayerState();
    this.pred.mode = MODE_DEAD;
    this.input.syncCounters({ jump: 0, dash: 0, brace: 0, grab: 0, grapple: 0, reload: 0, util1: 0, util2: 0, taunt: 0 });
    this.active = true;
    this.viewModel.root.visible = true;
    this.hud.show(true);
  }

  leave(): void {
    this.active = false;
    this.youId = -1;
    this.room = null;
    for (const r of this.remotes.values()) this.removeRemote(r);
    this.remotes.clear();
    for (const s of this.remoteShots.values()) this.effects.removeProjectile(s.p3.id);
    this.remoteShots.clear();
    for (const [k] of this.localShots) this.effects.removeProjectile(k);
    this.localShots.clear();
    this.roster.clear();
    this.modeState = null;
    this.hud.setTeamBar(null);
    this.viewModel.root.visible = false;
    if (this.selfMan) {
      this.r.scene.remove(this.selfMan.group);
      this.selfMan.dispose();
      this.selfMan = null;
    }
    this.camLive = false;
    this.hud.show(false);
    this.audio.setCharge(0);
    this.audio.setBlower(0);
    this.entities.clear();
  }

  // --- Network -----------------------------------------------------------------------------

  onMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case 'roster': {
        const next = new Map<number, RosterEntry>();
        for (const p of msg.players) next.set(p.id, p);
        this.roster = next;
        for (const [id, rv] of this.remotes) {
          if (!next.has(id)) {
            this.removeRemote(rv);
            this.remotes.delete(id);
          }
        }
        if (next.has(this.youId)) {
          this.viewModel.setColor(this.colorOf(this.youId));
          this.viewModel.setFinish(cosmeticKey(next.get(this.youId)!.cos, 'finish'));
        }
        this.onRosterChange?.();
        break;
      }
      case 'match':
        if (msg.number !== this.match.number) {
          this.chaos = [];
          this.crownId = -1;
          this.nemesisId = -1;
        }
        this.match = { phase: msg.phase, endsAtTick: msg.endsAtTick, number: msg.number, result: msg.result };
        this.world.collapseStart = msg.phase === 'playing' ? msg.endsAtTick * DT - BALANCE.final.seconds : Infinity;
        if (msg.phase === 'playing') this.announcer.say('Go!', 2);
        if (msg.phase === 'results' && msg.result) {
          const teams = msg.result.teams;
          if (teams) {
            const mine = this.teamOf(this.youId);
            const names = this.teamNames();
            this.announcer.say(teams.winner < 0 ? "It's a draw!" : teams.winner === mine ? 'Your team wins!' : `${names[teams.winner]} team wins!`, 3);
          } else {
            const w = msg.result.standings[0];
            this.announcer.say(w ? `Time's up! ${w.id === this.youId ? 'You win!' : `${w.name} wins!`}` : "Time's up!", 3);
          }
        }
        this.onMatchChange?.(this.match);
        break;
      case 'room': {
        const modeChanged = msg.room.settings.mode !== this.room?.settings.mode;
        this.room = msg.room;
        if (msg.room.mapId !== this.map.id) this.setMap(msg.room.mapId);
        else if (modeChanged) this.setupModeProps();
        this.ctx = this.makeCtx(msg.room.features);
        this.onRoomChange?.(msg.room);
        break;
      }
      case 'ev':
        this.onEvents(msg.list);
        break;
      case 'entities':
        for (const k of msg.pickups) this.entities.setPickup(k.id, k.kind, k.x, k.y, k.z, k.active);
        for (const d of msg.solids) {
          this.world.setSolidAt(d.id, { min: d.min, max: d.max, ledge: true });
          this.entities.addSolid(d.id, d.min, d.max, d.raft);
        }
        for (const p of msg.pads) {
          this.world.addPad({ x: p.x, y: p.y, z: p.z, half: p.half, strength: p.strength, owner: 0, expires: Infinity }, p.id);
          this.entities.addPad(p.id, p.x, p.y, p.z, p.half);
        }
        this.chaos = msg.chaos.filter((c): c is ChaosEvent => !!c);
        this.crownId = msg.crownId;
        break;
      case 'error':
        if (msg.code === 'kicked') this.onKicked?.(msg.message);
        break;
      case 'chat':
        this.showChatMessage(msg.from, msg.id);
        break;
      case 'progress':
        this.lastProgress = msg.report;
        this.onProgress?.(msg.report);
        break;
      case 'renamed':
        this.onRenamed?.(msg.name, msg.message);
        break;
      default:
        break;
    }
  }

  onSnapshot(snap: Snapshot): void {
    if (!this.active) return;
    const now = performance.now();
    this.clock.observe(snap.tick, now);
    const players = new Map<number, PublicPlayer>();
    for (const p of snap.players) players.set(p.id, p);
    this.snaps.push({ tick: snap.tick, players, mode: snap.mode });
    this.modeState = snap.mode;
    while (this.snaps.length > 2 && this.snaps[1].tick < this.renderTick - 30) this.snaps.shift();
    if (this.snaps.length > 90) this.snaps.shift();

    if (snap.self) this.reconcile(snap);
  }

  private reconcile(snap: Snapshot): void {
    const oldX = this.pred.px;
    const oldY = this.pred.py;
    const oldZ = this.pred.pz;
    const wasDead = this.pred.mode === MODE_DEAD;
    copyPlayerState(this.pred, snap.self!);
    while (this.history.length && this.history[0].seq <= snap.ackSeq) this.history.shift();
    for (const h of this.history) {
      this.world.setTime(h.tick * DT);
      this.ctx.env = envAt(this.chaos, h.tick, this.envTmp);
      stepPlayer(this.pred, h.input, this.ctx, this.replayOut);
    }
    this.world.setTime(this.predTick() * DT);
    if (!this.havePred || (wasDead && this.pred.mode !== MODE_DEAD)) {
      this.havePred = true;
      this.prevX = this.pred.px;
      this.prevY = this.pred.py;
      this.prevZ = this.pred.pz;
      this.errX = this.errY = this.errZ = 0;
      if (!wasDead || this.pred.mode !== MODE_DEAD) {
        this.input.yaw = this.pred.yaw;
        this.input.pitch = 0;
      }
      return;
    }
    const dx = this.pred.px - oldX;
    const dy = this.pred.py - oldY;
    const dz = this.pred.pz - oldZ;
    if (Math.hypot(dx, dy, dz) > 4) {
      // Teleport (respawn or huge correction): snap.
      this.prevX = this.pred.px;
      this.prevY = this.pred.py;
      this.prevZ = this.pred.pz;
      this.errX = this.errY = this.errZ = 0;
    } else {
      // Keep what's on screen continuous and ease the correction in.
      this.prevX += dx;
      this.prevY += dy;
      this.prevZ += dz;
      this.errX -= dx;
      this.errY -= dy;
      this.errZ -= dz;
    }
  }

  private predTick(): number {
    const now = performance.now();
    return Math.round(this.clock.tickAt(now) + (this.net.rtt / 1000) * BALANCE.tickRate + 1);
  }

  // --- Events ------------------------------------------------------------------------------

  private onEvents(list: GameEvent[]): void {
    for (const e of list) {
      // Your own hits are confirmed the moment the server says so; the burst on the target still
      // plays where you see them.
      if (e.t === 'hit' && e.attacker === this.youId && e.target !== this.youId) this.confirmHit(e);
      if (this.isImmediate(e)) this.handleEvent(e, true);
      else this.pending.push(e);
    }
  }

  private isImmediate(e: GameEvent): boolean {
    const you = this.youId;
    switch (e.t) {
      case 'shot':
        return e.owner === you && e.w === 0;
      case 'boom':
      case 'fizzle':
        return this.localByServer.has(e.id);
      case 'loadout':
      case 'honk':
      case 'tracer':
        return e.id === you;
      case 'chaos':
      case 'crown':
      case 'final':
      case 'solid':
      case 'solidGone':
      case 'pad':
      case 'padGone':
        // The world must match the server for prediction, so these apply right away.
        return true;
      case 'pickup':
        return e.by === you;
      case 'streak':
        return e.id === you;
      case 'pop':
        return e.id === you || e.target === you;
      case 'hit':
        return e.target === you;
      case 'ko':
        return e.victim === you || e.killer === you;
      case 'chain':
        return e.id === you || e.target === you;
      case 'spawn':
        return e.id === you;
      case 'move':
      case 'brace':
      case 'taunt':
      case 'reload':
      case 'blastjump':
        return e.id === you;
      case 'shield':
        return e.target === you;
      case 'grab':
      case 'throw':
      case 'stomp':
        return e.id === you || e.target === you;
      case 'escape':
        return e.id === you || e.from === you;
      case 'escapeFail':
      case 'grapple':
        return e.id === you;
      default:
        return false;
    }
  }

  private posOf(id: number): THREE.Vector3 | null {
    if (id === this.youId) return tmpV2.set(this.pred.px, this.pred.py, this.pred.pz);
    const rv = this.remotes.get(id);
    if (rv?.cur) return tmpV2.set(rv.cur.px, rv.cur.py, rv.cur.pz);
    return null;
  }

  private nameOf(id: number): string {
    return this.roster.get(id)?.name ?? '???';
  }

  private colorOf(id: number): number {
    const entry = this.roster.get(id);
    if (this.teamMode && entry && entry.team >= 0) return this.teamColors[entry.team];
    return PLAYER_COLORS[entry?.color ?? 0]?.hex ?? 0xffffff;
  }

  /** Team info for the scoreboard and results (null outside team modes). */
  teamView(): TeamView | null {
    if (!this.teamMode) return null;
    const ms = this.modeState;
    const pump = !!ms?.pump;
    return {
      colors: this.teamColors,
      names: this.teamNames(),
      scores: pump ? ms!.pump!.fill : (ms?.teamScores ?? [0, 0]),
      youTeam: this.teamOf(this.youId),
      percent: pump,
    };
  }

  /** Shows a quick-chat message as a speech bubble and in the chat feed. */
  private showChatMessage(from: number, id: number): void {
    const text = QUICK_CHAT[id];
    if (!text || !this.showChat || this.muted.has(from)) return;
    const entry = this.roster.get(from);
    if (!entry) return;
    this.hud.chatLine(entry.name, hexColor(this.colorOf(from)), text);
    const rv = this.remotes.get(from);
    if (rv?.cur && rv.cur.mode !== MODE_DEAD) this.hud.bubble(tmpV.set(rv.cur.px, rv.cur.py + rv.man.headHeight(rv.cur.inflation) + 1.1, rv.cur.pz), text);
    this.audio.uiClick();
  }

  /** Sends a quick-chat preset. */
  sendChat(slot: number): void {
    if (!this.active || slot < 0 || slot >= QUICK_CHAT.length) return;
    this.net.send({ type: 'chat', id: slot });
  }

  teamNames(): string[] {
    return this.settings.colorblindTeams ? ['ORANGE', 'BLUE'] : ['RED', 'BLUE'];
  }

  private teamHex(team: number): string {
    return `#${(this.teamColors[team] ?? 0xffffff).toString(16).padStart(6, '0')}`;
  }

  private handleEvent(e: GameEvent, immediate: boolean): void {
    const you = this.youId;
    const a = this.audio;
    const fx = this.effects;
    switch (e.t) {
      case 'shot': {
        if (e.owner === you && e.w === 0) {
          // Link the server's projectile to the one we already drew.
          const local = e.cs !== undefined ? this.localShots.get(-e.cs) : undefined;
          if (local) {
            local.serverId = e.id;
            this.localByServer.set(e.id, -e.cs!);
          } else {
            const key = -100000 - e.id;
            const p3 = fx.addProjectile(key, e.x, e.y, e.z, e.vx, e.vy, e.vz, e.r);
            this.localShots.set(key, { p3, serverId: e.id, life: this.weapon.projLifetime, exploded: false, boomAt: null });
            this.localByServer.set(e.id, key);
          }
        } else {
          const p3 = fx.addProjectile(e.id, e.x, e.y, e.z, e.vx, e.vy, e.vz, e.r, undefined, e.w);
          this.remoteShots.set(e.id, { id: e.id, g: e.g ?? 0, tick: e.tick, x: e.x, y: e.y, z: e.z, vx: e.vx, vy: e.vy, vz: e.vz, p3 });
          if (e.w === 0) {
            a.shoot(e.power, [e.x, e.y, e.z]);
            const sp = Math.hypot(e.vx, e.vy, e.vz) || 1;
            fx.muzzleFlash(e.x, e.y, e.z, e.vx / sp, e.vy / sp, e.vz / sp, e.power);
          } else a.whoosh(0.3, e.owner === you ? null : [e.x, e.y, e.z]);
          const rv = this.remotes.get(e.owner);
          if (rv) rv.man.group.userData.kick = 1;
        }
        break;
      }
      case 'boom': {
        const localKey = this.localByServer.get(e.id);
        if (localKey !== undefined) {
          const ls = this.localShots.get(localKey);
          this.localByServer.delete(e.id);
          if (ls) {
            const shownFar = ls.boomAt && ls.boomAt.distanceTo(tmpV.set(e.x, e.y, e.z)) > 3;
            if (!ls.exploded || shownFar) this.showBlast(e.x, e.y, e.z, e.r, e.power);
            fx.removeProjectile(localKey);
            this.localShots.delete(localKey);
          }
        } else {
          const rs = this.remoteShots.get(e.id);
          if (rs) {
            fx.removeProjectile(e.id);
            this.remoteShots.delete(e.id);
          }
          this.showBlast(e.x, e.y, e.z, e.r, e.power);
          if (e.k) {
            fx.confettiBurst(e.x, e.y, e.z, 25, [0x2ec5ff, 0xffffff, 0x9fe8ff]);
            this.hud.popup(tmpV.set(e.x, e.y + 1.5, e.z), 'KA-WHOOSH!', '#2ec5ff', 1.2, 1, e.owner !== you);
          }
        }
        break;
      }
      case 'proj': {
        const rs = this.remoteShots.get(e.id);
        if (rs) {
          Object.assign(rs, { tick: e.tick, x: e.x, y: e.y, z: e.z, vx: e.vx, vy: e.vy, vz: e.vz });
          a.thud([e.x, e.y, e.z], 3);
        }
        break;
      }
      case 'honk': {
        if (e.id !== you) {
          fx.honkBlast(e.x, e.y, e.z, e.dx, e.dy, e.dz, e.range, e.cone, e.power, this.r.camera.position);
          fx.muzzleFlash(e.x, e.y, e.z, e.dx, e.dy, e.dz, e.power);
          a.airBlast(e.power, [e.x, e.y, e.z]);
          this.hud.popup(tmpV.set(e.x + e.dx * 2, e.y + e.dy * 2 + 0.5, e.z + e.dz * 2), 'FWOOMP!', '#ffd60a', 0.8 + e.power * 0.6, 0.8, true);
        }
        break;
      }
      case 'tracer': {
        if (e.id !== you) {
          const rv = this.remotes.get(e.id);
          const from = rv?.man.muzzleWorld(new THREE.Vector3()) ?? new THREE.Vector3(e.x, e.y, e.z);
          fx.tracer(from.x, from.y, from.z, e.x2, e.y2, e.z2);
          const tl = Math.hypot(e.x2 - from.x, e.y2 - from.y, e.z2 - from.z) || 1;
          fx.muzzleFlash(from.x, from.y, from.z, (e.x2 - from.x) / tl, (e.y2 - from.y) / tl, (e.z2 - from.z) / tl, e.power * 0.7);
          a.pew(e.power, [e.x, e.y, e.z]);
        }
        break;
      }
      case 'blow': {
        const p = this.posOf(e.target);
        if (p) {
          fx.airPuff(p.x, p.y + 1, p.z, 3, 2, 0.15);
          a.gust(e.target === you ? null : [p.x, p.y, p.z]);
        }
        if (e.id === you) this.hud.hitMarker();
        break;
      }
      case 'pop': {
        a.bigPop(e.id === you || e.target === you ? null : [e.x, e.y, e.z]);
        fx.confettiBurst(e.x, e.y, e.z, 90);
        this.hud.popup(tmpV.set(e.x, e.y + 1.5, e.z), 'POP!!', '#ff2d55', 2, 1.3);
        if (e.id === you) this.hud.callout('PINNED!', 'Popped at max inflation', 1.8, '#ff2d55');
        break;
      }
      case 'vacuum':
        this.entities.addVacuum(e.x, e.y, e.z, e.until, BALANCE.utilities.vacuumGrenade.radius);
        a.suck([e.x, e.y, e.z]);
        this.hud.popup(tmpV.set(e.x, e.y + 1.5, e.z), 'SHLURP!', '#c49bff', 1.1, 1.1, true);
        if (this.remoteShots.has(e.id)) {
          fx.removeProjectile(e.id);
          this.remoteShots.delete(e.id);
        }
        break;
      case 'solid':
        this.world.setSolidAt(e.id, { min: e.min, max: e.max, ledge: true });
        this.entities.addSolid(e.id, e.min, e.max, e.raft);
        a.stretch([(e.min[0] + e.max[0]) / 2, e.min[1], (e.min[2] + e.max[2]) / 2]);
        break;
      case 'solidGone':
        this.world.setSolidAt(e.id, null);
        this.entities.removeSolid(e.id);
        break;
      case 'pad':
        this.world.addPad({ x: e.x, y: e.y, z: e.z, half: e.half, strength: e.strength, owner: 0, expires: Infinity }, e.id);
        this.entities.addPad(e.id, e.x, e.y, e.z, e.half);
        break;
      case 'padGone':
        this.world.removePad(e.id);
        this.entities.removePad(e.id);
        break;
      case 'pickup': {
        this.entities.setPickup(e.id, e.kind, e.x, e.y, e.z, e.active);
        if (!e.active && e.by >= 0) {
          const p = this.posOf(e.by);
          if (e.kind === 'soda') {
            a.canOpen(e.by === you ? null : [e.x, e.y, e.z]);
            window.setTimeout(() => a.burp(e.by === you ? null : [e.x, e.y, e.z]), 250);
            if (p) this.hud.popup(tmpV.set(p.x, p.y + 2.6, p.z), 'BUURRP!', '#b8f06a', 1.1, 1.2, e.by !== you);
            if (e.by === you) this.hud.toast('Soda! Dashes refilled.', 1500);
          } else {
            a.koConfirm();
            if (e.by === you) this.hud.callout('YOU GOT THE PIN!', 'Pop anyone at 100%!', 2.2, '#ff2d55');
            else this.hud.toast(`${this.nameOf(e.by)} grabbed the PIN! Stay under 100%!`, 3000);
          }
        } else if (e.active && e.kind === 'pin') {
          this.hud.toast('A PIN appeared! It pops anyone at 100% inflation.', 3000);
        }
        break;
      }
      case 'loadout':
        if (e.id === you) this.applyWeapon(sanitizeLoadout(e));
        break;
      case 'chaos': {
        this.chaos = this.chaos.filter((c) => c.endTick > e.tick);
        this.chaos.push({ kind: e.kind, announceTick: e.announceTick, startTick: e.startTick, endTick: e.endTick, dirX: e.dirX, dirZ: e.dirZ });
        const info = CHAOS_INFO[e.kind];
        this.hud.callout(info.title, `${info.sub} (in ${Math.round((e.startTick - e.tick) * DT)}s)`, 3, '#ff9f1c');
        a.siren();
        const lines: Record<string, string> = { fan: 'Giant fan incoming!', lowGravity: 'Low gravity!', ice: 'Ice rink!', maxInflate: 'Maximum pressure!' };
        this.announcer.say(lines[e.kind], 3);
        break;
      }
      case 'chain': {
        this.hud.popup(tmpV.set(e.x, e.y + 1, e.z), 'CHAIN!', '#ff5fd2', 1.2, 0.9);
        fx.shockwave(e.x, e.y + 0.8, e.z, 3.5, 0.35, 0xff5fd2, false, this.r.camera.position);
        // Big moment for whoever started it (and whoever got bowled over).
        if (e.by === you && e.target !== you && this.time - this.lastChainCallout > 2.5) {
          this.lastChainCallout = this.time;
          this.hud.callout('CHAIN REACTION!', `${this.nameOf(e.id)} bowled into ${this.nameOf(e.target)}. You get the credit!`, 1.8, '#ff5fd2');
          this.announcer.say('Chain reaction!', 2);
        } else if (e.target === you && this.time - this.lastChainCallout > 2.5) {
          this.lastChainCallout = this.time;
          this.hud.callout('BOWLED OVER!', `${this.nameOf(e.id)} crashed into you`, 1.4, '#ff5fd2');
        }
        a.thud(e.id === you || e.target === you ? null : [e.x, e.y, e.z], 12);
        a.squeak(0.6, e.id === you || e.target === you ? null : [e.x, e.y, e.z]);
        fx.airPuff(e.x, e.y, e.z, 8, 4, 0.2);
        if (e.target === you) this.trauma = Math.min(1, this.trauma + 0.3);
        break;
      }
      case 'crown': {
        const prev = this.crownId;
        this.crownId = e.id;
        if (e.id === you) {
          this.hud.callout('YOU HAVE THE CROWN!', `You're worth ${BALANCE.crown.multiplier}x points now. Stay on!`, 2.2, '#ffc933');
          this.announcer.say('New champion!', 2);
        } else if (e.id >= 0) {
          this.hud.toast(`👑 ${this.nameOf(e.id)} has the crown! Knock them off for ${BALANCE.crown.multiplier}x points.`, 3000);
        } else if (prev === you) {
          this.hud.toast('You lost the crown!', 2000);
        }
        break;
      }
      case 'goal': {
        const mine = this.teamOf(you);
        const names = this.teamNames();
        const scorer = e.scorer >= 0 ? this.nameOf(e.scorer) : '';
        const own = e.scorer >= 0 && this.teamOf(e.scorer) !== e.team;
        this.hud.callout(
          e.team === mine ? 'GOAL!' : 'THEY SCORED!',
          own ? `Own goal by ${scorer}! Point to ${names[e.team]}.` : scorer ? `${e.scorer === you ? 'You' : scorer} scored for ${names[e.team]}!` : `Point to ${names[e.team]}!`,
          2.6,
          this.teamHex(e.team),
        );
        fx.confettiBurst(e.x, e.y + 1, e.z, 140, [this.teamColors[e.team], 0xffffff, 0xffd60a]);
        fx.shockwave(e.x, e.y, e.z, 8, 0.6, this.teamColors[e.team]);
        a.goalHorn();
        this.announcer.say(e.team === mine ? 'Goooal!' : 'They scored!', 3);
        if (e.scorer === you && !own) this.hud.popup(tmpV.set(e.x, e.y + 2, e.z), 'GOAL!', '#ffd60a', 2, 1.5);
        break;
      }
      case 'ballOut':
        this.hud.popup(tmpV.set(e.x, Math.max(e.y, 0) + 3, e.z), 'OUT!', '#ffffff', 1.6, 1.2);
        fx.airPuff(e.x, e.y, e.z, 16, 6, 0.4);
        a.pop([e.x, e.y, e.z]);
        break;
      case 'ballReset':
        if (this.map.ball) {
          const sp = this.map.ball.spawn;
          fx.confettiBurst(sp[0], sp[1], sp[2], 30);
          a.boing([sp[0], sp[1], sp[2]], true);
        }
        break;
      case 'pumpFull': {
        const mine = this.teamOf(you);
        const names = this.teamNames();
        this.hud.callout(`${names[e.team]} GIANT IS FULL!`, e.team === mine ? 'Your team wins!' : 'Their tube man towers over you...', 3, this.teamHex(e.team));
        a.goalHorn();
        const g = this.map.giants?.find((x) => x.team === e.team);
        if (g) fx.confettiBurst(g.x, g.y + 10, g.z, 200, [this.teamColors[e.team], 0xffffff]);
        break;
      }
      case 'final':
        this.hud.callout('FINAL 30 SECONDS!', 'The map is collapsing! Knockouts count DOUBLE!', 3, '#ff3b5c');
        a.siren();
        this.announcer.say('Final thirty seconds! Knockouts count double!', 4);
        this.trauma = Math.min(1, this.trauma + 0.3);
        break;
      case 'fizzle': {
        const localKey = this.localByServer.get(e.id);
        if (localKey !== undefined) {
          fx.removeProjectile(localKey);
          this.localShots.delete(localKey);
          this.localByServer.delete(e.id);
        } else if (this.remoteShots.has(e.id)) {
          fx.removeProjectile(e.id);
          this.remoteShots.delete(e.id);
        }
        fx.airPuff(e.x, e.y, e.z, 6, 1.5, 0.3);
        break;
      }
      case 'hit': {
        const pos: [number, number, number] = [e.x, e.y, e.z];
        const mine = e.attacker === you && e.target !== you;
        a.squeak(e.infl, e.target === you ? null : pos);
        if (!mine) a.impact(e.speed, e.target === you ? null : pos);
        if (!e.braced) {
          fx.impactBurst(e.x, e.y, e.z, e.dx, e.dy, e.dz, e.speed, this.colorOf(e.target), this.r.camera.position);
          this.remotes.get(e.target)?.man.impact(e.speed, e.dx, e.dz);
          if (e.target === you) this.selfMan?.impact(e.speed, e.dx, e.dz);
        }
        if (mine) {
          // Their new inflation pops off them, greener to redder as they near bursting.
          const pct = Math.round(e.infl * 100);
          this.hud.popup(tmpV.set(e.x, e.y - 0.3, e.z), `${pct}%`, `hsl(${120 - Math.min(1, e.infl) * 120}, 95%, ${pct >= 75 ? 62 : 68}%)`, 0.8 + e.infl * 0.7, 0.9);
        }
        if (e.target === you) {
          this.trauma = Math.min(1, this.trauma + 0.35 + e.speed * 0.02);
          if (e.speed > 12 && !e.braced) this.hud.flash('rgba(255, 255, 255, 0.45)', 160);
          // Direction the hit came from relative to where we're looking.
          const ang = Math.atan2(-e.dx, -e.dz) - this.input.yaw;
          this.hud.damageFrom(-ang + Math.PI);
        }
        if (e.low) {
          a.groan(e.target === you ? null : pos);
          this.hud.popup(tmpV.set(e.x, e.y + 1.2, e.z), 'OOF!', '#ff9f1c', 1.3, 1.1);
        } else if (e.braced) {
          a.clang(e.target === you ? null : pos);
          this.hud.popup(tmpV.set(e.x, e.y + 1.2, e.z), 'BRACED!', '#9fe8ff', 1, 0.9);
          if (e.target === you) this.hud.flash('rgba(120, 220, 255, 0.55)', 350);
        } else if (e.direct && (e.attacker === you || e.target === you || e.speed > 18)) {
          this.hud.popup(tmpV.set(e.x, e.y + 1.6, e.z), e.speed > 20 ? 'WHAM!' : 'BOP!', '#ffffff', 0.7 + Math.min(0.6, e.speed * 0.02), 0.7, e.attacker !== you && e.target !== you);
        }
        break;
      }
      case 'shield':
        fx.airPuff(e.x, e.y, e.z, 8, 2, 0.25, 0x9fe8ff);
        break;
      case 'streak': {
        const title = e.kind === 'both' ? 'UNSTOPPABLE!' : e.kind === 'turbo' ? 'TURBO TANK!' : 'MEGA BLAST!';
        const p = this.posOf(e.id);
        if (p) {
          fx.shockwave(p.x, p.y + 1, p.z, 3, 0.4, 0xffb020, false, this.r.camera.position);
          for (let i = 0; i < 16; i++) fx.sparkle(p.x + (Math.random() - 0.5) * 1.6, p.y + Math.random() * 2.4, p.z + (Math.random() - 0.5) * 1.6);
        }
        if (e.id === you) {
          const sub =
            e.kind === 'turbo'
              ? `${e.n} pops in a row! Full tank, double-speed reloads for ${BALANCE.streaks.turboSeconds}s`
              : e.kind === 'mega'
                ? `${e.n} pops in a row! Your next ${BALANCE.streaks.megaShots} shots are fully charged`
                : `${e.n} pops in a row! Turbo Tank AND Mega Blast`;
          this.hud.callout(title, sub, 2.6, '#ffb020');
          this.hud.flash('rgba(255, 190, 40, 0.45)', 400);
          a.powerUp();
          this.announcer.say(e.kind === 'both' ? 'Unstoppable!' : e.kind === 'turbo' ? 'Turbo tank!' : 'Mega blast!', 3);
        } else {
          if (p) this.hud.popup(tmpV.set(p.x, p.y + 3.2, p.z), title, '#ffb020', 1, 1.3);
          const nm = this.nameOf(e.id);
          this.hud.addKill(`<b style="color:${hexColor(this.colorOf(e.id))}">${esc(nm)}</b> is on a ${e.n}-pop streak: <b>${title.replace('!', '')}</b> ⚡`, false);
        }
        break;
      }
      case 'ko': {
        const victimName = this.nameOf(e.victim);
        const killerName = e.killer >= 0 ? this.nameOf(e.killer) : '';
        const vc = hexColor(this.colorOf(e.victim));
        const kc = e.killer >= 0 ? hexColor(this.colorOf(e.killer)) : '';
        const icons: Record<string, string> = { crown: ' 👑', chain: ' ⛓️', revenge: ' ⚔️', final: ' ×2', pin: ' 📌', double: ' ✌️', triple: ' 🔥', multi: ' 🔥🔥' };
        const suffix = e.tags.map((t) => icons[t] ?? '').join('') + (e.points > 1 ? ` <b>+${e.points}</b>` : '');
        const html =
          e.killer >= 0 && e.tags.includes('sd')
            ? `<b style="color:${vc}">${esc(victimName)}</b> fell off · <b style="color:${kc}">${esc(killerName)}</b> <b>+${e.points}</b>`
            : e.killer >= 0
              ? `<b style="color:${kc}">${esc(killerName)}</b> popped <b style="color:${vc}">${esc(victimName)}</b>${suffix}`
              : `<b style="color:${vc}">${esc(victimName)}</b> fell off`;
        this.hud.addKill(html, e.killer === you || e.victim === you);
        a.squeal(e.victim === you ? null : [e.x, Math.max(e.y, -10), e.z]);
        fx.deflatingBalloon(e.x, e.y, e.z, this.colorOf(e.victim), e.vx, e.vy, e.vz);
        if (e.killer >= 0) {
          // The knocker's cosmetic knockout effect and sound, somewhere everyone can see it.
          const kc = this.roster.get(e.killer)?.cos;
          const B = this.map.blast;
          const fxX = Math.max(B.minX + 12, Math.min(B.maxX - 12, e.x));
          const fxY = Math.max(-6, Math.min(30, e.y));
          const fxZ = Math.max(B.minZ + 12, Math.min(B.maxZ - 12, e.z));
          fx.koEffect(cosmeticKey(kc, 'koFx'), fxX, fxY, fxZ);
          const pack = cosmeticKey(kc, 'sound');
          if (pack !== 'classic') {
            a.koSound(pack, e.killer === you || e.victim === you ? null : [fxX, fxY, fxZ]);
            this.hud.popup(tmpV.set(fxX, fxY + 4, fxZ), PACK_TEXT[pack] ?? '', '#ffd60a', 1.3, 1.4);
          }
        }
        this.hud.popup(tmpV.set(e.x, Math.max(e.y, -8) + 2, e.z), 'WHEEEE!', '#ffffff', 1.2, 1.4);
        if (e.victim === you) {
          this.deathAt = this.time;
          this.killerId = e.tags.includes('sd') ? -1 : e.killer;
          this.deathPos.set(e.x, Math.max(e.y, -6), e.z);
          this.audio.setCharge(0);
        }
        if (e.victim === you && e.killer >= 0) this.nemesisId = e.killer;
        if (e.killer === you && e.victim === this.nemesisId) this.nemesisId = -1;
        this.koCallout(e, killerName, victimName);
        const rv = this.remotes.get(e.victim);
        if (rv) rv.man.setVisible(false);
        break;
      }
      case 'spawn': {
        if (e.id !== you) fx.airPuff(e.x, e.y + 1, e.z, 14, 3, 0.35, 0xffffff);
        a.pop(e.id === you ? null : [e.x, e.y, e.z]);
        if (e.id === you) this.trauma = 0;
        break;
      }
      case 'move': {
        if (e.id === you) break; // already predicted locally
        this.remoteMoveFx(e);
        break;
      }
      case 'blastjump':
        if (e.id === you) this.hud.popup(tmpV.set(this.pred.px, this.pred.py + 0.5, this.pred.pz), 'WHOOSH!', '#9fe8ff', 0.8, 0.6);
        break;
      case 'brace':
        break;
      case 'taunt': {
        const p = this.posOf(e.id);
        const cos = this.roster.get(e.id)?.cos;
        const style = cosmeticKey(cos, 'taunt');
        const pack = cosmeticKey(cos, 'sound');
        this.remotes.get(e.id)?.man.taunt(style);
        if (e.id === this.youId) this.selfMan?.taunt(style);
        if (p) {
          const at: [number, number, number] | null = e.id === you ? null : [p.x, p.y, p.z];
          // Burp is the classic taunt sound; other packs replace it.
          if (style === 'burp' || pack !== 'classic') a.tauntSound(pack, at);
          else a.pop(at);
          this.hud.popup(tmpV.set(p.x, p.y + 3, p.z), TAUNT_TEXT[style] ?? 'HEY!', style === 'burp' ? '#b8f06a' : '#ffffff', 1.1, 1.2, e.id !== you);
          if (PACK_TEXT[pack]) this.hud.popup(tmpV.set(p.x + 0.8, p.y + 3.8, p.z), PACK_TEXT[pack], '#ffd60a', 0.8, 1.1, e.id !== you);
        }
        break;
      }
      case 'reload':
        break;
      case 'grab': {
        const p = this.posOf(e.target);
        a.stretch(e.id === you || e.target === you ? null : p ? [p.x, p.y, p.z] : null);
        if (p) this.hud.popup(tmpV.set(p.x, p.y + 2.6, p.z), e.drag ? 'TAKE YOU WITH ME!' : 'GOTCHA!', e.drag ? '#ff5fd2' : '#ffffff', e.drag ? 1.1 : 0.9, 1.1);
        if (e.target === you) {
          this.trauma = Math.min(1, this.trauma + 0.3);
          this.hud.callout(e.drag ? 'DRAGGED!' : 'GRABBED!', 'Dash when the marker hits green!', 1.4, '#ff9f1c');
        } else if (e.id === you && e.drag) {
          this.hud.callout('TAKE YOU WITH ME!', '', 1.6, '#ff5fd2');
        }
        break;
      }
      case 'throw': {
        const p = this.posOf(e.target);
        if (p) {
          a.whoosh(1, e.target === you ? null : [p.x, p.y, p.z]);
          this.hud.popup(tmpV.set(p.x, p.y + 2.4, p.z), 'YEET!', '#ffd60a', 1.3, 1.1);
        }
        break;
      }
      case 'escape': {
        const p = this.posOf(e.id);
        if (p) {
          fx.fartCloud(p.x, p.y, p.z, 0, 0, false);
          a.fart(e.id === you ? null : [p.x, p.y, p.z]);
          this.hud.popup(tmpV.set(p.x, p.y + 2.4, p.z), 'BROKE FREE!', '#5ee05e', 1, 1);
        }
        if (e.id === you) this.hud.callout('ESCAPED!', '', 1.2, '#5ee05e');
        break;
      }
      case 'escapeFail':
        if (e.id === you) this.hud.callout(e.early ? 'TOO EARLY!' : 'TOO LATE!', 'One try per grab', 1.2, '#ff3b5c');
        break;
      case 'stomp': {
        a.thud(e.id === you || e.target === you ? null : [e.x, e.y, e.z], 14);
        this.hud.popup(tmpV.set(e.x, e.y + 1, e.z), 'STOMP!', '#ff9f1c', 1.3, 1);
        fx.groundRing(e.x, e.y, e.z, 0.8);
        if (e.target === you) this.hud.callout('STOMPED!', '', 1.2, '#ff9f1c');
        break;
      }
      case 'grapple': {
        const from = () => this.handPos(e.id);
        const fixed = new THREE.Vector3(e.x, e.y, e.z);
        const to = e.target >= 0 ? () => (this.posOf(e.target) ? tmpV3.copy(this.posOf(e.target)!).add(UP_ONE) : null) : () => fixed;
        fx.rope(from, to, e.miss ? 0.25 : e.target >= 0 ? 0.45 : 0.35);
        a.thwip(e.id === you ? null : [e.x, e.y, e.z]);
        if (e.target === you) this.hud.callout('YOINK!', '', 1, '#ffd60a');
        break;
      }
      default:
        break;
    }
    void immediate;
  }

  /** Big text and announcer lines for knockouts worth shouting about. */
  private koCallout(e: Extract<GameEvent, { t: 'ko' }>, killerName: string, victimName: string): void {
    const you = this.youId;
    const tags = e.tags;
    const pts = e.points > 1 ? ` +${e.points}` : '';
    if (tags.includes('sd')) {
      // 1v1: they fell off on their own, and the point is yours.
      if (e.killer === you) {
        this.audio.koConfirm();
        this.hud.callout('THEY FELL!', `${victimName} fell off · +${e.points} for you`, 1.8);
      }
      return;
    }
    let main = '';
    let sub = '';
    let line = '';
    let color = '#ffd60a';
    let priority = 1;
    if (tags.includes('multi')) {
      main = 'POP-TASTIC!';
      line = 'Unstoppable!';
      priority = 4;
    } else if (tags.includes('triple')) {
      main = 'TRIPLE POP!';
      line = 'Triple pop!';
      priority = 4;
    } else if (tags.includes('double')) {
      main = 'DOUBLE POP!';
      line = 'Double pop!';
      priority = 3;
    } else if (tags.includes('chain')) {
      main = 'CHAIN REACTION!';
      line = 'Chain reaction!';
      color = '#ff5fd2';
      priority = 3;
    } else if (tags.includes('crown')) {
      main = 'CROWN SNATCHED!';
      line = 'The crown has fallen!';
      color = '#ffc933';
      priority = 3;
    } else if (tags.includes('revenge') && (e.killer === you || e.victim === you)) {
      main = 'REVENGE!';
      line = 'Sweet revenge!';
      color = '#ff3b5c';
      priority = 2;
    } else if (tags.includes('pin')) {
      main = 'PINNED!';
      line = 'Pop!';
      color = '#ff2d55';
      priority = 2;
    } else if (tags.includes('first')) {
      main = 'FIRST POP!';
      line = 'First pop!';
      priority = 2;
    }
    if (main) {
      sub = e.killer === you ? `You popped ${victimName}${pts}` : `${killerName} popped ${victimName}`;
      this.hud.callout(main, sub, 2, color);
      this.announcer.say(line, priority);
      this.audio.koConfirm();
    } else if (e.killer === you && e.victim !== you) {
      this.audio.koConfirm();
      this.hud.callout('POPPED!', `${victimName}${pts}`, 1.8);
    }
  }

  /** Per-frame visuals for random events and the final collapse. */
  private updateChaos(dt: number): void {
    const tick = this.clock.tickAt(performance.now());
    const active = this.chaos.find((c) => tick >= c.startTick && tick < c.endTick) ?? null;
    const upcoming = this.chaos.find((c) => tick < c.startTick) ?? null;
    this.mapView.setFan(active?.kind === 'fan', active?.dirX ?? 0, active?.dirZ ?? 0);
    this.mapView.setIce(active?.kind === 'ice' ? Math.min(1, (tick - active.startTick) / 30) : 0);
    if (active?.kind === 'fan') {
      // Wind streaks racing across the map.
      for (let i = 0; i < 3; i++) {
        const side = (Math.random() - 0.5) * 50;
        const x = -active.dirX * 30 + active.dirZ * side;
        const z = -active.dirZ * 30 + active.dirX * side;
        this.effects.windStreak(x, 1 + Math.random() * 8, z, active.dirX, active.dirZ);
      }
    } else if (active?.kind === 'lowGravity' && Math.random() < 0.5) {
      const c = this.r.camera.position;
      this.effects.sparkle(c.x + (Math.random() - 0.5) * 30, c.y - 2 + Math.random() * 6, c.z + (Math.random() - 0.5) * 30);
    }
    if (active !== this.lastChaosShown) {
      this.lastChaosShown = active;
      if (active?.kind === 'maxInflate') {
        this.audio.whoosh(1, null);
        this.hud.popup(tmpV.set(this.pred.px, this.pred.py + 3, this.pred.pz), 'PSSSHHH!', '#ffffff', 1.4, 1.2);
      }
    }
    let banner = '';
    if (active) banner = `${CHAOS_INFO[active.kind].title.replace('!', '')} · ${Math.ceil((active.endTick - tick) * DT)}s`;
    else if (upcoming) banner = `${CHAOS_INFO[upcoming.kind].title.replace('!', '')} in ${Math.ceil((upcoming.startTick - tick) * DT)}...`;
    this.hud.setEvent(banner);

    // Crumbling edges during the final collapse.
    const elapsed = tick * DT - this.world.collapseStart;
    if (elapsed > 0 && this.match.phase === 'playing') {
      this.debrisTimer -= dt;
      if (this.debrisTimer <= 0) {
        this.debrisTimer = 0.08;
        for (const s of this.world.solids) {
          if (s.collapse < 0 || !s.enabled) continue;
          if (s.collapse === 0 && s.maxX - s.minX >= this.map.solids[s.id].max[0] - this.map.solids[s.id].min[0] - 0.01) continue;
          const edge = Math.floor(Math.random() * 4);
          const u = Math.random();
          const x = edge < 2 ? s.minX + u * (s.maxX - s.minX) : edge === 2 ? s.minX : s.maxX;
          const z = edge >= 2 ? s.minZ + u * (s.maxZ - s.minZ) : edge === 0 ? s.minZ : s.maxZ;
          this.effects.debris(x, s.maxY, z);
        }
      }
    }
  }

  /** Where a player's grapple line starts (your gun muzzle, or another player's chest). */
  private handPos(id: number): THREE.Vector3 | null {
    if (id === this.youId) {
      if (!this.viewModel.root.visible && !this.selfMan?.group.visible) return null;
      return this.muzzlePos(new THREE.Vector3());
    }
    const rv = this.remotes.get(id);
    if (!rv?.cur || rv.cur.mode === MODE_DEAD) return null;
    return new THREE.Vector3(rv.cur.px, rv.cur.py + 1.3 * inflationScale(rv.cur.inflation), rv.cur.pz);
  }

  private showBlast(x: number, y: number, z: number, r: number, power: number): void {
    this.effects.blast(x, y, z, r, power, this.r.camera.position);
    this.audio.whoosh(power, [x, y, z]);
    const d = this.r.camera.position.distanceTo(tmpV.set(x, y, z));
    if (d < 8) this.trauma = Math.min(1, this.trauma + (1 - d / 8) * 0.25);
  }

  private remoteMoveFx(e: Extract<GameEvent, { t: 'move' }>): void {
    const a = this.audio;
    const fx = this.effects;
    const pos: [number, number, number] = [e.x, e.y, e.z];
    const rv = this.remotes.get(e.id);
    const vx = rv?.cur?.vx ?? 0;
    const vz = rv?.cur?.vz ?? 0;
    const sp = Math.hypot(vx, vz) || 1;
    switch (e.kind) {
      case 'jump':
        fx.groundRing(e.x, e.y, e.z, 0.6);
        a.boing(pos);
        break;
      case 'djump':
        fx.airPuff(e.x, e.y + 0.2, e.z, 8, 2.5, 0.25);
        a.boing(pos);
        break;
      case 'dash':
      case 'slide':
      case 'tech':
        fx.fartCloud(e.x, e.y, e.z, vx / sp, vz / sp, e.long);
        a.fart(pos, e.long);
        this.hud.popup(tmpV.set(e.x, e.y + 1.4, e.z), e.long ? 'PFFFFFFFRRRT!' : 'PFFT!', '#c6f08a', e.long ? 1.2 : 0.8, e.long ? 1.6 : 0.8, true);
        break;
      case 'land':
        fx.groundRing(e.x, e.y, e.z, Math.min(1.5, (e.v ?? 8) / 10));
        a.thud(pos, e.v ?? 8);
        break;
      case 'bounce':
      case 'wall':
        fx.airPuff(e.x, e.y + 1, e.z, 6, 2, 0.25);
        a.boing(pos);
        break;
      case 'pad':
        fx.groundRing(e.x, e.y, e.z, 1.4, 0xff9fd0);
        a.boing(pos, true);
        this.hud.popup(tmpV.set(e.x, e.y + 2, e.z), 'BOING!', '#ff9fd0', 1, 0.9, true);
        break;
      default:
        break;
    }
  }

  /** Effects for your own predicted actions (instant feedback, no server round trip). */
  private localStepFx(out: StepResult): void {
    const p = this.pred;
    const a = this.audio;
    const fx = this.effects;
    if (out.jumped) {
      fx.groundRing(p.px, p.py, p.pz, 0.5);
      a.boing(null);
    }
    if (out.doubleJumped) {
      fx.airPuff(p.px, p.py + 0.1, p.pz, 8, 2.5, 0.25);
      a.boing(null);
    }
    if (out.dashed) {
      const sp = Math.hypot(p.vx, p.vz) || 1;
      const long = Math.random() < 1 / 25;
      fx.fartCloud(p.px, p.py, p.pz, p.vx / sp, p.vz / sp, long);
      a.fart(null, long);
      this.fovKick = 8;
      this.hud.popup(tmpV.set(p.px - (p.vx / sp) * 1.5, p.py + 1.2, p.pz - (p.vz / sp) * 1.5), long ? 'PFFFFFFFRRRT!' : 'PFFT!', '#c6f08a', long ? 1.1 : 0.7, long ? 1.4 : 0.6);
    }
    if (out.landed > 6) {
      fx.groundRing(p.px, p.py, p.pz, Math.min(1.5, out.landed / 10));
      a.thud(null, out.landed);
      this.trauma = Math.min(1, this.trauma + Math.min(0.25, out.landed * 0.01));
    }
    if (out.padBounce >= 0) {
      fx.groundRing(p.px, p.py, p.pz, 1.4, 0xff9fd0);
      a.boing(null, true);
    }
    if (out.bounced || out.wallBounce) a.boing(null);
    if (out.ledgeGrab) {
      a.squeak(0.2, null);
      this.hud.popup(tmpV.set(p.hangX, p.hangY + 0.4, p.hangZ), 'CAUGHT IT!', '#5ee05e', 0.8, 0.8);
    }
    if (out.braced) {
      a.clang(null);
      this.hud.flash('rgba(120, 220, 255, 0.35)', 200);
    }
    if (out.techEscape) this.hud.popup(tmpV.set(p.px, p.py + 1.5, p.pz), 'ESCAPE!', '#9fe8ff', 0.8, 0.7);
    if (out.reloadStart) {
      a.reload();
      this.viewModel.startReload(BALANCE.weapons.airCannon.reloadTime);
    }
    if (out.fired) this.fireLocal(out);
    if (out.taunt) {
      a.burp(null);
    }
  }

  private fireLocal(out: StepResult): void {
    const f = out.fired!;
    const w = this.weapon;
    if (w.kind === 'cone') {
      this.viewModel.kick(f.power * 1.5);
      this.audio.airBlast(f.power, null);
      this.trauma = Math.min(1, this.trauma + 0.15 + f.power * 0.25);
      this.punchV += 0.8 + f.power * 1.6;
      this.fovKick += 2 + f.power * 4;
      this.muzzlePos(tmpV);
      this.effects.honkBlast(tmpV.x, tmpV.y, tmpV.z, f.dx, f.dy, f.dz, w.range, w.cone, f.power);
      this.effects.muzzleFlash(tmpV.x, tmpV.y, tmpV.z, f.dx, f.dy, f.dz, f.power * 0.6);
      this.hud.popup(tmpV3.set(tmpV.x + f.dx * 2.5, tmpV.y + f.dy * 2.5 + 0.4, tmpV.z + f.dz * 2.5), 'FWOOMP!', '#ffd60a', 0.9 + f.power * 0.5, 0.6);
      return;
    }
    if (w.kind === 'hitscan') {
      this.viewModel.kick(f.power);
      this.audio.pew(f.power, null);
      this.trauma = Math.min(1, this.trauma + 0.06 + f.power * 0.12);
      this.punchV += 0.6 + f.power * 1.2;
      this.muzzlePos(tmpV);
      const end = this.localRay(f.ox, f.oy, f.oz, f.dx, f.dy, f.dz, w.range, w.rayRadius);
      this.effects.tracer(tmpV.x, tmpV.y, tmpV.z, end.x, end.y, end.z);
      this.effects.muzzleFlash(tmpV.x, tmpV.y, tmpV.z, f.dx, f.dy, f.dz, f.power * 0.5);
      return;
    }
    const M = BALANCE.streaks;
    const kick = f.mega ? 1.6 : 1;
    this.viewModel.kick(f.power * kick);
    this.audio.shoot(f.power, null);
    this.trauma = Math.min(1, this.trauma + (0.1 + f.power * 0.2) * kick);
    this.punchV += (0.5 + f.power * 1.3) * kick;
    this.fovKick += (1 + f.power * 3) * kick;
    const key = -this.seq;
    this.muzzlePos(tmpV);
    this.effects.muzzleFlash(tmpV.x, tmpV.y, tmpV.z, f.dx, f.dy, f.dz, f.power * 0.6 * kick);
    const r = w.projRadius * (0.75 + 0.25 * f.power) * (f.mega ? M.megaRadius : 1);
    this.localBlast = w.blastRadius * (f.mega ? M.megaBlast : 1);
    const p3 = this.effects.addProjectile(key, f.ox, f.oy, f.oz, f.dx * w.projSpeed, f.dy * w.projSpeed, f.dz * w.projSpeed, r, tmpV);
    this.localShots.set(key, { p3, serverId: -1, life: w.projLifetime, exploded: false, boomAt: null });
    this.effects.airPuff(tmpV.x, tmpV.y, tmpV.z, 5, 2, 0.12);
  }

  private localBlast = BALANCE.weapons.airCannon.blastRadius;

  /** Where a ray from your eye stops (world or another player), for instant tracer feedback. */
  private localRay(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, range: number, extra: number): THREE.Vector3 {
    const wh = this.world.raycast(ox, oy, oz, dx, dy, dz, range);
    let best = wh ? wh.dist : range;
    for (const rv of this.remotes.values()) {
      const c = rv.cur;
      if (!c || c.mode === MODE_DEAD || this.isAlly(rv.id)) continue;
      const tmp = this.scratch;
      tmp.px = c.px;
      tmp.py = c.py;
      tmp.pz = c.pz;
      tmp.inflation = c.inflation;
      const t = rayCapsule(ox, oy, oz, dx, dy, dz, tmp, playerRadius(tmp) + extra);
      if (t !== null && t < best) best = t;
    }
    return new THREE.Vector3(ox + dx * best, oy + dy * best, oz + dz * best);
  }

  private readonly scratch = createPlayerState();

  // --- Per-frame -------------------------------------------------------------------------

  frame(dt: number): void {
    this.time += dt;
    const now = performance.now();
    if (!this.active) {
      this.attract(dt);
      return;
    }
    // Fixed-step input sampling and prediction.
    this.stepAcc += dt;
    let steps = 0;
    while (this.stepAcc >= DT && steps < 6) {
      this.stepAcc -= DT;
      steps++;
      this.predictStep();
    }
    if (steps >= 6) this.stepAcc = 0;
    if (this.pendingSend.length) {
      this.net.sendInputs(this.pendingSend);
      this.pendingSend = [];
    }

    // Remote timeline.
    this.renderTick = this.clock.tickAt(now) - this.clock.interpDelay();
    while (this.pending.length && this.pending[0].tick <= this.renderTick) this.handleEvent(this.pending.shift()!, false);
    this.world.setTime(this.predTick() * DT);
    this.updateRemotes(dt);
    this.updateMode(dt);
    this.updateShots(dt);
    if (this.replay.active) {
      for (const rv of this.remotes.values()) {
        rv.man.setVisible(false);
        rv.tag.el.style.display = 'none';
      }
      this.viewModel.root.visible = false;
      this.selfMan?.setVisible(false);
      this.replay.update(dt, this.r.camera);
    } else {
      this.updateCamera(dt);
    }
    this.updateLocalFeedback(dt);
    this.updateAimAssist(dt);
    this.updateChaos(dt);
    this.mapView.update(dt, this.time);
    for (const v of this.entities.vacuums) this.effects.vacuumSwirl(v.x, v.y, v.z, BALANCE.utilities.vacuumGrenade.radius, dt);
    this.entities.update(dt, this.clock.tickAt(performance.now()));
    this.effects.update(dt);
    this.updateCircles();
    this.hud.updatePopups(this.r.camera, dt);
  }

  private predictStep(): void {
    const f = emptyInput();
    this.input.sample(f);
    if (this.thirdPersonLive) this.thirdPersonAim(f);
    f.seq = ++this.seq;
    f.tick = this.predTick();
    f.viewTick = Math.max(0, Math.round(this.renderTick));
    quantizeInput(f);
    this.pendingSend.push(f);
    if (!this.havePred) return;
    this.history.push({ seq: f.seq, tick: f.tick, input: f });
    if (this.history.length > 240) this.history.shift();
    this.prevX = this.pred.px;
    this.prevY = this.pred.py;
    this.prevZ = this.pred.pz;
    this.world.setTime(f.tick * DT);
    this.ctx.env = envAt(this.chaos, f.tick, this.envTmp);
    stepPlayer(this.pred, f, this.ctx, this.stepOut);
    this.localStepFx(this.stepOut);
  }

  private updateRemotes(dt: number): void {
    const rt = this.renderTick;
    let s0: SnapEntry | null = null;
    let s1: SnapEntry | null = null;
    for (let i = this.snaps.length - 1; i >= 0; i--) {
      if (this.snaps[i].tick <= rt) {
        s0 = this.snaps[i];
        s1 = this.snaps[i + 1] ?? null;
        break;
      }
    }
    if (!s0 && this.snaps.length) s0 = this.snaps[0];
    const seen = new Set<number>();
    if (s0) {
      const alpha = s1 ? Math.max(0, Math.min(1, (rt - s0.tick) / (s1.tick - s0.tick))) : 0;
      const extra = s1 ? 0 : Math.min(6, Math.max(0, rt - s0.tick)) * DT;
      for (const [id, a] of s0.players) {
        if (id === this.youId) continue;
        seen.add(id);
        const b = s1?.players.get(id);
        let rv = this.remotes.get(id);
        if (!rv) {
          rv = this.createRemote(id);
          this.remotes.set(id, rv);
        }
        const cur: PublicPlayer = rv.cur ?? { ...a };
        if (b && Math.hypot(b.px - a.px, b.py - a.py, b.pz - a.pz) < 6) {
          cur.px = a.px + (b.px - a.px) * alpha;
          cur.py = a.py + (b.py - a.py) * alpha;
          cur.pz = a.pz + (b.pz - a.pz) * alpha;
          cur.vx = a.vx + (b.vx - a.vx) * alpha;
          cur.vy = a.vy + (b.vy - a.vy) * alpha;
          cur.vz = a.vz + (b.vz - a.vz) * alpha;
          cur.yaw = lerpAngle(a.yaw, b.yaw, alpha);
          cur.pitch = a.pitch + (b.pitch - a.pitch) * alpha;
          cur.inflation = a.inflation + (b.inflation - a.inflation) * alpha;
          const src = alpha < 0.5 ? a : b;
          cur.mode = src.mode;
          cur.flags = src.flags;
          cur.charge = src.charge;
          cur.heldBy = src.heldBy;
          cur.holding = src.holding;
          cur.dashCharges = src.dashCharges;
          cur.hangAngle = src.hangAngle;
        } else {
          const src = b && alpha >= 0.5 ? b : a;
          Object.assign(cur, src);
          // Brief extrapolation if we're past the newest snapshot.
          cur.px += src.vx * extra;
          cur.py += src.vy * extra;
          cur.pz += src.vz * extra;
        }
        rv.cur = cur;
        this.poseRemote(rv, dt);
      }
    }
    for (const [id, rv] of this.remotes) {
      if (!seen.has(id)) {
        rv.man.setVisible(false);
        rv.tag.el.style.display = 'none';
      }
    }
  }

  private tagTeam(id: number): { color: number; ally: boolean } | undefined {
    const t = this.teamOf(id);
    if (!this.teamMode || t < 0) return undefined;
    return { color: this.teamColors[t], ally: t === this.teamOf(this.youId) };
  }

  /** Ball interpolation, pump visuals, and the team score strip. */
  private updateMode(dt: number): void {
    const rt = this.renderTick;
    if (this.ball) {
      let a: SnapEntry | null = null;
      let b: SnapEntry | null = null;
      for (let i = this.snaps.length - 1; i >= 0; i--) {
        if (this.snaps[i].tick <= rt) {
          a = this.snaps[i];
          b = this.snaps[i + 1] ?? null;
          break;
        }
      }
      a ??= this.snaps[0] ?? null;
      const ba = a?.mode?.ball;
      if (ba) {
        const bb = b?.mode?.ball;
        const k = bb && b ? Math.max(0, Math.min(1, (rt - a!.tick) / (b.tick - a!.tick))) : 0;
        const jump = bb && Math.hypot(bb.x - ba.x, bb.y - ba.y, bb.z - ba.z) > 8;
        const lerp = (x: number, y: number) => (bb && !jump ? x + (y - x) * k : x);
        const x = lerp(ba.x, bb?.x ?? 0);
        const y = lerp(ba.y, bb?.y ?? 0);
        const z = lerp(ba.z, bb?.z ?? 0);
        const ground = this.world.groundBelow(x, y, z, 60);
        this.ball.update(x, y, z, lerp(ba.vx, bb?.vx ?? 0), lerp(ba.vz, bb?.vz ?? 0), ba.inPlay, ground, dt);
      }
    }
    const ms = this.modeState;
    if (ms?.pump) this.mapView.setPumpState(ms.pump.states, ms.pump.fill);
    if (this.teamMode && ms?.teamScores && this.match.phase !== 'waiting') {
      const pump = !!ms.pump;
      this.hud.setTeamBar({
        colors: this.teamColors,
        names: this.teamNames(),
        scores: pump ? ms.pump!.fill : ms.teamScores,
        bars: pump,
        youTeam: this.teamOf(this.youId),
        target: this.mode === 'ball' ? BALANCE.modes.ball.goalTarget : undefined,
      });
    } else {
      this.hud.setTeamBar(null);
    }
  }

  private createRemote(id: number): RemoteView {
    const entry = this.roster.get(id);
    const color = this.colorOf(id);
    const look = lookOf(entry?.cos);
    const man = new TubeMan(color, { physical: this.r.profile.physical, seed: id * 13.7, look });
    this.r.scene.add(man.group);
    const tag = this.hud.createNametag(entry?.name ?? '...', entry?.bot ?? false, this.tagTeam(id));
    return { id, man, pose: defaultPose(), tag, color, name: entry?.name ?? '...', bot: entry?.bot ?? false, cur: null, lastTagText: '', lookKey: JSON.stringify(look) };
  }

  private removeRemote(rv: RemoteView): void {
    this.r.scene.remove(rv.man.group);
    rv.man.dispose();
    rv.tag.el.remove();
  }

  private poseRemote(rv: RemoteView, dt: number): void {
    const c = rv.cur!;
    const entry = this.roster.get(rv.id);
    if (entry && (entry.name !== rv.name || this.colorOf(rv.id) !== rv.color)) {
      rv.name = entry.name;
      rv.color = this.colorOf(rv.id);
      rv.man.setColor(rv.color);
      rv.tag.el.remove();
      rv.tag = this.hud.createNametag(entry.name, entry.bot, this.tagTeam(rv.id));
      rv.lastTagText = '';
    }
    if (entry) {
      const look = lookOf(entry.cos);
      const key = JSON.stringify(look);
      if (key !== rv.lookKey) {
        rv.lookKey = key;
        rv.man.setLook(look);
      }
    }
    const alive = c.mode !== MODE_DEAD;
    rv.man.setVisible(alive);
    if (!alive) {
      rv.tag.el.style.display = 'none';
      return;
    }
    rv.man.group.position.set(c.px, c.py, c.pz);
    const p = rv.pose;
    p.time = this.time;
    p.dt = dt;
    p.inflation = c.inflation;
    p.vx = c.vx;
    p.vy = c.vy;
    p.vz = c.vz;
    p.yaw = c.mode === MODE_HANG ? c.hangAngle + Math.PI : c.yaw;
    p.onGround = (c.flags & FLAG_GROUND) !== 0;
    p.launched = (c.flags & FLAG_LAUNCHED) !== 0;
    p.doubled = (c.flags & FLAG_DOUBLED) !== 0;
    p.bracing = (c.flags & FLAG_BRACING) !== 0;
    p.charge = (c.flags & FLAG_CHARGING) !== 0 ? c.charge : 0;
    p.hanging = c.mode === MODE_HANG;
    p.holding = c.holding >= 0;
    p.held = c.mode === MODE_HELD;
    p.pitch = c.pitch;
    p.streaming = (c.flags & FLAG_STREAM) !== 0;
    p.hasPin = (c.flags & FLAG_PIN) !== 0;
    p.crowned = (c.flags & FLAG_CROWN) !== 0;
    p.powered = (c.flags & FLAG_POWERED) !== 0;
    if (p.powered && Math.random() < dt * 12) this.effects.sparkle(c.px + (Math.random() - 0.5) * 1.4, c.py + Math.random() * 2.2, c.pz + (Math.random() - 0.5) * 1.4);
    p.nemesis = rv.id === this.nemesisId;
    rv.man.setWeapon(WEAPON_IDS[c.weapon] ?? 'airCannon');
    p.dashing = (c.flags & FLAG_DASHING) !== 0;
    p.protected = (c.flags & FLAG_PROTECTED) !== 0;
    rv.man.update(p);
    if (p.streaming && rv.man.muzzleWorld(tmpV3)) {
      const d = lookDir(c.yaw, c.pitch, tmpDir);
      this.effects.leafStream(tmpV3.x, tmpV3.y, tmpV3.z, d.x, d.y, d.z, c.charge, dt);
    }

    // Name tag with inflation percentage above the head.
    const headY = c.py + rv.man.headHeight(c.inflation) + 0.35;
    const v = tmpV.set(c.px, headY, c.pz).project(this.r.camera);
    const dist = this.r.camera.position.distanceTo(tmpV2.set(c.px, headY, c.pz));
    if (v.z > 1 || dist > 90) {
      rv.tag.el.style.display = 'none';
      return;
    }
    rv.tag.el.style.display = '';
    const x = (v.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-v.y * 0.5 + 0.5) * window.innerHeight;
    const scale = Math.max(0.55, Math.min(1.1, 14 / Math.max(1, dist)));
    rv.tag.el.style.transform = `translate(-50%, -100%) translate(${x}px, ${y}px) scale(${scale})`;
    const pct = Math.round(c.inflation * 100);
    const text = `${p.crowned ? '👑 ' : ''}${pct}%${p.nemesis ? ' ⚔️' : ''}`;
    if (text !== rv.lastTagText) {
      rv.lastTagText = text;
      rv.tag.pct.textContent = text;
      const hue = 120 - Math.min(1, c.inflation) * 120;
      rv.tag.pct.style.color = pct === 0 ? '#ffffff' : `hsl(${hue}, 95%, 68%)`;
      rv.tag.el.classList.toggle('danger', c.inflation >= 0.75);
    }
  }

  private updateShots(dt: number): void {
    // Remote shots follow the interpolated timeline.
    for (const s of this.remoteShots.values()) {
      const t = Math.max(0, (this.renderTick - s.tick) * DT);
      this.effects.placeProjectile(s.p3, s.x + s.vx * t, s.y + s.vy * t - 0.5 * s.g * t * t, s.z + s.vz * t, dt);
      if (t > (s.g > 0 ? 7 : 2.5)) {
        this.effects.removeProjectile(s.id);
        this.remoteShots.delete(s.id);
      }
    }
    // Our own shots are simulated locally for instant feedback.
    for (const [key, s] of this.localShots) {
      if (s.exploded) {
        s.life -= dt;
        if (s.life < -1) {
          this.localShots.delete(key);
          if (s.serverId >= 0) this.localByServer.delete(s.serverId);
        }
        continue;
      }
      const p = s.p3;
      const nx = p.x + p.vx * dt;
      const ny = p.y + p.vy * dt;
      const nz = p.z + p.vz * dt;
      s.life -= dt;
      let hit = this.world.sphereHit(nx, ny, nz, p.r * 0.45) >= 0;
      if (!hit) {
        for (const rv of this.remotes.values()) {
          const c = rv.cur;
          if (!c || c.mode === MODE_DEAD) continue;
          const pr = BALANCE.player.radius * inflationScale(c.inflation);
          const h = BALANCE.player.height * inflationScale(c.inflation);
          const ay = Math.max(c.py + pr, Math.min(c.py + h - pr, ny));
          if (Math.hypot(nx - c.px, ny - ay, nz - c.pz) < pr + p.r) {
            hit = true;
            break;
          }
        }
      }
      if (hit) {
        // Cosmetic prediction; the server's boom event is authoritative.
        s.exploded = true;
        s.boomAt = new THREE.Vector3(nx, ny, nz);
        this.effects.removeProjectile(key);
        this.showBlast(nx, ny, nz, this.localBlast * 0.9, 0.7);
        continue;
      }
      if (s.life <= 0) {
        s.exploded = true;
        this.effects.removeProjectile(key);
        this.effects.airPuff(nx, ny, nz, 5, 1.5, 0.25);
        continue;
      }
      this.effects.placeProjectile(p, nx, ny, nz, dt);
    }
  }

  /** Your shot landed: marker, crunch, shake and a beat of hit-stop, scaled by how hard it hit. */
  private confirmHit(e: Extract<GameEvent, { t: 'hit' }>): void {
    const k = Math.min(1, e.speed / 30);
    this.hud.hitMarker(k);
    this.audio.hitConfirm(k);
    this.audio.impact(e.speed, null, 1.3);
    this.trauma = Math.min(1, this.trauma + 0.2 + k * 0.5);
    this.fovKick -= 1 + k * 4;
    this.viewModel.hitStop(Math.min(BALANCE.knockback.hitStopMax, BALANCE.knockback.hitStopBase + e.speed * BALANCE.knockback.hitStopPerSpeed));
    if (e.combo >= 2) this.hud.callout(`${e.combo}x COMBO!`, e.combo >= 3 ? 'Juggle master!' : 'Keep them in the air!', 1.2, e.combo >= 3 ? '#ff5fd2' : '#ffd60a');
  }

  /** Third-person camera is on and you're alive (so shots aim along the camera's center ray). */
  private get thirdPersonLive(): boolean {
    return this.settings.thirdPerson && this.camLive && this.havePred && this.pred.mode !== MODE_DEAD && !this.replay.active;
  }

  /** Flips between first and third person and remembers the choice. */
  toggleCamera(): void {
    this.settings.thirdPerson = !this.settings.thirdPerson;
    saveSettings(this.settings);
    this.camDist = 0;
    this.hud.toast(this.settings.thirdPerson ? 'Third-person camera' : 'First-person camera', 1400);
  }

  /**
   * In third person the reticle sits on the camera's center ray, not your eye's. Aim the frame
   * from your eye at whatever that ray hits, and keep movement relative to the camera.
   */
  private thirdPersonAim(f: InputFrame): void {
    const p = this.pred;
    tmpV2.set(p.px, p.py + eyeHeight(p), p.pz);
    aimFromCamera(this.world, this.camPos, f.yaw, f.pitch, tmpV2, (ox, oy, oz, dx, dy, dz, max) => this.rayPlayers(ox, oy, oz, dx, dy, dz, max), this.aimOut);
    if (f.moveX !== 0 || f.moveZ !== 0) [f.moveX, f.moveZ] = rebaseMove(f.moveX, f.moveZ, f.yaw, this.aimOut.yaw);
    f.yaw = this.aimOut.yaw;
    f.pitch = this.aimOut.pitch;
  }

  /** Distance along a ray to the nearest other player, or null. */
  private rayPlayers(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number): number | null {
    let best: number | null = null;
    for (const rv of this.remotes.values()) {
      const c = rv.cur;
      if (!c || c.mode === MODE_DEAD) continue;
      const tmp = this.scratch;
      tmp.px = c.px;
      tmp.py = c.py;
      tmp.pz = c.pz;
      tmp.inflation = c.inflation;
      const t = rayCapsule(ox, oy, oz, dx, dy, dz, tmp, playerRadius(tmp));
      if (t !== null && t < max && (best === null || t < best)) best = t;
    }
    return best;
  }

  /** Your own tube man, shown in third person at your predicted position. */
  private poseSelf(dt: number, x: number, y: number, z: number, visible: boolean): void {
    if (!visible) {
      this.selfMan?.setVisible(false);
      return;
    }
    const entry = this.roster.get(this.youId);
    const color = this.colorOf(this.youId);
    const look = lookOf(entry?.cos);
    const key = `${color}|${JSON.stringify(look)}|${this.r.profile.physical}`;
    if (!this.selfMan || key !== this.selfLookKey) {
      if (this.selfMan) {
        this.r.scene.remove(this.selfMan.group);
        this.selfMan.dispose();
      }
      this.selfMan = new TubeMan(color, { physical: this.r.profile.physical, seed: this.youId * 13.7, look });
      this.r.scene.add(this.selfMan.group);
      this.selfLookKey = key;
    }
    const man = this.selfMan;
    const p = this.pred;
    const pose = this.selfPose;
    man.setVisible(true);
    man.group.position.set(x, y, z);
    pose.time = this.time;
    pose.dt = dt;
    pose.inflation = p.inflation;
    pose.vx = p.vx;
    pose.vy = p.vy;
    pose.vz = p.vz;
    pose.yaw = p.mode === MODE_HANG ? Math.atan2(p.hangNx, p.hangNz) + Math.PI : p.yaw;
    pose.pitch = p.pitch;
    pose.onGround = p.onGround === 1;
    pose.launched = p.launchTimer > 0;
    pose.doubled = p.doubledTimer > 0;
    pose.bracing = p.braceTimer > 0;
    pose.charge = p.charging ? p.charge : 0;
    pose.hanging = p.mode === MODE_HANG;
    pose.holding = p.holding >= 0;
    pose.held = p.mode === MODE_HELD;
    pose.streaming = p.charging === 1 && this.weapon.kind === 'stream';
    pose.hasPin = p.pinTimer > 0;
    pose.crowned = this.crownId === this.youId;
    pose.powered = p.turboTimer > 0 || p.megaShots > 0;
    pose.nemesis = false;
    pose.dashing = p.dashTimer > 0;
    pose.protected = p.spawnProt > 0;
    man.setWeapon(this.weapon.id);
    man.update(pose);
  }

  /** Where your shots visibly leave from: your character's gun in third person, else the view model. */
  private muzzlePos(out: THREE.Vector3): THREE.Vector3 {
    if (this.selfMan?.group.visible && this.selfMan.muzzleWorld(out)) return out;
    return this.viewModel.muzzle.getWorldPosition(out);
  }

  private updateCamera(dt: number): void {
    const cam = this.r.camera;
    const p = this.pred;
    const alpha = this.stepAcc / DT;
    const decay = Math.exp(-dt * 10);
    this.errX *= decay;
    this.errY *= decay;
    this.errZ *= decay;
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    this.fovKick *= Math.exp(-dt * 6);
    // Underdamped spring: a sharp kick up that settles in about a fifth of a second.
    const pdt = Math.min(dt, 1 / 30);
    this.punchV += (-320 * this.punch - 30 * this.punchV) * pdt;
    this.punch += this.punchV * pdt;
    const shake = this.trauma * this.trauma;
    const alive = p.mode !== MODE_DEAD && this.havePred;
    const third = alive && this.settings.thirdPerson;
    this.viewModel.root.visible = alive && !third;
    let fov = this.settings.fov + this.fovKick + (p.launchTimer > 0 ? 6 : 0);
    if (alive) {
      const x = this.prevX + (p.px - this.prevX) * alpha + this.errX;
      const y = this.prevY + (p.py - this.prevY) * alpha + this.errY;
      const z = this.prevZ + (p.pz - this.prevZ) * alpha + this.errZ;
      cam.position.set(x, y + eyeHeight(p), z);
      let roll = (Math.random() - 0.5) * shake * 0.1;
      if (third) {
        const scale = inflationScale(p.inflation);
        const want = this.camDist + (CHASE.back * scale - this.camDist) * Math.min(1, dt * 5);
        this.camDist = chaseCamera(this.world, cam.position, this.input.yaw, this.input.pitch, scale, cam.position, want);
      } else {
        this.camDist = 0;
        if (p.launchTimer > 0) roll += Math.sin(this.time * 6) * 0.04;
      }
      this.camPos.copy(cam.position);
      this.camLive = true;
      cam.rotation.set(this.input.pitch + this.punch + (Math.random() - 0.5) * shake * 0.08, this.input.yaw + (Math.random() - 0.5) * shake * 0.08, roll);
      this.poseSelf(dt, x, y, z, third && this.camDist > 0.7 * inflationScale(p.inflation));
    } else {
      // Spectate: watch the balloon fly off, then look at whoever popped you.
      const since = this.time - this.deathAt;
      fov = 70;
      let target = this.deathPos;
      if (since > 1.2 && this.killerId >= 0) {
        const k = this.posOf(this.killerId);
        if (k) target = tmpV.copy(k).add(new THREE.Vector3(0, 1.2, 0));
      }
      const home = new THREE.Vector3(0, 16, 0);
      const orbit = this.time * 0.15;
      const desired = new THREE.Vector3(home.x + Math.cos(orbit) * 26, home.y, home.z + Math.sin(orbit) * 26);
      cam.position.lerp(desired, Math.min(1, dt * 1.5));
      const m = new THREE.Matrix4().lookAt(cam.position, target, new THREE.Vector3(0, 1, 0));
      const q = new THREE.Quaternion().setFromRotationMatrix(m);
      cam.quaternion.slerp(q, Math.min(1, dt * 4));
      this.selfMan?.setVisible(false);
      this.camDist = 0;
      this.camLive = false;
    }
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov += (fov - cam.fov) * Math.min(1, dt * 12);
      cam.updateProjectionMatrix();
    }
    this.audio.setListener(cam.position.x, cam.position.y, cam.position.z, this.input.yaw);
  }

  private updateLocalFeedback(dt: number): void {
    const p = this.pred;
    const w = this.weapon;
    const alive = p.mode !== MODE_DEAD && this.havePred;
    const streaming = alive && w.kind === 'stream' && p.charging === 1;
    this.viewModel.update(dt, {
      speed: Math.hypot(p.vx, p.vz),
      charge: p.charging || w.kind === 'stream' ? p.charge : 0,
      onGround: p.onGround === 1,
      lookDX: this.input.lookDX,
      lookDY: this.input.lookDY,
      ammoFrac: p.ammo / w.ammo,
      reloading: p.reloadTimer > 0,
      active: streaming,
    });
    const blow = streaming ? w.tapPower + (1 - w.tapPower) * p.charge : 0;
    if (Math.abs(blow - this.streamStrength) > 0.02 || (blow === 0) !== (this.streamStrength === 0)) {
      this.audio.setBlower(blow);
      this.streamStrength = blow;
    }
    if (streaming) {
      this.muzzlePos(tmpV3);
      const d = lookDir(p.yaw, p.pitch, tmpDir);
      this.effects.leafStream(tmpV3.x, tmpV3.y, tmpV3.z, d.x, d.y, d.z, blow, dt);
      if (p.hovering) this.effects.airPuff(p.px, p.py, p.pz, 1, 3, 0.2);
    }
    this.input.lookDX = 0;
    this.input.lookDY = 0;
    const charge = alive && p.charging && w.kind !== 'stream' ? p.charge : 0;
    if (charge !== this.lastCharge) {
      this.audio.setCharge(charge);
      this.lastCharge = charge;
    }
    if (p.ammo === 0 && this.lastAmmo > 0) this.hud.setNote('Reloading...');
    const launched = p.launchTimer > 0;
    if (launched && !this.wasLaunched) this.launchTips++;
    this.wasLaunched = launched;
    this.lastAmmo = p.ammo;

    const me = this.roster.get(this.youId);
    let sub = '';
    if (this.match.phase === 'waiting') sub = 'Waiting for another player...';
    else if (this.match.phase === 'results') sub = 'Match over!';
    else if (me && this.mode === 'duel') {
      const rival = [...this.roster.values()].find((r) => r.id !== me.id);
      sub = rival ? `You ${me.kos} – ${rival.kos} ${rival.name}${rival.bot ? ' (warm-up bot)' : ''} · first to ${BALANCE.modes.duel.target}` : 'Waiting for a rival...';
    } else if (me && this.teamMode) {
      sub = `${MODE_INFO[this.mode].name} · you: ${me.kos} KO${me.kos === 1 ? '' : 's'}`;
    } else if (me) {
      const sorted = [...this.roster.values()].sort((a, b) => b.score - a.score);
      const rank = sorted.findIndex((r) => r.id === me.id) + 1;
      sub = `#${rank} of ${sorted.length} · ${me.score} KO${me.score === 1 ? '' : 's'}`;
    }
    const timeLeft = this.match.phase === 'waiting' ? 0 : Math.max(0, (this.match.endsAtTick - this.clock.tickAt(performance.now())) * DT);
    this.hud.update(
      {
        inflation: p.inflation,
        ammo: p.ammo,
        maxAmmo: w.ammo,
        reloadFrac: p.reloadTimer > 0 ? 1 - p.reloadTimer / w.reloadTime : 0,
        charge,
        dashCharges: p.dashCharges,
        dashRechargeFrac: p.dashCharges < BALANCE.dash.charges ? 1 - p.dashRecharge / BALANCE.dash.rechargeTime : 1,
        braceReady: 1 - p.braceCool / BALANCE.brace.cooldown,
        grabReady: 1 - Math.min(1, p.grabCool / BALANCE.grab.cooldown),
        grappleReady: 1 - Math.min(1, p.grappleCool / BALANCE.grapple.cooldown),
        heldTime: alive && p.mode === MODE_HELD ? p.holdTimer : -1,
        escapeUsed: p.escapeUsed === 1,
        hint: alive ? this.contextHint() : '',
        timeLeft,
        phase: this.match.phase,
        sub,
        alive,
        weaponName: WEAPON_INFO[w.id].name.toUpperCase(),
        stream: w.kind === 'stream',
        u1Ready: 1 - Math.min(1, p.u1Cool / BALANCE.utilities[this.loadout.utils[0]].cooldown),
        u2Ready: 1 - Math.min(1, p.u2Cool / BALANCE.utilities[this.loadout.utils[1]].cooldown),
        pin: p.pinTimer,
        turbo: alive ? p.turboTimer : 0,
        mega: alive ? p.megaShots : 0,
      },
      dt,
    );
    if (!alive && this.havePred) {
      const killer = this.killerId >= 0 ? this.nameOf(this.killerId) : null;
      const left = Math.max(0, BALANCE.match.respawnDelay - (this.time - this.deathAt));
      this.hud.setRespawn(killer ? `Popped by ${killer}!` : 'You fell off!', this.match.phase === 'results' ? '' : `Respawning in ${left.toFixed(1)}...`);
    } else {
      this.hud.setRespawn(null);
    }
    if (p.reloadTimer <= 0) this.hud.setNote(alive && p.spawnProt > 0 ? 'Spawn shield: fire to drop it' : '');
    this.touch?.update({
      charge,
      dash: p.dashCharges > 0 ? 1 : p.dashCharges < BALANCE.dash.charges ? 1 - p.dashRecharge / BALANCE.dash.rechargeTime : 1,
      brace: 1 - p.braceCool / BALANCE.brace.cooldown,
      grab: 1 - Math.min(1, p.grabCool / BALANCE.grab.cooldown),
      grapple: 1 - Math.min(1, p.grappleCool / BALANCE.grapple.cooldown),
      u1: 1 - Math.min(1, p.u1Cool / BALANCE.utilities[this.loadout.utils[0]].cooldown),
      u2: 1 - Math.min(1, p.u2Cool / BALANCE.utilities[this.loadout.utils[1]].cooldown),
      reloading: p.reloadTimer > 0,
      features: this.ctx.features,
      utilIcons: [UTIL_ICONS[UTILITY_INFO[this.loadout.utils[0]].name] ?? '?', UTIL_ICONS[UTILITY_INFO[this.loadout.utils[1]].name] ?? '?'],
    });
    const k = (a: Action) => this.key(a);
    this.hud.setKeys(
      { dash: k('dash'), brace: k('brace'), grab: k('grab'), grapple: k('grapple'), reload: k('reload'), camera: k('camera'), util1: k('util1'), util2: k('util2') },
      this.settings.thirdPerson,
    );
    this.tips.update(dt, {
      active: alive && this.input.enabled && this.match.phase !== 'results' && !this.replay.active,
      features: this.ctx.features,
      keyOf: k,
      utilName: (i) => UTILITY_INFO[this.loadout.utils[i]].name,
    });
    this.hud.ping.textContent = `${Math.round(this.net.rtt)} ms`;
  }

  private key(a: Action): string {
    if (this.input.lastDevice === 'touch') return TOUCH_LABELS[a] ?? a;
    if (this.input.lastDevice === 'pad') {
      if (a === 'forward' || a === 'back' || a === 'left' || a === 'right') return 'L-stick';
      return this.input.padLabel(a);
    }
    return codeLabel(this.input.getBindings()[a][0] ?? '?');
  }

  /** Light controller aim assist: slows aim over enemies and nudges toward them. */
  private updateAimAssist(dt: number): void {
    const inp = this.input;
    inp.assistFriction = 1;
    const k = this.settings.aimAssist;
    if ((inp.lastDevice !== 'pad' && inp.lastDevice !== 'touch') || k <= 0 || !this.alive || !this.havePred) return;
    const eye = this.r.camera.position;
    const f = lookDir(inp.yaw, inp.pitch, tmpDir);
    let best: { yaw: number; pitch: number; ang: number; tol: number } | null = null;
    for (const rv of this.remotes.values()) {
      const c = rv.cur;
      if (!c || c.mode === MODE_DEAD || (c.flags & FLAG_PROTECTED) !== 0 || this.isAlly(rv.id)) continue;
      const s = inflationScale(c.inflation);
      const vx = c.px - eye.x;
      const vy = c.py + BALANCE.player.height * s * 0.55 - eye.y;
      const vz = c.pz - eye.z;
      const d = Math.hypot(vx, vy, vz);
      if (d > 45 || d < 0.5) continue;
      const ang = Math.acos(Math.max(-1, Math.min(1, (vx * f.x + vy * f.y + vz * f.z) / d)));
      const tol = 0.05 + Math.atan2(BALANCE.player.radius * s, d);
      if (ang > tol * 2.5 || (best && ang > best.ang)) continue;
      if (this.world.raycast(eye.x, eye.y, eye.z, vx / d, vy / d, vz / d, d - 0.5)) continue;
      best = { yaw: Math.atan2(-vx, -vz), pitch: Math.atan2(vy, Math.hypot(vx, vz)), ang, tol };
    }
    if (!best) return;
    if (best.ang < best.tol) inp.assistFriction = 1 - 0.5 * k;
    // Gentle pull, strongest near the target, only while the player is actively aiming or moving.
    const moving = Math.hypot(this.pred.vx, this.pred.vz) > 1 || inp.external.moveX !== 0 || inp.external.moveZ !== 0;
    if (!moving) return;
    const rate = 0.7 * k * (1 - best.ang / (best.tol * 2.5));
    let dy = best.yaw - inp.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    inp.yaw += Math.max(-rate * dt, Math.min(rate * dt, dy));
    inp.pitch += Math.max(-rate * dt, Math.min(rate * dt, best.pitch - inp.pitch));
  }

  /** Short on-screen tip for whatever situation you're in right now. */
  private contextHint(): string {
    const p = this.pred;
    const f = this.ctx.features;
    if (p.mode === MODE_HANG) return `${this.key('forward')} climb · ${this.key('jump')} jump up · ${this.key('back')} let go`;
    if (p.holding >= 0) return p.holdTimer < BALANCE.grab.minHold ? 'Hold on...' : `${this.key('fire')} to THROW!`;
    if (p.mode === MODE_HELD) return '';
    if (p.onGround === 0 && p.zipTimer <= 0) {
      const ground = this.world.groundBelow(p.px, p.py + 0.2, p.pz, 60);
      if (ground === null || ground < p.py - 15) {
        const tips: string[] = [];
        if (p.dashCharges > 0) tips.push(`${this.key('dash')} dash`);
        if (p.jumpsUsed < 2) tips.push(`${this.key('jump')} jump`);
        if (f.grapple && p.grappleCool <= 0) tips.push(`${this.key('grapple')} grapple`);
        if (f.ledge) tips.push(`hold ${this.key('grab')} to catch a ledge`);
        return tips.length ? `Falling! ${tips.join(' · ')}` : 'Falling!';
      }
    }
    if (p.launchTimer > 0 && this.launchTips < 6) return `Steer with ${this.key('forward')}${this.key('left')}${this.key('back')}${this.key('right')} · ${this.key('dash')} to dash out`;
    if (f.ledge) {
      for (const rv of this.remotes.values()) {
        const c = rv.cur;
        if (c?.mode === MODE_HANG && !this.isAlly(rv.id) && p.onGround && Math.hypot(c.px - p.px, c.pz - p.pz) < 2.2 && Math.abs(c.py - p.py) < 3) return `${this.key('grab')} to STOMP their hands!`;
      }
    }
    return '';
  }

  private updateCircles(): void {
    this.circles.begin();
    const place = (x: number, y: number, z: number, infl: number) => {
      const g = this.world.groundBelow(x, y + 0.2, z, 80);
      if (g === null) return;
      this.circles.place(x, g, z, BALANCE.player.radius * inflationScale(infl) * 1.3, y - g);
    };
    if (this.pred.mode !== MODE_DEAD && this.havePred) place(this.pred.px, this.pred.py, this.pred.pz, this.pred.inflation);
    for (const rv of this.remotes.values()) {
      const c = rv.cur;
      if (c && c.mode !== MODE_DEAD) place(c.px, c.py, c.pz, c.inflation);
    }
    this.circles.end();
  }

  /** Menu background: slow orbit around the map with the decor flailing. */
  private attract(dt: number): void {
    this.attractAngle += dt * 0.06;
    const cam = this.r.camera;
    const r = 44;
    cam.position.set(Math.cos(this.attractAngle) * r, 17 + Math.sin(this.attractAngle * 0.7) * 3, Math.sin(this.attractAngle) * r);
    cam.lookAt(0, 0, 0);
    if (Math.abs(cam.fov - 60) > 0.01) {
      cam.fov = 60;
      cam.updateProjectionMatrix();
    }
    this.world.setTime(this.time);
    this.mapView.update(dt, this.time);
    this.effects.update(dt);
  }

  /** Plays the end-of-match slow-motion replay of the longest launch. */
  startReplay(data: ReplayData, onDone: () => void): void {
    this.replay.onDone = onDone;
    this.replay.start(
      data,
      (id) => this.colorOf(id),
      (id) => (id === this.youId ? this.viewModel.weapon : (this.remotes.get(id)?.man.weapon ?? null)),
      (id) => lookOf(this.roster.get(id)?.cos),
    );
    this.hud.show(false);
    this.audio.setCharge(0);
    this.audio.setBlower(0);
    this.announcer.say('Replay! Longest launch!', 3);
  }

  stopReplay(): void {
    if (this.replay.active) this.replay.stop();
    if (this.active) this.hud.show(true);
  }

  // --- Queries used by UI --------------------------------------------------------------------

  /** True during the final-30-seconds countdown. */
  get inFinal(): boolean {
    return this.match.phase === 'playing' && this.clock.tickAt(performance.now()) * DT >= this.world.collapseStart;
  }

  get alive(): boolean {
    return this.pred.mode !== MODE_DEAD;
  }

  aimDir(): { x: number; y: number; z: number } {
    return lookDir(this.input.yaw, this.input.pitch, tmpDir);
  }

  debugInfo(): string {
    return `pred ${this.pred.px.toFixed(1)},${this.pred.py.toFixed(1)},${this.pred.pz.toFixed(1)} hist ${this.history.length} r ${playerRadius(this.pred).toFixed(2)} h ${playerHeight(this.pred).toFixed(2)}`;
  }
}
