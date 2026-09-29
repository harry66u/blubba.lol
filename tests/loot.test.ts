import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/shared/balance';
import { UNLOCKS } from '../src/shared/economy';
import { type LootKind, LOOT_KINDS, type LootCrate, floorBelow, pickLootSpot, rollLoot, stepCrate } from '../src/shared/game/loot';
import { GameSim, type SimPlayer } from '../src/shared/game/sim';
import { type Loadout, UTILITY_IDS, UTILITY_INFO, sanitizeLoadout } from '../src/shared/loadout';
import { MAPS } from '../src/shared/maps';
import { DEALERSHIP } from '../src/shared/maps/dealership';
import { PLAYER_FIELDS, StepResult, createPlayerState, stepPlayer } from '../src/shared/player';
import { decodeSnapshot, encodeSnapshot } from '../src/shared/protocol';
import { World } from '../src/shared/world';
import { computeWeaponStats } from '../src/shared/loadout';
import { ALL_FEATURES } from '../src/shared/player';
import { emptyInput } from '../src/shared/input';
import { Driver, run } from './helpers';

function setup(loadouts: Partial<Loadout>[]) {
  const sim = new GameSim({ map: DEALERSHIP, durationSec: 999 });
  sim.lootEnabled = false;
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

/** Seeded random so map sweeps are repeatable. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

describe('floor loot', () => {
  it('drop spots are always on solid, open ground on every map, never over the void or under a roof', () => {
    for (const map of Object.values(MAPS)) {
      const world = new World(map);
      const r = rng(map.id.length * 977);
      let found = 0;
      for (let i = 0; i < 120; i++) {
        const spot = pickLootSpot(world, map, r, []);
        if (!spot) continue;
        found++;
        // Ground right under the crate and under all four corners, at the same height.
        for (const [ox, oz] of [
          [0, 0],
          [-0.7, -0.7],
          [0.7, -0.7],
          [-0.7, 0.7],
          [0.7, 0.7],
        ]) {
          expect(world.groundBelow(spot.x + ox, spot.y + 0.01, spot.z + oz, 0.1)).toBeCloseTo(spot.y, 3);
        }
        // Nothing overhead: straight down from the sky lands on the spot.
        const hit = world.raycast(spot.x, spot.y + 40, spot.z, 0, -1, 0, 41);
        expect(hit?.y).toBeCloseTo(spot.y, 3);
        // Inside the play area, near spawn height.
        const ys = map.spawns.map((s) => s[1]);
        expect(spot.y).toBeGreaterThanOrEqual(Math.min(...ys) - 3);
        expect(spot.y).toBeLessThanOrEqual(Math.max(...ys) + 2);
      }
      expect(found, map.id).toBeGreaterThan(100);
    }
  });

  it('crates drift down, land on the ground, and keep their spacing', () => {
    const { sim, ps, ds } = setup([{}, {}]);
    place(ps[0], -22, 0, -18);
    place(ps[1], -22, 0, 18);
    const crates: LootCrate[] = [];
    for (let i = 0; i < BALANCE.loot.maxCrates; i++) {
      const c = sim.dropLoot();
      expect(c).toBeTruthy();
      crates.push(c!);
    }
    const startY = crates.map((c) => c.y);
    run(sim, ds, 60);
    crates.forEach((c, i) => expect(c.y).toBeCloseTo(startY[i] - BALANCE.loot.fallSpeed, 1));
    run(sim, ds, Math.ceil((BALANCE.loot.dropHeight / BALANCE.loot.fallSpeed) * 60) + 10);
    const landed = sim.drainEvents().filter((e) => e.t === 'lootLand');
    // (A crate may have landed next to a player and been grabbed, but none sat far from both.)
    for (const c of sim.crates) {
      expect(c.falling).toBe(false);
      expect(floorBelow(sim.world, c.x, c.y + 0.01, c.z, 0.1)).toBeTruthy();
    }
    expect(landed.length + sim.crates.length).toBeGreaterThanOrEqual(BALANCE.loot.maxCrates);
    for (let i = 0; i < crates.length; i++) {
      for (let j = i + 1; j < crates.length; j++) {
        expect(Math.hypot(crates[i].x - crates[j].x, crates[i].z - crates[j].z)).toBeGreaterThanOrEqual(BALANCE.loot.spacing);
      }
    }
  });

  it('drops arrive on a timer during a match and cap out', () => {
    const { sim, ps, ds } = setup([{}, {}]);
    sim.lootEnabled = true;
    sim.startMatch();
    place(ps[0], -24, 0, -19);
    place(ps[1], -24, 0, 19);
    let drops = 0;
    let most = 0;
    run(sim, ds, 60 * 150, () => {
      // Keep the players out of the way in a corner.
      place(ps[0], -24, 0, -19);
      place(ps[1], -24, 0, 19);
      for (const e of sim.drainEvents()) if (e.t === 'loot') drops++;
      most = Math.max(most, sim.crates.length);
    });
    expect(drops).toBeGreaterThanOrEqual(5);
    expect(most).toBeLessThanOrEqual(BALANCE.loot.maxCrates);
  });

  it('crates float away after a while, and go down with a sinking island', () => {
    const { sim, ps, ds } = setup([{}, {}]);
    place(ps[0], -22, 0, -18);
    place(ps[1], -22, 0, 18);
    const c = sim.dropLoot({ x: 10, y: 0, z: 10, r: 3 })!;
    run(sim, ds, Math.ceil((BALANCE.loot.dropHeight / BALANCE.loot.fallSpeed + BALANCE.loot.lifetime) * 60) + 30);
    expect(sim.crates.includes(c)).toBe(false);
    expect(sim.drainEvents().some((e) => e.t === 'lootGone' && e.id === c.id && e.why === 'expired')).toBe(true);

    // A crate resting on the north island sinks with it in the final collapse.
    const world = sim.world;
    const island = world.solids.find((s) => s.collapse === 3)!;
    const crate: LootCrate = { id: 99, x: (island.minX + island.maxX) / 2, y: island.maxY, z: (island.minZ + island.maxZ) / 2, falling: false, fall: 0, ground: island.id, landedAt: 0, forced: null };
    world.collapseStart = 0;
    let result: string | null = null;
    for (let t = 1; t < 60 * 30 && !result; t++) {
      world.setTime(t / 60);
      result = stepCrate(crate, world, 1 / 60, -20);
    }
    expect(result).toBe('lost');
  });

  it('grabbing a crate applies each effect', () => {
    const expectEffect: Record<LootKind, (p: SimPlayer) => void> = {
      deflate: (p) => expect(p.state.inflation).toBeCloseTo(0.7 - BALANCE.loot.deflate, 5),
      mega: (p) => expect(p.state.megaShots).toBe(BALANCE.loot.megaShots),
      turbo: (p) => {
        expect(p.state.turboTimer).toBeGreaterThan(BALANCE.loot.turboSeconds - 0.2);
        expect(p.state.ammo).toBe(p.weapon.ammo);
      },
      gadgets: (p) => {
        expect(p.state.u1Cool).toBe(0);
        expect(p.state.u2Cool).toBe(0);
      },
      feather: (p) => expect(p.state.floatTimer).toBeGreaterThan(BALANCE.loot.featherSeconds - 0.2),
      spring: (p) => expect(p.state.springJumps).toBe(BALANCE.loot.springJumps),
    };
    for (const kind of LOOT_KINDS) {
      const { sim, ps, ds } = setup([{}, {}]);
      const [a, b] = ps;
      place(b, -22, 0, 18);
      place(a, 0, 0, 0);
      Object.assign(a.state, { inflation: 0.7, u1Cool: 5, u2Cool: 7, ammo: 1 });
      const c = sim.debugDropLoot(a.id, kind)!;
      expect(c).toBeTruthy();
      // Stand under it and wait.
      let grabbed: string | null = null;
      for (let t = 0; t < 60 * 6 && !grabbed; t++) {
        Object.assign(a.state, { px: c.x, pz: c.z });
        run(sim, ds, 1);
        for (const e of sim.drainEvents()) if (e.t === 'lootGrab' && e.by === a.id) grabbed = e.kind;
      }
      expect(grabbed, kind).toBe(kind);
      expect(sim.crates.length).toBe(0);
      expectEffect[kind](a);
    }
  });

  it('the roll skips effects that would do nothing and favors Deflate when you are pumped up', () => {
    const r = rng(7);
    const count = (inflation: number, stream: boolean, gadgetsReady: boolean) => {
      const n: Record<string, number> = {};
      for (let i = 0; i < 4000; i++) {
        const k = rollLoot(r, { inflation, stream, gadgetsReady });
        n[k] = (n[k] ?? 0) + 1;
      }
      return n;
    };
    const calm = count(0, true, true);
    expect(calm.deflate).toBeUndefined();
    expect(calm.mega).toBeUndefined();
    expect(calm.gadgets).toBeUndefined();
    const pumped = count(1, false, false);
    const low = count(0.2, false, false);
    expect(pumped.deflate).toBeGreaterThan(low.deflate * 1.5);
    for (const k of LOOT_KINDS) expect(pumped[k]).toBeGreaterThan(100);
  });

  it('Feather makes you fall slowly and Spring Shoes jump higher, identically in client prediction', () => {
    const world = new World(DEALERSHIP);
    const ctx = { world, dt: 1 / 60, weapon: computeWeaponStats('airCannon', []), features: ALL_FEATURES };
    const out = new StepResult();
    const fall = (feather: boolean) => {
      const s = createPlayerState();
      Object.assign(s, { px: 0, py: 20, pz: 0, floatTimer: feather ? 6 : 0 });
      for (let i = 0; i < 60; i++) stepPlayer(s, emptyInput(), ctx, out);
      return s;
    };
    const normal = fall(false);
    const floaty = fall(true);
    expect(20 - floaty.py).toBeLessThan((20 - normal.py) * 0.5);
    expect(floaty.vy).toBeGreaterThanOrEqual(-BALANCE.loot.featherMaxFall - 0.5);
    // Spring Shoes: a super jump, then back to normal once they're used up.
    const s = createPlayerState();
    Object.assign(s, { px: 0, py: 0, pz: 0, onGround: 1, springJumps: 1 });
    const f = emptyInput();
    f.jump = 1;
    stepPlayer(s, f, ctx, out);
    expect(out.springJump).toBe(true);
    expect(s.vy).toBeGreaterThan(BALANCE.player.jumpVelocity * 1.5);
    expect(s.springJumps).toBe(0);
    // The new fields ride along in the owner's snapshot so prediction reconciles exactly.
    expect(PLAYER_FIELDS).toContain('floatTimer');
    expect(PLAYER_FIELDS).toContain('heliumTimer');
    expect(PLAYER_FIELDS).toContain('springJumps');
    const me = createPlayerState();
    Object.assign(me, { floatTimer: 3.5, heliumTimer: 1.25, springJumps: 2 });
    const snap = decodeSnapshot(new DataView(encodeSnapshot(1, 1, 0, me, [])));
    expect(snap.self?.floatTimer).toBeCloseTo(3.5, 5);
    expect(snap.self?.heliumTimer).toBeCloseTo(1.25, 5);
    expect(snap.self?.springJumps).toBe(2);
  });

  it('bots go for nearby crates', () => {
    const sim = new GameSim({ map: DEALERSHIP, durationSec: 999 });
    for (let i = 0; i < 4; i++) sim.addBot(0.6);
    let grabs = 0;
    for (let t = 0; t < 60 * 120; t++) {
      if (t % 600 === 0 && sim.crates.length < 2) sim.dropLoot();
      sim.step();
      for (const e of sim.drainEvents()) if (e.t === 'lootGrab') grabs++;
    }
    expect(grabs).toBeGreaterThanOrEqual(3);
  });
});

describe('new gadgets', () => {
  it('are in the loadout pool with info, an icon, and a level unlock', () => {
    for (const id of ['airMine', 'heliumBomb', 'tornado'] as const) {
      expect(UTILITY_IDS).toContain(id);
      expect(UTILITY_INFO[id].name.length).toBeGreaterThan(2);
      expect(UTILITY_INFO[id].icon).not.toBe('?');
      expect(UNLOCKS.find((u) => u.id === id)?.level).toBeGreaterThan(8);
      expect(BALANCE.utilities[id].cooldown).toBeGreaterThan(0);
    }
    expect(sanitizeLoadout({ utils: ['tornado', 'airMine'] }).utils).toEqual(['tornado', 'airMine']);
  });

  it('Air Mine arms, then blasts the first enemy who steps near it up and out', () => {
    const { sim, ps, ds } = setup([{ utils: ['airMine', 'airGrenade'] }, {}]);
    const [a, b] = ps;
    place(a, 0, 0, 0, 0);
    place(b, 10, 0, 10);
    ds[0].frame.pitch = -0.5;
    ds[0].press('util1');
    run(sim, ds, 45);
    expect(sim.mines.length).toBe(1);
    const m = sim.mines[0];
    expect(m.owner).toBe(a.id);
    expect(m.y).toBeCloseTo(0, 3);
    // Its owner can walk over it.
    place(a, m.x, 0, m.z);
    run(sim, ds, 60);
    expect(sim.mines.length).toBe(1);
    place(a, m.x - 8, 0, m.z);
    // An enemy walking over it before it arms is safe... (fresh mine)
    a.state.u1Cool = 0;
    ds[0].press('util1');
    ds[0].frame.yaw = Math.PI / 2;
    run(sim, ds, 30);
    const m2 = sim.mines.find((x) => x.owner === a.id)!;
    // One mine per player: the old one is gone.
    expect(sim.mines.length).toBe(1);
    expect(m2.id).not.toBe(m.id);
    place(b, m2.x, 0, m2.z + 0.5);
    run(sim, ds, 2);
    expect(sim.mines.length).toBe(1);
    // ...but once it arms, it goes off under them.
    for (let t = 0; t < 60 && sim.mines.length; t++) {
      place(b, m2.x, 0, m2.z + 0.5);
      run(sim, ds, 1);
    }
    expect(sim.mines.length).toBe(0);
    expect(sim.drainEvents().some((e) => e.t === 'mineGone' && e.boom)).toBe(true);
    let maxVy = 0;
    run(sim, ds, 12, () => (maxVy = Math.max(maxVy, b.state.vy)));
    expect(maxVy).toBeGreaterThan(6);
    expect(b.state.inflation).toBeGreaterThan(0.05);
    expect(b.lastAttacker).toBe(a.id);
  });

  it('Helium Bomb makes enemies float up and fly farther when hit', () => {
    const { sim, ps, ds } = setup([{ utils: ['heliumBomb', 'airGrenade'] }, {}]);
    const [a, b] = ps;
    place(a, 0, 0, 0, 0);
    place(b, 0, 0, -7);
    ds[0].frame.pitch = -0.15;
    ds[0].press('util1');
    let floated = false;
    run(sim, ds, 60, () => {
      if (b.state.heliumTimer > 0) floated = true;
    });
    expect(floated).toBe(true);
    expect(a.state.heliumTimer).toBe(0);
    const y0 = b.state.py;
    run(sim, ds, 90);
    expect(b.state.py).toBeGreaterThan(y0 + 2);
    expect(b.state.onGround).toBe(0);
    // Hit while floating: more knockback than the same hit on the ground.
    const hit = (floating: boolean) => {
      const s2 = setup([{}, {}]);
      place(s2.ps[1], 0, floating ? 3 : 0, 0);
      s2.ps[1].state.heliumTimer = floating ? 2 : 0;
      s2.sim.applyHit(s2.ps[1], s2.ps[0].id, 1, 0, 0, 1, 0, { direct: true, low: false, x: 0, y: 1, z: 0 });
      const st = s2.ps[1].state;
      return Math.hypot(st.vx + st.hsVx, st.vz + st.hsVz);
    };
    expect(hit(true)).toBeGreaterThan(hit(false) * 1.15);
    // Floating ends and gravity comes back.
    let t = 0;
    while (b.state.heliumTimer > 0 && t++ < 60 * 3) run(sim, ds, 1);
    expect(b.state.heliumTimer).toBe(0);
    run(sim, ds, 20);
    expect(b.state.vy).toBeLessThan(0);
  });

  it('Tornado rolls forward and swirls up enemies it catches, but never its owner', () => {
    const { sim, ps, ds } = setup([{ utils: ['tornado', 'airGrenade'] }, {}]);
    const [a, b] = ps;
    place(a, 0, 0, 5, 0);
    place(b, 0.5, 0, -3);
    ds[0].press('util1');
    run(sim, ds, 2);
    expect(sim.tornados.length).toBe(1);
    const t = sim.tornados[0];
    const z0 = t.z;
    let maxY = 0;
    let maxSpeed = 0;
    run(sim, ds, 90, () => {
      maxY = Math.max(maxY, b.state.py);
      maxSpeed = Math.max(maxSpeed, Math.hypot(b.state.vx, b.state.vz));
    });
    expect(t.z).toBeLessThan(z0 - 5);
    expect(maxY).toBeGreaterThan(1.5);
    expect(maxSpeed).toBeGreaterThan(5);
    expect(b.lastAttacker).toBe(a.id);
    expect(a.state.py).toBeCloseTo(0, 3);
    run(sim, ds, 60 * BALANCE.utilities.tornado.duration);
    expect(sim.tornados.length).toBe(0);
    expect(a.state.u1Cool).toBeGreaterThan(0);
  });
});
