import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { MapDef } from '../../shared/maps/types';

/** What the banner plane tows past, in turn (the last four are the characters' ads). */
const BANNERS = [
  'BLUBBA.LOL',
  'STAY INFLATED!',
  "BOR'S GYM: GET PUMPED",
  'FLAIL HARDER!',
  'RUN. ABAG IS COMING',
  'FREE AIR TODAY',
  'SOL: SMELL THE WIN',
  'KESTY ROBOTICS',
];

// Sky scenery around every map: hot air balloons, a BLUBBA blimp, bird flocks, a banner plane,
// floating islands, beach balls and party balloons. Client-only and far outside the blast zone,
// so it never touches gameplay. Built for cheap draws: each object is one merged, vertex-colored
// mesh sharing a few materials; birds, beach balls and party balloons are one instanced mesh
// each; everything animates by transforms only and casts no shadows.

const TAU = Math.PI * 2;
const INK = 0x1d1b3a;
const PINK = 0xff3b8a;
const YELLOW = 0xffd60a;
const BLUE = 0x2ec5ff;
const GREEN = 0x5ee05e;
const PURPLE = 0x8a4dff;
const ORANGE = 0xff8a1f;
const RED = 0xff3b5c;
const WHITE = 0xffffff;
const RAINBOW = [RED, ORANGE, YELLOW, GREEN, BLUE, PURPLE];
const BALLOON_PALETTES = [
  [PINK, YELLOW, WHITE],
  [BLUE, WHITE, YELLOW],
  [GREEN, YELLOW, BLUE],
  [PURPLE, PINK, YELLOW],
  [ORANGE, WHITE, RED],
  [RED, YELLOW, BLUE],
  [YELLOW, BLUE, PINK],
];
const FONT = '"Arial Rounded MT Bold", Arial, sans-serif';

/** Small seeded PRNG (mulberry32) so a map gets the same sky every visit. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function hash(n: number): number {
  const s = Math.sin(n * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

type Paint = number | ((x: number, y: number, z: number) => number);

/**
 * Non-indexed copy of `geo` with vertex colors (one color, or one per triangle picked from its
 * center) so many parts can be merged into a single draw call. `flat` gives faceted normals;
 * `vary` jitters each triangle's brightness a little for a hand-made look.
 */
function paint(geo: THREE.BufferGeometry, color: Paint, flat = false, vary = 0): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
  g.clearGroups();
  if (flat || !g.attributes.normal) g.computeVertexNormals();
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i += 3) {
    if (typeof color === 'number') c.setHex(color);
    else {
      const x = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3;
      const y = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3;
      const z = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
      c.setHex(color(x, y, z));
    }
    if (vary) c.multiplyScalar(1 + (hash(i * 0.37 + pos.getX(i)) - 0.5) * vary);
    for (let k = i; k < i + 3; k++) col.set([c.r, c.g, c.b], k * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/** Moves, turns (XYZ euler) and scales a geometry in place. */
function place(g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx): THREE.BufferGeometry {
  _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));
  return g.applyMatrix4(_m);
}

/** An open tube from a to b (ropes, struts, trunk segments). */
function rod(a: THREE.Vector3, b: THREE.Vector3, r0: number, r1 = r0, sides = 5): THREE.BufferGeometry {
  const dir = b.clone().sub(a);
  const g = new THREE.CylinderGeometry(r1, r0, dir.length(), sides, 1, true);
  _m.compose(a.clone().add(b).multiplyScalar(0.5), _q.setFromUnitVectors(UP, dir.normalize()), _s.set(1, 1, 1));
  return g.applyMatrix4(_m);
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  return g;
}

/** Distance from point p to the segment a-b. */
function segDist(px: number, py: number, pz: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const len2 = dx * dx + dy * dy + dz * dz;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy + (pz - az) * dz) / len2)) : 0;
  return Math.hypot(px - ax - dx * t, py - ay - dy * t, pz - az - dz * t);
}

/** Classic balloon envelope (radius, height) for a unit-height balloon with its mouth at y = 0. */
const ENVELOPE: [number, number][] = [
  [0.09, 0],
  [0.14, 0.06],
  [0.23, 0.16],
  [0.34, 0.28],
  [0.43, 0.4],
  [0.485, 0.52],
  [0.5, 0.62],
  [0.485, 0.72],
  [0.435, 0.81],
  [0.35, 0.89],
  [0.22, 0.955],
  [0, 1],
];

/** A striped hot air balloon, basket and ropes in one geometry. Unit height; scale to size. */
function balloonGeometry(pattern: number, pal: number[]): THREE.BufferGeometry {
  const seg = 16;
  const env = new THREE.LatheGeometry(
    ENVELOPE.map(([r, y]) => new THREE.Vector2(r, y)),
    seg,
  );
  const rowOf = (y: number) => {
    let j = 0;
    while (j < ENVELOPE.length - 2 && y > ENVELOPE[j + 1][1]) j++;
    return j;
  };
  const parts = [
    paint(env, (x, y, z) => {
      const gore = Math.floor((((Math.atan2(x, z) / TAU) % 1) + 1) % 1 * seg) % seg;
      const row = rowOf(y);
      if (pattern === 1) return row === 5 || row === 6 ? pal[2] : pal[gore % 2]; // gores + belly band
      if (pattern === 2) return row >= 7 ? pal[(gore + row) % 2] : pal[gore % 2 ? 2 : 0]; // checkered crown
      if (pattern === 3) return RAINBOW[gore % RAINBOW.length];
      return pal[gore % 2];
    }),
    paint(place(new THREE.BoxGeometry(0.13, 0.09, 0.13), 0, -0.2, 0), 0xc99a62, true),
    paint(place(new THREE.BoxGeometry(0.15, 0.022, 0.15), 0, -0.155, 0), 0x8a5a3a, true),
  ];
  for (const [sx, sz] of [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ]) {
    parts.push(paint(rod(new THREE.Vector3(sx * 0.062, 0.01, sz * 0.062), new THREE.Vector3(sx * 0.058, -0.15, sz * 0.058), 0.007), 0x6b5a4a));
  }
  return merge(parts);
}

/** Something drifting on a slow loop around the map (balloons, islands). */
interface Drifter {
  obj: THREE.Object3D;
  r: number;
  a: number;
  /** Angular speed (rad/s) around the map. */
  w: number;
  y: number;
  bob: number;
  phase: number;
  spin: number;
  sway: number;
  /** Balloon height, for keeping plane and bird passes clear of it (0 = don't check). */
  size: number;
}

/** A straight pass across the sky along a chord that stays well outside the blast zone. */
interface Pass {
  /** Heading: travel direction is (cos a, 0, -sin a), matching rotation.y = a. */
  a: number;
  cx: number;
  cz: number;
  y: number;
  /** Distance along the chord, from -len to len. */
  s: number;
  len: number;
  speed: number;
  active: boolean;
  wait: number;
}

interface Flock extends Pass {
  first: number;
  count: number;
  size: number;
  rich: boolean;
  /** Formation offsets (forward, up, side) per bird. */
  offs: THREE.Vector3[];
}

/** Instanced things floating on their own (beach balls drift, party balloons rise). */
interface Floater {
  r: number;
  a: number;
  /** Beach balls: angular speed around the map. Party bunches: spin. */
  w: number;
  y: number;
  size: number;
  phase: number;
  rise: number;
}

const MAX_BIRDS = 9;
/** The toy plane is modeled at about real size; bigger reads better from across the sky. */
const PLANE_SCALE = 1.35;
/** Blimp cruising speed (rad/s): about one lap every six minutes. */
const BLIMP_SPEED = 0.017;
const PARTY_BOTTOM = -120;
const PARTY_TOP = 75;

export class SkyLife {
  readonly root = new THREE.Group();
  /** Extra objects hidden on Low quality. */
  private readonly rich: THREE.Object3D[] = [];
  private readonly drifters: Drifter[] = [];
  private readonly trash: { dispose(): void }[] = [];
  private readonly rnd: () => number;
  /** Horizontal distance from the map center to the blast zone's far corner. */
  private readonly reach: number;
  private readonly mat: THREE.MeshStandardMaterial;
  private readonly gloss: THREE.MeshStandardMaterial;
  private readonly blimp = new THREE.Group();
  private blimpA = 0;
  private readonly blimpR: number;
  private readonly blimpY = 34;
  private readonly birds: THREE.InstancedMesh;
  private readonly flocks: Flock[] = [];
  private readonly plane = new THREE.Group();
  private readonly prop: THREE.Mesh;
  private readonly banner: THREE.Mesh;
  private readonly bannerTex: THREE.CanvasTexture;
  private readonly pass: Pass;
  private bannerText = 0;
  private readonly balls: THREE.InstancedMesh;
  private readonly ballState: Floater[] = [];
  private readonly party: THREE.InstancedMesh;
  private readonly partyState: Floater[] = [];
  private low = false;
  private t = 0;

  constructor(map: MapDef) {
    const b = map.blast;
    this.reach = Math.hypot(Math.max(-b.minX, b.maxX), Math.max(-b.minZ, b.maxZ));
    this.rnd = rng(seedOf(map.id));
    this.blimpR = this.reach + 175;
    const theme = map.theme;
    const horizon = new THREE.Color(theme.skyHorizon);
    // 0 on a blue day, ~0.75 on the sunset rooftop: warms the paint and deepens the silhouettes.
    const warmth = THREE.MathUtils.clamp(horizon.r - horizon.b, 0, 1);
    const tint = new THREE.Color(WHITE).lerp(new THREE.Color(theme.sun), 0.4 * warmth);
    // A touch of the horizon color as emissive stands in for sky light, so far shapes melt into
    // the haze instead of reading as dark cutouts.
    this.mat = new THREE.MeshStandardMaterial({ vertexColors: true, color: tint, roughness: 0.75, emissive: horizon, emissiveIntensity: 0.12 + 0.1 * warmth });
    this.gloss = new THREE.MeshStandardMaterial({ vertexColors: true, color: tint, roughness: 0.3, emissive: horizon, emissiveIntensity: 0.1 + 0.1 * warmth });
    this.trash.push(this.mat, this.gloss);
    const beachy = map.deck === 'planks' || !!map.ball;

    this.buildBalloons();
    this.buildIslands(beachy);
    this.buildBlimp(tint, horizon, warmth);

    // Birds: all flocks share one instanced mesh of two-triangle "V" birds; flapping is the
    // instance's y scale swinging through zero, so the wings go up and down with no vertex work.
    const birdGeo = new THREE.BufferGeometry();
    // prettier-ignore
    birdGeo.setAttribute('position', new THREE.Float32BufferAttribute([
      0.35, 0, 0, 0.12, 0.28, 0.8, -0.3, 0, 0,
      0.12, 0.28, 0.8, -0.3, 0.55, 1.6, -0.3, 0, 0,
      0.35, 0, 0, -0.3, 0, 0, 0.12, 0.28, -0.8,
      0.12, 0.28, -0.8, -0.3, 0, 0, -0.3, 0.55, -1.6,
    ], 3));
    const birdColor = new THREE.Color(0x2b2d42).lerp(new THREE.Color(0x2a1830), warmth);
    const birdMat = new THREE.MeshBasicMaterial({ color: birdColor, side: THREE.DoubleSide });
    this.birds = new THREE.InstancedMesh(birdGeo, birdMat, MAX_BIRDS * 2);
    this.birds.frustumCulled = false; // instances move every frame; the cached bounds would go stale
    this.trash.push(birdGeo, birdMat, this.birds);
    for (let i = 0; i < 2; i++) {
      const offs: THREE.Vector3[] = [new THREE.Vector3()];
      for (let k = 1; k < MAX_BIRDS; k++) {
        const rank = Math.ceil(k / 2);
        offs.push(new THREE.Vector3(-rank * 2.8, (this.rnd() - 0.5) * 1.2, (k % 2 ? 1 : -1) * rank * 2.5));
      }
      // First flocks show up within a few seconds so the sky feels alive right away.
      this.flocks.push({ ...this.newPass(), wait: 2 + i * 9 + this.rnd() * 4, first: i * MAX_BIRDS, count: 0, size: 1, rich: i > 0, offs });
    }
    this.hideBirds(0, MAX_BIRDS * 2);
    this.root.add(this.birds);

    const { body, prop, banner, tex } = this.buildPlane();
    this.prop = prop;
    this.banner = banner;
    this.bannerTex = tex;
    this.plane.add(body, prop, banner);
    this.plane.rotation.order = 'YXZ';
    this.plane.scale.setScalar(PLANE_SCALE);
    this.plane.visible = false;
    this.root.add(this.plane);
    this.pass = { ...this.newPass(), wait: 7 + this.rnd() * 5 };

    // Beach balls drifting below the map edges: a handful on the beach maps, a couple elsewhere.
    const ballGeo = paint(new THREE.SphereGeometry(1, 18, 12), (x, y, z) => {
      if (Math.abs(y) > 0.9) return WHITE;
      // Sphere segments run around atan2(z, -x); binning on that keeps each triangle in one gore.
      const gore = Math.floor((((Math.atan2(z, -x) / TAU) % 1) + 1) % 1 * 6) % 6;
      return [RED, WHITE, YELLOW, WHITE, BLUE, WHITE][gore];
    });
    const nBalls = beachy ? 5 : 2;
    this.balls = new THREE.InstancedMesh(ballGeo, this.gloss, nBalls);
    this.balls.frustumCulled = false;
    for (let i = 0; i < nBalls; i++) {
      this.ballState.push({
        r: this.reach + 24 + this.rnd() * 10,
        a: ((i + this.rnd() * 0.6) / nBalls) * TAU,
        w: (this.rnd() < 0.5 ? -1 : 1) * (0.008 + this.rnd() * 0.008),
        y: -30 - this.rnd() * 24,
        size: 3.5 + this.rnd() * 2,
        phase: this.rnd() * TAU,
        rise: 0,
      });
    }
    // Bunches of party balloons rising from far below and sailing up past the map. Every bunch
    // is the same four colors, but each turns on its own so they don't look alike.
    const bunch: THREE.BufferGeometry[] = [];
    const tie = new THREE.Vector3(0, -1.5, 0);
    for (const [x, y, z, color] of [
      [0, 1.3, 0, PINK],
      [1.1, 1.0, 0.4, YELLOW],
      [-0.95, 1.1, -0.55, BLUE],
      [0.25, 1.6, -1.1, GREEN],
    ]) {
      bunch.push(paint(place(new THREE.SphereGeometry(0.85, 12, 9), x, y, z, 0, 0, 0, 1, 1.18, 1), color));
      bunch.push(paint(place(new THREE.ConeGeometry(0.14, 0.25, 6), x, y - 1.06, z, Math.PI), color));
      bunch.push(paint(rod(new THREE.Vector3(x, y - 1.1, z), tie, 0.035, 0.035, 3), WHITE));
    }
    const partyGeo = merge(bunch);
    const nParty = 8;
    this.party = new THREE.InstancedMesh(partyGeo, this.gloss, nParty);
    this.party.frustumCulled = false;
    for (let i = 0; i < nParty; i++) {
      this.partyState.push({
        r: this.reach + 4 + this.rnd() * 6,
        a: this.rnd() * TAU,
        w: (this.rnd() - 0.5) * 0.4, // spin while rising
        y: PARTY_BOTTOM + ((i + this.rnd() * 0.5) / nParty) * (PARTY_TOP - PARTY_BOTTOM),
        size: 1.8 + this.rnd() * 0.6,
        phase: this.rnd() * TAU,
        rise: 1.8 + this.rnd() * 1.4,
      });
    }
    this.trash.push(ballGeo, partyGeo, this.balls, this.party);
    this.root.add(this.balls, this.party);
    this.rich.push(this.balls, this.party);
    this.update(0, false); // place everything before the first frame
  }

  private buildBalloons(): void {
    const n = 7;
    for (let i = 0; i < n; i++) {
      const pal = BALLOON_PALETTES[(i + Math.floor(this.rnd() * 3)) % BALLOON_PALETTES.length];
      const geo = balloonGeometry(i === 2 ? 3 : Math.floor(this.rnd() * 3), pal);
      const mesh = new THREE.Mesh(geo, this.mat);
      // Bigger ones farther out so none of them crowd the view.
      const far = this.rnd();
      const size = 13 + far * 9 + this.rnd() * 4;
      mesh.scale.setScalar(size);
      this.root.add(mesh);
      this.trash.push(geo);
      // Low quality keeps every other balloon (still spread all around).
      if (i % 2 === 1 || i === n - 1) this.rich.push(mesh);
      this.drifters.push({
        obj: mesh,
        r: this.reach + 35 + far * 110,
        a: ((i + (this.rnd() - 0.5) * 0.6) / n) * TAU,
        w: (this.rnd() < 0.5 ? -1 : 1) * (0.005 + this.rnd() * 0.007),
        y: -2 + this.rnd() * 44,
        bob: 1 + this.rnd() * 1.5,
        phase: this.rnd() * TAU,
        spin: (this.rnd() - 0.5) * 0.06,
        sway: 0.03,
        size,
      });
    }
  }

  private buildIslands(beachy: boolean): void {
    const n = 8;
    for (let i = 0; i < n; i++) {
      // Most float around the map below deck level; a few hang far beneath it (well under the
      // blast zone's floor), so a look over the edge finds something too.
      const deep = i % 3 === 1;
      const r = deep ? 7 + this.rnd() * 6 : 5 + this.rnd() * 7;
      const geo = this.islandGeometry(r, beachy);
      const mesh = new THREE.Mesh(geo, this.mat);
      this.root.add(mesh);
      this.trash.push(geo);
      if (i % 2 === 1) this.rich.push(mesh);
      this.drifters.push({
        obj: mesh,
        // Deep ones stay inside the ring the party balloons rise through.
        r: deep ? 30 + this.rnd() * Math.max(0, this.reach - 50) : this.reach + 52 + this.rnd() * 95,
        a: ((i + 0.5 + (this.rnd() - 0.5) * 0.5) / n) * TAU,
        w: 0,
        y: deep ? -85 - this.rnd() * 30 : -24 - this.rnd() * 52,
        bob: 0.8 + this.rnd(),
        phase: this.rnd() * TAU,
        spin: 0,
        sway: 0.015,
        size: 0,
      });
    }
  }

  /** A little floating rock with a grass (or sand) top, palms, tufts and flowers. */
  private islandGeometry(r: number, beachy: boolean): THREE.BufferGeometry {
    const rnd = this.rnd;
    const V = THREE.Vector3;
    const parts: THREE.BufferGeometry[] = [];
    const depth = r * (1.3 + rnd() * 0.6);
    const rock = new THREE.CylinderGeometry(r, r * 0.12, depth, 9, 3);
    const pos = rock.attributes.position as THREE.BufferAttribute;
    const salt = rnd() * 100;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      if (y > depth / 2 - 0.01) continue; // keep the top ring round so the cap sits flush
      // Keyed on position (not index) so the duplicated seam vertices move together: no cracks.
      const k = Math.round(x * 20) * 7.1 + Math.round(y * 20) * 13.3 + Math.round(z * 20) * 3.7 + salt;
      pos.setXYZ(i, x * (0.8 + hash(k) * 0.4), y - hash(k + 1) * depth * 0.08, z * (0.8 + hash(k + 2) * 0.4));
    }
    rock.translate(0, -depth / 2, 0);
    parts.push(paint(rock, (_x, y) => (y > -depth * 0.3 ? 0x8a7aa8 : 0x9b8fb8), true, 0.14));
    const top = beachy ? 0xf3dfb0 : 0x7ed957;
    const side = beachy ? 0xe0c48e : 0x5fbf45;
    parts.push(paint(place(new THREE.CylinderGeometry(r * 1.02, r * 1.07, 1, 12), 0, 0.3, 0), (_x, y) => (y > 0.75 ? top : side), true, 0.05));
    const onTop = (spread: number) => {
      const a = rnd() * TAU;
      const d = Math.sqrt(rnd()) * r * spread;
      return [Math.cos(a) * d, Math.sin(a) * d];
    };
    const palms = beachy ? 1 + (rnd() < 0.5 ? 1 : 0) : rnd() < 0.6 ? 1 : 0;
    for (let p = 0; p < palms; p++) {
      const [x, z] = onTop(0.45);
      const h = 4 + r * 0.4 + rnd() * 2;
      const lean = (0.15 + rnd() * 0.2) * h;
      const dir = rnd() * TAU;
      let prev = new V(x, 0.6, z);
      for (let s = 1; s <= 5; s++) {
        const t = s / 5;
        const next = new V(x + Math.cos(dir) * lean * t * t, 0.6 + h * t, z + Math.sin(dir) * lean * t * t);
        parts.push(paint(rod(prev, next, 0.36 - 0.03 * s, 0.33 - 0.03 * s, 6), s % 2 ? 0xc99a62 : 0xa9784a));
        prev = next;
      }
      for (let f = 0; f < 7; f++) {
        const len = 2.4 + h * 0.2 + rnd();
        const leaf = new THREE.ConeGeometry(0.75, len, 4, 1);
        leaf.translate(0, len / 2, 0);
        leaf.scale(0.25, 1, 1); // a flat blade; the thin axis ends up vertical once tipped over
        leaf.rotateZ(-(Math.PI / 2 + 0.25 + rnd() * 0.35));
        leaf.rotateY((f / 7) * TAU + rnd() * 0.4);
        leaf.translate(prev.x, prev.y, prev.z);
        parts.push(paint(leaf, f % 2 ? 0x3fbf4f : 0x5ee05e, true));
      }
      for (let c = 0; c < 3; c++) {
        const a = (c / 3) * TAU;
        parts.push(paint(place(new THREE.SphereGeometry(0.26, 6, 4), prev.x + Math.cos(a) * 0.35, prev.y - 0.35, prev.z + Math.sin(a) * 0.35), 0x7a4a2a));
      }
    }
    const tufts = beachy ? 2 : 4 + Math.floor(rnd() * 4);
    for (let i = 0; i < tufts; i++) {
      const [x, z] = onTop(0.85);
      const h = 0.7 + rnd() * 0.7;
      parts.push(paint(place(new THREE.ConeGeometry(0.3 + rnd() * 0.25, h, 5), x, 0.8 + h / 2, z), rnd() < 0.5 ? 0x4fbf3f : 0x6fd34f, true));
    }
    if (!beachy) {
      for (let i = 0; i < 4; i++) {
        const [x, z] = onTop(0.8);
        parts.push(paint(place(new THREE.SphereGeometry(0.24, 6, 4), x, 1.0, z), [PINK, YELLOW, WHITE, PURPLE][i]));
      }
    } else if (palms < 2) {
      // A tiny striped beach umbrella.
      const [x, z] = onTop(0.5);
      parts.push(paint(rod(new V(x, 0.8, z), new V(x, 3.2, z), 0.08, 0.08, 5), WHITE));
      parts.push(
        paint(place(new THREE.ConeGeometry(1.6, 0.7, 10, 1), x, 3.3, z), (px, _y, pz) => (Math.floor(((Math.atan2(px - x, pz - z) / TAU + 1) % 1) * 10) % 2 ? PINK : WHITE), true),
      );
    }
    for (let i = 0; i < 2; i++) {
      const [x, z] = onTop(0.7);
      const s = 0.4 + rnd() * 0.5;
      parts.push(paint(place(new THREE.DodecahedronGeometry(s, 0), x, 0.8 + s * 0.4, z, rnd(), rnd(), rnd()), 0xb8b0c8, true, 0.1));
    }
    return merge(parts);
  }

  /** The BLUBBA blimp: a lathed hull with the name painted on both sides, plus fins and gondola. */
  private buildBlimp(tint: THREE.Color, horizon: THREE.Color, warmth: number): void {
    const L = 56;
    const R = 7.5;
    const pts: THREE.Vector2[] = [];
    for (let k = 0; k <= 24; k++) {
      const s = (k / 24) * 2 - 1; // -1 tail .. 1 nose
      const r = R * Math.sqrt(Math.max(0, 1 - Math.pow(Math.abs(s), s > 0 ? 2.2 : 1.7)));
      pts.push(new THREE.Vector2(r, s * (L / 2)));
    }
    // Starting the lathe at -90 degrees puts the texture seam along the top once the hull is
    // turned to point its nose down +x: u = 0.25 is then the +z side and u = 0.75 the -z side.
    const hull = new THREE.LatheGeometry(pts, 28, -Math.PI / 2);
    hull.rotateZ(-Math.PI / 2);

    const W = 1024;
    const H = 512;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d')!;
    const vy = (v: number) => (1 - v) * H; // canvas row for texture v (0 = tail, 1 = nose)
    g.fillStyle = '#f7f4ee';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#ff3b8a';
    g.fillRect(0, vy(1), W, vy(0.88));
    g.fillRect(0, vy(0.1), W, H - vy(0.1));
    g.fillStyle = '#ffd60a';
    g.fillRect(0, vy(0.88), W, H * 0.025);
    g.fillRect(0, vy(0.125), W, H * 0.025);
    // Letters run along the hull, so each side is drawn turned a quarter turn (opposite ways so
    // both read left to right), scaled from meters on the hull to pixels.
    const letters = 'BLUBBA';
    const colors = ['#ffd60a', '#ff3b8a', '#2ec5ff', '#5ee05e', '#ffd60a', '#ff3b8a'];
    for (const [u, turn] of [
      [0.25, -Math.PI / 2],
      [0.75, Math.PI / 2],
    ]) {
      g.save();
      g.translate(u * W, vy(0.5));
      g.rotate(turn);
      g.scale(H / L / 10, W / (TAU * R) / 10); // 1 unit = 10 cm on the hull
      g.font = `900 72px ${FONT}`;
      g.textBaseline = 'middle';
      g.lineJoin = 'round';
      g.lineWidth = 13;
      g.strokeStyle = '#1d1b3a';
      const gap = 6;
      const widths = [...letters].map((ch) => g.measureText(ch).width);
      let x = -(widths.reduce((a, b) => a + b, 0) + gap * (letters.length - 1)) / 2;
      [...letters].forEach((ch, i) => {
        g.strokeText(ch, x, 4);
        g.fillStyle = colors[i];
        g.fillText(ch, x, 4);
        x += widths[i] + gap;
      });
      g.restore();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const hullMat = new THREE.MeshStandardMaterial({ map: tex, color: tint, roughness: 0.45, emissive: horizon, emissiveIntensity: 0.1 + 0.1 * warmth });
    const hullMesh = new THREE.Mesh(hull, hullMat);

    const parts: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 4; k++) {
      const shape = new THREE.Shape([new THREE.Vector2(-L / 2 + 1, 0), new THREE.Vector2(-L / 2 + 12, 0), new THREE.Vector2(-L / 2 + 6.5, R * 1.2), new THREE.Vector2(-L / 2 + 1.5, R * 1.2)]);
      const fin = new THREE.ExtrudeGeometry(shape, { depth: 0.5, bevelEnabled: false });
      fin.translate(0, 0, -0.25);
      const finGeo = paint(fin, PINK, true);
      finGeo.rotateX((k / 4) * TAU);
      parts.push(finGeo);
    }
    parts.push(paint(place(new THREE.BoxGeometry(11, 2.6, 3.4), 2, -8.2, 0), 0xf4f1ea, true));
    parts.push(paint(place(new THREE.BoxGeometry(9, 0.9, 3.5), 2.2, -7.9, 0), 0x6fd3ff, true));
    parts.push(paint(place(new THREE.BoxGeometry(11.2, 0.3, 3.6), 2, -9.4, 0), PINK, true));
    for (const z of [-3.4, 3.4]) {
      parts.push(paint(place(new THREE.CylinderGeometry(0.75, 0.6, 2.8, 10), -1.5, -7.6, z, 0, 0, Math.PI / 2), 0x8a93a8));
      parts.push(paint(rod(new THREE.Vector3(-1.5, -7.6, z), new THREE.Vector3(-1.5, -7.9, z * 0.45), 0.12), 0x8a93a8));
    }
    const details = new THREE.Mesh(merge(parts), this.mat);
    this.blimp.add(hullMesh, details);
    this.blimp.rotation.order = 'YXZ';
    this.blimpA = this.rnd() * TAU;
    this.root.add(this.blimp);
    this.trash.push(hull, tex, hullMat, details.geometry);
  }

  /** A toy biplane towing a banner. Nose points down +x. */
  private buildPlane(): { body: THREE.Mesh; prop: THREE.Mesh; banner: THREE.Mesh; tex: THREE.CanvasTexture } {
    const V = THREE.Vector3;
    const parts: THREE.BufferGeometry[] = [
      paint(place(new THREE.CylinderGeometry(0.62, 0.34, 6.4, 10), 0, 0, 0, 0, 0, -Math.PI / 2), YELLOW),
      paint(place(new THREE.CylinderGeometry(0.4, 0.62, 0.5, 10), 3.45, 0, 0, 0, 0, -Math.PI / 2), WHITE),
      paint(place(new THREE.ConeGeometry(0.3, 0.5, 8), 3.95, 0, 0, 0, 0, -Math.PI / 2), RED),
      paint(place(new THREE.BoxGeometry(1.7, 0.16, 10.5), 0.9, -0.4, 0), RED, true),
      paint(place(new THREE.BoxGeometry(1.7, 0.16, 10.5), 1.1, 1.35, 0), RED, true),
      paint(place(new THREE.BoxGeometry(1.1, 0.12, 3.8), -2.9, 0.1, 0), RED, true),
      paint(place(new THREE.BoxGeometry(1.3, 1.5, 0.14), -2.95, 0.8, 0), RED, true),
      paint(place(new THREE.SphereGeometry(0.5, 10, 6), -0.6, 0.45, 0, 0, 0, 0, 1.3, 0.8, 0.9), BLUE),
      // Tow rope back to the banner.
      paint(rod(new V(-3.2, 0, 0), new V(-12, -1.2, 0), 0.06, 0.06, 4), WHITE),
    ];
    for (const z of [-3.6, 3.6]) parts.push(paint(rod(new V(0.9, -0.35, z), new V(1.1, 1.3, z), 0.07, 0.07, 4), WHITE));
    for (const z of [-0.8, 0.8]) {
      parts.push(paint(place(new THREE.CylinderGeometry(0.32, 0.32, 0.2, 10), 1.2, -1.1, z, Math.PI / 2), INK));
      parts.push(paint(rod(new V(1.0, -0.3, z * 0.5), new V(1.2, -1.1, z), 0.06, 0.06, 4), 0x8a93a8));
    }
    const body = new THREE.Mesh(merge(parts), this.mat);
    const propGeo = merge([paint(new THREE.BoxGeometry(0.1, 3, 0.3), INK), paint(new THREE.BoxGeometry(0.1, 0.3, 3), INK)]);
    const prop = new THREE.Mesh(propGeo, this.mat);
    prop.position.x = 3.75;

    // Banner: two back-to-back faces (so the text reads right from both sides), waving more
    // toward the tail. Its origin is the front edge where the rope ties on.
    const BW = 30;
    const BH = 5.5;
    const front = new THREE.PlaneGeometry(BW, BH, 20, 1);
    const back = front.clone().rotateY(Math.PI);
    const bannerGeo = mergeGeometries([front, back], false)!;
    front.dispose();
    back.dispose();
    bannerGeo.translate(-BW / 2, 0, 0);
    const bp = bannerGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < bp.count; i++) {
      const x = bp.getX(i);
      bp.setZ(i, Math.sin(x * 0.32 + 0.6) * 0.6 * Math.min(1, -x / 6));
    }
    bannerGeo.computeVertexNormals();
    const c = document.createElement('canvas');
    c.width = 1024;
    c.height = 188;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const bannerMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8, emissive: 0xffffff, emissiveIntensity: 0.08 });
    const banner = new THREE.Mesh(bannerGeo, bannerMat);
    banner.position.set(-12, -1.2, 0);
    this.trash.push(body.geometry, propGeo, bannerGeo, tex, bannerMat);
    return { body, prop, banner, tex };
  }

  private drawBanner(text: string): void {
    const c = this.bannerTex.image as HTMLCanvasElement;
    const g = c.getContext('2d')!;
    const w = c.width;
    const h = c.height;
    g.fillStyle = '#fffaf0';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#ff3b8a';
    g.fillRect(0, 0, w, 12);
    g.fillRect(0, h - 12, w, 12);
    g.fillStyle = '#1d1b3a';
    g.fillRect(0, 0, 16, h);
    g.fillRect(w - 16, 0, 16, h);
    g.font = `900 ${Math.round(h * 0.6)}px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const fit = Math.min(1, (w - 90) / g.measureText(text).width);
    g.save();
    g.translate(w / 2, h / 2 + h * 0.04);
    g.scale(fit, 1);
    g.lineJoin = 'round';
    g.lineWidth = h * 0.09;
    g.strokeStyle = '#1d1b3a';
    g.strokeText(text, 0, 0);
    g.fillStyle = '#ff3b8a';
    g.fillText(text, 0, 0);
    g.restore();
    this.bannerTex.needsUpdate = true;
  }

  private newPass(): Pass {
    return { a: 0, cx: 0, cz: 0, y: 0, s: 0, len: 0, speed: 0, active: false, wait: 0 };
  }

  /**
   * Starts `p` on a fresh chord: its closest approach to the map center is between minD and maxD
   * past the blast zone, and it tries a few headings to miss the balloons and the blimp.
   */
  private launch(p: Pass, minD: number, maxD: number, y0: number, y1: number, speed: number, len: number, tail: number, margin: number): void {
    for (let tries = 0; tries < 10; tries++) {
      p.a = this.rnd() * TAU;
      const d = (this.reach + minD + this.rnd() * (maxD - minD)) * (this.rnd() < 0.5 ? -1 : 1);
      p.cx = Math.sin(p.a) * d;
      p.cz = Math.cos(p.a) * d;
      p.y = y0 + this.rnd() * (y1 - y0);
      p.speed = speed;
      p.len = len;
      if (this.clear(p, tail, margin)) break;
    }
    p.s = -p.len;
    p.active = true;
  }

  /** Whether a pass (and whatever trails `tail` meters behind it) misses the balloons and blimp. */
  private clear(p: Pass, tail: number, margin: number): boolean {
    const dx = Math.cos(p.a);
    const dz = -Math.sin(p.a);
    const dur = (2 * p.len) / p.speed;
    for (let tau = 0; tau <= dur; tau += 1.5) {
      const s = -p.len + p.speed * tau;
      const hx = p.cx + dx * s;
      const hz = p.cz + dz * s;
      for (const d of this.drifters) {
        if (!d.size || !d.obj.visible) continue;
        const a = d.a + d.w * tau;
        const dist = segDist(Math.cos(a) * d.r, d.y + d.size * 0.4, Math.sin(a) * d.r, hx, p.y, hz, hx - dx * tail, p.y, hz - dz * tail);
        if (dist < d.size * 0.65 + margin) return false;
      }
      const ba = this.blimpA + BLIMP_SPEED * tau;
      if (segDist(Math.cos(ba) * this.blimpR, this.blimpY, Math.sin(ba) * this.blimpR, hx, p.y, hz, hx - dx * tail, p.y, hz - dz * tail) < 34 + margin) return false;
    }
    return true;
  }

  private hideBirds(first: number, count: number): void {
    _m.makeScale(0, 0, 0);
    for (let i = first; i < first + count; i++) this.birds.setMatrixAt(i, _m);
    this.birds.instanceMatrix.needsUpdate = true;
  }

  /** Animates everything. `low` (Low quality) hides the extras and skips their updates. */
  update(dt: number, low: boolean): void {
    this.t += dt;
    const t = this.t;
    if (low !== this.low) {
      this.low = low;
      for (const o of this.rich) o.visible = !low;
    }

    for (const d of this.drifters) {
      if (!d.obj.visible) continue;
      d.a += d.w * dt;
      d.obj.position.set(Math.cos(d.a) * d.r, d.y + Math.sin(t * 0.35 + d.phase) * d.bob, Math.sin(d.a) * d.r);
      d.obj.rotation.set(Math.sin(t * 0.43 + d.phase * 2) * d.sway, d.phase + t * d.spin, Math.sin(t * 0.5 + d.phase) * d.sway);
    }

    // The blimp cruises a big circle, nose along its path (rotation.y = -(angle + 90 degrees)).
    this.blimpA += dt * BLIMP_SPEED;
    this.blimp.position.set(Math.cos(this.blimpA) * this.blimpR, this.blimpY + Math.sin(t * 0.2) * 1.5, Math.sin(this.blimpA) * this.blimpR);
    this.blimp.rotation.set(Math.sin(t * 0.37) * 0.02, -this.blimpA - Math.PI / 2, Math.sin(t * 0.23) * 0.025);

    let birdsMoved = false;
    for (const f of this.flocks) {
      if (f.rich && low) {
        if (f.active) {
          f.active = false;
          this.hideBirds(f.first, MAX_BIRDS);
        }
        continue;
      }
      if (!f.active) {
        f.wait -= dt;
        if (f.wait > 0) continue;
        this.launch(f, 10, 70, 6, 40, 10 + this.rnd() * 4, 300, 12, 6);
        f.count = 5 + Math.floor(this.rnd() * (MAX_BIRDS - 4));
        f.size = 1.7 + this.rnd() * 0.5;
        this.hideBirds(f.first, MAX_BIRDS);
      }
      f.s += f.speed * dt;
      if (f.s > f.len) {
        f.active = false;
        f.wait = 6 + this.rnd() * 20;
        this.hideBirds(f.first, MAX_BIRDS);
        continue;
      }
      // Shrink in and out at the far ends of the pass (they're specks in the haze by then).
      const fade = THREE.MathUtils.clamp(Math.min(f.s + f.len, f.len - f.s) / 50, 0, 1) * f.size;
      _q.setFromAxisAngle(UP, f.a);
      const bx = f.cx + Math.cos(f.a) * f.s;
      const by = f.y + Math.sin(t * 0.5 + f.first) * 2;
      const bz = f.cz - Math.sin(f.a) * f.s;
      for (let k = 0; k < f.count; k++) {
        const o = f.offs[k];
        _p.set(o.x + Math.sin(t * 0.9 + k) * 0.4, o.y + Math.sin(t * 1.3 + k * 2.1) * 0.3, o.z).applyQuaternion(_q);
        _p.x += bx;
        _p.y += by;
        _p.z += bz;
        // Flap, with the odd glide where the wings rest in a shallow V.
        const glide = Math.sin(t * 0.45 + k * 0.8) > 0.55;
        const flap = glide ? 0.35 : Math.sin(t * 9 + k * 1.3);
        _s.set(fade, fade * flap, fade);
        _m.compose(_p, _q, _s);
        this.birds.setMatrixAt(f.first + k, _m);
      }
      birdsMoved = true;
    }
    if (birdsMoved) this.birds.instanceMatrix.needsUpdate = true;

    const p = this.pass;
    if (!p.active) {
      p.wait -= dt;
      if (p.wait <= 0) {
        this.launch(p, 30, 100, 16, 36, 17, 380, 42 * PLANE_SCALE, 12);
        this.drawBanner(BANNERS[this.bannerText++ % BANNERS.length]);
        this.plane.visible = true;
      }
    }
    if (p.active) {
      p.s += p.speed * dt;
      if (p.s > p.len) {
        p.active = false;
        p.wait = 25 + this.rnd() * 30;
        this.plane.visible = false;
      } else {
        this.plane.position.set(p.cx + Math.cos(p.a) * p.s, p.y + Math.sin(t * 0.6) * 0.8, p.cz - Math.sin(p.a) * p.s);
        this.plane.rotation.set(Math.sin(t * 0.8) * 0.06, p.a, Math.sin(t * 0.5) * 0.02);
        this.prop.rotation.x += dt * 40;
        this.banner.rotation.x = Math.sin(t * 2.3) * 0.07;
      }
    }

    if (!low) {
      this.ballState.forEach((b, i) => {
        b.a += b.w * dt;
        _p.set(Math.cos(b.a) * b.r, b.y + Math.sin(t * 0.4 + b.phase) * 1.2, Math.sin(b.a) * b.r);
        _q.setFromEuler(_e.set(t * 0.11 + b.phase, t * 0.07, t * 0.05));
        _m.compose(_p, _q, _s.setScalar(b.size));
        this.balls.setMatrixAt(i, _m);
      });
      this.balls.instanceMatrix.needsUpdate = true;
      this.partyState.forEach((b, i) => {
        b.y += b.rise * dt;
        if (b.y > PARTY_TOP) {
          b.y = PARTY_BOTTOM;
          b.a = this.rnd() * TAU;
        }
        // Grow in at the bottom and shrink away at the top instead of popping.
        const k = THREE.MathUtils.clamp(Math.min(b.y - PARTY_BOTTOM, PARTY_TOP - b.y) / 18, 0, 1) * b.size;
        _p.set(Math.cos(b.a) * b.r + Math.sin(t * 0.7 + b.phase) * 1.5, b.y, Math.sin(b.a) * b.r + Math.cos(t * 0.6 + b.phase) * 1.5);
        _q.setFromEuler(_e.set(Math.sin(t * 1.1 + b.phase) * 0.12, b.phase + t * b.w, Math.cos(t * 0.9 + b.phase) * 0.12));
        _m.compose(_p, _q, _s.setScalar(k));
        this.party.setMatrixAt(i, _m);
      });
      this.party.instanceMatrix.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const d of this.trash) d.dispose();
  }
}
