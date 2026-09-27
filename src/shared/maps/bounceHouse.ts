import type { DecorDef, MapDef, SolidDef } from './types';

/**
 * "Bounce Castle": a giant inflatable castle floating in the sky. The whole floor is rubbery:
 * any real landing springs you back up. Gaps in the walls lead straight off the edge.
 */
const solids: SolidDef[] = [];
const decor: DecorDef[] = [];
const box = (min: [number, number, number], max: [number, number, number], color: number, bounce: number, extra: Partial<SolidDef> = {}) =>
  solids.push({ min, max, kind: 'bouncy', color, bounce, ledge: true, ...extra });

// Floor.
box([-22, -2, -22], [22, 0, 22], 0xf6c7dd, 0.72, { collapse: 0 });
// Corner towers.
for (const [sx, sz] of [
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
]) {
  const x0 = sx < 0 ? -22 : 17;
  const z0 = sz < 0 ? -22 : 17;
  box([x0, 0, z0], [x0 + 5, 7, z0 + 5], [0xa8d8ff, 0xffe39a, 0xc9f2b0, 0xe0c8ff][(sx + 1) + (sz + 1) / 2], 0.6);
}
// Low walls with a wide gap in the middle of each side.
const wall = 0xffd1e8;
for (const z of [-22, 21]) {
  box([-17, 0, z], [-6, 1.5, z + 1], wall, 0.6);
  box([6, 0, z], [17, 1.5, z + 1], wall, 0.6);
}
for (const x of [-22, 21]) {
  box([x, 0, -17], [x + 1, 1.5, -6], wall, 0.6);
  box([x, 0, 6], [x + 1, 1.5, 17], wall, 0.6);
}
// Central inflatable hill.
box([-5, 0, -5], [5, 1.5, 5], 0xffb5c8, 0.5);
box([-3.5, 1.5, -3.5], [3.5, 3, 3.5], 0xffe39a, 0.5);
box([-2, 3, -2], [2, 4.5, 2], 0xa8d8ff, 0.5);
// Bumper pillars.
for (const [x, z] of [
  [-11, -11],
  [11, -11],
  [-11, 11],
  [11, 11],
]) box([x - 0.8, 0, z - 0.8], [x + 0.8, 3, z + 0.8], 0xc9f2b0, 0.9, { ledge: false });
// Trampoline islands outside two gaps.
box([-4, -2, 30], [4, 0, 36], 0xe0c8ff, 0.85, { collapse: 3 });
box([-4, -2, -36], [4, 0, -30], 0xe0c8ff, 0.85, { collapse: 3 });

decor.push({ type: 'flag', x: -19.5, y: 7, z: -19.5, data: { text: 'BOING' } });
decor.push({ type: 'flag', x: 19.5, y: 7, z: 19.5, data: { text: 'BOING' } });
decor.push({ type: 'balloons', x: 0, y: 4.5, z: 0, color: 0xff6fa8 });
decor.push({ type: 'tubeMan', x: 19.5, y: 7, z: -19.5, color: 0xff3b30 });
decor.push({ type: 'tubeMan', x: -19.5, y: 7, z: 19.5, color: 0x34c759 });

export const BOUNCE_HOUSE: MapDef = {
  id: 'bounceHouse',
  name: 'Bounce Castle',
  solids,
  bouncePads: [],
  spawns: [
    [-14, 0, -14, 0],
    [14, 0, -14, 0],
    [-14, 0, 14, 0],
    [14, 0, 14, 0],
    [0, 0, -12, 0],
    [0, 0, 12, 0],
    [-12, 0, 0, 0],
    [12, 0, 0, 0],
    [-7, 0, -7, 0],
    [7, 0, 7, 0],
  ],
  blast: { minX: -70, maxX: 70, minY: -32, maxY: 70, minZ: -70, maxZ: 70 },
  pickups: [
    [0, 4.5, 0],
    [-19.5, 7, -19.5],
    [19.5, 7, 19.5],
    [0, 0, 33],
    [0, 0, -33],
  ],
  decor,
  theme: { skyTop: 0x7ab8ff, skyHorizon: 0xffd6f0, skyBottom: 0xfff4fb, fog: 0xffe6f4, sun: 0xfff4e0, ambient: 0xffd6f0, cloud: 0xffffff },
};
