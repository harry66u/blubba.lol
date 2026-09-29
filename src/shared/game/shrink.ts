import { BALANCE } from '../balance';
import type { MapDef } from '../maps/types';
import type { ModeId } from './modes';

/**
 * The map falling apart during a match. The server builds a plan when a match starts and sends it
 * to clients in the match message, so every world (server, prediction) sinks and crumbles the same
 * pieces at the same match-clock time. Each piece's `collapse` order (see SolidDef) says which
 * stage takes it: higher orders are the outer pieces and go first; order 0 is the main deck,
 * which crumbles inward instead of sinking.
 */
export interface ShrinkStage {
  /** Match-clock second (tick × dt) the pieces start to fall. */
  at: number;
  /** Seconds of warning before `at` (countdown, debris, red flashing edges). */
  warn: number;
  /** Collapse orders whose pieces start sinking at `at`. */
  sink: number[];
  /** Fraction of the main deck's half-size crumbled away per side once this stage is done (0 = no change). */
  deck: number;
  /** Seconds the deck takes to crumble in to `deck`. */
  deckTime: number;
  /** Shown as "THE MAP IS SHRINKING!" (the final-30 steps are covered by the final callout). */
  announce: boolean;
}

export type CollapsePlan = ShrinkStage[];

/** Knockout-style modes shrink the map at half time as well as in the final 30 seconds. */
export function shrinksMidMatch(mode: ModeId): boolean {
  return mode === 'knockout' || mode === 'teamKnockout' || mode === 'duel';
}

/** Collapse orders present on a map (0 = it has a crumbling main deck). */
function ordersOn(map: MapDef): Set<number> {
  const out = new Set<number>();
  for (const s of map.solids) if (s.collapse !== undefined && s.collapse >= 0) out.add(s.collapse);
  return out;
}

/**
 * When each part of `map` falls away in a match of `durationSec` that ends at match-clock second
 * `end`. Stages that would change nothing on this map are left out.
 */
export function collapsePlan(mode: ModeId, map: MapDef, end: number, durationSec: number): CollapsePlan {
  const orders = ordersOn(map);
  const start = end - durationSec;
  const stages: ShrinkStage[] = [];
  const add = (st: ShrinkStage) => {
    st.sink = st.sink.filter((o) => o > 0 && orders.has(o));
    if (!orders.has(0)) st.deck = 0;
    const prevDeck = stages.reduce((m, s) => Math.max(m, s.deck), 0);
    if (st.deck <= prevDeck) st.deck = 0;
    if (st.sink.length || st.deck > 0) stages.push(st);
  };
  if (mode === 'suddenDeath') {
    const S = BALANCE.modes.suddenDeath;
    for (const s of S.stages) {
      if (s.at >= durationSec) continue;
      add({ at: start + s.at, warn: BALANCE.shrink.warning, sink: [...s.sink], deck: s.deck, deckTime: S.deckTime, announce: true });
    }
    return stages;
  }
  const F = BALANCE.final;
  const finalAt = end - F.seconds;
  const top = Math.max(0, ...orders);
  if (shrinksMidMatch(mode) && top > 0 && durationSec >= BALANCE.shrink.minMatchSec) {
    add({ at: start + durationSec / 2, warn: BALANCE.shrink.warning, sink: [top], deck: 0, deckTime: 1, announce: true });
  }
  const sunk = new Set(stages.flatMap((s) => s.sink));
  const delays = Object.entries(F.islandDelay)
    .map(([o, d]) => [Number(o), d] as const)
    .filter(([o]) => !sunk.has(o))
    .sort((a, b) => a[1] - b[1]);
  for (const [order, delay] of delays) {
    add({ at: finalAt + delay, warn: delay > 0 ? BALANCE.shrink.finalWarning : 0, sink: [order], deck: 0, deckTime: 1, announce: false });
  }
  add({ at: end - F.deckShrinkStart, warn: BALANCE.shrink.finalWarning, sink: [], deck: F.deckShrink, deckTime: F.deckShrinkStart, announce: false });
  return stages.sort((a, b) => a.at - b.at);
}

/** How far (m) a piece has sunk `elapsed` seconds after it started to fall. */
export function sinkDepth(elapsed: number): number {
  return elapsed > 0 ? 0.5 * BALANCE.final.sinkAccel * elapsed * elapsed : 0;
}

/** Fraction (0..1) of the main deck's half-size crumbled away at match-clock `time`. */
export function deckShrinkAt(plan: readonly ShrinkStage[], time: number): number {
  let v = 0;
  for (const st of plan) {
    if (st.deck <= v) continue;
    if (time <= st.at) break;
    v += (st.deck - v) * Math.min(1, (time - st.at) / st.deckTime);
  }
  return v;
}

/** The announced stage whose warning or first seconds are showing at `time` (for the HUD banner). */
export function shrinkStageNear(plan: readonly ShrinkStage[], time: number, after = 3): ShrinkStage | null {
  for (const st of plan) if (st.announce && time >= st.at - st.warn && time < st.at + after) return st;
  return null;
}
