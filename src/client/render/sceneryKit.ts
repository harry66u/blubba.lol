import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { BlastZone } from '../../shared/maps/types';

// Shared bits for the client-only scenery around the maps (sky life, branding, sky shows): brand
// colors, seeded randomness, vertex painting for merged meshes, and the BLUBBA logo on a canvas.

export const TAU = Math.PI * 2;
export const INK = 0x1d1b3a;
export const PINK = 0xff3b8a;
export const YELLOW = 0xffd60a;
export const BLUE = 0x2ec5ff;
export const GREEN = 0x5ee05e;
export const PURPLE = 0x8a4dff;
export const ORANGE = 0xff8a1f;
export const RED = 0xff3b5c;
export const WHITE = 0xffffff;
/** The logo's letter colors, B-L-U-B-B-A. */
export const LOGO_COLORS = ['#ffd60a', '#ff3b8a', '#2ec5ff', '#5ee05e', '#ffd60a', '#ff3b8a'];
export const INK_CSS = '#1d1b3a';
/** The logo's typeface (self-hosted), then the rounded fallbacks the page uses until it loads. */
export const FONT = 'Fredoka, "Arial Rounded MT Bold", "Arial Rounded MT", Arial, sans-serif';

/** Small seeded PRNG (mulberry32) so a map gets the same scenery every visit. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function hash(n: number): number {
  const s = Math.sin(n * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

export type Paint = number | ((x: number, y: number, z: number) => number);

/**
 * Non-indexed copy of `geo` with vertex colors (one color, or one per triangle picked from its
 * center) so many parts can be merged into a single draw call. `flat` gives faceted normals;
 * `vary` jitters each triangle's brightness a little for a hand-made look. `uv` keeps the texture
 * coordinates (a pair pins every vertex to that one spot of the texture instead).
 */
export function paint(geo: THREE.BufferGeometry, color: Paint, flat = false, vary = 0, uv?: true | [number, number]): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && !(uv === true && name === 'uv')) g.deleteAttribute(name);
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
  if (Array.isArray(uv)) {
    const uvs = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) uvs.set(uv, i * 2);
    g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  }
  return g;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
export const UP = new THREE.Vector3(0, 1, 0);

/** Moves, turns (XYZ euler) and scales a geometry in place. */
export function place(g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx): THREE.BufferGeometry {
  _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));
  return g.applyMatrix4(_m);
}

/** An open tube from a to b (ropes, struts, trunk segments). */
export function rod(a: THREE.Vector3, b: THREE.Vector3, r0: number, r1 = r0, sides = 5): THREE.BufferGeometry {
  const dir = b.clone().sub(a);
  const g = new THREE.CylinderGeometry(r1, r0, dir.length(), sides, 1, true);
  _m.compose(a.clone().add(b).multiplyScalar(0.5), _q.setFromUnitVectors(UP, dir.normalize()), _s.set(1, 1, 1));
  return g.applyMatrix4(_m);
}

export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  return g;
}

/**
 * How far from the map's center (the origin) a heading `a` (x = cos a, z = sin a) meets the blast
 * zone's edge pushed out by `margin`. Things placed there are just out of reach of anyone alive.
 */
export function edgeDistance(b: BlastZone, a: number, margin: number): number {
  const c = Math.cos(a);
  const s = Math.sin(a);
  let t = Infinity;
  if (c > 1e-6) t = Math.min(t, (b.maxX + margin) / c);
  else if (c < -1e-6) t = Math.min(t, (b.minX - margin) / c);
  if (s > 1e-6) t = Math.min(t, (b.maxZ + margin) / s);
  else if (s < -1e-6) t = Math.min(t, (b.minZ - margin) / s);
  return t;
}

/** Turn (rotation.y) that points an object's local +z from heading `a` back at the map's center. */
export function faceCenter(a: number): number {
  return Math.atan2(-Math.cos(a), -Math.sin(a));
}

export function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

export function canvasTexture(c: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/**
 * Calls `redraw` once the logo typeface has loaded, if it hadn't when the textures were first
 * painted (they're drawn with the fallback font meanwhile).
 */
export function onFontReady(redraw: () => void): void {
  const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
  if (!fonts) return;
  const spec = `700 40px ${FONT}`;
  try {
    if (fonts.check(spec)) return;
    fonts.load(spec).then(() => redraw(), () => undefined);
  } catch {
    // Old browsers: keep the fallback font.
  }
}

/** Fits `text` into `maxW` pixels at up to `size` px: the scale to squeeze it by (1 = fits). */
export function fitScale(g: CanvasRenderingContext2D, text: string, maxW: number): number {
  return Math.min(1, maxW / Math.max(1, g.measureText(text).width));
}

/**
 * Draws a word in the logo's style centered on (cx, cy): chunky rounded letters in the logo
 * colors, a thick ink outline and an extruded ink edge underneath, each letter bobbing a little.
 * `size` is the letter height in pixels; the word is squeezed to fit `maxW`.
 */
export function drawLogo(g: CanvasRenderingContext2D, text: string, cx: number, cy: number, size: number, maxW: number, colors = LOGO_COLORS, bob = true): void {
  g.save();
  g.font = `700 ${Math.round(size)}px ${FONT}`;
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  const gap = size * 0.03;
  const chars = [...text];
  const widths = chars.map((ch) => g.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0) + gap * (chars.length - 1);
  const k = Math.min(1, maxW / total);
  g.translate(cx, cy);
  g.scale(k, k);
  const depth = size * 0.09;
  let x = -total / 2;
  chars.forEach((ch, i) => {
    const dy = bob ? Math.sin(i * 1.9 + 0.6) * size * 0.05 : 0;
    const tilt = bob ? Math.sin(i * 2.7 + 1.1) * 0.05 : 0;
    g.save();
    g.translate(x + widths[i] / 2, dy);
    g.rotate(tilt);
    g.strokeStyle = INK_CSS;
    g.fillStyle = INK_CSS;
    g.lineWidth = size * 0.16;
    // Extruded edge: the outline stamped a few times straight down.
    for (let d = depth; d > 0; d -= depth / 3) {
      g.strokeText(ch, -widths[i] / 2, d);
      g.fillText(ch, -widths[i] / 2, d);
    }
    g.strokeText(ch, -widths[i] / 2, 0);
    g.fillStyle = colors[i % colors.length];
    g.fillText(ch, -widths[i] / 2, 0);
    g.restore();
    x += widths[i] + gap;
  });
  g.restore();
}

export function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
