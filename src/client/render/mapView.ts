import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { DecorDef, MapDef, SolidDef, SolidKind } from '../../shared/maps/types';
import type { World } from '../../shared/world';
import { TubeMan, defaultPose, type TubeManPose } from './tubeMan';

const KIND_COLORS: Record<SolidKind, number> = {
  lot: 0x4d5466,
  island: 0xa9b1c4,
  concrete: 0xd9d3c7,
  building: 0xe8e1d4,
  glass: 0xa9dcff,
  crate: 0xc99a62,
  platform: 0xe9dfc6,
  bouncy: 0xff9fd0,
  hidden: 0xffffff,
};

function hash(n: number): number {
  const s = Math.sin(n * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

/** Canvas texture for a deck top: painted parking lines and hazard edges. */
function deckTexture(w: number, d: number, kind: SolidKind): THREE.CanvasTexture {
  const ppm = 24; // pixels per meter
  const cw = Math.min(2048, Math.round(w * ppm));
  const ch = Math.min(2048, Math.round(d * ppm));
  const c = document.createElement('canvas');
  c.width = cw;
  c.height = ch;
  const g = c.getContext('2d')!;
  const base = new THREE.Color(KIND_COLORS[kind]);
  g.fillStyle = `#${base.getHexString()}`;
  g.fillRect(0, 0, cw, ch);
  // Subtle speckle so big surfaces don't look flat.
  for (let i = 0; i < (cw * ch) / 90; i++) {
    const v = hash(i * 1.7) > 0.5 ? 255 : 0;
    g.fillStyle = `rgba(${v},${v},${v},0.035)`;
    g.fillRect(hash(i * 3.1) * cw, hash(i * 7.3) * ch, 3, 3);
  }
  const sx = cw / w;
  const sz = ch / d;
  if (kind === 'lot') {
    g.strokeStyle = 'rgba(255,255,255,0.85)';
    g.lineWidth = 0.14 * sx;
    // Parking stalls along the north and south edges.
    for (let x = -w / 2 + 3; x < w / 2 - 2; x += 3) {
      for (const [z0, z1] of [
        [-d / 2 + 1.2, -d / 2 + 6],
        [d / 2 - 6, d / 2 - 1.2],
      ]) {
        g.beginPath();
        g.moveTo((x + w / 2) * sx, (z0 + d / 2) * sz);
        g.lineTo((x + w / 2) * sx, (z1 + d / 2) * sz);
        g.stroke();
      }
    }
    // Center lane arrows.
    g.fillStyle = 'rgba(255,255,255,0.7)';
    for (let x = -w / 2 + 6; x < w / 2 - 4; x += 9) {
      const px = (x + w / 2) * sx;
      const pz = (d / 2) * sz;
      g.beginPath();
      g.moveTo(px, pz - 0.5 * sz);
      g.lineTo(px + 2.2 * sx, pz - 0.5 * sz);
      g.lineTo(px + 2.2 * sx, pz - 1.1 * sz);
      g.lineTo(px + 3.4 * sx, pz);
      g.lineTo(px + 2.2 * sx, pz + 1.1 * sz);
      g.lineTo(px + 2.2 * sx, pz + 0.5 * sz);
      g.lineTo(px, pz + 0.5 * sz);
      g.closePath();
      g.fill();
    }
  }
  // Bright hazard stripes around the edge so drops are easy to read.
  const edge = 0.55;
  const stripe = 1.0;
  for (const side of [0, 1, 2, 3]) {
    const horizontal = side < 2;
    const len = horizontal ? w : d;
    for (let s = 0; s < len; s += stripe) {
      g.fillStyle = Math.floor(s / stripe) % 2 === 0 ? '#ffd23f' : '#2b2d42';
      if (horizontal) {
        const y = side === 0 ? 0 : (d - edge) * sz;
        g.fillRect(s * sx, y, stripe * sx + 1, edge * sz);
      } else {
        const x = side === 2 ? 0 : (w - edge) * sx;
        g.fillRect(x, s * sz, edge * sx, stripe * sz + 1);
      }
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function textTexture(text: string, bg: string, fg: string, w = 512, h = 128): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.fillStyle = fg;
  g.font = `900 ${Math.round(h * 0.62)}px "Arial Rounded MT Bold", Arial, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.strokeStyle = '#1d1b3a';
  g.lineWidth = h * 0.08;
  g.strokeText(text, w / 2, h / 2 + h * 0.04);
  g.fillText(text, w / 2, h / 2 + h * 0.04);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

interface MoverMesh {
  solidId: number;
  mesh: THREE.Object3D;
  def: SolidDef;
}

/** Builds and animates the visible map from a MapDef. */
export class MapView {
  readonly root = new THREE.Group();
  private readonly movers: MoverMesh[] = [];
  private readonly tubeMen: { man: TubeMan; pose: TubeManPose }[] = [];
  private readonly pads: THREE.Object3D[] = [];
  private readonly clouds = new THREE.Group();
  private readonly balloons: THREE.Object3D[] = [];
  private readonly solidMeshes = new Map<number, THREE.Object3D>();
  private time = 0;

  constructor(
    readonly map: MapDef,
    readonly world: World,
  ) {
    this.buildSolids();
    this.buildDecor();
    this.buildPads();
    this.buildClouds();
    this.root.add(this.clouds);
  }

  private buildSolids(): void {
    const staticGeos = new Map<string, { mat: THREE.Material; geos: THREE.BufferGeometry[] }>();
    const addStatic = (key: string, mat: THREE.Material, geo: THREE.BufferGeometry) => {
      let e = staticGeos.get(key);
      if (!e) {
        e = { mat, geos: [] };
        staticGeos.set(key, e);
      }
      e.geos.push(geo);
    };
    const underMat = new THREE.MeshStandardMaterial({ color: 0x9b8fb8, roughness: 0.9, flatShading: true });
    const dirtMat = new THREE.MeshStandardMaterial({ color: 0x8a7aa8, roughness: 0.95 });
    const mats = new Map<SolidKind, THREE.Material>();
    const matFor = (kind: SolidKind) => {
      let m = mats.get(kind);
      if (!m) {
        if (kind === 'glass') {
          m = new THREE.MeshPhysicalMaterial({ color: KIND_COLORS.glass, roughness: 0.05, transmission: 0, transparent: true, opacity: 0.55, metalness: 0.1 });
        } else {
          m = new THREE.MeshStandardMaterial({ color: KIND_COLORS[kind], roughness: kind === 'crate' ? 0.8 : 0.7 });
        }
        mats.set(kind, m);
      }
      return m;
    };

    this.map.solids.forEach((def, id) => {
      if (def.kind === 'hidden') return;
      const w = def.max[0] - def.min[0];
      const h = def.max[1] - def.min[1];
      const d = def.max[2] - def.min[2];
      const cx = (def.min[0] + def.max[0]) / 2;
      const cy = (def.min[1] + def.max[1]) / 2;
      const cz = (def.min[2] + def.max[2]) / 2;
      const radius = Math.min(0.18, Math.min(w, h, d) * 0.2);
      const isDeck = def.kind === 'lot' || def.kind === 'island';
      const group = new THREE.Group();

      if (isDeck) {
        // Top slab with painted texture, then a chunky floating-rock underside.
        const topMat = new THREE.MeshStandardMaterial({ map: deckTexture(w, d, def.kind), roughness: 0.85 });
        const slab = new THREE.Mesh(new RoundedBoxGeometry(w, 0.6, d, 2, 0.12), matFor(def.kind));
        slab.position.set(cx, def.max[1] - 0.3, cz);
        slab.receiveShadow = true;
        slab.castShadow = true;
        const top = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.1, d - 0.1), topMat);
        top.rotation.x = -Math.PI / 2;
        top.position.set(cx, def.max[1] + 0.004, cz);
        top.receiveShadow = true;
        group.add(slab, top);
        const bodyH = h - 0.6;
        if (bodyH > 0.05) {
          const body = new THREE.Mesh(new RoundedBoxGeometry(w * 0.98, bodyH, d * 0.98, 2, 0.2), dirtMat);
          body.position.set(cx, def.min[1] + bodyH / 2, cz);
          body.receiveShadow = true;
          group.add(body);
        }
        // Underside: a jagged inverted cone like a chunk torn out of the ground.
        const cone = new THREE.CylinderGeometry(0.5, 0.12, 1, 9, 3);
        const pos = cone.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < pos.count; i++) {
          const y = pos.getY(i);
          const j = hash(i * 13.1 + id * 7.7);
          if (y < 0.49) {
            pos.setX(i, pos.getX(i) * (0.85 + j * 0.3));
            pos.setZ(i, pos.getZ(i) * (0.85 + hash(i * 5.3 + id) * 0.3));
            pos.setY(i, y - j * 0.12);
          }
        }
        cone.computeVertexNormals();
        const depth = Math.min(22, Math.max(5, Math.max(w, d) * 0.45));
        const under = new THREE.Mesh(cone, underMat);
        under.scale.set(w * 0.98, depth, d * 0.98);
        under.position.set(cx, def.min[1] - depth / 2 + 0.05, cz);
        group.add(under);
      } else {
        const mesh = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, radius), matFor(def.kind));
        mesh.position.set(cx, cy, cz);
        mesh.castShadow = def.kind !== 'glass';
        mesh.receiveShadow = true;
        group.add(mesh);
        if (def.kind === 'glass') {
          // Window frames so the showroom reads as a building.
          const frameMat = new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.5 });
          const posts = Math.max(2, Math.round(w / 2.2));
          for (let i = 0; i <= posts; i++) {
            for (const zz of [def.min[2], def.max[2]]) {
              const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, h, 0.18), frameMat);
              post.position.set(def.min[0] + (i / posts) * w, cy, zz);
              post.castShadow = true;
              group.add(post);
            }
          }
        }
        if (def.kind === 'platform') {
          // Orange stripes on the flatbed/elevator edges.
          const stripeMat = new THREE.MeshStandardMaterial({ color: 0xff8a1f, roughness: 0.5 });
          for (const zz of [def.min[2] + 0.1, def.max[2] - 0.1]) {
            const s = new THREE.Mesh(new THREE.BoxGeometry(w * 0.96, 0.12, 0.2), stripeMat);
            s.position.set(cx, def.max[1] + 0.01, zz);
            group.add(s);
          }
          // A little tow truck cab or lift mechanism below.
          const under = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 1.2, 10), new THREE.MeshStandardMaterial({ color: 0x9aa3b8, metalness: 0.5, roughness: 0.4 }));
          under.position.set(cx, def.min[1] - 0.6, cz);
          group.add(under);
        }
      }

      if (def.mover) {
        // Movers are drawn relative to their base position and moved every frame.
        group.position.set(0, 0, 0);
        const holder = new THREE.Group();
        holder.add(group);
        this.root.add(holder);
        this.movers.push({ solidId: id, mesh: holder, def });
        this.solidMeshes.set(id, holder);
      } else if (def.collapse !== undefined) {
        this.root.add(group);
        this.solidMeshes.set(id, group);
      } else {
        // Merge static meshes by material to save draw calls.
        group.updateMatrixWorld(true);
        group.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          const g = m.geometry.clone().applyMatrix4(m.matrixWorld);
          const mat = m.material as THREE.Material;
          addStatic(`${mat.uuid}|${m.castShadow}`, mat, g);
        });
      }
    });

    for (const [key, { mat, geos }] of staticGeos) {
      const nonIndexed = geos.map((g) => (g.index ? g.toNonIndexed() : g));
      for (const g of nonIndexed) {
        // Normalize attributes so everything can be merged.
        if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
        for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
        g.clearGroups();
      }
      const merged = mergeGeometries(nonIndexed, false);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = key.endsWith('true');
      mesh.receiveShadow = true;
      this.root.add(mesh);
    }
  }

  private buildPads(): void {
    const padMat = new THREE.MeshStandardMaterial({ color: 0xff4fa3, roughness: 0.3, emissive: 0xff4fa3, emissiveIntensity: 0.35 });
    const rimMat = new THREE.MeshStandardMaterial({ color: 0xfff1f8, roughness: 0.4 });
    const arrowMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.4 });
    for (const pad of this.map.bouncePads) {
      const g = new THREE.Group();
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(pad.half * 1.15, pad.half * 1.25, 0.25, 24), rimMat);
      rim.position.y = 0.12;
      const top = new THREE.Mesh(new THREE.CylinderGeometry(pad.half, pad.half, 0.12, 24), padMat);
      top.position.y = 0.28;
      const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.5, 3), arrowMat);
      arrow.position.y = 0.6;
      const len = Math.hypot(pad.pushX ?? 0, pad.pushZ ?? 0);
      if (len > 0.1) {
        arrow.rotation.z = -Math.PI / 2;
        g.rotation.y = Math.atan2(-(pad.pushZ ?? 0), pad.pushX ?? 0);
      }
      rim.receiveShadow = true;
      top.castShadow = true;
      g.add(rim, top, arrow);
      g.position.set(pad.x, pad.y, pad.z);
      g.userData.top = top;
      g.userData.arrow = arrow;
      this.root.add(g);
      this.pads.push(g);
    }
  }

  private buildClouds(): void {
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, emissive: 0xdde9ff, emissiveIntensity: 0.35, flatShading: false });
    const puff = new THREE.IcosahedronGeometry(1, 2);
    const geos: THREE.BufferGeometry[] = [];
    const m = new THREE.Matrix4();
    let seed = 1;
    const rnd = () => hash(seed++ * 1.37);
    for (let c = 0; c < 26; c++) {
      const ang = rnd() * Math.PI * 2;
      const dist = 70 + rnd() * 230;
      const below = c < 12;
      const cx = Math.cos(ang) * (below ? dist * 0.5 : dist);
      const cz = Math.sin(ang) * (below ? dist * 0.5 : dist);
      const cy = below ? -55 - rnd() * 30 : -20 + rnd() * 40;
      const size = 6 + rnd() * 10;
      const blobs = 5 + Math.floor(rnd() * 5);
      for (let b = 0; b < blobs; b++) {
        const r = size * (0.5 + rnd() * 0.6);
        m.compose(
          new THREE.Vector3(cx + (rnd() - 0.5) * size * 2.4, cy + (rnd() - 0.3) * size * 0.6, cz + (rnd() - 0.5) * size * 1.6),
          new THREE.Quaternion(),
          new THREE.Vector3(r, r * 0.75, r),
        );
        geos.push(puff.clone().applyMatrix4(m));
      }
    }
    const merged = mergeGeometries(geos, false);
    if (merged) this.clouds.add(new THREE.Mesh(merged, mat));
  }

  private buildDecor(): void {
    for (const d of this.map.decor) {
      const obj = this.makeDecor(d);
      if (obj) this.root.add(obj);
    }
  }

  private makeDecor(d: DecorDef): THREE.Object3D | null {
    switch (d.type) {
      case 'car':
        return makeCar(d);
      case 'tubeMan': {
        const man = new TubeMan(d.color ?? 0xff3b30, { seed: d.x * 3.1 + d.z });
        man.group.position.set(d.x, d.y, d.z);
        man.group.scale.setScalar(1.6);
        const pose = defaultPose();
        pose.yaw = Math.atan2(d.x, d.z);
        this.tubeMen.push({ man, pose });
        return man.group;
      }
      case 'sign': {
        const g = new THREE.Group();
        const board = new THREE.Mesh(
          new THREE.BoxGeometry(9, 1.8, 0.3),
          new THREE.MeshStandardMaterial({ map: textTexture(String(d.data?.text ?? 'SALE'), '#ff3b8a', '#ffd60a', 1024, 200), roughness: 0.5, emissive: 0xffffff, emissiveIntensity: 0.05 }),
        );
        board.position.y = 1.4;
        board.castShadow = true;
        const legMat = new THREE.MeshStandardMaterial({ color: 0x8a93a8, metalness: 0.5, roughness: 0.4 });
        for (const x of [-3.5, 3.5]) {
          const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.2), legMat);
          leg.position.set(x, 0.5, 0);
          g.add(leg);
        }
        g.add(board);
        g.position.set(d.x, d.y, d.z);
        return g;
      }
      case 'pole': {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 4.4, 8), new THREE.MeshStandardMaterial({ color: 0xe8ecf5, metalness: 0.4, roughness: 0.4 }));
        pole.position.set(d.x, d.y + 2.2, d.z);
        pole.castShadow = true;
        return pole;
      }
      case 'bunting':
        return makeBunting(d);
      case 'balloons':
        return this.makeBalloons(d);
      case 'cone': {
        const g = new THREE.Group();
        const cone = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.75, 14), new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.5 }));
        cone.position.y = 0.4;
        const band = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 0.12, 14), new THREE.MeshStandardMaterial({ color: 0xffffff }));
        band.position.y = 0.45;
        cone.castShadow = true;
        g.add(cone, band);
        g.position.set(d.x, d.y, d.z);
        return g;
      }
      case 'tires': {
        const g = new THREE.Group();
        const mat = new THREE.MeshStandardMaterial({ color: 0x2b2d3a, roughness: 0.8 });
        for (let i = 0; i < 3; i++) {
          const t = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.2, 10, 20), mat);
          t.rotation.x = Math.PI / 2;
          t.position.y = 0.2 + i * 0.36;
          t.castShadow = true;
          g.add(t);
        }
        g.position.set(d.x, d.y, d.z);
        return g;
      }
      case 'flag': {
        const g = new THREE.Group();
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 5, 8), new THREE.MeshStandardMaterial({ color: 0xe8ecf5, metalness: 0.4, roughness: 0.4 }));
        pole.position.y = 2.5;
        const flag = new THREE.Mesh(
          new THREE.PlaneGeometry(2.4, 1.2, 8, 1),
          new THREE.MeshStandardMaterial({ map: textTexture(String(d.data?.text ?? 'SALE'), '#ffd60a', '#ff3b8a', 256, 128), side: THREE.DoubleSide }),
        );
        flag.position.set(1.25, 4.3, 0);
        g.userData.flag = flag;
        g.add(pole, flag);
        g.position.set(d.x, d.y, d.z);
        this.balloons.push(g);
        return g;
      }
      default:
        return null;
    }
  }

  private makeBalloons(d: DecorDef): THREE.Object3D {
    const g = new THREE.Group();
    const colors = [d.color ?? 0xff6fa8, 0xffd60a, 0x6fd3ff, 0x9dff6f, 0xc49bff];
    const stringMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 });
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const b = new THREE.Mesh(
        new THREE.SphereGeometry(0.42, 16, 12),
        new THREE.MeshStandardMaterial({ color: colors[i], roughness: 0.2, emissive: colors[i], emissiveIntensity: 0.15 }),
      );
      b.scale.set(1, 1.2, 1);
      const top = new THREE.Vector3(Math.cos(a) * 0.5, 3.2 + (i % 2) * 0.5, Math.sin(a) * 0.5);
      b.position.copy(top);
      b.castShadow = true;
      b.userData.base = top.clone();
      b.userData.phase = i * 1.3;
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.1, 0), top.clone().add(new THREE.Vector3(0, -0.5, 0))]), stringMat);
      g.add(b, line);
      this.balloons.push(b);
    }
    const weight = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.25, 0.35), new THREE.MeshStandardMaterial({ color: 0x5a5f73 }));
    weight.position.y = 0.12;
    g.add(weight);
    g.position.set(d.x, d.y, d.z);
    return g;
  }

  /** Animates movers, decor tube men, pads, and clouds. `time` should be the game clock. */
  update(dt: number, time: number): void {
    this.time += dt;
    for (const m of this.movers) {
      const s = this.world.solid(m.solidId);
      if (!s) continue;
      m.mesh.position.set(s.minX - m.def.min[0], s.minY - m.def.min[1], s.minZ - m.def.min[2]);
    }
    for (const [id, obj] of this.solidMeshes) {
      const s = this.world.solid(id);
      if (!s) continue;
      if (!this.movers.some((m) => m.solidId === id)) obj.position.y = s.minY - this.map.solids[id].min[1];
      obj.visible = s.enabled;
    }
    for (const t of this.tubeMen) {
      t.pose.time = time + t.man.group.position.x;
      t.pose.dt = dt;
      t.man.update(t.pose);
    }
    for (const p of this.pads) {
      const top = p.userData.top as THREE.Mesh;
      top.scale.y = 1 + Math.sin(this.time * 5) * 0.15;
      const arrow = p.userData.arrow as THREE.Mesh;
      arrow.position.y = 0.7 + Math.sin(this.time * 4) * 0.12;
    }
    for (const b of this.balloons) {
      if (b.userData.flag) {
        const flag = b.userData.flag as THREE.Mesh;
        flag.rotation.y = Math.sin(this.time * 2) * 0.2;
        continue;
      }
      const base = b.userData.base as THREE.Vector3;
      b.position.set(base.x + Math.sin(this.time * 1.3 + b.userData.phase) * 0.12, base.y + Math.sin(this.time * 1.7 + b.userData.phase) * 0.1, base.z);
    }
    this.clouds.rotation.y += dt * 0.004;
  }

  dispose(): void {
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
      }
    });
    for (const t of this.tubeMen) t.man.dispose();
  }
}

function makeCar(d: DecorDef): THREE.Object3D {
  const g = new THREE.Group();
  const color = d.color ?? 0xd98c8c;
  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.15 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x2c3550, roughness: 0.1, metalness: 0.3 });
  const tire = new THREE.MeshStandardMaterial({ color: 0x23242e, roughness: 0.8 });
  const hub = new THREE.MeshStandardMaterial({ color: 0xd0d6e4, metalness: 0.6, roughness: 0.3 });
  const body = new THREE.Mesh(new RoundedBoxGeometry(2.0, 0.75, 4.4, 3, 0.25), paint);
  body.position.y = 0.58;
  const cabin = new THREE.Mesh(new RoundedBoxGeometry(1.7, 0.62, 2.5, 3, 0.25), paint);
  cabin.position.set(0, 1.22, -0.25);
  const windows = new THREE.Mesh(new RoundedBoxGeometry(1.74, 0.42, 2.3, 2, 0.15), glass);
  windows.position.set(0, 1.25, -0.25);
  for (const m of [body, cabin]) {
    m.castShadow = true;
    m.receiveShadow = true;
  }
  g.add(body, cabin, windows);
  for (const [x, z] of [
    [-0.95, 1.4],
    [0.95, 1.4],
    [-0.95, -1.4],
    [0.95, -1.4],
  ]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.3, 16), tire);
    w.rotation.z = Math.PI / 2;
    w.position.set(x, 0.36, z);
    const h = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.32, 10), hub);
    h.rotation.z = Math.PI / 2;
    h.position.copy(w.position);
    g.add(w, h);
  }
  // Price tag on the windshield.
  const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.4), new THREE.MeshStandardMaterial({ map: textTexture('$$$', '#ffd60a', '#ff3b8a', 128, 64) }));
  tag.position.set(0, 1.3, 1.02);
  tag.rotation.x = -0.35;
  g.add(tag);
  g.position.set(d.x, d.y, d.z);
  g.rotation.y = d.rotY ?? 0;
  return g;
}

function makeBunting(d: DecorDef): THREE.Object3D {
  const x2 = Number(d.data?.x2 ?? d.x);
  const y2 = Number(d.data?.y2 ?? d.y);
  const z2 = Number(d.data?.z2 ?? d.z);
  const g = new THREE.Group();
  const a = new THREE.Vector3(d.x, d.y, d.z);
  const b = new THREE.Vector3(x2, y2, z2);
  const len = a.distanceTo(b);
  const count = Math.floor(len / 1.1);
  const colors = [0xff3b5c, 0xffd60a, 0x2ec5ff, 0x8ee000, 0xff8a1f, 0x9b4dff];
  const flagGeo = new THREE.BufferGeometry();
  flagGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.35, 0, 0, 0.35, 0, 0, 0, -0.6, 0]), 3));
  flagGeo.computeVertexNormals();
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    const p = a.clone().lerp(b, t);
    p.y -= Math.sin(t * Math.PI) * 0.8;
    pts.push(p);
    if (i < count) {
      const f = new THREE.Mesh(flagGeo, new THREE.MeshStandardMaterial({ color: colors[i % colors.length], side: THREE.DoubleSide, roughness: 0.6 }));
      const t2 = (i + 0.5) / count;
      const p2 = a.clone().lerp(b, t2);
      p2.y -= Math.sin(t2 * Math.PI) * 0.8;
      f.position.copy(p2);
      f.lookAt(p2.clone().add(new THREE.Vector3(-(b.z - a.z), 0, b.x - a.x)));
      g.add(f);
    }
  }
  g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xffffff })));
  return g;
}
