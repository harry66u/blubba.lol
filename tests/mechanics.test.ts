import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/shared/balance';
import { GameSim, type SimPlayer } from '../src/shared/game/sim';
import { sanitizeLoadout } from '../src/shared/loadout';
import { DEALERSHIP } from '../src/shared/maps/dealership';
import { Driver, run } from './helpers';

function setup(n: number, weapon?: string) {
  const sim = new GameSim({ map: DEALERSHIP, durationSec: 999 });
  sim.eventMult = 0;
  const ps: SimPlayer[] = [];
  for (let i = 0; i < n; i++) ps.push(sim.addPlayer(`p${i}`, { loadout: sanitizeLoadout(weapon ? { weapon: weapon as 'popGun' } : {}) }));
  if (sim.phase !== 'playing') sim.startMatch();
  const ds = ps.map((p) => new Driver(sim, p));
  for (const p of ps) p.state.spawnProt = 0;
  sim.drainEvents();
  return { sim, ps, ds };
}

/** The sim's internals these checks poke at directly. */
type Internals = {
  applyHit: (t: SimPlayer, by: number, dx: number, dy: number, dz: number, power: number, infl: number, info: { direct: boolean; low: boolean; x: number; y: number; z: number }) => void;
  tapHit: (pr: object, t: SimPlayer, hit: { x: number; y: number; z: number }) => void;
};

describe('audit fixes', () => {
  it("a weak hit on someone already flying adds to the launch instead of stopping it", () => {
    const { sim, ps } = setup(2);
    const [a, b] = ps;
    Object.assign(b.state, { px: 0, py: 3, pz: 0, vx: 30, vy: 2, vz: 0, onGround: 0, launchTimer: 1, hitStop: 0, inflation: 0.2 });
    // A poke from the side.
    (sim as unknown as Internals).applyHit(b, a.id, 0, 0.2, 1, 1, 0.02, { direct: true, low: false, x: 0, y: 4, z: 0 });
    const s = b.state;
    const vx = s.hitStop > 0 ? s.hsVx : s.vx;
    // Still flying off the same way, most of the way as fast (it used to keep only 15%: 4.5 m/s).
    expect(vx).toBeGreaterThan(15);
  });

  it('Pop Gun corks fill the ult meter', () => {
    const { sim, ps } = setup(2, 'popGun');
    const [a, b] = ps;
    const before = a.state.ult;
    const w = BALANCE.weapons.popGun;
    (sim as unknown as Internals).tapHit({ id: 1, owner: a.id, vx: 0, vy: 0, vz: -40, inflation: w.inflation, power: 1, knockback: w.knockback }, b, { x: b.state.px, y: b.state.py + 1, z: b.state.pz });
    expect(b.state.inflation).toBeGreaterThan(0);
    expect(a.state.ult).toBeGreaterThan(before);
  });

  it("can't grab through a wall", () => {
    const { sim, ps } = setup(2);
    const [a, b] = ps;
    // A tall solid somewhere on the map, and two players on either side of it.
    const wall = sim.world.solids.find((s) => s.enabled && s.minY > -0.1 && s.minY < 0.5 && s.maxY - s.minY > 2 && s.maxZ - s.minZ > 1.5);
    expect(wall).toBeDefined();
    const w = wall!;
    const z = (w.minZ + w.maxZ) / 2;
    const y = w.minY;
    Object.assign(a.state, { px: w.minX - 0.7, py: y, pz: z });
    Object.assign(b.state, { px: w.maxX + 0.7, py: y, pz: z });
    expect(sim.clearBetween(a.state, b.state)).toBe(false);
    Object.assign(b.state, { px: w.minX - 2, py: y, pz: z });
    expect(sim.clearBetween(a.state, b.state)).toBe(true);
  });

  it('pickups over the void go away and never come back there', () => {
    const { sim, ds } = setup(2);
    const k = sim.pickups[0];
    Object.assign(k, { x: 500, z: 500, active: true, kind: 'soda' });
    run(sim, ds, 40);
    expect(k.active).toBe(false);
    k.respawnAt = 0;
    run(sim, ds, 40);
    expect(k.active).toBe(false);
  });

  it("a lag spike doesn't leave a lasting input delay", () => {
    const { sim, ps, ds } = setup(2);
    const d = ds[0];
    run(sim, ds, 30);
    // Half a second with nothing from player 0, then everything at once.
    for (let t = 0; t < 30; t++) {
      ds[1].queue();
      d.seq++;
      sim.step();
    }
    d.seq -= 30;
    for (let t = 0; t < 30; t++) d.queue();
    run(sim, ds, 30);
    expect(ps[0].queue.length).toBeLessThanOrEqual(2);
  });

  it('Sudden Death gives its own (longer) spawn protection', () => {
    const sim = new GameSim({ map: DEALERSHIP, mode: 'suddenDeath', durationSec: 999 });
    const a = sim.addPlayer('a');
    sim.addPlayer('b');
    sim.startMatch();
    expect(a.state.spawnProt).toBeCloseTo(BALANCE.modes.suddenDeath.spawnProtection, 1);
  });
});

describe('bots and maps audit fixes', () => {
  it('team-mode bots come in twins (same skill and loadout, one per team)', () => {
    const sim = new GameSim({ map: DEALERSHIP, mode: 'teamKnockout', durationSec: 999 });
    const a = sim.addBot(0.65);
    const b = sim.addBot(0.65, a);
    expect(b.twinId).toBe(a.id);
    expect(a.twinId).toBe(b.id);
    expect(b.loadout.weapon).toBe(a.loadout.weapon);
    expect(b.team).toBe(1 - a.team);
    sim.removePlayer(a.id);
    expect(b.twinId).toBe(-1);
  });

  it("a knockout still counts for the attacker while the victim hasn't landed in control", () => {
    const { sim, ps } = setup(2);
    const [a, b] = ps;
    b.lastAttacker = a.id;
    b.lastAttackTime = sim.time;
    b.footedAt = sim.time - 1;
    // 12 s later, never landed since the hit: still a.'s knockout.
    sim.time += 12;
    const before = a.stats.kos;
    sim.knockout(b);
    expect(a.stats.kos).toBe(before + 1);
  });
});
