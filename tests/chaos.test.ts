import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/shared/balance';
import type { GameEvent } from '../src/shared/game/events';
import { GameSim, type SimPlayer } from '../src/shared/game/sim';
import { DEALERSHIP } from '../src/shared/maps/dealership';
import { Driver, run } from './helpers';

function setup(n = 2, durationSec = 999) {
  const sim = new GameSim({ map: DEALERSHIP, durationSec });
  sim.eventMult = 0;
  const ps: SimPlayer[] = [];
  const ds: Driver[] = [];
  for (let i = 0; i < n; i++) {
    const p = sim.addPlayer(`p${i}`);
    ps.push(p);
    ds.push(new Driver(sim, p));
  }
  sim.startMatch();
  for (const p of ps) p.state.spawnProt = 0;
  return { sim, ps, ds };
}

function place(p: SimPlayer, x: number, y: number, z: number) {
  Object.assign(p.state, { px: x, py: y, pz: z, vx: 0, vy: 0, vz: 0, spawnProt: 0, onGround: 1, inflation: 0 });
}

const kos = (events: GameEvent[]) => events.filter((e): e is Extract<GameEvent, { t: 'ko' }> => e.t === 'ko');

describe('chaos', () => {
  it('low gravity makes jumps float higher', () => {
    const apex = (low: boolean) => {
      const { sim, ps, ds } = setup(1);
      place(ps[0], 0, 0, 0);
      if (low) {
        sim.triggerChaos('lowGravity');
        run(sim, ds, (BALANCE.chaos.warning + 0.6) * 60);
      }
      ds[0].press('jump');
      let top = 0;
      run(sim, ds, 90, () => (top = Math.max(top, ps[0].state.py)));
      return top;
    };
    expect(apex(true)).toBeGreaterThan(apex(false) * 1.6);
  });

  it('the ice rink makes you slide much farther', () => {
    const slide = (ice: boolean) => {
      const { sim, ps, ds } = setup(1);
      place(ps[0], -15, 0, 5);
      ds[0].frame.yaw = -Math.PI / 2; // face +x
      if (ice) {
        sim.triggerChaos('ice');
        run(sim, ds, (BALANCE.chaos.warning + 0.6) * 60);
      }
      ds[0].frame.moveZ = 1;
      run(sim, ds, 90);
      ds[0].frame.moveZ = 0;
      const x0 = ps[0].state.px;
      run(sim, ds, 60);
      return ps[0].state.px - x0;
    };
    expect(slide(true)).toBeGreaterThan(slide(false) * 3);
  });

  it('the giant fan blows everyone toward one edge', () => {
    const { sim, ps, ds } = setup(1);
    place(ps[0], 0, 0, 5);
    sim.triggerChaos('fan', 1, 0);
    run(sim, ds, (BALANCE.chaos.warning + 3) * 60);
    expect(ps[0].state.px).toBeGreaterThan(3);
  });

  it('max pressure inflates everyone, then lets them back down', () => {
    const { sim, ps, ds } = setup(2);
    ps[0].state.inflation = 0.3;
    sim.triggerChaos('maxInflate');
    run(sim, ds, (BALANCE.chaos.warning + 1) * 60);
    expect(ps[0].state.inflation).toBe(1);
    expect(ps[1].state.inflation).toBe(1);
    run(sim, ds, (BALANCE.chaos.maxInflate.duration + 1) * 60);
    expect(ps[0].state.inflation).toBeCloseTo(0.3);
    expect(ps[1].state.inflation).toBe(0);
  });

  it('chain reactions: a launched player knocks others back and the shooter gets credit', () => {
    const { sim, ps, ds } = setup(3);
    const [shooter, a, b] = ps;
    place(shooter, -10, 0, -10);
    place(a, 14, 0, 0);
    place(b, 17, 0, 0);
    a.state.inflation = 0.9;
    b.state.inflation = 0.9;
    sim.applyHit(a, shooter.id, 1, 0.2, 0, 1.2, 0, { direct: true, low: false, x: 13.6, y: 1, z: 0 });
    const events: GameEvent[] = [];
    run(sim, ds, 240, () => events.push(...sim.drainEvents()));
    expect(events.some((e) => e.t === 'chain' && e.by === shooter.id)).toBe(true);
    const bKo = kos(events).find((e) => e.victim === b.id);
    expect(bKo?.killer).toBe(shooter.id);
    expect(bKo?.tags).toContain('chain');
    expect(shooter.stats.chainKos).toBeGreaterThanOrEqual(1);
  });

  it('crown: a streak earns the crown and knocking the wearer off is worth triple', () => {
    const { sim, ps, ds } = setup(3);
    const [a, b, c] = ps;
    const ko = (killer: SimPlayer, victim: SimPlayer) => {
      victim.lastAttacker = killer.id;
      victim.lastAttackTime = sim.time;
      sim.knockout(victim);
      run(sim, ds, Math.ceil(BALANCE.match.respawnDelay * 60) + 2);
    };
    ko(a, b);
    ko(a, c);
    expect(sim.crownId).toBe(a.id);
    const before = c.score;
    ko(c, a);
    // Triple for the crown, plus a revenge bonus (a had just knocked c out).
    expect(c.score - before).toBe(BALANCE.crown.multiplier + BALANCE.revenge.bonus);
    expect(sim.crownId).toBe(-1);
    // Counted for the "Pop the crown holder" daily challenge.
    expect(c.stats.crownKos).toBe(1);
    expect(a.stats.crownKos).toBe(0);
  });

  it('revenge pays a bonus and multi-knockouts are tagged', () => {
    const { sim, ps, ds } = setup(3);
    const [a, b, c] = ps;
    const events: GameEvent[] = [];
    const ko = (killer: SimPlayer, victim: SimPlayer, wait = true) => {
      victim.lastAttacker = killer.id;
      victim.lastAttackTime = sim.time;
      sim.knockout(victim);
      events.push(...sim.drainEvents());
      if (wait) run(sim, ds, Math.ceil(BALANCE.match.respawnDelay * 60) + 2, () => events.push(...sim.drainEvents()));
    };
    ko(b, a);
    const before = a.score;
    ko(a, b);
    expect(a.score - before).toBe(1 + BALANCE.revenge.bonus);
    expect(kos(events).pop()?.tags).toContain('revenge');
    // Two quick knockouts by the same player.
    ko(c, a, false);
    ko(c, b, false);
    expect(kos(events).pop()?.tags).toContain('double');
  });

  it('final 30 seconds: knockouts count double and the map collapses', () => {
    const { sim, ps, ds } = setup(2, 40);
    const [a, b] = ps;
    const island = sim.world.solids.find((s) => s.collapse === 3)!;
    const deck = sim.world.solids.find((s) => s.collapse === 0)!;
    const topBefore = island.maxY;
    const widthBefore = deck.maxX - deck.minX;
    run(sim, ds, 12 * 60);
    expect(sim.isFinal()).toBe(true);
    b.lastAttacker = a.id;
    b.lastAttackTime = sim.time;
    sim.knockout(b);
    expect(a.score).toBe(BALANCE.final.multiplier);
    run(sim, ds, 6 * 60);
    expect(island.maxY).toBeLessThan(topBefore - 10);
    run(sim, ds, 20 * 60);
    expect(deck.maxX - deck.minX).toBeLessThan(widthBefore * 0.8);
  });

  it('schedules random events about once a minute', () => {
    const { sim, ps, ds } = setup(2, 300);
    sim.eventMult = 1;
    sim.startMatch();
    const events: GameEvent[] = [];
    run(sim, ds, 200 * 60, () => {
      events.push(...sim.drainEvents().filter((e) => e.t === 'chaos'));
      for (const p of ps) p.state.spawnProt = 1;
    });
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events.length).toBeLessThanOrEqual(5);
  });
});
