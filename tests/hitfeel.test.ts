import { describe, expect, it } from 'vitest';
import { koVerb } from '../src/client/ui/koWords';
import { BALANCE } from '../src/shared/balance';
import type { GameEvent } from '../src/shared/game/events';
import { GameSim, type SimPlayer, shotInflation } from '../src/shared/game/sim';
import { sanitizeLoadout } from '../src/shared/loadout';
import { DEALERSHIP } from '../src/shared/maps/dealership';
import { Driver, run } from './helpers';

function duel(weapon: 'airCannon' | 'pumpRifle' = 'airCannon') {
  const sim = new GameSim({ map: DEALERSHIP, durationSec: 999 });
  sim.eventMult = 0;
  const a = sim.addPlayer('shooter', { loadout: sanitizeLoadout({ weapon }) });
  const b = sim.addPlayer('target');
  sim.startMatch();
  const place = (p: SimPlayer, x: number, z: number, yaw = 0) => Object.assign(p.state, { px: x, py: 0, pz: z, vx: 0, vy: 0, vz: 0, yaw, spawnProt: 0, onGround: 1 });
  place(a, -10, 0, -Math.PI / 2);
  place(b, 2, 0);
  const da = new Driver(sim, a);
  const db = new Driver(sim, b);
  run(sim, [da, db], 2);
  da.aimAt(2, 1.1, 0);
  return { sim, a, b, da, db };
}

function hits(sim: GameSim): Extract<GameEvent, { t: 'hit' }>[] {
  return sim.drainEvents().filter((e): e is Extract<GameEvent, { t: 'hit' }> => e.t === 'hit');
}

describe('hit feel', () => {
  it('quick taps inflate nearly as much as a full charge (charging buys launch power)', () => {
    const W = BALANCE.weapons.airCannon;
    expect(shotInflation(1)).toBe(1);
    expect(shotInflation(W.tapPower)).toBeCloseTo(W.tapPower + (1 - W.tapPower) * BALANCE.inflation.tapBonus, 6);
    expect(shotInflation(W.tapPower)).toBeGreaterThan(W.tapPower);

    const { sim, b, da, db } = duel();
    sim.drainEvents();
    da.setFire(true);
    run(sim, [da, db], 1);
    da.setFire(false);
    run(sim, [da, db], 20);
    const h = hits(sim).find((e) => e.target === b.id && e.direct);
    expect(h).toBeTruthy();
    // A tap direct hit: about 75% of a full shot's inflation (the one tick held adds a hair), and
    // the event says how much it added.
    expect(b.state.inflation).toBeGreaterThanOrEqual(W.inflation * shotInflation(W.tapPower) - 1e-9);
    expect(b.state.inflation).toBeLessThan(W.inflation * shotInflation(W.tapPower) * 1.02);
    expect(h!.gain).toBeCloseTo(b.state.inflation, 6);
    expect(h!.infl).toBeCloseTo(b.state.inflation, 6);
  });

  it('the hit event reports only what this hit added, capped at 100%', () => {
    const { sim, b, da, db } = duel('pumpRifle');
    b.state.inflation = 0.9;
    sim.drainEvents();
    da.setFire(true);
    run(sim, [da, db], 70);
    da.setFire(false);
    run(sim, [da, db], 2);
    const h = hits(sim).find((e) => e.target === b.id);
    expect(h).toBeTruthy();
    expect(h!.infl).toBeCloseTo(1, 6);
    expect(h!.gain).toBeCloseTo(0.1, 6);
  });

  it('dashing out of a launch steers it instead of cancelling it, and costs a longer cooldown', () => {
    const { sim, b, da, db } = duel();
    const D = BALANCE.dash;
    // Launched hard to the side.
    b.state.inflation = 0.6;
    sim.applyHit(b, -1, 1, 0.5, 0, 1.4, 0, { direct: true, low: false, x: b.state.px, y: 1, z: b.state.pz });
    run(sim, [da, db], Math.ceil((D.launchLockout + BALANCE.knockback.hitStopMax) * 60) + 2);
    expect(b.state.launchTimer).toBeGreaterThan(0);
    const before = b.state.vx;
    // Dash straight back against the launch.
    db.frame.yaw = -Math.PI / 2;
    db.frame.moveZ = 1;
    db.press('dash');
    run(sim, [da, db], 1);
    expect(b.state.launchTimer).toBe(0);
    expect(b.state.dashCool).toBeGreaterThan(D.minInterval);
    // Most of the launch survives: a weaker dash can't fully reverse it.
    expect(b.state.vx).toBeGreaterThan(before * D.launchKeep - D.speed * D.launchDashMult - 0.5);
    expect(b.state.vx).toBeGreaterThan(0);
    const charges = b.state.dashCharges;
    db.press('dash');
    run(sim, [da, db], 3);
    expect(b.state.dashCharges).toBe(charges);
  });

  it('knockouts are popped, cracked, yeeted...', () => {
    const base = { tick: 100, victim: 3, vx: 0, vy: 0, vz: 0, tags: [] as string[] };
    const seen = new Set<string>();
    for (let t = 0; t < 40; t++) seen.add(koVerb({ ...base, tick: t }));
    expect(seen.has('popped')).toBe(true);
    expect(seen.has('cracked')).toBe(true);
    expect(koVerb({ ...base, vx: 40 })).toBe('yeeted');
    expect(koVerb({ ...base, tags: ['chain'] })).toBe('chain-popped');
    expect(koVerb({ ...base, tags: ['pin'] })).toBe('pinned');
    expect(koVerb(base)).toBe(koVerb({ ...base }));
  });
});
