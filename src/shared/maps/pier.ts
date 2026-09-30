import type { DecorDef, MapDef, SolidDef } from './types';

/**
 * "Sky Pier": a seaside boardwalk floating in the sky. Fictional; not based on any real pier.
 *
 * Layout (top view, +x east, +z south):
 *   - Main plank boardwalk 50 x 32 with snack stands for cover and a lifeguard tower (crate steps
 *     to its lookout) in the north-east corner.
 *   - A narrow pier runs south off the boardwalk (no railings) to a pier head with a ferris wheel.
 *   - North sand island, reached by jumping, with a bounce pad back onto the boardwalk.
 *   - West inflatable pool float with a bounce pad back.
 *   - East inflatable pool float reached by a shuttling ferry raft, with a bounce pad back.
 */

const solids: SolidDef[] = [];
const decor: DecorDef[] = [];

function box(min: [number, number, number], max: [number, number, number], kind: SolidDef['kind'], extra: Partial<SolidDef> = {}) {
  solids.push({ min, max, kind, ...extra });
}

const WOOD = 0xc49064;

/**
 * A snack stand: a counter box under a puffy awning roof, with a pennant on top. Pennants are seen
 * from both sides, so their words read the same in a mirror.
 */
function stand(x: number, z: number, body: number, roof: number, text: string) {
  box([x - 1.8, 0, z - 1.2], [x + 1.8, 2.3, z + 1.2], 'building', { ledge: true, color: body });
  box([x - 2.1, 2.3, z - 1.5], [x + 2.1, 2.8, z + 1.5], 'bouncy', { ledge: true, color: roof });
  decor.push({ type: 'flag', x: x - 1.2, y: 2.8, z, data: { text } });
}

// --- Main boardwalk -----------------------------------------------------------------------------
box([-25, -2.5, -16], [25, 0, 16], 'lot', { ledge: true, collapse: 0, color: WOOD });

// Snack stands (pastel bodies and awnings so the players stay the brightest things on screen).
stand(-14.2, -9.2, 0xfff1d6, 0xff9a9a, 'MMM');
stand(12.6, 7.2, 0xe3f3ff, 0x8fd0ff, 'MMM');
stand(-6.2, 9.2, 0xfff6c8, 0xffd27a, 'MMM');

// Lifeguard tower in the north-east corner: a lookout on stilts reached by crate steps.
box([16, 3.8, -15], [21, 4.2, -11], 'concrete', { ledge: true, collapse: 1, color: 0xf08a7e });
for (const [x, z] of [
  [16.3, -14.7],
  [20.7, -14.7],
  [16.3, -11.3],
  [20.7, -11.3],
]) box([x - 0.25, 0, z - 0.25], [x + 0.25, 3.8, z + 0.25], 'pillar', { ledge: false, collapse: 1, color: 0xf4f1ea });
box([12.6, 0, -14.6], [14.4, 1.3, -12.8], 'crate', { ledge: true, collapse: 1 });
box([14.4, 0, -14.6], [16, 2.7, -12.8], 'crate', { ledge: true, collapse: 1 });
decor.push({ type: 'umbrella', x: 19.2, y: 4.2, z: -13.6, color: 0xff5a5a });

// A couple of stacked crates by the west edge for low cover.
box([-21.5, 0, 3], [-19.5, 1.3, 5], 'crate', { ledge: true, collapse: 1 });
box([-21.5, 0, 5], [-19.5, 2.4, 7], 'crate', { ledge: true, collapse: 1 });

// --- The pier: a narrow walkway south to the pier head, which crumbles from its far end ----------
box([-3.5, -1.5, 16], [3.5, 0, 30], 'lot', { ledge: true, collapse: 1, color: WOOD });
box([-9, -2, 30], [9, 0, 39], 'lot', { ledge: true, collapse: 2, color: WOOD });
decor.push({ type: 'ferrisWheel', x: 0, y: 0, z: 37, data: { radius: 8 } });

// --- North sand island (reached by jumping or blast jumping) -------------------------------------
box([-10, -1.5, -31], [10, 1.2, -22.5], 'island', { ledge: true, collapse: 3, color: 0xf3dfb0 });
decor.push({ type: 'sign', x: 0, y: 1.2, z: -29.6, data: { text: 'SKY PIER' } });
decor.push({ type: 'umbrella', x: -6.5, y: 1.2, z: -26.5, color: 0xff6fa8 });
decor.push({ type: 'umbrella', x: 6.5, y: 1.2, z: -26.5, color: 0x6fd3ff });
decor.push({ type: 'balloons', x: -8.5, y: 1.2, z: -29.5, color: 0xffd60a });

// --- West inflatable pool float with a bounce pad back onto the boardwalk ------------------------
box([-41, -2.8, -5], [-33, -0.8, 5], 'bouncy', { ledge: true, collapse: 2, color: 0xff9fd0, bounce: 0.6 });

// --- East pool float + a ferry raft shuttling to it ---------------------------------------------
box([36, -2, -12], [44, 0, -2], 'bouncy', { ledge: true, collapse: 2, color: 0xffe39a, bounce: 0.6 });
box([25.6, -0.6, -9], [29.6, 0, -5], 'platform', {
  ledge: true,
  color: 0xf4f1ea,
  mover: { dx: 6, dy: 0, dz: 0, period: 7 },
});

// --- Scenery --------------------------------------------------------------------------------------
// Bunting over the way onto the pier and across the north edge of the boardwalk; pennants along
// the pier (they sink with it).
decor.push({ type: 'pole', x: -3.2, y: 0, z: 15.6 });
decor.push({ type: 'pole', x: 3.2, y: 0, z: 15.6 });
decor.push({ type: 'bunting', x: -3.2, y: 4.2, z: 15.6, data: { x2: 3.2, y2: 4.2, z2: 15.6 } });
decor.push({ type: 'flag', x: -3.1, y: 0, z: 20, data: { text: 'WOW' } });
decor.push({ type: 'flag', x: -3.1, y: 0, z: 26, data: { text: 'YAY' } });
decor.push({ type: 'pole', x: -24.5, y: 0, z: -15.5 });
decor.push({ type: 'pole', x: 11.5, y: 0, z: -15.5 });
decor.push({ type: 'bunting', x: -24.5, y: 4.2, z: -15.5, data: { x2: 11.5, y2: 4.2, z2: -15.5 } });
// Beach umbrellas and balloons around the boardwalk.
decor.push({ type: 'umbrella', x: -3, y: 0, z: -6, color: 0xffd60a });
decor.push({ type: 'umbrella', x: 7, y: 0, z: -9.5, color: 0x9dff6f });
decor.push({ type: 'umbrella', x: 16, y: 0, z: 1.5, color: 0xc49bff });
decor.push({ type: 'balloons', x: -11.4, y: 0, z: -8, color: 0xff6fa8 });
decor.push({ type: 'balloons', x: 15.8, y: 0, z: 8.4, color: 0x6fd3ff });
decor.push({ type: 'balloons', x: 7.5, y: 0, z: 34, color: 0xffd60a });
decor.push({ type: 'tires', x: -7.5, y: 0, z: 37.5 });

export const PIER: MapDef = {
  id: 'pier',
  name: 'Sky Pier',
  icon: '🎡',
  deck: 'planks',
  solids,
  bouncePads: [
    { x: 0, y: 1.2, z: -24.3, half: 1.2, strength: 17, pushX: 0, pushZ: 10 },
    { x: -36, y: -0.8, z: 0, half: 1.3, strength: 21, pushX: 11, pushZ: 0 },
    { x: 40.5, y: 0, z: -7, half: 1.3, strength: 20, pushX: -14, pushZ: 0 },
  ],
  spawns: [
    [-19, 0, -3, 0],
    [-8, 0, -12, 0],
    [1, 0, -11, 0],
    [10, 0, -6, 0],
    [19, 0, -4, 0],
    [19, 0, 10, 0],
    [5, 0, 11, 0],
    [-15, 0, 10, 0],
    [-6, 0, 2, 0],
    [6, 0, 1, 0],
  ],
  blast: { minX: -72, maxX: 72, minY: -32, maxY: 60, minZ: -68, maxZ: 68 },
  pickups: [
    [0, 0, -2],
    [18.5, 4.2, -13],
    [0, 1.2, -28],
    [0, 0, 33],
    [-38.5, -0.8, 2],
    [40, 0, -10],
  ],
  decor,
  // Seaside noon: aqua sky fading to sea blue below the horizon.
  theme: {
    skyTop: 0x2f9fe8,
    skyHorizon: 0xc4f1ee,
    skyBottom: 0x8fd8e8,
    fog: 0xcdeff2,
    sun: 0xfff0d0,
    ambient: 0xbfe8f0,
    cloud: 0xffffff,
  },
};
