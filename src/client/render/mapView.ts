import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { DecorDef, MapDef, SolidDef, SolidKind, SurfaceLook } from '../../shared/maps/types';
import type { World } from '../../shared/world';
import { PropKit, buildProp } from './props';
import type { Quality } from './renderer';
import { SkyLife } from './skyLife';
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
  goal: 0xf4f7ff,
  pillar: 0xc9c3b8,
  candy: 0xff6f9c,
  metal: 0xb8c0d0,
  hidden: 0xffffff,
};

function hash(n: number): number {
  const s = Math.sin(n * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

function uvScale(geo: THREE.BufferGeometry, su: number, sv: number): THREE.BufferGeometry {
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  return geo;
}

type DeckStyle = SurfaceLook | 'field' | 'quilt';

/** Edge stripes per surface (easy-to-read drops), or none. Everything else gets hazard stripes. */
const EDGES: Partial<Record<DeckStyle, [string, string] | null>> = {
  quilt: null,
  wafer: null,
  candyStripe: null,
  frosting: ['#ffffff', '#ff4d7e'],
  cookie: ['#fff1dc', '#7a4524'],
  chocolate: ['#ffe9c7', '#3d1f0f'],
  skate: ['#ff4fa3', '#2b2d42'],
};

/** Irregular blob (chocolate chips) centered at (x, y) in pixels. */
function blob(g: CanvasRenderingContext2D, x: number, y: number, r: number, seed: number): void {
  g.beginPath();
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2;
    const rr = r * (0.7 + 0.5 * hash(seed + k * 1.3));
    if (k === 0) g.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    else g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.closePath();
  g.fill();
}

/**
 * Canvas texture for a deck top: painted parking lines (or a pitch, quilting, planks, frosting,
 * cookie, concrete, moon dust...) and, with `edge`, stripes around the edge.
 */
function deckTexture(w: number, d: number, color: number, style: DeckStyle, edge = true): THREE.CanvasTexture {
  const ppm = 24; // pixels per meter
  const cw = Math.min(2048, Math.round(w * ppm));
  const ch = Math.min(2048, Math.round(d * ppm));
  const c = document.createElement('canvas');
  c.width = cw;
  c.height = ch;
  const g = c.getContext('2d')!;
  const base = new THREE.Color(color);
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
  if (style === 'field') {
    // Mowed stripes, halfway line, center circle and goal boxes.
    for (let x = 0; x < w; x += 4) {
      if (Math.floor(x / 4) % 2 === 0) continue;
      g.fillStyle = 'rgba(0,0,0,0.05)';
      g.fillRect(x * sx, 0, 4 * sx, ch);
    }
    g.strokeStyle = 'rgba(255,255,255,0.9)';
    g.lineWidth = 0.22 * sx;
    g.strokeRect(1.2 * sx, 1.2 * sz, (w - 2.4) * sx, (d - 2.4) * sz);
    g.beginPath();
    g.moveTo((w / 2) * sx, 1.2 * sz);
    g.lineTo((w / 2) * sx, (d - 1.2) * sz);
    g.stroke();
    g.beginPath();
    g.arc((w / 2) * sx, (d / 2) * sz, 5 * sx, 0, Math.PI * 2);
    g.stroke();
    for (const side of [0, 1]) {
      const x0 = side === 0 ? 1.2 : w - 1.2 - 6;
      g.strokeRect(x0 * sx, (d / 2 - 8) * sz, 6 * sx, 16 * sz);
    }
  } else if (style === 'quilt') {
    // Puffy inflatable quilting.
    g.strokeStyle = 'rgba(255,255,255,0.55)';
    g.lineWidth = 0.12 * sx;
    for (let x = 2; x < w; x += 2) {
      g.beginPath();
      g.moveTo(x * sx, 0);
      g.lineTo(x * sx, ch);
      g.stroke();
    }
    for (let z = 2; z < d; z += 2) {
      g.beginPath();
      g.moveTo(0, z * sz);
      g.lineTo(cw, z * sz);
      g.stroke();
    }
    g.fillStyle = 'rgba(0,0,0,0.05)';
    for (let x = 0; x < w; x += 2) for (let z = 0; z < d; z += 2) if ((x + z) % 4 === 0) g.fillRect(x * sx, z * sz, 2 * sx, 2 * sz);
  } else if (style === 'planks') {
    // Boardwalk planks running east-west: a slightly different shade per board, dark seams, and
    // staggered butt joints.
    const board = 0.8;
    for (let row = 0; row * board < d; row++) {
      const z = row * board;
      const shade = (hash(row * 3.7 + w) - 0.5) * 0.14;
      g.fillStyle = shade > 0 ? `rgba(255,240,220,${shade})` : `rgba(60,30,10,${-shade})`;
      g.fillRect(0, z * sz, cw, board * sz);
      g.fillStyle = 'rgba(70,40,20,0.45)';
      g.fillRect(0, z * sz, cw, 0.08 * sz);
      for (let x = hash(row * 1.9 + d) * 5; x < w; x += 3 + hash(row * 7.1 + x) * 4) g.fillRect(x * sx, z * sz, 0.08 * sx, board * sz);
    }
  } else if (style === 'frosting') {
    // Swooshes of piped frosting and a scatter of sprinkles.
    g.strokeStyle = 'rgba(255,255,255,0.2)';
    g.lineWidth = 0.3 * sx;
    for (let i = 0; i < (w * d) / 5; i++) {
      g.beginPath();
      g.arc(hash(i * 2.3) * cw, hash(i * 5.9) * ch, (0.5 + hash(i * 1.1) * 1.2) * sx, hash(i) * 6, hash(i) * 6 + 2.4);
      g.stroke();
    }
    const colors = ['#ff3b5c', '#ffd60a', '#2ec5ff', '#8ee000', '#ffffff', '#b06bff'];
    for (let i = 0; i < w * d * 2.5; i++) {
      g.save();
      g.translate(hash(i * 3.7 + 1) * cw, hash(i * 9.1 + 2) * ch);
      g.rotate(hash(i * 4.3) * Math.PI);
      g.fillStyle = colors[i % colors.length];
      g.fillRect(-0.17 * sx, -0.05 * sx, 0.34 * sx, 0.1 * sx);
      g.restore();
    }
  } else if (style === 'cookie') {
    // Baked patches, cracks and chocolate chips.
    for (let i = 0; i < (w * d) / 3; i++) {
      g.fillStyle = hash(i * 1.9) > 0.5 ? 'rgba(120,60,20,0.08)' : 'rgba(255,230,180,0.1)';
      g.beginPath();
      g.arc(hash(i * 3.3) * cw, hash(i * 7.1) * ch, (0.4 + hash(i * 2.1) * 1.2) * sx, 0, Math.PI * 2);
      g.fill();
    }
    g.strokeStyle = 'rgba(110,55,20,0.35)';
    g.lineWidth = 0.08 * sx;
    for (let i = 0; i < (w * d) / 40; i++) {
      let x = hash(i * 8.3) * cw;
      let y = hash(i * 6.2) * ch;
      g.beginPath();
      g.moveTo(x, y);
      for (let k = 0; k < 4; k++) {
        x += (hash(i * 3 + k) - 0.5) * 1.6 * sx;
        y += (hash(i * 5 + k) - 0.5) * 1.6 * sx;
        g.lineTo(x, y);
      }
      g.stroke();
    }
    for (let i = 0; i < (w * d) / 4; i++) {
      g.fillStyle = hash(i * 2.9) > 0.3 ? '#4a2412' : '#6b3a1f';
      blob(g, hash(i * 4.7 + 3) * cw, hash(i * 2.1 + 5) * ch, (0.22 + hash(i * 3.9) * 0.2) * sx, i * 11.3);
    }
  } else if (style === 'wafer') {
    // Diagonal crosshatch.
    g.lineWidth = 0.1 * sx;
    for (const [dx, a] of [
      [0, 'rgba(140,85,25,0.45)'],
      [0.08, 'rgba(255,245,210,0.35)'],
    ] as [number, string][]) {
      g.strokeStyle = a;
      for (let k = -d; k < w + d; k += 0.6) {
        g.beginPath();
        g.moveTo((k + dx) * sx, 0);
        g.lineTo((k + dx + d) * sx, ch);
        g.moveTo((k + dx) * sx, ch);
        g.lineTo((k + dx + d) * sx, 0);
        g.stroke();
      }
    }
  } else if (style === 'chocolate') {
    // Chocolate bar squares with a bevel: light top-left edges, dark bottom-right ones.
    const cell = 1.5;
    const b = 0.12;
    for (let x = 0; x < w; x += cell) {
      for (let z = 0; z < d; z += cell) {
        g.fillStyle = 'rgba(255,220,190,0.14)';
        g.fillRect(x * sx, z * sz, cell * sx, b * sz);
        g.fillRect(x * sx, z * sz, b * sx, cell * sz);
        g.fillStyle = 'rgba(0,0,0,0.3)';
        g.fillRect(x * sx, (z + cell - b) * sz, cell * sx, b * sz);
        g.fillRect((x + cell - b) * sx, z * sz, b * sx, cell * sz);
      }
    }
  } else if (style === 'candyStripe') {
    g.fillStyle = '#ff4d6d';
    for (let k = -d; k < w + d; k += 0.9) {
      g.beginPath();
      g.moveTo(k * sx, 0);
      g.lineTo((k + 0.45) * sx, 0);
      g.lineTo((k + 0.45 + d) * sx, ch);
      g.lineTo((k + d) * sx, ch);
      g.closePath();
      g.fill();
    }
  } else if (style === 'skate') {
    // Big painted shapes, skid marks and expansion joints.
    const paints = ['rgba(46,197,255,0.28)', 'rgba(255,79,163,0.26)', 'rgba(255,214,10,0.3)', 'rgba(142,224,0,0.26)'];
    for (let i = 0; i < Math.max(3, (w * d) / 90); i++) {
      g.fillStyle = paints[i % paints.length];
      const x = hash(i * 7.7 + w) * cw;
      const y = hash(i * 3.1 + d) * ch;
      const r = (1.5 + hash(i * 5.5) * 2.5) * sx;
      g.beginPath();
      if (i % 3 === 0) {
        for (let k = 0; k < 10; k++) {
          const a = (k / 10) * Math.PI * 2 - Math.PI / 2;
          const rr = k % 2 ? r * 0.45 : r;
          g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
        }
      } else g.arc(x, y, r, 0, Math.PI * 2);
      g.closePath();
      g.fill();
    }
    g.strokeStyle = 'rgba(30,30,40,0.12)';
    g.lineWidth = 0.12 * sx;
    for (let i = 0; i < (w * d) / 60; i++) {
      g.beginPath();
      g.arc(hash(i * 2.2) * cw, hash(i * 9.9) * ch, (2 + hash(i) * 4) * sx, hash(i * 3) * 6, hash(i * 3) * 6 + 0.9);
      g.stroke();
    }
    g.fillStyle = 'rgba(40,45,60,0.35)';
    for (let x = 4; x < w; x += 4) g.fillRect(x * sx, 0, 0.06 * sx, ch);
    for (let z = 4; z < d; z += 4) g.fillRect(0, z * sz, cw, 0.06 * sz);
  } else if (style === 'moon') {
    // Moon dust: pebbles, craters (lit from the top left) and a trail of boot prints.
    for (let i = 0; i < (w * d) / 1.2; i++) {
      g.fillStyle = hash(i * 1.3) > 0.5 ? 'rgba(255,255,255,0.08)' : 'rgba(30,30,50,0.1)';
      g.beginPath();
      g.arc(hash(i * 6.1) * cw, hash(i * 2.7) * ch, (0.05 + hash(i * 8.3) * 0.2) * sx, 0, Math.PI * 2);
      g.fill();
    }
    for (let i = 0; i < Math.max(4, (w * d) / 45); i++) {
      const x = hash(i * 3.9 + 1) * cw;
      const y = hash(i * 5.3 + 2) * ch;
      const r = (0.4 + hash(i * 2.9) * 1.4) * sx;
      g.fillStyle = 'rgba(60,60,85,0.16)';
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = r * 0.18;
      g.strokeStyle = 'rgba(255,255,255,0.3)';
      g.beginPath();
      g.arc(x, y, r, Math.PI * 0.1, Math.PI * 1.1);
      g.stroke();
      g.strokeStyle = 'rgba(40,40,60,0.25)';
      g.beginPath();
      g.arc(x, y, r, Math.PI * 1.1, Math.PI * 2.1);
      g.stroke();
    }
    g.fillStyle = 'rgba(50,50,70,0.22)';
    for (let i = 0; i < 28; i++) {
      const t = i / 28;
      const x = (0.15 + 0.7 * t) * cw;
      const y = (0.5 + 0.3 * Math.sin(t * 5)) * ch + (i % 2 ? 0.25 : -0.25) * sz;
      g.beginPath();
      g.ellipse(x, y, 0.16 * sx, 0.09 * sz, 0, 0, Math.PI * 2);
      g.fill();
    }
  } else if (style === 'metal') {
    // Deck plates with seams, rivets and a faint tread pattern.
    g.fillStyle = 'rgba(255,255,255,0.05)';
    for (let x = 0; x < w; x += 0.5) for (let z = 0; z < d; z += 0.5) g.fillRect((x + ((z * 2) % 2) * 0.25) * sx, z * sz, 0.18 * sx, 0.05 * sz);
    g.fillStyle = 'rgba(30,35,50,0.4)';
    for (let x = 2; x < w; x += 2) g.fillRect(x * sx, 0, 0.05 * sx, ch);
    for (let z = 2; z < d; z += 2) g.fillRect(0, z * sz, cw, 0.05 * sz);
    g.fillStyle = 'rgba(255,255,255,0.35)';
    for (let x = 0; x < w; x += 2) {
      for (let z = 0; z < d; z += 2) {
        for (const [ox, oz] of [
          [0.2, 0.2],
          [1.8, 0.2],
          [0.2, 1.8],
          [1.8, 1.8],
        ]) {
          g.beginPath();
          g.arc((x + ox) * sx, (z + oz) * sz, 0.05 * sx, 0, Math.PI * 2);
          g.fill();
        }
      }
    }
  } else if (style === 'parking') {
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
  // Bright stripes around the edge so drops are easy to read.
  const colors = style in EDGES ? EDGES[style] : ['#ffd23f', '#2b2d42'];
  if (!edge || !colors) {
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }
  const band = 0.55;
  const stripe = 1.0;
  for (const side of [0, 1, 2, 3]) {
    const horizontal = side < 2;
    const len = horizontal ? w : d;
    for (let s = 0; s < len; s += stripe) {
      g.fillStyle = colors[Math.floor(s / stripe) % 2];
      if (horizontal) {
        const y = side === 0 ? 0 : (d - band) * sz;
        g.fillRect(s * sx, y, stripe * sx + 1, band * sz);
      } else {
        const x = side === 2 ? 0 : (w - band) * sx;
        g.fillRect(x, s * sz, band * sx, stripe * sz + 1);
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

/** Merges geometries (already placed) into one, normalizing their attributes so any mix can merge. */
function mergeAll(geos: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  const nonIndexed = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  for (const g of nonIndexed) {
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!g.attributes.normal) g.computeVertexNormals();
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    g.clearGroups();
  }
  return mergeGeometries(nonIndexed, false);
}

/** What hangs under the floating decks: the cone's color and the body between it and the top slab. */
const UNDERSIDES = {
  rock: { under: 0x9b8fb8, body: 0x8a7aa8, waffle: false },
  waffle: { under: 0xffffff, body: 0xf3d39c, waffle: true },
  moon: { under: 0x8c8ea3, body: 0x797b90, waffle: false },
};

/** Deck bodies that should look like what's on top (a cookie is cookie all the way through). */
const BODY_FOR_LOOK: Partial<Record<SurfaceLook, number>> = { cookie: 0xc98a4f, chocolate: 0x5a2e17, metal: 0x6d7488 };

interface MoverMesh {
  solidId: number;
  mesh: THREE.Object3D;
  def: SolidDef;
}

/** Where a shrink warning goes: the red area is `outer` minus `inner`, at height `y`. */
export interface WarnArea {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** What stays standing (a zero-size box in the middle when the whole piece goes). */
  inMinX: number;
  inMaxX: number;
  inMinZ: number;
  inMaxZ: number;
  y: number;
  /** Draw the border along the inner edge (where a crumbling deck will end) instead of the outer one. */
  innerLine: boolean;
}

interface WarnView {
  group: THREE.Group;
  fills: THREE.Mesh[];
  lines: THREE.Mesh[];
}

/** Props that animate themselves or get updated every frame; every other prop is merged by material. */
const LIVE_DECOR = new Set<DecorDef['type']>(['tubeMan', 'balloons', 'flag', 'ferrisWheel', 'net', 'space']);

/** Builds and animates the visible map from a MapDef. */
export class MapView {
  readonly root = new THREE.Group();
  private readonly movers: MoverMesh[] = [];
  private readonly tubeMen: { man: TubeMan; pose: TubeManPose }[] = [];
  private readonly pads: THREE.Object3D[] = [];
  private readonly clouds = new THREE.Group();
  private readonly balloons: THREE.Object3D[] = [];
  private readonly wheels: { wheel: THREE.Object3D; cars: THREE.Object3D[] }[] = [];
  private readonly solidMeshes = new Map<number, THREE.Object3D>();
  private readonly deckTops: THREE.MeshStandardMaterial[] = [];
  private fan: THREE.Group | null = null;
  /** Shared materials and animations of the props. */
  private readonly kit = new PropKit();
  /** Static props waiting to be merged, by the object they belong to and their material. */
  private readonly batches = new Map<THREE.Object3D, Map<THREE.Material, THREE.BufferGeometry[]>>();
  private readonly pumpPads: { ring: THREE.Mesh; core: THREE.Mesh; team: 0 | 1; plunger: THREE.Object3D }[] = [];
  private readonly giants: { man: TubeMan; pose: TubeManPose; team: 0 | 1; fill: number; shown: number }[] = [];
  private teamColors: number[] = [0xff3b5c, 0x2ec5ff];
  private fanBlades: THREE.Object3D | null = null;
  private readonly sky: SkyLife;
  private time = 0;
  /** Red flashing warnings over pieces of the map about to fall away. */
  private readonly warnViews = new Map<number, WarnView>();
  private readonly warnFillMat = new THREE.MeshBasicMaterial({ color: 0xff2440, transparent: true, opacity: 0.3, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  private readonly warnLineMat = new THREE.MeshBasicMaterial({ color: 0xff2440, transparent: true, opacity: 0.9, depthWrite: false });
  private readonly warnPlane = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  private readonly warnBar = new THREE.BoxGeometry(1, 1, 1);
  /** Materials of pieces that sink, with their own emissive to restore after a warning glow. */
  private readonly tints = new Map<number, { m: THREE.MeshStandardMaterial; color: THREE.Color; k: number }[]>();

  constructor(
    readonly map: MapDef,
    readonly world: World,
    /** Current graphics quality (Low shows a lighter sky). */
    private readonly quality: () => Quality = () => 'medium',
  ) {
    this.buildSolids();
    this.buildDecor();
    this.buildPads();
    this.buildModeProps();
    this.buildClouds();
    this.root.add(this.clouds);
    // Balloons, a blimp, birds and floating islands far around the map.
    this.sky = new SkyLife(map);
    this.root.add(this.sky.root);
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
    const U = UNDERSIDES[this.map.underside ?? 'rock'];
    const underMat = new THREE.MeshStandardMaterial({ color: U.under, roughness: 0.9, flatShading: !U.waffle, map: U.waffle ? this.kit.waffle() : null });
    const mats = new Map<string, THREE.Material>();
    const matFor = (kind: SolidKind, color = KIND_COLORS[kind]) => {
      const key = `${kind}|${color}`;
      let m = mats.get(key);
      if (!m) {
        if (kind === 'glass') {
          m = new THREE.MeshPhysicalMaterial({ color, roughness: 0.05, transmission: 0, transparent: true, opacity: 0.55, metalness: 0.1 });
        } else if (kind === 'bouncy' || kind === 'candy') {
          // Glossy vinyl, or hard candy.
          m = new THREE.MeshStandardMaterial({ color, roughness: kind === 'candy' ? 0.22 : 0.28, metalness: 0.02 });
        } else if (kind === 'metal') {
          m = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.55 });
        } else {
          m = new THREE.MeshStandardMaterial({ color, roughness: kind === 'crate' ? 0.8 : 0.7 });
        }
        mats.set(key, m);
      }
      return m;
    };
    const bodyMat = (look: SurfaceLook) => {
      const color = BODY_FOR_LOOK[look] ?? U.body;
      return this.kit.mat(color, 0.95);
    };
    const style: DeckStyle = this.map.ball ? 'field' : this.map.pumps ? 'plain' : (this.map.deck ?? 'parking');

    this.map.solids.forEach((def, id) => {
      // Collision-only pieces are drawn by props; the ones that sink or move still get an (empty)
      // holder so their props can go along with them.
      if (def.kind === 'hidden' && !def.mover && !((def.collapse ?? 0) > 0)) return;
      const w = def.max[0] - def.min[0];
      const h = def.max[1] - def.min[1];
      const d = def.max[2] - def.min[2];
      const cx = (def.min[0] + def.max[0]) / 2;
      const cy = (def.min[1] + def.max[1]) / 2;
      const cz = (def.min[2] + def.max[2]) / 2;
      const radius = Math.min(0.18, Math.min(w, h, d) * 0.2);
      const isDeck = def.kind === 'lot' || def.kind === 'island';
      const color = def.color ?? KIND_COLORS[def.kind];
      const group = new THREE.Group();

      if (def.kind === 'bouncy') {
        // Puffy inflatable: big rounded corners; wide surfaces get quilting on top.
        const puff = Math.min(0.6, Math.min(w, h, d) * 0.35);
        const mesh = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, puff), matFor('bouncy', color));
        mesh.position.set(cx, cy, cz);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
        if (w * d > 40) {
          const topMat = new THREE.MeshStandardMaterial({ map: deckTexture(w, d, color, 'quilt'), roughness: 0.3 });
          this.deckTops.push(topMat);
          const top = new THREE.Mesh(new THREE.PlaneGeometry(w - puff * 2, d - puff * 2), topMat);
          top.rotation.x = -Math.PI / 2;
          top.position.set(cx, def.max[1] + 0.01, cz);
          top.receiveShadow = true;
          group.add(top);
        }
      } else if (def.kind === 'hidden') {
        // Nothing to draw.
      } else if (isDeck) {
        // Top slab with painted texture, then a chunky floating-rock underside.
        const look = def.look ?? (def.kind === 'lot' ? style : 'plain');
        const topMat = new THREE.MeshStandardMaterial({ map: deckTexture(w, d, color, look), roughness: 0.85 });
        this.deckTops.push(topMat);
        const slab = new THREE.Mesh(new RoundedBoxGeometry(w, 0.6, d, 2, 0.12), matFor(def.kind, color));
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
          const body = new THREE.Mesh(new RoundedBoxGeometry(w * 0.98, bodyH, d * 0.98, 2, 0.2), bodyMat(look as SurfaceLook));
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
        if (U.waffle) uvScale(cone, Math.round((w + d) / 4), 4);
        const depth = Math.min(22, Math.max(5, Math.max(w, d) * 0.45));
        const under = new THREE.Mesh(cone, underMat);
        under.scale.set(w * 0.98, depth, d * 0.98);
        under.position.set(cx, def.min[1] - depth / 2 + 0.05, cz);
        group.add(under);
      } else if (def.look === 'frosting') {
        // A frosted cake layer: sponge, a frosting cap with sprinkles on top, and drips down the sides.
        const cap = 0.3;
        const sponge = new THREE.Mesh(new RoundedBoxGeometry(w, h - cap + 0.05, d, 2, radius), this.kit.mat(0xf2cf94, 0.8));
        sponge.position.set(cx, def.min[1] + (h - cap + 0.05) / 2, cz);
        const icing = matFor('building', color);
        const lid = new THREE.Mesh(new RoundedBoxGeometry(w + 0.16, cap, d + 0.16, 2, 0.12), icing);
        lid.position.set(cx, def.max[1] - cap / 2, cz);
        const top = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ map: deckTexture(w, d, color, 'frosting', false), roughness: 0.6 }));
        top.rotation.x = -Math.PI / 2;
        top.position.set(cx, def.max[1] + 0.004, cz);
        const drips: THREE.BufferGeometry[] = [];
        let k = id * 7;
        for (const [x0, z0, x1, z1] of [
          [def.min[0], def.min[2] - 0.08, def.max[0], def.min[2] - 0.08],
          [def.min[0], def.max[2] + 0.08, def.max[0], def.max[2] + 0.08],
          [def.min[0] - 0.08, def.min[2], def.min[0] - 0.08, def.max[2]],
          [def.max[0] + 0.08, def.min[2], def.max[0] + 0.08, def.max[2]],
        ]) {
          const len = Math.hypot(x1 - x0, z1 - z0);
          for (let t = 0.3; t < len - 0.2; t += 0.55) {
            const r = 0.1 + 0.07 * hash(k++);
            const l = 0.1 + 0.45 * hash(k++);
            const f = t / len;
            drips.push(new THREE.CapsuleGeometry(r, l, 3, 8).translate(x0 + (x1 - x0) * f, def.max[1] - cap - l / 2, z0 + (z1 - z0) * f));
          }
        }
        group.add(sponge, lid, top);
        const dripGeo = drips.length ? mergeAll(drips) : null;
        if (dripGeo) group.add(new THREE.Mesh(dripGeo, icing));
        group.traverse((o) => {
          o.castShadow = o !== top;
          o.receiveShadow = true;
        });
      } else {
        const mesh = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, radius), matFor(def.kind, color));
        mesh.position.set(cx, cy, cz);
        mesh.castShadow = def.kind !== 'glass';
        mesh.receiveShadow = true;
        group.add(mesh);
        if (def.look) {
          // A painted top (wafer, chocolate, candy stripes, deck plates...).
          const top = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.1, d - 0.1), new THREE.MeshStandardMaterial({ map: deckTexture(w, d, color, def.look, false), roughness: 0.6 }));
          top.rotation.x = -Math.PI / 2;
          top.position.set(cx, def.max[1] + 0.004, cz);
          top.receiveShadow = true;
          group.add(top);
        }
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
          // Orange stripes on the flatbed/elevator edges (unless it has a painted top).
          const stripeMat = new THREE.MeshStandardMaterial({ color: 0xff8a1f, roughness: 0.5 });
          for (const zz of def.look ? [] : [def.min[2] + 0.1, def.max[2] - 0.1]) {
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
        // Pivot at the piece's center so it can sink and crumble (scale) when the map shrinks.
        const pivot = new THREE.Group();
        pivot.position.set(cx, 0, cz);
        for (const child of [...group.children]) {
          child.position.x -= cx;
          child.position.z -= cz;
          pivot.add(child);
        }
        this.root.add(pivot);
        this.solidMeshes.set(id, pivot);
        // Pieces that sink glow red while they warn, so they get their own copy of shared materials.
        if ((def.collapse ?? 0) > 0) {
          const tints: { m: THREE.MeshStandardMaterial; color: THREE.Color; k: number }[] = [];
          pivot.traverse((o) => {
            const mesh = o as THREE.Mesh;
            const mat = mesh.material as THREE.MeshStandardMaterial | undefined;
            if (!mesh.isMesh || !mat || !(mat as { emissive?: unknown }).emissive) return;
            const own = this.deckTops.includes(mat) ? mat : mat.clone();
            mesh.material = own;
            tints.push({ m: own, color: own.emissive.clone(), k: own.emissiveIntensity });
          });
          this.tints.set(id, tints);
        }
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
      const merged = mergeAll(geos);
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
      this.addOnTop(g, pad.x, pad.y, pad.z);
      this.pads.push(g);
    }
  }

  private buildClouds(): void {
    const cloud = this.map.theme.cloud;
    const mat = new THREE.MeshStandardMaterial({ color: cloud, roughness: 1, emissive: cloud === 0xffffff ? 0xdde9ff : cloud, emissiveIntensity: 0.35, flatShading: false });
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
      if (!obj) continue;
      const parent = this.parentFor(d.x, d.y, d.z, d.ride);
      if (LIVE_DECOR.has(d.type)) {
        parent.updateWorldMatrix(true, false);
        parent.attach(obj);
      } else this.bake(obj, parent);
    }
    this.flushBatches();
  }

  /**
   * What a prop standing at (x, y, z) belongs to: the piece it rides (`ride`), a piece under it
   * that sinks in the final 30 seconds (so it goes down with it instead of hanging in the air), or
   * the map itself.
   */
  private parentFor(x: number, y: number, z: number, ride?: number): THREE.Object3D {
    const on =
      ride ??
      this.map.solids.findIndex(
        (s) => (s.collapse ?? 0) >= 1 && !s.mover && Math.abs(s.max[1] - y) < 0.05 && x >= s.min[0] && x <= s.max[0] && z >= s.min[2] && z <= s.max[2],
      );
    return (on >= 0 && this.solidMeshes.get(on)) || this.root;
  }

  /** Adds a live (animated) prop standing at (x, y, z). */
  private addOnTop(obj: THREE.Object3D, x: number, y: number, z: number): void {
    const parent = this.parentFor(x, y, z);
    parent.updateWorldMatrix(true, false);
    parent.attach(obj);
  }

  /**
   * Queues a static prop's meshes to be merged with every other prop that uses the same material
   * on the same parent (lines and points are kept as they are).
   */
  private bake(obj: THREE.Object3D, parent: THREE.Object3D): void {
    obj.updateMatrixWorld(true);
    parent.updateWorldMatrix(true, false);
    const inv = parent.matrixWorld.clone().invert();
    let byMat = this.batches.get(parent);
    if (!byMat) {
      byMat = new Map();
      this.batches.set(parent, byMat);
    }
    const loose: THREE.Object3D[] = [];
    obj.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        const mat = m.material as THREE.Material;
        const list = byMat.get(mat) ?? [];
        list.push(m.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld)));
        byMat.set(mat, list);
      } else if ((o as THREE.Line).isLine || (o as THREE.Points).isPoints) loose.push(o);
    });
    for (const o of loose) parent.attach(o);
  }

  private flushBatches(): void {
    for (const [parent, byMat] of this.batches) {
      for (const [mat, geos] of byMat) {
        const merged = mergeAll(geos);
        if (!merged) continue;
        const mesh = new THREE.Mesh(merged, mat);
        mesh.castShadow = !mat.userData.noShadow;
        mesh.receiveShadow = true;
        parent.add(mesh);
      }
    }
    this.batches.clear();
  }

  private makeDecor(d: DecorDef): THREE.Object3D | null {
    const k = this.kit;
    switch (d.type) {
      case 'car':
        return makeCar(d, k);
      case 'tubeMan': {
        const man = new TubeMan(d.color ?? 0xff3b30, { seed: d.x * 3.1 + d.z });
        man.group.position.set(d.x, d.y, d.z);
        man.group.scale.setScalar(d.scale ?? 1.6);
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
        const legMat = k.mat(0x8a93a8, 0.4, { metal: 0.5 });
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
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 4.4, 8), k.mat(0xe8ecf5, 0.4, { metal: 0.4 }));
        pole.position.set(d.x, d.y + 2.2, d.z);
        pole.castShadow = true;
        return pole;
      }
      case 'bunting':
        return makeBunting(d, k);
      case 'balloons':
        return this.makeBalloons(d);
      case 'cone': {
        const g = new THREE.Group();
        const cone = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.75, 14), k.mat(0xff7a1a, 0.5));
        cone.position.y = 0.4;
        const band = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 0.12, 14), k.mat(0xffffff, 1, { noShadow: true }));
        band.position.y = 0.45;
        cone.castShadow = true;
        g.add(cone, band);
        g.position.set(d.x, d.y, d.z);
        return g;
      }
      case 'tires': {
        const g = new THREE.Group();
        const mat = k.mat(0x2b2d3a, 0.8);
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
      case 'net': {
        // Goal net: a translucent mesh box with a colored rim, in the defending team's color.
        const g = new THREE.Group();
        const netMat = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.35 });
        const net = new THREE.Mesh(new THREE.BoxGeometry(4.4, 5, 11, 6, 7, 14), netMat);
        net.position.y = 2.5;
        const rimMat = new THREE.MeshStandardMaterial({ color: d.color ?? 0xffffff, roughness: 0.3, emissive: d.color ?? 0xffffff, emissiveIntensity: 0.25 });
        const back = Math.sign(d.x) * 2.3;
        for (const z of [-5.6, 5.6]) {
          const post = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 5.4, 12), rimMat);
          post.position.set(-back, 2.7, z);
          post.castShadow = true;
          g.add(post);
        }
        const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 11.6, 12), rimMat);
        bar.rotation.x = Math.PI / 2;
        bar.position.set(-back, 5.4, 0);
        g.add(net, bar);
        g.position.set(d.x, d.y, d.z);
        return g;
      }
      case 'umbrella': {
        const g = new THREE.Group();
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 3.4, 8), k.mat(0xf4f1ea, 1));
        pole.position.y = 1.7;
        const canopy = new THREE.Mesh(new THREE.ConeGeometry(2.4, 0.9, 12, 1, true), k.mat(d.color ?? 0xff6fa8, 0.5, { side: THREE.DoubleSide, flat: true }));
        canopy.position.y = 3.5;
        canopy.castShadow = true;
        g.add(pole, canopy);
        g.position.set(d.x, d.y, d.z);
        return g;
      }
      case 'ferrisWheel':
        return this.makeFerrisWheel(d);
      default: {
        const g = buildProp(k, d);
        if (!g) return null;
        g.position.set(d.x, d.y, d.z);
        g.rotation.y = d.rotY ?? 0;
        if (d.scale) g.scale.setScalar(d.scale);
        return g;
      }
    }
  }

  /** Ball fence, pump pads and the giant tube men for Pump. */
  private buildModeProps(): void {
    const f = this.map.ball?.fence;
    if (f) {
      const glass = new THREE.MeshStandardMaterial({ color: 0xcff3ff, transparent: true, opacity: 0.12, roughness: 0.1, side: THREE.DoubleSide, depthWrite: false });
      const rail = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });
      const panel = (x0: number, z0: number, x1: number, z1: number, y0: number, y1: number) => {
        const len = Math.hypot(x1 - x0, z1 - z0);
        if (len < 0.1) return;
        const m = new THREE.Mesh(new THREE.PlaneGeometry(len, y1 - y0), glass);
        m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
        m.rotation.y = Math.atan2(-(z1 - z0), x1 - x0);
        const top = new THREE.Mesh(new THREE.BoxGeometry(len, 0.2, 0.2), rail);
        top.position.set(m.position.x, y1, m.position.z);
        top.rotation.y = m.rotation.y;
        this.root.add(m, top);
        // Posts every few meters so it reads as a fence, not a wire.
        const n = Math.max(1, Math.round(len / 8));
        for (let i = 0; i <= n; i++) {
          const t = i / n;
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, y1 - y0, 0.18), rail);
          post.position.set(x0 + (x1 - x0) * t, (y0 + y1) / 2, z0 + (z1 - z0) * t);
          post.castShadow = true;
          this.root.add(post);
        }
      };
      const H = f.height;
      panel(f.minX, f.minZ, f.maxX, f.minZ, 1.1, H);
      panel(f.minX, f.maxZ, f.maxX, f.maxZ, 1.1, H);
      // End fences above the goal mouth and either side of it.
      const mouth = this.map.ball!.goals[0];
      for (const x of [f.minX, f.maxX]) {
        panel(x, f.minZ, x, mouth.min[2], 3, H);
        panel(x, mouth.max[2], x, f.maxZ, 3, H);
        panel(x, mouth.min[2], x, mouth.max[2], 6, H);
      }
    }
    for (const pump of this.map.pumps ?? []) {
      const g = new THREE.Group();
      const base = new THREE.Mesh(new THREE.CylinderGeometry(pump.r, pump.r * 1.05, 0.12, 36), new THREE.MeshStandardMaterial({ color: 0x3a3a48, roughness: 0.6 }));
      base.position.y = 0.06;
      base.receiveShadow = true;
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(pump.r - 0.15, 0.13, 8, 40),
        new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.4, roughness: 0.3 }),
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.14;
      const core = new THREE.Mesh(new THREE.CylinderGeometry(pump.r * 0.55, pump.r * 0.55, 0.05, 28), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.2, transparent: true, opacity: 0.8 }));
      core.position.y = 0.14;
      // A bicycle-style pump barrel at the edge with a plunger that bobs while pumping.
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 1.4, 14), new THREE.MeshStandardMaterial({ color: 0xe8ecf5, metalness: 0.4, roughness: 0.3 }));
      barrel.position.set(pump.r + 0.4, 0.7, 0);
      const plunger = new THREE.Group();
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.9, 8), new THREE.MeshStandardMaterial({ color: 0x9aa3b8, metalness: 0.6 }));
      rod.position.y = 0.45;
      const handle = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.8, 4, 8), new THREE.MeshStandardMaterial({ color: 0x2b2d42 }));
      handle.rotation.z = Math.PI / 2;
      handle.position.y = 0.9;
      plunger.add(rod, handle);
      plunger.position.set(pump.r + 0.4, 1.3, 0);
      barrel.castShadow = true;
      g.add(base, ring, core, barrel, plunger);
      g.position.set(pump.x, pump.y, pump.z);
      g.rotation.y = pump.x < 0 ? Math.PI : 0;
      this.root.add(g);
      this.pumpPads.push({ ring, core, team: pump.team, plunger });
    }
    for (const gdef of this.map.giants ?? []) {
      const man = new TubeMan(0xffffff, { seed: gdef.x });
      man.group.position.set(gdef.x, gdef.y, gdef.z);
      const pose = defaultPose();
      pose.yaw = Math.atan2(-gdef.x, 0) + Math.PI;
      this.root.add(man.group);
      this.giants.push({ man, pose, team: gdef.team, fill: 0, shown: 0 });
    }
    this.applyTeamColors();
  }

  /** Team colors for pumps and giants (standard or colorblind-friendly). */
  setTeamColors(colors: number[]): void {
    this.teamColors = colors;
    this.applyTeamColors();
  }

  private applyTeamColors(): void {
    for (const p of this.pumpPads) {
      const c = this.teamColors[p.team];
      (p.ring.material as THREE.MeshStandardMaterial).color.setHex(c);
      (p.ring.material as THREE.MeshStandardMaterial).emissive.setHex(c);
      (p.core.material as THREE.MeshStandardMaterial).color.setHex(c);
    }
    for (const g of this.giants) g.man.setColor(this.teamColors[g.team]);
  }

  /** Pump mode state: which pumps are working (1) or contested (2), and each giant's fill. */
  setPumpState(states: number[], fill: [number, number]): void {
    this.pumpPads.forEach((p, i) => {
      const st = states[i] ?? 0;
      const core = p.core.material as THREE.MeshStandardMaterial;
      core.emissiveIntensity = st === 1 ? 0.9 : st === 2 ? 0.5 : 0.15;
      core.emissive.setHex(st === 2 ? 0xffd60a : this.teamColors[p.team]);
      p.plunger.userData.active = st === 1;
    });
    for (const g of this.giants) g.fill = fill[g.team];
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

  /** A big ferris wheel on A-frame legs that turns slowly; its cars stay level. Faces +-z. */
  private makeFerrisWheel(d: DecorDef): THREE.Object3D {
    const g = new THREE.Group();
    const r = Number(d.data?.radius ?? 8);
    // High enough that the lowest car swings past above a standing player's head.
    const hubY = r + 4.5;
    const frameMat = new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.4, metalness: 0.2 });
    const legs: THREE.BufferGeometry[] = [];
    for (const z of [-1.1, 1.1]) {
      for (const side of [-1, 1]) {
        const x0 = side * r * 0.6;
        const leg = new THREE.CylinderGeometry(0.14, 0.22, Math.hypot(x0, hubY), 8);
        leg.rotateZ(Math.atan2(x0, hubY));
        leg.translate(x0 / 2, hubY / 2, z);
        legs.push(leg);
      }
    }
    const axle = new THREE.CylinderGeometry(0.22, 0.22, 2.6, 10);
    axle.rotateX(Math.PI / 2);
    axle.translate(0, hubY, 0);
    legs.push(axle);
    const stand = new THREE.Mesh(mergeGeometries(legs.map((l) => l.toNonIndexed()), false)!, frameMat);
    stand.castShadow = true;
    // The turning part: two rims joined by spokes, with light bulbs around the edge.
    const wheel = new THREE.Group();
    wheel.position.y = hubY;
    const frame: THREE.BufferGeometry[] = [];
    const bulbs: THREE.BufferGeometry[] = [];
    const spokes = 16;
    for (const z of [-0.7, 0.7]) {
      frame.push(new THREE.TorusGeometry(r, 0.14, 8, 64).translate(0, 0, z).toNonIndexed());
      frame.push(new THREE.TorusGeometry(r * 0.3, 0.1, 6, 24).translate(0, 0, z).toNonIndexed());
      for (let i = 0; i < spokes; i++) {
        frame.push(new THREE.BoxGeometry(0.09, r, 0.09).translate(0, r / 2, z).rotateZ((i / spokes) * Math.PI * 2).toNonIndexed());
        const a = ((i + 0.5) / spokes) * Math.PI * 2;
        bulbs.push(new THREE.SphereGeometry(0.16, 8, 6).translate(Math.cos(a) * r, Math.sin(a) * r, z * 1.25).toNonIndexed());
      }
    }
    frame.push(new THREE.CylinderGeometry(0.6, 0.6, 1.8, 14).rotateX(Math.PI / 2).toNonIndexed());
    const rim = new THREE.Mesh(mergeGeometries(frame, false)!, frameMat);
    rim.castShadow = true;
    const bulbMesh = new THREE.Mesh(mergeGeometries(bulbs, false)!, new THREE.MeshStandardMaterial({ color: 0xfff3b0, emissive: 0xffe066, emissiveIntensity: 0.8 }));
    wheel.add(rim, bulbMesh);
    // Cars hang from pins between the rims and swing level as the wheel turns.
    const cabinMats = [0xff6fa8, 0xffd60a, 0x6fd3ff, 0x9dff6f, 0xc49bff].map((color) => new THREE.MeshStandardMaterial({ color, roughness: 0.35 }));
    const cabinGeo = new RoundedBoxGeometry(1.3, 1.0, 1.1, 2, 0.22);
    // Roof and hanger in one mesh per car.
    const top = mergeGeometries([new THREE.CylinderGeometry(0.2, 0.85, 0.35, 10).translate(0, -0.35, 0).toNonIndexed(), new THREE.CylinderGeometry(0.05, 0.05, 0.4, 6).translate(0, -0.1, 0).toNonIndexed()], false)!;
    const topMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 });
    const cars: THREE.Object3D[] = [];
    const count = 10;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const car = new THREE.Group();
      car.position.set(Math.cos(a) * r, Math.sin(a) * r, 0);
      const cabin = new THREE.Mesh(cabinGeo, cabinMats[i % cabinMats.length]);
      cabin.position.y = -1.0;
      cabin.castShadow = true;
      car.add(cabin, new THREE.Mesh(top, topMat));
      wheel.add(car);
      cars.push(car);
    }
    g.add(stand, wheel);
    g.position.set(d.x, d.y, d.z);
    g.rotation.y = d.rotY ?? 0;
    this.wheels.push({ wheel, cars });
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
      const def = this.map.solids[id];
      if (!this.movers.some((m) => m.solidId === id)) {
        obj.position.y = s.minY - def.min[1];
        const w = def.max[0] - def.min[0];
        const d = def.max[2] - def.min[2];
        obj.scale.x = (s.maxX - s.minX) / w;
        obj.scale.z = (s.maxZ - s.minZ) / d;
        // A little wobble while sinking sells the collapse.
        obj.rotation.z = s.minY < def.min[1] - 0.05 ? Math.sin(this.time * 7 + id) * 0.02 : 0;
      }
      obj.visible = s.enabled;
    }
    if (this.fan && this.fanBlades) this.fanBlades.rotation.z += dt * 14;
    for (const t of this.tubeMen) {
      t.pose.time = time + t.man.group.position.x;
      t.pose.dt = dt;
      t.man.update(t.pose);
    }
    for (const p of this.pumpPads) {
      const on = p.plunger.userData.active === true;
      p.plunger.position.y = on ? 1.0 + Math.abs(Math.sin(this.time * 7)) * 0.45 : 1.3;
    }
    for (const g of this.giants) {
      // Giants grow from a limp heap to a towering, flailing tube man as their team pumps.
      g.shown += (g.fill - g.shown) * Math.min(1, dt * 3);
      g.man.group.scale.setScalar(1.2 + g.shown * 3.6);
      g.pose.time = time;
      g.pose.dt = dt;
      g.pose.inflation = Math.min(1, g.shown * 1.2);
      g.pose.launched = g.shown < 0.08; // limp and floppy when empty
      g.man.update(g.pose);
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
    for (const w of this.wheels) {
      w.wheel.rotation.z = time * 0.16;
      for (const c of w.cars) c.rotation.z = -w.wheel.rotation.z;
    }
    this.clouds.rotation.y += dt * 0.004;
    this.kit.update(dt, time);
    this.sky.update(dt, this.quality() === 'low');
  }

  /**
   * Shows (or with null hides) a red warning over part of the map that's about to fall away.
   * `key` is the solid id. `flash` (0..1) is the current blink brightness, shared by all warnings.
   */
  setWarning(key: number, w: WarnArea | null, flash = 1): void {
    let v = this.warnViews.get(key);
    for (const t of this.tints.get(key) ?? []) {
      // The whole piece pulses red (restored once the warning is over).
      if (w) {
        t.m.emissive.setHex(0xff2440);
        t.m.emissiveIntensity = 0.12 + 0.55 * flash;
      } else if (t.m.emissiveIntensity !== t.k || !t.m.emissive.equals(t.color)) {
        t.m.emissive.copy(t.color);
        t.m.emissiveIntensity = t.k;
      }
    }
    if (!w) {
      if (v) v.group.visible = false;
      return;
    }
    if (!v) {
      const group = new THREE.Group();
      const fills = [0, 1, 2, 3].map(() => new THREE.Mesh(this.warnPlane, this.warnFillMat));
      const lines = [0, 1, 2, 3].map(() => new THREE.Mesh(this.warnBar, this.warnLineMat));
      for (const m of [...fills, ...lines]) {
        m.renderOrder = 2;
        group.add(m);
      }
      this.root.add(group);
      v = { group, fills, lines };
      this.warnViews.set(key, v);
    }
    v.group.visible = true;
    this.warnFillMat.opacity = 0.2 + 0.4 * flash;
    this.warnLineMat.opacity = 0.45 + 0.55 * flash;
    const y = w.y + 0.04;
    // The red area is a ring: two full-width strips (north and south) and two between them.
    const strips: [number, number, number, number][] = [
      [w.minX, w.maxX, w.minZ, w.inMinZ],
      [w.minX, w.maxX, w.inMaxZ, w.maxZ],
      [w.minX, w.inMinX, w.inMinZ, w.inMaxZ],
      [w.inMaxX, w.maxX, w.inMinZ, w.inMaxZ],
    ];
    strips.forEach(([x0, x1, z0, z1], i) => {
      const m = v.fills[i];
      m.visible = x1 - x0 > 0.01 && z1 - z0 > 0.01;
      m.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
      m.scale.set(Math.max(0.01, x1 - x0), 1, Math.max(0.01, z1 - z0));
    });
    const [x0, x1, z0, z1] = w.innerLine ? [w.inMinX, w.inMaxX, w.inMinZ, w.inMaxZ] : [w.minX, w.maxX, w.minZ, w.maxZ];
    const t = 0.5;
    const bars: [number, number, number, number][] = [
      [(x0 + x1) / 2, z0, x1 - x0 + t, t],
      [(x0 + x1) / 2, z1, x1 - x0 + t, t],
      [x0, (z0 + z1) / 2, t, z1 - z0],
      [x1, (z0 + z1) / 2, t, z1 - z0],
    ];
    bars.forEach(([cx, cz, sx, sz], i) => {
      const m = v.lines[i];
      m.position.set(cx, y + 0.1, cz);
      m.scale.set(Math.max(0.01, sx), 0.22, Math.max(0.01, sz));
    });
  }

  /** Tints the decks icy (0..1) during the ice rink event. */
  setIce(k: number): void {
    for (const m of this.deckTops) {
      m.color.setRGB(1 - 0.28 * k, 1 - 0.08 * k, 1);
      m.roughness = 0.85 - 0.75 * k;
      m.metalness = 0.25 * k;
    }
  }

  /** Shows (or hides) a giant box fan blowing along (dirX, dirZ). */
  setFan(on: boolean, dirX = 1, dirZ = 0): void {
    if (!on) {
      if (this.fan) this.root.remove(this.fan);
      this.fan = null;
      this.fanBlades = null;
      return;
    }
    if (this.fan) return;
    const g = new THREE.Group();
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x3d6bff, roughness: 0.35 });
    const grillMat = new THREE.MeshStandardMaterial({ color: 0xe8ecf5, metalness: 0.6, roughness: 0.3 });
    const frame = new THREE.Mesh(new THREE.TorusGeometry(9, 1.2, 12, 40), frameMat);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 1.2, 20), grillMat);
    hub.rotation.x = Math.PI / 2;
    const blades = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(1.8, 7.5, 0.3), new THREE.MeshStandardMaterial({ color: 0xffd60a, roughness: 0.4 }));
      b.position.y = 4.2;
      const holder = new THREE.Group();
      holder.rotation.z = (i / 4) * Math.PI * 2;
      b.rotation.y = 0.4;
      holder.add(b);
      blades.add(holder);
    }
    const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.6, 16, 12), frameMat);
    stand.position.y = -12;
    g.add(frame, hub, blades, stand);
    g.traverse((o) => ((o as THREE.Mesh).castShadow = true));
    // Stand upwind, facing where the wind goes.
    g.position.set(-dirX * 40, 8, -dirZ * 40);
    g.lookAt(new THREE.Vector3(0, 8, 0));
    this.root.add(g);
    this.fan = g;
    this.fanBlades = blades;
  }

  dispose(): void {
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
      }
    });
    for (const t of this.tubeMen) t.man.dispose();
    for (const g of this.giants) g.man.dispose();
    this.sky.dispose();
    this.kit.dispose();
  }
}

function makeCar(d: DecorDef, k: PropKit): THREE.Object3D {
  const g = new THREE.Group();
  const color = d.color ?? 0xd98c8c;
  const paint = k.mat(color, 0.35, { metal: 0.15 });
  const glass = k.mat(0x2c3550, 0.1, { metal: 0.3 });
  const tire = k.mat(0x23242e, 0.8);
  const hub = k.mat(0xd0d6e4, 0.3, { metal: 0.6 });
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
  const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.4), k.mat(0xffffff, 1, { map: k.text('$$$', '#ffd60a', '#ff3b8a', 128, 64), noShadow: true }));
  tag.position.set(0, 1.3, 1.02);
  tag.rotation.x = -0.35;
  g.add(tag);
  g.position.set(d.x, d.y, d.z);
  g.rotation.y = d.rotY ?? 0;
  return g;
}

function makeBunting(d: DecorDef, k: PropKit): THREE.Object3D {
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
      const f = new THREE.Mesh(flagGeo, k.mat(colors[i % colors.length], 0.6, { side: THREE.DoubleSide }));
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
