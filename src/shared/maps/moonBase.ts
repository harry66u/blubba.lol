import type { DecorDef, MapDef, SolidDef } from './types';

/**
 * "Moon Base": a chunk of the moon floating in space, with a lab, a rocket and a lot of bounce
 * pads for big floaty moon hops. The Earth hangs in the sky.
 *
 * Layout (top view, +x east, +z south):
 *   - Main moon plateau 34 x 34 with craters and moon rocks for cover; four ledges stick out of
 *     its sides (they fall away in the final 30 seconds).
 *   - North-west: the moon lab. Climb the cargo crates or ride the lift to its roof.
 *   - North: the rocket on its launch pad island. South: a crater island with a lunar lander.
 *   - West: a solar farm island (stand on the panels). East: a tube corridor out to the radio dish.
 *   - Moon-hop pads on the west and south ledges throw you right across the plateau.
 */

const solids: SolidDef[] = [];
const decor: DecorDef[] = [];

function box(min: [number, number, number], max: [number, number, number], kind: SolidDef['kind'], extra: Partial<SolidDef> = {}): number {
  solids.push({ min, max, kind, ...extra });
  return solids.length - 1;
}

const MOON = 0xc2c3cf;
const PLATE = 0xa9b0c2;

/** A moon rock to hide behind. */
function rock(x: number, z: number, r: number, h: number) {
  box([x - r * 0.8, 0, z - r * 0.8], [x + r * 0.8, h, z + r * 0.8], 'hidden', { ledge: true });
  decor.push({ type: 'moonRock', x, y: 0, z, data: { r, h } });
}

// --- Main plateau and its four ledges ---------------------------------------------------------------
box([-17, -3, -17], [17, 0, 17], 'lot', { ledge: true, collapse: 0, color: MOON });
for (const [min, max] of [
  [
    [-11, -2.5, -23],
    [11, 0, -17],
  ],
  [
    [-11, -2.5, 17],
    [11, 0, 23],
  ],
  [
    [-23, -2.5, -11],
    [-17, 0, 11],
  ],
  [
    [17, -2.5, -11],
    [23, 0, 11],
  ],
] as [number, number, number][][]) {
  box(min as [number, number, number], max as [number, number, number], 'island', { ledge: true, collapse: 1, color: MOON, look: 'moon' });
}

// The moon lab: a module you can stand on, a cupola on its roof, crates and a lift to climb.
box([-14, 0, -14], [-5, 3, -8], 'hidden', { ledge: true });
box([-13.3, 3, -12.3], [-10.7, 4.1, -9.7], 'hidden', { ledge: false });
decor.push({ type: 'module', x: -9.5, y: 0, z: -11, data: { w: 9, d: 6, h: 3, text: 'MOON LAB' } });
box([-5, 0, -12.8], [-3.2, 2.2, -11], 'crate', { ledge: true, color: 0xe8ecf5 });
box([-3.2, 0, -12.8], [-1.4, 1.1, -11], 'crate', { ledge: true, color: 0xff9f43 });
box([-12, -0.4, -16.8], [-9, 0, -14.2], 'platform', { ledge: true, color: 0xd9dde8, look: 'metal', mover: { dx: 0, dy: 3, dz: 0, period: 6 } });

rock(10, 10, 1.4, 1.3);
rock(-11.5, 5, 1.1, 1.0);
rock(5, -12, 1.2, 1.1);
decor.push({ type: 'crater', x: 6, y: 0, z: 5, data: { r: 3 } });
decor.push({ type: 'crater', x: -5, y: 0, z: 9, data: { r: 2 } });
decor.push({ type: 'crater', x: 11, y: 0, z: -6, data: { r: 2.3 } });
decor.push({ type: 'crater', x: -13, y: 0, z: 13, data: { r: 1.6 } });
decor.push({ type: 'flag', x: 1.5, y: 0, z: -2, data: { text: 'BLUBBA' } });
decor.push({ type: 'antenna', x: 15.5, y: 0, z: 15.5, data: { h: 7 } });

// --- North: the rocket on its launch pad ----------------------------------------------------------
box([-8, -1.5, -36], [8, 1, -27], 'island', { ledge: true, collapse: 3, color: PLATE, look: 'metal' });
box([-1.2, 1, -33.7], [1.2, 13, -31.3], 'hidden', { ledge: false, collapse: 3 });
decor.push({ type: 'rocket', x: 0, y: 1, z: -32.5 });

// --- South: crater island with a lunar lander -------------------------------------------------------
box([-7, -1.5, 27], [7, 0.3, 37], 'island', { ledge: true, collapse: 3, color: MOON, look: 'moon' });
box([-1.6, 0.3, 30.4], [1.6, 2.4, 33.6], 'hidden', { ledge: true, collapse: 3 });
decor.push({ type: 'lander', x: 0, y: 0.3, z: 32 });
decor.push({ type: 'crater', x: -4, y: 0.3, z: 34, data: { r: 1.5 } });

// --- West: solar farm ---------------------------------------------------------------------------------
box([-38, -2, -8], [-28, -0.4, 8], 'island', { ledge: true, collapse: 2, color: PLATE, look: 'metal' });
for (const z of [-5, 5]) {
  box([-37, 0.6, z - 2], [-31, 0.8, z + 2], 'hidden', { ledge: true, collapse: 2 });
  decor.push({ type: 'solarPanel', x: -34, y: -0.4, z, data: { w: 6, d: 4, h: 1.2 } });
}

// --- East: tube corridor to the radio dish ----------------------------------------------------------
box([30, -2, -7], [40, 0.6, 7], 'island', { ledge: true, collapse: 2, color: PLATE, look: 'metal' });
{
  const tube = box([23, -1.6, -0.8], [30, 0.4, 0.8], 'hidden', { ledge: true, collapse: 2 });
  decor.push({ type: 'tube', x: 26.5, y: 0.4, z: 0, ride: tube, data: { len: 7, r: 1.1 } });
}
box([35.4, 0.6, -2.6], [36.6, 3.4, -1.4], 'hidden', { ledge: false, collapse: 2 });
decor.push({ type: 'dish', x: 36, y: 0.6, z: -2, rotY: -2.4, data: { r: 3.2 } });
decor.push({ type: 'antenna', x: 38.5, y: 0.6, z: 5, data: { h: 6 } });

// --- Sky: stars, the Earth, a ringed planet and a satellite ---------------------------------------------
decor.push({ type: 'space', x: 0, y: 0, z: 0 });

export const MOON_BASE: MapDef = {
  id: 'moonBase',
  name: 'Moon Base',
  icon: '🚀',
  deck: 'moon',
  underside: 'moon',
  solids,
  bouncePads: [
    // Launch island and crater island: back onto the plateau.
    { x: 0, y: 1, z: -28.3, half: 1.1, strength: 18, pushX: 0, pushZ: 9 },
    { x: 0, y: 0.3, z: 28.2, half: 1.1, strength: 17, pushX: 0, pushZ: -9 },
    // Solar farm and radio dish: back across the gap.
    { x: -30, y: -0.4, z: 0, half: 1.2, strength: 20, pushX: 12, pushZ: 0 },
    { x: 32, y: 0.6, z: 3.5, half: 1.1, strength: 19, pushX: -12, pushZ: 0 },
    // Moon hops across the plateau.
    { x: -20, y: 0, z: 0, half: 1.2, strength: 22, pushX: 10, pushZ: 0 },
    { x: 0, y: 0, z: 20, half: 1.2, strength: 22, pushX: 0, pushZ: -10 },
  ],
  spawns: [
    [-12, 0, 0, 0],
    [-8, 0, 12, 0],
    [0, 0, -6, 0],
    [0, 0, 8, 0],
    [8, 0, -12, 0],
    [12, 0, 2, 0],
    [8, 0, 13.5, 0],
    [-2, 0, -15, 0],
  ],
  blast: { minX: -72, maxX: 72, minY: -32, maxY: 60, minZ: -68, maxZ: 68 },
  pickups: [
    [-8, 3, -11],
    [5, 1, -32],
    [-34, 0.8, -5],
    [33, 0.6, -5],
    [4, 0.3, 32],
    [0, 0, 0],
  ],
  decor,
  // Deep space: navy overhead, a violet glow at the horizon.
  theme: {
    skyTop: 0x070a26,
    skyHorizon: 0x5a3f9c,
    skyBottom: 0x1b1644,
    fog: 0x32296a,
    sun: 0xf2f4ff,
    ambient: 0xa3adff,
    cloud: 0x7667c2,
  },
};
