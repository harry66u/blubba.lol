import type { DecorDef, MapDef, SolidDef } from './types';

/**
 * "Pump Station": two floating bases joined through a middle island. Stand on your team's pumps
 * to inflate your giant tube man; knock enemies off theirs.
 */
const solids: SolidDef[] = [];
const decor: DecorDef[] = [];
const box = (min: [number, number, number], max: [number, number, number], kind: SolidDef['kind'], extra: Partial<SolidDef> = {}) => solids.push({ min, max, kind, ...extra });

box([-40, -2.5, -12], [-18, 0, 12], 'lot', { ledge: true, color: 0xf0b8c4 });
box([18, -2.5, -12], [40, 0, 12], 'lot', { ledge: true, color: 0xb8d8f0 });
box([-10, -2, -10], [10, 0.5, 10], 'island', { ledge: true });
box([-18, -1, -2.5], [-10, 0, 2.5], 'concrete', { ledge: true });
box([10, -1, -2.5], [18, 0, 2.5], 'concrete', { ledge: true });
// Pedestals behind each base where the giant tube men stand.
box([-52, -3, -4], [-45, 0.5, 4], 'island', { ledge: true });
box([45, -3, -4], [52, 0.5, 4], 'island', { ledge: true });
box([-6, -1.5, -24], [6, 0.8, -16], 'island', { ledge: true, collapse: 3 });
box([-6, -1.5, 16], [6, 0.8, 24], 'island', { ledge: true, collapse: 3 });
// Cover on each base and in the middle.
box([-28, 0, -8], [-26, 1.6, -3], 'crate', { ledge: true });
box([-28, 0, 3], [-26, 1.6, 8], 'crate', { ledge: true });
box([26, 0, -8], [28, 1.6, -3], 'crate', { ledge: true });
box([26, 0, 3], [28, 1.6, 8], 'crate', { ledge: true });
box([-1.5, 0.5, -6], [1.5, 2.3, -3], 'crate', { ledge: true });
box([-1.5, 0.5, 3], [1.5, 2.3, 6], 'crate', { ledge: true });

decor.push({ type: 'balloons', x: 0, y: 0.8, z: -20, color: 0xffd60a });
decor.push({ type: 'balloons', x: 0, y: 0.8, z: 20, color: 0x8ee000 });

export const PUMP_ARENA: MapDef = {
  id: 'pumpArena',
  name: 'Pump Station',
  modes: ['pump'],
  solids,
  bouncePads: [
    { x: -20, y: 0, z: 8, half: 1.1, strength: 18, pushX: 9, pushZ: 0 },
    { x: 20, y: 0, z: -8, half: 1.1, strength: 18, pushX: -9, pushZ: 0 },
    { x: 0, y: 0.8, z: -20, half: 1.1, strength: 18, pushX: 0, pushZ: 9 },
    { x: 0, y: 0.8, z: 20, half: 1.1, strength: 18, pushX: 0, pushZ: -9 },
    // A way back from the giants' pedestals (a 5 m gap with no way across stranded people there).
    { x: -46.5, y: 0.5, z: 0, half: 1.1, strength: 17, pushX: 10, pushZ: 0 },
    { x: 46.5, y: 0.5, z: 0, half: 1.1, strength: 17, pushX: -10, pushZ: 0 },
  ],
  spawns: [
    [-32, 0, -6, 0],
    [-32, 0, 6, 0],
    [32, 0, -6, 0],
    [32, 0, 6, 0],
  ],
  teamSpawns: [
    [
      [-35, 0, -8],
      [-35, 0, 8],
      [-30, 0, 0],
      [-24, 0, -6],
      [-24, 0, 6],
    ],
    [
      [35, 0, -8],
      [35, 0, 8],
      [30, 0, 0],
      [24, 0, -6],
      [24, 0, 6],
    ],
  ],
  pumps: [
    { team: 0, x: -31, y: 0, z: 0, r: 2.6 },
    { team: 0, x: -6, y: 0.5, z: 0, r: 2.4 },
    { team: 1, x: 31, y: 0, z: 0, r: 2.6 },
    { team: 1, x: 6, y: 0.5, z: 0, r: 2.4 },
  ],
  giants: [
    { team: 0, x: -48.5, y: 0.5, z: 0 },
    { team: 1, x: 48.5, y: 0.5, z: 0 },
  ],
  blast: { minX: -85, maxX: 85, minY: -32, maxY: 60, minZ: -60, maxZ: 60 },
  pickups: [
    [0, 0.5, -8],
    [0, 0.5, 8],
    [0, 0.8, -22],
    [0, 0.8, 22],
  ],
  decor,
  theme: { skyTop: 0x4a9ff5, skyHorizon: 0xd6ecff, skyBottom: 0xf3f8ff, fog: 0xd8ecff, sun: 0xfff1d6, ambient: 0xc8e0ff, cloud: 0xffffff },
};
