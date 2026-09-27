import * as THREE from 'three';
import { BALANCE } from '../../shared/balance';
import { PLAYER_COLORS } from '../../shared/colors';
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
  FLAG_DASHING,
  FLAG_DOUBLED,
  FLAG_GROUND,
  FLAG_LAUNCHED,
  FLAG_PROTECTED,
  type PublicPlayer,
  type RoomInfo,
  type RosterEntry,
  type ServerMessage,
  type Snapshot,
} from '../../shared/protocol';
import type { MatchPhase, MatchResult } from '../../shared/game/sim';
import { World } from '../../shared/world';
import type { Audio } from '../audio/audio';
import { type Action, type InputManager, codeLabel } from '../input/input';
import type { Connection } from '../net/connection';
import { Effects, LandingCircles, type Projectile3D } from '../render/effects';
import { MapView } from '../render/mapView';
import type { Renderer } from '../render/renderer';
import { TubeMan, defaultPose, type TubeManPose } from '../render/tubeMan';
import { ViewModel } from '../render/viewModel';
import type { Settings } from '../settings';
import { esc, hexColor } from '../ui/dom';
import type { Hud, Nametag } from '../ui/hud';
import { ServerClock } from './clock';

interface HistoryEntry {
  seq: number;
  tick: number;
  input: InputFrame;
}

interface SnapEntry {
  tick: number;
  players: Map<number, PublicPlayer>;
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
}

interface RemoteShot {
  id: number;
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
  private fovKick = 0;
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
  onMatchChange: ((m: MatchInfo) => void) | null = null;
  onRosterChange: (() => void) | null = null;
  onRoomChange: ((room: RoomInfo) => void) | null = null;
  onKicked: ((message: string) => void) | null = null;

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
    r.scene.add(this.mapView.root, this.effects.root, this.circles.root);
    r.scene.add(r.camera);
    r.camera.add(this.viewModel.root);
    this.viewModel.root.visible = false;
    r.setTheme(this.map.theme);
  }

  private makeCtx(features: StepContext['features']): StepContext {
    const w = BALANCE.weapons.airCannon;
    return {
      world: this.world,
      dt: DT,
      weapon: { ammo: w.ammo, reloadTime: w.reloadTime, fireCooldown: w.fireCooldown, chargeTime: w.chargeTime, tapPower: w.tapPower },
      features,
    };
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
  }

  // --- Lifecycle ---------------------------------------------------------------------------

  enter(msg: Extract<ServerMessage, { type: 'welcome' }>): void {
    this.youId = msg.you;
    this.room = msg.room;
    this.setMap(msg.room.mapId);
    this.ctx = this.makeCtx(msg.room.features);
    this.hud.showAbilities(msg.room.features);
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
    this.viewModel.root.visible = false;
    this.hud.show(false);
    this.audio.setCharge(0);
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
        const me = next.get(this.youId);
        if (me) this.viewModel.setColor(PLAYER_COLORS[me.color]?.hex ?? 0xffffff);
        this.onRosterChange?.();
        break;
      }
      case 'match':
        this.match = { phase: msg.phase, endsAtTick: msg.endsAtTick, number: msg.number, result: msg.result };
        this.onMatchChange?.(this.match);
        break;
      case 'room':
        this.room = msg.room;
        if (msg.room.mapId !== this.map.id) this.setMap(msg.room.mapId);
        this.ctx = this.makeCtx(msg.room.features);
        this.onRoomChange?.(msg.room);
        break;
      case 'ev':
        this.onEvents(msg.list);
        break;
      case 'error':
        if (msg.code === 'kicked') this.onKicked?.(msg.message);
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
    this.snaps.push({ tick: snap.tick, players });
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
      if (this.isImmediate(e)) this.handleEvent(e, true);
      else this.pending.push(e);
    }
  }

  private isImmediate(e: GameEvent): boolean {
    const you = this.youId;
    switch (e.t) {
      case 'shot':
      case 'boom':
      case 'fizzle':
        return e.t === 'shot' ? e.owner === you : this.localByServer.has(e.id);
      case 'hit':
        return e.target === you;
      case 'ko':
        return e.victim === you;
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
    const c = this.roster.get(id)?.color ?? 0;
    return PLAYER_COLORS[c]?.hex ?? 0xffffff;
  }

  private handleEvent(e: GameEvent, immediate: boolean): void {
    const you = this.youId;
    const a = this.audio;
    const fx = this.effects;
    switch (e.t) {
      case 'shot': {
        if (e.owner === you) {
          // Link the server's projectile to the one we already drew.
          const local = e.cs !== undefined ? this.localShots.get(-e.cs) : undefined;
          if (local) {
            local.serverId = e.id;
            this.localByServer.set(e.id, -e.cs!);
          } else {
            const key = -100000 - e.id;
            const p3 = fx.addProjectile(key, e.x, e.y, e.z, e.vx, e.vy, e.vz, e.r);
            this.localShots.set(key, { p3, serverId: e.id, life: BALANCE.weapons.airCannon.projLifetime, exploded: false, boomAt: null });
            this.localByServer.set(e.id, key);
          }
        } else {
          const p3 = fx.addProjectile(e.id, e.x, e.y, e.z, e.vx, e.vy, e.vz, e.r);
          this.remoteShots.set(e.id, { id: e.id, tick: e.tick, x: e.x, y: e.y, z: e.z, vx: e.vx, vy: e.vy, vz: e.vz, p3 });
          a.shoot(e.power, [e.x, e.y, e.z]);
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
        }
        break;
      }
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
        a.squeak(e.infl, e.target === you ? null : pos);
        if (e.attacker === you && e.target !== you) {
          this.hud.hitMarker();
          a.hitConfirm();
          if (e.combo >= 2) this.hud.callout(`${e.combo}x COMBO!`, e.combo >= 3 ? 'Juggle master!' : 'Keep them in the air!', 1.2, e.combo >= 3 ? '#ff5fd2' : '#ffd60a');
          this.hud.popup(tmpV.set(e.x, e.y + 0.6, e.z), `+${Math.round(e.infl * 100)}%`, '#ffd60a', 0.8, 0.8);
        }
        if (e.target === you) {
          this.trauma = Math.min(1, this.trauma + 0.35 + e.speed * 0.02);
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
          this.hud.popup(tmpV.set(e.x, e.y + 1, e.z), e.speed > 20 ? 'WHAM!' : 'BOP!', '#ffffff', 0.7 + Math.min(0.6, e.speed * 0.02), 0.7);
        }
        break;
      }
      case 'shield':
        fx.airPuff(e.x, e.y, e.z, 8, 2, 0.25, 0x9fe8ff);
        break;
      case 'ko': {
        const victimName = this.nameOf(e.victim);
        const killerName = e.killer >= 0 ? this.nameOf(e.killer) : '';
        const vc = hexColor(this.colorOf(e.victim));
        const kc = e.killer >= 0 ? hexColor(this.colorOf(e.killer)) : '';
        const html =
          e.killer >= 0
            ? `<b style="color:${kc}">${esc(killerName)}</b> popped <b style="color:${vc}">${esc(victimName)}</b>`
            : `<b style="color:${vc}">${esc(victimName)}</b> fell off`;
        this.hud.addKill(html, e.killer === you || e.victim === you);
        a.squeal(e.victim === you ? null : [e.x, Math.max(e.y, -10), e.z]);
        fx.deflatingBalloon(e.x, e.y, e.z, this.colorOf(e.victim), e.vx, e.vy, e.vz);
        this.hud.popup(tmpV.set(e.x, Math.max(e.y, -8) + 2, e.z), 'WHEEEE!', '#ffffff', 1.2, 1.4);
        if (e.victim === you) {
          this.deathAt = this.time;
          this.killerId = e.killer;
          this.deathPos.set(e.x, Math.max(e.y, -6), e.z);
          this.audio.setCharge(0);
        }
        if (e.killer === you && e.victim !== you) {
          a.koConfirm();
          this.hud.callout('POPPED!', victimName, 1.8);
        }
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
        if (p) {
          a.burp(e.id === you ? null : [p.x, p.y, p.z]);
          this.hud.popup(tmpV.set(p.x, p.y + 3, p.z), 'BUURRP!', '#b8f06a', 1.1, 1.2);
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

  /** Where a player's grapple line starts (your gun muzzle, or another player's chest). */
  private handPos(id: number): THREE.Vector3 | null {
    if (id === this.youId) {
      if (!this.viewModel.root.visible) return null;
      return this.viewModel.muzzle.getWorldPosition(new THREE.Vector3());
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
        this.hud.popup(tmpV.set(e.x, e.y + 1.4, e.z), e.long ? 'PFFFFFFFRRRT!' : 'PFFT!', '#c6f08a', e.long ? 1.2 : 0.8, e.long ? 1.6 : 0.8);
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
        this.hud.popup(tmpV.set(e.x, e.y + 2, e.z), 'BOING!', '#ff9fd0', 1, 0.9);
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
    const w = BALANCE.weapons.airCannon;
    this.viewModel.kick(f.power);
    this.audio.shoot(f.power, null);
    this.trauma = Math.min(1, this.trauma + 0.05 + f.power * 0.1);
    const key = -this.seq;
    this.viewModel.muzzle.getWorldPosition(tmpV);
    const r = w.projRadius * (0.75 + 0.25 * f.power);
    const p3 = this.effects.addProjectile(key, f.ox, f.oy, f.oz, f.dx * w.projSpeed, f.dy * w.projSpeed, f.dz * w.projSpeed, r, tmpV);
    this.localShots.set(key, { p3, serverId: -1, life: w.projLifetime, exploded: false, boomAt: null });
    this.effects.airPuff(tmpV.x, tmpV.y, tmpV.z, 5, 2, 0.12);
  }

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
    this.updateShots(dt);
    this.updateCamera(dt);
    this.updateLocalFeedback(dt);
    this.mapView.update(dt, this.time);
    this.effects.update(dt);
    this.updateCircles();
    this.hud.updatePopups(this.r.camera, dt);
  }

  private predictStep(): void {
    const f = emptyInput();
    this.input.sample(f);
    f.seq = ++this.seq;
    f.tick = this.predTick();
    quantizeInput(f);
    this.pendingSend.push(f);
    if (!this.havePred) return;
    this.history.push({ seq: f.seq, tick: f.tick, input: f });
    if (this.history.length > 240) this.history.shift();
    this.prevX = this.pred.px;
    this.prevY = this.pred.py;
    this.prevZ = this.pred.pz;
    this.world.setTime(f.tick * DT);
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

  private createRemote(id: number): RemoteView {
    const entry = this.roster.get(id);
    const color = PLAYER_COLORS[entry?.color ?? 0]?.hex ?? 0xffffff;
    const man = new TubeMan(color, { physical: this.r.profile.physical, seed: id * 13.7 });
    this.r.scene.add(man.group);
    const tag = this.hud.createNametag(entry?.name ?? '...', entry?.bot ?? false);
    return { id, man, pose: defaultPose(), tag, color, name: entry?.name ?? '...', bot: entry?.bot ?? false, cur: null, lastTagText: '' };
  }

  private removeRemote(rv: RemoteView): void {
    this.r.scene.remove(rv.man.group);
    rv.man.dispose();
    rv.tag.el.remove();
  }

  private poseRemote(rv: RemoteView, dt: number): void {
    const c = rv.cur!;
    const entry = this.roster.get(rv.id);
    if (entry && (entry.name !== rv.name || PLAYER_COLORS[entry.color]?.hex !== rv.color)) {
      rv.name = entry.name;
      rv.color = PLAYER_COLORS[entry.color]?.hex ?? rv.color;
      rv.man.setColor(rv.color);
      rv.tag.el.remove();
      rv.tag = this.hud.createNametag(entry.name, entry.bot);
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
    p.dashing = (c.flags & FLAG_DASHING) !== 0;
    p.protected = (c.flags & FLAG_PROTECTED) !== 0;
    rv.man.update(p);

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
    const text = `${pct}%`;
    if (text !== rv.lastTagText) {
      rv.lastTagText = text;
      rv.tag.pct.textContent = text;
      const hue = 120 - Math.min(1, c.inflation) * 120;
      rv.tag.pct.style.color = pct === 0 ? '#ffffff' : `hsl(${hue}, 95%, 68%)`;
    }
  }

  private updateShots(dt: number): void {
    // Remote shots follow the interpolated timeline.
    for (const s of this.remoteShots.values()) {
      const t = Math.max(0, (this.renderTick - s.tick) * DT);
      this.effects.placeProjectile(s.p3, s.x + s.vx * t, s.y + s.vy * t, s.z + s.vz * t, dt);
      if (t > BALANCE.weapons.airCannon.projLifetime + 0.5) {
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
        this.showBlast(nx, ny, nz, BALANCE.weapons.airCannon.blastRadius * 0.9, 0.7);
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
    const shake = this.trauma * this.trauma;
    const alive = p.mode !== MODE_DEAD && this.havePred;
    this.viewModel.root.visible = alive;
    let fov = this.settings.fov + this.fovKick + (p.launchTimer > 0 ? 6 : 0);
    if (alive) {
      const x = this.prevX + (p.px - this.prevX) * alpha + this.errX;
      const y = this.prevY + (p.py - this.prevY) * alpha + this.errY;
      const z = this.prevZ + (p.pz - this.prevZ) * alpha + this.errZ;
      cam.position.set(x, y + eyeHeight(p), z);
      cam.rotation.set(this.input.pitch + (Math.random() - 0.5) * shake * 0.08, this.input.yaw + (Math.random() - 0.5) * shake * 0.08, (Math.random() - 0.5) * shake * 0.1 + (p.launchTimer > 0 ? Math.sin(this.time * 6) * 0.04 : 0));
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
    }
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov += (fov - cam.fov) * Math.min(1, dt * 12);
      cam.updateProjectionMatrix();
    }
    this.audio.setListener(cam.position.x, cam.position.y, cam.position.z, this.input.yaw);
  }

  private updateLocalFeedback(dt: number): void {
    const p = this.pred;
    const w = BALANCE.weapons.airCannon;
    const alive = p.mode !== MODE_DEAD && this.havePred;
    this.viewModel.update(dt, {
      speed: Math.hypot(p.vx, p.vz),
      charge: p.charging ? p.charge : 0,
      onGround: p.onGround === 1,
      lookDX: this.input.lookDX,
      lookDY: this.input.lookDY,
      ammoFrac: p.ammo / w.ammo,
      reloading: p.reloadTimer > 0,
    });
    this.input.lookDX = 0;
    this.input.lookDY = 0;
    const charge = alive && p.charging ? p.charge : 0;
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
    else if (me) {
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
        weaponName: 'AIR CANNON',
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
    this.hud.ping.textContent = `${Math.round(this.net.rtt)} ms`;
  }

  private key(a: Action): string {
    return codeLabel(this.input.getBindings()[a][0] ?? '?');
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
        if (c?.mode === MODE_HANG && p.onGround && Math.hypot(c.px - p.px, c.pz - p.pz) < 2.2 && Math.abs(c.py - p.py) < 3) return `${this.key('grab')} to STOMP their hands!`;
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

  // --- Queries used by UI --------------------------------------------------------------------

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
