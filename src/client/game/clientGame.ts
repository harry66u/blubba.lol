import * as THREE from 'three';
import { BALANCE } from '../../shared/balance';
import { PLAYER_COLORS, TEAM_COLORS } from '../../shared/colors';
import { MODE_INFO, type ModeId, isTeamMode } from '../../shared/game/modes';
import { type ProgressReport, QUICK_CHAT, cosmeticKey } from '../../shared/economy';
import type { GameEvent } from '../../shared/game/events';
import { type InputFrame, emptyInput, quantizeInput } from '../../shared/input';
import { MAPS, getMap } from '../../shared/maps';
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
import {
  DEFAULT_LOADOUT,
  type Loadout,
  type Parts,
  STANDARD_PARTS,
  UTILITY_INFO,
  WEAPON_IDS,
  WEAPON_INFO,
  type WeaponStats,
  computeWeaponStats,
  normalizeParts,
  sanitizeLoadout,
} from '../../shared/loadout';
import { pelletDirs, shotDir, spreadAt } from '../../shared/shots';
import { EntityView } from '../render/entities';
import { GadgetView } from '../render/gadgets';
import { LOOT_INFO } from '../../shared/game/loot';
import { CHAOS_INFO, type ChaosEvent, type Environment, NORMAL_ENV, envAt } from '../../shared/game/chaos';
import { shrinkStageNear } from '../../shared/game/shrink';
import { Announcer } from '../audio/announcer';
import { ReplayView } from './replayView';
import type { ReplayData } from '../../shared/game/sim';
import type { Audio } from '../audio/audio';
import { type Action, type InputManager, codeLabel } from '../input/input';
import type { Connection } from '../net/connection';
import { Effects, LandingCircles, type Projectile3D, type ShotStyle, TRAIL_FLY_SPEED, type TrailState, newTrailState, shotStyleFor } from '../render/effects';
import { FART_INTERVAL } from '../render/characters';
import { faceTexture } from '../render/facePhoto';
import { MapView, type WarnArea } from '../render/mapView';
import { BeachBall } from '../render/beachBall';
import type { Renderer } from '../render/renderer';
import { type Look, TubeMan, defaultPose, lookFromCosmetics, type TubeManPose } from '../render/tubeMan';
import { Human, isHumanKey } from '../render/human';
import { ViewModel } from '../render/viewModel';
import { type Settings, saveSettings } from '../settings';
import { esc, hexColor } from '../ui/dom';
import type { Hud, Nametag } from '../ui/hud';
import { CRACKED_SHOT_DIST, koVerb } from '../ui/koWords';
import type { TeamView } from '../ui/menus';
import { CHASE, aimFromCamera, chaseCamera, rebaseMove } from './chaseCam';
import { ServerClock } from './clock';
import { TipCoach } from '../ui/tips';
import { TOUCH_LABELS, type TouchControls } from '../input/touch';
import { PROJ_BIG_BLOW, ULT_CHARACTER, ULT_INFO, type UltId, isUltProjectile, publicUlt, steerToward, ultOf, ultReady } from '../../shared/game/ults';
import { type UltPlayerView, UltView } from './ultView';

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
  /** Which face scan they're wearing ('' = the cartoon face). */
  faceKey: string;
  /** Inflation from your own confirmed hit, shown before the snapshots catch up. */
  inflHint: number;
  hintUntil: number;
  trail: TrailState;
  /** The character they turned into with their ult (drawn instead of the tube man), if any. */
  human: Human | null;
}


const TAUNT_TEXT: Record<string, string> = {
  burp: 'BUURRP!',
  wave: 'HI!',
  spin: 'WHEEE!',
  noodle: 'NOODLE!',
  flex: 'FLEX!',
  bow: 'THANK YOU!',
  dance: 'GROOVY!',
  deflate: 'PFFFSSSHH...',
  backflip: 'HUP!',
};
/** Visual versions of every sound pack (the game is fully playable muted). */
/** Characters taunt their own way (a taunt animation and a line), whatever taunt is equipped. */
const CHARACTER_TAUNTS: Record<string, { style: string; text: string; color: string }> = {
  bor: { style: 'flex', text: 'GAINS! 💉', color: '#ffd60a' },
  abag: { style: 'wave', text: 'SNIFF SNIFF... FOUND YOU', color: '#ffb38a' },
  sol: { style: 'bow', text: 'PFFFFRRRRT!', color: '#8ee000' },
  kesty: { style: 'dance', text: 'BEEP BOOP', color: '#7fe0ff' },
};

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
  style: ShotStyle;
  /** Homing (ult rockets, Chase shots): target and turn rate; flown step by step from `at` (seconds). */
  home?: number;
  turn?: number;
  at?: number;
}

interface LocalShot {
  p3: Projectile3D;
  serverId: number;
  life: number;
  exploded: boolean;
  boomAt: THREE.Vector3 | null;
  /** Gravity (lobbed shots). */
  g: number;
  style: ShotStyle;
  /** Blast radius to show if it lands. */
  blast: number;
  /** Fired during The Chase: curves toward this player. */
  home?: number;
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
  /** Supply crates, Air Mines, helium clouds and tornados. */
  readonly gadgets = new GadgetView();
  /** Players floating on helium, until this tick. */
  private floaters = new Map<number, number>();
  private lastDropToast = -99;
  loadout: Loadout = { ...DEFAULT_LOADOUT };
  /** The gadgets the server says you're carrying (usually your loadout's). */
  private equippedUtils: Loadout['utils'] = [...DEFAULT_LOADOUT.utils];
  weapon: WeaponStats = computeWeaponStats('airCannon', []);
  /** Parts of the weapon you're holding right now (changes apply on respawn). */
  private activeParts: Parts = { ...STANDARD_PARTS };
  /** Other players' weapon parts, from their loadout events (their guns look the part). */
  private readonly remoteParts = new Map<number, Parts>();
  private readonly pelletBuf: number[] = [];
  private readonly arcPts: number[] = [];
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
  private readonly warnTarget = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
  /** Sudden Death: who the camera follows while you're out (-1 = pick someone). */
  private spectateId = -1;
  /** Sudden Death: the winner was already called out this match. */
  private sdWinnerShown = false;
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
  /** Camera roll jolt when you get hit from the side (spring, visual only). */
  private rollP = 0;
  private rollV = 0;
  /** Your latest hit on each player: when, from how far, and their air combo. */
  private readonly myHits = new Map<number, { at: number; dist: number; combo: number }>();
  private deathAt = 0;
  private killerId = -1;
  /** How you were knocked out ("cracked"), for the respawn screen. */
  private deathVerb = 'popped';
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
  private readonly selfTrail = newTrailState();
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
  /** Show other players' face scans (Settings). Your own always shows. */
  showFaces = true;
  /** Who turned into a character with their ult, until when (see transformInto). */
  private readonly transforms = new Map<number, { body: string; until: number; at: number }>();
  /** Your own character body while transformed. */
  private selfHuman: Human | null = null;
  /** Faces the real BOR, ABAG, SOL and KESTY lent their characters (from /api/characters). */
  private characterFaces: Record<string, { account: number; v: number }> = {};
  private characterFacesAt = -1e9;
  /** Ult visuals, sounds and HUD (ultView.ts). */
  readonly ultView: UltView;

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
    this.mapView = new MapView(this.map, this.world, () => r.quality);
    this.ctx = this.makeCtx({ ...ALL_FEATURES });
    r.scene.add(this.mapView.root, this.effects.root, this.circles.root, this.entities.root, this.gadgets.root);
    this.gadgets.setMap(this.map);
    r.scene.add(r.camera);
    r.camera.add(this.viewModel.root);
    this.replay = new ReplayView(r.scene, this.effects);
    this.viewModel.root.visible = false;
    r.setTheme(this.map.theme);
    input.onAnyPress = (a) => {
      this.tips.used(a);
      // Out of a Sudden Death match: jump watches someone else.
      if (a === 'jump' && this.sdSpectating) this.spectateNext();
    };
    this.effects.camPos = r.camera.position;
    this.effects.camQuat = r.camera.quaternion;
    this.ultView = new UltView({
      youId: () => this.youId,
      pred: () => this.pred,
      alive: () => this.havePred && this.pred.mode !== MODE_DEAD,
      effects: this.effects,
      hud,
      audio,
      camera: r.camera,
      scene: r.scene,
      tick: () => this.clock.tickAt(performance.now()),
      lowQuality: () => r.quality === 'low',
      players: () => this.ultPlayers(),
      nameOf: (id) => this.nameOf(id),
      colorOf: (id) => this.colorOf(id),
      eyeOf: (id, out) => {
        // In first person your own laser would start inside the camera: only draw it in third person.
        if (id === this.youId) return this.selfMan?.group.visible ? this.selfMan.eyeWorld(out) : null;
        const rv = this.remotes.get(id);
        return rv?.man.group.visible ? rv.man.eyeWorld(out) : null;
      },
      jab: (id) => (id === this.youId ? this.selfMan?.jab() : this.remotes.get(id)?.man.jab()),
      keyOf: () => this.key('ult'),
      charFace: (kind) => {
        const c = ULT_CHARACTER[kind];
        const f = c ? this.characterFaces[c.body] : undefined;
        return f ? `/api/face/${f.account}?v=${f.v}` : null;
      },
      shake: (amount, fov) => {
        this.trauma = Math.min(1, this.trauma + amount);
        this.fovKick += fov;
      },
    });
  }

  /** Everyone as the ult visuals see them. */
  private ultPlayers(): UltPlayerView[] {
    const out: UltPlayerView[] = [];
    if (this.havePred && this.pred.mode !== MODE_DEAD) {
      const p = this.pred;
      out.push({ id: this.youId, ult: publicUlt(p), ultTarget: p.chaseTimer > 0 ? p.chaseTarget : -1, x: p.px, y: p.py, z: p.pz, head: p.py + BALANCE.player.height * inflationScale(p.inflation) + 0.3 });
    }
    for (const rv of this.remotes.values()) {
      const c = rv.cur;
      if (!c || c.mode === MODE_DEAD || !(rv.man.group.visible || rv.human)) continue;
      out.push({ id: rv.id, ult: c.ult, ultTarget: c.ultTarget, x: c.px, y: c.py, z: c.pz, head: c.py + (rv.human ?? rv.man).headHeight(c.inflation) });
    }
    return out;
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
    this.equippedUtils = [...l.utils];
    this.weapon = computeWeaponStats(l.weapon, l.parts);
    this.activeParts = { ...l.parts };
    this.ctx.weapon = this.weapon;
    this.viewModel.setWeapon(l.weapon, l.parts);
    this.hud.setUtilities(l.utils.map((u) => UTILITY_INFO[u].name));
  }

  private setMap(id: string): void {
    if (this.map.id === id && this.mapView) return;
    this.r.scene.remove(this.mapView.root);
    this.mapView.dispose();
    this.map = getMap(id);
    this.world = new World(this.map);
    this.mapView = new MapView(this.map, this.world, () => this.r.quality);
    this.r.scene.add(this.mapView.root);
    this.r.setTheme(this.map.theme);
    this.ctx = this.makeCtx(this.ctx.features);
    this.entities.clear();
    this.gadgets.clear();
    this.gadgets.setMap(this.map);
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
    this.gadgets.clear();
    this.floaters.clear();
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
    this.input.syncCounters({ jump: 0, dash: 0, brace: 0, grab: 0, grapple: 0, reload: 0, util1: 0, util2: 0, taunt: 0, ult: 0 });
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
    this.gadgets.clear();
    this.floaters.clear();
    this.ultView.clear();
    this.transforms.clear();
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
        // A new match (public rooms swap in a fresh one per map, so the number can repeat).
        if (msg.phase === 'playing' && this.match.phase !== 'playing') {
          this.spectateId = -1;
          this.sdWinnerShown = false;
        }
        this.match = { phase: msg.phase, endsAtTick: msg.endsAtTick, number: msg.number, result: msg.result };
        // The server's collapse plan: our world sinks and crumbles exactly like its world.
        this.world.setCollapse(msg.collapse ?? []);
        if (msg.phase === 'playing') this.announcer.say(this.mode === 'suddenDeath' ? 'Sudden death! Go!' : 'Go!', 2);
        if (msg.phase === 'results' && msg.result) {
          const teams = msg.result.teams;
          if (teams) {
            const mine = this.teamOf(this.youId);
            const names = this.teamNames();
            this.announcer.say(teams.winner < 0 ? "It's a draw!" : teams.winner === mine ? 'Your team wins!' : `${names[teams.winner]} team wins!`, 3);
          } else if (msg.result.survivors) {
            // Sudden Death: the winner was already called out if they were the last one standing.
            const w = msg.result.standings[0];
            if (w && msg.result.survivors.length > 1) this.announcer.say(`Time's up! ${w.id === this.youId ? 'You win!' : `${w.name} wins!`}`, 3);
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
        {
          const tick = Math.round(this.renderTick);
          for (const c of msg.crates ?? []) this.gadgets.addCrate(c.id, c.x, c.y, c.z, c.falling ? (this.world.groundBelow(c.x, c.y, c.z) ?? c.y) : c.y, c.fall, c.falling, tick);
          for (const m of msg.mines ?? []) this.gadgets.addMine(m.id, m.x, m.y, m.z, m.arm);
          for (const t of msg.tornados ?? []) this.gadgets.addTornado(t, tick);
        }
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
        return e.owner === you && (e.w === 0 || e.w === PROJ_BIG_BLOW);
      case 'boom':
      case 'fizzle':
        return this.localByServer.has(e.id);
      case 'loadout':
      case 'honk':
      case 'tracer':
      case 'pellets':
        return e.id === you;
      case 'tap':
        return e.attacker === you || e.target === you || this.localByServer.has(e.id);
      case 'chaos':
      case 'crown':
      case 'final':
      case 'shrink':
      case 'solid':
      case 'solidGone':
      case 'pad':
      case 'padGone':
        // The world must match the server for prediction, so these apply right away.
        return true;
      case 'pickup':
        return e.by === you;
      case 'lootGrab':
        return e.by === you;
      case 'floaty':
        return e.id === you;
      case 'swept':
        return e.target === you;
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
      case 'ult':
      case 'fart':
        return e.id === you;
      case 'sniff':
      case 'gotcha':
        return e.id === you || e.target === you;
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

  /** What a player looks like (accents and shine are dropped in team modes, see lookFromCosmetics). */
  private lookOf(id: number): Look {
    const entry = this.roster.get(id);
    return lookFromCosmetics(entry?.cos, entry?.color ?? 0, this.teamMode);
  }

  /** The character someone turned into with their ult, while it lasts. */
  private transformOf(id: number): { body: string; until: number; at: number } | null {
    const t = this.transforms.get(id);
    if (t && t.until <= this.time) this.transforms.delete(id);
    return t && t.until > this.time ? t : null;
  }

  /** Popping an ult turns you into its regular (BOR, ABAG, SOL or KESTY) for a few seconds. */
  private transformInto(id: number, kind: UltId, x: number, y: number, z: number): void {
    const c = ULT_CHARACTER[kind];
    if (!c) return;
    this.transforms.set(id, { body: c.body, until: this.time + c.seconds, at: this.time });
    this.effects.airPuff(x, y + 1.2, z, 12, 7, 0.3);
    this.effects.confettiBurst(x, y + 1.5, z, 24);
    if (id !== this.youId) this.hud.popup(tmpV.set(x, y + 3.4, z), `${c.name}!`, c.color, 1.4, 1.3, false);
  }

  /** The face lent to the character a player turned into, if an admin approved one. */
  private charFaceOf(id: number): { account: number; v: number } | null {
    if (!this.showFaces && id !== this.youId) return null;
    const t = this.transformOf(id);
    return t ? (this.characterFaces[t.body] ?? null) : null;
  }

  /** Fetches the approved character faces now and then (they rarely change). */
  private refreshCharacterFaces(): void {
    if (this.time - this.characterFacesAt < 60) return;
    this.characterFacesAt = this.time;
    fetch('/api/characters')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { faces?: Record<string, { account: number; v: number }> } | null) => {
        if (d?.faces) this.characterFaces = d.faces;
      })
      .catch(() => undefined);
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
        if (e.owner === you && (e.w === 0 || e.w === PROJ_BIG_BLOW)) {
          // Link the server's projectile to the one we already drew.
          let local = e.cs !== undefined ? this.localShots.get(-e.cs) : undefined;
          if (local && e.w === PROJ_BIG_BLOW && !local.p3.custom) {
            // The server had loaded a Big Blow we didn't know about yet: draw that instead.
            fx.removeProjectile(-e.cs!);
            this.localShots.delete(-e.cs!);
            local = undefined;
          }
          if (local) {
            local.serverId = e.id;
            this.localByServer.set(e.id, -e.cs!);
          } else {
            const key = -100000 - e.id;
            const big = e.w === PROJ_BIG_BLOW;
            const style = big ? 'air' : shotStyleFor(e.wi);
            const p3 = fx.addProjectile(key, e.x, e.y, e.z, e.vx, e.vy, e.vz, e.r, undefined, e.w, style);
            this.localShots.set(key, {
              p3,
              serverId: e.id,
              life: big ? BALANCE.ults.bigBlow.lifetime : this.weapon.projLifetime,
              exploded: false,
              boomAt: null,
              g: e.g ?? 0,
              style,
              blast: big ? BALANCE.ults.bigBlow.blastRadius : this.weapon.blastRadius,
            });
            this.localByServer.set(e.id, key);
            if (big) this.ultView.onShot(e);
          }
        } else {
          const style = e.w === 0 ? shotStyleFor(e.wi) : 'air';
          const p3 = fx.addProjectile(e.id, e.x, e.y, e.z, e.vx, e.vy, e.vz, e.r, undefined, e.w, style);
          this.remoteShots.set(e.id, { id: e.id, g: e.g ?? 0, tick: e.tick, x: e.x, y: e.y, z: e.z, vx: e.vx, vy: e.vy, vz: e.vz, p3, style, home: e.home, turn: e.turn });
          if (isUltProjectile(e.w)) {
            this.ultView.onShot(e);
          } else if (e.w === 0) {
            const pos: [number, number, number] = [e.x, e.y, e.z];
            const sp = Math.hypot(e.vx, e.vy, e.vz) || 1;
            if (style === 'cork') {
              a.popShot(pos);
              fx.muzzleFlash(e.x, e.y, e.z, e.vx / sp, e.vy / sp, e.vz / sp, 0.15);
            } else if (style === 'balloon') {
              a.mortarLaunch(e.power, pos);
              fx.muzzleFlash(e.x, e.y, e.z, e.vx / sp, e.vy / sp, e.vz / sp, e.power * 0.8);
              fx.airPuff(e.x, e.y, e.z, 8, 3, 0.3);
            } else {
              a.shoot(e.power, pos);
              fx.muzzleFlash(e.x, e.y, e.z, e.vx / sp, e.vy / sp, e.vz / sp, e.power);
            }
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
            if (!ls.exploded || shownFar) this.showBlast(e.x, e.y, e.z, e.r, e.power, ls.style);
            fx.removeProjectile(localKey);
            this.localShots.delete(localKey);
          }
          if (isUltProjectile(e.k)) this.ultView.onBoom(e);
        } else {
          const rs = this.remoteShots.get(e.id);
          if (rs) {
            fx.removeProjectile(e.id);
            this.remoteShots.delete(e.id);
          }
          this.showBlast(e.x, e.y, e.z, e.r, e.power, rs?.style ?? 'air');
          if (isUltProjectile(e.k)) {
            this.ultView.onBoom(e);
          } else if (e.k) {
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
          if (e.home !== undefined) {
            // A rocket locked on to someone mid-flight: fly on from here.
            rs.home = e.home;
            rs.at = undefined;
          } else {
            a.thud([e.x, e.y, e.z], 3);
          }
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
      case 'loot': {
        this.gadgets.addCrate(e.id, e.x, e.y, e.z, e.groundY, e.fall, true, e.tick);
        // One notice per wave of drops, so a burst of crates doesn't spam the screen.
        if (this.time - this.lastDropToast > 4) {
          this.lastDropToast = this.time;
          this.hud.toast('📦 Supply drop incoming! Grab it before anyone else.', 2600);
          a.supplyDrop();
        }
        break;
      }
      case 'lootLand':
        this.gadgets.landCrate(e.id, e.x, e.y, e.z, e.tick);
        break;
      case 'lootGrab': {
        this.gadgets.removeCrate(e.id);
        const info = LOOT_INFO[e.kind];
        fx.confettiBurst(e.x, e.y + 0.6, e.z, 40, [0xffa630, 0x2ec5ff, 0xffffff, 0xffd60a]);
        fx.shockwave(e.x, e.y + 0.6, e.z, 2.2, 0.35, 0xffd60a, false, this.r.camera.position);
        const p = this.posOf(e.by);
        const at = p ? tmpV.set(p.x, p.y + 2.8, p.z) : tmpV.set(e.x, e.y + 2, e.z);
        this.hud.popup(at, `${info.icon} ${info.name.toUpperCase()}!`, info.color, 1.1, 1.5, e.by !== you);
        if (e.by === you) {
          this.hud.toast(`${info.icon} ${info.name}! ${info.blurb}.`, 3200);
          this.hud.flash('rgba(255, 214, 10, 0.35)', 300);
          a.powerUp();
        } else {
          a.lootGrab([e.x, e.y, e.z]);
          this.hud.addKill(`<b style="color:${hexColor(this.colorOf(e.by))}">${esc(this.nameOf(e.by))}</b> grabbed ${info.icon} <b>${esc(info.name)}</b>`, false);
        }
        break;
      }
      case 'lootGone': {
        const v = this.gadgets.removeCrate(e.id);
        if (v && e.why !== 'reset') fx.airPuff(v.state.x, v.state.y + 0.5, v.state.z, 10, 2, 0.3, 0xffe0a0);
        break;
      }
      case 'mine': {
        const rs = this.remoteShots.get(e.proj);
        if (rs) {
          fx.removeProjectile(e.proj);
          this.remoteShots.delete(e.proj);
        }
        this.gadgets.addMine(e.id, e.x, e.y, e.z, e.arm);
        a.beep([e.x, e.y, e.z]);
        break;
      }
      case 'mineGone': {
        this.gadgets.removeMine(e.id);
        if (e.boom) {
          const R = BALANCE.utilities.airMine.radius;
          this.showBlast(e.x, e.y + 0.4, e.z, R, 1.2);
          fx.groundRing(e.x, e.y, e.z, 2, 0xff5a7a);
          fx.airPuff(e.x, e.y + 0.3, e.z, 16, 7, 0.3);
          a.kaboom(e.owner === you ? null : [e.x, e.y, e.z]);
          this.hud.popup(tmpV.set(e.x, e.y + 2, e.z), 'KA-BLAM!', '#ff5a7a', 1.5, 1.1);
          if (e.owner === you) this.hud.callout('MINE TRIGGERED!', '', 1.2, '#ff5a7a');
        } else {
          fx.airPuff(e.x, e.y + 0.2, e.z, 5, 1.2, 0.18);
        }
        break;
      }
      case 'helium': {
        if (this.remoteShots.has(e.id)) {
          fx.removeProjectile(e.id);
          this.remoteShots.delete(e.id);
        }
        this.gadgets.addCloud(e.x, e.y, e.z, e.r, e.until);
        fx.confettiBurst(e.x, e.y, e.z, 24, [0xffb3e6, 0xffffff, 0xd9c2ff]);
        a.helium([e.x, e.y, e.z]);
        this.hud.popup(tmpV.set(e.x, e.y + 1.5, e.z), 'FWSSSH!', '#ff8fd8', 1.2, 1.1, true);
        break;
      }
      case 'floaty': {
        this.floaters.set(e.id, e.until);
        if (e.id === you) {
          this.hud.callout('FLOATING!', 'Helium! You drift up and fly farther when hit. Dash to steer.', 1.8, '#ff8fd8');
        } else {
          const p = this.posOf(e.id);
          if (p) this.hud.popup(tmpV.set(p.x, p.y + 2.8, p.z), 'WHEEE!', '#ff8fd8', 0.9, 1, true);
        }
        break;
      }
      case 'tornado': {
        this.gadgets.addTornado({ id: e.id, owner: e.owner, x: e.x, y: e.y, z: e.z, dx: e.dx, dz: e.dz, speed: e.speed, until: e.until }, e.tick);
        fx.groundRing(e.x, e.y, e.z, 1.6, 0xe8f0ff);
        this.hud.popup(tmpV.set(e.x, e.y + 3, e.z), 'WHOOOSH!', '#cfe6ff', 1.2, 1.1, e.owner !== you);
        break;
      }
      case 'tornadoGone': {
        const v = this.gadgets.removeTornado(e.id);
        if (v) fx.airPuff(v.state.x, v.state.y + 2, v.state.z, 14, 4, 0.4, 0xeef4ff);
        break;
      }
      case 'swept': {
        if (e.target === you) {
          this.hud.callout('CAUGHT IN A TORNADO!', 'Dash to break out!', 1.4, '#9fd4ff');
          this.trauma = Math.min(1, this.trauma + 0.3);
        } else {
          const p = this.posOf(e.target);
          if (p) this.hud.popup(tmpV.set(p.x, p.y + 2.6, p.z), 'WHIRL!', '#cfe6ff', 1, 1, true);
        }
        break;
      }
      case 'loadout':
        if (e.id === you) this.applyWeapon(sanitizeLoadout(e));
        else this.remoteParts.set(e.id, normalizeParts(e.parts));
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
        if (this.mode === 'suddenDeath') {
          this.hud.callout('FINAL 30 SECONDS!', 'Still standing at the buzzer? Most knockouts wins.', 3, '#ff3b5c');
          this.announcer.say('Final thirty seconds!', 4);
        } else {
          this.hud.callout('FINAL 30 SECONDS!', 'The map is collapsing! Knockouts count DOUBLE!', 3, '#ff3b5c');
          this.announcer.say('Final thirty seconds! Knockouts count double!', 4);
        }
        a.siren();
        this.trauma = Math.min(1, this.trauma + 0.3);
        break;
      case 'shrink': {
        const secs = Math.max(1, Math.round((e.startTick - e.tick) * DT));
        const sub = e.sink.length
          ? `Pieces flashing red fall in ${secs}s${e.deck > 0 ? ' and the edges crumble' : ''}. Get off them!`
          : `The edges crumble in ${secs}s. Get to the middle!`;
        this.hud.callout('THE MAP IS SHRINKING!', sub, 3.2, '#ff3b5c');
        a.siren();
        this.announcer.say('The map is shrinking!', 4);
        this.trauma = Math.min(1, this.trauma + 0.2);
        break;
      }
      case 'survivors':
        this.survivorsCallout(e.left, e.winner);
        break;
      case 'fizzle': {
        const localKey = this.localByServer.get(e.id);
        let style: ShotStyle = 'air';
        if (localKey !== undefined) {
          const ls = this.localShots.get(localKey);
          if (ls) style = ls.style;
          fx.removeProjectile(localKey);
          this.localShots.delete(localKey);
          this.localByServer.delete(e.id);
        } else if (this.remoteShots.has(e.id)) {
          style = this.remoteShots.get(e.id)!.style;
          fx.removeProjectile(e.id);
          this.remoteShots.delete(e.id);
        }
        if (style === 'cork') fx.corkPop(e.x, e.y, e.z);
        else fx.airPuff(e.x, e.y, e.z, 6, 1.5, 0.3);
        break;
      }
      case 'tap': {
        // A Pop Gun cork landed: a light push, not a launch.
        const localKey = this.localByServer.get(e.id);
        if (localKey !== undefined) {
          fx.removeProjectile(localKey);
          this.localShots.delete(localKey);
          this.localByServer.delete(e.id);
        } else if (this.remoteShots.has(e.id)) {
          fx.removeProjectile(e.id);
          this.remoteShots.delete(e.id);
        }
        fx.corkPop(e.x, e.y, e.z, true);
        a.corkTap(e.infl, e.target === you ? null : [e.x, e.y, e.z]);
        if (e.attacker === you && e.target !== you) {
          this.hud.hitMarker(0.15);
          if (Math.random() < 0.35) this.audio.hitConfirm(0.12);
        }
        if (e.target === you) this.trauma = Math.min(1, this.trauma + 0.03);
        break;
      }
      case 'pellets': {
        if (e.id !== you) {
          const rv = this.remotes.get(e.id);
          const from = rv?.man.muzzleWorld(new THREE.Vector3()) ?? new THREE.Vector3(e.x, e.y, e.z);
          const dirs = pelletDirs(e.dx, e.dy, e.dz, e.spread, e.ends.length, this.pelletBuf);
          const ends: number[] = [];
          for (let i = 0; i < e.ends.length; i++) ends.push(e.x + dirs[i * 3] * e.ends[i], e.y + dirs[i * 3 + 1] * e.ends[i], e.z + dirs[i * 3 + 2] * e.ends[i]);
          fx.bubbleVolley(from.x, from.y, from.z, ends, e.power);
          fx.muzzleFlash(from.x, from.y, from.z, e.dx, e.dy, e.dz, e.power * 0.6);
          a.bubbleBlast(e.power, [e.x, e.y, e.z]);
          if (rv) rv.man.group.userData.kick = 1;
        }
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
        if (e.target === you) this.feelHit(e);
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
              ? `<b style="color:${kc}">${esc(killerName)}</b> ${this.verbFor(e)} <b style="color:${vc}">${esc(victimName)}</b>${suffix}`
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
          this.deathVerb = this.verbFor(e);
          this.deathPos.set(e.x, Math.max(e.y, -6), e.z);
          this.audio.setCharge(0);
        }
        if (e.victim === you && e.killer >= 0) this.nemesisId = e.killer;
        // Spectating in Sudden Death: follow the action to whoever popped the one we watched.
        if (e.victim === this.spectateId) this.spectateId = e.killer;
        if (e.killer === you && e.victim === this.nemesisId) this.nemesisId = -1;
        this.koCallout(e, killerName, victimName);
        const rv = this.remotes.get(e.victim);
        if (rv) rv.man.setVisible(false);
        break;
      }
      case 'spawn': {
        // Back to yourself after a knockout, whatever you'd turned into.
        this.transforms.delete(e.id);
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
        const body = cosmeticKey(cos, 'body');
        const sig = CHARACTER_TAUNTS[body];
        const style = sig?.style ?? cosmeticKey(cos, 'taunt');
        const pack = cosmeticKey(cos, 'sound');
        this.remotes.get(e.id)?.man.taunt(style);
        if (e.id === this.youId) this.selfMan?.taunt(style);
        if (p && sig) {
          // The characters' signature taunts.
          const at: [number, number, number] | null = e.id === you ? null : [p.x, p.y, p.z];
          this.hud.popup(tmpV.set(p.x, p.y + 3, p.z), sig.text, sig.color, 1.2, 1.4, e.id !== you);
          if (body === 'sol') {
            // Bent over, a massive fart and a green shockwave along the floor.
            fx.fartCloud(p.x, p.y, p.z, 0, 0, true);
            fx.shockwave(p.x, p.y + 0.05, p.z, 4.5, 0.5, 0x8ee000, true);
            a.fart(at);
          } else if (body === 'kesty') {
            for (let i = 0; i < 10; i++) fx.sparkle(p.x + (Math.random() - 0.5) * 1.4, p.y + Math.random() * 1.6, p.z + (Math.random() - 0.5) * 1.4);
            a.pop(at);
          } else {
            a.pop(at);
          }
        } else if (p) {
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
      case 'ult':
        this.transformInto(e.id, e.kind, e.x, e.y, e.z);
        this.ultView.onEvent(e);
        break;
      case 'fart':
      case 'sniff':
      case 'gotcha':
        this.ultView.onEvent(e);
        break;
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

  /** Your last hit on this knockout's victim, if you're the one who knocked them out. */
  private myLastHit(e: Extract<GameEvent, { t: 'ko' }>): { dist: number; combo: number } | null {
    if (e.killer !== this.youId || e.victim === this.youId) return null;
    const last = this.myHits.get(e.victim);
    return last && this.time - last.at <= BALANCE.knockback.creditWindow ? last : null;
  }

  /** Your long-range knockouts are always "cracked". */
  private verbFor(e: Extract<GameEvent, { t: 'ko' }>): string {
    return (this.myLastHit(e)?.dist ?? 0) >= CRACKED_SHOT_DIST ? 'cracked' : koVerb(e);
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
    const mine = e.killer === you && e.victim !== you;
    const last = this.myLastHit(e);
    const longShot = !!last && last.dist >= CRACKED_SHOT_DIST;
    const juggled = !!last && last.combo >= 3;
    const verb = this.verbFor(e);
    this.myHits.delete(e.victim);
    if (mine) {
      // The knockout pays off: gold flash, confetti where they went flying, and the score.
      this.hud.tallyKo(`${verb.toUpperCase()}!`, e.points);
      this.hud.flash('rgba(255, 200, 40, 0.4)', 380);
      const B = this.map.blast;
      this.effects.confettiBurst(
        Math.max(B.minX + 4, Math.min(B.maxX - 4, e.x)),
        Math.max(-4, Math.min(30, e.y)) + 1,
        Math.max(B.minZ + 4, Math.min(B.maxZ - 4, e.z)),
        40,
      );
      this.fovKick += 5;
    }
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
    } else if (longShot) {
      main = 'CRACKED SHOT!';
      line = 'Cracked!';
      color = '#2ec5ff';
      priority = 3;
    } else if (juggled) {
      main = 'JUGGLED!';
      line = 'Juggled!';
      color = '#ff5fd2';
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
      const far = longShot ? ` from ${Math.round(last.dist)} m` : '';
      sub = e.killer === you ? `You ${verb} ${victimName}${far}${pts}` : `${killerName} ${verb} ${victimName}`;
      this.hud.callout(main, sub, 2, color);
      this.announcer.say(line, priority);
      this.audio.koConfirm();
    } else if (mine) {
      this.audio.koConfirm();
      this.hud.callout(`${verb.toUpperCase()}!`, `${victimName}${pts}`, 1.8);
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
    const t = tick * DT;
    const st = this.match.phase === 'playing' ? shrinkStageNear(this.world.plan, t) : null;
    const shrinkText = st ? (t < st.at ? `MAP SHRINKING in ${Math.ceil(st.at - t)}...` : 'MAP SHRINKING!') : '';
    this.hud.setEvent([shrinkText, banner].filter(Boolean).join('  ·  '));
    this.updateCollapseFx(t, dt);
  }

  /**
   * The map falling apart: red flashing areas over pieces about to go (and the deck's edge band
   * about to crumble), plus debris off their edges while they warn, sink and crumble.
   */
  private updateCollapseFx(t: number, dt: number): void {
    const w = this.world;
    const playing = this.match.phase === 'playing' && w.plan.length > 0;
    const flash = 0.5 + 0.5 * Math.sin(this.time * 13);
    this.debrisTimer -= dt;
    const burst = this.debrisTimer <= 0;
    if (burst) this.debrisTimer = 0.08;
    for (let id = 0; id < w.staticCount; id++) {
      const s = w.solids[id];
      if (s.collapse < 0) continue;
      let area: WarnArea | null = null;
      let debris = 0;
      if (playing && s.collapse > 0) {
        const start = w.sinkStart(s.collapse);
        const warn = w.plan.find((x) => x.at === start)?.warn ?? 0;
        if (s.enabled && t >= start - warn && t < start + 3) {
          const cx = (s.minX + s.maxX) / 2;
          const cz = (s.minZ + s.maxZ) / 2;
          area = { minX: s.minX, maxX: s.maxX, minZ: s.minZ, maxZ: s.maxZ, inMinX: cx, inMaxX: cx, inMinZ: cz, inMaxZ: cz, y: s.maxY, innerLine: false };
        }
        if (s.enabled && t >= start - warn) debris = t < start ? 0.35 : 1;
      } else if (playing) {
        const stage = w.plan.find((x) => x.deck > 0 && t >= x.at - x.warn && t < x.at + x.deckTime);
        if (stage) {
          const to = w.deckBoundsAt(s, stage.at + stage.deckTime, this.warnTarget);
          area = { minX: s.minX, maxX: s.maxX, minZ: s.minZ, maxZ: s.maxZ, inMinX: to.minX, inMaxX: to.maxX, inMinZ: to.minZ, inMaxZ: to.maxZ, y: s.maxY, innerLine: true };
          debris = t < stage.at ? 0.35 : 1;
        }
      }
      this.mapView.setWarning(id, area, flash);
      if (!burst || debris <= 0) continue;
      // Bigger pieces shed more bits so the whole edge visibly crumbles.
      const n = Math.max(1, Math.round(((s.maxX - s.minX + s.maxZ - s.minZ) / 20) * debris));
      for (let i = 0; i < n; i++) {
        if (Math.random() > debris) continue;
        const edge = Math.floor(Math.random() * 4);
        const u = Math.random();
        const x = edge < 2 ? s.minX + u * (s.maxX - s.minX) : edge === 2 ? s.minX : s.maxX;
        const z = edge >= 2 ? s.minZ + u * (s.maxZ - s.minZ) : edge === 0 ? s.minZ : s.maxZ;
        this.effects.debris(x, s.maxY, z);
      }
    }
  }

  /** Sudden Death: players still in after someone went out (and the winner, once it's decided). */
  private survivorsCallout(left: number[], w: number): void {
    const you = this.youId;
    const n = left.length;
    if (w >= 0) {
      if (this.sdWinnerShown) return;
      this.sdWinnerShown = true;
      const mine = w === you;
      // Usually the last one standing; rarely the last ones go out together and the tie-break decides.
      const how = n === 1 ? 'the last tube man standing' : 'the last one out';
      this.hud.callout(mine ? 'WINNER!' : `${this.nameOf(w).toUpperCase()} WINS!`, mine ? `You're ${how}!` : `${this.nameOf(w)} is ${how}!`, 3.5, '#ffd60a');
      this.announcer.say(mine ? 'Winner! You are the last one standing!' : `Winner! ${this.nameOf(w)}!`, 5);
      this.audio.goalHorn();
      const p = this.posOf(w);
      if (p) this.effects.confettiBurst(p.x, p.y + 3, p.z, 160);
      if (mine) this.hud.flash('rgba(255, 214, 10, 0.5)', 600);
      this.spectateId = w;
      this.hud.addKill(`🏆 <b style="color:${hexColor(this.colorOf(w))}">${esc(this.nameOf(w))}</b> wins!`, mine);
      return;
    }
    if (n === 0) return;
    const youIn = left.includes(you);
    if (n === 2) {
      this.hud.callout('FINAL SHOWDOWN!', left.map((id) => (id === you ? 'YOU' : this.nameOf(id))).join('  vs  '), 3, '#ff5fd2');
      this.announcer.say('Final showdown!', 4);
      this.audio.siren();
    } else if (n === 3) {
      this.hud.callout('LAST 3!', youIn ? "You're still in. Stay on!" : 'Three tube men left standing', 2.5, '#ff9f1c');
      this.announcer.say('Last three!', 3);
    }
    this.hud.addKill(`<b>${n}</b> players left`, false);
  }

  /** Out of a Sudden Death match (popped, or waiting for the next one) and watching. */
  get sdSpectating(): boolean {
    return this.mode === 'suddenDeath' && this.match.phase === 'playing' && !!this.roster.get(this.youId)?.out;
  }

  private stillIn(id: number): boolean {
    const r = this.roster.get(id);
    return id !== this.youId && !!r && !r.out && this.remotes.get(id)?.cur?.mode !== MODE_DEAD;
  }

  /** Who a Sudden Death spectator watches: the same player, else whoever popped them, else the leader. */
  private spectateTarget(): number {
    if (this.spectateId >= 0 && this.stillIn(this.spectateId)) return this.spectateId;
    if (this.killerId >= 0 && this.stillIn(this.killerId) && this.spectateId === -1) return (this.spectateId = this.killerId);
    let best = -1;
    let bestKos = -1;
    for (const r of this.roster.values()) {
      if (this.stillIn(r.id) && r.kos > bestKos) {
        best = r.id;
        bestKos = r.kos;
      }
    }
    return (this.spectateId = best);
  }

  /** Watch the next player still in. */
  private spectateNext(): void {
    const ids = [...this.roster.keys()].filter((id) => this.stillIn(id)).sort((a, b) => a - b);
    if (!ids.length) return;
    const i = ids.indexOf(this.spectateTarget());
    this.spectateId = ids[(i + 1) % ids.length];
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

  private showBlast(x: number, y: number, z: number, r: number, power: number, style: ShotStyle = 'air'): void {
    if (style === 'balloon') {
      this.effects.splash(x, y, z, r, power, this.r.camera.position);
      this.audio.splash(power, [x, y, z]);
      this.hud.popup(tmpV.set(x, y + 1.2, z), 'SPLOOSH!', '#3ab8ff', 1 + power * 0.4, 0.9, true);
    } else {
      this.effects.blast(x, y, z, r, power, this.r.camera.position);
      this.audio.whoosh(power, [x, y, z]);
    }
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
      case 'spring':
        fx.groundRing(e.x, e.y, e.z, 1.2, 0xff9fd0);
        a.boing(pos, true);
        this.hud.popup(tmpV.set(e.x, e.y + 2, e.z), 'SPROING!', '#ff5fd2', 1, 0.9, true);
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
      fx.groundRing(p.px, p.py, p.pz, out.springJump ? 1.2 : 0.5, out.springJump ? 0xff9fd0 : 0xffffff);
      a.boing(null, out.springJump);
      if (out.springJump) this.hud.popup(tmpV.set(p.px, p.py + 0.5, p.pz), 'SPROING!', '#ff5fd2', 1, 0.9);
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
    if (out.ult || out.fartBlast) this.ultView.localStep(out.ult, out.fartBlast);
    if (out.taunt) {
      a.burp(null);
    }
  }

  private fireLocal(out: StepResult): void {
    const f = out.fired!;
    const w = this.weapon;
    if (f.ult) {
      // Big Blow: one giant air ball, whatever you carry.
      const B = BALANCE.ults.bigBlow;
      this.viewModel.kick(2.4);
      this.punchV += 4;
      this.muzzlePos(tmpV);
      this.ultView.localBigBlow(tmpV.x, tmpV.y, tmpV.z, f.dx, f.dy, f.dz);
      const key = -this.seq;
      const p3 = this.effects.addProjectile(key, f.ox, f.oy, f.oz, f.dx * B.projSpeed, f.dy * B.projSpeed, f.dz * B.projSpeed, B.radius, tmpV, PROJ_BIG_BLOW);
      this.localShots.set(key, { p3, serverId: -1, life: B.lifetime, exploded: false, boomAt: null, g: 0, style: 'air', blast: B.blastRadius });
      return;
    }
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
    if (w.kind === 'spread') {
      // Bubble Shotgun: the same fixed pellet ring the server uses, drawn to where each pellet stops.
      this.viewModel.kick(f.power * 1.3);
      this.audio.bubbleBlast(f.power, null);
      this.trauma = Math.min(1, this.trauma + 0.1 + f.power * 0.2);
      this.punchV += 0.7 + f.power * 1.4;
      this.fovKick += 1.5 + f.power * 3;
      this.muzzlePos(tmpV);
      const dirs = pelletDirs(f.dx, f.dy, f.dz, spreadAt(w, f.charge), w.pellets, this.pelletBuf);
      const ends: number[] = [];
      for (let i = 0; i < dirs.length; i += 3) {
        const end = this.localRay(f.ox, f.oy, f.oz, dirs[i], dirs[i + 1], dirs[i + 2], w.range, w.rayRadius);
        ends.push(end.x, end.y, end.z);
      }
      this.effects.bubbleVolley(tmpV.x, tmpV.y, tmpV.z, ends, f.power);
      this.effects.muzzleFlash(tmpV.x, tmpV.y, tmpV.z, f.dx, f.dy, f.dz, f.power * 0.5);
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
    const style: ShotStyle = w.light ? 'cork' : w.projGravity > 0 ? 'balloon' : 'air';
    const kick = (f.mega ? 1.6 : 1) * (style === 'cork' ? 0.25 : style === 'balloon' ? 1.4 : 1);
    this.viewModel.kick(f.power * kick);
    if (style === 'cork') this.audio.popShot(null);
    else if (style === 'balloon') this.audio.mortarLaunch(f.power, null);
    else this.audio.shoot(f.power, null);
    this.trauma = Math.min(1, this.trauma + (0.1 + f.power * 0.2) * kick);
    this.punchV += (0.5 + f.power * 1.3) * kick;
    this.fovKick += (1 + f.power * 3) * kick;
    const key = -this.seq;
    this.muzzlePos(tmpV);
    this.effects.muzzleFlash(tmpV.x, tmpV.y, tmpV.z, f.dx, f.dy, f.dz, f.power * 0.6 * kick);
    const r = w.projRadius * (0.75 + 0.25 * f.power) * (f.mega ? M.megaRadius : 1);
    const blast = w.blastRadius * (f.mega ? M.megaBlast : 1);
    const d = shotDir(w, f.dx, f.dy, f.dz, tmpDir);
    const p3 = this.effects.addProjectile(key, f.ox, f.oy, f.oz, d.x * w.projSpeed, d.y * w.projSpeed, d.z * w.projSpeed, r, tmpV, 0, style);
    // The Chase: the shot curves toward whoever you're hunting (as the server's does).
    const home = this.pred.chaseTimer > 0 && this.pred.chaseTarget >= 0 ? this.pred.chaseTarget : undefined;
    this.localShots.set(key, { p3, serverId: -1, life: w.projLifetime, exploded: false, boomAt: null, g: w.projGravity, style, blast, home });
    if (style !== 'cork') this.effects.airPuff(tmpV.x, tmpV.y, tmpV.z, style === 'balloon' ? 9 : 5, 2, style === 'balloon' ? 0.22 : 0.12);
  }

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
    this.refreshCharacterFaces();
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
    this.ultView.update(dt);
    this.mapView.update(dt, this.time);
    for (const v of this.entities.vacuums) this.effects.vacuumSwirl(v.x, v.y, v.z, BALANCE.utilities.vacuumGrenade.radius, dt);
    this.entities.update(dt, this.clock.tickAt(performance.now()));
    this.gadgets.update(
      dt,
      this.renderTick,
      this.world,
      this.effects,
      this.r.camera.position,
      (x, y, z) => {
        this.effects.groundRing(x, y, z, 1.1, 0xffe0a0);
        this.audio.thud([x, y, z], 10);
      },
      (x, y, z) => this.audio.tornadoWind([x, y, z]),
    );
    this.updateFloaters();
    // Low graphics: trails leave half as many pieces.
    this.effects.trailDensity = this.r.quality === 'low' ? 0.5 : 1;
    this.effects.update(dt);
    this.updateCircles();
    this.hud.updatePopups(this.r.camera, dt);
  }

  /** Bubbles around anyone floating on helium (and a feathery trail on you). */
  private updateFloaters(): void {
    const tick = this.renderTick;
    for (const [id, until] of this.floaters) {
      if (tick >= until) {
        this.floaters.delete(id);
        continue;
      }
      if (id === this.youId) continue;
      const p = this.posOf(id);
      if (p && Math.random() < 0.6) this.effects.heliumFizz(p.x, p.y + 1.2, p.z, 0.9, 1);
    }
    const me = this.pred;
    if (this.havePred && me.mode !== MODE_DEAD && (me.heliumTimer > 0 || me.floatTimer > 0) && Math.random() < 0.35) {
      if (me.heliumTimer > 0) this.effects.heliumFizz(me.px, me.py + 0.4, me.pz, 0.8, 1);
      else this.effects.sparkle(me.px + (Math.random() - 0.5), me.py + 0.2, me.pz + (Math.random() - 0.5));
    }
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
          cur.ult = src.ult;
          cur.ultTarget = src.ultTarget;
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

  /** When each SOL lets the next one go. */
  private readonly nextFart = new Map<number, number>();

  /**
   * Little things characters do on their own: SOL farts constantly (a small green puff out the
   * back every couple of seconds). Skipped far from the camera.
   */
  private characterIdle(id: number, x: number, y: number, z: number, yaw: number): void {
    if (cosmeticKey(this.roster.get(id)?.cos, 'body') !== 'sol' && this.transformOf(id)?.body !== 'sol') return;
    const next = this.nextFart.get(id);
    const [lo, hi] = FART_INTERVAL;
    if (next === undefined) {
      this.nextFart.set(id, this.time + lo + Math.random() * (hi - lo));
      return;
    }
    if (this.time < next) return;
    this.nextFart.set(id, this.time + lo + Math.random() * (hi - lo));
    if (this.r.camera.position.distanceToSquared(tmpV3.set(x, y, z)) > 45 * 45) return;
    // Out the back, away from where he's facing.
    this.effects.fartCloud(x, y, z, -Math.sin(yaw), -Math.cos(yaw), false);
    if (Math.random() < 0.3) this.hud.popup(tmpV3.set(x, y + 1.2, z), 'pfft', '#9ed84a', 0.6, 0.7, true);
  }

  /** The face scan to show for a roster entry ('' = none, or face scans turned off). */
  private faceKeyOf(entry: RosterEntry | undefined): string {
    if (!entry?.face || (!this.showFaces && entry.id !== this.youId)) return '';
    return `${entry.face.account}.${entry.face.v}`;
  }

  /** The face texture for a roster entry's own face scan. */
  private faceTexOf(entry: RosterEntry | undefined): THREE.Texture | null {
    return this.faceKeyOf(entry) && entry?.face ? faceTexture(entry.face.account, entry.face.v) : null;
  }

  /**
   * While someone's ult has turned them into a character, that character's body is drawn instead
   * of their tube man (with the real person's face if they lent it). Returns the body, or null.
   */
  private humanFor(id: number, current: Human | null): Human | null {
    const t = this.transformOf(id);
    const key = t && isHumanKey(t.body) ? t.body : null;
    if (current && current.key !== key) {
      this.r.scene.remove(current.group);
      current.dispose();
      current = null;
    }
    if (key && !current) {
      current = new Human(key);
      const cf = this.charFaceOf(id);
      if (cf) current.setFace(faceTexture(cf.account, cf.v));
      this.r.scene.add(current.group);
    }
    return current;
  }

  private createRemote(id: number): RemoteView {
    const entry = this.roster.get(id);
    const color = this.colorOf(id);
    const look = this.lookOf(id);
    const man = new TubeMan(color, { physical: this.r.profile.physical, seed: id * 13.7, look });
    this.r.scene.add(man.group);
    const tag = this.hud.createNametag(entry?.name ?? '...', entry?.bot ?? false, this.tagTeam(id));
    return {
      id,
      man,
      pose: defaultPose(),
      tag,
      color,
      name: entry?.name ?? '...',
      bot: entry?.bot ?? false,
      cur: null,
      lastTagText: '',
      lookKey: JSON.stringify(look),
      faceKey: '',
      human: null,
      inflHint: 0,
      hintUntil: 0,
      trail: newTrailState(),
    };
  }

  private removeRemote(rv: RemoteView): void {
    this.r.scene.remove(rv.man.group);
    rv.man.dispose();
    if (rv.human) {
      this.r.scene.remove(rv.human.group);
      rv.human.dispose();
    }
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
      const look = this.lookOf(rv.id);
      const key = JSON.stringify(look);
      if (key !== rv.lookKey) {
        rv.lookKey = key;
        rv.man.setLook(look);
      }
      const fk = this.faceKeyOf(entry);
      if (fk !== rv.faceKey) {
        rv.faceKey = fk;
        rv.man.setFacePhoto(fk ? this.faceTexOf(entry) : null);
      }
    }
    const alive = c.mode !== MODE_DEAD;
    rv.human = this.humanFor(rv.id, alive ? rv.human : null);
    rv.man.setVisible(alive && !rv.human);
    if (!alive) {
      rv.tag.el.style.display = 'none';
      rv.trail.on = false;
      return;
    }
    if (this.time < rv.hintUntil && rv.inflHint > c.inflation) c.inflation = rv.inflHint;
    this.characterIdle(rv.id, c.px, c.py, c.pz, c.yaw);
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
    rv.man.setWeapon(WEAPON_IDS[c.weapon] ?? 'airCannon', this.remoteParts.get(rv.id) ?? null);
    p.dashing = (c.flags & FLAG_DASHING) !== 0;
    p.protected = (c.flags & FLAG_PROTECTED) !== 0;
    this.ultView.pose(p, c.ult);
    const hu = rv.human;
    if (hu) {
      hu.group.position.set(c.px, c.py, c.pz);
      hu.setWeapon(WEAPON_IDS[c.weapon] ?? 'airCannon', this.remoteParts.get(rv.id) ?? null);
      hu.update(p, this.time - (this.transforms.get(rv.id)?.at ?? this.time));
      rv.trail.on = false;
    } else {
      rv.man.update(p);
      this.trailFor(rv.trail, rv.man, p, c.px, c.py, c.pz);
    }
    if (p.streaming && (hu ?? rv.man).muzzleWorld(tmpV3)) {
      const d = lookDir(c.yaw, c.pitch, tmpDir);
      this.effects.leafStream(tmpV3.x, tmpV3.y, tmpV3.z, d.x, d.y, d.z, c.charge, dt);
    }

    // Name tag with inflation percentage above the head.
    const headY = c.py + (hu ?? rv.man).headHeight(c.inflation) + 0.35;
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
    const text = `${p.crowned ? '👑 ' : ''}${pct}%${p.nemesis ? ' ⚔️' : ''}${this.ultView.tagSuffix(c.ult)}`;
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
      if (s.home !== undefined && s.home >= 0 && s.turn) {
        this.flyHoming(s, t);
      } else {
        this.effects.placeProjectile(s.p3, s.x + s.vx * t, s.y + s.vy * t - 0.5 * s.g * t * t, s.z + s.vz * t, dt);
      }
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
      if (s.g > 0) p.vy -= s.g * dt;
      // The Chase: our shot curves toward the target like the server's does.
      const aim = s.home !== undefined ? this.targetCenter(s.home) : null;
      if (aim) steerToward(p, p.x, p.y, p.z, aim.x, aim.y, aim.z, BALANCE.ults.chase.homingTurn * dt);
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
        if (s.style === 'cork') this.effects.corkPop(nx, ny, nz);
        else this.showBlast(nx, ny, nz, s.blast * 0.9, 0.7, s.style);
        continue;
      }
      if (s.life <= 0) {
        s.exploded = true;
        this.effects.removeProjectile(key);
        if (s.style !== 'cork') this.effects.airPuff(nx, ny, nz, 5, 1.5, 0.25);
        continue;
      }
      this.effects.placeProjectile(p, nx, ny, nz, dt);
    }
  }

  /** Middle of a player's body as you see them (for drawing homing shots), or null if they're gone. */
  private targetCenter(id: number): THREE.Vector3 | null {
    if (id === this.youId) {
      if (this.pred.mode === MODE_DEAD) return null;
      return tmpV3.set(this.pred.px, this.pred.py + playerHeight(this.pred) * 0.5, this.pred.pz);
    }
    const c = this.remotes.get(id)?.cur;
    if (!c || c.mode === MODE_DEAD) return null;
    return tmpV3.set(c.px, c.py + BALANCE.player.height * inflationScale(c.inflation) * 0.5, c.pz);
  }

  /** Steps a homing remote shot along from where it was last drawn, turning toward its target. */
  private flyHoming(s: RemoteShot, t: number): void {
    const p = s.p3;
    if (s.at === undefined) {
      s.at = 0;
      p.vx = s.vx;
      p.vy = s.vy;
      p.vz = s.vz;
      p.x = s.x;
      p.y = s.y;
      p.z = s.z;
    }
    let x = p.x;
    let y = p.y;
    let z = p.z;
    while (s.at < t) {
      const h = Math.min(DT, t - s.at);
      const aim = this.targetCenter(s.home!);
      if (aim) steerToward(p, x, y, z, aim.x, aim.y, aim.z, s.turn! * h);
      x += p.vx * h;
      y += p.vy * h;
      z += p.vz * h;
      s.at += h;
    }
    this.effects.placeProjectile(p, x, y, z, DT);
  }

  /**
   * You got hit: the view snaps away from the blow (pitch and roll toward the push), the field of
   * view punches out as you're launched, the screen flashes, and the inflation you took flies off
   * your meter.
   */
  private feelHit(e: Extract<GameEvent, { t: 'hit' }>): void {
    const k = Math.min(1, e.speed / 30);
    this.trauma = Math.min(1, this.trauma + 0.35 + e.speed * 0.02);
    const yaw = this.input.yaw;
    const fwd = e.dx * -Math.sin(yaw) + e.dz * -Math.cos(yaw);
    const side = e.dx * Math.cos(yaw) + e.dz * -Math.sin(yaw);
    const jolt = e.braced ? 0.35 : 1;
    this.punchV += -fwd * (2.5 + k * 8) * jolt;
    this.rollV += -side * (3 + k * 9) * jolt;
    this.fovKick += (4 + k * 12) * jolt;
    if (!e.braced) {
      this.hud.flash(`rgba(255, ${Math.round(90 - e.infl * 60)}, 90, ${(0.3 + k * 0.35).toFixed(2)})`, 220 + k * 200);
      if (e.speed > 12) this.hud.flash('rgba(255, 255, 255, 0.5)', 140);
    }
    if ((e.gain ?? 0) > 0.001) this.hud.selfHit(e.gain, e.infl, k);
    // Direction the hit came from relative to where we're looking.
    const ang = Math.atan2(-e.dx, -e.dz) - yaw;
    this.hud.damageFrom(-ang + Math.PI);
  }

  /** Your shot landed: marker, crunch, shake and a beat of hit-stop, scaled by how hard it hit. */
  private confirmHit(e: Extract<GameEvent, { t: 'hit' }>): void {
    const k = Math.min(1, e.speed / 30);
    const gain = e.gain ?? 0;
    const hot = e.infl >= 0.75;
    const chain = this.hud.hitTally(gain, e.infl);
    this.hud.hitMarker(k, hot);
    this.audio.hitConfirm(k, chain);
    this.myHits.set(e.target, { at: this.time, dist: Math.hypot(e.x - this.pred.px, e.y - this.pred.py, e.z - this.pred.pz), combo: e.combo });
    // Their body and name tag show the new inflation right away, not a snapshot later, and the
    // inflation you added flies off the body you're looking at.
    const rv = this.remotes.get(e.target);
    const c = rv?.cur;
    if (rv) {
      rv.inflHint = e.infl;
      rv.hintUntil = this.time + 0.6;
      rv.tag.pct.animate([{ transform: 'scale(1.9)', filter: 'brightness(1.8)' }, { transform: 'scale(1)', filter: 'none' }], { duration: 380, easing: 'cubic-bezier(0.3, 1.6, 0.5, 1)' });
    }
    const hue = 120 - Math.min(1, e.infl) * 120;
    const bodyY = c ? c.py + BALANCE.player.height * inflationScale(e.infl) * 0.8 : e.y + 0.4;
    this.hud.popup(
      tmpV.set((c ? c.px : e.x) + (Math.random() - 0.5) * 0.9, bodyY, (c ? c.pz : e.z) + (Math.random() - 0.5) * 0.9),
      `+${Math.max(1, Math.round(gain * 100))}%`,
      `hsl(${hue}, 95%, ${hot ? 62 : 68}%)`,
      0.75 + Math.min(0.45, gain * 2.5) + (hot ? 0.15 : 0),
      0.95,
      false,
      'gain',
    );
    this.audio.impact(e.speed, null, 1.3);
    this.trauma = Math.min(1, this.trauma + 0.2 + k * 0.5);
    this.fovKick -= 1 + k * 4;
    this.viewModel.hitStop(Math.min(BALANCE.knockback.hitStopMax, BALANCE.knockback.hitStopBase + e.speed * BALANCE.knockback.hitStopPerSpeed));
    if (e.combo >= 2) this.hud.callout(`${e.combo}x COMBO!`, e.combo >= 3 ? 'Juggle master!' : 'Keep them in the air!', 1.2, e.combo >= 3 ? '#ff5fd2' : '#ffd60a');
  }

  /** Third-person camera is on and you're alive (so shots aim along the camera's center ray). */
  private get thirdPersonLive(): boolean {
    return this.wantThird && this.camLive && this.havePred && this.pred.mode !== MODE_DEAD && !this.replay.active;
  }

  /** Third person from the settings, or while your ult has turned you into a character. */
  private get wantThird(): boolean {
    return this.settings.thirdPerson || !!this.transformOf(this.youId);
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
      this.selfHuman = this.humanFor(this.youId, this.selfHuman);
      this.selfHuman?.setVisible(false);
      // Your own trail only shows in third person: first person keeps your view clear.
      this.selfTrail.on = false;
      return;
    }
    const color = this.colorOf(this.youId);
    const look = this.lookOf(this.youId);
    const entry = this.roster.get(this.youId);
    const fk = this.faceKeyOf(entry);
    const key = `${color}|${JSON.stringify(look)}|${this.r.profile.physical}|${fk}`;
    if (!this.selfMan || key !== this.selfLookKey) {
      if (this.selfMan) {
        this.r.scene.remove(this.selfMan.group);
        this.selfMan.dispose();
      }
      this.selfMan = new TubeMan(color, { physical: this.r.profile.physical, seed: this.youId * 13.7, look });
      if (fk) this.selfMan.setFacePhoto(this.faceTexOf(entry));
      this.r.scene.add(this.selfMan.group);
      this.selfLookKey = key;
    }
    const man = this.selfMan;
    const p = this.pred;
    const pose = this.selfPose;
    this.selfHuman = this.humanFor(this.youId, this.selfHuman);
    this.selfHuman?.setVisible(true);
    man.setVisible(!this.selfHuman);
    man.group.position.set(x, y, z);
    this.characterIdle(this.youId, x, y, z, p.yaw);
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
    this.ultView.pose(pose, publicUlt(p));
    const hu = this.selfHuman;
    if (hu) {
      hu.group.position.set(x, y, z);
      hu.setWeapon(this.weapon.id, this.activeParts);
      hu.update(pose, this.time - (this.transforms.get(this.youId)?.at ?? this.time));
      this.selfTrail.on = false;
      return;
    }
    man.setWeapon(this.weapon.id, this.activeParts);
    man.update(pose);
    this.trailFor(this.selfTrail, man, pose, x, y, z);
  }

  /** The cosmetic trail behind a tube man while launched, dashing or flying fast. */
  private trailFor(s: TrailState, man: TubeMan, pose: TubeManPose, x: number, y: number, z: number): void {
    const flying = pose.launched || pose.dashing || (!pose.onGround && Math.hypot(pose.vx, pose.vy, pose.vz) > TRAIL_FLY_SPEED);
    this.effects.trail(s, man.trail, x, y + 0.9 * inflationScale(pose.inflation), z, flying);
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
    this.rollV += (-260 * this.rollP - 22 * this.rollV) * pdt;
    this.rollP += this.rollV * pdt;
    const shake = this.trauma * this.trauma;
    const alive = p.mode !== MODE_DEAD && this.havePred;
    const third = alive && this.wantThird;
    this.viewModel.root.visible = alive && !third;
    let fov = this.settings.fov + this.fovKick + (p.launchTimer > 0 ? 6 : 0);
    const flying = alive && p.launchTimer > 0 ? (p.hitStop > 0 ? Math.hypot(p.hsVx, p.hsVy, p.hsVz) : Math.hypot(p.vx, p.vy, p.vz)) : 0;
    this.hud.setSpeedLines(Math.max(0, Math.min(1, (flying - 9) / 22)));
    if (alive) {
      const x = this.prevX + (p.px - this.prevX) * alpha + this.errX;
      const y = this.prevY + (p.py - this.prevY) * alpha + this.errY;
      const z = this.prevZ + (p.pz - this.prevZ) * alpha + this.errZ;
      cam.position.set(x, y + eyeHeight(p), z);
      let roll = (Math.random() - 0.5) * shake * 0.1 + this.rollP;
      if (third) {
        // Pull back further for the bigger character bodies.
        const scale = inflationScale(p.inflation) * (this.transformOf(this.youId) ? 1.6 : 1);
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
      const home = new THREE.Vector3(0, 16, 0);
      const orbit = this.time * 0.15;
      const desired = new THREE.Vector3(home.x + Math.cos(orbit) * 26, home.y, home.z + Math.sin(orbit) * 26);
      const watch = this.sdSpectating && since > 1.2 ? this.spectateTarget() : -1;
      const w = watch >= 0 ? this.posOf(watch) : null;
      if (w) {
        // Out of a Sudden Death match: follow the players still in, circling slowly behind them.
        target = tmpV.copy(w).add(new THREE.Vector3(0, 1.4, 0));
        const a = this.time * 0.22;
        desired.set(w.x + Math.cos(a) * 11, w.y + 6.5, w.z + Math.sin(a) * 11);
      } else if (since > 1.2 && this.killerId >= 0) {
        const k = this.posOf(this.killerId);
        if (k) target = tmpV.copy(k).add(new THREE.Vector3(0, 1.2, 0));
      }
      cam.position.lerp(desired, Math.min(1, dt * (w ? 2.2 : 1.5)));
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
    const whine = w.auto ? 0 : charge;
    if (whine !== this.lastCharge) {
      this.audio.setCharge(whine);
      this.lastCharge = whine;
    }
    this.updateAimArc(alive && p.charging === 1 && w.kind === 'projectile' && w.projGravity > 0);
    if (p.ammo === 0 && this.lastAmmo > 0) this.hud.setNote('Reloading...');
    const launched = p.launchTimer > 0;
    if (launched && !this.wasLaunched) this.launchTips++;
    this.wasLaunched = launched;
    this.lastAmmo = p.ammo;

    const me = this.roster.get(this.youId);
    let sub = '';
    if (this.match.phase === 'waiting') sub = 'Waiting for another player...';
    else if (this.match.phase === 'results') sub = 'Match over!';
    else if (me && this.mode === 'suddenDeath') {
      sub = me.out ? 'Spectating' : `One life · ${me.kos} KO${me.kos === 1 ? '' : 's'}`;
    } else if (me && this.mode === 'duel') {
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
        // Big magazines show as a gauge instead of a row of pips.
        stream: w.kind === 'stream' || w.ammo > 10,
        u1Ready: 1 - Math.min(1, p.u1Cool / BALANCE.utilities[this.equippedUtils[0]].cooldown),
        u2Ready: 1 - Math.min(1, p.u2Cool / BALANCE.utilities[this.equippedUtils[1]].cooldown),
        pin: p.pinTimer,
        turbo: alive ? p.turboTimer : 0,
        mega: alive ? p.megaShots : 0,
        feather: alive ? p.floatTimer : 0,
        helium: alive ? p.heliumTimer : 0,
        spring: alive ? p.springJumps : 0,
      },
      dt,
    );
    if (this.mode === 'suddenDeath' && this.match.phase === 'playing') {
      const rows = [...this.roster.values()];
      this.hud.setSurvivors(rows.filter((r) => !r.out).length, rows.length, !me?.out);
    } else this.hud.setSurvivors(null);
    if (this.sdSpectating && this.havePred) {
      // One life: no respawn. Say who you're watching and how to switch.
      const late = !!me?.out && me.deaths === 0;
      const watch = this.spectateId >= 0 ? this.nameOf(this.spectateId) : '';
      const how = `${this.key('jump')} to watch someone else`;
      const killer = this.killerId >= 0 ? this.nameOf(this.killerId) : null;
      const big = late ? 'Match in progress' : killer ? `Popped by ${killer}!` : 'You fell off!';
      const small = late ? `You'll play next round${watch ? ` · watching ${watch}` : ''}` : `You're out${watch ? ` · watching ${watch}` : ''} · ${how}`;
      this.hud.setRespawn(big, small);
    } else if (!alive && this.havePred) {
      const killer = this.killerId >= 0 ? this.nameOf(this.killerId) : null;
      const left = Math.max(0, BALANCE.match.respawnDelay - (this.time - this.deathAt));
      const verb = this.deathVerb.charAt(0).toUpperCase() + this.deathVerb.slice(1);
      this.hud.setRespawn(killer ? `${verb} by ${killer}!` : 'You fell off!', this.match.phase === 'results' ? '' : `Respawning in ${left.toFixed(1)}...`);
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
      u1: 1 - Math.min(1, p.u1Cool / BALANCE.utilities[this.equippedUtils[0]].cooldown),
      u2: 1 - Math.min(1, p.u2Cool / BALANCE.utilities[this.equippedUtils[1]].cooldown),
      reloading: p.reloadTimer > 0,
      features: this.ctx.features,
      utilIcons: [UTILITY_INFO[this.equippedUtils[0]].icon, UTILITY_INFO[this.equippedUtils[1]].icon],
      ult: alive ? Math.min(1, p.ult) : 0,
      ultReady: alive && ultReady(p),
      ultIcon: ULT_INFO[ultOf(p)].icon,
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
      utilName: (i) => UTILITY_INFO[this.equippedUtils[i]].name,
    });
    this.hud.ping.textContent = `${Math.round(this.net.rtt)} ms`;
  }

  /** Balloon Mortar: while charging, dots trace the arc and a ring marks where it will land. */
  private updateAimArc(show: boolean): void {
    if (!show) {
      this.effects.setAimArc(null, null);
      return;
    }
    const p = this.pred;
    const w = this.weapon;
    const look = lookDir(p.yaw, p.pitch, tmpDir);
    const ox = p.px + look.x * 0.5;
    const oy = p.py + eyeHeight(p) + look.y * 0.5;
    const oz = p.pz + look.z * 0.5;
    const d = shotDir(w, look.x, look.y, look.z, { x: 0, y: 0, z: 0 });
    let x = ox;
    let y = oy;
    let z = oz;
    let vx = d.x * w.projSpeed;
    let vy = d.y * w.projSpeed;
    let vz = d.z * w.projSpeed;
    const pts = this.arcPts;
    pts.length = 0;
    const step = 1 / 30;
    let land: THREE.Vector3 | null = null;
    for (let i = 0; i < 90; i++) {
      vy -= w.projGravity * step;
      x += vx * step;
      y += vy * step;
      z += vz * step;
      if (this.world.sphereHit(x, y, z, w.projRadius * 0.45) >= 0) {
        land = tmpV2.set(x, y, z);
        break;
      }
      if (i % 2 === 1 && i > 2) pts.push(x, y, z);
      if (y < -40) break;
    }
    this.effects.setAimArc(pts, land, w.blastRadius * 0.8);
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

  /** Menu background: shows this map (the one picked on the menu) while you're not in a match. */
  showMenuMap(id: string | null): void {
    if (this.active || !id || !MAPS[id]) return;
    this.setMap(id);
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
      (id) => this.lookOf(id),
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
    return this.match.phase === 'playing' && this.clock.tickAt(performance.now()) >= this.match.endsAtTick - BALANCE.final.seconds * BALANCE.tickRate;
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
