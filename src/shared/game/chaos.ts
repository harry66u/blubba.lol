import { BALANCE } from '../balance';

export const CHAOS_KINDS = ['fan', 'lowGravity', 'ice', 'maxInflate'] as const;
export type ChaosKind = (typeof CHAOS_KINDS)[number];

export const CHAOS_INFO: Record<ChaosKind, { title: string; sub: string }> = {
  fan: { title: 'GIANT FAN!', sub: 'Hold on to something!' },
  lowGravity: { title: 'LOW GRAVITY!', sub: 'Everything floats!' },
  ice: { title: 'ICE RINK!', sub: 'The floor is slippery!' },
  maxInflate: { title: 'MAX PRESSURE!', sub: 'Everyone is fully inflated!' },
};

/** A scheduled random event. Times are server ticks so both sides agree exactly. */
export interface ChaosEvent {
  kind: ChaosKind;
  /** Tick the event was announced. */
  announceTick: number;
  startTick: number;
  endTick: number;
  /** Wind direction for the fan. */
  dirX: number;
  dirZ: number;
}

/** Movement modifiers that apply to every player at a given tick. */
export interface Environment {
  gravityMult: number;
  frictionMult: number;
  accelMult: number;
  windX: number;
  windZ: number;
  windAirMult: number;
}

export const NORMAL_ENV: Environment = { gravityMult: 1, frictionMult: 1, accelMult: 1, windX: 0, windZ: 0, windAirMult: 1 };

export function chaosDuration(kind: ChaosKind): number {
  return BALANCE.chaos[kind].duration;
}

/** Environment at `tick` given the current/next scheduled events. Shared by server and client prediction. */
export function envAt(events: readonly (ChaosEvent | null)[], tick: number, out: Environment): Environment {
  Object.assign(out, NORMAL_ENV);
  for (const e of events) {
    if (!e || tick < e.startTick || tick >= e.endTick) continue;
    // Ease in over half a second so nothing snaps.
    const ramp = Math.min(1, (tick - e.startTick) / (BALANCE.tickRate * 0.5));
    const C = BALANCE.chaos;
    if (e.kind === 'fan') {
      out.windX = e.dirX * C.fan.accel * ramp;
      out.windZ = e.dirZ * C.fan.accel * ramp;
      out.windAirMult = C.fan.airMult;
      // Feet lose some grip in the gale so it actually moves you.
      out.frictionMult = 1 + (C.fan.frictionMult - 1) * ramp;
    } else if (e.kind === 'lowGravity') {
      out.gravityMult = 1 + (C.lowGravity.gravityMult - 1) * ramp;
    } else if (e.kind === 'ice') {
      out.frictionMult = 1 + (C.ice.frictionMult - 1) * ramp;
      out.accelMult = 1 + (C.ice.accelMult - 1) * ramp;
    }
  }
  return out;
}

/** How far (m) a collapsing island with the given order has sunk after `elapsed` seconds. */
export function islandSink(order: number, elapsed: number): number {
  const F = BALANCE.final;
  const delay = F.islandDelay[order];
  if (delay === undefined) return 0;
  const t = elapsed - delay;
  if (t <= 0) return 0;
  return 0.5 * F.sinkAccel * t * t;
}

/** Fraction (0..1) of the main deck's half-size lost to crumbling after `elapsed` seconds. */
export function deckShrink(elapsed: number): number {
  const F = BALANCE.final;
  const t = elapsed - (F.seconds - F.deckShrinkStart);
  if (t <= 0) return 0;
  return Math.min(1, t / F.deckShrinkStart) * F.deckShrink;
}
