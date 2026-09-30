import type { DecorDef, MapDef, SolidDef } from './types';

/**
 * "Beach Blast": a floating pitch for Ball mode. Blast the giant beach ball into the other team's
 * goal. Low side walls keep the ball in play (mostly); players can still be launched over them.
 */
const solids: SolidDef[] = [];
const decor: DecorDef[] = [];
const box = (min: [number, number, number], max: [number, number, number], kind: SolidDef['kind'], extra: Partial<SolidDef> = {}) => solids.push({ min, max, kind, ...extra });

box([-32, -2.5, -18], [32, 0, 18], 'lot', { ledge: true, color: 0x7fc97a });
// Low side walls along the long edges.
box([-32, 0, -18.6], [32, 1.1, -18], 'concrete', { ledge: true });
box([-32, 0, 18], [32, 1.1, 18.6], 'concrete', { ledge: true });
for (const sgn of [-1, 1]) {
  const x0 = sgn > 0 ? 32 : -32.6;
  const x1 = sgn > 0 ? 32.6 : -32;
  // End walls either side of the goal mouth, and the crossbar.
  box([x0, 0, -18.6], [x1, 3, -5.6], 'concrete', { ledge: true });
  box([x0, 0, 5.6], [x1, 3, 18.6], 'concrete', { ledge: true });
  box([x0, 5, -5.6], [x1, 6, 5.6], 'goal', { ledge: false });
  // Goal box behind the line.
  const g0 = sgn > 0 ? 32 : -37;
  const g1 = sgn > 0 ? 37 : -32;
  box([g0, -2.5, -5.6], [g1, 0, 5.6], 'goal', { ledge: true });
  box([sgn > 0 ? 36.4 : -37, 0, -5.6], [sgn > 0 ? 37 : -36.4, 5, 5.6], 'goal', { ledge: false });
  box([g0, 0, -5.6], [g1, 5, -5], 'goal', { ledge: false });
  box([g0, 0, 5], [g1, 5, 5.6], 'goal', { ledge: false });
  box([g0, 5, -5.6], [g1, 5.6, 5.6], 'goal', { ledge: false });
  decor.push({ type: 'net', x: sgn * 34.5, y: 0, z: 0, color: sgn > 0 ? 0x2ec5ff : 0xff3b5c });
}
decor.push({ type: 'lines', x: 0, y: 0, z: 0, data: { field: 1 } });
decor.push({ type: 'umbrella', x: -20, y: 0, z: -21, color: 0xff6fa8 });
decor.push({ type: 'umbrella', x: 20, y: 0, z: 21, color: 0x6fd3ff });

export const BALL_ARENA: MapDef = {
  id: 'ballArena',
  name: 'Beach Blast',
  modes: ['ball'],
  solids,
  bouncePads: [],
  spawns: [
    [-20, 0, -8, 0],
    [-20, 0, 8, 0],
    [20, 0, -8, 0],
    [20, 0, 8, 0],
  ],
  teamSpawns: [
    [
      [-26, 0, -10],
      [-26, 0, 0],
      [-26, 0, 10],
      [-18, 0, -5],
      [-18, 0, 5],
    ],
    [
      [26, 0, -10],
      [26, 0, 0],
      [26, 0, 10],
      [18, 0, -5],
      [18, 0, 5],
    ],
  ],
  ball: {
    spawn: [0, 4, 0],
    radius: 1.6,
    goals: [
      { team: 0, min: [-36.4, -0.5, -5], max: [-32.4, 5, 5] },
      { team: 1, min: [32.4, -0.5, -5], max: [36.4, 5, 5] },
    ],
    fence: { minX: -32, maxX: 32, minZ: -18, maxZ: 18, height: 9 },
  },
  blast: { minX: -80, maxX: 80, minY: -32, maxY: 60, minZ: -60, maxZ: 60 },
  pickups: [
    [0, 0, -14],
    [0, 0, 14],
  ],
  decor,
  theme: { skyTop: 0x3fa9f5, skyHorizon: 0xbff0ff, skyBottom: 0xf0fbff, fog: 0xd4f2ff, sun: 0xfff6d6, ambient: 0xbfe6ff, cloud: 0xffffff },
};
