import type { DecorDef, MapDef, SolidDef } from './types';

/**
 * "Skate Park": a concrete skate park and playground floating in the sky.
 *
 * Layout (top view, +x east, +z south):
 *   - Main deck 48 x 32 of smooth painted concrete.
 *   - West: a half-pipe along the edge. Run partway up either wall and jump to its deck; the outer
 *     deck is right over the drop.
 *   - Middle: a fun box with ramps on both ends. Grind rails and benches around it.
 *   - South-east: a jungle gym with monkey bars on top and a slide you can walk up.
 *   - North: a giant skateboard floating off the edge (a kicker ramp helps you reach it).
 *   - East: a moving skateboard shuttles to a small plaza. South: a lower plaza. Both have bounce
 *     pads back.
 */

const solids: SolidDef[] = [];
const decor: DecorDef[] = [];

function box(min: [number, number, number], max: [number, number, number], kind: SolidDef['kind'], extra: Partial<SolidDef> = {}): number {
  solids.push({ min, max, kind, ...extra });
  return solids.length - 1;
}

const CONCRETE = 0xc9ced8;
/** Step height under ramps and pipes: low enough to walk up (the player's step is 0.5 m). */
const STEP = 0.33;

/**
 * A quarter pipe with its lip at x = `lipX`, running `len` along z. `dir` 1 faces east (the wall
 * rises toward -x), -1 faces west. The collision is a flight of low steps under the smooth curve
 * (you can run partway up, then jump for the deck) and a flat deck on top.
 */
function quarterPipe(lipX: number, z: number, len: number, dir: 1 | -1, collapse: number) {
  const r = 2.6;
  const deck = 1.2;
  const n = Math.round(r / STEP);
  // Distance back from the lip where the curve reaches height h.
  const back = (h: number) => Math.sqrt(r * r - (r - h) * (r - h));
  let first = -1;
  let from = back((0.5 * r) / n);
  for (let k = 1; k <= n; k++) {
    const to = k === n ? r + deck : back(((k + 0.5) * r) / n);
    const a = lipX - dir * from;
    const b = lipX - dir * to;
    const id = box([Math.min(a, b), 0, z - len / 2], [Math.max(a, b), (k * r) / n, z + len / 2], 'hidden', { ledge: k === n, collapse });
    if (first < 0) first = id;
    from = to;
  }
  decor.push({ type: 'quarterPipe', x: lipX, y: 0, z, rotY: dir > 0 ? 0 : Math.PI, ride: first, data: { r, deck, len } });
}

/**
 * A wedge ramp centered at (x, z) rising `h` over `len` toward `dir` ('x+', 'x-', 'z-', 'z+'),
 * `w` wide. Collision is low steps under the smooth wedge.
 */
function ramp(x: number, y: number, z: number, len: number, w: number, h: number, dir: 'x+' | 'x-' | 'z-' | 'z+', extra: Partial<SolidDef> = {}): number {
  const n = Math.max(2, Math.ceil(h / STEP));
  const alongX = dir === 'x+' || dir === 'x-';
  const sign = dir === 'x+' || dir === 'z+' ? 1 : -1;
  let first = -1;
  for (let i = 0; i < n; i++) {
    const a = -len / 2 + (len * i) / n;
    const b = -len / 2 + (len * (i + 1)) / n;
    const top = y + (h * (i + 0.5)) / n;
    const [p, q] = [sign * a, sign * b].sort((u, v) => u - v);
    const id = alongX
      ? box([x + p, y, z - w / 2], [x + q, top, z + w / 2], 'hidden', { ledge: false, ...extra })
      : box([x - w / 2, y, z + p], [x + w / 2, top, z + q], 'hidden', { ledge: false, ...extra });
    if (first < 0) first = id;
  }
  const rotY = { 'x+': 0, 'x-': Math.PI, 'z-': Math.PI / 2, 'z+': -Math.PI / 2 }[dir];
  decor.push({ type: 'ramp', x, y, z, rotY, ride: extra.collapse ? first : undefined, data: { len, w, h } });
  return first;
}

/** A grind rail along x: a thin bar you can hop onto. */
function rail(x0: number, x1: number, z: number, h: number) {
  box([x0, 0, z - 0.12], [x1, h, z + 0.12], 'hidden', { ledge: false });
  decor.push({ type: 'rail', x: (x0 + x1) / 2, y: 0, z, data: { len: x1 - x0, h } });
}

/** A bench along x (low enough to step onto). */
function bench(x: number, y: number, z: number, collapse?: number) {
  box([x - 1.2, y, z - 0.3], [x + 1.2, y + 0.5, z + 0.3], 'hidden', { ledge: false, collapse });
  decor.push({ type: 'bench', x, y, z, data: { len: 2.4 } });
}

/** A painted wall for cover, `alongX` or along z. */
function wall(x: number, y: number, z: number, len: number, alongX: boolean, text: string, color: number, collapse?: number) {
  const hx = alongX ? len / 2 : 0.2;
  const hz = alongX ? 0.2 : len / 2;
  box([x - hx, y, z - hz], [x + hx, y + 1.4, z + hz], 'hidden', { ledge: true, collapse });
  decor.push({ type: 'graffiti', x, y, z, rotY: alongX ? 0 : Math.PI / 2, color, data: { len, h: 1.4, text } });
}

// --- Main deck -----------------------------------------------------------------------------------
box([-24, -2.5, -16], [24, 0, 16], 'lot', { ledge: true, collapse: 0, color: CONCRETE });

// Half-pipe along the west edge (it goes down in the final 30 seconds).
quarterPipe(-20.2, 0, 18, 1, 1);
quarterPipe(-14.2, 0, 18, -1, 1);
decor.push({ type: 'sign', x: -17.2, y: 0, z: -10.2, data: { text: 'SKATE PARK' } });

// Fun box in the middle with a ramp at each end.
box([-3, 0, -2.5], [3, 1.2, 2.5], 'concrete', { ledge: true, color: 0xd9dde6 });
ramp(-4.8, 0, 0, 3.6, 5, 1.2, 'x+');
ramp(4.8, 0, 0, 3.6, 5, 1.2, 'x-');

// Kicker ramp at the north edge: run up it and jump for the floating skateboard.
ramp(0, 0, -14.4, 2.8, 4, 0.9, 'z-');

rail(6, 16, -9, 0.75);
rail(6, 12, 9, 0.75);
bench(-4, 0, -12);
bench(-14, 0, 13);
wall(0.5, 0, 12.4, 5, true, 'RAD', 0xff4fa3);
wall(20.2, 0, -8.5, 5, false, 'BLUBBA', 0x2ec5ff);

// Jungle gym in the south-east: posts, a platform on top, and a slide down its south side.
{
  const c = { ledge: false, collapse: 1 };
  const posts: number[] = [];
  for (const [x, z] of [
    [13.2, 5.2],
    [18.8, 5.2],
    [13.2, 8.8],
    [18.8, 8.8],
  ]) posts.push(box([x - 0.18, 0, z - 0.18], [x + 0.18, 2.8, z + 0.18], 'hidden', c));
  box([13, 2.8, 5], [19, 3, 9], 'hidden', { ledge: true, collapse: 1 });
  const steps = 10;
  for (let i = 0; i < steps; i++) {
    box([15.2, 0, 9 + (4.5 * i) / steps], [16.8, 3 * (1 - (i + 0.5) / steps), 9 + (4.5 * (i + 1)) / steps], 'hidden', c);
  }
  decor.push({ type: 'jungleGym', x: 16, y: 0, z: 7, ride: posts[0], data: { w: 6, d: 4, h: 3, slide: 4.5 } });
}

// Hoop in the north-east corner.
box([22.65, 0, -13.15], [22.95, 3.4, -12.85], 'hidden', { ledge: false });
decor.push({ type: 'hoop', x: 22.8, y: 0, z: -13, rotY: Math.PI });

// --- The giant skateboard off the north edge ------------------------------------------------------
{
  const board = box([-8, -0.2, -27], [8, 0.8, -22.5], 'hidden', { ledge: true, collapse: 3 });
  decor.push({ type: 'skateboard', x: 0, y: 0.8, z: -24.75, ride: board, color: 0xff5f7e, data: { len: 16, w: 4.5 } });
}

// --- South plaza (a step down) ----------------------------------------------------------------------
box([-9, -1.8, 22], [9, -0.4, 30], 'island', { ledge: true, collapse: 2, color: CONCRETE, look: 'skate' });
wall(-4, -0.4, 27.6, 4, true, 'OLLIE', 0x8ee000, 2);
bench(4, -0.4, 28, 2);

// --- East plaza and the moving skateboard that shuttles to it -------------------------------------
box([31, -2, -7], [41, 0, 7], 'island', { ledge: true, collapse: 2, color: CONCRETE, look: 'skate' });
{
  const board = box([24.2, -0.35, -1.2], [29.2, 0.1, 1.2], 'hidden', { ledge: true, collapse: 2, mover: { dx: 1.6, dy: 0, dz: 0, period: 6 } });
  decor.push({ type: 'skateboard', x: 26.7, y: 0.1, z: 0, ride: board, color: 0x2ec5ff, data: { len: 5, w: 2.4 } });
}
wall(39, 0, 1, 4, false, 'WOW', 0xffb020, 2);

// --- Scenery ----------------------------------------------------------------------------------------
decor.push({ type: 'lamp', x: -9, y: 0, z: -15.3 });
decor.push({ type: 'lamp', x: 10, y: 0, z: 15.3, rotY: Math.PI });
decor.push({ type: 'lamp', x: 23.3, y: 0, z: 8, rotY: -Math.PI / 2 });
decor.push({ type: 'cone', x: 7, y: 0, z: -3.5 });
decor.push({ type: 'cone', x: 8.5, y: 0, z: 3.5 });
decor.push({ type: 'cone', x: -8, y: -0.4, z: 24 });
decor.push({ type: 'cone', x: 34, y: 0, z: 6 });
decor.push({ type: 'balloons', x: 12, y: 0, z: -14.5, color: 0x2ec5ff });
decor.push({ type: 'pole', x: -23.5, y: 0, z: -15.5 });
decor.push({ type: 'pole', x: -10.5, y: 0, z: -15.5 });
decor.push({ type: 'bunting', x: -23.5, y: 4.2, z: -15.5, data: { x2: -10.5, y2: 4.2, z2: -15.5 } });

export const SKATEPARK: MapDef = {
  id: 'skatepark',
  name: 'Skate Park',
  icon: '🛹',
  deck: 'skate',
  solids,
  bouncePads: [
    { x: 0, y: 0.8, z: -23.6, half: 1.1, strength: 17, pushX: 0, pushZ: 9 },
    { x: 0, y: -0.4, z: 23.3, half: 1.2, strength: 20, pushX: 0, pushZ: -10 },
    { x: 36, y: 0, z: -3, half: 1.3, strength: 20, pushX: -12, pushZ: 0 },
  ],
  spawns: [
    [-17, 0, -12.5, 0],
    [-17, 0, 12.5, 0],
    [-7, 0, -8, 0],
    [-7, 0, 8, 0],
    [3.5, 0, -7, 0],
    [3.5, 0, 7.5, 0],
    [19, 0, -3, 0],
    [21, 0, 2.5, 0],
  ],
  blast: { minX: -72, maxX: 72, minY: -32, maxY: 60, minZ: -68, maxZ: 68 },
  pickups: [
    [0, 1.2, 0],
    [-23.4, 2.6, 0],
    [4, 0.8, -25.5],
    [36, 0, 4],
    [4, -0.4, 25],
    [16, 3, 7],
  ],
  decor,
  // Bright noon over a mint horizon.
  theme: {
    skyTop: 0x1f8fff,
    skyHorizon: 0xc9f7e2,
    skyBottom: 0xeefff6,
    fog: 0xd3f4e6,
    sun: 0xfff4d6,
    ambient: 0xcdeede,
    cloud: 0xffffff,
  },
};
