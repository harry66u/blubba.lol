/**
 * Shot geometry shared by the server simulation, client-side shot prediction, and bots: lobbed
 * shot directions, the Bubble Shotgun's fixed pellet pattern, and aiming a lob.
 */
import type { WeaponStats } from './loadout';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Launch direction of a projectile aimed along (dx, dy, dz): lobbed weapons add some loft. */
export function shotDir(w: WeaponStats, dx: number, dy: number, dz: number, out: Vec3): Vec3 {
  const y = dy + w.projLoft;
  const l = Math.hypot(dx, y, dz) || 1;
  out.x = dx / l;
  out.y = y / l;
  out.z = dz / l;
  return out;
}

/** Half-angle of the pellet ring for a shot with the given charge (0 = tap, 1 = full). */
export function spreadAt(w: WeaponStats, charge: number): number {
  const c = Math.max(0, Math.min(1, charge));
  return w.spread * (1 - (1 - w.spreadCharged) * c);
}

/**
 * The Bubble Shotgun's pattern: one pellet straight ahead, the rest in an even ring at `spread`
 * radians around it. No randomness, so every shot of the same charge lands the same way.
 * Writes 3 numbers (a unit direction) per pellet into `out`.
 */
export function pelletDirs(dx: number, dy: number, dz: number, spread: number, n: number, out: number[]): number[] {
  out.length = 0;
  out.push(dx, dy, dz);
  if (n <= 1) return out;
  // Right and up vectors perpendicular to the aim.
  let rx = -dz;
  let rz = dx;
  let rl = Math.hypot(rx, rz);
  if (rl < 1e-4) {
    rx = 1;
    rz = 0;
    rl = 1;
  }
  rx /= rl;
  rz /= rl;
  const ux = -rz * dy;
  const uy = rz * dx - rx * dz;
  const uz = rx * dy;
  const t = Math.tan(spread);
  const ring = n - 1;
  for (let i = 0; i < ring; i++) {
    const a = (i / ring) * Math.PI * 2 + Math.PI / 2;
    const c = Math.cos(a) * t;
    const s = Math.sin(a) * t;
    const px = dx + rx * c + ux * s;
    const py = dy + uy * s;
    const pz = dz + rz * c + uz * s;
    const l = Math.hypot(px, py, pz) || 1;
    out.push(px / l, py / l, pz / l);
  }
  return out;
}

/** Punch multiplier for a pellet that travelled `dist` meters. */
export function pelletFalloff(w: WeaponStats, dist: number): number {
  if (dist <= w.falloffStart) return 1;
  const f = Math.min(1, (dist - w.falloffStart) / Math.max(0.1, w.range - w.falloffStart));
  return 1 - w.falloff * f;
}

/**
 * Look pitch that lands a lobbed shot (speed, gravity, loft) on a point `dist` meters away
 * horizontally and `dh` meters above the muzzle, on the low arc. Null if it's out of reach.
 */
export function lobPitch(speed: number, gravity: number, loft: number, dist: number, dh: number): number | null {
  if (dist < 0.5) return -1.2;
  const v2 = speed * speed;
  // Height of the arc at `dist` for a launch angle th (rises until the max-reach angle).
  const heightAt = (th: number) => dist * Math.tan(th) - (gravity * dist * dist) / (2 * v2 * Math.cos(th) ** 2);
  const top = Math.min(1.45, Math.atan(v2 / (gravity * dist)));
  if (heightAt(top) < dh) return null;
  let lo = -1.3;
  let hi = top;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (heightAt(mid) < dh) lo = mid;
    else hi = mid;
  }
  const th = (lo + hi) / 2;
  // The weapon adds `loft` to the aim's vertical direction; undo that.
  const k = Math.max(-1, Math.min(1, loft * Math.cos(th)));
  return th - Math.asin(k);
}
