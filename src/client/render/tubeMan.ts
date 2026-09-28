import * as THREE from 'three';
import { inflationScale } from '../../shared/player';
import type { WeaponId } from '../../shared/loadout';
import { FlexTube, noise1 } from './flexTube';
import { type WeaponModel, buildWeaponModel } from './weapons';
import { animateHat, applyFinish, buildFaceExtras, buildHat, disposeGroup } from './looks';

/** Cosmetic keys (see shared/economy.ts). */
export interface Look {
  pattern: string;
  face: string;
  hat: string;
  finish: string;
}

export const DEFAULT_LOOK: Look = { pattern: 'solid', face: 'smile', hat: 'spikes', finish: 'team' };

/** How long each taunt animation lasts, in seconds. */
const TAUNT_TIME: Record<string, number> = { burp: 0.9, wave: 1.6, spin: 1.1, noodle: 1.8, flex: 1.4 };

export interface TubeManPose {
  time: number;
  dt: number;
  inflation: number;
  vx: number;
  vy: number;
  vz: number;
  /** World yaw the character faces (0 = -Z). */
  yaw: number;
  onGround: boolean;
  launched: boolean;
  doubled: boolean;
  bracing: boolean;
  charge: number;
  hanging: boolean;
  dashing: boolean;
  protected: boolean;
  holding: boolean;
  held: boolean;
  /** Aim pitch, used to point the weapon. */
  pitch: number;
  streaming: boolean;
  hasPin: boolean;
  crowned: boolean;
  /** Has a streak reward active (Turbo Tank / Mega Blast): flickers orange-gold. */
  powered: boolean;
  /** This player last knocked you out (drawn with a red revenge glow). */
  nemesis: boolean;
}

export function defaultPose(): TubeManPose {
  return {
    time: 0,
    dt: 1 / 60,
    inflation: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    yaw: 0,
    onGround: true,
    launched: false,
    doubled: false,
    bracing: false,
    charge: 0,
    hanging: false,
    dashing: false,
    protected: false,
    holding: false,
    held: false,
    pitch: 0,
    streaming: false,
    hasPin: false,
    crowned: false,
    powered: false,
    nemesis: false,
  };
}

const BODY_LEN = 1.72;
const BODY_R = 0.36;
const BASE_H = 0.24;
/** A little self-glow so saturated colors catch the bloom. */
const BASE_GLOW = 0.1;
/** The head swells out of the tube (rounder, friendlier silhouette). */
const HEAD_R = BODY_R * 1.3;
const ARM_LEN = 0.95;
const ARM_R = 0.125;
const BODY_RINGS = 24;
const ARM_RINGS = 11;

// Scratch objects so animating a dozen tube men every frame allocates nothing.
const SV1 = new THREE.Vector3();
const SV2 = new THREE.Vector3();
const SV3 = new THREE.Vector3();
const SM = new THREE.Matrix4();
const Y_UP = new THREE.Vector3(0, 1, 0);

export type Pattern = 'solid' | 'stripes' | 'dots' | 'zigzag' | 'stars' | 'checker';

const patternCache = new Map<Pattern, THREE.Texture | null>();

/**
 * Grayscale pattern texture multiplied with the body color. Light parts stay the base color and
 * darker parts give a two-tone look, so every pattern works with every color.
 */
export function patternTexture(p: Pattern): THREE.Texture | null {
  if (p === 'solid') return null;
  const cached = patternCache.get(p);
  if (cached !== undefined) return cached;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 128, 256);
  g.fillStyle = '#b8b8c8';
  if (p === 'stripes') {
    for (let y = 0; y < 256; y += 32) g.fillRect(0, y, 128, 14);
  } else if (p === 'dots') {
    for (let y = 16; y < 256; y += 32) for (let x = (y / 32) % 2 ? 16 : 0; x < 128 + 16; x += 32) {
      g.beginPath();
      g.arc(x, y, 8, 0, Math.PI * 2);
      g.fill();
    }
  } else if (p === 'zigzag') {
    g.lineWidth = 9;
    g.strokeStyle = '#b8b8c8';
    for (let y = 20; y < 256; y += 40) {
      g.beginPath();
      for (let x = 0; x <= 128; x += 16) g.lineTo(x, y + ((x / 16) % 2 ? 10 : -10));
      g.stroke();
    }
  } else if (p === 'stars') {
    for (let y = 20; y < 256; y += 42) for (let x = (y / 42) % 2 ? 22 : 0; x < 150; x += 44) {
      g.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
        const r = i % 2 ? 5 : 12;
        g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      }
      g.fill();
    }
  } else if (p === 'checker') {
    for (let y = 0; y < 256; y += 32) for (let x = (y / 32) % 2 ? 32 : 0; x < 128; x += 64) g.fillRect(x, y, 32, 32);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  patternCache.set(p, tex);
  return tex;
}

/** Adds a soft candy-colored rim light (fresnel glow) to a standard material. */
export function addRim(mat: THREE.MeshStandardMaterial, strength = 0.55): void {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.rimStrength = { value: strength };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float rimStrength;')
      .replace(
        '#include <opaque_fragment>',
        `float rimF = pow(1.0 - saturate(dot(normalize(normal), normalize(vViewPosition))), 2.6);
        outgoingLight += (diffuseColor.rgb * 0.5 + vec3(0.5)) * rimF * rimStrength;
        #include <opaque_fragment>`,
      );
  };
  mat.customProgramCacheKey = () => `rim${strength}`;
}

const sharedGeo = {
  eye: new THREE.SphereGeometry(0.095, 16, 12),
  pupil: new THREE.SphereGeometry(0.05, 12, 8),
  mouthSmile: new THREE.TorusGeometry(0.085, 0.022, 6, 14, Math.PI),
  mouthO: new THREE.TorusGeometry(0.05, 0.022, 6, 14),
  base: new THREE.CylinderGeometry(0.4, 0.46, BASE_H, 20),
  baseRing: new THREE.TorusGeometry(0.34, 0.05, 8, 24),
  bubble: new THREE.SphereGeometry(1, 24, 16),
};

const sharedMat = {
  eye: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2 }),
  pupil: new THREE.MeshStandardMaterial({ color: 0x14122a, roughness: 0.3 }),
  mouth: new THREE.MeshStandardMaterial({ color: 0x3a0f22, roughness: 0.6 }),
  base: new THREE.MeshStandardMaterial({ color: 0x3b3f55, roughness: 0.55, metalness: 0.2 }),
  baseRing: new THREE.MeshStandardMaterial({ color: 0xc9d2e8, roughness: 0.35, metalness: 0.4 }),
  bubble: new THREE.MeshStandardMaterial({
    color: 0x9fe8ff,
    transparent: true,
    opacity: 0.22,
    roughness: 0.05,
    depthWrite: false,
    emissive: 0x6fd8ff,
    emissiveIntensity: 0.4,
  }),
};

/** A flailing inflatable tube man. Visual only: gameplay hitboxes follow the body capsule. */
export class TubeMan {
  readonly group = new THREE.Group();
  /** Everything that scales with inflation. */
  private readonly rig = new THREE.Group();
  private readonly body: FlexTube;
  private readonly arms: FlexTube[];
  private readonly face = new THREE.Group();
  private readonly eyes: THREE.Mesh[] = [];
  private readonly pupils: THREE.Mesh[] = [];
  private readonly mouthSmile: THREE.Mesh;
  private readonly mouthO: THREE.Mesh;
  private readonly hair = new THREE.Group();
  private readonly base: THREE.Group;
  private readonly bubble: THREE.Mesh;
  readonly bodyMat: THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial;
  private readonly seed: number;
  // Spring state for the wobbly lean (local x/z) and squash.
  private leanX = 0;
  private leanZ = 0;
  private leanVX = 0;
  private leanVZ = 0;
  private squash = 0;
  private squashV = 0;
  private spin = 0;
  private flail = 1;
  private lastVy = 0;
  private color = new THREE.Color();
  private readonly gunMount = new THREE.Group();
  private gun: WeaponModel | null = null;
  private gunId: WeaponId | null = null;
  private readonly pin: THREE.Group;
  private readonly crown: THREE.Group;
  private look: Look = { ...DEFAULT_LOOK };
  private hat: THREE.Group;
  private faceExtras: THREE.Group;
  private tauntStyle = '';
  private tauntT = 0;

  constructor(colorHex: number, opts: { physical?: boolean; seed?: number; pattern?: Pattern; look?: Partial<Look> } = {}) {
    this.seed = opts.seed ?? Math.random() * 100;
    this.look = { ...DEFAULT_LOOK, ...(opts.pattern ? { pattern: opts.pattern } : {}), ...opts.look };
    // Glossy vinyl: low roughness, strong environment reflections, a clear coat when the GPU can
    // afford it, and a rim light so the silhouette pops.
    const matOpts = {
      color: colorHex,
      roughness: 0.2,
      metalness: 0.0,
      emissive: new THREE.Color(colorHex),
      emissiveIntensity: BASE_GLOW,
      envMapIntensity: 2.2,
      map: patternTexture(this.look.pattern as Pattern),
    };
    this.bodyMat = opts.physical
      ? new THREE.MeshPhysicalMaterial({ ...matOpts, clearcoat: 0.9, clearcoatRoughness: 0.08 })
      : new THREE.MeshStandardMaterial(matOpts);
    addRim(this.bodyMat);
    this.color.set(colorHex);

    this.body = new FlexTube(BODY_RINGS, 24, this.bodyMat);
    this.arms = [new FlexTube(ARM_RINGS, 9, this.bodyMat), new FlexTube(ARM_RINGS, 9, this.bodyMat)];
    this.body.mesh.castShadow = true;
    for (const a of this.arms) a.mesh.castShadow = true;

    this.base = new THREE.Group();
    const baseMesh = new THREE.Mesh(sharedGeo.base, sharedMat.base);
    baseMesh.position.y = BASE_H / 2;
    baseMesh.castShadow = true;
    const ring = new THREE.Mesh(sharedGeo.baseRing, sharedMat.baseRing);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = BASE_H;
    this.base.add(baseMesh, ring);

    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(sharedGeo.eye, sharedMat.eye);
      const pupil = new THREE.Mesh(sharedGeo.pupil, sharedMat.pupil);
      eye.position.set(side * 0.12, 0, 0);
      pupil.position.set(side * 0.12, 0, 0.065);
      this.eyes.push(eye);
      this.pupils.push(pupil);
      this.face.add(eye, pupil);
    }
    this.mouthSmile = new THREE.Mesh(sharedGeo.mouthSmile, sharedMat.mouth);
    this.mouthSmile.rotation.z = Math.PI;
    this.mouthSmile.position.set(0, -0.2, 0.0);
    this.mouthO = new THREE.Mesh(sharedGeo.mouthO, sharedMat.mouth);
    this.mouthO.position.set(0, -0.2, 0.0);
    this.mouthO.visible = false;
    this.face.add(this.mouthSmile, this.mouthO);

    this.hat = buildHat(this.look.hat, colorHex);
    this.hair.add(this.hat);
    this.faceExtras = buildFaceExtras(this.look.face);
    this.face.add(this.faceExtras);
    this.applyFaceBase();
    // Bigger, friendlier face and hats sized for the rounder head.
    this.face.scale.setScalar(1.3);
    this.hair.scale.setScalar(HEAD_R / BODY_R);

    this.bubble = new THREE.Mesh(sharedGeo.bubble, sharedMat.bubble);
    this.bubble.visible = false;

    this.gunMount.rotation.order = 'YXZ';
    this.pin = makePin();
    this.pin.visible = false;
    this.crown = makeCrown();
    this.crown.visible = false;
    this.rig.add(this.crown);
    this.rig.add(this.base, this.body.mesh, this.arms[0].mesh, this.arms[1].mesh, this.face, this.hair, this.bubble, this.gunMount, this.pin);
    this.group.add(this.rig);
  }

  setColor(hex: number): void {
    this.color.set(hex);
    this.bodyMat.color.set(hex);
    this.bodyMat.emissive.set(hex);
    if (this.gun) applyFinish(this.gun, this.look.finish, hex);
    // Some hats are tinted from the body color.
    this.rebuildHat();
  }

  /** Changes pattern, face, hat and weapon finish. */
  setLook(look: Partial<Look>): void {
    const next = { ...this.look, ...look };
    const prev = this.look;
    this.look = next;
    if (next.pattern !== prev.pattern) {
      this.bodyMat.map = patternTexture(next.pattern as Pattern);
      this.bodyMat.needsUpdate = true;
    }
    if (next.hat !== prev.hat) this.rebuildHat();
    if (next.face !== prev.face) {
      this.face.remove(this.faceExtras);
      disposeGroup(this.faceExtras);
      this.faceExtras = buildFaceExtras(next.face);
      this.face.add(this.faceExtras);
      this.applyFaceBase();
    }
    if (next.finish !== prev.finish && this.gun) applyFinish(this.gun, next.finish, this.color.getHex());
  }

  private rebuildHat(): void {
    this.hair.remove(this.hat);
    disposeGroup(this.hat);
    this.hat = buildHat(this.look.hat, this.color.getHex());
    this.hair.add(this.hat);
  }

  /** Base eye/mouth layout for the current face (update() animates on top of this). */
  private applyFaceBase(): void {
    const f = this.look.face;
    const hideEyes = f === 'cyclops' || f === 'shades';
    for (const e of this.eyes) e.visible = !hideEyes;
    for (const p of this.pupils) p.visible = !hideEyes;
    this.mouthSmile.scale.setScalar(f === 'grin' ? 1.45 : 1);
  }

  private impactT = 0;

  /** Got hit: a squash, a jolt away from the hit, and a white flash. `dx/dz` in world space. */
  impact(strength: number, dx: number, dz: number): void {
    const k = Math.min(1, strength / 25);
    this.squashV -= 3 + k * 7;
    // Into the tube's local frame (+z forward, +x left).
    const yaw = this.group.rotation.y;
    const lx = dx * Math.cos(yaw) - dz * Math.sin(yaw);
    const lz = dx * Math.sin(yaw) + dz * Math.cos(yaw);
    this.leanVX += lx * (4 + k * 8);
    this.leanVZ += lz * (4 + k * 8);
    this.impactT = 0.1;
  }

  /** Plays a taunt animation (visual only). */
  taunt(style: string): void {
    this.tauntStyle = style;
    this.tauntT = TAUNT_TIME[style] ?? 1;
  }

  get weapon(): WeaponId | null {
    return this.gunId;
  }

  setWeapon(id: WeaponId | null): void {
    if (id === this.gunId) return;
    if (this.gun) {
      this.gunMount.remove(this.gun.root);
      this.gun.dispose();
      this.gun = null;
    }
    this.gunId = id;
    if (id) {
      this.gun = buildWeaponModel(id, this.color.getHex());
      applyFinish(this.gun, this.look.finish, this.color.getHex());
      this.gun.root.scale.setScalar(0.9);
      this.gunMount.add(this.gun.root);
    }
  }

  /** World position of the weapon's muzzle (for streams, honks and tracers). */
  muzzleWorld(out: THREE.Vector3): THREE.Vector3 | null {
    if (!this.gun || !this.group.visible) return null;
    return this.gun.muzzle.getWorldPosition(out);
  }

  /** Height of the top of the head above the feet, in world units, for name tags. */
  headHeight(inflation: number): number {
    return (BASE_H + BODY_LEN + 0.35) * inflationScale(inflation);
  }

  update(p: TubeManPose): void {
    const dt = Math.min(0.05, p.dt);
    const t = p.time;
    let s = inflationScale(p.inflation);
    // Taunts are pure animation: spin, flex, wave, go floppy.
    let tauntSpin = 0;
    let flop = 0;
    let wave = 0;
    if (this.tauntT > 0) {
      this.tauntT = Math.max(0, this.tauntT - dt);
      const total = TAUNT_TIME[this.tauntStyle] ?? 1;
      const k = 1 - this.tauntT / total;
      const env = Math.sin(Math.min(1, k) * Math.PI);
      if (this.tauntStyle === 'spin') tauntSpin = k * Math.PI * 4;
      else if (this.tauntStyle === 'flex') s *= 1 + 0.35 * env;
      else if (this.tauntStyle === 'noodle') flop = env;
      else if (this.tauntStyle === 'wave') wave = env;
    }
    // Danger (0..1) from 60% inflation up: more wobble, a straining tremble, a red warning pulse.
    const danger = Math.max(0, Math.min(1, (p.inflation - 0.6) / 0.4));
    this.rig.scale.setScalar(s);
    if (danger > 0) {
      // Straining at the seams: a fast shiver that gets harder near max.
      const shiver = danger * danger * 0.035 * s;
      this.rig.position.set(Math.sin(t * 47 + this.seed) * shiver, 0, Math.cos(t * 53 + this.seed) * shiver);
      this.rig.scale.set(s * (1 + Math.sin(t * 31) * 0.02 * danger), s, s * (1 + Math.cos(t * 29) * 0.02 * danger));
    } else {
      this.rig.position.set(0, 0, 0);
    }
    this.group.rotation.y = p.yaw + Math.PI + tauntSpin;

    // Velocity in the character's local frame (+z forward, +x left).
    const cy = Math.cos(p.yaw + Math.PI);
    const sy = Math.sin(p.yaw + Math.PI);
    const lvx = p.vx * cy - p.vz * sy;
    const lvz = p.vx * sy + p.vz * cy;

    // --- Lean springs: the tube trails behind its motion like a real air dancer. ---
    let targetX = -lvx * 0.055;
    let targetZ = -lvz * 0.055;
    if (p.launched) {
      targetX = lvx * 0.06;
      targetZ = lvz * 0.06;
    }
    if (p.doubled) targetZ += 1.6;
    if (p.hanging) targetZ += 0.25;
    if (flop > 0) targetX += Math.sin(t * 7) * 1.4 * flop;
    const lim = p.launched ? 1.8 : 1.1;
    targetX = Math.max(-lim, Math.min(lim, targetX));
    targetZ = Math.max(-lim, Math.min(lim, targetZ));
    const k = p.bracing ? 260 : 60;
    const c = p.bracing ? 22 : 7;
    this.leanVX += (k * (targetX - this.leanX) - c * this.leanVX) * dt;
    this.leanVZ += (k * (targetZ - this.leanZ) - c * this.leanVZ) * dt;
    this.leanX += this.leanVX * dt;
    this.leanZ += this.leanVZ * dt;

    // Squash on landing, stretch when rising fast.
    if (p.onGround && this.lastVy < -5) this.squashV -= Math.min(8, -this.lastVy * 0.5);
    this.lastVy = p.vy;
    // Idle: a slow, bouncy breathing so nobody ever stands dead still.
    const speedH = Math.hypot(lvx, lvz);
    const idle = p.onGround && speedH < 1.5 ? Math.sin(t * 3.4 + this.seed) * 0.05 : 0;
    const squashTarget = p.bracing ? -0.22 : p.onGround ? idle : Math.max(-0.12, Math.min(0.22, p.vy * 0.02));
    this.squashV += (95 * (squashTarget - this.squash) - 6 * this.squashV) * dt;
    this.squash += this.squashV * dt;

    // Tumble while launched.
    if (p.launched) this.spin += dt * (4 + Math.hypot(p.vx, p.vz) * 0.25);
    else this.spin *= Math.max(0, 1 - dt * 8);
    this.rig.rotation.x = Math.sin(this.spin) * 0.25;

    // --- Body spine. ---
    const lenScale = 1 + this.squash;
    const radScale = 1 / Math.sqrt(Math.max(0.6, lenScale));
    const wobbleAmp = (p.bracing ? 0.02 : 0.09 + Math.min(0.12, Math.hypot(lvx, lvz) * 0.01)) + flop * 0.25 + p.inflation * p.inflation * 0.12;
    const spine = this.body.spine;
    const radii = this.body.radii;
    const n = BODY_RINGS;
    const capStart = n - 6;
    for (let i = 0; i < n; i++) {
      let u: number;
      let r: number;
      const capU = 1 - HEAD_R / BODY_LEN;
      if (i < capStart) {
        u = (i / capStart) * capU;
        // Slight flare at the bottom where the tube meets the blower, and the head swelling out
        // toward the top.
        const flare = 1 + 0.25 * Math.max(0, 1 - u * 6);
        const k = Math.min(1, Math.max(0, (u - 0.42) / (capU - 0.42)));
        const swell = k * k * (3 - 2 * k);
        r = BODY_R * flare * (1 + (HEAD_R / BODY_R - 1) * swell);
      } else {
        const a = ((i - capStart) / (n - 1 - capStart)) * (Math.PI / 2);
        u = capU + (Math.sin(a) * HEAD_R) / BODY_LEN;
        r = HEAD_R * Math.cos(a);
      }
      const sArc = u * BODY_LEN * lenScale;
      const bend = u * u;
      const wob1 = noise1(t * 1.7 + u * 1.2, this.seed) * wobbleAmp;
      const wob2 = noise1(t * 1.3 + u * 1.5, this.seed + 3) * wobbleAmp;
      // Doubled over: fold forward sharply above the waist.
      let fold = 0;
      if (p.doubled) fold = Math.max(0, u - 0.35) * 1.3;
      const x = (this.leanX * bend + wob1 * u) * BODY_LEN;
      const z = (this.leanZ * bend * (p.doubled ? 0.4 : 1) + wob2 * u) * BODY_LEN + fold * 0.9;
      const y = BASE_H + sArc - (Math.abs(x) + Math.abs(z)) * 0.18 * u - fold * 0.8;
      spine[i * 3] = x;
      spine[i * 3 + 1] = y;
      spine[i * 3 + 2] = z;
      radii[i] = r * radScale;
    }
    this.body.update(0, 0, 1);

    // --- Face, placed on the front of the head ring. ---
    const headRing = n - 8;
    const hx = spine[headRing * 3];
    const hy = spine[headRing * 3 + 1];
    const hz = spine[headRing * 3 + 2];
    const N = this.body.normals;
    const B = this.body.binormals;
    const nx = N[headRing * 3];
    const ny = N[headRing * 3 + 1];
    const nz = N[headRing * 3 + 2];
    const hr = radii[headRing];
    this.face.position.set(hx + nx * hr * 0.92, hy + ny * hr * 0.92, hz + nz * hr * 0.92);
    // Orient the face so +z points along the ring normal and +y along the tube.
    const ti = headRing + 1;
    const up = SV1.set(spine[ti * 3] - hx, spine[ti * 3 + 1] - hy, spine[ti * 3 + 2] - hz).normalize();
    const fwd = SV2.set(nx, ny, nz);
    const right = SV3.crossVectors(up, fwd).normalize();
    const m = SM.makeBasis(right, up, fwd);
    this.face.quaternion.setFromRotationMatrix(m);

    // Expressions.
    const scared = p.launched;
    const ouch = p.doubled;
    this.mouthO.visible = scared && !ouch;
    this.mouthSmile.visible = !this.mouthO.visible;
    this.mouthSmile.rotation.z = ouch ? 0 : Math.PI;
    this.mouthSmile.position.y = ouch ? -0.26 : -0.2;
    const face = this.look.face;
    if (face === 'angry' && !scared && !ouch) this.mouthSmile.rotation.z = 0;
    const blink = noise1(t * 0.9, this.seed + 9) > 0.93 ? 0.1 : 1;
    const lids = face === 'sleepy' ? 0.42 : 1;
    const squint = (ouch ? 0.15 : p.charge > 0.5 ? 0.7 : 1) * lids;
    for (let i = 0; i < 2; i++) {
      const eye = this.eyes[i];
      const pupil = this.pupils[i];
      const size = face === 'derp' ? (i === 0 ? 1.3 : 0.8) : 1;
      eye.scale.set(size, size * squint * blink, size);
      pupil.scale.set((scared ? 0.6 : 1) * size, (scared ? 0.6 : 1) * size * squint * blink, size);
      const look = noise1(t * 0.6 + i * 0.01, this.seed + 5) * 0.025;
      pupil.position.x = (i === 0 ? -0.12 : 0.12) + look + (face === 'derp' ? (i === 0 ? -0.03 : 0.03) : 0);
      pupil.position.y = face === 'derp' ? (i === 0 ? 0.03 : -0.03) : face === 'sleepy' ? -0.02 : 0;
      pupil.position.z = 0.065 * size;
    }
    const cyc = this.faceExtras.userData.eye as THREE.Object3D | undefined;
    if (cyc) {
      cyc.scale.set(1, squint * blink, 1);
      const cp = this.faceExtras.userData.pupil as THREE.Object3D;
      const k = scared ? 0.6 : 1;
      cp.scale.set(k, k * squint * blink, 1);
      cp.position.x = noise1(t * 0.6, this.seed + 5) * 0.04;
    }

    // Hair tuft on the very top, following the tip's direction.
    const top = n - 1;
    const pre = n - 3;
    this.hair.position.set(spine[top * 3], spine[top * 3 + 1] - 0.05, spine[top * 3 + 2]);
    const tip = SV1.set(spine[top * 3] - spine[pre * 3], spine[top * 3 + 1] - spine[pre * 3 + 1], spine[top * 3 + 2] - spine[pre * 3 + 2]).normalize();
    this.hair.quaternion.setFromUnitVectors(Y_UP, tip);
    animateHat(this.hat, t, dt, p.launched);

    // --- Arms: constant, joyful flailing. ---
    const flailTarget = p.bracing || p.holding ? 0.15 : p.held ? 2.4 : p.hanging ? 0.3 : p.launched ? 1.8 : 1 + Math.min(0.6, Math.hypot(lvx, lvz) * 0.05);
    this.flail += (flailTarget - this.flail) * Math.min(1, dt * 6);
    const shoulderRing = Math.round(n * 0.52);
    const sx0 = spine[shoulderRing * 3];
    const sy0 = spine[shoulderRing * 3 + 1];
    const sz0 = spine[shoulderRing * 3 + 2];
    const sr = radii[shoulderRing] * 0.85;
    const bx = B[shoulderRing * 3];
    const by = B[shoulderRing * 3 + 1];
    const bz = B[shoulderRing * 3 + 2];
    const fnx = N[shoulderRing * 3];
    const fny = N[shoulderRing * 3 + 1];
    const fnz = N[shoulderRing * 3 + 2];
    for (let side = 0; side < 2; side++) {
      const sgn = side === 0 ? 1 : -1;
      const arm = this.arms[side];
      const as = arm.spine;
      let px = sx0 + bx * sr * sgn;
      let py = sy0 + by * sr * sgn;
      let pz = sz0 + bz * sr * sgn;
      // Base direction: out and up.
      let ang = 0.5 + noise1(t * 2.2, this.seed + side * 11) * 0.7 * this.flail;
      let yaw = noise1(t * 1.6, this.seed + side * 17) * 0.8 * this.flail;
      if (wave > 0 && side === 0) {
        // Big friendly wave.
        ang = 1.2 * wave + ang * (1 - wave);
        yaw = Math.sin(t * 12) * 0.9 * wave;
      } else if (p.hanging) {
        // Reaching up to the ledge.
        ang = 1.25;
        yaw = 0.9;
      } else if (p.holding) {
        // Bear hug out in front.
        ang = 0.15;
        yaw = 1.2;
      }
      const seg = ARM_LEN / (ARM_RINGS - 1);
      for (let i = 0; i < ARM_RINGS; i++) {
        as[i * 3] = px;
        as[i * 3 + 1] = py;
        as[i * 3 + 2] = pz;
        const fi = i / (ARM_RINGS - 1);
        arm.radii[i] = i === ARM_RINGS - 1 ? 0.02 : i === ARM_RINGS - 2 ? ARM_R * 0.8 : ARM_R * (1.15 - fi * 0.25);
        ang += noise1(t * 3.4 + i * 0.45, this.seed + side * 23) * 0.42 * this.flail;
        yaw += noise1(t * 2.9 + i * 0.4, this.seed + side * 29) * 0.3 * this.flail;
        if (p.doubled) ang -= 0.2;
        // Direction = out (binormal) / up / forward (ring normal) mix.
        const ca = Math.cos(ang);
        const outK = ca * Math.cos(yaw) * sgn;
        const upK = Math.sin(ang);
        const fwdK = ca * Math.sin(yaw);
        px += (bx * outK + fnx * fwdK) * seg;
        py += (by * outK + upK + fny * fwdK) * seg;
        pz += (bz * outK + fnz * fwdK) * seg;
      }
      arm.update(0, 1, 0);
    }

    // Glow while charging, flash while braced; the crown wearer glows gold, your nemesis red.
    let glow = BASE_GLOW + p.charge * 0.55 + (p.bracing ? 0.6 : 0);
    if (p.crowned) glow += 0.35 + Math.sin(t * 5) * 0.15;
    if (p.nemesis) {
      glow += 0.45 + Math.sin(t * 8) * 0.25;
      this.bodyMat.emissive.setHex(0xff2040);
    } else if (danger > 0) {
      // Warning pulse that speeds up as they get close to popping.
      const pulse = 0.5 + 0.5 * Math.sin(t * (5 + danger * 9));
      glow += danger * (0.25 + 0.45 * pulse);
      this.bodyMat.emissive.setHex(0xff2a2a);
    } else if (p.powered) {
      glow += 0.4 + 0.25 * Math.abs(Math.sin(t * 13 + this.seed));
      this.bodyMat.emissive.setHex(0xffa51f);
    } else {
      this.bodyMat.emissive.copy(this.color);
    }
    if (this.impactT > 0) {
      // Hit flash.
      this.impactT -= dt;
      this.bodyMat.emissive.setHex(0xffffff);
      glow = Math.max(glow, 0.9 * (this.impactT / 0.1));
    }
    this.bodyMat.emissiveIntensity = glow;
    this.crown.visible = p.crowned;
    if (p.crowned) {
      this.crown.position.set(spine[(n - 1) * 3], spine[(n - 1) * 3 + 1] + 0.1, spine[(n - 1) * 3 + 2]);
      this.crown.rotation.y = t * 1.5;
    }
    this.bodyMat.metalness = p.bracing ? 0.6 : 0.0;

    // Weapon held out in front of the chest, pointing where the player aims.
    if (this.gun) {
      const gi = Math.round(n * 0.4);
      const gr = radii[gi] + 0.12;
      this.gunMount.position.set(spine[gi * 3] + N[gi * 3] * gr, spine[gi * 3 + 1] + N[gi * 3 + 1] * gr, spine[gi * 3 + 2] + N[gi * 3 + 2] * gr);
      this.gunMount.rotation.set(p.pitch - this.rig.rotation.x, Math.PI, 0);
      this.gun.root.visible = !p.held && !p.holding;
      this.gun.setCharge(p.charge, t, p.streaming);
    }
    this.pin.visible = p.hasPin;
    if (p.hasPin) {
      this.pin.position.set(spine[(n - 1) * 3], spine[(n - 1) * 3 + 1] + 0.55, spine[(n - 1) * 3 + 2]);
      this.pin.rotation.y = t * 3;
    }

    this.bubble.visible = p.protected;
    if (p.protected) {
      this.bubble.position.set(0, BASE_H + BODY_LEN * 0.55, 0);
      this.bubble.scale.set(1.25, 1.55, 1.25);
    }
  }

  setVisible(v: boolean): void {
    this.group.visible = v;
  }

  dispose(): void {
    this.body.dispose();
    for (const a of this.arms) a.dispose();
    this.bodyMat.dispose();
    disposeGroup(this.hat);
    disposeGroup(this.faceExtras);
  }
}

/** A giant sewing pin that floats over whoever is carrying one. */
function makePin(): THREE.Group {
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.005, 0.7, 8), new THREE.MeshStandardMaterial({ color: 0xdfe6f3, metalness: 0.8, roughness: 0.2 }));
  shaft.position.y = -0.35;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), new THREE.MeshStandardMaterial({ color: 0xff2d55, emissive: 0xff2d55, emissiveIntensity: 0.5, roughness: 0.2 }));
  g.add(shaft, head);
  const holder = new THREE.Group();
  holder.add(g);
  return holder;
}

/** A chunky golden crown for the player on the longest streak. */
function makeCrown(): THREE.Group {
  const g = new THREE.Group();
  const gold = new THREE.MeshStandardMaterial({ color: 0xffc933, metalness: 0.8, roughness: 0.25, emissive: 0xffa000, emissiveIntensity: 0.35 });
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.3, 0.2, 20, 1, true), gold);
  band.material.side = THREE.DoubleSide;
  g.add(band);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.24, 8), gold);
    spike.position.set(Math.cos(a) * 0.3, 0.2, Math.sin(a) * 0.3);
    const gem = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), new THREE.MeshStandardMaterial({ color: [0xff2d55, 0x2ec5ff, 0x8ee000][i % 3], emissive: 0xffffff, emissiveIntensity: 0.2 }));
    gem.position.set(Math.cos(a) * 0.31, 0.02, Math.sin(a) * 0.31);
    g.add(spike, gem);
  }
  g.traverse((o) => ((o as THREE.Mesh).castShadow = true));
  return g;
}
