import type { DecorDef, MapDef, SolidDef, Vec3Tuple } from './types';

/**
 * "Face-Off": the Team Knockout arena. Two home bases facing each other across a contested middle,
 * every piece mirrored left to right so neither side has an edge. Red (team 0) holds the west,
 * blue (team 1) the east, and the paint says so everywhere you look.
 *
 * - **Bases** (spawns): a raised back wall with an open gap in the middle, two bunkers covering the
 *   ways out, and a launch pad that throws you over the moat toward the middle for a fast push.
 * - **Three ways out of each base:** two lane bridges (safe) and a narrow center plank over the
 *   moat (fast, easy to be knocked off).
 * - **The middle:** a low hill in the center worth holding, crates for cover either side of it,
 *   and hop-over walls in front of each base. Open edges north and south to knock people off.
 * - **Flanks:** long walkways along both sides, a jump away from the middle, with cover in the
 *   middle and pads out to two little islands (a soda can each, and a pad back) that sink at
 *   half time.
 *
 * Collapse: the islands sink at half time; in the final 30 seconds the flanks and the plank go,
 * then the bases (you respawn at the back of your half of the middle), then the middle crumbles.
 */
const solids: SolidDef[] = [];
const decor: DecorDef[] = [];
const box = (min: Vec3Tuple, max: Vec3Tuple, kind: SolidDef['kind'], extra: Partial<SolidDef> = {}) => solids.push({ min, max, kind, ...extra });
/** The same piece on the east side, mirrored across the halfway line. */
const mx = (v: Vec3Tuple, other: Vec3Tuple): Vec3Tuple => [-other[0], v[1], v[2]];
/** A west-side piece and its mirror image (team paint swaps sides with it). */
function pair(min: Vec3Tuple, max: Vec3Tuple, kind: SolidDef['kind'], extra: Partial<SolidDef> = {}) {
  box(min, max, kind, extra);
  const paint = extra.paint === 0 ? 1 : extra.paint === 1 ? 0 : extra.paint;
  box(mx(min, max), mx(max, min), kind, { ...extra, ...(paint !== undefined ? { paint } : {}) });
}
/** North and south copies of a piece (z mirrored). */
function ns(min: Vec3Tuple, max: Vec3Tuple, kind: SolidDef['kind'], extra: Partial<SolidDef> = {}) {
  box(min, max, kind, extra);
  box([min[0], min[1], -max[2]], [max[0], max[1], -min[2]], kind, extra);
}

const DECK = 0xd3d6de;
const STONE = 0xc4c8d3;

// The middle (the main deck: crumbles inward at the very end).
box([-22, -2.5, -13], [22, 0, 13], 'lot', { ledge: true, collapse: 0, color: DECK, look: 'plain', paint: 'split' });
// Center hill: a single jump up, open on every side.
box([-3.5, 0, -3.5], [3.5, 1.1, 3.5], 'concrete', { ledge: true, color: 0xf0f2f7, look: 'plain' });
// Crates either side of the hill, and hop-over walls in front of each base.
for (const z of [1, -1]) {
  pair([-10, 0, z > 0 ? 4 : -7], [-8, 1.4, z > 0 ? 7 : -4], 'crate');
  pair([-15.8, 0, z > 0 ? 3 : -9], [-15, 1, z > 0 ? 9 : -3], 'concrete', { ledge: true });
}

// Home bases (spawns): wide islands across the moat, the whole width of the map.
pair([-42, -2, -20], [-30, 0, 20], 'island', { ledge: true, collapse: 1, color: STONE, look: 'plain', paint: 0 });
// Back wall with an open gap in the middle (you can still be knocked out the back).
for (const z of [1, -1]) pair([-42, 0, z > 0 ? 7 : -20], [-41, 2.8, z > 0 ? 20 : -7], 'building', { ledge: true, collapse: 1 });
// Bunkers covering the ways out.
for (const z of [1, -1]) pair([-34, 0, z > 0 ? 3.5 : -6.5], [-32, 1.4, z > 0 ? 6.5 : -3.5], 'concrete', { ledge: true, collapse: 1 });
// Lane bridges over the moat (team side), and the narrow center plank (contested).
for (const z of [1, -1]) pair([-30, -0.8, z > 0 ? 6 : -10], [-22, 0, z > 0 ? 10 : -6], 'concrete', { ledge: true, collapse: 1, look: 'plain', paint: 0 });
pair([-30, -0.6, -1], [-22, 0, 1], 'concrete', { ledge: true, collapse: 2, look: 'plain' });

// Flanks: long walkways along both sides (red half, blue half), a jump from the middle.
ns([-30, -1, 15.5], [30, 0, 19.5], 'concrete', { ledge: true, collapse: 2, look: 'plain', paint: 'split' });
// Cover on the flanks, either side of the pad.
for (const x of [1, -1]) ns([x > 0 ? 5 : -7, 0, 16.5], [x > 0 ? 7 : -5, 1.2, 18.5], 'crate', { collapse: 2 });
// Little islands off the flanks (a soda can each); they sink at half time.
ns([-3, -1.5, 24], [3, 0.4, 30], 'island', { ledge: true, collapse: 3, color: 0xf7e3a1 });

// Team colors at a glance: flags at the bases' front corners.
for (const [x, team] of [
  [-30.6, 0],
  [30.6, 1],
] as const) {
  for (const z of [-13.5, 13.5]) decor.push({ type: 'teamFlag', x, y: 0, z, rotY: x < 0 ? 0 : Math.PI, data: { team } });
}
decor.push({ type: 'balloons', x: 2.2, y: 0.4, z: 28.6, color: 0xffd60a });
decor.push({ type: 'balloons', x: -2.2, y: 0.4, z: -28.6, color: 0xffd60a });

/** Where each team comes back in: its base first, then the back of its half of the middle. */
const home = (sgn: 1 | -1): [number, number, number][] => [
  [sgn * 38.5, 0, -10],
  [sgn * 38.5, 0, 10],
  [sgn * 36, 0, -15.5],
  [sgn * 36, 0, 15.5],
  [sgn * 38.5, 0, -4.5],
  [sgn * 38.5, 0, 4.5],
];

export const FACEOFF: MapDef = {
  id: 'faceoff',
  name: 'Face-Off',
  icon: '⚔️',
  modes: ['teamKnockout'],
  solids,
  bouncePads: [
    // Base launch pads: over the moat into your half of the middle.
    { x: -36, y: 0, z: 0, half: 1.2, strength: 16, pushX: 13, pushZ: 0 },
    { x: 36, y: 0, z: 0, half: 1.2, strength: 16, pushX: -13, pushZ: 0 },
    // Flank pads out to the little islands (landing well inside them), and back from the far end.
    { x: 0, y: 0, z: 17.5, half: 1.1, strength: 17, pushX: 0, pushZ: 7 },
    { x: 0, y: 0, z: -17.5, half: 1.1, strength: 17, pushX: 0, pushZ: -7 },
    { x: 0, y: 0.4, z: 29, half: 0.8, strength: 17, pushX: 0, pushZ: -9 },
    { x: 0, y: 0.4, z: -29, half: 0.8, strength: 17, pushX: 0, pushZ: 9 },
  ],
  // Symmetric front to back too (the spawns' middle is where bots head when lost: z = 0).
  spawns: [...home(-1).slice(0, 2), ...home(1).slice(0, 2), [-12, 0, 6, 0], [-12, 0, -6, 0], [12, 0, 6, 0], [12, 0, -6, 0]].map(
    ([x, y, z]) => [x, y, z, 0] as [number, number, number, number],
  ),
  teamSpawns: [home(-1), home(1)],
  blast: { minX: -86, maxX: 86, minY: -32, maxY: 60, minZ: -66, maxZ: 66 },
  pickups: [
    [0, 1.1, 0],
    [0, 0.4, 27],
    [0, 0.4, -27],
    [-20, 0, 17.5],
    [20, 0, -17.5],
    [20, 0, 17.5],
    [-20, 0, -17.5],
  ],
  decor,
  theme: { skyTop: 0x3f8cf5, skyHorizon: 0xc4ecff, skyBottom: 0xeef9ff, fog: 0xd6efff, sun: 0xfff4d6, ambient: 0xc8e2ff, cloud: 0xffffff },
};
