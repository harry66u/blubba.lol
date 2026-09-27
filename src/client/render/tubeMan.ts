import * as THREE from 'three';
import { inflationScale } from '../../shared/player';
import type { WeaponId } from '../../shared/loadout';
import { FlexTube, noise1 } from './flexTube';
import { type WeaponModel, buildWeaponModel } from './weapons';

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
  };
}

const BODY_LEN = 1.72;
const BODY_R = 0.36;
const BASE_H = 0.24;
const ARM_LEN = 1.2;
const ARM_R = 0.11;
const BODY_RINGS = 24;
const ARM_RINGS = 11;

const sharedGeo = {
  eye: new THREE.SphereGeometry(0.095, 16, 12),
  pupil: new THREE.SphereGeometry(0.05, 12, 8),
  mouthSmile: new THREE.TorusGeometry(0.085, 0.022, 6, 14, Math.PI),
  mouthO: new THREE.TorusGeometry(0.05, 0.022, 6, 14),
  spike: new THREE.ConeGeometry(0.07, 0.3, 8),
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

/** Lighter or darker shade of a color for accents (hair, stripes). */
function shade(hex: number, amount: number): THREE.Color {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL((hsl.h + 0.08) % 1, Math.min(1, hsl.s * 1.05), Math.max(0, Math.min(1, hsl.l + amount)));
  return c;
}

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

  constructor(colorHex: number, opts: { physical?: boolean; seed?: number } = {}) {
    this.seed = opts.seed ?? Math.random() * 100;
    const matOpts = { color: colorHex, roughness: 0.3, metalness: 0.0, emissive: new THREE.Color(colorHex), emissiveIntensity: 0.0 };
    this.bodyMat = opts.physical
      ? new THREE.MeshPhysicalMaterial({ ...matOpts, clearcoat: 0.7, clearcoatRoughness: 0.2 })
      : new THREE.MeshStandardMaterial(matOpts);
    this.color.set(colorHex);

    this.body = new FlexTube(BODY_RINGS, 18, this.bodyMat);
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

    const hairMat = new THREE.MeshStandardMaterial({ color: shade(colorHex, 0.12), roughness: 0.35 });
    for (let i = 0; i < 6; i++) {
      const spike = new THREE.Mesh(sharedGeo.spike, hairMat);
      const a = (i / 6) * Math.PI * 2;
      spike.position.set(Math.cos(a) * 0.12, 0.08, Math.sin(a) * 0.12);
      spike.rotation.set(Math.sin(a) * 0.7, 0, -Math.cos(a) * 0.7);
      spike.castShadow = true;
      this.hair.add(spike);
    }

    this.bubble = new THREE.Mesh(sharedGeo.bubble, sharedMat.bubble);
    this.bubble.visible = false;

    this.gunMount.rotation.order = 'YXZ';
    this.pin = makePin();
    this.pin.visible = false;
    this.rig.add(this.base, this.body.mesh, this.arms[0].mesh, this.arms[1].mesh, this.face, this.hair, this.bubble, this.gunMount, this.pin);
    this.group.add(this.rig);
  }

  setColor(hex: number): void {
    this.color.set(hex);
    this.bodyMat.color.set(hex);
    this.bodyMat.emissive.set(hex);
    this.gun?.setColor(hex);
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
    const s = inflationScale(p.inflation);
    this.rig.scale.setScalar(s);
    this.group.rotation.y = p.yaw + Math.PI;

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
    if (p.onGround && this.lastVy < -6) this.squashV -= Math.min(6, -this.lastVy * 0.35);
    this.lastVy = p.vy;
    const squashTarget = p.bracing ? -0.22 : p.onGround ? 0 : Math.max(-0.1, Math.min(0.15, p.vy * 0.012));
    this.squashV += (120 * (squashTarget - this.squash) - 9 * this.squashV) * dt;
    this.squash += this.squashV * dt;

    // Tumble while launched.
    if (p.launched) this.spin += dt * (4 + Math.hypot(p.vx, p.vz) * 0.25);
    else this.spin *= Math.max(0, 1 - dt * 8);
    this.rig.rotation.x = Math.sin(this.spin) * 0.25;

    // --- Body spine. ---
    const lenScale = 1 + this.squash;
    const radScale = 1 / Math.sqrt(Math.max(0.6, lenScale));
    const wobbleAmp = p.bracing ? 0.02 : 0.09 + Math.min(0.12, Math.hypot(lvx, lvz) * 0.01);
    const spine = this.body.spine;
    const radii = this.body.radii;
    const n = BODY_RINGS;
    const capStart = n - 6;
    for (let i = 0; i < n; i++) {
      let u: number;
      let r: number;
      if (i < capStart) {
        u = (i / capStart) * (1 - BODY_R / BODY_LEN);
        // Slight flare at the bottom where the tube meets the blower.
        const flare = 1 + 0.25 * Math.max(0, 1 - u * 6);
        r = BODY_R * flare;
      } else {
        const a = ((i - capStart) / (n - 1 - capStart)) * (Math.PI / 2);
        u = 1 - BODY_R / BODY_LEN + (Math.sin(a) * BODY_R) / BODY_LEN;
        r = BODY_R * Math.cos(a);
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
    const up = new THREE.Vector3(spine[ti * 3] - hx, spine[ti * 3 + 1] - hy, spine[ti * 3 + 2] - hz).normalize();
    const fwd = new THREE.Vector3(nx, ny, nz);
    const right = new THREE.Vector3().crossVectors(up, fwd).normalize();
    const m = new THREE.Matrix4().makeBasis(right, up, fwd);
    this.face.quaternion.setFromRotationMatrix(m);

    // Expressions.
    const scared = p.launched;
    const ouch = p.doubled;
    this.mouthO.visible = scared && !ouch;
    this.mouthSmile.visible = !this.mouthO.visible;
    this.mouthSmile.rotation.z = ouch ? 0 : Math.PI;
    this.mouthSmile.position.y = ouch ? -0.26 : -0.2;
    const blink = noise1(t * 0.9, this.seed + 9) > 0.93 ? 0.1 : 1;
    for (let i = 0; i < 2; i++) {
      const eye = this.eyes[i];
      const pupil = this.pupils[i];
      const squint = ouch ? 0.15 : p.charge > 0.5 ? 0.7 : 1;
      eye.scale.set(1, squint * blink, 1);
      pupil.scale.set(scared ? 0.6 : 1, (scared ? 0.6 : 1) * squint * blink, 1);
      const look = noise1(t * 0.6 + i * 0.01, this.seed + 5) * 0.025;
      pupil.position.x = (i === 0 ? -0.12 : 0.12) + look;
    }

    // Hair tuft on the very top, following the tip's direction.
    const top = n - 1;
    const pre = n - 3;
    this.hair.position.set(spine[top * 3], spine[top * 3 + 1] - 0.05, spine[top * 3 + 2]);
    const tip = new THREE.Vector3(spine[top * 3] - spine[pre * 3], spine[top * 3 + 1] - spine[pre * 3 + 1], spine[top * 3 + 2] - spine[pre * 3 + 2]).normalize();
    this.hair.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tip);

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
      if (p.hanging) {
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

    // Glow while charging, flash while braced.
    const glow = p.charge * 0.55 + (p.bracing ? 0.6 : 0);
    this.bodyMat.emissiveIntensity = glow;
    this.bodyMat.metalness = p.bracing ? 0.6 : 0.0;

    // Weapon held out in front of the chest, pointing where the player aims.
    if (this.gun) {
      const gi = Math.round(n * 0.5);
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
