import { lookDir } from '../../shared/player';
import type { World } from '../../shared/world';

type Vec = { x: number; y: number; z: number };

/** Third-person chase camera placement (meters, scaled by how inflated you are). */
export const CHASE = {
  /** Distance behind the pivot, along the view direction. */
  back: 3.6,
  /** Height above the eye. */
  up: 0.5,
  /** Over-the-right-shoulder offset, so your own body doesn't hide the reticle. */
  side: 0.65,
  /** When looking up, the camera orbits down by only this fraction of the view pitch. */
  upOrbit: 0.3,
  /** Gap kept between the camera and any wall or floor it backs into. */
  pad: 0.3,
  /** How far the reticle ray looks for something to aim at. */
  aimRange: 160,
};

/**
 * Places the chase camera behind and slightly above `pivot` (the eye), looking along yaw/pitch.
 * Geometry between the pivot and the camera pulls the camera in so it never clips through
 * walls or the floor. `maxBack` caps the distance (for easing back out after a pull-in).
 * Returns how far behind the shoulder point the camera ended up. `out` may alias `pivot`.
 */
export function chaseCamera(world: World, pivot: Vec, yaw: number, pitch: number, scale: number, out: Vec, maxBack = Infinity): number {
  const f = lookDir(yaw, pitch, { x: 0, y: 0, z: 0 });
  const rx = Math.cos(yaw);
  const rz = -Math.sin(yaw);
  // Shoulder point: out to the side and up, stopping short of anything in between.
  let sx = rx * CHASE.side * scale;
  let sy = CHASE.up * scale;
  let sz = rz * CHASE.side * scale;
  const sl = Math.hypot(sx, sy, sz);
  const hs = world.raycast(pivot.x, pivot.y, pivot.z, sx / sl, sy / sl, sz / sl, sl + CHASE.pad);
  if (hs) {
    const k = Math.max(0, hs.dist - CHASE.pad) / sl;
    sx *= k;
    sy *= k;
    sz *= k;
  }
  const ox = pivot.x + sx;
  const oy = pivot.y + sy;
  const oz = pivot.z + sz;
  // Then back, opposite the view direction. Looking up swings the camera down less than the view
  // tilts, so it doesn't end up on the floor staring at your back (aim follows the reticle ray
  // either way).
  const b = pitch > 0 ? lookDir(yaw, pitch * CHASE.upOrbit, { x: 0, y: 0, z: 0 }) : f;
  const want = Math.max(0, Math.min(CHASE.back * scale, maxBack));
  const hb = world.raycast(ox, oy, oz, -b.x, -b.y, -b.z, want + CHASE.pad);
  const dist = hb ? Math.max(0, hb.dist - CHASE.pad) : want;
  out.x = ox - b.x * dist;
  out.y = oy - b.y * dist;
  out.z = oz - b.z * dist;
  return dist;
}

/**
 * Aim for a third-person shot: finds what sits under the reticle (the first thing the camera
 * ray hits past your own character) and returns the yaw/pitch from your eye toward it, so shots
 * leave your gun and land where the reticle points. `hitPlayers` returns the nearest player hit
 * distance along a ray, or null.
 */
export function aimFromCamera(
  world: World,
  cam: Vec,
  yaw: number,
  pitch: number,
  eye: Vec,
  hitPlayers: (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number) => number | null,
  out: { yaw: number; pitch: number },
): void {
  const f = lookDir(yaw, pitch, { x: 0, y: 0, z: 0 });
  // Skip anything between the camera and your own position along the ray.
  const start = Math.max(0, (eye.x - cam.x) * f.x + (eye.y - cam.y) * f.y + (eye.z - cam.z) * f.z) + 0.4;
  const ox = cam.x + f.x * start;
  const oy = cam.y + f.y * start;
  const oz = cam.z + f.z * start;
  let t = CHASE.aimRange;
  const wh = world.raycast(ox, oy, oz, f.x, f.y, f.z, t);
  if (wh) t = wh.dist;
  const ph = hitPlayers(ox, oy, oz, f.x, f.y, f.z, t);
  if (ph !== null && ph < t) t = ph;
  const dx = ox + f.x * t - eye.x;
  const dy = oy + f.y * t - eye.y;
  const dz = oz + f.z * t - eye.z;
  const h = Math.hypot(dx, dz);
  // Very close targets would swing the aim wildly; the camera's own angles are good enough.
  if (Math.hypot(h, dy) < 1.5) {
    out.yaw = yaw;
    out.pitch = pitch;
    return;
  }
  out.yaw = Math.atan2(-dx, -dz);
  out.pitch = Math.max(-1.5, Math.min(1.5, Math.atan2(dy, h)));
}

/**
 * Re-expresses a movement stick (x = right, z = forward) given relative to `fromYaw` so it moves
 * the same way in the world when applied relative to `toYaw`.
 */
export function rebaseMove(mx: number, mz: number, fromYaw: number, toYaw: number): [number, number] {
  const c = Math.cos(fromYaw);
  const s = Math.sin(fromYaw);
  const wx = c * mx - s * mz;
  const wz = -s * mx - c * mz;
  const c2 = Math.cos(toYaw);
  const s2 = Math.sin(toYaw);
  return [wx * c2 - wz * s2, -wx * s2 - wz * c2];
}
