import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/shared/balance';
import { GameSim, type SimPlayer } from '../src/shared/game/sim';
import { DEALERSHIP } from '../src/shared/maps/dealership';
import { MODE_DEAD, MODE_HANG, MODE_HELD, MODE_NORMAL } from '../src/shared/player';
import { Driver, run } from './helpers';

function setup(n = 2) {
  const sim = new GameSim({ map: DEALERSHIP, durationSec: 999 });
  const ps: SimPlayer[] = [];
  const ds: Driver[] = [];
  for (let i = 0; i < n; i++) {
    const p = sim.addPlayer(`p${i}`);
    p.state.spawnProt = 0;
    ps.push(p);
    ds.push(new Driver(sim, p));
  }
  return { sim, ps, ds };
}

function place(p: SimPlayer, x: number, y: number, z: number, yaw = 0) {
  Object.assign(p.state, { px: x, py: y, pz: z, vx: 0, vy: 0, vz: 0, yaw, spawnProt: 0, onGround: 1 });
}

const hitSpeed = (sim: GameSim, target: number) => {
  const hits = sim.drainEvents().filter((e) => e.t === 'hit' && e.target === target);
  const h = hits[hits.length - 1];
  return h && h.t === 'hit' ? h.speed : 0;
};

describe('skill layer', () => {
  it('brace right before a hit cuts its knockback', () => {
    const { sim, ps, ds } = setup();
    const [a, b] = ps;
    place(b, 0, 0, 0);
    run(sim, ds, 5);
    sim.applyHit(b, a.id, 1, 0, 0, 1, 0.14, { direct: true, low: false, x: 0, y: 1, z: 0 });
    const normal = hitSpeed(sim, b.id);
    b.state.inflation = 0;
    place(b, 0, 0, 0);
    run(sim, ds, 120);
    ds[1].press('brace');
    run(sim, ds, 3);
    expect(b.state.braceTimer).toBeGreaterThan(0);
    sim.applyHit(b, a.id, 1, 0, 0, 1, 0.14, { direct: true, low: false, x: 0, y: 1, z: 0 });
    const braced = hitSpeed(sim, b.id);
    expect(braced / normal).toBeCloseTo(BALANCE.brace.knockbackMult, 1);
    // Brace can't be spammed: pressing again right away does nothing.
    run(sim, ds, 20);
    const cool = b.state.braceCool;
    expect(cool).toBeGreaterThan(0);
    ds[1].press('brace');
    run(sim, ds, 2);
    expect(b.state.braceCool).toBeLessThan(cool);
    expect(b.state.braceTimer).toBe(0);
  });

  it('catches a ledge while falling and climbs back up', () => {
    const { sim, ps, ds } = setup();
    const p = ps[0];
    // Just past the east edge of the lot (x = 25), falling, facing west.
    place(p, 25.5, -1.5, 0, Math.PI / 2);
    p.state.onGround = 0;
    p.state.vy = -2;
    ds[0].frame.yaw = Math.PI / 2;
    ds[0].press('grab');
    run(sim, ds, 5);
    expect(p.state.mode).toBe(MODE_HANG);
    ds[0].frame.moveZ = 1;
    run(sim, ds, 30);
    ds[0].frame.moveZ = 0;
    run(sim, ds, 5);
    expect(p.state.mode).toBe(MODE_NORMAL);
    expect(p.state.py).toBeCloseTo(0, 1);
    expect(p.state.px).toBeLessThan(25);
  });

  it('stomping a hanging player’s hands knocks them off and gives credit', () => {
    const { sim, ps, ds } = setup();
    const [a, b] = ps;
    place(b, 25.5, -1.5, 0, Math.PI / 2);
    b.state.onGround = 0;
    b.state.vy = -2;
    ds[1].frame.yaw = Math.PI / 2;
    ds[1].press('grab');
    run(sim, ds, 5);
    expect(b.state.mode).toBe(MODE_HANG);
    place(a, 24.2, 0, 0, -Math.PI / 2);
    ds[0].press('grab');
    run(sim, ds, 3);
    expect(b.state.mode).toBe(MODE_NORMAL);
    expect(b.state.vy).toBeLessThan(0);
    run(sim, ds, 200);
    expect(b.stats.deaths).toBe(1);
    expect(a.stats.kos).toBe(1);
  });

  it('grab then throw launches the held player', () => {
    const { sim, ps, ds } = setup();
    const [a, b] = ps;
    place(a, 0, 0, 0, 0);
    place(b, 0, 0, -1.6, 0);
    ds[0].press('grab');
    run(sim, ds, 2);
    expect(b.state.mode).toBe(MODE_HELD);
    expect(a.state.holding).toBe(b.id);
    // Can't throw before the escape window has passed.
    ds[0].setFire(true);
    run(sim, ds, 5);
    expect(b.state.mode).toBe(MODE_HELD);
    run(sim, ds, 40);
    expect(b.state.mode).toBe(MODE_NORMAL);
    expect(b.state.inflation).toBeGreaterThan(0);
    expect(b.state.vz).toBeLessThan(-5);
    expect(sim.drainEvents().some((e) => e.t === 'throw')).toBe(true);
  });

  it('one well-timed dash escapes a grab; a mistimed one uses up the attempt', () => {
    for (const [waitTicks, shouldEscape] of [
      [28, true],
      [5, false],
    ] as const) {
      const { sim, ps, ds } = setup();
      const [a, b] = ps;
      place(a, 0, 0, 0, 0);
      place(b, 0, 0, -1.6, 0);
      ds[0].press('grab');
      run(sim, ds, 1);
      expect(b.state.mode).toBe(MODE_HELD);
      run(sim, ds, waitTicks);
      ds[1].press('dash');
      run(sim, ds, 2);
      if (shouldEscape) {
        expect(b.state.mode).toBe(MODE_NORMAL);
        expect(b.state.dashCharges).toBe(BALANCE.dash.charges - 1);
      } else {
        expect(b.state.mode).toBe(MODE_HELD);
        // Mashing more doesn't help.
        for (let i = 0; i < 10; i++) {
          ds[1].press('dash');
          run(sim, ds, 2);
        }
        expect(b.state.mode === MODE_HELD || a.state.holding < 0).toBe(true);
        expect(sim.drainEvents().some((e) => e.t === 'escape')).toBe(false);
      }
    }
  });

  it('take-you-with-me: a falling player drags someone off and gets the knockout', () => {
    const { sim, ps, ds } = setup();
    const [a, b] = ps;
    place(b, 24.4, 0, 0, 0);
    // a is falling just past the edge, facing b.
    place(a, 25.9, -0.5, 0, Math.PI / 2);
    a.state.onGround = 0;
    a.state.vy = -6;
    ds[0].frame.yaw = Math.PI / 2;
    ds[0].press('grab');
    run(sim, ds, 2);
    expect(b.state.mode).toBe(MODE_HELD);
    expect(sim.drainEvents().some((e) => e.t === 'grab' && e.drag)).toBe(true);
    run(sim, ds, 300);
    expect(b.stats.deaths).toBe(1);
    expect(a.stats.kos).toBe(1);
  });

  it('grapple zips you back to the map when aimed at it', () => {
    const { sim, ps, ds } = setup();
    const p = ps[0];
    place(p, 34, -3, 0, Math.PI / 2);
    p.state.onGround = 0;
    p.state.vy = -5;
    // Aim west and slightly up toward the lot.
    ds[0].frame.yaw = Math.PI / 2;
    ds[0].frame.pitch = -0.05;
    ds[0].press('grapple');
    run(sim, ds, 2);
    expect(p.state.zipTimer).toBeGreaterThan(0);
    run(sim, ds, 60);
    expect(p.state.px).toBeLessThan(27);
    expect(p.state.mode).not.toBe(MODE_DEAD);
  });

  it("a full balloon can't grapple right after a hit, and its rope is shorter", () => {
    const G = BALANCE.grapple;
    const tryZip = (inflation: number, sinceHit: number, x: number) => {
      const { sim, ps, ds } = setup();
      const p = ps[0];
      place(p, x, -3, 0, Math.PI / 2);
      Object.assign(p.state, { onGround: 0, vy: -5, inflation, sinceHit });
      ds[0].frame.yaw = Math.PI / 2;
      ds[0].frame.pitch = -0.05;
      ds[0].press('grapple');
      run(sim, ds, 1);
      return p.state.zipTimer > 0;
    };
    // Just hit at 100%: locked for hitLock + hitLockPerInflation seconds.
    expect(tryZip(1, 0.2, 34)).toBe(false);
    expect(tryZip(1, G.hitLock + G.hitLockPerInflation + 0.1, 34)).toBe(true);
    // Half inflated: a much shorter lock.
    expect(tryZip(0.5, G.hitLock + G.hitLockPerInflation * 0.25 + 0.1, 34)).toBe(true);
    // Range: the lot's edge ~24 m away is in reach empty, out of reach at 100%.
    expect(tryZip(0, 5, 49)).toBe(true);
    expect(tryZip(1, 5, 49)).toBe(false);
  });

  it('hits that leave someone at 100% launch harder', () => {
    const K = BALANCE.knockback;
    const bonus = K.maxedMult;
    const speedAt = (inflation: number) => {
      const { sim, ps, ds } = setup();
      const [a, b] = ps;
      place(a, -8, 0, 0, -Math.PI / 2);
      place(b, 0, 0, 0);
      b.state.inflation = inflation;
      ds[0].aimAt(0, 1.5, 0);
      ds[0].setFire(true);
      run(sim, ds, 40);
      ds[0].setFire(false);
      b.state.inflation = inflation;
      run(sim, ds, 20);
      return hitSpeed(sim, b.id);
    };
    const boosted = speedAt(1);
    try {
      K.maxedMult = 1;
      expect(boosted / speedAt(1)).toBeCloseTo(bonus, 2);
    } finally {
      K.maxedMult = bonus;
    }
    // Below 100% nothing changes.
    const low = speedAt(0.3);
    try {
      K.maxedMult = 1;
      expect(low / speedAt(0.3)).toBeCloseTo(1, 5);
    } finally {
      K.maxedMult = bonus;
    }
  });

  it('grapple pulls an enemy toward you', () => {
    const { sim, ps, ds } = setup();
    const [a, b] = ps;
    place(a, 0, 0, 0, 0);
    place(b, 0, 0, -12, 0);
    ds[0].frame.pitch = 0;
    ds[0].press('grapple');
    run(sim, ds, 2);
    expect(b.state.vz).toBeGreaterThan(8);
    expect(b.lastAttacker).toBe(a.id);
  });

  it('blast jumping launches you without inflating you', () => {
    const { sim, ps, ds } = setup();
    const p = ps[0];
    place(p, 0, 0, 0, 0);
    run(sim, ds, 5);
    ds[0].frame.pitch = -1.5;
    ds[0].setFire(true);
    run(sim, ds, 50);
    ds[0].setFire(false);
    let maxY = 0;
    run(sim, ds, 60, () => (maxY = Math.max(maxY, p.state.py)));
    expect(maxY).toBeGreaterThan(2.5);
    expect(p.state.inflation).toBe(0);
  });

  it('counts air combos on a juggled target', () => {
    const { sim, ps, ds } = setup();
    const [a, b] = ps;
    place(b, 0, 0, 0);
    run(sim, ds, 2);
    sim.applyHit(b, a.id, 0, 1, 0, 1, 0.1, { direct: true, low: true, x: 0, y: 0.2, z: 0 });
    run(sim, ds, 10);
    sim.applyHit(b, a.id, 0, 1, 0, 1, 0.1, { direct: true, low: false, x: 0, y: 1, z: 0 });
    const hits = sim.drainEvents().filter((e) => e.t === 'hit');
    const last = hits[hits.length - 1];
    expect(last.t === 'hit' && last.combo).toBe(2);
    expect(a.stats.bestCombo).toBe(2);
  });

  it('steering against a launch shortens it', () => {
    const dist = (steer: number) => {
      const { sim, ps, ds } = setup();
      const [a, b] = ps;
      place(b, -10, 0, 0, -Math.PI / 2); // facing +x
      b.state.inflation = 0.6;
      run(sim, ds, 2);
      ds[1].frame.yaw = -Math.PI / 2;
      ds[1].frame.moveZ = steer; // forward = +x... steer back against the launch
      sim.applyHit(b, a.id, 1, 0, 0, 1, 0, { direct: true, low: false, x: -10.4, y: 1, z: 0 });
      let x = b.state.px;
      run(sim, ds, 90, () => (x = b.state.px));
      return x + 10;
    };
    expect(dist(-1)).toBeLessThan(dist(0) - 1);
  });
});
