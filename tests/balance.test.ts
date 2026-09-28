import { describe, expect, it } from 'vitest';
import { GameSim } from '../src/shared/game/sim';
import { DEALERSHIP } from '../src/shared/maps/dealership';
import { MODE_DEAD, MODE_NORMAL } from '../src/shared/player';
import { Driver, run } from './helpers';

/**
 * Spec §3 balance target: "a fresh player survives about five clean hits. After that, one
 * well-placed hit near an edge can knock them off."
 *
 * A clean hit = a fully charged, direct Air Cannon hit to the body. The shooter keeps chasing the
 * target and firing from 8 m away, always pushing in the same direction.
 */
function hitsToKnockout(startX: number, startZ: number, dirX: number, dirZ: number): number {
  const sim = new GameSim({ map: DEALERSHIP });
  sim.eventMult = 0; // measure knockback alone, no random events
  const shooter = sim.addPlayer('shooter');
  const target = sim.addPlayer('target');
  const ds = new Driver(sim, shooter);
  const dt = new Driver(sim, target);
  target.state.px = startX;
  target.state.pz = startZ;
  target.state.py = 0;
  target.state.spawnProt = 0;
  let hits = 0;
  for (let attempt = 0; attempt < 12; attempt++) {
    run(sim, [ds, dt], 200);
    if (target.stats.deaths > 0) break;
    expect(target.state.mode).toBe(MODE_NORMAL);
    const t = target.state;
    shooter.state.px = t.px - dirX * 8;
    shooter.state.pz = t.pz - dirZ * 8;
    shooter.state.py = t.py;
    shooter.state.vx = shooter.state.vy = shooter.state.vz = 0;
    shooter.state.ammo = 5;
    shooter.state.reloadTimer = 0;
    shooter.state.spawnProt = 0;
    ds.aimAt(t.px, t.py + 1.05 * (1 + 0.75 * t.inflation), t.pz);
    ds.setFire(true);
    run(sim, [ds, dt], 50);
    ds.setFire(false);
    run(sim, [ds, dt], 150);
    hits += sim.drainEvents().filter((e) => e.t === 'hit' && e.target === target.id && e.direct).length;
    if (target.stats.deaths > 0) break;
  }
  expect(target.state.mode === MODE_DEAD || target.stats.deaths > 0).toBe(true);
  return hits;
}

describe('balance', () => {
  it('a fresh player survives about five clean hits pushed toward the long edge', () => {
    const hits = hitsToKnockout(0, 0, 1, 0);
    expect(hits).toBeGreaterThanOrEqual(5);
    expect(hits).toBeLessThanOrEqual(6);
  });

  it('a fresh player survives about five clean hits pushed toward the short edge', () => {
    // The short edge is only 20 m from the middle (25 m for the long one), so one fewer is fine.
    const hits = hitsToKnockout(3.5, 0, 0, 1);
    expect(hits).toBeGreaterThanOrEqual(4);
    expect(hits).toBeLessThanOrEqual(6);
  });

  it('after five hits, one well-placed hit near an edge knocks a player off', () => {
    const sim = new GameSim({ map: DEALERSHIP });
    sim.eventMult = 0; // measure knockback alone, no random events
    const a = sim.addPlayer('a');
    const b = sim.addPlayer('b');
    b.state.spawnProt = 0;
    b.state.px = 19;
    b.state.pz = 0;
    b.state.py = 0;
    b.state.inflation = 0.7;
    sim.applyHit(b, a.id, 1, 0, 0, 1, 0.14, { direct: true, low: false, x: 18.6, y: 1, z: 0 });
    const da = new Driver(sim, a);
    const db = new Driver(sim, b);
    run(sim, [da, db], 400);
    expect(b.stats.deaths).toBe(1);
    expect(a.stats.kos).toBe(1);
  });

  it('a fresh player hit near the same edge survives', () => {
    const sim = new GameSim({ map: DEALERSHIP });
    sim.eventMult = 0; // measure knockback alone, no random events
    const a = sim.addPlayer('a');
    const b = sim.addPlayer('b');
    b.state.spawnProt = 0;
    b.state.px = 19;
    b.state.pz = 0;
    b.state.py = 0;
    sim.applyHit(b, a.id, 1, 0, 0, 1, 0.14, { direct: true, low: false, x: 18.6, y: 1, z: 0 });
    const da = new Driver(sim, a);
    const db = new Driver(sim, b);
    run(sim, [da, db], 400);
    expect(b.stats.deaths).toBe(0);
  });

  it('hit-stop freezes the target for a beat, then the full knockback plays out', () => {
    const sim = new GameSim({ map: DEALERSHIP });
    sim.eventMult = 0; // measure knockback alone, no random events
    const a = sim.addPlayer('a');
    const b = sim.addPlayer('b');
    Object.assign(b.state, { px: 0, py: 0, pz: 0, spawnProt: 0 });
    const da = new Driver(sim, a);
    const db = new Driver(sim, b);
    run(sim, [da, db], 5);
    sim.applyHit(b, a.id, 1, 0, 0, 1, 0.15, { direct: true, low: false, x: -0.4, y: 1, z: 0 });
    const x0 = b.state.px;
    expect(b.state.hitStop).toBeGreaterThanOrEqual(0.045);
    run(sim, [da, db], 2);
    expect(b.state.px).toBe(x0); // frozen
    run(sim, [da, db], 30);
    expect(b.state.hitStop).toBe(0);
    expect(b.state.px - x0).toBeGreaterThan(1);
  });
});

