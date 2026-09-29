import type { DecorDef, MapDef, SolidDef } from './types';

/**
 * "Sugar Rush": a dessert land floating in a cotton-candy sky.
 *
 * Layout (top view, +x east, +z south):
 *   - Main cake 36 x 34, strawberry frosting with sprinkles, a three-tier cake in the middle and
 *     cupcakes to climb on.
 *   - East of it a chocolate river runs down a 6 m canyon (falling in is a knockout), crossed by a
 *     wafer bridge and a candy-stripe bridge.
 *   - East cookie plateau with gumdrops for cover and a wafer tower lookout reached by a
 *     marshmallow lift.
 *   - North and south jelly donuts: land in the jelly and it bounces you sky high. Bounce pads
 *     on the donuts lead back.
 *   - West chocolate bar island reached by a floating marshmallow raft, with a bounce pad back.
 */

const solids: SolidDef[] = [];
const decor: DecorDef[] = [];

function box(min: [number, number, number], max: [number, number, number], kind: SolidDef['kind'], extra: Partial<SolidDef> = {}): number {
  solids.push({ min, max, kind, ...extra });
  return solids.length - 1;
}

const FROSTING = 0xf9b3d2;
const COOKIE = 0xdca062;
const WAFER = 0xecc47e;
const CHOCOLATE = 0x7a4426;
const MARSHMALLOW = 0xfff6f0;

/** A cupcake to climb on: a square block you can stand on, drawn as a cupcake. */
function cupcake(x: number, z: number, wrapper: number, frosting: number) {
  box([x - 1.3, 0, z - 1.3], [x + 1.3, 1.7, z + 1.3], 'hidden', { ledge: true });
  decor.push({ type: 'cupcake', x, y: 0, z, color: wrapper, data: { r: 1.6, frosting } });
}

/** A gumdrop: low cover you can hop onto. */
function gumdrop(x: number, y: number, z: number, color: number, collapse?: number) {
  box([x - 0.85, y, z - 0.85], [x + 0.85, y + 1.1, z + 0.85], 'hidden', { ledge: false, collapse });
  decor.push({ type: 'gumdrop', x, y, z, color, data: { r: 1.15 } });
}

/**
 * A jelly donut island centered at (x, z): the ring is four collision strips around a bouncy jelly
 * middle, drawn as one big donut that sinks with the jelly.
 */
function donut(x: number, z: number) {
  const top = 0.8;
  const o = 6;
  const i = 2.4;
  const ring = { ledge: true, collapse: 3 };
  box([x - o, -0.8, z - o], [x + o, top, z - i], 'hidden', ring);
  box([x - o, -0.8, z + i], [x + o, top, z + o], 'hidden', ring);
  box([x - o, -0.8, z - i], [x - i, top, z + i], 'hidden', ring);
  box([x + i, -0.8, z - i], [x + o, top, z + i], 'hidden', ring);
  const jelly = box([x - i, -0.6, z - i], [x + i, 0.3, z + i], 'bouncy', { ledge: false, collapse: 3, color: 0xff4d6d, bounce: 0.9 });
  decor.push({ type: 'donut', x, y: top, z, ride: jelly, data: { outer: o, inner: i, h: 1.6 } });
}

// --- Main cake --------------------------------------------------------------------------------
// Thick, so the chocolate river flows in a real canyon between it and the cookie plateau.
box([-26, -4, -17], [10, 0, 17], 'lot', { ledge: true, collapse: 0, color: FROSTING });

// Three-tier cake in the middle (1.2 m tiers: one jump each).
box([-13, 0, -5], [-3, 1.2, 5], 'building', { ledge: true, color: 0xfff1f6, look: 'frosting' });
box([-11.5, 1.2, -3.5], [-4.5, 2.4, 3.5], 'building', { ledge: true, color: 0xffb3d1, look: 'frosting' });
box([-9.5, 2.4, -1.5], [-6.5, 3.4, 1.5], 'building', { ledge: true, color: 0xbff2dc, look: 'frosting' });
decor.push({ type: 'cherry', x: -8, y: 3.4, z: 0, data: { r: 0.7 } });

cupcake(-21, -11, 0x8fd3ff, 0xffffff);
cupcake(-21, 11, 0xc9a8ff, 0xffd0e4);
cupcake(4, -12, 0xffe08a, 0xb8f0d8);
cupcake(4, 11.5, 0xa8f0c0, 0xffc2dc);

decor.push({ type: 'sign', x: -8, y: 0, z: -15.6, data: { text: 'SUGAR RUSH' } });

// --- The chocolate river canyon and its bridges ---------------------------------------------------
decor.push({ type: 'chocoRiver', x: 13, y: -2.6, z: 0, data: { w: 6, len: 34 } });
box([10, -0.8, -9], [16, 0.2, -5.5], 'crate', { ledge: true, collapse: 1, color: WAFER, look: 'wafer' });
box([10, -0.6, 5], [16, 0.2, 7], 'candy', { ledge: true, collapse: 1, color: 0xffffff, look: 'candyStripe' });

// --- East cookie plateau --------------------------------------------------------------------------
box([16, -3, -13], [32, 0.4, 13], 'island', { ledge: true, collapse: 1, color: COOKIE, look: 'cookie' });
gumdrop(20.5, 0.4, 1, 0xff5f7e, 1);
gumdrop(26.5, 0.4, -1.5, 0x7ee081, 1);
gumdrop(23, 0.4, 7.5, 0xffc93c, 1);
// Wafer tower lookout (chocolate-dipped top) and the marshmallow lift up to it.
box([25, 0.4, -11.5], [30.5, 4.6, -6.5], 'building', { ledge: true, collapse: 1, color: WAFER, look: 'chocolate' });
box([21.2, 0, -10.6], [24.2, 0.4, -7.4], 'platform', {
  ledge: true,
  collapse: 1,
  color: MARSHMALLOW,
  look: 'candyStripe',
  mover: { dx: 0, dy: 4.2, dz: 0, period: 7 },
});
// A giant ice cream cone on the far edge (a landmark and a pillar to hide behind).
box([28.9, 0.4, 5.9], [31.1, 8.5, 8.1], 'hidden', { ledge: false, collapse: 1 });
decor.push({ type: 'iceCream', x: 30, y: 0.4, z: 7 });
decor.push({ type: 'candyCane', x: 31, y: 0.4, z: -12, rotY: Math.PI });
decor.push({ type: 'candyCane', x: 17.2, y: 0.4, z: 12, rotY: 0 });

// --- Jelly donuts north and south -----------------------------------------------------------------
donut(-8, -27.5);
donut(-8, 27.5);

// --- West chocolate bar island and the marshmallow raft ----------------------------------------------
box([-42, -2.4, -6], [-33, -0.4, 6], 'island', { ledge: true, collapse: 2, color: CHOCOLATE, look: 'chocolate' });
box([-29.6, -0.8, -1.8], [-26.2, -0.2, 1.8], 'platform', {
  ledge: true,
  collapse: 2,
  color: MARSHMALLOW,
  look: 'candyStripe',
  mover: { dx: -3.2, dy: 0, dz: 0, period: 7 },
});

// --- Scenery --------------------------------------------------------------------------------------
decor.push({ type: 'lollipop', x: -25, y: 0, z: -16, color: 0xff4d8d, data: { c2: 0xffffff, h: 5.5, r: 1.6 } });
decor.push({ type: 'lollipop', x: -25, y: 0, z: 16, color: 0x5ac8fa, data: { c2: 0xfff27a, h: 4.5, r: 1.3 } });
decor.push({ type: 'lollipop', x: 9, y: 0, z: -16, color: 0x8ee06a, data: { c2: 0xffffff, h: 4, r: 1.2 } });
decor.push({ type: 'lollipop', x: 9, y: 0, z: 16.2, color: 0xc28bff, data: { c2: 0xffd0ea, h: 5, r: 1.4 } });
decor.push({ type: 'lollipop', x: -40, y: -0.4, z: -5, color: 0xffa24d, data: { c2: 0xffffff, h: 4, r: 1.2 } });
decor.push({ type: 'tubeMan', x: -25, y: 0, z: -3, color: 0xff4d8d });
decor.push({ type: 'tubeMan', x: 31, y: 0.4, z: 0, color: 0x5ac8fa });
decor.push({ type: 'balloons', x: 7.5, y: 0, z: -3, color: 0xff6fa8 });
decor.push({ type: 'balloons', x: -40.5, y: -0.4, z: 4.5, color: 0xffd60a });

export const CANDY: MapDef = {
  id: 'candy',
  name: 'Sugar Rush',
  icon: '🍭',
  deck: 'frosting',
  underside: 'waffle',
  solids,
  bouncePads: [
    { x: -8, y: 0.8, z: -23.3, half: 1.1, strength: 17, pushX: 0, pushZ: 9 },
    { x: -8, y: 0.8, z: 23.3, half: 1.1, strength: 17, pushX: 0, pushZ: -9 },
    { x: -37.5, y: -0.4, z: 0, half: 1.3, strength: 21, pushX: 12, pushZ: 0 },
  ],
  spawns: [
    [-20, 0, -4, 0],
    [-20, 0, 5, 0],
    [-8, 0, -11.5, 0],
    [-8, 0, 11.5, 0],
    [4, 0, -4, 0],
    [4, 0, 4, 0],
    [24, 0.4, 3, 0],
    [20, 0.4, -9.5, 0],
  ],
  blast: { minX: -72, maxX: 72, minY: -32, maxY: 60, minZ: -68, maxZ: 68 },
  pickups: [
    [-8, 2.4, 2.6],
    [27.75, 4.6, -9],
    [-37.5, -0.4, 3.5],
    [-8, 0.8, -32],
    [-8, 0.8, 32],
    [0, 0, 0],
  ],
  decor,
  // Cotton-candy sky: periwinkle overhead fading to pink at the horizon.
  theme: {
    skyTop: 0x8f7cff,
    skyHorizon: 0xffc8ea,
    skyBottom: 0xfff2fa,
    fog: 0xffdcf1,
    sun: 0xfff1f6,
    ambient: 0xffd6f0,
    cloud: 0xffe4f4,
  },
};
