import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { BALANCE } from '../../shared/balance';
import { type LootCrate, type Tornado, lostBelow, stepCrate, stepTornado } from '../../shared/game/loot';
import type { MapDef } from '../../shared/maps/types';
import type { World } from '../../shared/world';
import type { Effects } from './effects';

const DT = 1 / BALANCE.tickRate;

interface CrateView {
  state: LootCrate;
  /** Tick the crate state has been simulated up to. */
  stepTick: number;
  group: THREE.Group;
  box: THREE.Group;
  chute: THREE.Group;
  beam: THREE.Mesh;
  marker: THREE.Mesh;
  /** Where the beam and landing marker stand. */
  groundY: number;
  /** 0 while falling, then counts up after landing (for the bounce and the chute folding). */
  landedFor: number;
  bornAt: number;
}

interface MineView {
  group: THREE.Group;
  light: THREE.Mesh;
  ring: THREE.Mesh;
  armTick: number;
}

interface CloudView {
  mesh: THREE.Mesh;
  x: number;
  y: number;
  z: number;
  r: number;
  until: number;
  age: number;
}

interface TornadoView {
  state: Tornado;
  stepTick: number;
  group: THREE.Group;
  rings: THREE.Mesh[];
  cone: THREE.Mesh;
  inner: THREE.Mesh;
  age: number;
  /** Seconds until the next wind sound. */
  soundIn: number;
}

function questionTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(64, 64, 58, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 8;
  g.strokeStyle = '#ff9f1c';
  g.stroke();
  g.fillStyle = '#ff5a1f';
  g.font = '900 92px "Arial Rounded MT Bold", Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('?', 64, 70);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function streakTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const g = c.getContext('2d')!;
  // A misty base so the column reads from afar, with brighter wind streaks on top.
  g.fillStyle = 'rgba(225,235,250,0.35)';
  g.fillRect(0, 0, 128, 64);
  for (let i = 0; i < 9; i++) {
    const y = 4 + i * 7 + Math.random() * 3;
    g.strokeStyle = `rgba(255,255,255,${0.35 + Math.random() * 0.5})`;
    g.lineWidth = 1.5 + Math.random() * 2.5;
    g.beginPath();
    g.moveTo(Math.random() * 30, y);
    g.lineTo(60 + Math.random() * 68, y + (Math.random() - 0.5) * 4);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/**
 * Supply crates, Air Mines, helium clouds and tornados. Crates and tornados are re-simulated on the
 * client with the same shared step as the server (the server's events correct any drift).
 */
export class GadgetView {
  readonly root = new THREE.Group();
  readonly crates = new Map<number, CrateView>();
  private readonly mines = new Map<number, MineView>();
  private readonly clouds: CloudView[] = [];
  readonly tornados = new Map<number, TornadoView>();
  private time = 0;
  private lostY = -40;

  private readonly crateMat = new THREE.MeshStandardMaterial({ color: 0xffa630, roughness: 0.45, emissive: 0xff7a00, emissiveIntensity: 0.28 });
  private readonly ribbonMat = new THREE.MeshStandardMaterial({ color: 0x2ec5ff, roughness: 0.3, emissive: 0x2ec5ff, emissiveIntensity: 0.35 });
  private readonly chuteMats = [
    new THREE.MeshStandardMaterial({ color: 0xff3b5c, roughness: 0.5, side: THREE.DoubleSide, emissive: 0xff3b5c, emissiveIntensity: 0.2 }),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, side: THREE.DoubleSide, emissive: 0xffffff, emissiveIntensity: 0.15 }),
  ];
  private readonly stringMat = new THREE.MeshBasicMaterial({ color: 0xf4f1ea });
  private readonly beamMat = new THREE.MeshBasicMaterial({ color: 0xfff1a0, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  private readonly markerMat = new THREE.MeshBasicMaterial({ color: 0xffd60a, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 });
  private readonly qMat = new THREE.SpriteMaterial({ map: questionTexture(), depthWrite: false });
  private readonly crateGeo = new RoundedBoxGeometry(1, 1, 1, 2, 0.12);
  private readonly beamGeo = new THREE.CylinderGeometry(0.28, 0.55, 60, 14, 1, true).translate(0, 30, 0);
  private readonly markerGeo = new THREE.RingGeometry(0.75, 1.05, 32).rotateX(-Math.PI / 2);

  private readonly mineBodyMat = new THREE.MeshStandardMaterial({ color: 0x3a3450, roughness: 0.5, metalness: 0.2 });
  private readonly mineRingMat = new THREE.MeshBasicMaterial({ color: 0xff2d55, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 });
  private readonly cloudMat = new THREE.MeshStandardMaterial({ color: 0xffb3e6, emissive: 0xff8fd8, emissiveIntensity: 0.35, transparent: true, opacity: 0.22, depthWrite: false, roughness: 0.9 });
  private readonly windMat = new THREE.MeshBasicMaterial({ color: 0xf4f8ff, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide });
  private readonly coneMat = new THREE.MeshBasicMaterial({ color: 0xc9d6ea, map: streakTexture(), transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide });
  private readonly innerMat = new THREE.MeshBasicMaterial({ color: 0xaab8cc, map: streakTexture(), transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide });

  setMap(map: MapDef): void {
    this.lostY = lostBelow(map);
  }

  // --- Crates --------------------------------------------------------------------------------

  addCrate(id: number, x: number, y: number, z: number, groundY: number, fall: number, falling: boolean, tick: number): void {
    this.removeCrate(id);
    const group = new THREE.Group();
    const box = new THREE.Group();
    const body = new THREE.Mesh(this.crateGeo, this.crateMat);
    body.castShadow = true;
    body.position.y = 0.5;
    const r1 = new THREE.Mesh(new THREE.BoxGeometry(1.04, 1.04, 0.18), this.ribbonMat);
    r1.position.y = 0.5;
    const r2 = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.04, 1.04), this.ribbonMat);
    r2.position.y = 0.5;
    const bow = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.06, 8, 16), this.ribbonMat);
    bow.position.y = 1.08;
    const q = new THREE.Sprite(this.qMat);
    q.scale.set(0.8, 0.8, 1);
    q.position.y = 1.75;
    box.add(body, r1, r2, bow, q);
    box.userData.q = q;
    // Striped parachute on four strings.
    const chute = new THREE.Group();
    const segs = 8;
    for (let i = 0; i < segs; i++) {
      const g = new THREE.SphereGeometry(1.7, 3, 6, (i / segs) * Math.PI * 2, (Math.PI * 2) / segs, 0, Math.PI / 2.3);
      const m = new THREE.Mesh(g, this.chuteMats[i % 2]);
      m.scale.y = 0.6;
      chute.add(m);
    }
    const top = 3.3;
    chute.position.y = top;
    for (const [sx, sz] of [
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1],
    ]) {
      const from = new THREE.Vector3(sx * 0.45, 1.0, sz * 0.45);
      const to = new THREE.Vector3(sx * 1.05, top + 0.55, sz * 1.05);
      const len = from.distanceTo(to);
      const s = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, len, 4), this.stringMat);
      s.position.copy(from).add(to).multiplyScalar(0.5).sub(new THREE.Vector3(0, top, 0));
      s.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
      chute.add(s);
    }
    box.add(chute);
    group.add(box);
    // A light beam from the landing spot so everyone can see where it's coming down.
    const beam = new THREE.Mesh(this.beamGeo, this.beamMat.clone());
    beam.frustumCulled = false;
    const marker = new THREE.Mesh(this.markerGeo, this.markerMat);
    this.root.add(group, beam, marker);
    const state: LootCrate = { id, x, y, z, falling, fall, ground: -1, landedAt: falling ? Infinity : 0, forced: null };
    const v: CrateView = { state, stepTick: tick, group, box, chute, beam, marker, groundY, landedFor: falling ? 0 : 1, bornAt: this.time };
    if (!falling) chute.visible = false;
    this.crates.set(id, v);
    this.placeCrate(v);
  }

  /** The server says it landed here (snaps any drift). Returns false if we already showed the landing. */
  landCrate(id: number, x: number, y: number, z: number, tick: number): boolean {
    const v = this.crates.get(id);
    if (!v) return false;
    const was = v.landedFor > 0;
    Object.assign(v.state, { x, y, z, falling: true, fall: 0.001 });
    v.stepTick = tick;
    v.groundY = y;
    return !was;
  }

  removeCrate(id: number): CrateView | null {
    const v = this.crates.get(id);
    if (!v) return null;
    this.root.remove(v.group, v.beam, v.marker);
    (v.beam.material as THREE.Material).dispose();
    this.crates.delete(id);
    return v;
  }

  private placeCrate(v: CrateView): void {
    const c = v.state;
    v.group.position.set(c.x, c.y, c.z);
    v.beam.position.set(c.x, v.groundY, c.z);
    v.marker.position.set(c.x, v.groundY + 0.04, c.z);
  }

  // --- Mines ---------------------------------------------------------------------------------

  addMine(id: number, x: number, y: number, z: number, armTick: number): void {
    this.removeMine(id);
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.36, 0.14, 16), this.mineBodyMat);
    body.position.y = 0.07;
    body.castShadow = true;
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffd60a }));
    light.position.y = 0.18;
    const T = BALANCE.utilities.airMine.trigger;
    const ring = new THREE.Mesh(new THREE.RingGeometry(T - 0.08, T, 40).rotateX(-Math.PI / 2), this.mineRingMat);
    ring.position.y = 0.03;
    ring.visible = false;
    group.add(body, light, ring);
    group.position.set(x, y, z);
    group.scale.setScalar(0.2);
    this.root.add(group);
    this.mines.set(id, { group, light, ring, armTick });
  }

  removeMine(id: number): void {
    const m = this.mines.get(id);
    if (!m) return;
    this.root.remove(m.group);
    this.mines.delete(id);
  }

  // --- Helium clouds ---------------------------------------------------------------------------

  addCloud(x: number, y: number, z: number, r: number, until: number): void {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), this.cloudMat.clone());
    mesh.position.set(x, y, z);
    mesh.scale.setScalar(0.2);
    this.root.add(mesh);
    this.clouds.push({ mesh, x, y, z, r, until, age: 0 });
  }

  // --- Tornados --------------------------------------------------------------------------------

  addTornado(t: Tornado, tick: number): void {
    this.removeTornado(t.id);
    const T = BALANCE.utilities.tornado;
    const group = new THREE.Group();
    const rings: THREE.Mesh[] = [];
    const n = 7;
    for (let i = 0; i < n; i++) {
      const f = i / (n - 1);
      const r = 0.35 + f * f * (T.radius - 0.3) + f * 0.4;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.07 + f * 0.1, 6, 28), this.windMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.2 + f * T.height;
      ring.userData.phase = i * 1.7;
      rings.push(ring);
      group.add(ring);
    }
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(T.radius + 0.4, 0.3, T.height, 20, 1, true).translate(0, T.height / 2, 0), this.coneMat);
    // A tighter, darker core spinning the other way.
    const inner = new THREE.Mesh(new THREE.CylinderGeometry(T.radius * 0.55, 0.15, T.height * 0.92, 16, 1, true).translate(0, (T.height * 0.92) / 2, 0), this.innerMat);
    group.add(cone, inner);
    group.position.set(t.x, t.y, t.z);
    group.scale.set(0.3, 0.1, 0.3);
    this.root.add(group);
    this.tornados.set(t.id, { state: { ...t }, stepTick: tick, group, rings, cone, inner, age: 0, soundIn: 0 });
  }

  removeTornado(id: number): TornadoView | null {
    const v = this.tornados.get(id);
    if (!v) return null;
    this.root.remove(v.group);
    this.tornados.delete(id);
    return v;
  }

  clear(): void {
    for (const id of [...this.crates.keys()]) this.removeCrate(id);
    for (const id of [...this.mines.keys()]) this.removeMine(id);
    for (const c of this.clouds) this.root.remove(c.mesh);
    this.clouds.length = 0;
    for (const id of [...this.tornados.keys()]) this.removeTornado(id);
  }

  /**
   * Advances everything to `tick` (the interpolated render timeline). `onLand` fires when a crate
   * touches down, `onWind` when a tornado should make its whooshing sound.
   */
  update(dt: number, tick: number, world: World, fx: Effects, camPos: THREE.Vector3, onLand: (x: number, y: number, z: number) => void, onWind: (x: number, y: number, z: number) => void): void {
    this.time += dt;
    const t = this.time;
    for (const v of this.crates.values()) {
      // Late joiners and hiccups: don't replay minutes of history.
      if (tick - v.stepTick > 120) v.stepTick = Math.floor(tick) - 1;
      while (v.stepTick < tick) {
        v.stepTick++;
        const r = stepCrate(v.state, world, DT, this.lostY);
        if (r === 'land') v.state.landedAt = v.stepTick * DT;
      }
      const c = v.state;
      if (!c.falling && v.landedFor === 0) {
        v.landedFor = 1e-3;
        v.groundY = c.y;
        onLand(c.x, c.y, c.z);
      }
      this.placeCrate(v);
      if (v.landedFor > 0) {
        v.landedFor += dt;
        // Squash on touchdown, fold the chute away, then bob gently.
        const k = v.landedFor;
        const squash = k < 0.35 ? 1 - Math.sin((k / 0.35) * Math.PI) * 0.25 : 1;
        v.box.scale.set(1 + (1 - squash) * 0.6, squash, 1 + (1 - squash) * 0.6);
        const fold = Math.max(0, 1 - k / 0.5);
        v.chute.visible = fold > 0;
        v.chute.scale.set(1 + (1 - fold) * 0.3, fold, 1 + (1 - fold) * 0.3);
        v.box.rotation.set(0, v.box.rotation.y + dt * 0.6, 0);
        v.beam.scale.set(1, 0.5 + 0.1 * Math.sin(t * 3), 1);
        // Blink for the last few seconds before it floats away.
        const left = BALANCE.loot.lifetime - (tick * DT - c.landedAt);
        v.group.visible = left > 5 || Math.sin(t * (left < 2 ? 30 : 16)) > -0.3;
      } else {
        // Sway under the chute on the way down.
        v.box.rotation.set(Math.sin(t * 1.3 + v.bornAt) * 0.12, v.box.rotation.y + dt * 0.4, Math.cos(t * 1.1 + v.bornAt) * 0.12);
        v.beam.scale.set(1, 1, 1);
      }
      // The beam is for spotting crates from afar; up close it fades so it doesn't glare.
      const camD = Math.hypot(camPos.x - c.x, camPos.z - c.z);
      v.beam.visible = camD > 2.5;
      (v.beam.material as THREE.MeshBasicMaterial).opacity = (0.16 + 0.08 * Math.sin(t * 4)) * Math.max(0.25, Math.min(1, (camD - 3) / 12));
      const pulse = 1 + 0.15 * Math.sin(t * 5);
      v.marker.scale.set(pulse, 1, pulse);
      v.marker.visible = v.landedFor === 0;
      const q = v.box.userData.q as THREE.Sprite;
      q.position.y = 1.75 + Math.sin(t * 3) * 0.1;
      if (Math.random() < dt * 6) fx.sparkle(c.x + (Math.random() - 0.5) * 1.4, c.y + Math.random() * 1.4, c.z + (Math.random() - 0.5) * 1.4);
    }

    for (const m of this.mines.values()) {
      m.group.scale.setScalar(Math.min(1, m.group.scale.x + dt * 5));
      const armed = tick >= m.armTick;
      const mat = m.light.material as THREE.MeshBasicMaterial;
      if (armed) {
        const on = Math.sin(t * 12) > 0;
        mat.color.setHex(on ? 0xff2d55 : 0x5a1020);
        m.ring.visible = true;
        this.mineRingMat.opacity = 0.14 + 0.1 * (on ? 1 : 0);
      } else {
        mat.color.setHex(Math.sin(t * 30) > 0 ? 0xffd60a : 0x6a5a10);
      }
    }

    for (let i = this.clouds.length - 1; i >= 0; i--) {
      const c = this.clouds[i];
      c.age += dt;
      const left = (c.until - tick) * DT;
      const grow = Math.min(1, 0.2 + c.age * 4);
      c.mesh.scale.setScalar(grow * (1 + Math.sin(t * 6) * 0.03));
      (c.mesh.material as THREE.MeshStandardMaterial).opacity = 0.24 * Math.max(0, Math.min(1, left / 0.4 + 0.2));
      fx.heliumFizz(c.x, c.y, c.z, c.r * grow, Math.max(1, Math.round(dt * 80)));
      if (left < -0.5) {
        this.root.remove(c.mesh);
        (c.mesh.material as THREE.Material).dispose();
        this.clouds.splice(i, 1);
      }
    }

    const T = BALANCE.utilities.tornado;
    for (const v of this.tornados.values()) {
      if (tick - v.stepTick > 120) v.stepTick = Math.floor(tick) - 1;
      while (v.stepTick < tick) {
        v.stepTick++;
        stepTornado(v.state, world, DT);
      }
      v.age += dt;
      const s = v.state;
      const left = (s.until - tick) * DT;
      const grow = Math.min(1, v.age * 3) * Math.max(0, Math.min(1, left / 0.4));
      v.group.position.set(s.x, s.y, s.z);
      v.group.scale.set(0.3 + 0.7 * grow, 0.1 + 0.9 * grow, 0.3 + 0.7 * grow);
      v.cone.rotation.y -= dt * 7;
      v.inner.rotation.y += dt * 11;
      this.coneMat.map!.offset.y += dt * 0.5;
      this.innerMat.map!.offset.y -= dt * 0.8;
      v.rings.forEach((r, i) => {
        const ph = r.userData.phase as number;
        r.position.x = Math.sin(t * 5 + ph) * 0.18 * (1 + i * 0.2);
        r.position.z = Math.cos(t * 4.3 + ph) * 0.18 * (1 + i * 0.2);
        r.rotation.z += dt * (6 + i);
      });
      const d = camPos.distanceTo(v.group.position);
      if (grow > 0.2) fx.tornadoSwirl(s.x, s.y, s.z, T.radius * grow, T.height * grow, dt, Math.max(0.25, Math.min(1, (d - 2) / 8)));
      v.soundIn -= dt;
      if (v.soundIn <= 0 && left > 0.3) {
        v.soundIn = 1.1;
        onWind(s.x, s.y + 2, s.z);
      }
    }
  }
}
