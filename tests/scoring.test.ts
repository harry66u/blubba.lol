import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/shared/balance';
import { GameSim, type SimPlayer } from '../src/shared/game/sim';
import { DEALERSHIP } from '../src/shared/maps/dealership';

/** Knocks `victim` out, credited to `by`. */
function ko(sim: GameSim, victim: SimPlayer, by: SimPlayer): void {
  victim.lastAttacker = by.id;
  victim.lastAttackTime = sim.time;
  sim.knockout(victim);
}

describe('scoring', () => {
  it('Knockout: one point per knockout, and the first to the target wins', () => {
    const sim = new GameSim({ map: DEALERSHIP, mode: 'knockout', durationSec: 999 });
    const a = sim.addPlayer('a');
    const b = sim.addPlayer('b');
    sim.startMatch();
    const target = BALANCE.modes.knockout.target;
    for (let i = 0; i < target - 1; i++) {
      ko(sim, b, a);
      sim.step();
    }
    expect(a.score).toBe(target - 1);
    expect(sim.phase).toBe('playing');
    ko(sim, b, a);
    sim.step();
    expect(sim.phase).toBe('results');
    expect(sim.lastResult!.winnerId).toBe(a.id);
  });

  it('Team Knockout: the first team to its target wins', () => {
    const sim = new GameSim({ map: DEALERSHIP, mode: 'teamKnockout', durationSec: 999 });
    const a = sim.addPlayer('a');
    const b = sim.addPlayer('b');
    sim.startMatch();
    expect(a.team).not.toBe(b.team);
    for (let i = 0; i < BALANCE.modes.teamKnockout.target; i++) {
      ko(sim, b, a);
      sim.step();
    }
    expect(sim.phase).toBe('results');
    expect(sim.lastResult!.teams!.winner).toBe(a.team);
  });
});
