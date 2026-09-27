import { BALANCE } from '../balance';
import type { MapDef } from '../maps/types';
import { MODE_DEAD, type PlayerState, playerHeight, playerRadius } from '../player';
import type { World } from '../world';

export const MODE_IDS = ['knockout', 'teamKnockout', 'ball', 'pump', 'duel'] as const;
export type ModeId = (typeof MODE_IDS)[number];

export const MODE_INFO: Record<ModeId, { name: string; short: string; blurb: string; teams: boolean }> = {
  knockout: { name: 'Knockout', short: 'KO', blurb: 'Free-for-all. Most knockouts wins.', teams: false },
  teamKnockout: { name: 'Team Knockout', short: 'TEAM', blurb: 'Two teams. Most team knockouts wins.', teams: true },
  ball: { name: 'Ball', short: 'BALL', blurb: "Blast the beach ball into the other team's goal.", teams: true },
  pump: { name: 'Pump', short: 'PUMP', blurb: 'Stand on your pumps to inflate your giant tube man first.', teams: true },
  duel: { name: '1v1', short: '1V1', blurb: 'Just you and one rival. First to 5 knockouts.', teams: false },
};

export function isTeamMode(m: ModeId): boolean {
  return MODE_INFO[m].teams;
}

// --- Ball ------------------------------------------------------------------------------------

export interface BallState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  r: number;
  lastTouch: number;
  /** Time the ball comes back after a goal or going out (-1 while in play). */
  resetAt: number;
}

export type BallEvent = { kind: 'goal'; team: 0 | 1; scorer: number } | { kind: 'out' } | { kind: 'reset' };

const sweep = { d: 0, hit: -1 };

export class BallGame {
  readonly ball: BallState;

  constructor(
    private readonly map: MapDef,
    private readonly world: World,
  ) {
    const b = map.ball!;
    this.ball = { x: b.spawn[0], y: b.spawn[1], z: b.spawn[2], vx: 0, vy: 0, vz: 0, r: b.radius, lastTouch: -1, resetAt: -1 };
  }

  get inPlay(): boolean {
    return this.ball.resetAt < 0;
  }

  reset(): void {
    const s = this.map.ball!.spawn;
    Object.assign(this.ball, { x: s[0], y: s[1], z: s[2], vx: 0, vy: 0, vz: 0, lastTouch: -1, resetAt: -1 });
  }

  /** Adds velocity to the ball from something a player did. */
  impulse(vx: number, vy: number, vz: number, by: number): void {
    if (!this.inPlay) return;
    const b = this.ball;
    b.vx += vx;
    b.vy += vy;
    b.vz += vz;
    const sp = Math.hypot(b.vx, b.vy, b.vz);
    const max = BALANCE.modes.ball.maxSpeed;
    if (sp > max) {
      b.vx *= max / sp;
      b.vy *= max / sp;
      b.vz *= max / sp;
    }
    if (by >= 0) b.lastTouch = by;
  }

  /** Ray test against the ball; returns the distance or null. */
  ray(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number): number | null {
    if (!this.inPlay) return null;
    const b = this.ball;
    const lx = b.x - ox;
    const ly = b.y - oy;
    const lz = b.z - oz;
    const t = lx * dx + ly * dy + lz * dz;
    if (t < 0 || t > max + b.r) return null;
    const d2 = lx * lx + ly * ly + lz * lz - t * t;
    if (d2 > b.r * b.r) return null;
    return Math.max(0, t - Math.sqrt(b.r * b.r - d2));
  }

  /** Bounces the ball off the glass fence around the pitch, leaving the goal mouths open. */
  private fence(): void {
    const f = this.map.ball!.fence;
    if (!f) return;
    const b = this.ball;
    if (b.y - b.r > f.height) return;
    const B = BALANCE.modes.ball;
    if (b.z - b.r < f.minZ && b.vz < 0) {
      b.z = f.minZ + b.r;
      b.vz = -b.vz * B.bounce;
    } else if (b.z + b.r > f.maxZ && b.vz > 0) {
      b.z = f.maxZ - b.r;
      b.vz = -b.vz * B.bounce;
    }
    const inMouth = this.map.ball!.goals.some((g) => b.z > g.min[2] && b.z < g.max[2] && b.y < g.max[1]);
    if (inMouth) return;
    if (b.x - b.r < f.minX && b.vx < 0 && b.x > f.minX - b.r * 2) {
      b.x = f.minX + b.r;
      b.vx = -b.vx * B.bounce;
    } else if (b.x + b.r > f.maxX && b.vx > 0 && b.x < f.maxX + b.r * 2) {
      b.x = f.maxX - b.r;
      b.vx = -b.vx * B.bounce;
    }
  }

  step(dt: number, time: number, players: Iterable<{ id: number; state: PlayerState }>): BallEvent | null {
    const B = BALANCE.modes.ball;
    const b = this.ball;
    if (b.resetAt >= 0) {
      if (time >= b.resetAt) {
        this.reset();
        return { kind: 'reset' };
      }
      return null;
    }
    b.vy -= B.gravity * dt;
    const drag = Math.max(0, 1 - B.drag * dt);
    b.vx *= drag;
    b.vy *= drag;
    b.vz *= drag;
    const h = b.r * 0.9;
    for (const axis of [1, 0, 2] as const) {
      const v = axis === 0 ? b.vx : axis === 1 ? b.vy : b.vz;
      this.world.sweepAxis(axis, v * dt, b.x - h, b.y - h, b.z - h, b.x + h, b.y + h, b.z + h, sweep);
      if (axis === 0) b.x += sweep.d;
      else if (axis === 1) b.y += sweep.d;
      else b.z += sweep.d;
      if (sweep.hit >= 0) {
        if (axis === 1) {
          if (v < 0) {
            // Bounce, then roll with a little friction.
            b.vy = Math.abs(v) > 2 ? -v * B.bounce : 0;
            b.vx *= 0.97;
            b.vz *= 0.97;
          } else b.vy = -v * 0.5;
        } else if (axis === 0) b.vx = -v * B.bounce;
        else b.vz = -v * B.bounce;
      }
    }
    this.fence();
    // Players bump and dribble the ball.
    for (const p of players) {
      const s = p.state;
      if (s.mode === MODE_DEAD) continue;
      const pr = playerRadius(s);
      const ay = Math.max(s.py + pr, Math.min(s.py + playerHeight(s) - pr, b.y));
      const dx = b.x - s.px;
      const dy = b.y - ay;
      const dz = b.z - s.pz;
      const d = Math.hypot(dx, dy, dz);
      const minD = pr + b.r;
      if (d >= minD || d < 1e-4) continue;
      const nx = dx / d;
      const ny = dy / d;
      const nz = dz / d;
      b.x += nx * (minD - d);
      b.y += ny * (minD - d);
      b.z += nz * (minD - d);
      const rel = (s.vx - b.vx) * nx + (s.vy - b.vy) * ny + (s.vz - b.vz) * nz;
      const push = Math.max(0, rel) * 1.1 + B.bodyPush;
      b.vx += nx * push;
      b.vy += Math.max(0, ny) * push + 1;
      b.vz += nz * push;
      b.lastTouch = p.id;
    }
    for (const g of this.map.ball!.goals) {
      if (b.x > g.min[0] && b.x < g.max[0] && b.y > g.min[1] && b.y < g.max[1] && b.z > g.min[2] && b.z < g.max[2]) {
        b.resetAt = time + B.resetDelay;
        return { kind: 'goal', team: (1 - g.team) as 0 | 1, scorer: b.lastTouch };
      }
    }
    const Z = this.map.blast;
    if (b.y < -20 || b.x < Z.minX || b.x > Z.maxX || b.z < Z.minZ || b.z > Z.maxZ) {
      b.resetAt = time + B.resetDelay;
      return { kind: 'out' };
    }
    return null;
  }
}

// --- Pump ------------------------------------------------------------------------------------

/** 0 = idle, 1 = pumping, 2 = contested (an enemy is standing on it). */
export type PumpState = 0 | 1 | 2;

export class PumpGame {
  fill: [number, number] = [0, 0];
  states: PumpState[];

  constructor(private readonly map: MapDef) {
    this.states = (map.pumps ?? []).map(() => 0 as PumpState);
  }

  reset(): void {
    this.fill = [0, 0];
    this.states = this.states.map(() => 0 as PumpState);
  }

  /** Advances filling; returns the winning team once a giant is full. */
  step(dt: number, players: Iterable<{ team: number; state: PlayerState }>): 0 | 1 | null {
    const P = BALANCE.modes.pump;
    const list = [...players];
    (this.map.pumps ?? []).forEach((pump, i) => {
      let mine = 0;
      let enemies = 0;
      for (const p of list) {
        const s = p.state;
        if (s.mode === MODE_DEAD) continue;
        if (Math.hypot(s.px - pump.x, s.pz - pump.z) > pump.r + playerRadius(s) * 0.5) continue;
        if (Math.abs(s.py - pump.y) > 0.6) continue;
        if (p.team === pump.team) mine++;
        else enemies++;
      }
      if (enemies > 0 && mine > 0) this.states[i] = 2;
      else if (enemies > 0) this.states[i] = 2;
      else if (mine > 0) this.states[i] = 1;
      else this.states[i] = 0;
      if (this.states[i] === 1) {
        const t = pump.team;
        this.fill[t] = Math.min(1, this.fill[t] + P.rate * (1 + P.extraPerPlayer * (mine - 1)) * dt);
      }
    });
    if (this.fill[0] >= 1) return 0;
    if (this.fill[1] >= 1) return 1;
    return null;
  }
}
