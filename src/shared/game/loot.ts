import { BALANCE } from '../balance';
import type { MapDef } from '../maps/types';
import type { Solid, World } from '../world';
import type { LootKind } from './events';

export type { LootKind } from './events';

/**
 * Floor loot (supply crates) and the gadgets that live in the world for a while (Air Mines,
 * Tornados). The server simulation owns them; the pure helpers here are shared with the client so
 * it can draw crates and tornados moving the same way.
 */

export const LOOT_KINDS: readonly LootKind[] = ['deflate', 'mega', 'turbo', 'gadgets', 'feather', 'spring'];

export const LOOT_INFO: Record<LootKind, { name: string; icon: string; blurb: string; color: string }> = {
  deflate: { name: 'Deflate', icon: '🩹', blurb: `Pssst... ${Math.round(BALANCE.loot.deflate * 100)}% of your air let out`, color: '#7fe0ff' },
  mega: { name: 'Mega Shells', icon: '💥', blurb: `Your next ${BALANCE.loot.megaShots} shots are Mega Blasts`, color: '#ffb020' },
  turbo: { name: 'Turbo Tank', icon: '⚡', blurb: `Full ammo and double-speed reloads for ${BALANCE.loot.turboSeconds}s`, color: '#ffd60a' },
  gadgets: { name: 'Gadget Refill', icon: '🔋', blurb: 'Both gadgets are ready again', color: '#8ee000' },
  feather: { name: 'Feather', icon: '🪶', blurb: `Floaty low gravity for ${BALANCE.loot.featherSeconds}s`, color: '#e2d4ff' },
  spring: { name: 'Spring Shoes', icon: '👟', blurb: `Your next ${BALANCE.loot.springJumps} jumps are super jumps`, color: '#ff5fd2' },
};

/** What the grabber has going for them, so the roll skips effects that would do nothing. */
export interface LootContext {
  inflation: number;
  /** Stream weapons (Leaf Blower) have no shots for Mega Shells to power up. */
  stream: boolean;
  /** Both gadgets are already off cooldown. */
  gadgetsReady: boolean;
}

/** Weighted pick. Deflate is likelier the more inflated you are (it's the comeback item). */
export function rollLoot(rng: () => number, c: LootContext): LootKind {
  const W = BALANCE.loot.weights;
  const opts: [LootKind, number][] = [];
  if (c.inflation >= 0.05) opts.push(['deflate', W.deflate * (0.5 + c.inflation * 1.5)]);
  if (!c.stream) opts.push(['mega', W.mega]);
  opts.push(['turbo', W.turbo]);
  if (!c.gadgetsReady) opts.push(['gadgets', W.gadgets]);
  opts.push(['feather', W.feather], ['spring', W.spring]);
  let total = 0;
  for (const [, w] of opts) total += w;
  let r = rng() * total;
  for (const [k, w] of opts) {
    r -= w;
    if (r < 0) return k;
  }
  return opts[opts.length - 1][0];
}

// --- Crates ----------------------------------------------------------------------------------

export interface LootCrate {
  id: number;
  x: number;
  /** Bottom of the crate. */
  y: number;
  z: number;
  /** Drifting down under its balloon (false once it has landed). */
  falling: boolean;
  /** Downward speed while falling (m/s). Crates that lose their ground drop faster. */
  fall: number;
  /** Solid it rests on (-1 while falling). */
  ground: number;
  /** Sim time it landed (Infinity while falling). */
  landedAt: number;
  /** Debug drops can force what's inside. */
  forced: LootKind | null;
}

/** Solid whose top is the highest one under (x, z) between y - maxDrop and y. */
export function floorBelow(world: World, x: number, y: number, z: number, maxDrop: number): Solid | null {
  let best: Solid | null = null;
  for (const s of world.solids) {
    if (!s.enabled) continue;
    if (x < s.minX || x > s.maxX || z < s.minZ || z > s.maxZ) continue;
    if (s.maxY > y + 0.05 || s.maxY < y - maxDrop) continue;
    if (!best || s.maxY > best.maxY) best = s;
  }
  return best;
}

/** Lowest height a crate (or mine) can sink to before it counts as lost. */
export function lostBelow(map: MapDef): number {
  let lo = Infinity;
  for (const s of map.spawns) lo = Math.min(lo, s[1]);
  return Math.max(map.blast.minY + 2, lo - 14);
}

/**
 * Moves a crate one step: it drifts down until it touches ground, then rides that piece (moving
 * platforms, sinking islands). If the piece crumbles away under it, it falls again.
 * Returns 'land' on the step it lands, 'lost' once it has sunk out of play.
 */
export function stepCrate(c: LootCrate, world: World, dt: number, lostY: number): 'land' | 'lost' | null {
  if (!c.falling) {
    const s = world.solid(c.ground);
    if (s && s.enabled && c.x >= s.minX && c.x <= s.maxX && c.z >= s.minZ && c.z <= s.maxZ) {
      c.x += s.dX;
      c.z += s.dZ;
      c.y = s.maxY;
      return c.y < lostY ? 'lost' : null;
    }
    // The ground went away: the balloon can't hold it up.
    c.falling = true;
    c.ground = -1;
    c.fall = 2;
  }
  if (c.landedAt < Infinity) c.fall = Math.min(20, c.fall + 14 * dt);
  const drop = c.fall * dt;
  const g = floorBelow(world, c.x, c.y, c.z, drop + 0.05);
  if (g) {
    c.y = g.maxY;
    c.falling = false;
    c.ground = g.id;
    // The caller records when it first landed.
    return c.landedAt === Infinity ? 'land' : null;
  }
  c.y -= drop;
  return c.y < lostY ? 'lost' : null;
}

const FLOOR_KINDS = new Set(['lot', 'island', 'concrete', 'bouncy', 'platform']);

function spotOk(world: World, x: number, z: number, top: number, floorId: number, dropHeight: number): boolean {
  // Nothing overhead: a ray from the sky must come straight down onto this floor.
  const hit = world.raycast(x, top + dropHeight, z, 0, -1, 0, dropHeight + 0.5);
  if (!hit || hit.solidId !== floorId || Math.abs(hit.y - top) > 0.02) return false;
  // Solid footing all around the crate, so it's never on an edge you'd fall off grabbing it (and
  // nothing standing there).
  const h = 1.2;
  for (const [ox, oz] of [
    [-h, -h],
    [h, -h],
    [-h, h],
    [h, h],
  ]) {
    const g = world.groundBelow(x + ox, top + 30, z + oz, 31);
    if (g === null || Math.abs(g - top) > 0.02) return false;
  }
  return !world.boxBlocked(x - 0.6, top + 0.02, z - 0.6, x + 0.6, top + 1.6, z + 0.6);
}

/**
 * Picks a random walkable spot for a supply drop: a point on a static floor near spawn height (the
 * main deck and islands, never roofs or the void), open to the sky, with solid footing all around,
 * and away from other crates. With `near`, it looks within that circle instead (debug drops).
 * Returns null if nothing suitable turns up.
 */
export function pickLootSpot(
  world: World,
  map: MapDef,
  rng: () => number,
  avoid: readonly { x: number; z: number }[],
  near?: { x: number; y: number; z: number; r: number },
): { x: number; y: number; z: number; floor: number } | null {
  const L = BALANCE.loot;
  const far = (x: number, z: number) => avoid.every((a) => Math.hypot(a.x - x, a.z - z) >= L.spacing) && map.pickups.every(([px, , pz]) => Math.hypot(px - x, pz - z) >= 2);
  if (near) {
    for (let i = 0; i < 40; i++) {
      const a = rng() * Math.PI * 2;
      const d = near.r * (0.4 + 0.6 * rng());
      const x = near.x + Math.cos(a) * d;
      const z = near.z + Math.sin(a) * d;
      const f = floorBelow(world, x, near.y + 3, z, 8);
      if (f && !f.mover && spotOk(world, x, z, f.maxY, f.id, L.dropHeight)) return { x, y: f.maxY, z, floor: f.id };
    }
    return null;
  }
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of map.spawns) {
    lo = Math.min(lo, s[1]);
    hi = Math.max(hi, s[1]);
  }
  // Pieces about to sink in the final collapse get no more drops.
  const collapsing = world.time > world.collapseStart - 8;
  const floors: Solid[] = [];
  let total = 0;
  for (let i = 0; i < world.staticCount; i++) {
    const s = world.solids[i];
    const def = map.solids[i];
    if (!s.enabled || s.mover || !def || !FLOOR_KINDS.has(def.kind)) continue;
    if (s.maxY < lo - 3 || s.maxY > hi + 2) continue;
    if (s.maxX - s.minX < 3.5 || s.maxZ - s.minZ < 3.5) continue;
    if (collapsing && s.collapse >= 1) continue;
    floors.push(s);
    total += (s.maxX - s.minX) * (s.maxZ - s.minZ);
  }
  if (!floors.length) return null;
  for (let i = 0; i < 40; i++) {
    let r = rng() * total;
    let f = floors[floors.length - 1];
    for (const s of floors) {
      r -= (s.maxX - s.minX) * (s.maxZ - s.minZ);
      if (r < 0) {
        f = s;
        break;
      }
    }
    const m = 1.4;
    const x = f.minX + m + rng() * (f.maxX - f.minX - 2 * m);
    const z = f.minZ + m + rng() * (f.maxZ - f.minZ - 2 * m);
    if (!far(x, z)) continue;
    if (spotOk(world, x, z, f.maxY, f.id, L.dropHeight)) return { x, y: f.maxY, z, floor: f.id };
  }
  return null;
}

// --- Tornados ----------------------------------------------------------------------------------

export interface Tornado {
  id: number;
  owner: number;
  x: number;
  /** Base of the column. */
  y: number;
  z: number;
  /** Unit heading on the ground plane. */
  dx: number;
  dz: number;
  speed: number;
  /** Tick it dies out. */
  until: number;
}

/**
 * Rolls a tornado forward one step: it bounces off walls, rides over low stuff (cars, crates, curbs),
 * drops down ledges, and keeps its height when it drifts out over the void.
 */
export function stepTornado(t: Tornado, world: World, dt: number): void {
  const r = 0.4;
  const nx = t.x + t.dx * t.speed * dt;
  if (world.boxBlocked(nx - r, t.y + 1.4, t.z - r, nx + r, t.y + 3, t.z + r)) t.dx = -t.dx;
  else t.x = nx;
  const nz = t.z + t.dz * t.speed * dt;
  if (world.boxBlocked(t.x - r, t.y + 1.4, nz - r, t.x + r, t.y + 3, nz + r)) t.dz = -t.dz;
  else t.z = nz;
  const g = world.groundBelow(t.x, t.y + 1.4, t.z, 6);
  if (g !== null) t.y += (g - t.y) * Math.min(1, 8 * dt);
}

// --- Air Mines -----------------------------------------------------------------------------------

export interface AirMine {
  id: number;
  owner: number;
  x: number;
  y: number;
  z: number;
  /** Solid it's stuck to. */
  ground: number;
  armAt: number;
  expires: number;
}
