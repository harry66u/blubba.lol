import { balloonArch, foodTruck } from './props';
import type { DecorDef, MapDef, SolidDef } from './types';

/**
 * "Sky Motors": a used-car lot floating in the sky. Fictional; not based on any real business.
 *
 * Layout (top view, +x east, +z south):
 *   - Main asphalt lot 50 x 40. For cover: a few cars for sale, a hot dog truck, a stage of tube
 *     men for sale and a balloon arch.
 *   - Glass showroom in the north-east corner with a climbable roof (crate steps).
 *   - North sales island, reached by jumping.
 *   - South island reached by a moving flatbed.
 *   - West and east islands with bounce pads back onto the lot.
 */

const solids: SolidDef[] = [];
const decor: DecorDef[] = [];

function box(min: [number, number, number], max: [number, number, number], kind: SolidDef['kind'], extra: Partial<SolidDef> = {}) {
  solids.push({ min, max, kind, ...extra });
}

/** A parked car: two collision boxes (body + cabin) drawn by a single car decor. */
function car(x: number, z: number, alongX: boolean, color: number) {
  const halfL = 2.2;
  const halfW = 1.0;
  const hx = alongX ? halfL : halfW;
  const hz = alongX ? halfW : halfL;
  box([x - hx, 0, z - hz], [x + hx, 0.95, z + hz], 'hidden', { ledge: false });
  const cx = alongX ? 1.25 : 0.85;
  const cz = alongX ? 0.85 : 1.25;
  const off = -0.25; // cabin sits slightly toward the back
  box([x - cx + (alongX ? off : 0), 0.95, z - cz + (alongX ? 0 : off)], [x + cx + (alongX ? off : 0), 1.55, z + cz + (alongX ? 0 : off)], 'hidden', {
    ledge: false,
  });
  decor.push({ type: 'car', x, y: 0, z, rotY: alongX ? Math.PI / 2 : 0, color });
}

// --- Main lot ---------------------------------------------------------------------------
box([-25, -2.5, -20], [25, 0, 20], 'lot', { ledge: true, collapse: 0 });
decor.push({ type: 'lines', x: 0, y: 0, z: 0 });

// Cars (muted pastels so the players stay the brightest things on screen).
car(-13, -5, false, 0xd98c8c);
car(7, 5.5, false, 0x8cb3d9);
car(-14, 10, true, 0xc79ad9);
car(0.5, -12.5, true, 0xd9a98c);

// Not everything on the lot is a car: a hot dog truck (climb its cab to the roof), a stage of tube
// men for sale, and a balloon arch.
foodTruck(solids, decor, -2, 0, 11.5, { alongX: true, color: 0xfff1d6, text: 'HOT DOGS', snack: 'hotdog' });
box([10.5, 0, 4.2], [14.5, 0.4, 6.8], 'crate', { ledge: true, color: 0xf4e3c3 });
decor.push({ type: 'tubeMan', x: 11.6, y: 0.4, z: 5.5, color: 0xff2d55, scale: 1 });
decor.push({ type: 'tubeMan', x: 13.4, y: 0.4, z: 5.5, color: 0x5ac8fa, scale: 1 });
decor.push({ type: 'banner', x: 14.9, y: 0, z: 7.2, data: { text: '$99' } });
balloonArch(solids, decor, -7.5, 0, -5, 6, true);
decor.push({ type: 'banner', x: 10.8, y: 0, z: -9, data: { text: 'SALE' } });
decor.push({ type: 'banner', x: -24, y: 0, z: 7.5, data: { text: 'DEALS' } });
decor.push({ type: 'cone', x: 2.8, y: 0, z: 9.8 });
decor.push({ type: 'cone', x: 3.4, y: 0, z: 12.8 });

// Showroom building (north-east) with crate steps to its roof.
box([13, 0, -19], [24, 4.6, -10.5], 'glass', { ledge: true });
box([12.6, 4.6, -19.4], [24.4, 5.0, -10.1], 'concrete', { ledge: true });
box([8.2, 0, -17.6], [10.2, 1.3, -15.6], 'crate', { ledge: true });
box([10.4, 0, -17.6], [12.6, 2.7, -15.4], 'crate', { ledge: true });
decor.push({ type: 'sign', x: 18.5, y: 5.0, z: -14.75, data: { text: 'SKY MOTORS' } });

// Low concrete barrier in the south-west to give some ground-level cover.
box([-20, 0, 4], [-18.6, 1.0, 8.5], 'concrete', { ledge: true });

// --- North island (reached by jumping or blast jumping) ----------------------------------
box([-9, -1.5, -35], [9, 1.2, -26.5], 'island', { ledge: true, collapse: 3 });
decor.push({ type: 'balloons', x: -6.5, y: 1.2, z: -33, color: 0xff6fa8 });
decor.push({ type: 'balloons', x: 6.5, y: 1.2, z: -33, color: 0x6fd3ff });
decor.push({ type: 'flag', x: 0, y: 1.2, z: -34, data: { text: 'SALE' } });

// --- South island + moving flatbed ------------------------------------------------------
box([-7, -1.8, 31], [7, 0.4, 39], 'island', { ledge: true, collapse: 3 });
box([-2.6, -0.6, 20.6], [2.6, 0, 24.4], 'platform', {
  ledge: true,
  mover: { dx: 0, dy: 0.4, dz: 6.2, period: 7 },
});
decor.push({ type: 'cone', x: -5, y: 0.4, z: 33 });
decor.push({ type: 'cone', x: 5, y: 0.4, z: 33 });
decor.push({ type: 'tires', x: 0, y: 0.4, z: 36.5 });

// --- West island with a bounce pad back onto the lot -------------------------------------
box([-41, -2.5, -6], [-32, -0.6, 6], 'island', { ledge: true, collapse: 2 });
// --- East island with an elevator and a bounce pad ---------------------------------------
box([32, -1.5, 3], [40, 1.0, 13], 'island', { ledge: true, collapse: 2 });
box([28.2, -0.4, -6.5], [31.2, 0, -3.5], 'platform', {
  ledge: true,
  mover: { dx: 0, dy: 5.5, dz: 0, period: 6, phase: 0.25 },
});

// --- Scenery --------------------------------------------------------------------------------
// Flailing inflatable tube men at the corners (decor only).
decor.push({ type: 'tubeMan', x: -23.5, y: 0, z: -18.5, color: 0xff3b30 });
decor.push({ type: 'tubeMan', x: 23.5, y: 0, z: 18.5, color: 0x34c759 });
decor.push({ type: 'tubeMan', x: -23.5, y: 0, z: 18.5, color: 0xffcc00 });
decor.push({ type: 'tubeMan', x: 7, y: 0, z: -19, color: 0x5ac8fa });
decor.push({ type: 'tubeMan', x: -39.5, y: -0.6, z: 4.5, color: 0xff9500 });
decor.push({ type: 'tubeMan', x: 38.5, y: 1.0, z: 11.5, color: 0xaf52de });
// Bunting poles along the lot edges.
decor.push({ type: 'pole', x: -24.5, y: 0, z: -19.5 });
decor.push({ type: 'pole', x: 24.5, y: 0, z: -9.5 });
decor.push({ type: 'pole', x: -24.5, y: 0, z: 19.5 });
decor.push({ type: 'pole', x: 24.5, y: 0, z: 19.5 });
decor.push({ type: 'bunting', x: -24.5, y: 4.2, z: 19.5, data: { x2: 24.5, y2: 4.2, z2: 19.5 } });
decor.push({ type: 'bunting', x: -24.5, y: 4.2, z: -19.5, data: { x2: 12.4, y2: 4.2, z2: -19.5 } });
decor.push({ type: 'bunting', x: -24.5, y: 4.2, z: -19.5, data: { x2: -24.5, y2: 4.2, z2: 19.5 } });
decor.push({ type: 'bunting', x: 24.5, y: 4.2, z: -9.5, data: { x2: 24.5, y2: 4.2, z2: 19.5 } });
decor.push({ type: 'balloons', x: -1, y: 0, z: 0, color: 0xffd60a });
decor.push({ type: 'cone', x: -9, y: 0, z: 16 });
decor.push({ type: 'cone', x: 16, y: 0, z: -2 });
decor.push({ type: 'tires', x: -22.5, y: 0, z: -12 });

export const DEALERSHIP: MapDef = {
  id: 'dealership',
  name: 'Sky Motors',
  icon: '🚗',
  solids,
  bouncePads: [
    { x: -35, y: -0.6, z: 0, half: 1.3, strength: 21, pushX: 11, pushZ: 0 },
    { x: 35.5, y: 1.0, z: 8, half: 1.3, strength: 20, pushX: -10, pushZ: -1.5 },
    { x: 0, y: 1.2, z: -29.2, half: 1.2, strength: 17, pushX: 0, pushZ: 9 },
  ],
  spawns: [
    [-18, 0, -13, 0],
    [-4, 0, -16, 0],
    [4, 0, -3, 0],
    [18, 0, -3, 0],
    [18, 0, 13, 0],
    [6, 0, 15, 0],
    [-7, 0, 5, 0],
    [-20, 0, 14, 0],
    [-21, 0, -1, 0],
    [-2, 0, 1.5, 0],
  ],
  blast: { minX: -72, maxX: 72, minY: -32, maxY: 60, minZ: -68, maxZ: 68 },
  pickups: [
    [-10, 0, 1],
    [12, 0, 0],
    [21.5, 5, -12.5],
    [0, 1.2, -31],
    [0, 0.4, 35],
    [36, 1, 8],
  ],
  decor,
  theme: {
    skyTop: 0x4a9ff5,
    skyHorizon: 0xbfe6ff,
    skyBottom: 0xf3f8ff,
    fog: 0xcfe9ff,
    sun: 0xfff1d6,
    ambient: 0xb8d8ff,
    cloud: 0xffffff,
  },
};
