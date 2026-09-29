import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/shared/balance';
import type { GameEvent } from '../src/shared/game/events';
import { GameSim, type SimPlayer } from '../src/shared/game/sim';
import {
  type Loadout,
  PART_SLOTS,
  SLOT_PARTS,
  STANDARD_PARTS,
  WEAPON_IDS,
  type WeaponStats,
  computeWeaponStats,
  normalizeParts,
  sanitizeLoadout,
  weaponRange,
} from '../src/shared/loadout';
import { DEALERSHIP } from '../src/shared/maps/dealership';
import { eyeHeight } from '../src/shared/player';
import { lobPitch, pelletDirs, spreadAt } from '../src/shared/shots';
import { Driver, run } from './helpers';

function setup(loadouts: Partial<Loadout>[]) {
  const sim = new GameSim({ map: DEALERSHIP, durationSec: 999 });
  sim.eventMult = 0;
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

/** Holds fire for `ticks`, releases, and returns the events of the next few ticks. */
function fire(sim: GameSim, ds: Driver[], d: Driver, ticks: number, after = 3): GameEvent[] {
  sim.drainEvents();
  d.setFire(true);
  run(sim, ds, ticks);
  d.setFire(false);
  run(sim, ds, after);
  return sim.drainEvents();
}

/** Bubble Shotgun: fires at a target `dist` meters away and reports what landed. */
function shotgunAt(dist: number, holdTicks: number) {
  const { sim, ps, ds } = setup([{ weapon: 'bubbleShotgun' }, {}]);
  const [a, b] = ps;
  place(a, 0, 0, 0, 0);
  place(b, 0, 0, -dist, 0);
  run(sim, ds, 2);
  ds[0].aimAt(0, 1.2, -dist);
  const ev = fire(sim, ds, ds[0], holdTicks);
  const volley = ev.find((e) => e.t === 'pellets') as Extract<GameEvent, { t: 'pellets' }>;
  const hits = ev.filter((e) => e.t === 'hit' && e.target === b.id);
  return { a, b, volley, hits };
}

describe('Bubble Shotgun', () => {
  it('up close every pellet lands as one combined hit', () => {
    const { b, volley, hits } = shotgunAt(3, 2);
    expect(volley.ends.length).toBe(BALANCE.weapons.bubbleShotgun.pellets);
    expect(volley.hits).toBe(BALANCE.weapons.bubbleShotgun.pellets);
    // One hit event (one launch, one hit-stop), not seven.
    expect(hits.length).toBe(1);
    const W = BALANCE.weapons.bubbleShotgun;
    expect(b.state.inflation).toBeCloseTo(W.inflation * volley.power, 3);
  });

  it('is weak at range, and charging tightens the ring so it reaches further', () => {
    const close = shotgunAt(3, 2);
    const far = shotgunAt(16, 2);
    expect(far.b.state.inflation).toBeLessThan(close.b.state.inflation * 0.3);
    const tap = shotgunAt(9, 2);
    const charged = shotgunAt(9, 45);
    expect(charged.volley.hits).toBeGreaterThan(tap.volley.hits);
    expect(charged.b.state.inflation).toBeGreaterThan(tap.b.state.inflation * 2);
  });

  it('uses a fixed pellet pattern (no randomness) that shrinks with charge', () => {
    const w = computeWeaponStats('bubbleShotgun');
    const a = pelletDirs(0, 0, -1, spreadAt(w, 0), w.pellets, []);
    const b = pelletDirs(0, 0, -1, spreadAt(w, 0), w.pellets, []);
    expect(a).toEqual(b);
    const tight = pelletDirs(0, 0, -1, spreadAt(w, 1), w.pellets, []);
    // Ring pellets point closer to the aim when charged.
    expect(-tight[5]).toBeGreaterThan(-a[5]);
    for (let i = 0; i < a.length; i += 3) expect(Math.hypot(a[i], a[i + 1], a[i + 2])).toBeCloseTo(1, 6);
  });
});

describe('Balloon Mortar', () => {
  it('lobs a balloon on an arc whose splash knocks a whole group around', () => {
    const { sim, ps, ds } = setup([{ weapon: 'balloonMortar' }, {}, {}, {}]);
    const [a, ...group] = ps;
    place(a, 0, 0, 0, 0);
    place(group[0], 0, 0, -14);
    place(group[1], 1.6, 0, -14.5);
    place(group[2], -1.6, 0, -13.5);
    run(sim, ds, 2);
    const w = a.weapon;
    const pitch = lobPitch(w.projSpeed, w.projGravity, w.projLoft, 14, 0.1 - eyeHeight(a.state));
    expect(pitch).not.toBeNull();
    ds[0].frame.pitch = pitch!;
    sim.drainEvents();
    ds[0].setFire(true);
    run(sim, ds, 50);
    ds[0].setFire(false);
    let peak = -Infinity;
    let fell = false;
    const events: GameEvent[] = [];
    run(sim, ds, 90, () => {
      for (const pr of sim.projectiles) {
        if (pr.owner !== a.id) continue;
        peak = Math.max(peak, pr.y);
        fell ||= pr.vy < -3;
      }
      events.push(...sim.drainEvents());
    });
    const shot = events.find((e) => e.t === 'shot' && e.owner === a.id) as Extract<GameEvent, { t: 'shot' }> | undefined;
    expect(shot?.g).toBe(BALANCE.weapons.balloonMortar.projGravity);
    // It went up before coming down (the loft lifts even a flat-ish shot).
    expect(shot!.vy).toBeGreaterThan(0);
    expect(peak).toBeGreaterThan(shot!.y + 0.3);
    expect(fell).toBe(true);
    for (const p of group) expect(p.state.inflation).toBeGreaterThan(0.03);
    expect(events.some((e) => e.t === 'boom' && e.r > 3)).toBe(true);
  });

  it('bots aim their lobs with a ballistic solution that lands on the target', () => {
    const w = computeWeaponStats('balloonMortar');
    for (const dist of [8, 14, 20]) {
      const pitch = lobPitch(w.projSpeed, w.projGravity, w.projLoft, dist, -1.7)!;
      // Fly it: where does it come down to the target's height?
      const d = { x: 0, y: Math.sin(pitch) + w.projLoft, z: Math.cos(pitch) };
      const l = Math.hypot(d.y, d.z);
      let y = 0;
      let z = 0;
      let vy = (d.y / l) * w.projSpeed;
      const vz = (d.z / l) * w.projSpeed;
      for (let t = 0; t < 5; t += 1 / 600) {
        vy -= w.projGravity / 600;
        y += vy / 600;
        z += vz / 600;
        if (vy < 0 && y <= -1.7) break;
      }
      expect(Math.abs(z - dist)).toBeLessThan(0.3);
    }
    expect(weaponRange(w)).toBeGreaterThan(20);
  });
});

describe('Pop Gun', () => {
  it('sprays while held; each cork pushes and inflates a little, with no launch or hit-stop', () => {
    const { sim, ps, ds } = setup([{ weapon: 'popGun' }, {}]);
    const [a, b] = ps;
    place(a, 0, 0, 0, 0);
    place(b, 0, 0, -8, 0);
    run(sim, ds, 2);
    ds[0].aimAt(0, 1.2, -8);
    sim.drainEvents();
    ds[0].setFire(true);
    const events: GameEvent[] = [];
    let frozen = false;
    let launched = false;
    run(sim, ds, 50, () => {
      ds[0].aimAt(b.state.px, b.state.py + 1.2, b.state.pz);
      frozen ||= b.state.hitStop > 0;
      launched ||= b.state.launchTimer > 0;
      events.push(...sim.drainEvents());
    });
    const shots = events.filter((e) => e.t === 'shot' && e.owner === a.id).length;
    const taps = events.filter((e) => e.t === 'tap' && e.target === b.id).length;
    expect(shots).toBeGreaterThanOrEqual(7);
    expect(taps).toBeGreaterThanOrEqual(4);
    expect(events.some((e) => e.t === 'hit' && e.target === b.id)).toBe(false);
    expect(frozen).toBe(false);
    expect(launched).toBe(false);
    expect(b.state.inflation).toBeGreaterThan(taps * BALANCE.weapons.popGun.inflation * 0.9);
    expect(b.state.inflation).toBeLessThan(0.5);
    // Pushed back, and the shooter gets the credit if they fall.
    expect(b.state.pz).toBeLessThan(-8.5);
    expect(b.lastAttacker).toBe(a.id);
    expect(a.state.ammo).toBe(BALANCE.weapons.popGun.ammo - shots);
    // Corks count as a quarter of a hit each in match stats.
    expect(a.stats.hits).toBe(Math.floor(taps / 4));
  });

  it('spins up, empties the drum and reloads by itself', () => {
    const { sim, ps, ds } = setup([{ weapon: 'popGun' }]);
    const a = ps[0];
    place(a, 0, 0, 0, 0);
    ds[0].frame.pitch = 0.3;
    ds[0].setFire(true);
    const times: number[] = [];
    let reloaded = false;
    run(sim, ds, 240, (t) => {
      const ev = sim.drainEvents();
      if (ev.some((e) => e.t === 'shot' && e.owner === a.id)) times.push(t);
      if (ev.some((e) => e.t === 'reload' && e.id === a.id)) reloaded = true;
    });
    expect(reloaded).toBe(true);
    // The first gap (spinning up) is longer than the gaps at full speed.
    expect(times[1] - times[0]).toBeGreaterThan(times[15] - times[14]);
    expect(times.length).toBeGreaterThanOrEqual(BALANCE.weapons.popGun.ammo);
  });

  it('a Mega Blast lasts several corks', () => {
    const { sim, ps, ds } = setup([{ weapon: 'popGun' }]);
    const a = ps[0];
    place(a, 0, 0, 0, 0);
    a.state.megaShots = 1;
    ds[0].frame.pitch = 0.3;
    ds[0].setFire(true);
    run(sim, ds, 30);
    expect(a.state.megaShots).toBeLessThan(1);
    expect(a.state.megaShots).toBeGreaterThanOrEqual(0);
  });
});

describe('weapon parts', () => {
  const numeric = (w: WeaponStats) => Object.entries(w).filter(([, v]) => typeof v === 'number') as [string, number][];

  it('every part in every slot changes every weapon', () => {
    for (const id of WEAPON_IDS) {
      const base = numeric(computeWeaponStats(id));
      for (const slot of PART_SLOTS) {
        for (const part of SLOT_PARTS[slot].slice(1)) {
          const w = numeric(computeWeaponStats(id, { [slot]: part }));
          const changed = w.some(([k, v], i) => Math.abs(v - base[i][1]) > 1e-9 && k === base[i][0]);
          expect(changed, `${part} on ${id}`).toBe(true);
        }
      }
    }
  });

  it('every part is a trade-off', () => {
    for (const id of WEAPON_IDS) {
      const b = computeWeaponStats(id);
      const s = (p: Parameters<typeof computeWeaponStats>[1]) => computeWeaponStats(id, p);
      const lb = s({ barrel: 'longBarrel' });
      expect(weaponRange(lb)).toBeGreaterThan(weaponRange(b));
      const st = s({ barrel: 'stubbyBarrel' });
      expect(weaponRange(st)).toBeLessThan(weaponRange(b));
      const big = s({ tank: 'bigTank' });
      expect(big.ammo).toBeGreaterThan(b.ammo);
      expect(big.reloadTime).toBeGreaterThan(b.reloadTime);
      expect(big.moveMult).toBeLessThan(1);
      const mini = s({ tank: 'miniTank' });
      expect(mini.reloadTime).toBeLessThan(b.reloadTime);
      expect(mini.ammo).toBeLessThanOrEqual(b.ammo);
      const hair = s({ valve: 'hairTrigger' });
      expect(hair.knockback).toBeLessThan(b.knockback);
      expect(hair.tapPower > b.tapPower || hair.chargeTime < b.chargeTime).toBe(true);
      const jet = s({ nozzle: 'jetNozzle' });
      expect(jet.knockback).toBeGreaterThan(b.knockback);
      const pump = s({ nozzle: 'pumpNozzle' });
      expect(pump.inflation).toBeGreaterThan(b.inflation);
      expect(pump.knockback).toBeLessThan(b.knockback);
      const sprint = s({ grip: 'sprintGrip' });
      expect(sprint.moveMult).toBeGreaterThan(1);
      expect(sprint.knockback).toBeLessThan(b.knockback);
      const anchor = s({ grip: 'anchorStock' });
      expect(anchor.knockback).toBeGreaterThan(b.knockback);
      expect(anchor.moveMult).toBeLessThan(1);
      const kick = s({ grip: 'kickStock' });
      expect(kick.recoil).toBeGreaterThan(b.recoil);
      expect(kick.blastJump).toBeGreaterThan(1);
      expect(kick.knockback).toBeLessThan(b.knockback);
    }
  });

  it('validates parts: wrong slot, unknown or locked parts fall back to Standard', () => {
    const l = sanitizeLoadout({ weapon: 'popGun', parts: { barrel: 'bigTank', tank: 'bigTank', valve: 'nope', nozzle: 'jetNozzle', grip: 42 } });
    expect(l.parts).toEqual({ ...STANDARD_PARTS, tank: 'bigTank', nozzle: 'jetNozzle' });
    const locked = sanitizeLoadout({ weapon: 'popGun', parts: { tank: 'bigTank', barrel: 'stubbyBarrel' } }, { parts: ['standard', 'stubbyBarrel'] });
    expect(locked.parts).toEqual({ ...STANDARD_PARTS, barrel: 'stubbyBarrel' });
    // Old saved loadouts keep their mods, if they're allowed.
    expect(sanitizeLoadout({ weapon: 'pumpRifle', mods: ['longBarrel', 'wideNozzle'] }).parts).toEqual({ ...STANDARD_PARTS, barrel: 'longBarrel', nozzle: 'wideNozzle' });
    expect(sanitizeLoadout({ weapon: 'pumpRifle', mods: ['longBarrel'] }, { parts: ['standard'] }).parts).toEqual(STANDARD_PARTS);
    expect(normalizeParts(['quickValve', 'chargeValve'])).toEqual({ ...STANDARD_PARTS, valve: 'quickValve' });
  });

  it('the server applies parts: a sprint grip walks faster, a kick stock shoves you back', () => {
    const walk = (grip: 'standard' | 'sprintGrip') => {
      const { sim, ps, ds } = setup([{ parts: { ...STANDARD_PARTS, grip } }]);
      place(ps[0], 0, 0, 5, 0);
      ds[0].frame.moveZ = 1;
      run(sim, ds, 45);
      return 5 - ps[0].state.pz;
    };
    expect(walk('sprintGrip')).toBeGreaterThan(walk('standard') * 1.05);

    const kick = (grip: 'standard' | 'kickStock') => {
      const { sim, ps, ds } = setup([{ weapon: 'airCannon', parts: { ...STANDARD_PARTS, grip } }]);
      place(ps[0], 0, 0, 0, 0);
      fire(sim, ds, ds[0], 40, 1);
      // Backwards is +Z when facing -Z.
      return ps[0].state.vz;
    };
    expect(kick('standard')).toBeCloseTo(0, 2);
    expect(kick('kickStock')).toBeGreaterThan(1.5);
  });
});

describe('bots and the new weapons', () => {
  it('bots fire and land hits with every new weapon', () => {
    const sim = new GameSim({ map: DEALERSHIP, durationSec: 999 });
    sim.eventMult = 0;
    const bots = (['bubbleShotgun', 'balloonMortar', 'popGun', 'airCannon', 'airCannon'] as const).map((w) => {
      const p = sim.addBot(0.7);
      sim.setLoadout(p.id, sanitizeLoadout({ weapon: w }));
      return p;
    });
    sim.startMatch();
    for (let t = 0; t < 60 * 60; t++) {
      sim.step();
      sim.drainEvents();
    }
    for (const p of bots.slice(0, 3)) {
      expect(p.stats.shots, p.loadout.weapon).toBeGreaterThan(3);
      expect(p.stats.hits, p.loadout.weapon).toBeGreaterThan(0);
    }
  });
});
