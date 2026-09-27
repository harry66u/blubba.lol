import { BALANCE } from './balance';
import type { BouncePadDef, MapDef, MoverDef } from './maps/types';

/** Axis-aligned solid in the collision world. Movers update their bounds every tick. */
export interface Solid {
  id: number;
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  ledge: boolean;
  enabled: boolean;
  mover: MoverDef | null;
  /** Bounds at mover offset 0. */
  baseMinX: number;
  baseMinY: number;
  baseMinZ: number;
  baseMaxX: number;
  baseMaxY: number;
  baseMaxZ: number;
  /** Displacement applied by the last `setTime` call (used to carry riders). */
  dX: number;
  dY: number;
  dZ: number;
  /** Extra vertical offset used when the piece is collapsing (final 30 seconds). */
  sink: number;
  /** Current sinking speed (m/s) of a collapsing piece. */
  sinkRate: number;
}

export interface RayHit {
  dist: number;
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  solidId: number;
}

export interface BouncePad extends BouncePadDef {
  id: number;
  /** Pads placed by players expire; map pads have no owner. */
  owner: number;
  expires: number;
}

const EPS = 1e-4;

/** Ping-pong offset with smooth easing at the ends. */
export function moverOffset(m: MoverDef, time: number): number {
  const phase = ((time / m.period + (m.phase ?? 0)) % 1 + 1) % 1;
  // 0 -> 1 -> 0 using a cosine so platforms ease in and out.
  return 0.5 - 0.5 * Math.cos(phase * Math.PI * 2);
}

export class World {
  readonly solids: Solid[] = [];
  readonly pads: BouncePad[] = [];
  time = 0;

  constructor(readonly map: MapDef) {
    map.solids.forEach((def, i) => {
      const s: Solid = {
        id: i,
        minX: def.min[0],
        minY: def.min[1],
        minZ: def.min[2],
        maxX: def.max[0],
        maxY: def.max[1],
        maxZ: def.max[2],
        ledge: def.ledge ?? (def.kind === 'lot' || def.kind === 'island' || def.kind === 'platform'),
        enabled: true,
        mover: def.mover ?? null,
        baseMinX: def.min[0],
        baseMinY: def.min[1],
        baseMinZ: def.min[2],
        baseMaxX: def.max[0],
        baseMaxY: def.max[1],
        baseMaxZ: def.max[2],
        dX: 0,
        dY: 0,
        dZ: 0,
        sink: 0,
        sinkRate: 0,
      };
      this.solids.push(s);
    });
    map.bouncePads.forEach((p, i) => this.pads.push({ ...p, id: i, owner: -1, expires: Infinity }));
    this.setTime(0);
  }

  /**
   * Moves every mover to its position at `time` and records each one's displacement over the
   * previous fixed step, so riders are carried the same way no matter how often this is called.
   */
  setTime(time: number): void {
    this.time = time;
    const dt = 1 / BALANCE.tickRate;
    for (const s of this.solids) {
      if (!s.mover && s.sink === 0 && s.sinkRate === 0) continue;
      let ox = 0;
      let oy = -s.sink;
      let oz = 0;
      s.dX = 0;
      s.dY = -s.sinkRate * dt;
      s.dZ = 0;
      if (s.mover) {
        const k = moverOffset(s.mover, time);
        const k0 = moverOffset(s.mover, time - dt);
        ox = s.mover.dx * k;
        oy += s.mover.dy * k;
        oz = s.mover.dz * k;
        s.dX = s.mover.dx * (k - k0);
        s.dY += s.mover.dy * (k - k0);
        s.dZ = s.mover.dz * (k - k0);
      }
      s.minX = s.baseMinX + ox;
      s.minY = s.baseMinY + oy;
      s.minZ = s.baseMinZ + oz;
      s.maxX = s.baseMaxX + ox;
      s.maxY = s.baseMaxY + oy;
      s.maxZ = s.baseMaxZ + oz;
    }
  }

  solid(id: number): Solid | undefined {
    return this.solids[id];
  }

  /**
   * Sweeps a box along one axis and returns the allowed displacement plus the id of the solid
   * that blocked it (-1 if none). The box is given by its min/max corners.
   */
  sweepAxis(
    axis: 0 | 1 | 2,
    d: number,
    minX: number,
    minY: number,
    minZ: number,
    maxX: number,
    maxY: number,
    maxZ: number,
    out: { d: number; hit: number },
  ): void {
    let hit = -1;
    for (const s of this.solids) {
      if (!s.enabled) continue;
      if (axis === 0) {
        if (maxY <= s.minY + EPS || minY >= s.maxY - EPS || maxZ <= s.minZ + EPS || minZ >= s.maxZ - EPS) continue;
        if (d > 0 && maxX <= s.minX + EPS) {
          const lim = s.minX - maxX;
          if (lim < d) {
            d = Math.max(0, lim - EPS);
            hit = s.id;
          }
        } else if (d < 0 && minX >= s.maxX - EPS) {
          const lim = s.maxX - minX;
          if (lim > d) {
            d = Math.min(0, lim + EPS);
            hit = s.id;
          }
        }
      } else if (axis === 1) {
        if (maxX <= s.minX + EPS || minX >= s.maxX - EPS || maxZ <= s.minZ + EPS || minZ >= s.maxZ - EPS) continue;
        if (d > 0 && maxY <= s.minY + EPS) {
          const lim = s.minY - maxY;
          if (lim < d) {
            d = Math.max(0, lim - EPS);
            hit = s.id;
          }
        } else if (d < 0 && minY >= s.maxY - EPS * 50) {
          const lim = s.maxY - minY;
          if (lim > d) {
            d = Math.min(0, lim);
            hit = s.id;
          }
        }
      } else {
        if (maxX <= s.minX + EPS || minX >= s.maxX - EPS || maxY <= s.minY + EPS || minY >= s.maxY - EPS) continue;
        if (d > 0 && maxZ <= s.minZ + EPS) {
          const lim = s.minZ - maxZ;
          if (lim < d) {
            d = Math.max(0, lim - EPS);
            hit = s.id;
          }
        } else if (d < 0 && minZ >= s.maxZ - EPS) {
          const lim = s.maxZ - minZ;
          if (lim > d) {
            d = Math.min(0, lim + EPS);
            hit = s.id;
          }
        }
      }
    }
    out.d = d;
    out.hit = hit;
  }

  /** True if the box overlaps any enabled solid. */
  boxBlocked(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): boolean {
    for (const s of this.solids) {
      if (!s.enabled) continue;
      if (maxX > s.minX + EPS && minX < s.maxX - EPS && maxY > s.minY + EPS && minY < s.maxY - EPS && maxZ > s.minZ + EPS && minZ < s.maxZ - EPS) {
        return true;
      }
    }
    return false;
  }

  /** Returns the id of a solid the sphere overlaps, or -1. */
  sphereHit(x: number, y: number, z: number, r: number): number {
    const r2 = r * r;
    for (const s of this.solids) {
      if (!s.enabled) continue;
      const cx = x < s.minX ? s.minX : x > s.maxX ? s.maxX : x;
      const cy = y < s.minY ? s.minY : y > s.maxY ? s.maxY : y;
      const cz = z < s.minZ ? s.minZ : z > s.maxZ ? s.maxZ : z;
      const dx = x - cx;
      const dy = y - cy;
      const dz = z - cz;
      if (dx * dx + dy * dy + dz * dz <= r2) return s.id;
    }
    return -1;
  }

  /** Ray cast against every enabled solid (slab method). */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number): RayHit | null {
    let best: RayHit | null = null;
    let bestT = maxDist;
    for (const s of this.solids) {
      if (!s.enabled) continue;
      let tmin = 0;
      let tmax = bestT;
      let nAxis = -1;
      let nSign = 0;
      // X slab
      if (Math.abs(dx) < 1e-9) {
        if (ox < s.minX || ox > s.maxX) continue;
      } else {
        const inv = 1 / dx;
        let t1 = (s.minX - ox) * inv;
        let t2 = (s.maxX - ox) * inv;
        let sign = -1;
        if (t1 > t2) {
          const t = t1;
          t1 = t2;
          t2 = t;
          sign = 1;
        }
        if (t1 > tmin) {
          tmin = t1;
          nAxis = 0;
          nSign = sign;
        }
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) continue;
      }
      // Y slab
      if (Math.abs(dy) < 1e-9) {
        if (oy < s.minY || oy > s.maxY) continue;
      } else {
        const inv = 1 / dy;
        let t1 = (s.minY - oy) * inv;
        let t2 = (s.maxY - oy) * inv;
        let sign = -1;
        if (t1 > t2) {
          const t = t1;
          t1 = t2;
          t2 = t;
          sign = 1;
        }
        if (t1 > tmin) {
          tmin = t1;
          nAxis = 1;
          nSign = sign;
        }
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) continue;
      }
      // Z slab
      if (Math.abs(dz) < 1e-9) {
        if (oz < s.minZ || oz > s.maxZ) continue;
      } else {
        const inv = 1 / dz;
        let t1 = (s.minZ - oz) * inv;
        let t2 = (s.maxZ - oz) * inv;
        let sign = -1;
        if (t1 > t2) {
          const t = t1;
          t1 = t2;
          t2 = t;
          sign = 1;
        }
        if (t1 > tmin) {
          tmin = t1;
          nAxis = 2;
          nSign = sign;
        }
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) continue;
      }
      if (nAxis < 0) continue; // ray starts inside the box
      if (tmin < bestT) {
        bestT = tmin;
        best = {
          dist: tmin,
          x: ox + dx * tmin,
          y: oy + dy * tmin,
          z: oz + dz * tmin,
          nx: nAxis === 0 ? nSign : 0,
          ny: nAxis === 1 ? nSign : 0,
          nz: nAxis === 2 ? nSign : 0,
          solidId: s.id,
        };
      }
    }
    return best;
  }

  /** Highest solid top directly below a point (for landing shadows and bots). */
  groundBelow(x: number, y: number, z: number, maxDrop = 200): number | null {
    let best: number | null = null;
    for (const s of this.solids) {
      if (!s.enabled) continue;
      if (x < s.minX || x > s.maxX || z < s.minZ || z > s.maxZ) continue;
      if (s.maxY > y + 0.05 || s.maxY < y - maxDrop) continue;
      if (best === null || s.maxY > best) best = s.maxY;
    }
    return best;
  }

  addPad(pad: Omit<BouncePad, 'id'>): BouncePad {
    const id = this.pads.reduce((m, p) => Math.max(m, p.id), -1) + 1;
    const full = { ...pad, id };
    this.pads.push(full);
    return full;
  }

  removeExpiredPads(time: number): void {
    for (let i = this.pads.length - 1; i >= 0; i--) {
      if (this.pads[i].expires <= time) this.pads.splice(i, 1);
    }
  }
}
