import * as THREE from 'three';
import { BALANCE } from '../../shared/balance';
import type { GameEvent } from '../../shared/game/events';
import {
  PROJ_BIG_BLOW,
  PROJ_ROCKET,
  ULT_BIT_GASSED,
  ULT_BIT_READY,
  ULT_INFO,
  type UltId,
  activeUlt,
  publicUltKind,
  ultOf,
  ultReady,
} from '../../shared/game/ults';
import type { PlayerState } from '../../shared/player';
import type { Audio } from '../audio/audio';
import type { Effects } from '../render/effects';
import type { TubeManPose } from '../render/tubeMan';
import { CALLOUT, type Hud } from '../ui/hud';
import { esc, hexColor } from '../ui/dom';
import { ULT_ICON } from '../ui/gameIcons';
import { type IconName, iconHtml } from '../ui/icons';

/** One player as the ult visuals see them (you included). */
export interface UltPlayerView {
  id: number;
  /** Public ult bits (see publicUlt). */
  ult: number;
  /** Who their Chase is locked on to (-1 = nobody). */
  ultTarget: number;
  x: number;
  y: number;
  z: number;
  /** Top of the head, world y. */
  head: number;
}

/** What the ult visuals need from the game. */
export interface UltHost {
  youId(): number;
  pred(): PlayerState;
  /** Alive and predicted (false while dead or before the first snapshot). */
  alive(): boolean;
  effects: Effects;
  hud: Hud;
  audio: Audio;
  camera: THREE.Camera;
  scene: THREE.Scene;
  /** Estimated server tick now. */
  tick(): number;
  lowQuality(): boolean;
  players(): UltPlayerView[];
  nameOf(id: number): string;
  colorOf(id: number): number;
  /** Where a player's eyes are (for Robot Mode's laser), or null. */
  eyeOf(id: number, out: THREE.Vector3): THREE.Vector3 | null;
  /** Plays Juice's syringe jab on a player's tube man. */
  jab(id: number): void;
  keyOf(): string;
  /** Image URL of the face the ult's character wears (lent by the real person), or null. */
  charFace(kind: UltId): string | null;
  /** Camera shake (0..1) and a field-of-view kick. */
  shake(amount: number, fov: number): void;
  /** Height of the floor under a point (within a short drop), or null over a gap. */
  groundAt(x: number, y: number, z: number): number | null;
}

/** The pride flag's six stripes. */
const RAINBOW = [0xe40303, 0xff8c00, 0xffed00, 0x008026, 0x24408e, 0x732982];
/** Most road pieces drawn at once. */
const MAX_ROAD = 360;

let roadTex: THREE.Texture | null = null;
/** A strip of rainbow road: the six stripes across it, soft at the ends. */
function roadTexture(): THREE.Texture {
  if (roadTex) return roadTex;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 96;
  const g = c.getContext('2d')!;
  RAINBOW.forEach((col, i) => {
    g.fillStyle = `#${col.toString(16).padStart(6, '0')}`;
    g.fillRect((i * 64) / RAINBOW.length, 0, 64 / RAINBOW.length + 1, 96);
  });
  roadTex = new THREE.CanvasTexture(c);
  roadTex.colorSpace = THREE.SRGBColorSpace;
  return roadTex;
}

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const DT = 1 / BALANCE.tickRate;

let noseTex: THREE.Texture | null = null;
/** A big glowing cartoon nose (drawn once), for whoever The Chase is after. */
function noseTexture(): THREE.Texture {
  if (noseTex) return noseTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const glow = g.createRadialGradient(64, 64, 10, 64, 64, 64);
  glow.addColorStop(0, 'rgba(255,95,210,0.9)');
  glow.addColorStop(1, 'rgba(255,95,210,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, 128, 128);
  g.lineWidth = 6;
  g.strokeStyle = '#1d1b3a';
  // The nose: a bridge and a big round bulb, with two nostrils.
  g.fillStyle = '#ffb38a';
  g.beginPath();
  g.moveTo(52, 18);
  g.quadraticCurveTo(44, 60, 30, 78);
  g.quadraticCurveTo(22, 100, 46, 104);
  g.quadraticCurveTo(64, 116, 82, 104);
  g.quadraticCurveTo(106, 100, 98, 78);
  g.quadraticCurveTo(84, 60, 76, 18);
  g.closePath();
  g.fill();
  g.stroke();
  g.fillStyle = '#ffd9c2';
  g.beginPath();
  g.ellipse(52, 72, 8, 12, -0.4, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#1d1b3a';
  for (const x of [50, 78]) {
    g.beginPath();
    g.ellipse(x, 96, 8, 5, 0, 0, Math.PI * 2);
    g.fill();
  }
  noseTex = new THREE.CanvasTexture(c);
  noseTex.colorSpace = THREE.SRGBColorSpace;
  return noseTex;
}

let reticleTex: THREE.Texture | null = null;
/** Robot Mode's red lock-on reticle. */
function reticleTexture(): THREE.Texture {
  if (reticleTex) return reticleTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.strokeStyle = '#ff2030';
  g.lineWidth = 7;
  g.beginPath();
  g.arc(64, 64, 40, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = 6;
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    g.beginPath();
    g.moveTo(64 + Math.cos(a) * 30, 64 + Math.sin(a) * 30);
    g.lineTo(64 + Math.cos(a) * 58, 64 + Math.sin(a) * 58);
    g.stroke();
  }
  // Corner brackets.
  g.lineWidth = 5;
  for (const [x, y, dx, dy] of [
    [8, 8, 1, 1],
    [120, 8, -1, 1],
    [8, 120, 1, -1],
    [120, 120, -1, -1],
  ]) {
    g.beginPath();
    g.moveTo(x, y + dy * 22);
    g.lineTo(x, y);
    g.lineTo(x + dx * 22, y);
    g.stroke();
  }
  g.fillStyle = '#ff2030';
  g.beginPath();
  g.arc(64, 64, 6, 0, Math.PI * 2);
  g.fill();
  reticleTex = new THREE.CanvasTexture(c);
  reticleTex.colorSpace = THREE.SRGBColorSpace;
  return reticleTex;
}

function sprite(tex: THREE.Texture, color = 0xffffff): THREE.Sprite {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color, transparent: true, depthTest: false, depthWrite: false }));
  // Seen through walls: the nose always knows, and so does the robot.
  s.renderOrder = 20;
  s.visible = false;
  return s;
}

interface RobotLock {
  robot: number;
  targets: number[];
  start: number;
  reticles: THREE.Sprite[];
  lasers: THREE.Mesh[];
}

interface Cloud {
  x: number;
  y: number;
  z: number;
  until: number;
  ring: number;
}

/**
 * Everything you see and hear of ults: the splash and meter for your own, callouts and kill-feed
 * lines for everyone else's, the Chase nose, Robot Mode's reticles and lasers, Crop Duster's
 * shockwave and cloud, the Big Blow and rocket effects. Every sound has a visual (the game plays
 * fine muted).
 */
export class UltView {
  readonly root = new THREE.Group();
  private readonly noses = new Map<number, THREE.Sprite>();
  private readonly locks: RobotLock[] = [];
  private readonly clouds: Cloud[] = [];
  private readonly later: { at: number; fn: () => void }[] = [];
  private time = 0;
  private wasReady = false;
  /** When you last popped your ult locally (so the server's echo doesn't repeat the splash). */
  private predictedAt = -99;
  private fartPredictedAt = -99;
  private robotScanUntil = 0;
  private readonly laserGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true).translate(0, 0.5, 0).rotateX(Math.PI / 2);
  private readonly laserMat = new THREE.MeshBasicMaterial({ color: 0xff2030, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending });

  /** Rainbow road pieces laid by Pride Parades (drawn here; the server has its own copy that bounces people). */
  private readonly road: { x: number; y: number; z: number; a: number; born: number }[] = [];
  private readonly roadLast = new Map<number, { t: number; x: number; z: number }>();
  private readonly roadMesh: THREE.InstancedMesh;

  constructor(private readonly g: UltHost) {
    g.scene.add(this.root);
    const roadGeo = new THREE.PlaneGeometry(1, 1);
    roadGeo.rotateX(-Math.PI / 2);
    this.roadMesh = new THREE.InstancedMesh(roadGeo, new THREE.MeshBasicMaterial({ map: roadTexture(), transparent: true, opacity: 0.92, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }), MAX_ROAD);
    this.roadMesh.frustumCulled = false;
    this.roadMesh.count = 0;
    this.roadMesh.renderOrder = 1;
    this.root.add(this.roadMesh);
    // Ult projectiles get their own looks.
    const bigMat = new THREE.MeshStandardMaterial({ color: 0x9fe8ff, emissive: 0x2ec5ff, emissiveIntensity: 1.1, transparent: true, opacity: 0.55, roughness: 0.1, depthWrite: false });
    g.effects.registerProjectile(PROJ_BIG_BLOW, { geo: new THREE.SphereGeometry(1, 24, 16), mat: bigMat, scale: true, stretch: true, trail: [0xe8fbff, 0x9fe8ff, 0xffffff], trailSize: 0.45 });
    // A little white rocket with its nose along +z (the flight direction).
    const body = new THREE.CylinderGeometry(0.11, 0.11, 0.55, 8).rotateX(Math.PI / 2);
    const nose = new THREE.ConeGeometry(0.11, 0.22, 8).rotateX(Math.PI / 2).translate(0, 0, 0.38);
    const geo = mergeGeos([body, nose]);
    g.effects.registerProjectile(PROJ_ROCKET, { geo, mat: new THREE.MeshStandardMaterial({ color: 0xdfe6f3, emissive: 0xff2030, emissiveIntensity: 0.5, metalness: 0.5, roughness: 0.3 }), scale: false, stretch: false, trail: [0xffffff, 0xd8d8d8, 0xff9f1c], trailSize: 0.9 });
  }

  /** Clears everything (leaving a match). */
  clear(): void {
    for (const s of this.noses.values()) this.root.remove(s);
    this.noses.clear();
    for (const l of this.locks) this.dropLock(l);
    this.locks.length = 0;
    this.clouds.length = 0;
    this.later.length = 0;
    this.road.length = 0;
    this.roadLast.clear();
    this.roadMesh.count = 0;
    this.wasReady = false;
  }

  // --- Events ------------------------------------------------------------------------------

  /** Handles the ult events ('ult', 'fart', 'sniff', 'gotcha'). */
  onEvent(e: GameEvent): void {
    switch (e.t) {
      case 'ult':
        this.onUlt(e);
        break;
      case 'fart':
        this.onFart(e);
        break;
      case 'sniff':
        this.onSniff(e.id, e.target);
        break;
      case 'gotcha':
        this.onGotcha(e.id, e.target);
        break;
      case 'bag':
        this.onBag(e.id, e.target);
        break;
      default:
        break;
    }
  }

  private headOf(id: number): THREE.Vector3 | null {
    const p = this.g.players().find((q) => q.id === id);
    return p ? tmp.set(p.x, p.head, p.z) : null;
  }

  private nameHtml(id: number): string {
    return `<b style="color:${hexColor(this.g.colorOf(id))}">${esc(this.g.nameOf(id))}</b>`;
  }

  private onUlt(e: Extract<GameEvent, { t: 'ult' }>): void {
    const g = this.g;
    const you = g.youId();
    const info = ULT_INFO[e.kind];
    const mine = e.id === you;
    const at: [number, number, number] = [e.x, e.y, e.z];
    if (mine) {
      // Already shown when you pressed it (predicted); otherwise show it now.
      if (this.time - this.predictedAt > 1) this.selfPop(e.kind);
    } else {
      g.hud.addKill(`${this.nameHtml(e.id)} turned into <b style="color:${info.color}">${iconHtml(ULT_ICON[e.kind])} ${esc(info.name.toUpperCase())}</b>`, e.targets.includes(you));
      const head = this.headOf(e.id);
      if (head) g.hud.popup(head.clone().setY(head.y + 1), `${info.name.toUpperCase()}!`, info.color, 1.3, 1.6);
      g.audio.ultGo(e.kind, at);
      g.effects.shockwave(e.x, e.y + 0.1, e.z, 2.5, 0.5, new THREE.Color(info.color).getHex(), true);
    }
    switch (e.kind) {
      case 'bigBlow': {
        const head = this.headOf(e.id);
        if (head && !mine) g.hud.popup(head.clone().setY(head.y + 0.2), 'LOADED!', info.color, 0.9, 1.2, true);
        break;
      }
      case 'juice': {
        // Your own jab already started with the splash.
        if (!mine) g.jab(e.id);
        this.popAt(e.id, 0.45, 'PSSSHT!', '#9fe8ff', 0.9);
        this.popAt(e.id, 0.9, 'PUMPED!', info.color, 1.4);
        this.popAt(e.id, 1.7, 'GAINS!', '#ffd60a', 1.2);
        break;
      }
      case 'chase': {
        this.popAt(e.id, 0, 'SNIFF SNIFF', info.color, 1.1);
        const target = e.targets[0] ?? -1;
        // Everyone gets warned; whoever he picked hears it loudest.
        if (target === you) this.warnChased(e.id);
        else if (!mine) g.hud.callout('WARNING: ABAG IS TRYING TO BAG YOU!', "Don't let him grab you!", 2.4, info.color);
        if (mine && target < 0) g.hud.toast('Nobody to sniff out... yet. Keep moving!', 2200);
        // After your splash has gone.
        else if (mine) this.later.push({ at: this.time + 1.5, fn: () => g.hud.callout('SNIFF SNIFF...', `Go bag ${g.nameOf(target)}! Touch them to hug them.`, 1.8, info.color, CALLOUT.info) });
        break;
      }
      case 'cropDuster':
        this.popAt(e.id, 0, '*GURGLE*', '#8ee000', 1);
        break;
      case 'robot':
        this.startLock(e.id, e.targets);
        break;
      case 'pride':
        this.prideBurst(e.x, e.y, e.z);
        this.popAt(e.id, 0.2, 'YAAAS!', '#ff5fd2', 1.2);
        this.popAt(e.id, 0.9, 'LOVE WINS!', '#ffed00', 1.1);
        break;
    }
  }

  /** The rainbow burst when a Pride Parade starts: six rings, one per stripe, and rainbow confetti. */
  private prideBurst(x: number, y: number, z: number): void {
    const fx = this.g.effects;
    const R = BALANCE.ults.pride.burstRadius;
    RAINBOW.forEach((col, i) => fx.shockwave(x, y + 0.12 + i * 0.02, z, (R * (1 - i * 0.1)) / 1.2, 0.55 + i * 0.05, col, true));
    fx.confettiBurst(x, y + 1.2, z, this.g.lowQuality() ? 30 : 70, RAINBOW);
  }

  /** Lays road behind every Pride Parade and ages the pieces (they shrink away at the end). */
  private updateRoad(players: UltPlayerView[]): void {
    const P = BALANCE.ults.pride;
    const now = this.time;
    for (const p of players) {
      if (publicUltKind(p.ult) !== 'pride') {
        this.roadLast.delete(p.id);
        continue;
      }
      const last = this.roadLast.get(p.id);
      if (last && now - last.t < P.roadEvery) continue;
      const ground = this.g.groundAt(p.x, p.y + 0.3, p.z);
      if (ground === null) continue;
      // Pieces point along the way you're going.
      const a = last && Math.hypot(p.x - last.x, p.z - last.z) > 0.05 ? Math.atan2(p.x - last.x, p.z - last.z) : (this.road[this.road.length - 1]?.a ?? 0);
      this.roadLast.set(p.id, { t: now, x: p.x, z: p.z });
      this.road.push({ x: p.x, y: ground + 0.03, z: p.z, a, born: now });
      if (this.road.length > MAX_ROAD) this.road.shift();
    }
    while (this.road.length && now - this.road[0].born > P.roadLife) this.road.shift();
    const m = this.roadMesh;
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const sc = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const mat = new THREE.Matrix4();
    this.road.forEach((r, i) => {
      const age = now - r.born;
      const k = Math.min(1, age / 0.12) * Math.min(1, (P.roadLife - age) / 0.6);
      q.setFromAxisAngle(up, r.a);
      pos.set(r.x, r.y, r.z);
      sc.set(P.roadRadius * 1.6 * k, 1, 0.95);
      mat.compose(pos, q, sc);
      m.setMatrixAt(i, mat);
    });
    m.count = this.road.length;
    m.instanceMatrix.needsUpdate = true;
  }

  /** Your own ult: the banner, a light tint, sound and kick. */
  private selfPop(kind: UltId): void {
    const g = this.g;
    const info = ULT_INFO[kind];
    g.hud.ult.splash(info.name, ULT_ICON[kind], info.color, info.tagline, info.by, g.charFace(kind));
    g.hud.flash(`${info.color}30`, 300);
    g.audio.ultGo(kind, null);
    g.shake(0.3, 6);
    if (kind === 'robot') this.robotScanUntil = this.time + BALANCE.ults.robot.scanTime;
    if (kind === 'juice') g.jab(g.youId());
  }

  /** Called with each of your predicted steps: your ult feels instant. */
  localStep(ult: boolean, fartBlast: boolean): void {
    const p = this.g.pred();
    if (ult) {
      this.predictedAt = this.time;
      this.selfPop(ultOf(p));
    }
    if (fartBlast) {
      this.fartPredictedAt = this.time;
      this.fartFx(p.px, p.py, p.pz, BALANCE.ults.cropDuster.radius, true);
    }
  }

  private onFart(e: Extract<GameEvent, { t: 'fart' }>): void {
    const you = this.g.youId();
    if (e.id !== you || this.time - this.fartPredictedAt > 1) this.fartFx(e.x, e.y, e.z, e.r, e.id === you);
    this.clouds.push({ x: e.x, y: e.y, z: e.z, until: e.until, ring: 0 });
    const p = this.g.pred();
    // The feed already said they turned into SOL: a second line only if you were caught in it.
    if (e.id !== you && this.g.alive() && Math.hypot(p.px - e.x, p.pz - e.z) < e.r + 1) {
      this.g.hud.callout('CROP DUSTED!', `${this.g.nameOf(e.id)} let one rip right next to you`, 1.6, '#8ee000');
      this.g.hud.flash('rgba(140, 224, 0, 0.55)', 700);
      this.g.hud.addKill(`${this.nameHtml(e.id)} <b style="color:#8ee000">${iconHtml('gasCloud')} CROP DUSTED</b> you`, true);
    }
  }

  /** The big green shockwave, cloud burst and the loudest fart in the game. */
  private fartFx(x: number, y: number, z: number, r: number, mine: boolean): void {
    const fx = this.g.effects;
    const low = this.g.lowQuality();
    fx.shockwave(x, y + 0.15, z, r / 1.2, 0.65, 0x8ee000, true);
    fx.shockwave(x, y + 0.3, z, r / 1.6, 0.5, 0x5fbf2a, true);
    fx.shockwave(x, y + 1, z, 4, 0.45, 0xc6f08a, false, this.g.camera.position);
    for (let i = 0; i < 3; i++) {
      const a = Math.random() * Math.PI * 2;
      fx.fartCloud(x, y, z, Math.cos(a), Math.sin(a), true);
    }
    const n = low ? 24 : 60;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.2;
      const sp = 9 + Math.random() * 8;
      fx.puff({ x, y: y + 0.4 + Math.random() * 0.6, z, vx: Math.cos(a) * sp, vy: Math.random() * 1.5, vz: Math.sin(a) * sp, size: 0.3 + Math.random() * 0.2, grow: 1.6, max: 1 + Math.random() * 0.5, drag: 2.4, gravity: -0.4 }, new THREE.Color().setHSL(0.22 + Math.random() * 0.06, 0.65, 0.55 + Math.random() * 0.15));
    }
    const d = this.g.camera.position.distanceTo(tmp2.set(x, y, z));
    this.g.hud.popup(tmp2.set(x, y + 3.2, z), 'PFFFFRRRRRRT!!!', '#8ee000', 2.1, 1.8, !mine && d > 18);
    this.g.audio.megaFart(mine ? null : [x, y, z]);
    if (d < 18) this.g.shake((1 - d / 18) * 0.8, mine ? 8 : 4);
  }

  private onSniff(id: number, target: number): void {
    this.popAt(id, 0, 'SNIFF SNIFF', ULT_INFO.chase.color, 1);
    this.g.audio.sniff(id === this.g.youId() ? null : this.at(id));
    if (target === this.g.youId()) this.warnChased(id);
    if (id === this.g.youId()) this.g.hud.callout('NEW SCENT!', `Now go bag ${this.g.nameOf(target)}`, 1.3, ULT_INFO.chase.color, CALLOUT.info);
  }

  private warnChased(by: number): void {
    const g = this.g;
    g.hud.callout('WARNING: ABAG IS TRYING TO BAG YOU!', `He picked YOU (${g.nameOf(by)}). Don't let him grab you! RUN!`, 2.6, ULT_INFO.chase.color);
    g.hud.flash('rgba(255, 95, 210, 0.5)', 500);
    g.audio.sniff(null);
  }

  /** ABAG caught his target: a big hug. */
  private onBag(id: number, target: number): void {
    const g = this.g;
    const you = g.youId();
    this.popAt(target, 0, 'BAGGED!', ULT_INFO.chase.color, 1.9);
    g.audio.gotcha(id === you || target === you ? null : this.at(target));
    if (target === you) g.hud.callout('BAGGED!', 'ABAG got you! Dash when the marker hits green to wriggle free!', 1.8, ULT_INFO.chase.color);
    else if (id === you) g.hud.callout('BAGGED!', 'Now throw them off the map (extra hard)!', 1.6, ULT_INFO.chase.color);
    g.hud.addKill(`${this.nameHtml(id)} <b style="color:${ULT_INFO.chase.color}">${iconHtml('bag')} BAGGED</b> ${this.nameHtml(target)}`, id === you || target === you);
    const p = this.headOf(target);
    if (p) g.effects.confettiBurst(p.x, p.y, p.z, 30, [0xff5fd2, 0xffffff]);
  }

  private onGotcha(id: number, target: number): void {
    const g = this.g;
    const you = g.youId();
    this.popAt(target, 0, 'GOTCHA!', ULT_INFO.chase.color, 1.8);
    g.audio.gotcha(id === you || target === you ? null : this.at(target));
    if (id === you) g.hud.callout('GOTCHA!', 'Run down and thrown extra hard!', 1.6, ULT_INFO.chase.color);
    else if (target === you) g.hud.callout('CAUGHT!', `${g.nameOf(id)} ran you down`, 1.6, ULT_INFO.chase.color);
    const p = this.headOf(target);
    if (p) g.effects.confettiBurst(p.x, p.y, p.z, 40, [0xff5fd2, 0xffd60a, 0xffffff]);
  }

  private at(id: number): [number, number, number] | null {
    const p = this.g.players().find((q) => q.id === id);
    return p ? [p.x, p.y, p.z] : null;
  }

  /** A comic word over someone's head, `delay` seconds from now. */
  private popAt(id: number, delay: number, text: string, color: string, scale: number): void {
    const show = () => {
      const h = this.headOf(id);
      if (h) this.g.hud.popup(h.clone().setY(h.y + 0.6 + Math.random() * 0.4), text, color, scale, 1.3, id !== this.g.youId());
    };
    if (delay <= 0) show();
    else this.later.push({ at: this.time + delay, fn: show });
  }

  // --- Shots and booms ---------------------------------------------------------------------

  /** Someone's ult projectile left: sound and a flash. */
  onShot(e: Extract<GameEvent, { t: 'shot' }>): void {
    const g = this.g;
    const mine = e.owner === g.youId();
    const sp = Math.hypot(e.vx, e.vy, e.vz) || 1;
    if (e.w === PROJ_BIG_BLOW) {
      g.audio.bigBlowShot(mine ? null : [e.x, e.y, e.z]);
      g.effects.muzzleFlash(e.x, e.y, e.z, e.vx / sp, e.vy / sp, e.vz / sp, 2);
      g.effects.flash(e.x, e.y, e.z, 4, 0x9fe8ff, 0.2);
    } else if (e.w === PROJ_ROCKET) {
      g.audio.rocket(mine ? null : [e.x, e.y, e.z]);
      g.effects.flash(e.x, e.y, e.z, 1.2, 0xff9f1c, 0.1);
      g.effects.airPuff(e.x, e.y, e.z, 4, 2, 0.18, 0xdddddd);
    }
  }

  /** Your own Big Blow, predicted: the big kick. */
  localBigBlow(x: number, y: number, z: number, dx: number, dy: number, dz: number): void {
    this.g.audio.bigBlowShot(null);
    this.g.effects.muzzleFlash(x, y, z, dx, dy, dz, 2);
    this.g.effects.flash(x + dx, y + dy, z + dz, 3, 0x9fe8ff, 0.2);
    this.g.shake(0.45, 10);
  }

  /** An ult projectile burst (called after the normal blast). */
  onBoom(e: Extract<GameEvent, { t: 'boom' }>): void {
    const g = this.g;
    const fx = g.effects;
    if (e.k === PROJ_BIG_BLOW) {
      fx.flash(e.x, e.y, e.z, e.r * 2.2, 0xffffff, 0.2);
      fx.flash(e.x, e.y, e.z, e.r * 1.6, 0x2ec5ff, 0.35);
      fx.shockwave(e.x, e.y, e.z, e.r * 1.1, 0.5, 0xffffff, false, g.camera.position);
      fx.shockwave(e.x, e.y, e.z, e.r * 0.8, 0.4, 0x2ec5ff, false, g.camera.position);
      fx.shockwave(e.x, e.y + 0.2, e.z, e.r * 0.9, 0.55, 0x9fe8ff, true);
      fx.confettiBurst(e.x, e.y, e.z, g.lowQuality() ? 30 : 70, [0x2ec5ff, 0xffffff, 0x9fe8ff, 0xffd60a]);
      const near = Math.max(0, Math.min(1, (g.camera.position.distanceTo(tmp2.set(e.x, e.y, e.z)) - 2) / 6));
      fx.airPuff(e.x, e.y, e.z, Math.round((g.lowQuality() ? 10 : 26) * near), 12, 0.35);
      g.hud.popup(tmp2.set(e.x, e.y + 2, e.z), 'KA-BLOOOW!', '#2ec5ff', 2, 1.5);
      g.audio.bigBoom(e.owner === g.youId() ? null : [e.x, e.y, e.z]);
      const d = g.camera.position.distanceTo(tmp2.set(e.x, e.y, e.z));
      if (d < 20) g.shake((1 - d / 20) * 0.7, 5);
    } else if (e.k === PROJ_ROCKET) {
      fx.flash(e.x, e.y, e.z, 2.2, 0xff9f1c, 0.14);
      fx.shockwave(e.x, e.y, e.z, e.r * 0.8, 0.3, 0xff3b5c, false, g.camera.position);
      g.hud.popup(tmp2.set(e.x, e.y + 1, e.z), 'BOOM', '#ff3b5c', 0.8, 0.7, true);
    }
  }

  // --- Robot Mode ----------------------------------------------------------------------------

  private startLock(robot: number, targets: number[]): void {
    const g = this.g;
    const you = g.youId();
    const R = BALANCE.ults.robot;
    const lock: RobotLock = { robot, targets, start: this.time, reticles: [], lasers: [] };
    for (let i = 0; i < targets.length; i++) {
      const s = sprite(reticleTexture());
      this.root.add(s);
      lock.reticles.push(s);
      const m = new THREE.Mesh(this.laserGeo, this.laserMat);
      m.frustumCulled = false;
      m.visible = false;
      this.root.add(m);
      lock.lasers.push(m);
    }
    this.locks.push(lock);
    this.popAt(robot, 0, targets.length ? `TARGET ACQUIRED: ${targets.length}` : 'NO TARGETS. FIRING BLIND.', '#ff3b5c', 1);
    g.audio.laser(robot === you ? null : this.at(robot));
    this.later.push({
      at: this.time + R.scanTime,
      fn: () => {
        this.popAt(robot, 0, 'EXECUTING', '#ff3b5c', 1.1);
        g.audio.robotVoice(robot === you ? null : this.at(robot), [12, 12, 7, 0]);
      },
    });
    if (targets.includes(you)) {
      g.hud.callout('LOCKED ON!', `${g.nameOf(robot).toUpperCase()}'S ROBOT MODE HAS YOU. MOVE!`, 2, '#ff3b5c');
      g.hud.flash('rgba(255, 32, 48, 0.45)', 450);
      g.audio.robotVoice(null, [0, 0, 0]);
    }
  }

  private dropLock(l: RobotLock): void {
    for (const s of l.reticles) {
      this.root.remove(s);
      s.material.dispose();
    }
    for (const m of l.lasers) this.root.remove(m);
  }

  private updateLocks(players: UltPlayerView[]): void {
    const R = BALANCE.ults.robot;
    const eye = tmp2;
    for (let i = this.locks.length - 1; i >= 0; i--) {
      const l = this.locks[i];
      const age = this.time - l.start;
      if (age > R.scanTime + R.barrageTime + 0.4) {
        this.dropLock(l);
        this.locks.splice(i, 1);
        continue;
      }
      const haveEye = this.g.eyeOf(l.robot, eye) !== null;
      l.targets.forEach((id, k) => {
        const t = players.find((p) => p.id === id);
        const s = l.reticles[k];
        const laser = l.lasers[k];
        if (!t) {
          s.visible = false;
          laser.visible = false;
          return;
        }
        // Reticles spin in and clamp down while scanning, then hold and pulse.
        const lockIn = Math.min(1, age / R.scanTime);
        const cy = t.y + (t.head - t.y) * 0.55;
        const d = this.g.camera.position.distanceTo(tmp.set(t.x, cy, t.z));
        const size = Math.max(2.2, d * 0.07) * (1 + (1 - lockIn) * 2.5) * (lockIn >= 1 ? 1 + Math.sin(this.time * 18) * 0.06 : 1);
        s.visible = true;
        s.position.set(t.x, cy, t.z);
        s.scale.set(size, size, 1);
        s.material.rotation = (1 - lockIn) * 3 + this.time * 0.8;
        s.material.opacity = 0.35 + 0.65 * lockIn;
        // The scanning laser: robot's eyes to each target, flickering, while it locks on.
        laser.visible = haveEye && age < R.scanTime + 0.15;
        if (laser.visible) {
          laser.position.copy(eye);
          laser.lookAt(t.x, cy, t.z);
          const w = 0.03 + Math.random() * 0.02;
          laser.scale.set(w, w, eye.distanceTo(tmp.set(t.x, cy, t.z)));
        }
      });
      this.laserMat.opacity = 0.55 + Math.random() * 0.4;
    }
  }

  // --- Per frame ---------------------------------------------------------------------------

  update(dt: number): void {
    this.time += dt;
    for (let i = this.later.length - 1; i >= 0; i--) {
      if (this.time >= this.later[i].at) {
        const f = this.later[i].fn;
        this.later.splice(i, 1);
        f();
      }
    }
    const g = this.g;
    const players = g.players();
    this.updateNoses(players);
    this.updateLocks(players);
    this.updateClouds(dt);
    this.updateRoad(players);
    this.auras(dt, players);
    this.updateHud(players, dt);
  }

  /** A glowing nose bobbing over whoever each Chase is after. */
  private updateNoses(players: UltPlayerView[]): void {
    const seen = new Set<number>();
    for (const p of players) {
      if (publicUltKind(p.ult) !== 'chase' || p.ultTarget < 0) continue;
      const t = players.find((q) => q.id === p.ultTarget);
      if (!t) continue;
      seen.add(p.id);
      let s = this.noses.get(p.id);
      if (!s) {
        s = sprite(noseTexture());
        this.root.add(s);
        this.noses.set(p.id, s);
      }
      const d = this.g.camera.position.distanceTo(tmp.set(t.x, t.head, t.z));
      const size = Math.max(2, d * 0.1) * (1 + Math.sin(this.time * 9) * 0.08);
      s.visible = !(t.id === this.g.youId());
      s.position.set(t.x, t.head + 0.6 + size * 0.5 + Math.sin(this.time * 4) * 0.15, t.z);
      s.scale.set(size, size, 1);
    }
    for (const [id, s] of this.noses) {
      if (seen.has(id)) continue;
      this.root.remove(s);
      s.material.dispose();
      this.noses.delete(id);
    }
  }

  /** Crop Duster clouds: green gas bubbling up until they clear. */
  private updateClouds(dt: number): void {
    const C = BALANCE.ults.cropDuster;
    const fx = this.g.effects;
    const now = this.g.tick();
    const rate = this.g.lowQuality() ? 10 : 30;
    for (let i = this.clouds.length - 1; i >= 0; i--) {
      const c = this.clouds[i];
      const left = (c.until - now) * DT;
      if (left <= 0) {
        this.clouds.splice(i, 1);
        continue;
      }
      const fade = Math.min(1, left / 1.2);
      const n = Math.max(0, Math.round(dt * rate * fade + Math.random() * 0.6));
      for (let k = 0; k < n; k++) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * C.cloudRadius * 0.95;
        fx.puff(
          { x: c.x + Math.cos(a) * r, y: c.y + 0.2 + Math.random() * 1.6, z: c.z + Math.sin(a) * r, vx: (Math.random() - 0.5) * 0.8, vy: 0.3 + Math.random() * 0.5, vz: (Math.random() - 0.5) * 0.8, size: 0.3 + Math.random() * 0.25, grow: 1.2, max: 1.4 + Math.random() * 0.6, drag: 1, gravity: -0.15 },
          new THREE.Color().setHSL(0.2 + Math.random() * 0.08, 0.6, 0.5 + Math.random() * 0.2),
        );
      }
      c.ring -= dt;
      if (c.ring <= 0) {
        c.ring = 0.9;
        fx.shockwave(c.x, c.y + 0.08, c.z, C.cloudRadius / 1.2, 0.8, 0x8ee000, true);
      }
    }
  }

  /** Little tells on players with an ult going: sparkles on a loaded Big Blow, stink lines when gassed. */
  private auras(dt: number, players: UltPlayerView[]): void {
    const fx = this.g.effects;
    const k = this.g.lowQuality() ? 0.5 : 1;
    for (const p of players) {
      const kind = publicUltKind(p.ult);
      const r = () => (Math.random() - 0.5) * 1.4;
      if (kind === 'bigBlow' && Math.random() < dt * 14 * k) fx.confetto({ x: p.x + r(), y: p.y + Math.random() * (p.head - p.y), z: p.z + r(), vy: 1.2, size: 0.7, grow: 0, max: 0.8, drag: 1, spin: 5 }, [0x2ec5ff, 0x9fe8ff, 0xffffff][Math.floor(Math.random() * 3)]);
      if (kind === 'juice' && Math.random() < dt * 6 * k) fx.confetto({ x: p.x + r(), y: p.head - 0.3, z: p.z + r(), vy: 2, size: 0.5, grow: 0, max: 0.7, drag: 1, gravity: 6, spin: 4 }, 0xbff0ff);
      if (kind === 'robot' && Math.random() < dt * 8 * k) fx.puff({ x: p.x + r() * 0.5, y: p.head, z: p.z + r() * 0.5, vy: 1.5, size: 0.12, grow: 1, max: 0.5, drag: 2 }, 0xff2030);
      if (kind === 'pride' && Math.random() < dt * 7 * k) fx.confetto({ x: p.x + r(), y: p.head - 0.2, z: p.z + r(), vy: 1.5, size: 0.5, grow: 0, max: 0.7, drag: 1, gravity: 3, spin: 5 }, RAINBOW[Math.floor(Math.random() * RAINBOW.length)]);
      if (p.ult & ULT_BIT_GASSED && Math.random() < dt * 10 * k) fx.puff({ x: p.x + r(), y: p.y + 0.5 + Math.random() * (p.head - p.y), z: p.z + r(), vy: 1, size: 0.3, grow: 1.5, max: 0.9, drag: 1.5 }, 0x9ccc4a);
    }
  }

  /** Ult charge you earned that deserves a callout (a knockout, an assist, a goal). */
  onCharge(why: 'ko' | 'assist' | 'goal', amount: number): void {
    const label = why === 'ko' ? 'KO' : why === 'assist' ? 'ASSIST' : 'GOAL';
    this.g.hud.ult.gain(amount, label);
    // Already shown: don't count it again as plain charge.
    this.shownCharge += amount / 100;
  }

  /** Charge from hits and time, gathered up and shown as "+N%" now and then. */
  private chargeFeedback(frac: number, dt: number): void {
    const d = frac - this.lastFrac;
    this.lastFrac = frac;
    if (d > 0 && d < 0.9) this.pendingCharge += d;
    this.chargeTimer -= dt;
    if (this.chargeTimer > 0) return;
    this.chargeTimer = 0.45;
    const extra = this.pendingCharge - this.shownCharge;
    this.pendingCharge = 0;
    this.shownCharge = 0;
    // The trickle over time (about 1% a second) isn't worth a popup; hits are.
    if (extra >= 0.03) this.g.hud.ult.gain(Math.round(extra * 100), '');
  }

  private lastFrac = 0;
  private pendingCharge = 0;
  private shownCharge = 0;
  private chargeTimer = 0;

  private updateHud(players: UltPlayerView[], dt: number): void {
    const g = this.g;
    const p = g.pred();
    this.chargeFeedback(g.alive() ? p.ult : this.lastFrac, dt);
    const alive = g.alive();
    const kind = ultOf(p);
    const info = ULT_INFO[kind];
    const ready = alive && ultReady(p);
    if (ready && !this.wasReady) {
      g.hud.ult.readyPulse();
      g.audio.ultReady();
    }
    this.wasReady = ready;
    const you = g.youId();
    const chaser = players.find((q) => q.id !== you && publicUltKind(q.ult) === 'chase' && q.ultTarget === you);
    let status = '';
    let statusIcon: IconName | null = null;
    let warn = false;
    if (alive) {
      switch (activeUlt(p)) {
        case 'bigBlow':
          statusIcon = 'bigBlow';
          status = 'BIG BLOW LOADED: FIRE!';
          break;
        case 'juice':
          statusIcon = 'syringe';
          status = `JUICED ${Math.ceil(p.juiceTimer)}s`;
          break;
        case 'chase':
          statusIcon = 'nose';
          status = p.chaseTarget >= 0 ? `HUNTING ${g.nameOf(p.chaseTarget).toUpperCase()} ${Math.ceil(p.chaseTimer)}s` : 'SNIFFING...';
          break;
        case 'cropDuster':
          statusIcon = 'gasCloud';
          status = '...';
          break;
        case 'robot':
          statusIcon = 'robot';
          status = this.time < this.robotScanUntil ? 'TARGET ACQUIRED' : 'EXECUTING';
          break;
        case 'pride':
          statusIcon = 'rainbow';
          status = `PRIDE PARADE ${Math.ceil(p.prideTimer)}s`;
          break;
        default:
          if (chaser) {
            statusIcon = 'nose';
            status = `${g.nameOf(chaser.id).toUpperCase()} IS ON YOUR SCENT!`;
            warn = true;
          }
      }
    }
    g.hud.ult.update({
      alive,
      frac: Math.min(1, p.ult),
      ready,
      icon: ULT_ICON[ultOf(p)],
      name: info.name,
      face: g.charFace(ultOf(p)),
      color: info.color,
      key: g.keyOf(),
      status,
      statusIcon,
      warn,
      gassed: alive && p.gasTimer > 0,
      scanning: alive && this.time < this.robotScanUntil,
      chased: alive && !!chaser,
    });
  }

  // --- Poses ---------------------------------------------------------------------------------

  /** Sets a tube man's ult pose from the public bits. */
  pose(pose: TubeManPose, bits: number): void {
    const kind = publicUltKind(bits);
    pose.jacked = kind === 'juice';
    pose.bentOver = kind === 'cropDuster';
    pose.robot = kind === 'robot';
  }

  /** Suffix for name tags (markup): a bolt when their ult is ready. */
  tagSuffix(bits: number): string {
    return bits & ULT_BIT_READY ? ` ${iconHtml('bolt')}` : '';
  }
}

/** Joins non-indexed geometries into one (rocket body + nose). */
function mergeGeos(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const parts = list.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0;
  for (const p of parts) n += p.getAttribute('position').count;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  let o = 0;
  for (const p of parts) {
    pos.set(p.getAttribute('position').array as Float32Array, o * 3);
    nor.set(p.getAttribute('normal').array as Float32Array, o * 3);
    o += p.getAttribute('position').count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return out;
}
