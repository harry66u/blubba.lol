import type { DecorDef, SolidDef } from './types';

/**
 * Props that are also cover, shared by several maps: each adds its collision boxes (drawn by a
 * decor entry, like the parked cars) to `solids` and its look to `decor`.
 */

/**
 * A food truck `alongX` or along z, front toward +x/+z (or -x/-z with `flip`), serving window on
 * its right-hand side and a giant snack on the roof. Its roof can be climbed via the cab.
 */
export function foodTruck(
  solids: SolidDef[],
  decor: DecorDef[],
  x: number,
  y: number,
  z: number,
  opts: { alongX: boolean; flip?: boolean; color: number; text: string; snack: 'hotdog' | 'donut' | 'taco'; collapse?: number },
): void {
  const f = opts.flip ? -1 : 1;
  const part = (a0: number, a1: number, half: number, h: number) => {
    const [p, q] = [f * a0, f * a1].sort((u, v) => u - v);
    const min: [number, number, number] = opts.alongX ? [x + p, y, z - half] : [x - half, y, z + p];
    const max: [number, number, number] = opts.alongX ? [x + q, y + h, z + half] : [x + half, y + h, z + q];
    solids.push({ min, max, kind: 'hidden', ledge: true, collapse: opts.collapse });
  };
  part(-3.2, 1.6, 1.2, 2.85); // cargo box
  part(1.6, 3.2, 1.1, 2.05); // cab
  decor.push({
    type: 'foodTruck',
    x,
    y,
    z,
    rotY: (opts.alongX ? Math.PI / 2 : 0) + (opts.flip ? Math.PI : 0),
    color: opts.color,
    data: { text: opts.text, snack: opts.snack },
  });
}

/** A balloon arch `span` wide (along x, or along z when `alongZ`), with thin balloon columns for legs. */
export function balloonArch(solids: SolidDef[], decor: DecorDef[], x: number, y: number, z: number, span: number, alongZ = false, collapse?: number): void {
  for (const s of [-1, 1]) {
    const lx = alongZ ? x : x + (s * span) / 2;
    const lz = alongZ ? z + (s * span) / 2 : z;
    solids.push({ min: [lx - 0.35, y, lz - 0.35], max: [lx + 0.35, y + 3, lz + 0.35], kind: 'hidden', ledge: false, collapse });
  }
  decor.push({ type: 'balloonArch', x, y, z, rotY: alongZ ? Math.PI / 2 : 0, data: { span, h: 4.6 } });
}
