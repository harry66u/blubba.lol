import { balloonArch, foodTruck } from './props';
import type { DecorDef, MapDef, SolidDef } from './types';

/**
 * "Top Floor": the roof of a parking garage floating at sunset. Fictional. Two levels: an open
 * lower deck and an upper deck on pillars (you can fight underneath it), connected by stairs and
 * a car lift.
 */
const solids: SolidDef[] = [];
const decor: DecorDef[] = [];
const box = (min: [number, number, number], max: [number, number, number], kind: SolidDef['kind'], extra: Partial<SolidDef> = {}) => solids.push({ min, max, kind, ...extra });

/** A parked car; cars on the upper deck (`collapse` 1) go down with it. */
function car(x: number, y: number, z: number, alongX: boolean, color: number, collapse?: number) {
  const hx = alongX ? 2.2 : 1.0;
  const hz = alongX ? 1.0 : 2.2;
  box([x - hx, y, z - hz], [x + hx, y + 0.95, z + hz], 'hidden', { ledge: false, collapse });
  const cx = alongX ? 1.25 : 0.85;
  const cz = alongX ? 0.85 : 1.25;
  box([x - cx, y + 0.95, z - cz], [x + cx, y + 1.55, z + cz], 'hidden', { ledge: false, collapse });
  decor.push({ type: 'car', x, y, z, rotY: alongX ? Math.PI / 2 : 0, color });
}

// Lower deck.
box([-26, -2.5, -18], [26, 0, 18], 'lot', { ledge: true, collapse: 0 });
// Upper deck on pillars over the north half.
box([-26, 4.5, -18], [16, 5.5, -4], 'concrete', { ledge: true, collapse: 1 });
for (const x of [-22, -12, -2, 8]) for (const z of [-14, -8]) box([x - 0.5, 0, z - 0.5], [x + 0.5, 4.5, z + 0.5], 'pillar', { ledge: false, collapse: 1 });
// Stairs up the east side of the upper deck (0.4 m steps: walkable).
for (let k = 0; k < 14; k++) box([12, 0, 10 - (k + 1)], [16, 0.4 * (k + 1), 10 - k], 'concrete', { ledge: false, collapse: 1 });
// Stairwell tower in the far corner of the upper deck.
box([-25, 5.5, -17], [-21, 8.5, -13], 'building', { ledge: true, collapse: 1 });
// Parapets: short walls you can be launched over, with gaps.
box([-26, 5.5, -18], [-8, 6.2, -17.6], 'concrete', { ledge: true, collapse: 1 });
box([0, 5.5, -18], [16, 6.2, -17.6], 'concrete', { ledge: true, collapse: 1 });
box([-26, 0, 17.6], [-10, 0.7, 18], 'concrete', { ledge: true });
box([10, 0, 17.6], [26, 0.7, 18], 'concrete', { ledge: true });
// Car lift beside the upper deck.
box([18.5, -0.4, -14], [22.5, 0, -10], 'platform', { ledge: true, mover: { dx: 0, dy: 5.7, dz: 0, period: 7 } });
// East helipad island.
box([32, -1.5, -5], [40, 0.5, 5], 'island', { ledge: true, collapse: 3 });

car(-18, 0, 8, false, 0xb99ad9);
car(-12, 0, 8, false, 0x8cb3d9);
car(2, 0, 12, true, 0xd9b38c);
car(-16, 5.5, -10, true, 0xd9d38c, 1);
car(0, 5.5, -12, false, 0x8cd9cf, 1);
// A rooftop party: a taco truck by the lift and a balloon arch at the foot of the stairs.
foodTruck(solids, decor, 20, 0, 5.5, { alongX: true, flip: true, color: 0xd9f2ff, text: 'TACOS', snack: 'taco' });
balloonArch(solids, decor, 14, 0, 10.8, 5);
decor.push({ type: 'tires', x: -4, y: 0, z: 3.5 });
decor.push({ type: 'cone', x: -2.5, y: 0, z: 4.5 });
decor.push({ type: 'cone', x: -5.5, y: 0, z: 2.2 });

decor.push({ type: 'sign', x: -6, y: 5.5, z: -5, data: { text: 'TOP FLOOR' } });
decor.push({ type: 'tubeMan', x: -24.5, y: 0, z: 16.5, color: 0xff9500 });
decor.push({ type: 'tubeMan', x: 24.5, y: 0, z: 16.5, color: 0x5ac8fa });
decor.push({ type: 'tubeMan', x: 38.5, y: 0.5, z: 3.5, color: 0xff2d55 });
decor.push({ type: 'cone', x: 6, y: 0, z: 15 });
decor.push({ type: 'cone', x: -8, y: 0, z: 14 });
decor.push({ type: 'cone', x: 10, y: 5.5, z: -8 });
decor.push({ type: 'balloons', x: 24, y: 0, z: -16, color: 0xffd60a });

export const GARAGE: MapDef = {
  id: 'garage',
  name: 'Top Floor',
  icon: '🅿️',
  solids,
  bouncePads: [
    { x: 0, y: 0, z: 2, half: 1.2, strength: 19, pushX: 0, pushZ: -8 },
    { x: 35, y: 0.5, z: 0, half: 1.2, strength: 19, pushX: -10, pushZ: 0 },
  ],
  spawns: [
    [-20, 0, 14, 0],
    [0, 0, 16, 0],
    [18, 0, 14, 0],
    [22, 0, 0, 0],
    [-22, 0, 0, 0],
    [8, 0, 2, 0],
    [-10, 5.5, -7, 0],
    [4, 5.5, -7, 0],
    [-18, 5.5, -15, 0],
    [-2, 0, -10, 0],
  ],
  blast: { minX: -72, maxX: 72, minY: -32, maxY: 60, minZ: -68, maxZ: 68 },
  pickups: [
    [-6, 5.5, -15],
    [20, 0, 0],
    [-20, 0, -12],
    [36, 0.5, 3],
    [-2, 0, 14],
  ],
  decor,
  theme: { skyTop: 0x5b5bd6, skyHorizon: 0xffb38a, skyBottom: 0xffe0c2, fog: 0xffd2b8, sun: 0xffd2a0, ambient: 0xd9c2ff, cloud: 0xfff0e6 },
};
