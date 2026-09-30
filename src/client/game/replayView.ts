import * as THREE from 'three';
import type { ReplayData } from '../../shared/game/sim';
import type { WeaponId } from '../../shared/loadout';
import { type Effects, type TrailState, newTrailState } from '../render/effects';
import { type Look, TubeMan, type TubeManPose, defaultPose } from '../render/tubeMan';

interface Actor {
  man: TubeMan;
  pose: TubeManPose;
  visible: boolean;
  lastX: number;
  lastY: number;
  lastZ: number;
  trail: TrailState;
}

const FIELDS = 7;

/** Slow-motion playback speed, and the longest a replay plays for (seconds, before its outro). */
const REPLAY_SPEED = 0.5;
const REPLAY_MAX_PLAY = 5.8;

/** Plays back the recorded longest launch in slow motion with a cinematic camera. */
export class ReplayView {
  active = false;
  private data: ReplayData | null = null;
  private readonly actors = new Map<number, Actor>();
  private t = 0;
  private duration = 0;
  private readonly root = new THREE.Group();
  private camAngle = 0;
  private victimGone = false;
  private readonly focus = new THREE.Vector3();
  /** Playback speed (0.5 = half speed; faster for long flights, see start). */
  speed = REPLAY_SPEED;
  onDone: (() => void) | null = null;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly effects: Effects,
  ) {
    this.scene.add(this.root);
  }

  start(data: ReplayData, colorOf: (id: number) => number, weaponOf: (id: number) => WeaponId | null, lookOf?: (id: number) => Look): void {
    this.stop();
    if (data.frames.length < 2) return;
    this.data = data;
    this.t = 0;
    this.victimGone = false;
    const f0 = data.frames[0][0];
    const f1 = data.frames[data.frames.length - 1][0];
    // Slow motion, but never more than about 7 seconds: the results (and the next match's
    // countdown) shouldn't be spent watching one long flight.
    const span = (f1 - f0) / 60;
    this.speed = Math.max(REPLAY_SPEED, span / REPLAY_MAX_PLAY);
    this.duration = span / this.speed + 1.2;
    const ids = new Set<number>();
    for (const f of data.frames) for (let i = 1; i < f.length; i += FIELDS) ids.add(f[i]);
    for (const id of ids) {
      const man = new TubeMan(colorOf(id), { seed: id * 3.3, look: lookOf?.(id) });
      man.setWeapon(weaponOf(id));
      this.root.add(man.group);
      this.actors.set(id, { man, pose: defaultPose(), visible: false, lastX: 0, lastY: 0, lastZ: 0, trail: newTrailState() });
    }
    this.camAngle = Math.random() * Math.PI * 2;
    this.active = true;
  }

  stop(): void {
    for (const a of this.actors.values()) {
      this.root.remove(a.man.group);
      a.man.dispose();
    }
    this.actors.clear();
    this.active = false;
    this.data = null;
  }

  /** Advances playback; returns false when finished. */
  update(dt: number, camera: THREE.PerspectiveCamera): boolean {
    if (!this.active || !this.data) return false;
    this.t += dt;
    const frames = this.data.frames;
    const tick = frames[0][0] + this.t * 60 * this.speed;
    let i = 0;
    while (i < frames.length - 2 && frames[i + 1][0] <= tick) i++;
    const a = frames[i];
    const b = frames[Math.min(frames.length - 1, i + 1)];
    const span = Math.max(1, b[0] - a[0]);
    const k = Math.max(0, Math.min(1, (tick - a[0]) / span));
    const seen = new Set<number>();
    for (let j = 1; j < a.length; j += FIELDS) {
      const id = a[j];
      const actor = this.actors.get(id);
      if (!actor) continue;
      const bj = b.indexOf(id, 1);
      const hasB = bj > 0 && (bj - 1) % FIELDS === 0;
      const lerp = (o: number) => (hasB ? a[j + o] + (b[bj + o] - a[j + o]) * k : a[j + o]);
      const x = lerp(1);
      const y = lerp(2);
      const z = lerp(3);
      const p = actor.pose;
      const sdt = Math.max(1e-3, dt * this.speed);
      p.vx = (x - actor.lastX) / sdt;
      p.vy = (y - actor.lastY) / sdt;
      p.vz = (z - actor.lastZ) / sdt;
      if (!actor.visible) p.vx = p.vy = p.vz = 0;
      actor.lastX = x;
      actor.lastY = y;
      actor.lastZ = z;
      p.yaw = a[j + 4];
      p.inflation = lerp(5) / 100;
      const flags = a[j + 6];
      p.onGround = (flags & 1) !== 0;
      p.launched = (flags & 2) !== 0;
      p.charge = flags & 8 ? 0.8 : 0;
      p.doubled = (flags & 16) !== 0;
      p.time += dt * this.speed;
      p.dt = dt * this.speed;
      actor.man.group.position.set(x, y, z);
      actor.man.update(p);
      // Trails show off best here: the longest launch, in slow motion.
      this.effects.trail(actor.trail, actor.man.trail, x, y + 1, z, p.launched);
      actor.man.setVisible(true);
      actor.visible = true;
      seen.add(id);
      if (id === this.data.victim) this.focus.set(x, y + 1.2, z);
    }
    for (const [id, actor] of this.actors) {
      if (seen.has(id)) continue;
      if (actor.visible && id === this.data.victim && !this.victimGone) {
        this.victimGone = true;
        this.effects.deflatingBalloon(actor.lastX, actor.lastY, actor.lastZ, actor.man.bodyMat.color.getHex(), 0, 4, 0);
      }
      actor.man.setVisible(false);
      actor.visible = false;
    }
    // Slow orbit around the flying tube man.
    this.camAngle += dt * 0.35;
    const dist = 10;
    const desired = new THREE.Vector3(this.focus.x + Math.cos(this.camAngle) * dist, this.focus.y + 3.5, this.focus.z + Math.sin(this.camAngle) * dist);
    if (this.t < 0.05) camera.position.copy(desired);
    else camera.position.lerp(desired, Math.min(1, dt * 3));
    camera.lookAt(this.focus);
    // Bystanders that end up right against the lens would fill the screen: hide them.
    for (const [id, actor] of this.actors) {
      if (id === this.data.victim || !actor.visible) continue;
      const near = Math.hypot(actor.lastX - camera.position.x, actor.lastY + 1 - camera.position.y, actor.lastZ - camera.position.z) < 3.5;
      actor.man.setVisible(!near);
    }
    if (Math.abs(camera.fov - 55) > 0.01) {
      camera.fov = 55;
      camera.updateProjectionMatrix();
    }
    if (this.t >= this.duration) {
      this.stop();
      this.onDone?.();
      return false;
    }
    return true;
  }

  get progress(): number {
    return this.duration > 0 ? Math.min(1, this.t / this.duration) : 1;
  }
}
