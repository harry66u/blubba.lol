import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

interface Timed {
  obj: THREE.Object3D;
  /** Seconds until removal once dying (deflate animation); -1 while alive. */
  dying: number;
}

/**
 * Temporary things placed during a match: inflatable walls and rafts, thrown bounce pads, soda
 * cans, pins, and vacuum fields.
 */
export class EntityView {
  readonly root = new THREE.Group();
  private readonly solids = new Map<number, Timed>();
  private readonly pads = new Map<number, Timed>();
  private readonly pickups = new Map<number, { obj: THREE.Group; kind: 'soda' | 'pin'; baseY: number }>();
  readonly vacuums: { x: number; y: number; z: number; until: number; obj: THREE.Mesh }[] = [];
  private time = 0;
  private readonly wallMat = new THREE.MeshStandardMaterial({ color: 0x8ee000, roughness: 0.25, emissive: 0x8ee000, emissiveIntensity: 0.15, transparent: true, opacity: 0.92 });
  private readonly raftMat = new THREE.MeshStandardMaterial({ color: 0xffd60a, roughness: 0.25, emissive: 0xffd60a, emissiveIntensity: 0.15 });
  private readonly padMat = new THREE.MeshStandardMaterial({ color: 0xff4fa3, roughness: 0.3, emissive: 0xff4fa3, emissiveIntensity: 0.35 });
  private readonly rimMat = new THREE.MeshStandardMaterial({ color: 0xfff1f8, roughness: 0.4 });
  private readonly canMat = new THREE.MeshStandardMaterial({ color: 0xff3b5c, roughness: 0.25, metalness: 0.4 });
  private readonly canTop = new THREE.MeshStandardMaterial({ color: 0xdde3ee, roughness: 0.2, metalness: 0.8 });
  private readonly stripeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });
  private readonly vacMat = new THREE.MeshBasicMaterial({ color: 0xb58cff, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false });

  addSolid(id: number, min: [number, number, number], max: [number, number, number], raft: boolean): void {
    this.removeSolid(id, true);
    const w = max[0] - min[0];
    const h = max[1] - min[1];
    const d = max[2] - min[2];
    const g = new THREE.Group();
    const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, Math.min(0.28, Math.min(w, h, d) * 0.45)), raft ? this.raftMat : this.wallMat);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    // Stripes so it reads as an inflatable.
    const n = Math.max(1, Math.round((w > d ? w : d) / 1.2));
    for (let i = 1; i < n; i++) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(w > d ? 0.08 : w + 0.02, h * 0.9, w > d ? d + 0.02 : 0.08), this.stripeMat);
      if (w > d) s.position.x = -w / 2 + (i / n) * w;
      else s.position.z = -d / 2 + (i / n) * d;
      g.add(s);
    }
    g.position.set((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
    g.scale.set(1, 0.05, 1);
    g.userData.grow = 0;
    this.root.add(g);
    this.solids.set(id, { obj: g, dying: -1 });
  }

  removeSolid(id: number, instant = false): void {
    const s = this.solids.get(id);
    if (!s) return;
    if (instant) {
      this.root.remove(s.obj);
      this.solids.delete(id);
    } else s.dying = 0.3;
  }

  addPad(id: number, x: number, y: number, z: number, half: number): void {
    this.removePad(id, true);
    const g = new THREE.Group();
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(half * 1.15, half * 1.25, 0.22, 24), this.rimMat);
    rim.position.y = 0.11;
    const top = new THREE.Mesh(new THREE.CylinderGeometry(half, half, 0.12, 24), this.padMat);
    top.position.y = 0.25;
    top.castShadow = true;
    g.add(rim, top);
    g.position.set(x, y, z);
    g.userData.top = top;
    this.root.add(g);
    this.pads.set(id, { obj: g, dying: -1 });
  }

  removePad(id: number, instant = false): void {
    const p = this.pads.get(id);
    if (!p) return;
    if (instant) {
      this.root.remove(p.obj);
      this.pads.delete(id);
    } else p.dying = 0.3;
  }

  setPickup(id: number, kind: 'soda' | 'pin', x: number, y: number, z: number, active: boolean): void {
    const old = this.pickups.get(id);
    if (old && (old.kind !== kind || !active)) {
      this.root.remove(old.obj);
      this.pickups.delete(id);
    }
    if (!active || this.pickups.has(id)) return;
    const g = new THREE.Group();
    if (kind === 'soda') {
      const can = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.62, 18), this.canMat);
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.06, 18), this.canTop);
      top.position.y = 0.34;
      const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.225, 0.225, 0.12, 18), this.stripeMat);
      can.castShadow = true;
      g.add(can, top, stripe);
    } else {
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.01, 1.3, 8), new THREE.MeshStandardMaterial({ color: 0xdfe6f3, metalness: 0.85, roughness: 0.15 }));
      shaft.position.y = -0.2;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 18, 14), new THREE.MeshStandardMaterial({ color: 0xff2d55, emissive: 0xff2d55, emissiveIntensity: 0.6, roughness: 0.2 }));
      head.position.y = 0.5;
      const halo = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.04, 8, 32), new THREE.MeshBasicMaterial({ color: 0xffd60a, transparent: true, opacity: 0.7 }));
      halo.rotation.x = Math.PI / 2;
      halo.position.y = -0.6;
      g.add(shaft, head, halo);
      g.rotation.z = 0.35;
    }
    const baseY = y + 0.9;
    g.position.set(x, baseY, z);
    this.root.add(g);
    this.pickups.set(id, { obj: g, kind, baseY });
  }

  addVacuum(x: number, y: number, z: number, until: number, radius: number): void {
    const m = new THREE.Mesh(new THREE.SphereGeometry(radius, 24, 16), this.vacMat);
    m.position.set(x, y, z);
    this.root.add(m);
    this.vacuums.push({ x, y, z, until, obj: m });
  }

  clear(): void {
    for (const [id] of this.solids) this.removeSolid(id, true);
    for (const [id] of this.pads) this.removePad(id, true);
    for (const [, p] of this.pickups) this.root.remove(p.obj);
    this.pickups.clear();
    for (const v of this.vacuums) this.root.remove(v.obj);
    this.vacuums.length = 0;
  }

  update(dt: number, tick: number): void {
    this.time += dt;
    for (const [id, s] of this.solids) {
      const g = s.obj;
      if (s.dying >= 0) {
        s.dying -= dt;
        g.scale.y = Math.max(0.02, s.dying / 0.3);
        if (s.dying <= 0) {
          this.root.remove(g);
          this.solids.delete(id);
        }
        continue;
      }
      // Pop up like an airbag, then breathe a little.
      g.userData.grow = Math.min(1, g.userData.grow + dt * 6);
      const k = g.userData.grow;
      g.scale.set(1 + Math.sin(this.time * 3) * 0.01, k < 1 ? k * (1.15 - 0.15 * k) : 1 + Math.sin(this.time * 3 + 1) * 0.01, 1);
    }
    for (const [id, p] of this.pads) {
      if (p.dying >= 0) {
        p.dying -= dt;
        p.obj.scale.setScalar(Math.max(0.01, p.dying / 0.3));
        if (p.dying <= 0) {
          this.root.remove(p.obj);
          this.pads.delete(id);
        }
        continue;
      }
      (p.obj.userData.top as THREE.Mesh).scale.y = 1 + Math.sin(this.time * 6) * 0.2;
    }
    for (const p of this.pickups.values()) {
      p.obj.rotation.y += dt * (p.kind === 'pin' ? 3 : 2);
      p.obj.position.y = p.baseY + Math.sin(this.time * 2.5) * 0.15;
    }
    for (let i = this.vacuums.length - 1; i >= 0; i--) {
      const v = this.vacuums[i];
      v.obj.scale.setScalar(0.7 + Math.sin(this.time * 20) * 0.05);
      v.obj.rotation.y += dt * 6;
      if (tick >= v.until) {
        this.root.remove(v.obj);
        this.vacuums.splice(i, 1);
      }
    }
  }
}
