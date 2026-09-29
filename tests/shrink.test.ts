import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/shared/balance';
import type { GameEvent } from '../src/shared/game/events';
import { GameSim, type SimPlayer } from '../src/shared/game/sim';
import { collapsePlan } from '../src/shared/game/shrink';
import { KNOCKOUT_MAPS, getMap } from '../src/shared/maps';
import { DEALERSHIP } from '../src/shared/maps/dealership';
import { World } from '../src/shared/world';
import { Driver, run } from './helpers';

function setup(durationSec: number, mode: 'knockout' | 'duel' | 'teamKnockout' = 'knockout') {
  const sim = new GameSim({ map: DEALERSHIP, mode, durationSec });
  sim.eventMult = 0;
  const ps: SimPlayer[] = [];
  const ds: Driver[] = [];
  for (let i = 0; i < 2; i++) {
    const p = sim.addPlayer(`p${i}`);
    ps.push(p);
    ds.push(new Driver(sim, p));
  }
  sim.startMatch();
  return { sim, ps, ds };
}

/** Runs until match-clock second `t` (relative to the match start), collecting events. */
function until(sim: GameSim, ds: Driver[], t: number, out: GameEvent[]): void {
  const ticks = Math.round((sim.matchStartedAt + t - sim.time) * BALANCE.tickRate);
  run(sim, ds, Math.max(0, ticks), () => out.push(...sim.drainEvents()));
  out.push(...sim.drainEvents());
}

const shrinks = (ev: GameEvent[]) => ev.filter((e): e is Extract<GameEvent, { t: 'shrink' }> => e.t === 'shrink');

describe('map shrinking', () => {
  it('knockout: the outer islands sink at half time after a warning; the final 30 finishes the job', () => {
    const { sim, ds } = setup(240);
    const outer = sim.world.solids.filter((s) => s.collapse === 3);
    const inner = sim.world.solids.filter((s) => s.collapse === 2);
    const deck = sim.world.solids.find((s) => s.collapse === 0)!;
    const tops = new Map(sim.world.solids.map((s) => [s.id, s.maxY]));
    const deckW = deck.maxX - deck.minX;
    const ev: GameEvent[] = [];
    const warn = BALANCE.shrink.warning;

    until(sim, ds, 120 - warn - 0.1, ev);
    expect(shrinks(ev)).toHaveLength(0);
    until(sim, ds, 120 - warn + 0.1, ev);
    // Announced ahead of time, with the tick the pieces go.
    const s = shrinks(ev);
    expect(s).toHaveLength(1);
    expect(s[0].sink).toEqual([3]);
    expect(s[0].startTick * sim.dt).toBeCloseTo(sim.matchStartedAt + 120, 5);
    until(sim, ds, 119.9, ev);
    for (const o of outer) expect(o.maxY).toBe(tops.get(o.id));
    until(sim, ds, 127, ev);
    for (const o of outer) expect(o.maxY).toBeLessThan(tops.get(o.id)! - 10);
    // Everything else waits for the final 30 seconds.
    for (const o of inner) expect(o.maxY).toBe(tops.get(o.id));
    expect(deck.maxX - deck.minX).toBe(deckW);
    expect(sim.isFinal()).toBe(false);

    until(sim, ds, 210 + BALANCE.final.islandDelay[2] - 0.2, ev);
    expect(sim.isFinal()).toBe(true);
    for (const o of inner) expect(o.maxY).toBe(tops.get(o.id));
    until(sim, ds, 210 + BALANCE.final.islandDelay[2] + 4, ev);
    for (const o of inner) expect(o.maxY).toBeLessThan(tops.get(o.id)! - 10);
    until(sim, ds, 229.9, ev);
    expect(deck.maxX - deck.minX).toBe(deckW);
    until(sim, ds, 239.9, ev);
    expect(deck.maxX - deck.minX).toBeLessThan(deckW * (1 - BALANCE.final.deckShrink + 0.02));
    // Only the half-time stage is announced as a shrink; the final callout covers the rest.
    expect(shrinks(ev)).toHaveLength(1);
    expect(ev.filter((e) => e.t === 'final')).toHaveLength(1);
  });

  it('every knockout-style mode shrinks at half time on every knockout map; short matches skip it', () => {
    for (const mode of ['knockout', 'teamKnockout', 'duel'] as const) {
      for (const id of KNOCKOUT_MAPS) {
        const plan = collapsePlan(mode, getMap(id), 300, 240);
        const mid = plan.filter((s) => s.announce);
        expect(mid, `${mode} ${id}`).toHaveLength(1);
        expect(mid[0].at).toBe(180);
        expect(mid[0].sink).toEqual([3]);
      }
    }
    expect(collapsePlan('knockout', DEALERSHIP, 40, 40).some((s) => s.announce)).toBe(false);
    // Ball and Pump keep just the final-30 collapse.
    expect(collapsePlan('pump', getMap('pumpArena'), 240, 240).some((s) => s.announce)).toBe(false);
    expect(collapsePlan('ball', getMap('ballArena'), 240, 240)).toEqual([]);
  });

  it("a client world mirroring the server's plan matches it exactly", () => {
    const { sim, ds } = setup(240);
    const client = new World(DEALERSHIP);
    client.setCollapse(JSON.parse(JSON.stringify(sim.world.plan)));
    for (const t of [60, 118, 121.5, 125, 214, 219, 232, 236, 239.5]) {
      until(sim, ds, t, []);
      client.setTime(sim.time);
      for (let i = 0; i < sim.world.staticCount; i++) {
        const a = sim.world.solids[i];
        const b = client.solids[i];
        expect([b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ, b.enabled]).toEqual([a.minX, a.minY, a.minZ, a.maxX, a.maxY, a.maxZ, a.enabled]);
      }
    }
  });

  it('nobody respawns on a piece that has fallen away', () => {
    const { sim, ps, ds } = setup(240);
    until(sim, ds, 239.5, []);
    for (let i = 0; i < 10; i++) {
      sim.respawn(ps[0]);
      const s = ps[0].state;
      expect(sim.world.groundBelow(s.px, s.py + 0.1, s.pz, 0.6)).not.toBeNull();
    }
  });

  it('the debug clock jump keeps the schedule relative to the new end', () => {
    const { sim, ds } = setup(240);
    until(sim, ds, 10, []);
    sim.endIn(125);
    const ev: GameEvent[] = [];
    run(sim, ds, Math.round(0.2 * 60), () => ev.push(...sim.drainEvents()));
    // Half time of the (virtual) 240 s match is now 5 s away, so it's announced right away.
    const s = shrinks(ev);
    expect(s).toHaveLength(1);
    expect(s[0].startTick * sim.dt - sim.time).toBeCloseTo(5 - 0.2, 1);
  });
});
