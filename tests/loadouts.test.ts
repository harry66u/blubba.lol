import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/shared/balance';
import { GameSim, PROJ_WALL, type SimPlayer } from '../src/shared/game/sim';
import { type Loadout, computeWeaponStats, sanitizeLoadout } from '../src/shared/loadout';
import { DEALERSHIP } from '../src/shared/maps/dealership';
import { MODE_DEAD } from '../src/shared/player';
import { Driver, run } from './helpers';

function setup(loadouts: Partial<Loadout>[]) {
  const sim = new GameSim({ map: DEALERSHIP, durationSec: 999 });
  const ps: SimPlayer[] = [];
  const ds: Driver[] = [];
  loadouts.forEach((l, i) => {
    const p = sim.addPlayer(`p${i}`, { loadout: sanitizeLoadout(l) });
    p.state.spawnProt = 0;
    ps.push(p);
    ds.push(new Driver(sim, p));
  });
  return { sim, ps, ds };
}

function place(p: SimPlayer, x: number, y: number, z: number, yaw = 0) {
  Object.assign(p.state, { px: x, py: y, pz: z, vx: 0, vy: 0, vz: 0, yaw, spawnProt: 0, onGround: 1 });
}

function charged(sim: GameSim, d: Driver, ticks = 70) {
  d.setFire(true);
  run(sim, [d], ticks);
  d.setFire(false);
}

describe('loadouts', () => {
  it('mods are trade-offs, and conflicting mods cannot be combined', () => {
    const base = computeWeaponStats('airCannon', []);
    const tank = computeWeaponStats('airCannon', ['bigTank']);
    expect(tank.ammo).toBeGreaterThan(base.ammo);
    expect(tank.reloadTime).toBeGreaterThan(base.reloadTime);
    const cv = computeWeaponStats('airCannon', ['chargeValve']);
    expect(cv.knockback).toBeGreaterThan(base.knockback);
    expect(cv.fireCooldown).toBeGreaterThan(base.fireCooldown);
    const qv = computeWeaponStats('airCannon', ['quickValve']);
    expect(qv.fireCooldown).toBeLessThan(base.fireCooldown);
    expect(qv.knockback).toBeLessThan(base.knockback);
    const wide = computeWeaponStats('airCannon', ['wideNozzle']);
    expect(wide.blastRadius).toBeGreaterThan(base.blastRadius);
    expect(wide.projLifetime).toBeLessThan(base.projLifetime);
    const lb = computeWeaponStats('airCannon', ['longBarrel']);
    expect(lb.projLifetime).toBeGreaterThan(base.projLifetime);
    expect(lb.blastRadius).toBeLessThan(base.blastRadius);
    expect(sanitizeLoadout({ weapon: 'airHorn', mods: ['chargeValve', 'quickValve', 'bigTank'] }).mods).toEqual(['chargeValve', 'bigTank']);
    expect(sanitizeLoadout({ weapon: 'bogus', mods: ['x'], utils: ['airGrenade', 'airGrenade'] })).toEqual({ weapon: 'airCannon', mods: [], utils: ['airGrenade', 'bouncePad'] });
  });

  it('Leaf Blower pushes whoever is in the stream', () => {
    const { sim, ps, ds } = setup([{ weapon: 'leafBlower' }, {}]);
    const [a, b] = ps;
    place(a, 0, 0, 0, 0);
    place(b, 0, 0, -5, 0);
    ds[0].setFire(true);
    run(sim, ds, 60);
    expect(b.state.pz).toBeLessThan(-7);
    expect(b.state.inflation).toBeGreaterThan(0);
    expect(b.lastAttacker).toBe(a.id);
    expect(a.state.ammo).toBeLessThan(BALANCE.weapons.leafBlower.ammo);
  });

  it('Leaf Blower aimed at the ground lets you hover', () => {
    const { sim, ps, ds } = setup([{ weapon: 'leafBlower' }]);
    const p = ps[0];
    place(p, 0, 3, 0);
    p.state.onGround = 0;
    ds[0].frame.pitch = -1.3;
    ds[0].setFire(true);
    let minVy = 0;
    run(sim, ds, 40, () => (minVy = Math.min(minVy, p.state.vy)));
    expect(p.state.py).toBeGreaterThan(2.5);
    expect(minVy).toBeGreaterThan(-5);
  });

  it('Air Blaster blasts close targets hard and ignores far ones', () => {
    const { sim, ps, ds } = setup([{ weapon: 'airHorn' }, {}, {}]);
    const [a, near, far] = ps;
    place(a, 0, 0, 0, 0);
    place(near, 0, 0, -3, 0);
    place(far, 0.5, 0, -12, 0);
    charged(sim, ds[0], 40);
    run(sim, ds, 2);
    // (Still in hit-stop, so part of the knockback is waiting in hsVz.)
    expect(near.state.vz + near.state.hsVz).toBeLessThan(-7);
    expect(near.state.inflation).toBeGreaterThan(0.1);
    expect(far.state.inflation).toBe(0);
    // Recoil pushed the shooter backwards.
    expect(a.state.pz).toBeGreaterThan(0.05);
  });

  it('Pump Rifle rewards precise aim with extra inflation', () => {
    const { sim, ps, ds } = setup([{ weapon: 'pumpRifle' }, {}]);
    const [a, b] = ps;
    place(a, -20, 0, 0, -Math.PI / 2);
    place(b, 15, 0, 0);
    run(sim, ds, 2);
    ds[0].aimAt(15, 1.1, 0);
    charged(sim, ds[0], 70);
    run(sim, ds, 2);
    expect(b.state.inflation).toBeCloseTo(BALANCE.weapons.pumpRifle.inflation, 2);
    // Aim half a meter to the side: clean miss.
    const { sim: sim2, ps: ps2, ds: ds2 } = setup([{ weapon: 'pumpRifle' }, {}]);
    place(ps2[0], -20, 0, 0, -Math.PI / 2);
    place(ps2[1], 15, 0, 0);
    run(sim2, ds2, 2);
    ds2[0].aimAt(15, 1.1, 0.95);
    charged(sim2, ds2[0], 70);
    run(sim2, ds2, 2);
    expect(ps2[1].state.inflation).toBe(0);
  });

  it('Pump Rifle is lag compensated: shots land where the shooter saw the target', () => {
    const { sim, ps, ds } = setup([{ weapon: 'pumpRifle' }, {}]);
    const [a, b] = ps;
    place(a, -20, 0, 0, -Math.PI / 2);
    place(b, 10, 0, 0);
    run(sim, ds, 2);
    ds[0].aimAt(10, 1.1, 0);
    ds[0].setFire(true);
    run(sim, ds, 70);
    const seenTick = sim.tick;
    // The target has since moved 2 m sideways; the shooter still aims at where they saw it.
    b.state.pz = 2;
    run(sim, ds, 6, () => (b.state.pz = 2));
    ds[0].setFire(false);
    ds[0].frame.viewTick = seenTick;
    run(sim, ds, 2);
    expect(b.state.inflation).toBeGreaterThan(0.1);
  });

  it('Bounce Pad deploys where it lands and launches players', () => {
    const { sim, ps, ds } = setup([{ utils: ['bouncePad', 'airGrenade'] }]);
    const p = ps[0];
    place(p, 0, 0, 0, 0);
    ds[0].frame.pitch = -0.6;
    ds[0].press('util1');
    run(sim, ds, 90);
    const pad = sim.world.pads.find((x) => x.owner === p.id);
    expect(pad).toBeTruthy();
    place(p, pad!.x, pad!.y + 0.5, pad!.z);
    p.state.onGround = 0;
    let maxVy = 0;
    run(sim, ds, 30, () => (maxVy = Math.max(maxVy, p.state.vy)));
    expect(maxVy).toBeGreaterThan(15);
    expect(p.state.u1Cool).toBeGreaterThan(0);
  });

  it('Air Grenade blasts everyone nearby outward', () => {
    const { sim, ps, ds } = setup([{ utils: ['airGrenade', 'bouncePad'] }, {}]);
    const [a, b] = ps;
    place(a, 0, 0, 0, 0);
    place(b, 0, 0, -7, 0);
    ds[0].frame.pitch = -0.2;
    ds[0].press('util1');
    run(sim, ds, 120);
    expect(b.state.inflation).toBeGreaterThan(0);
    expect(sim.drainEvents().some((e) => e.t === 'boom' && e.k === 1)).toBe(true);
  });

  it('Inflatable Wall blocks shots, and becomes a raft when thrown while falling', () => {
    const { sim, ps, ds } = setup([{ utils: ['inflatableWall', 'airGrenade'] }, {}]);
    const [a] = ps;
    place(a, 0, 0, 0, 0);
    ds[0].frame.pitch = -0.3;
    ds[0].press('util1');
    run(sim, ds, 90);
    expect(sim.dynamicSolids.size).toBe(1);
    const wall = [...sim.dynamicSolids.values()][0];
    expect(wall.raft).toBe(false);
    // Falling off the edge: the wall turns into a raft under your feet.
    const { sim: s2, ps: p2, ds: d2 } = setup([{ utils: ['inflatableWall', 'airGrenade'] }]);
    place(p2[0], 30, -3, 0);
    p2[0].state.onGround = 0;
    p2[0].state.vy = -8;
    d2[0].press('util1');
    run(s2, d2, 20);
    expect([...s2.dynamicSolids.values()][0]?.raft).toBe(true);
    expect(p2[0].state.onGround).toBe(1);
    expect(p2[0].state.mode).not.toBe(MODE_DEAD);
    void PROJ_WALL;
  });

  it('Vacuum Grenade pulls players toward it', () => {
    const { sim, ps, ds } = setup([{ utils: ['vacuumGrenade', 'airGrenade'] }, {}]);
    const [a, b] = ps;
    place(a, 0, 0, 0, 0);
    place(b, 5, 0, -8, 0);
    ds[0].frame.pitch = -0.25;
    ds[0].press('util1');
    let pulled = false;
    run(sim, ds, 120, () => {
      if (sim.vacuums.length && Math.hypot(b.state.vx, b.state.vz) > 2) pulled = true;
    });
    expect(pulled).toBe(true);
  });

  it('Soda cans refill dashes, and a pin pops anyone at max inflation', () => {
    const { sim, ps, ds } = setup([{}, {}]);
    const [a, b] = ps;
    const soda = sim.pickups[0];
    place(a, soda.x, soda.y, soda.z);
    a.state.dashCharges = 0;
    run(sim, ds, 2);
    expect(a.state.dashCharges).toBe(BALANCE.dash.charges);
    expect(soda.active).toBe(false);
    a.state.pinTimer = 10;
    place(a, 0, 0, 0, 0);
    place(b, 0, 0, -4, 0);
    b.state.inflation = 1;
    charged(sim, ds[0], 60);
    run(sim, ds, 30);
    expect(b.stats.deaths).toBe(1);
    expect(a.stats.kos).toBe(1);
    expect(a.state.pinTimer).toBe(0);
  });

  it('loadout changes apply on respawn', () => {
    const { sim, ps, ds } = setup([{}]);
    const p = ps[0];
    run(sim, ds, 2);
    sim.startMatch();
    sim.setLoadout(p.id, { weapon: 'pumpRifle', mods: [], utils: ['bouncePad', 'airGrenade'] });
    expect(p.loadout.weapon).toBe('airCannon');
    sim.knockout(p);
    run(sim, ds, Math.ceil(BALANCE.match.respawnDelay * 60) + 5);
    expect(p.loadout.weapon).toBe('pumpRifle');
    expect(p.state.ammo).toBe(BALANCE.weapons.pumpRifle.ammo);
  });
});
