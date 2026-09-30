import * as THREE from 'three';
import type { MapDef } from '../../shared/maps/types';
import type { World } from '../../shared/world';
import {
  BLUE,
  FONT,
  GREEN,
  INK,
  INK_CSS,
  LOGO_COLORS,
  PINK,
  TAU,
  WHITE,
  YELLOW,
  canvasTexture,
  drawLogo,
  edgeDistance,
  faceCenter,
  fitScale,
  makeCanvas,
  merge,
  onFontReady,
  paint,
  place,
  rod,
  roundRect,
} from './sceneryKit';

// Branding around every map: a ring of billboards (BLUBBA.LOL, the logo, and ads for the four
// characters) on little floating rocks just past the blast zone, a big glowing BLUBBA sign where
// the spawns look, a BLUBBA.LOL sign across from it, banners and bunting on the sides of the main
// deck, and brand-colored flags. Everything is placed from the map's blast zone, spawns and main
// deck (no per-map placement), so new maps get it for free. Built cheap: one canvas atlas for all
// the ads and a few merged meshes (five draw calls; four on Low, which drops the waving flags).

/** How far past the blast zone's edge the billboards and the signs stand. */
const BOARD_MARGIN = 16;
const SIGN_MARGIN = 22;
/** Billboard face (the same shape as an atlas cell, 512 x 192). */
const BOARD_W = 24;
const BOARD_H = 9;
/** Billboard headings either side of the big sign (the BLUBBA.LOL sign is straight across). */
const BOARD_ANGLES = [24, 56, 88, 120, 152].flatMap((d) => [d, -d]).map((d) => (d * Math.PI) / 180);
/** A spawn "sees" something within this angle of where it faces (about a first-person view). */
const VIEW_COS = Math.cos((38 * Math.PI) / 180);

export interface BrandLayout {
  /** Heading of the big BLUBBA sign (x = cos, z = sin): where the most spawns look. */
  sign: number;
  /** Heading of the BLUBBA.LOL sign, straight across (what the rest of the spawns look at). */
  sign2: number;
  /** Billboard headings, in the order of AD_ORDER. */
  boards: number[];
  /** Height of the main deck's top; everything stands relative to it. */
  baseY: number;
  /** The main deck's index in map.solids (-1 when the map has none). */
  deck: number;
}

/** The biggest floor that doesn't move (the one the banners go around). */
export function mainDeck(map: MapDef): number {
  let best = -1;
  let area = 0;
  map.solids.forEach((s, i) => {
    if (s.mover || !(s.kind === 'lot' || s.kind === 'island' || s.kind === 'bouncy')) return;
    const a = (s.max[0] - s.min[0]) * (s.max[2] - s.min[2]);
    if (a > area) {
      area = a;
      best = i;
    }
  });
  return best;
}

/**
 * Where the signs and billboards go on a map. Players spawn facing the average spawn point, so
 * the big sign goes at the heading the most spawns see as they appear (the middle of the best
 * run of headings); the rest see the BLUBBA.LOL sign across the map.
 */
export function brandLayout(map: MapDef): BrandLayout {
  const deck = mainDeck(map);
  const baseY = deck >= 0 ? map.solids[deck].max[1] : 0;
  const n = map.spawns.length;
  const hx = n ? map.spawns.reduce((a, s) => a + s[0], 0) / n : 0;
  const hz = n ? map.spawns.reduce((a, s) => a + s[2], 0) / n : 0;
  const spots = [...map.spawns, ...(map.teamSpawns?.flat() ?? [])].filter((s) => Math.hypot(hx - s[0], hz - s[2]) > 2);
  const STEPS = 72;
  const scores: number[] = [];
  for (let k = 0; k < STEPS; k++) {
    const a = (k / STEPS) * TAU;
    const d = edgeDistance(map.blast, a, SIGN_MARGIN);
    const px = Math.cos(a) * d;
    const pz = Math.sin(a) * d;
    let score = 0;
    for (const s of spots) {
      const fx = hx - s[0];
      const fz = hz - s[2];
      const tx = px - s[0];
      const tz = pz - s[2];
      if ((fx * tx + fz * tz) / (Math.hypot(fx, fz) * Math.hypot(tx, tz)) > VIEW_COS) score++;
    }
    scores.push(score);
  }
  // Longest run (around the circle) of the best score; the sign goes in its middle.
  const top = Math.max(...scores);
  let bestStart = -1;
  let bestLen = 0;
  for (let k = 0; k < STEPS; k++) {
    if (scores[k] !== top || scores[(k + STEPS - 1) % STEPS] === top) continue;
    let len = 0;
    while (len < STEPS && scores[(k + len) % STEPS] === top) len++;
    if (len > bestLen) {
      bestLen = len;
      bestStart = k;
    }
  }
  // Every heading scores the same (no spawns): face north.
  const sign = bestStart < 0 ? -Math.PI / 2 : ((bestStart + (bestLen - 1) / 2) / STEPS) * TAU;
  return { sign, sign2: sign + Math.PI, boards: BOARD_ANGLES.map((d) => sign + d), baseY, deck };
}

// --- The ad atlas ----------------------------------------------------------------------------
// 1024 x 1024: ten 512 x 192 ad cells, then the deck banner strip and a row of flat color swatches
// (plain parts point every vertex at one swatch, so they share the ads' material and draw call).

const ATLAS = 1024;
const CELL_W = 512;
const CELL_H = 192;
const STRIP_Y = 960;
const STRIP_H = 56;
/** The strip repeats its slogan this many times, so a banner can end on any repeat. */
const STRIP_REPEATS = 3;
const SWATCH_Y = 1016;
const SWATCHES = ['#ffd60a', '#ff3b8a', '#2ec5ff', '#5ee05e', '#ffffff', INK_CSS];

type Ad = 'bor' | 'abag' | 'sol' | 'kesty' | 'jo' | 'baen' | 'inflated' | 'freeAir' | 'logo' | 'lol';
/** Billboards, in the order of BOARD_ANGLES: the characters flank the big sign. */
const AD_ORDER: Ad[] = ['bor', 'kesty', 'abag', 'sol', 'jo', 'baen', 'inflated', 'freeAir', 'logo', 'lol'];

function cellOf(i: number): [number, number] {
  return [(i % 2) * CELL_W, Math.floor(i / 2) * CELL_H];
}

/** UV of the middle of a flat color swatch (0 yellow, 1 pink, 2 blue, 3 green, 4 white, 5 ink). */
function swatch(i: number): [number, number] {
  return [(i + 0.5) / SWATCHES.length, 1 - (SWATCH_Y + 4) / ATLAS];
}

/** Maps a geometry's 0..1 UVs onto a pixel rectangle of the atlas. */
function toRegion(g: THREE.BufferGeometry, x: number, y: number, w: number, h: number): THREE.BufferGeometry {
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (x + uv.getX(i) * w) / ATLAS, 1 - (y + (1 - uv.getY(i)) * h) / ATLAS);
  return g;
}

function label(
  g: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  maxW: number,
  fill: string,
  opts: { stroke?: string; font?: string; align?: CanvasTextAlign; weight?: number } = {},
): void {
  g.save();
  g.font = `${opts.weight ?? 700} ${Math.round(size)}px ${opts.font ?? FONT}`;
  g.textAlign = opts.align ?? 'center';
  g.textBaseline = 'middle';
  const k = fitScale(g, text, maxW);
  g.translate(x, y);
  g.scale(k, 1);
  if (opts.stroke) {
    g.lineJoin = 'round';
    // Thin enough that the holes in letters like B stay open.
    g.lineWidth = size * 0.1;
    g.strokeStyle = opts.stroke;
    g.strokeText(text, 0, 0);
  }
  g.fillStyle = fill;
  g.fillText(text, 0, 0);
  g.restore();
}

function cellFrame(g: CanvasRenderingContext2D, fill: string | CanvasGradient): void {
  g.fillStyle = INK_CSS;
  g.fillRect(0, 0, CELL_W, CELL_H);
  roundRect(g, 8, 8, CELL_W - 16, CELL_H - 16, 18);
  g.fillStyle = fill;
  g.fill();
}

function inked(g: CanvasRenderingContext2D, fill: string, width = 5): void {
  g.fillStyle = fill;
  g.fill();
  g.lineWidth = width;
  g.strokeStyle = INK_CSS;
  g.lineJoin = 'round';
  g.stroke();
}

function circle(g: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
}

/** Two cartoon eyes looking toward (lx, ly) (a nudge in pixels). */
function eyes(g: CanvasRenderingContext2D, x: number, y: number, gap: number, r: number, lx = 0, ly = 0): void {
  for (const s of [-1, 1]) {
    circle(g, x + s * gap, y, r);
    inked(g, '#ffffff', 3);
    circle(g, x + s * gap + lx, y + ly, r * 0.5);
    g.fillStyle = INK_CSS;
    g.fill();
  }
}

/** A thick limb: an ink outline with the color inside. */
function limb(g: CanvasRenderingContext2D, pts: [number, number][], width: number, color: string): void {
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (const [w, c] of [
    [width + 9, INK_CSS],
    [width, color],
  ] as const) {
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (const p of pts.slice(1)) g.lineTo(p[0], p[1]);
    g.lineWidth = w;
    g.strokeStyle = c;
    g.stroke();
  }
}

/** A tube man's body outline (rounded top), for filling and clipping. */
function tube(g: CanvasRenderingContext2D, x: number, top: number, bottom: number, w: number): void {
  roundRect(g, x - w / 2, top, w, bottom - top + 30, w / 2);
}

/** The regulars' real photos (the same ones their ults use), loaded once for every map's billboards. */
const PHOTO_ADS = ['bor', 'abag', 'sol', 'kesty', 'jo', 'baen'] as const;

/** The pride flag's six stripes (BÆN's billboard). */
const RAINBOW_CSS = ['#e40303', '#ff8c00', '#ffed00', '#008026', '#24408e', '#732982'];
const posterPhotos = new Map<Ad, HTMLImageElement>();
const photoWaiters = new Set<() => void>();
let photosRequested = false;

function loadPosterPhotos(onLoad: () => void): void {
  photoWaiters.add(onLoad);
  if (photosRequested || typeof Image === 'undefined') return;
  photosRequested = true;
  for (const ad of PHOTO_ADS) {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      posterPhotos.set(ad, img);
      for (const fn of photoWaiters) fn();
    };
    img.src = `/characters/${ad}.webp`;
  }
}

/** The regular's face in a framed oval on the left of their billboard, with a colored ring. */
function portrait(g: CanvasRenderingContext2D, img: HTMLImageElement, ring: string, cx = 122, cy = 96): void {
  const rx = 78;
  const ry = 84;
  g.save();
  g.beginPath();
  g.ellipse(cx, cy, rx + 10, ry + 10, 0, 0, TAU);
  g.fillStyle = INK_CSS;
  g.fill();
  g.beginPath();
  g.ellipse(cx, cy, rx + 6, ry + 6, 0, 0, TAU);
  g.fillStyle = ring;
  g.fill();
  g.beginPath();
  g.ellipse(cx, cy, rx, ry, 0, 0, TAU);
  g.fillStyle = '#f4ece6';
  g.fill();
  g.clip();
  // The photos are a feathered oval of the face; crop in a little so it fills the frame.
  const w = rx * 2 * 1.22;
  const h = ry * 2 * 1.22;
  g.drawImage(img, cx - w / 2, cy - h / 2, w, h);
  g.restore();
}

function paintAd(g: CanvasRenderingContext2D, ad: Ad): void {
  const W = CELL_W;
  const H = CELL_H;
  const textX = 350;
  const textW = 300;
  const photo = posterPhotos.get(ad);
  // Jo and BÆN only have photo billboards: until the photo arrives, the same board without it.
  if (photo || ad === 'jo' || ad === 'baen') {
    // A real photo of the regular instead of the cartoon, on the same background and slogan.
    const look: Record<string, { bg: string | [string, string] | 'rainbow'; ring: string; lines: [string, number, number, string, { stroke?: string; font?: string }][] }> = {
      jo: { bg: ['#ff5a1f', '#b3200e'], ring: '#ffd60a', lines: [["JO'S BURGERS", 64, 58, '#ffd60a', { stroke: INK_CSS }], ['BURGER READY.', 124, 40, '#ffffff', { stroke: INK_CSS }], ['HOT FROM THE SKY', 166, 20, '#ffe7a8', {}]] },
      baen: { bg: 'rainbow', ring: '#ffffff', lines: [['BÆN IS GAY', 72, 70, '#ffffff', { stroke: INK_CSS }], ['LOVE WINS.', 136, 44, '#ffffff', { stroke: INK_CSS }]] },
      bor: { bg: ['#2d2960', '#16142e'], ring: '#ff8a1f', lines: [["BOR'S GYM", 76, 68, '#ffd60a', { stroke: INK_CSS }], ['GET PUMPED.', 140, 40, '#ff3b8a', { stroke: INK_CSS }]] },
      abag: { bg: '#ffd60a', ring: '#ff5fd2', lines: [["ABAG'S", 58, 58, INK_CSS, {}], ['CHASE CLUB', 112, 50, '#ff3b8a', { stroke: INK_CSS }], ['RUN.', 160, 30, INK_CSS, {}]] },
      sol: { bg: '#121216', ring: '#8ee000', lines: [['SOL x AMIRI', 80, 58, '#f4f1ea', { font: 'Georgia, "Times New Roman", serif' }], ['SMELL THE WIN', 140, 36, '#9dff6f', {}]] },
      kesty: { bg: ['#5b6a8a', '#2f3650'], ring: '#ff3b5c', lines: [['KESTY', 66, 72, '#2ec5ff', { stroke: INK_CSS }], ['ROBOTICS', 122, 46, '#ffffff', { stroke: INK_CSS }], ['BEEP BOOP. YOU POPPED.', 164, 20, '#e8fbff', {}]] },
    };
    const L = look[ad];
    if (L) {
      let fill: string | CanvasGradient;
      if (L.bg === 'rainbow') {
        // Six hard stripes, top to bottom.
        fill = g.createLinearGradient(0, 8, 0, H - 8);
        RAINBOW_CSS.forEach((c, i) => {
          (fill as CanvasGradient).addColorStop(i / 6, c);
          (fill as CanvasGradient).addColorStop((i + 1) / 6 - 0.001, c);
        });
      } else if (typeof L.bg === 'string') fill = L.bg;
      else {
        fill = g.createLinearGradient(0, 0, 0, H);
        fill.addColorStop(0, L.bg[0]);
        fill.addColorStop(1, L.bg[1]);
      }
      cellFrame(g, fill);
      if (photo) portrait(g, photo, L.ring);
      for (const [text, y, size, color, o] of L.lines) label(g, text, textX, y, size, text.length > 14 ? textW : textW - 20, color, o);
      return;
    }
  }
  if (ad === 'bor') {
    // BOR'S GYM: jacked BOR in his checkered shirt, flexing, with his syringe full of AIR.
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#2d2960');
    bg.addColorStop(1, '#16142e');
    cellFrame(g, bg);
    const skin = '#ff5a5f';
    limb(g, [[92, 118], [46, 112], [42, 60]], 24, skin);
    limb(g, [[148, 118], [194, 112], [198, 60]], 24, skin);
    for (const x of [58, 182]) {
      circle(g, x, 100, 20);
      inked(g, skin);
    }
    g.save();
    tube(g, 120, 40, H - 8, 74);
    g.clip();
    g.fillStyle = skin;
    g.fillRect(0, 0, W, H);
    for (let y = 104; y < H; y += 14) for (let x = 60; x < 190; x += 14) if (((x - 60) / 14 + (y - 104) / 14) % 2 === 0) g.fillRect(x, y, 14, 14);
    g.fillStyle = '#ffffff';
    for (let y = 104; y < H; y += 14) for (let x = 60; x < 190; x += 14) if (((x - 60) / 14 + (y - 104) / 14) % 2 === 1) g.fillRect(x, y, 14, 14);
    g.fillStyle = INK_CSS;
    for (let y = 104; y < H; y += 14) for (let x = 60; x < 190; x += 14) if (((x - 60) / 14 + (y - 104) / 14) % 2 === 0) g.fillRect(x, y, 14, 14);
    g.restore();
    tube(g, 120, 40, H - 8, 74);
    g.lineWidth = 5;
    g.strokeStyle = INK_CSS;
    g.stroke();
    eyes(g, 120, 66, 14, 10, 2, 1);
    g.beginPath();
    g.arc(120, 80, 12, 0.15 * Math.PI, 0.85 * Math.PI);
    g.lineWidth = 4;
    g.stroke();
    // The syringe, held up like a trophy.
    g.save();
    g.translate(200, 50);
    g.rotate(-0.5);
    roundRect(g, -8, -44, 16, 12, 3);
    inked(g, '#c9d2e8', 3);
    roundRect(g, -16, -32, 32, 70, 8);
    inked(g, '#e8f7ff', 4);
    g.fillStyle = '#2ec5ff';
    g.fillRect(-11, -6, 22, 36);
    label(g, 'AIR', 0, 12, 16, 22, '#ffffff', { weight: 700 });
    g.beginPath();
    g.moveTo(0, 38);
    g.lineTo(0, 66);
    g.lineWidth = 4;
    g.strokeStyle = '#c9d2e8';
    g.stroke();
    g.restore();
    label(g, "BOR'S GYM", textX, 76, 68, textW, '#ffd60a', { stroke: INK_CSS });
    label(g, 'GET PUMPED.', textX, 140, 40, textW - 20, '#ff3b8a', { stroke: INK_CSS });
  } else if (ad === 'abag') {
    // ABAG'S CHASE CLUB: that nose, coming for you.
    cellFrame(g, '#ffd60a');
    g.lineCap = 'round';
    g.strokeStyle = INK_CSS;
    g.lineWidth = 6;
    for (const [y, x0] of [
      [70, 22],
      [104, 12],
      [138, 26],
    ]) {
      g.beginPath();
      g.moveTo(x0, y);
      g.lineTo(x0 + 34, y);
      g.stroke();
    }
    tube(g, 110, 30, H - 8, 84);
    inked(g, '#2ec5ff');
    eyes(g, 112, 66, 17, 12, 5, 0);
    // The nose: huge, and sniffing.
    g.beginPath();
    g.ellipse(160, 104, 46, 26, -0.12, 0, TAU);
    inked(g, '#ffb3a7', 5);
    circle(g, 188, 112, 5);
    g.fillStyle = INK_CSS;
    g.fill();
    circle(g, 170, 116, 5);
    g.fill();
    label(g, "ABAG'S", textX + 10, 58, 58, textW - 20, INK_CSS);
    label(g, 'CHASE CLUB', textX + 10, 112, 50, textW - 10, '#ff3b8a', { stroke: INK_CSS });
    label(g, 'RUN.', textX + 10, 160, 30, textW, INK_CSS);
  } else if (ad === 'sol') {
    // SOL x AMIRI: black sweats, and a trail of green.
    cellFrame(g, '#121216');
    for (const [x, y, r] of [
      [40, 150, 22],
      [66, 128, 17],
      [30, 118, 14],
      [58, 160, 15],
    ]) {
      circle(g, x, y, r);
      inked(g, '#9dff6f', 4);
    }
    tube(g, 128, 30, H - 8, 78);
    g.save();
    g.clip();
    g.fillStyle = '#8a4dff';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#26262d';
    g.fillRect(0, 96, W, H);
    g.fillStyle = '#1b1b20';
    g.fillRect(0, 150, W, H);
    g.restore();
    tube(g, 128, 30, H - 8, 78);
    g.lineWidth = 5;
    g.strokeStyle = '#f4f1ea';
    g.stroke();
    eyes(g, 128, 62, 15, 11, -3, 0);
    label(g, 'AMIRI', 128, 122, 17, 60, '#f4f1ea', { font: 'Georgia, "Times New Roman", serif' });
    label(g, 'SOL x AMIRI', textX, 80, 58, textW, '#f4f1ea', { font: 'Georgia, "Times New Roman", serif' });
    label(g, 'SMELL THE WIN', textX, 140, 36, textW - 20, '#9dff6f');
  } else if (ad === 'kesty') {
    // KESTY ROBOTICS: a robot, obviously.
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#5b6a8a');
    bg.addColorStop(1, '#2f3650');
    cellFrame(g, bg);
    g.strokeStyle = 'rgba(255,255,255,0.08)';
    g.lineWidth = 2;
    for (let x = 20; x < W; x += 24) {
      g.beginPath();
      g.moveTo(x, 10);
      g.lineTo(x, H - 10);
      g.stroke();
    }
    g.beginPath();
    g.moveTo(120, 34);
    g.lineTo(120, 16);
    g.lineWidth = 5;
    g.strokeStyle = INK_CSS;
    g.stroke();
    circle(g, 120, 16, 9);
    inked(g, '#ff3b5c', 4);
    roundRect(g, 64, 34, 112, 86, 20);
    inked(g, '#c9d2e8');
    roundRect(g, 76, 60, 88, 26, 12);
    inked(g, '#2ec5ff', 4);
    g.fillStyle = '#e8fbff';
    g.fillRect(90, 66, 30, 6);
    for (const x of [70, 170]) {
      circle(g, x, 104, 5);
      g.fillStyle = INK_CSS;
      g.fill();
    }
    roundRect(g, 80, 124, 80, 70, 14);
    inked(g, '#aab4cc');
    ['#ff3b5c', '#ffd60a', '#5ee05e'].forEach((c, i) => {
      circle(g, 100 + i * 20, 150, 7);
      inked(g, c, 3);
    });
    label(g, 'KESTY', textX, 66, 72, textW, '#2ec5ff', { stroke: INK_CSS });
    label(g, 'ROBOTICS', textX, 122, 46, textW - 20, '#ffffff', { stroke: INK_CSS });
    label(g, 'BEEP BOOP. YOU POPPED.', textX, 164, 20, textW, '#e8fbff');
  } else if (ad === 'inflated') {
    // STAY INFLATED!: the logo's flailing mascot.
    cellFrame(g, '#ff3b8a');
    limb(g, [[80, 110], [44, 80], [34, 40]], 18, '#ff3b5c');
    limb(g, [[112, 104], [146, 70], [170, 44]], 18, '#ff3b5c');
    tube(g, 96, 38, H - 30, 52);
    inked(g, '#ff3b5c');
    eyes(g, 96, 64, 10, 8, 2, -2);
    roundRect(g, 64, H - 34, 64, 22, 8);
    inked(g, '#2ec5ff', 4);
    label(g, 'STAY', textX - 10, 58, 60, textW, '#ffffff', { stroke: INK_CSS });
    label(g, 'INFLATED!', textX - 10, 118, 64, textW + 10, '#ffd60a', { stroke: INK_CSS });
    label(g, 'BLUBBA.LOL', textX - 10, 164, 24, textW, '#ffffff');
  } else if (ad === 'freeAir') {
    // FREE AIR: a blower fan with the asterisk joke.
    cellFrame(g, '#5ee05e');
    circle(g, 100, 96, 62);
    inked(g, '#ffffff');
    for (let k = 0; k < 4; k++) {
      g.save();
      g.translate(100, 96);
      g.rotate((k / 4) * TAU + 0.4);
      g.beginPath();
      g.ellipse(0, -26, 13, 24, 0.3, 0, TAU);
      inked(g, '#2ec5ff', 4);
      g.restore();
    }
    circle(g, 100, 96, 10);
    inked(g, '#ffd60a', 4);
    label(g, 'FREE AIR', textX, 70, 72, textW, '#ffffff', { stroke: INK_CSS });
    label(g, 'TODAY*', textX, 128, 44, textW, INK_CSS);
    label(g, '*AND EVERY DAY AT BLUBBA.LOL', textX, 166, 18, textW, INK_CSS);
  } else if (ad === 'logo') {
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#4a9ff5');
    bg.addColorStop(1, '#2ec5ff');
    cellFrame(g, bg);
    drawLogo(g, 'BLUBBA', W / 2, 80, 104, W - 60);
    roundRect(g, 70, 136, W - 140, 38, 19);
    inked(g, '#ff3b8a', 4);
    label(g, 'PLAY FREE AT BLUBBA.LOL', W / 2, 156, 24, W - 170, '#ffffff');
  } else {
    cellFrame(g, '#ffd60a');
    drawLogo(g, 'BLUBBA.LOL', W / 2, 78, 92, W - 50, [...LOGO_COLORS, '#ffffff', '#ffffff', '#ffffff', '#ffffff']);
    label(g, 'BLAST YOUR FRIENDS OFF THE MAP!', W / 2, 150, 28, W - 60, INK_CSS);
  }
}

function paintAtlas(c: HTMLCanvasElement): void {
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, ATLAS, ATLAS);
  AD_ORDER.forEach((ad, i) => {
    const [x, y] = cellOf(i);
    g.save();
    g.translate(x, y);
    g.beginPath();
    g.rect(0, 0, CELL_W, CELL_H);
    g.clip();
    paintAd(g, ad);
    g.restore();
  });
  // Deck banner strip: BLUBBA.LOL in the logo colors on ink, with stars between.
  g.fillStyle = INK_CSS;
  g.fillRect(0, STRIP_Y, ATLAS, STRIP_H);
  const rep = ATLAS / STRIP_REPEATS;
  for (let i = 0; i < STRIP_REPEATS; i++) {
    drawLogo(g, 'BLUBBA.LOL', i * rep + rep / 2, STRIP_Y + STRIP_H / 2 - 2, 40, rep - 70, [...LOGO_COLORS, '#ffffff', '#ffffff', '#ffffff', '#ffffff'], false);
    label(g, '★', i * rep + 8, STRIP_Y + STRIP_H / 2, 26, 30, '#ffd60a');
  }
  SWATCHES.forEach((s, i) => {
    g.fillStyle = s;
    g.fillRect(Math.floor((i * ATLAS) / SWATCHES.length), SWATCH_Y, Math.ceil(ATLAS / SWATCHES.length) + 1, ATLAS - SWATCH_Y);
  });
}

// --- The glowing signs -------------------------------------------------------------------------
// One transparent 1024 x 512 texture: the BLUBBA logo on top, BLUBBA.LOL under it, and a warm
// white swatch for the marquee bulbs. Drawn unlit and brighter than white so bloom makes it glow.

const SIGN_TEX_W = 1024;
const SIGN_TEX_H = 512;
const LOGO_ROWS: [number, number] = [0, 330];
const LOL_ROWS: [number, number] = [340, 508];

function paintSigns(c: HTMLCanvasElement): void {
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, SIGN_TEX_W, SIGN_TEX_H);
  drawLogo(g, 'BLUBBA', SIGN_TEX_W / 2, 150, 250, SIGN_TEX_W - 50);
  drawLogo(g, 'BLUBBA.LOL', SIGN_TEX_W / 2, 416, 128, SIGN_TEX_W - 40, [...LOGO_COLORS, '#ffffff', '#ffffff', '#ffffff', '#ffffff'], false);
  g.fillStyle = '#fff3b0';
  g.fillRect(0, SIGN_TEX_H - 4, 16, 4);
}

/** Non-indexed with only position, normal and uv, so textured parts of any origin merge. */
function textured(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const n = g.index ? g.toNonIndexed() : g;
  if (n !== g) g.dispose();
  for (const name of Object.keys(n.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') n.deleteAttribute(name);
  return n;
}

function signQuad(w: number, h: number, rows: [number, number]): THREE.BufferGeometry {
  const q = new THREE.PlaneGeometry(w, h);
  const uv = q.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - (rows[0] + (1 - uv.getY(i)) * (rows[1] - rows[0])) / SIGN_TEX_H);
  return textured(q);
}

const BULB_UV: [number, number] = [8 / SIGN_TEX_W, 1 - (SIGN_TEX_H - 2) / SIGN_TEX_H];

/** A little floating rock with a grass (or sand) top, its top at y = 0. */
function rockGeometry(r: number, seed: number, sandy: boolean): THREE.BufferGeometry[] {
  const depth = r * 1.3;
  const rock = new THREE.CylinderGeometry(r, r * 0.15, depth, 9, 2);
  const pos = rock.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y > depth / 2 - 0.01) continue;
    const k = Math.round(pos.getX(i) * 10) * 7.1 + Math.round(y * 10) * 13.3 + Math.round(pos.getZ(i) * 10) * 3.7 + seed;
    const j = 0.82 + (Math.sin(k) * 0.5 + 0.5) * 0.36;
    pos.setXYZ(i, pos.getX(i) * j, y - (Math.sin(k * 1.7) * 0.5 + 0.5) * depth * 0.08, pos.getZ(i) * j);
  }
  rock.translate(0, -depth / 2 - 0.4, 0);
  const top = sandy ? 0xf3dfb0 : 0x7ed957;
  const side = sandy ? 0xe0c48e : 0x5fbf45;
  return [
    paint(rock, (_x, y) => (y > -depth * 0.35 ? 0x8a7aa8 : 0x9b8fb8), true, 0.14),
    paint(new THREE.CylinderGeometry(r * 1.02, r * 1.06, 0.8, 12).translate(0, -0.4, 0), (_x, y) => (y > -0.05 ? top : side), true, 0.05),
  ];
}

/** A waving flag on a pole (vertex colors; `wave` goes 0 at the pole to 1 at the free end). */
function flagGeometry(x: number, y: number, z: number, ry: number, color: number, stripe: number): THREE.BufferGeometry[] {
  const V = THREE.Vector3;
  const pole = paint(rod(new V(0, 0, 0), new V(0, 4.2, 0), 0.09, 0.07, 5), 0xe8ecf5);
  const cloth = new THREE.PlaneGeometry(2.6, 1.6, 6, 1).translate(1.35, 3.3, 0);
  const flag = paint(cloth, (_x, fy) => (fy > 3.3 ? color : stripe));
  for (const g of [pole, flag]) {
    const pos = g.attributes.position as THREE.BufferAttribute;
    const wave = new Float32Array(pos.count);
    if (g === flag) for (let i = 0; i < pos.count; i++) wave[i] = Math.max(0, pos.getX(i) - 0.05) / 2.65;
    g.setAttribute('wave', new THREE.BufferAttribute(wave, 1));
    place(g, x, y, z, 0, ry);
  }
  return [pole, flag];
}

export class Branding {
  readonly root = new THREE.Group();
  readonly layout: BrandLayout;
  /** The ad atlas (exposed for screenshots of the ads). */
  readonly atlas: THREE.CanvasTexture;
  private readonly signTex: THREE.CanvasTexture;
  private readonly signMat: THREE.MeshBasicMaterial;
  private readonly flags: THREE.Mesh | null;
  private readonly flagTime = { value: 0 };
  private readonly deckGroup: THREE.Group | null = null;
  private readonly trash: { dispose(): void }[] = [];
  private low = false;
  private t = 0;
  private disposed = false;

  constructor(readonly map: MapDef) {
    const L = (this.layout = brandLayout(map));
    const baseY = L.baseY;
    const sandy = map.deck === 'planks' || !!map.ball;

    const [ac] = makeCanvas(ATLAS, ATLAS);
    paintAtlas(ac);
    this.atlas = canvasTexture(ac);
    const [sc] = makeCanvas(SIGN_TEX_W, SIGN_TEX_H);
    paintSigns(sc);
    this.signTex = canvasTexture(sc);
    onFontReady(() => {
      if (this.disposed) return;
      paintAtlas(ac);
      paintSigns(sc);
      this.atlas.needsUpdate = true;
      this.signTex.needsUpdate = true;
    });
    // Repaint the billboards as each regular's photo arrives.
    const repaint = () => {
      if (this.disposed) return;
      paintAtlas(ac);
      this.atlas.needsUpdate = true;
    };
    loadPosterPhotos(repaint);
    this.trash.push({ dispose: () => photoWaiters.delete(repaint) });
    if (posterPhotos.size) repaint();
    // Lit like the rest of the scene, plus a glow of their own so they read on the shady side.
    const faceMat = new THREE.MeshStandardMaterial({ map: this.atlas, emissiveMap: this.atlas, emissive: WHITE, emissiveIntensity: 0.4, roughness: 0.6 });
    const propMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 });
    this.signMat = new THREE.MeshBasicMaterial({ map: this.signTex, alphaTest: 0.5, toneMapped: false });
    this.trash.push(this.atlas, this.signTex, faceMat, propMat, this.signMat);

    const faces: THREE.BufferGeometry[] = [];
    const props: THREE.BufferGeometry[] = [];
    const signs: THREE.BufferGeometry[] = [];
    const flags: THREE.BufferGeometry[] = [];
    const V = THREE.Vector3;
    const frameColors = [YELLOW, PINK, BLUE, GREEN];
    const flagColors: [number, number][] = [
      [PINK, YELLOW],
      [BLUE, WHITE],
      [YELLOW, PINK],
      [GREEN, WHITE],
    ];
    /** Puts local-space parts (+z facing the map) out at heading a, distance d. */
    const at = (parts: THREE.BufferGeometry[], a: number, d: number) => {
      for (const p of parts) place(p, Math.cos(a) * d, 0, Math.sin(a) * d, 0, faceCenter(a));
      return parts;
    };

    // Billboards on floating rocks, facing the middle of the map.
    L.boards.forEach((a, i) => {
      const d = edgeDistance(map.blast, a, BOARD_MARGIN);
      const y0 = baseY + 5;
      const cy = y0 + BOARD_H / 2;
      const [cx, cyPx] = cellOf(i);
      faces.push(...at([textured(toRegion(new THREE.PlaneGeometry(BOARD_W, BOARD_H), cx, cyPx, CELL_W, CELL_H).translate(0, cy, 0.32))], a, d));
      const frame = frameColors[i % frameColors.length];
      const local = [
        paint(new THREE.BoxGeometry(BOARD_W + 1, BOARD_H + 1, 0.5).translate(0, cy, 0), (_x, _y, z) => (z > 0.2 ? frame : INK), true),
        ...[-1, 1].map((s) => paint(rod(new V(s * 7.5, baseY - 0.5, 0), new V(s * 7.5, y0, 0), 0.32, 0.26, 6), 0xe8ecf5)),
        paint(rod(new V(-7.5, baseY + 2.2, 0), new V(7.5, baseY + 2.2, 0), 0.18, 0.18, 5), 0xe8ecf5),
        ...rockGeometry(8.5, i * 17.3, sandy).map((g) => g.translate(0, baseY - 0.5, 0)),
      ];
      props.push(...at(local, a, d));
      const [c, s] = flagColors[i % flagColors.length];
      for (const side of [-1, 1]) flags.push(...at(flagGeometry(side * (BOARD_W / 2 + 0.2), y0 + BOARD_H + 0.5, 0, side < 0 ? Math.PI : 0, c, s), a, d));
    });

    // The big glowing BLUBBA sign and the BLUBBA.LOL sign, on scaffolds on bigger rocks.
    const sign = (a: number, w: number, h: number, rows: [number, number], lift: number, rock: number) => {
      const d = edgeDistance(map.blast, a, SIGN_MARGIN);
      const railY = baseY + lift;
      signs.push(...at([signQuad(w, h, rows).translate(0, railY + 0.5 + h / 2, 0.3)], a, d));
      const bulbs: THREE.BufferGeometry[] = [];
      for (let k = 0; k <= 20; k++) bulbs.push(textured(paint(new THREE.SphereGeometry(0.42, 6, 4).translate(-w / 2 + (k / 20) * w, railY + 0.1, 1.05), WHITE, false, 0, BULB_UV)));
      signs.push(...at(bulbs, a, d));
      const local: THREE.BufferGeometry[] = [paint(new THREE.BoxGeometry(w + 2, 0.7, 1.8).translate(0, railY - 0.35, 0), (_x, y) => (y > railY - 0.2 ? 0xe8ecf5 : INK), true)];
      for (const tx of [-w * 0.3, w * 0.3]) {
        // A lattice tower: four posts and zigzag braces.
        const corners = [
          [-1.2, -1.2],
          [1.2, -1.2],
          [1.2, 1.2],
          [-1.2, 1.2],
        ];
        for (const [px, pz] of corners) local.push(paint(rod(new V(tx + px, baseY - 1, pz), new V(tx + px * 0.7, railY - 0.6, pz * 0.7), 0.16, 0.14, 5), 0xe8ecf5));
        const steps = Math.max(2, Math.round((railY - baseY) / 2.6));
        for (let k = 0; k < steps; k++) {
          const ya = baseY - 1 + ((railY - 0.6 - (baseY - 1)) * k) / steps;
          const yb = baseY - 1 + ((railY - 0.6 - (baseY - 1)) * (k + 1)) / steps;
          const sx = k % 2 ? 1 : -1;
          local.push(paint(rod(new V(tx + sx * 1.1, ya, 1.1), new V(tx - sx * 1.0, yb, 1.0), 0.09, 0.09, 4), PINK));
          local.push(paint(rod(new V(tx - sx * 1.1, ya, -1.1), new V(tx + sx * 1.0, yb, -1.0), 0.09, 0.09, 4), PINK));
        }
      }
      local.push(...rockGeometry(rock, a * 31, sandy).map((g) => g.translate(0, baseY - 0.6, 0)));
      props.push(...at(local, a, d));
      for (const side of [-1, 1]) flags.push(...at(flagGeometry(side * (w / 2 + 0.6), railY, 0, side < 0 ? Math.PI : 0, side < 0 ? YELLOW : PINK, side < 0 ? PINK : YELLOW), a, d));
    };
    // High enough to clear the map's own clouds and the tallest props.
    sign(L.sign, 42, 42 * ((LOGO_ROWS[1] - LOGO_ROWS[0]) / SIGN_TEX_W), LOGO_ROWS, 16, 13);
    sign(L.sign2, 40, 40 * ((LOL_ROWS[1] - LOL_ROWS[0]) / SIGN_TEX_W), LOL_ROWS, 14, 11);

    this.root.add(new THREE.Mesh(merge(faces), faceMat), new THREE.Mesh(merge(props), propMat), new THREE.Mesh(merge(signs), this.signMat));

    // Flags wave in the vertex shader: one draw call, nothing to update but the clock.
    const flagMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide });
    flagMat.onBeforeCompile = (s) => {
      s.uniforms.uTime = this.flagTime;
      s.vertexShader = s.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float wave;\nuniform float uTime;')
        .replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\ntransformed += objectNormal * sin(uTime * 4.0 - wave * 3.5 + position.x * 0.21 + position.z * 0.17) * wave * 0.45;',
        );
    };
    this.flags = new THREE.Mesh(merge(flags), flagMat);
    this.root.add(this.flags);
    this.trash.push(flagMat);

    // Banners and bunting around the main deck's sides (they sink and crumble with it).
    const deckDef = L.deck >= 0 ? map.solids[L.deck] : null;
    if (deckDef && deckDef.max[1] - deckDef.min[1] >= 1.8) {
      this.deckGroup = new THREE.Group();
      const cx = (deckDef.min[0] + deckDef.max[0]) / 2;
      const cz = (deckDef.min[2] + deckDef.max[2]) / 2;
      this.deckGroup.position.set(cx, 0, cz);
      const hw = (deckDef.max[0] - deckDef.min[0]) / 2;
      const hd = (deckDef.max[2] - deckDef.min[2]) / 2;
      const top = deckDef.max[1] - 0.15;
      const SKIRT_H = 1.3;
      const repeatLen = SKIRT_H * (ATLAS / STRIP_REPEATS / STRIP_H);
      const parts: THREE.BufferGeometry[] = [];
      const pennants = [0, 1, 2, 3].map((k) => swatch(k));
      for (const [nx, nz] of [
        [0, 1],
        [0, -1],
        [1, 0],
        [-1, 0],
      ]) {
        const len = nx ? hd * 2 : hw * 2;
        const out = (nx ? hw : hd) + 0.08;
        const ry = Math.atan2(nx, nz);
        const reps = Math.floor((len - 2) / repeatLen);
        let x = (-reps * repeatLen) / 2;
        for (let left = reps; left > 0; ) {
          const n = Math.min(STRIP_REPEATS, left);
          const q = toRegion(new THREE.PlaneGeometry(n * repeatLen, SKIRT_H), 0, STRIP_Y, (ATLAS * n) / STRIP_REPEATS, STRIP_H);
          parts.push(place(q.translate(x + (n * repeatLen) / 2, top - SKIRT_H / 2, out), 0, 0, 0, 0, ry));
          x += n * repeatLen;
          left -= n;
        }
        // Pennants hanging under the banners, in the logo colors.
        const count = Math.floor((len - 1.5) / 0.9);
        for (let k = 0; k < count; k++) {
          const px = -((count - 1) * 0.9) / 2 + k * 0.9;
          const tri = new THREE.BufferGeometry();
          tri.setAttribute('position', new THREE.Float32BufferAttribute([px - 0.36, 0, out + 0.02, px + 0.36, 0, out + 0.02, px, -0.75, out + 0.02], 3));
          tri.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
          const [u, v] = pennants[k % pennants.length];
          tri.setAttribute('uv', new THREE.Float32BufferAttribute([u, v, u, v, u, v], 2));
          parts.push(place(tri.translate(0, top - SKIRT_H - 0.02, 0), 0, 0, 0, 0, ry));
        }
      }
      const deckMesh = new THREE.Mesh(merge(parts.map(textured)), faceMat);
      this.deckGroup.add(deckMesh);
      this.root.add(this.deckGroup);
    }
  }

  /** Animates the flags and the sign's glow, and keeps the deck banners on the (shrinking) deck. */
  update(dt: number, world: World, low: boolean): void {
    this.t += dt;
    if (low !== this.low) {
      this.low = low;
      if (this.flags) this.flags.visible = !low;
    }
    this.flagTime.value = this.t;
    // A slow neon breath (only shows with bloom; Low clamps it to plain bright colors).
    this.signMat.color.setScalar(1.05 + 0.25 * (0.5 + 0.5 * Math.sin(this.t * 1.6)));
    const deck = this.deckGroup;
    if (deck) {
      const s = world.solid(this.layout.deck);
      const def = this.map.solids[this.layout.deck];
      if (s) {
        deck.position.y = s.minY - def.min[1];
        deck.scale.x = (s.maxX - s.minX) / (def.max[0] - def.min[0]);
        deck.scale.z = (s.maxZ - s.minZ) / (def.max[2] - def.min[2]);
        deck.visible = s.enabled;
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
    for (const d of this.trash) d.dispose();
  }
}
