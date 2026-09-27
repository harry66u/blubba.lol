import { describe, expect, it } from 'vitest';
import { GameSim } from '../src/shared/game/sim';
import { DEALERSHIP } from '../src/shared/maps/dealership';
import { Driver, run } from './helpers';

describe('match results', () => {
  it('records a replay of the longest launch and hands out awards', () => {
    const sim = new GameSim({ map: DEALERSHIP, durationSec: 20 });
    sim.eventMult = 0;
    const a = sim.addPlayer('a');
    const b = sim.addPlayer('b');
    const ds = [new Driver(sim, a), new Driver(sim, b)];
    sim.startMatch();
    run(sim, ds, 60);
    Object.assign(b.state, { px: 15, py: 0, pz: 0, spawnProt: 0, inflation: 0.8 });
    sim.applyHit(b, a.id, 1, 0, 0, 1.2, 0.1, { direct: true, low: false, x: 14.6, y: 1, z: 0 });
    run(sim, ds, 22 * 60);
    const r = sim.lastResult!;
    expect(r).toBeTruthy();
    expect(r.replay).toBeTruthy();
    expect(r.replay!.victim).toBe(b.id);
    expect(r.replay!.by).toBe(a.id);
    expect(r.replay!.frames.length).toBeGreaterThan(20);
    expect(r.awards.find((w) => w.key === 'longestLaunch')?.id).toBe(a.id);
    expect(r.awards.find((w) => w.key === 'mostKos')?.id).toBe(a.id);
    // Keep it small enough to send once per match.
    expect(JSON.stringify(r).length).toBeLessThan(60000);
  });
});
