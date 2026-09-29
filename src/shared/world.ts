import { BALANCE } from './balance';
import { type ShrinkStage, deckShrinkAt, sinkDepth } from './game/shrink';
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
  /** Collapse order (-1 = never collapses, 0 = main deck, crumbles inward; higher sinks sooner). */
  collapse: number;
  /** Rubbery restitution (0 = normal floor). */
  bounce: number;
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

export interface DynamicSolidDef {
  min: [number, number, number];
  max: [number, number, number];
  ledge: boolean;
}

export class World {
  readonly solids: Solid[] = [];
  readonly pads: BouncePad[] = [];
  time = 0;
  /** Solids with an id at or above this were added during play (walls, rafts). */
  readonly staticCount: number;
  /** When each part of the map falls away this match (empty: nothing does). See game/shrink.ts. */
  plan: readonly ShrinkStage[] = [];
  /** Time each collapse order starts sinking, from the plan. */
  private sinkAt: number[] = [];

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
        collapse: def.collapse ?? -1,
        bounce: def.bounce ?? 0,
      };
      this.solids.push(s);
    });
    map.bouncePads.forEach((p, i) => this.pads.push({ ...p, id: i, owner: -1, expires: Infinity }));
    this.staticCount = this.solids.length;
    this.setTime(0);
  }

  private readonly off = { ox: 0, oy: 0, oz: 0, shrink: 0 };

  /** Sets this match's collapse plan (the server when a match starts; clients mirror it). */
  setCollapse(plan: readonly ShrinkStage[] | null | undefined): void {
    this.plan = plan ?? [];
    this.sinkAt = [];
    for (const st of this.plan) for (const o of st.sink) this.sinkAt[o] = Math.min(this.sinkAt[o] ?? Infinity, st.at);
  }

  /** Match-clock second pieces with this collapse order start sinking (Infinity = never). */
  sinkStart(order: number): number {
    return order > 0 ? (this.sinkAt[order] ?? Infinity) : Infinity;
  }

  /**
   * Seconds until solid `id` starts falling away (negative once it has; Infinity if it never
   * will). The main deck counts from when the plan next crumbles it.
   */
  fallsIn(id: number, time: number): number {
    const s = this.solids[id];
    if (!s || s.collapse < 0 || id >= this.staticCount) return Infinity;
    if (s.collapse > 0) return this.sinkStart(s.collapse) - time;
    for (const st of this.plan) if (st.deck > 0 && time < st.at + st.deckTime) return st.at - time;
    return Infinity;
  }

  /**
   * Main-deck bounds at `time` (x/z), for looking ahead at where the edge will be. Returns the
   * solid's own bounds for anything that isn't a crumbling deck.
   */
  deckBoundsAt(s: Solid, time: number, out: { minX: number; maxX: number; minZ: number; maxZ: number }): typeof out {
    const k = s.collapse === 0 ? deckShrinkAt(this.plan, time) : 0;
    const hw = ((s.baseMaxX - s.baseMinX) / 2) * k;
    const hd = ((s.baseMaxZ - s.baseMinZ) / 2) * k;
    out.minX = s.baseMinX + hw;
    out.maxX = s.baseMaxX - hw;
    out.minZ = s.baseMinZ + hd;
    out.maxZ = s.baseMaxZ - hd;
    return out;
  }

  private offsetAt(s: Solid, time: number): { ox: number; oy: number; oz: number; shrink: number } {
    const o = this.off;
    o.ox = o.oy = o.oz = o.shrink = 0;
    if (s.mover) {
      const k = moverOffset(s.mover, time);
      o.ox = s.mover.dx * k;
      o.oy = s.mover.dy * k;
      o.oz = s.mover.dz * k;
    }
    if (s.collapse > 0) o.oy -= sinkDepth(time - (this.sinkAt[s.collapse] ?? Infinity));
    else if (s.collapse === 0 && this.plan.length) o.shrink = deckShrinkAt(this.plan, time);
    return o;
  }

  /**
   * Moves every mover (and collapsing piece) to where it is at `time` and records each one's
   * displacement over the previous fixed step, so riders are carried the same way no matter how
   * often this is called.
   */
  setTime(time: number): void {
    this.time = time;
    const dt = 1 / BALANCE.tickRate;
    for (let i = 0; i < this.staticCount; i++) {
      const s = this.solids[i];
      if (!s.mover && s.collapse < 0) continue;
      const b = this.offsetAt(s, time - dt);
      const bx = b.ox;
      const by = b.oy;
      const bz = b.oz;
      const a = this.offsetAt(s, time);
      s.dX = a.ox - bx;
      s.dY = a.oy - by;
      s.dZ = a.oz - bz;
      const hw = ((s.baseMaxX - s.baseMinX) / 2) * a.shrink;
      const hd = ((s.baseMaxZ - s.baseMinZ) / 2) * a.shrink;
      s.minX = s.baseMinX + a.ox + hw;
      s.maxX = s.baseMaxX + a.ox - hw;
      s.minY = s.baseMinY + a.oy;
      s.maxY = s.baseMaxY + a.oy;
      s.minZ = s.baseMinZ + a.oz + hd;
      s.maxZ = s.baseMaxZ + a.oz - hd;
      // Pieces that have fallen far away stop existing.
      if (s.collapse >= 0) s.enabled = a.oy > -70;
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

  addPad(pad: Omit<BouncePad, 'id'>, id?: number): BouncePad {
    const pid = id ?? this.pads.reduce((m, p) => Math.max(m, p.id), -1) + 1;
    this.removePad(pid);
    const full = { ...pad, id: pid };
    this.pads.push(full);
    return full;
  }

  removePad(id: number): void {
    const i = this.pads.findIndex((p) => p.id === id);
    if (i >= 0) this.pads.splice(i, 1);
  }

  /** Adds a temporary solid (inflatable wall or raft) and returns its id. */
  addDynamicSolid(def: DynamicSolidDef): number {
    let id = -1;
    for (let i = this.staticCount; i < this.solids.length; i++) {
      if (!this.solids[i].enabled) {
        id = i;
        break;
      }
    }
    if (id < 0) id = this.solids.length;
    this.setSolidAt(id, def);
    return id;
  }

  /** Creates, replaces, or (with null) disables the dynamic solid at `id`. Used to mirror the server. */
  setSolidAt(id: number, def: DynamicSolidDef | null): void {
    if (id < this.staticCount) return;
    while (this.solids.length <= id) {
      const n = this.solids.length;
      this.solids.push({
        id: n, minX: 0, minY: -9999, minZ: 0, maxX: 0, maxY: -9999, maxZ: 0, ledge: false, enabled: false, mover: null,
        baseMinX: 0, baseMinY: 0, baseMinZ: 0, baseMaxX: 0, baseMaxY: 0, baseMaxZ: 0, dX: 0, dY: 0, dZ: 0, collapse: -1, bounce: 0,
      });
    }
    const s = this.solids[id];
    if (!def) {
      s.enabled = false;
      return;
    }
    s.minX = s.baseMinX = def.min[0];
    s.minY = s.baseMinY = def.min[1];
    s.minZ = s.baseMinZ = def.min[2];
    s.maxX = s.baseMaxX = def.max[0];
    s.maxY = s.baseMaxY = def.max[1];
    s.maxZ = s.baseMaxZ = def.max[2];
    s.ledge = def.ledge;
    s.enabled = true;
    s.dX = s.dY = s.dZ = 0;
  }
}
