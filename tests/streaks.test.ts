import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/shared/balance';
import type { GameEvent } from '../src/shared/game/events';
import { GameSim, type SimPlayer } from '../src/shared/game/sim';
import { DEALERSHIP } from '../src/shared/maps/dealership';
import { MODE_DEAD } from '../src/shared/player';
import { FLAG_POWERED, publicFlags } from '../src/shared/protocol';
import { Driver, run } from './helpers';

function setup(victims: number) {
  const sim = new GameSim({ map: DEALERSHIP, durationSec: 999 });
  sim.eventMult = 0;
  const a = sim.addPlayer('hero');
  const vs: SimPlayer[] = [];
  for (let i = 0; i < victims; i++) vs.push(sim.addPlayer(`v${i}`));
  sim.startMatch();
  for (const p of [a, ...vs]) p.state.spawnProt = 0;
  return { sim, a, vs, da: new Driver(sim, a) };
}

/** Knocks out `v`, credited to `by`. */
function pop(sim: GameSim, by: SimPlayer, v: SimPlayer): GameEvent[] {
  v.lastAttacker = by.id;
  v.lastAttackTime = sim.time;
  sim.knockout(v);
  return sim.drainEvents();
}

describe('streak rewards', () => {
  it('3 pops in one life: Turbo Tank refills and doubles reload and fire speed', () => {
    const { sim, a, vs, da } = setup(3);
    a.state.ammo = 1;
    a.state.dashCharges = 0;
    pop(sim, a, vs[0]);
    pop(sim, a, vs[1]);
    expect(a.state.turboTimer).toBe(0);
    const ev = pop(sim, a, vs[2]);
    expect(ev.find((e) => e.t === 'streak')).toMatchObject({ id: a.id, kind: 'turbo', n: 3 });
    expect(a.state.turboTimer).toBe(BALANCE.streaks.turboSeconds);
    expect(a.state.ammo).toBe(a.weapon.ammo);
    expect(a.state.dashCharges).toBe(BALANCE.dash.charges);
    expect(publicFlags(a.state) & FLAG_POWERED).toBeTruthy();
    // A tap shot: the fire cooldown is half as long.
    da.setFire(true);
    run(sim, [da], 2);
    da.setFire(false);
    run(sim, [da], 1);
    expect(a.state.fireCool).toBeGreaterThan(0);
    expect(a.state.fireCool).toBeLessThanOrEqual(a.weapon.fireCooldown / BALANCE.streaks.turboRate);
    // And it wears off.
    run(sim, [da], Math.ceil(BALANCE.streaks.turboSeconds * 60) + 5);
    expect(a.state.turboTimer).toBe(0);
  });

  it('5 pops: Mega Blast makes the next shots full power, bigger and wider', () => {
    const { sim, a, vs, da } = setup(5);
    for (let i = 0; i < 4; i++) pop(sim, a, vs[i]);
    const ev = pop(sim, a, vs[4]);
    expect(ev.find((e) => e.t === 'streak')).toMatchObject({ kind: 'mega', n: 5 });
    expect(a.state.megaShots).toBe(BALANCE.streaks.megaShots);
    // A quick tap still fires a full-power, oversized shot.
    da.setFire(true);
    run(sim, [da], 2);
    da.setFire(false);
    run(sim, [da], 1);
    const shot = sim.drainEvents().find((e) => e.t === 'shot' && e.owner === a.id) as Extract<GameEvent, { t: 'shot' }> | undefined;
    expect(shot).toBeTruthy();
    expect(shot!.power).toBe(1);
    expect(shot!.r).toBeCloseTo(a.weapon.projRadius * BALANCE.streaks.megaRadius, 5);
    expect(a.state.megaShots).toBe(BALANCE.streaks.megaShots - 1);
  });

  it('getting popped ends the streak and its rewards', () => {
    const { sim, a, vs, da } = setup(5);
    for (let i = 0; i < 5; i++) pop(sim, a, vs[i]);
    expect(a.state.turboTimer).toBeGreaterThan(0);
    expect(a.state.megaShots).toBeGreaterThan(0);
    sim.knockout(a);
    expect(a.state.mode).toBe(MODE_DEAD);
    run(sim, [da], Math.ceil(BALANCE.match.respawnDelay * 60) + 5);
    expect(a.state.mode).not.toBe(MODE_DEAD);
    expect(a.state.turboTimer).toBe(0);
    expect(a.state.megaShots).toBe(0);
    expect(a.streak).toBe(0);
  });
});
