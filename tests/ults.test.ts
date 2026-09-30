import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/shared/balance';
import { unlockedAt } from '../src/shared/economy';
import type { GameEvent } from '../src/shared/game/events';
import { GameSim, type SimPlayer, capsuleSphere } from '../src/shared/game/sim';
import { PLAYABLE_ULTS, PROJ_BIG_BLOW, PROJ_ROCKET, ULT_BIT_READY, ULT_IDS, type UltId, publicUlt, publicUltKind, steerToward, ultIndex } from '../src/shared/game/ults';
import { emptyInput } from '../src/shared/input';
import { type Loadout, sanitizeLoadout } from '../src/shared/loadout';
import { DEALERSHIP } from '../src/shared/maps/dealership';
import { ALL_FEATURES, MODE_DEAD, MODE_HELD, StepResult, createPlayerState, stepPlayer } from '../src/shared/player';
import { computeWeaponStats } from '../src/shared/loadout';
import { World } from '../src/shared/world';
import { decodeSnapshot, encodeSnapshot } from '../src/shared/protocol';
import { Driver, run } from './helpers';

type Hit = Extract<GameEvent, { t: 'hit' }>;

function setup(loadouts: Partial<Loadout>[]) {
  const sim = new GameSim({ map: DEALERSHIP, durationSec: 999 });
  sim.eventMult = 0;
  const ps: SimPlayer[] = loadouts.map((l, i) => sim.addPlayer(`p${i}`, { loadout: sanitizeLoadout(l) }));
  if (sim.phase !== 'playing') sim.startMatch();
  // Matches deal ults at random each spawn: give each test player the one it asked for.
  ps.forEach((p, i) => {
    if (loadouts[i].ult) p.state.ultKind = ultIndex(loadouts[i].ult!);
  });
  const ds = ps.map((p) => new Driver(sim, p));
  for (const p of ps) p.state.spawnProt = 0;
  sim.drainEvents();
  return { sim, ps, ds };
}

/** Puts a player standing still at a spot, facing `yaw` (0 = toward -z). */
function place(d: Driver, x: number, z: number, yaw = 0) {
  Object.assign(d.player.state, { px: x, py: 0, pz: z, vx: 0, vy: 0, vz: 0, yaw, spawnProt: 0, onGround: 1, launchTimer: 0, hitStop: 0, hsVx: 0, hsVy: 0, hsVz: 0 });
  d.frame.yaw = yaw;
  d.frame.pitch = 0;
}

/** Collects every event while stepping. */
function runCollect(sim: GameSim, ds: Driver[], ticks: number, each?: (t: number) => void): GameEvent[] {
  const out: GameEvent[] = [];
  run(sim, ds, ticks, (t) => {
    each?.(t);
    out.push(...sim.drainEvents());
  });
  out.push(...sim.drainEvents());
  return out;
}

function popUlt(sim: GameSim, ds: Driver[], d: Driver): GameEvent[] {
  d.player.state.ult = 1;
  d.press('ult');
  return runCollect(sim, ds, 2);
}

/** Horizontal speed after walking forward for a second. */
function walkSpeed(sim: GameSim, ds: Driver[], d: Driver): number {
  d.frame.moveZ = 1;
  run(sim, ds, 60);
  d.frame.moveZ = 0;
  return Math.hypot(d.player.state.vx, d.player.state.vz);
}

function hitsOn(ev: GameEvent[], target: SimPlayer, attacker?: SimPlayer): Hit[] {
  return ev.filter((e): e is Hit => e.t === 'hit' && e.target === target.id && (!attacker || e.attacker === attacker.id));
}

const M = BALANCE.ults.meter;

describe('ult meter', () => {
  it('fills slowly over time alive', () => {
    const { sim, ps, ds } = setup([{}, {}]);
    const [a] = ps;
    expect(a.state.ult).toBe(0);
    run(sim, ds, 600);
    expect(a.state.ult).toBeCloseTo(10 * M.perSecond, 3);
  });

  it('fills from inflation you add to enemies, a little from hits you take, and a chunk per knockout', () => {
    const { sim, ps } = setup([{}, {}, {}]);
    const [a, b, c] = ps;
    sim.applyHit(b, a.id, 0, 0, -1, 1, 0.1, { direct: true, low: false, x: 0, y: 1, z: 0 });
    const hit = sim.drainEvents().find((e): e is Hit => e.t === 'hit')!;
    expect(hit.gain).toBeCloseTo(0.1, 5);
    expect(a.state.ult).toBeCloseTo(0.1 * M.perInflation, 5);
    expect(b.state.ult).toBeCloseTo(0.1 * M.perInflationTaken, 5);
    c.lastAttacker = a.id;
    c.lastAttackTime = sim.time;
    sim.knockout(c);
    expect(a.state.ult).toBeCloseTo(Math.min(1, 0.1 * M.perInflation + M.perKo), 5);
  });

  it('keeps its charge through death, resets on a new match, and pauses while an ult runs', () => {
    const { sim, ps, ds } = setup([{}, {}]);
    const [a, b] = ps;
    a.state.ult = 0.7;
    sim.knockout(a);
    run(sim, ds, Math.ceil(BALANCE.match.respawnDelay * 60) + 2);
    expect(a.state.mode).not.toBe(MODE_DEAD);
    expect(a.state.ult).toBeGreaterThanOrEqual(0.7);
    expect(a.state.ult).toBeLessThan(0.71);
    a.state.juiceTimer = 3;
    const before = a.state.ult;
    sim.applyHit(b, a.id, 0, 0, -1, 1, 0.3, { direct: true, low: false, x: 0, y: 1, z: 0 });
    run(sim, ds, 30);
    expect(a.state.ult).toBe(before);
    sim.startMatch();
    expect(a.state.ult).toBe(0);
  });
});

describe('earning ults fairly', () => {
  it('assists pay the players who softened someone up, and big chunks are announced', () => {
    const { sim, ps } = setup([{}, {}, {}]);
    const [a, b, c] = ps;
    // B lands a hit on C, then A knocks C out: A gets the knockout, B the assist.
    sim.applyHit(c, b.id, 0, 0, -1, 1, 0.05, { direct: true, low: false, x: 0, y: 1, z: 0 });
    const bAfterHit = b.state.ult;
    c.lastAttacker = a.id;
    c.lastAttackTime = sim.time;
    sim.drainEvents();
    sim.knockout(c);
    const ev = sim.drainEvents();
    expect(a.state.ult).toBeCloseTo(M.perKo, 5);
    expect(b.state.ult).toBeCloseTo(bAfterHit + M.perAssist, 5);
    expect(ev.filter((e) => e.t === 'charge').map((e) => (e as { why: string }).why).sort()).toEqual(['assist', 'ko']);
    // An old hit (outside the window) is no assist.
    sim.applyHit(a, b.id, 0, 0, -1, 1, 0.05, { direct: true, low: false, x: 0, y: 1, z: 0 });
    sim.time += M.assistWindow + 1;
    const bBefore = b.state.ult;
    a.lastAttacker = c.id;
    a.lastAttackTime = sim.time;
    sim.knockout(a);
    expect(b.state.ult).toBe(bBefore);
  });

  it('whoever is behind charges faster and a runaway leader slower, in free-for-all and teams', () => {
    const { sim, ps } = setup([{}, {}, {}]);
    const [a, b, c] = ps;
    expect(sim.ults.catchUp(a)).toBe(1);
    a.score = 5;
    b.score = 1;
    c.score = 4;
    expect(sim.ults.catchUp(a)).toBe(1);
    c.score = 2;
    expect(sim.ults.catchUp(a)).toBe(M.catchUp.ahead);
    expect(sim.ults.catchUp(b)).toBe(M.catchUp.behind);
    // The multiplier applies to earned charge.
    sim.ults.charge(b, 0.2);
    expect(b.state.ult).toBeCloseTo(0.2 * M.catchUp.behind, 5);

    const team = new GameSim({ map: DEALERSHIP, mode: 'teamKnockout', durationSec: 999 });
    const t0 = team.addPlayer('x', { loadout: sanitizeLoadout({}) });
    const t1 = team.addPlayer('y', { loadout: sanitizeLoadout({}) });
    if (team.phase !== 'playing') team.startMatch();
    expect(t0.team).not.toBe(t1.team);
    team.teamScores[t0.team as 0 | 1] = 7;
    team.teamScores[t1.team as 0 | 1] = 4;
    expect(team.ults.catchUp(t0)).toBe(M.catchUp.ahead);
    expect(team.ults.catchUp(t1)).toBe(M.catchUp.behind);
    team.teamScores[t1.team as 0 | 1] = 6;
    expect(team.ults.catchUp(t1)).toBe(1);
  });

  it('a full meter from fighting takes roughly 7-10 good hits or three knockouts, never a single one', () => {
    // A strong charged hit adds about 10% inflation.
    expect(0.1 * M.perInflation).toBeLessThan(0.2);
    expect(M.perKo * M.catchUp.behind).toBeLessThan(0.5);
    expect(1 / M.perSecond).toBeGreaterThan(45);
  });
});

describe('activating an ult', () => {
  it('needs a full meter, empties it, and tells everyone', () => {
    const { sim, ps, ds } = setup([{ ult: 'juice' }, {}]);
    const [a] = ps;
    a.state.ult = 0.9;
    ds[0].press('ult');
    let ev = runCollect(sim, ds, 2);
    expect(ev.some((e) => e.t === 'ult')).toBe(false);
    expect(a.state.juiceTimer).toBe(0);
    ev = popUlt(sim, ds, ds[0]);
    expect(ev.find((e) => e.t === 'ult')).toMatchObject({ id: a.id, kind: 'juice' });
    expect(a.state.ult).toBeLessThan(0.01);
    expect(a.state.juiceTimer).toBeGreaterThan(BALANCE.ults.juice.duration - 0.1);
    // Nothing more to pop until the meter is full again.
    ds[0].press('ult');
    expect(runCollect(sim, ds, 2).some((e) => e.t === 'ult')).toBe(false);
  });

  it("can't be used while grabbed", () => {
    const { sim, ps, ds } = setup([{ ult: 'cropDuster' }, {}]);
    const [a, b] = ps;
    place(ds[0], 0, 0, 0);
    place(ds[1], 0, 1.2, 0);
    ds[1].press('grab');
    run(sim, ds, 2);
    expect(a.state.mode).toBe(MODE_HELD);
    const ev = popUlt(sim, ds, ds[0]);
    expect(ev.some((e) => e.t === 'ult')).toBe(false);
    expect(a.state.ult).toBe(1);
    expect(b.state.holding).toBe(a.id);
  });

  it('is predicted by the shared step alone (what the client runs)', () => {
    const world = new World(DEALERSHIP);
    const ctx = { world, dt: 1 / 60, weapon: computeWeaponStats('airCannon', []), features: ALL_FEATURES };
    const p = createPlayerState();
    Object.assign(p, { mode: 0, onGround: 1, ult: 1, ultKind: ultIndex('chase') });
    const inp = emptyInput();
    inp.ult = 1;
    inp.moveZ = 1;
    const out = new StepResult();
    stepPlayer(p, inp, ctx, out);
    expect(out.ult).toBe(true);
    expect(p.chaseTimer).toBeGreaterThan(0);
    for (let i = 0; i < 60; i++) stepPlayer(p, inp, ctx, out);
    const q = createPlayerState();
    Object.assign(q, { mode: 0, onGround: 1 });
    for (let i = 0; i < 61; i++) stepPlayer(q, { ...inp, ult: 0 }, ctx, out);
    expect(Math.hypot(p.vx, p.vz) / Math.hypot(q.vx, q.vz)).toBeCloseTo(BALANCE.ults.chase.speedMult, 1);
  });
});

describe('Big Blow', () => {
  function bigBlowHit(ult: boolean): { speed: number; shot: Extract<GameEvent, { t: 'shot' }> } {
    const { sim, ps, ds } = setup([{ weapon: ult ? 'pumpRifle' : 'airCannon', ult: 'bigBlow' }, {}]);
    const [a, b] = ps;
    place(ds[0], 0, 6);
    place(ds[1], 0, -2);
    let ev: GameEvent[] = [];
    if (ult) {
      ev = popUlt(sim, ds, ds[0]);
      expect(a.state.ultArmed).toBe(1);
      expect(ev.find((e) => e.t === 'ult')).toMatchObject({ kind: 'bigBlow' });
    }
    ds[0].aimAt(0, 1, -2);
    ds[0].setFire(true);
    ev = runCollect(sim, ds, ult ? 1 : 50);
    ds[0].setFire(false);
    ev.push(...runCollect(sim, ds, 30));
    const shot = ev.find((e): e is Extract<GameEvent, { t: 'shot' }> => e.t === 'shot' && e.owner === a.id)!;
    const hit = hitsOn(ev, b, a)[0];
    expect(hit).toBeTruthy();
    expect(hit.direct).toBe(true);
    return { speed: hit.speed, shot };
  }

  it('fires one giant air blast from any weapon, about twice as hard as a full charge', () => {
    const normal = bigBlowHit(false);
    const big = bigBlowHit(true);
    expect(big.shot.w).toBe(PROJ_BIG_BLOW);
    expect(big.shot.r).toBeCloseTo(BALANCE.ults.bigBlow.radius, 5);
    expect(big.speed).toBeGreaterThan(normal.speed * 1.7);
    expect(big.speed).toBeLessThan(normal.speed * 2.6);
  });

  it('blasts twice as wide as a normal shot', () => {
    const { sim, ps, ds } = setup([{ ult: 'bigBlow' }, {}, {}]);
    const [a, b, c] = ps;
    place(ds[0], 0, 8);
    place(ds[1], 0, -2);
    // Standing 4 m to the side of the impact: well outside a normal blast.
    place(ds[2], 4, -2);
    popUlt(sim, ds, ds[0]);
    ds[0].aimAt(0, 1, -2);
    ds[0].setFire(true);
    const ev = runCollect(sim, ds, 30);
    expect(hitsOn(ev, b, a).length).toBe(1);
    expect(hitsOn(ev, c, a).length).toBe(1);
    expect(BALANCE.ults.bigBlow.blastRadius).toBeGreaterThan(BALANCE.weapons.airCannon.blastRadius * 1.9);
  });
});

describe('Big Blow in your face', () => {
  it("never launches whoever fired it", () => {
    const { sim, ps, ds } = setup([{ ult: 'bigBlow' }, {}]);
    const [a] = ps;
    place(ds[0], 0, 6);
    place(ds[1], 10, -10);
    popUlt(sim, ds, ds[0]);
    // Straight into the floor at your own feet.
    ds[0].aimAt(0, 0, 4.5);
    ds[0].setFire(true);
    const ev = runCollect(sim, ds, 20);
    expect(ev.some((e) => e.t === 'boom' && e.k === PROJ_BIG_BLOW)).toBe(true);
    expect(ev.some((e) => e.t === 'blastjump')).toBe(false);
    expect(a.state.onGround).toBe(1);
  });
});

describe('Juice', () => {
  it('makes you faster and hit harder, but you still take normal knockback', () => {
    const { sim, ps, ds } = setup([{ ult: 'juice' }, {}, {}]);
    const [a, b, c] = ps;
    place(ds[0], 0, 6);
    const normalWalk = walkSpeed(sim, ds, ds[0]);
    place(ds[0], 0, 6);
    popUlt(sim, ds, ds[0]);
    const juicedWalk = walkSpeed(sim, ds, ds[0]);
    expect(normalWalk).toBeGreaterThan(7);
    expect(juicedWalk / normalWalk).toBeCloseTo(BALANCE.ults.juice.speedMult, 1);

    // Bigger body, same hits: the same hit launches a juiced player just as fast.
    const hitSpeed = (t: SimPlayer) => {
      t.state.inflation = 0.4;
      sim.applyHit(t, c.id, 1, 0, 0, 1, 0, { direct: true, low: false, x: 0, y: 1, z: 0 });
      return sim.drainEvents().find((e): e is Hit => e.t === 'hit' && e.target === t.id)!.speed;
    };
    expect(hitSpeed(a) / hitSpeed(b)).toBeCloseTo(1, 2);

    // And his shots hit harder.
    const shotSpeed = (juiced: boolean) => {
      place(ds[0], 0, 6);
      place(ds[1], 0, -2);
      b.state.inflation = 0;
      a.state.juiceTimer = juiced ? 5 : 0;
      a.state.ammo = a.weapon.ammo;
      a.state.reloadTimer = 0;
      a.state.fireCool = 0;
      ds[0].aimAt(0, 1, -2);
      ds[0].setFire(true);
      run(sim, ds, 45);
      ds[0].setFire(false);
      return hitsOn(runCollect(sim, ds, 20), b, a)[0].speed;
    };
    const ratio = shotSpeed(true) / shotSpeed(false);
    expect(ratio).toBeGreaterThan(1.2);
    expect(ratio).toBeLessThan(1.5);
  });
});

describe('turning into the character', () => {
  it('grows your hitbox for as long as you are the character, then shrinks it back', () => {
    const { sim, ps, ds } = setup([{ ult: 'robot' }, {}]);
    const [a] = ps;
    place(ds[0], 0, 6);
    expect(sim.hitR(a)).toBe(1);
    popUlt(sim, ds, ds[0]);
    expect(sim.hitR(a)).toBe(BALANCE.ults.transformHitbox.radius);
    expect(sim.hitH(a)).toBe(BALANCE.ults.transformHitbox.height);
    // A shot just past the normal body now lands on the bigger one.
    const s = a.state;
    const r = 0.42 * 1.2;
    expect(capsuleSphere(s, s.px + r, s.py + 1, s.pz, 0.05)).toBeNull();
    expect(capsuleSphere(s, s.px + r, s.py + 1, s.pz, 0.05, sim.hitR(a), sim.hitH(a))).not.toBeNull();
    sim.time = a.bigUntil + 0.01;
    expect(sim.hitR(a)).toBe(1);
  });
});

describe('dealing ults', () => {
  it('every playable ult is equally likely, and never the same one twice in a row', () => {
    const counts = new Map<string, number>();
    const { sim, ps } = setup([{}, {}]);
    const p = ps[0];
    let last = ULT_IDS[p.state.ultKind];
    const N = 3000;
    for (let i = 0; i < N; i++) {
      sim.respawn(p);
      const now = ULT_IDS[p.state.ultKind];
      expect(PLAYABLE_ULTS).toContain(now);
      expect(now).not.toBe(last);
      counts.set(now, (counts.get(now) ?? 0) + 1);
      last = now;
    }
    for (const u of PLAYABLE_ULTS) expect(Math.abs((counts.get(u) ?? 0) / N - 1 / PLAYABLE_ULTS.length)).toBeLessThan(0.03);
  });
});

describe('The Chase', () => {
  it('picks who to bag at random: anyone within range, or anyone at all if nobody is close', () => {
    const picked = new Set<number>();
    let ids: number[] = [];
    for (let i = 0; i < 30; i++) {
      const { sim, ps, ds } = setup([{ ult: 'chase' }, {}, {}]);
      ids = [ps[1].id, ps[2].id];
      place(ds[0], 0, 0);
      place(ds[1], 0, 8);
      place(ds[2], 0, -12);
      const ult = popUlt(sim, ds, ds[0]).find((e) => e.t === 'ult') as Extract<GameEvent, { t: 'ult' }>;
      expect(ids).toContain(ult.targets[0]);
      picked.add(ult.targets[0]);
    }
    expect(picked.size).toBe(2);
    // Nobody within range: he still goes after someone.
    const { sim, ps, ds } = setup([{ ult: 'chase' }, {}]);
    place(ds[0], 0, 0);
    place(ds[1], 0, 0);
    ps[1].state.py = BALANCE.ults.chase.range + 10;
    ps[1].state.onGround = 0;
    popUlt(sim, ds, ds[0]);
    expect(ps[0].state.chaseTarget).toBe(ps[1].id);
  });

  it('is faster, recharges dashes faster (not instantly), and re-sniffs when the target pops', () => {
    const { sim, ps, ds } = setup([{ ult: 'chase' }, {}, {}]);
    const [a, b, c] = ps;
    // The others stand well off to the side, so walking doesn't bump into (and hug) either.
    place(ds[0], 0, 6);
    place(ds[1], 15, 6);
    place(ds[2], -15, 6);
    const normal = walkSpeed(sim, ds, ds[0]);
    place(ds[0], 0, 6);
    popUlt(sim, ds, ds[0]);
    expect(walkSpeed(sim, ds, ds[0]) / normal).toBeCloseTo(BALANCE.ults.chase.speedMult, 1);
    ds[0].press('dash');
    run(sim, ds, 20);
    ds[0].press('dash');
    run(sim, ds, 2);
    // Spent dashes come back three times as fast, but not every frame (no flying on endless air dashes).
    const spent = a.state.dashCharges;
    expect(spent).toBeLessThan(BALANCE.dash.charges);
    run(sim, ds, Math.ceil((BALANCE.dash.rechargeTime / BALANCE.ults.chase.dashRecharge) * 60) + 5);
    expect(a.state.dashCharges).toBeGreaterThan(spent);
    const first = a.state.chaseTarget;
    expect([b.id, c.id]).toContain(first);
    const other = first === b.id ? c : b;
    sim.knockout(first === b.id ? b : c);
    const ev = runCollect(sim, ds, 40);
    expect(ev.find((e) => e.t === 'sniff')).toMatchObject({ id: a.id, target: other.id });
    expect(a.state.chaseTarget).toBe(other.id);
  });

  it('touching the target hugs them (BAGGED), and the throw after is extra hard', () => {
    const { sim, ps, ds } = setup([{ ult: 'chase' }, {}]);
    const [a, b] = ps;
    place(ds[0], 0, 0);
    place(ds[1], 0, -5);
    popUlt(sim, ds, ds[0]);
    expect(a.state.chaseTarget).toBe(b.id);
    ds[0].frame.moveZ = 1;
    const ev = runCollect(sim, ds, 60, () => {
      if (b.state.mode === MODE_HELD) ds[0].frame.moveZ = 0;
    });
    expect(ev.find((e) => e.t === 'bag')).toMatchObject({ id: a.id, target: b.id });
    expect(ev.find((e) => e.t === 'grab')).toMatchObject({ id: a.id, target: b.id });
    const after = runCollect(sim, ds, Math.ceil(BALANCE.grab.maxHold * 60) + 5);
    expect(after.find((e) => e.t === 'gotcha')).toMatchObject({ id: a.id, target: b.id });
  });

  it('curves shots toward the target', () => {
    const missOrHit = (chase: boolean) => {
      const { sim, ps, ds } = setup([{ ult: 'chase' }, {}]);
      const [a, b] = ps;
      place(ds[0], 0, 6);
      place(ds[1], 0, -6);
      if (chase) popUlt(sim, ds, ds[0]);
      // Aim about 2.5 m to the side of them.
      ds[0].aimAt(2.5, 1, -6);
      ds[0].setFire(true);
      run(sim, ds, 2);
      ds[0].setFire(false);
      return hitsOn(runCollect(sim, ds, 40), b, a).some((h) => h.direct);
    };
    expect(missOrHit(false)).toBe(false);
    expect(missOrHit(true)).toBe(true);
  });

  it('grabbing the target throws them extra hard', () => {
    const throwSpeed = (chase: boolean) => {
      const { sim, ps, ds } = setup([{ ult: 'chase' }, {}]);
      const [a, b] = ps;
      place(ds[0], 0, 0);
      place(ds[1], 0, -1.3);
      if (chase) popUlt(sim, ds, ds[0]);
      a.state.grabCool = 0;
      ds[0].press('grab');
      run(sim, ds, 2);
      expect(b.state.mode).toBe(MODE_HELD);
      const ev = runCollect(sim, ds, Math.ceil(BALANCE.grab.maxHold * 60) + 5);
      if (chase) expect(ev.find((e) => e.t === 'gotcha')).toMatchObject({ id: a.id, target: b.id });
      return hitsOn(ev, b, a)[0].speed;
    };
    const ratio = throwSpeed(true) / throwSpeed(false);
    expect(ratio).toBeCloseTo(BALANCE.ults.chase.throwMult, 1);
  });
});

describe('Crop Duster', () => {
  it('bends over, then launches everyone nearby (and you, a bit) and leaves a gas cloud', () => {
    const C = BALANCE.ults.cropDuster;
    const { sim, ps, ds } = setup([{ ult: 'cropDuster' }, {}, {}, {}]);
    const [a, b, c, d] = ps;
    place(ds[0], 0, 0);
    place(ds[1], 2.5, 0);
    place(ds[2], 0, -7);
    place(ds[3], 16, -4);
    let ev = popUlt(sim, ds, ds[0]);
    expect(a.state.fartTimer).toBeGreaterThan(0);
    expect(ev.some((e) => e.t === 'fart')).toBe(false);
    ev = runCollect(sim, ds, Math.ceil(C.windup * 60) + 2);
    const fart = ev.find((e) => e.t === 'fart');
    expect(fart).toMatchObject({ id: a.id, r: C.radius });
    const near = hitsOn(ev, b, a)[0];
    const mid = hitsOn(ev, c, a)[0];
    expect(near.speed).toBeGreaterThan(mid.speed);
    expect(mid.speed).toBeGreaterThan(4);
    expect(near.dx).toBeGreaterThan(0.5); // pushed away (+x)
    expect(mid.dz).toBeLessThan(-0.5); // pushed away (-z)
    expect(b.state.inflation).toBeGreaterThan(0.08);
    expect(hitsOn(ev, d).length).toBe(0);
    expect(a.state.vy).toBeGreaterThan(5);
    expect(a.state.inflation).toBe(0);
    // Someone walking into the cloud gets slowed and slowly pumped up.
    place(ds[3], 1, 1);
    const speed = walkSpeed(sim, ds, ds[3]);
    expect(d.state.gasTimer).toBeGreaterThan(0);
    expect(speed).toBeLessThan(BALANCE.player.walkSpeed * C.cloudSlow + 0.2);
    expect(d.state.inflation).toBeGreaterThan(C.cloudInflation * 0.8);
    expect(d.lastAttacker).toBe(a.id);
    // And it clears up.
    run(sim, ds, Math.ceil(C.cloudTime * 60));
    expect(sim.ults.clouds.length).toBe(0);
  });
});

describe('Bæn Is Gay (Pride Parade)', () => {
  it('bursts everyone nearby into the air, speeds BÆN up, and the rainbow road bounces enemies', () => {
    const { sim, ps, ds } = setup([{ ult: 'pride' }, {}, {}]);
    const [a, b, c] = ps;
    place(ds[0], 0, 6);
    place(ds[1], 0, 3.5);
    place(ds[2], -12, 6);
    const normalWalk = walkSpeed(sim, ds, ds[0]);
    place(ds[0], 0, 6);
    place(ds[1], 0, 3.5);
    const ev = popUlt(sim, ds, ds[0]);
    expect(a.state.prideTimer).toBeGreaterThan(BALANCE.ults.pride.duration - 0.2);
    expect(ev.some((e) => e.t === 'ult' && e.kind === 'pride')).toBe(true);
    // The burst hit B (close) but not C (far away).
    expect(hitsOn(ev, b, a).length).toBeGreaterThan(0);
    expect(hitsOn(ev, c, a).length).toBe(0);
    // (After the hit-stop freeze.)
    run(sim, ds, 12);
    expect(b.state.py).toBeGreaterThan(0.3);
    // Faster while parading.
    const paradeWalk = walkSpeed(sim, ds, ds[0]);
    expect(paradeWalk / normalWalk).toBeCloseTo(BALANCE.ults.pride.speedMult, 1);

    // BÆN walks a road; C steps onto it and gets bounced (once per cooldown).
    place(ds[0], 10, 0, 0);
    ds[0].frame.moveZ = 1;
    run(sim, ds, 40);
    ds[0].frame.moveZ = 0;
    expect(sim.ults.road.length).toBeGreaterThan(5);
    // A piece from this last walk (B is still somewhere on the older ones).
    const piece = sim.ults.road[sim.ults.road.length - 3];
    expect(c.state.mode).not.toBe(MODE_DEAD);
    place(ds[2], piece.x, piece.z);
    c.state.py = piece.y;
    const onRoad = runCollect(sim, ds, 14);
    expect(hitsOn(onRoad, c, a).length).toBe(1);
    expect(c.state.py).toBeGreaterThan(piece.y + 0.3);
    // The road fades away after a few seconds.
    run(sim, ds, Math.round((BALANCE.ults.pride.roadLife + BALANCE.ults.pride.duration) * 60));
    expect(sim.ults.road.length).toBe(0);
  });
});

describe('Robot Mode', () => {
  it('locks on to up to 3 enemies in view and fires 6 homing mini-rockets at them', () => {
    const R = BALANCE.ults.robot;
    const { sim, ps, ds } = setup([{ ult: 'robot' }, {}, {}, {}, {}]);
    const [a, b, c, d, e] = ps;
    place(ds[0], 0, 7);
    place(ds[1], -3, -2);
    place(ds[2], 0, -4);
    place(ds[3], 3, -2);
    place(ds[4], 4, 10); // behind
    const ev = popUlt(sim, ds, ds[0]);
    const ult = ev.find((x): x is Extract<GameEvent, { t: 'ult' }> => x.t === 'ult')!;
    expect(ult.kind).toBe('robot');
    expect([...ult.targets].sort()).toEqual([b.id, c.id, d.id].sort());
    const later = runCollect(sim, ds, Math.ceil((R.scanTime + R.barrageTime + 1.5) * 60));
    const rockets = later.filter((x) => x.t === 'shot' && x.owner === a.id && x.w === PROJ_ROCKET);
    expect(rockets.length).toBe(R.rockets);
    for (const t of [b, c, d]) expect(hitsOn(later, t, a).length).toBeGreaterThan(0);
    expect(hitsOn(later, e, a).length).toBe(0);
    expect(a.state.robotTimer).toBe(0);
    // Your own rockets never launch you.
    expect(a.state.launchTimer).toBe(0);
  });
});

describe('Robot Mode with nobody in view', () => {
  it('fires blind, and the rockets find someone on the way', () => {
    const R = BALANCE.ults.robot;
    const { sim, ps, ds } = setup([{ ult: 'robot' }, {}]);
    const [a, b] = ps;
    // Off to the side, well outside the view cone.
    place(ds[0], 0, 6);
    place(ds[1], 12, -1);
    const ev = popUlt(sim, ds, ds[0]);
    expect(ev.find((x) => x.t === 'ult')).toMatchObject({ kind: 'robot', targets: [] });
    const later = runCollect(sim, ds, Math.ceil((R.scanTime + R.barrageTime + 1.5) * 60));
    expect(later.some((x) => x.t === 'proj' && x.home === b.id)).toBe(true);
    expect(hitsOn(later, b, a).length).toBeGreaterThan(0);
  });
});

describe('bots and ults', () => {
  it.each(ULT_IDS)('bots pop %s when it is full and enemies are near', (kind: UltId) => {
    const sim = new GameSim({ map: DEALERSHIP, durationSec: 999 });
    sim.eventMult = 0;
    const a = sim.addBot(0.65);
    const b = sim.addBot(0.65);
    sim.startMatch();
    for (const p of [a, b]) p.state.spawnProt = 0;
    a.loadout = { ...a.loadout, ult: kind };
    a.state.ultKind = ultIndex(kind);
    a.state.ult = 1;
    Object.assign(a.state, { px: 0, py: 0, pz: 3, vx: 0, vz: 0 });
    Object.assign(b.state, { px: 0, py: 0, pz: 0, vx: 0, vz: 0 });
    let used = false;
    let fired = false;
    for (let t = 0; t < 60 * 8 && !(used && (kind !== 'bigBlow' || fired)); t++) {
      sim.step();
      for (const e of sim.drainEvents()) {
        if (e.t === 'ult' && e.id === a.id) used = true;
        if (e.t === 'shot' && e.owner === a.id && e.w === PROJ_BIG_BLOW) fired = true;
      }
      // Keep them close so there's always someone to use it on.
      if (Math.hypot(a.state.px - b.state.px, a.state.pz - b.state.pz) > 6 && !used) Object.assign(b.state, { px: a.state.px, py: a.state.py, pz: a.state.pz - 3 });
    }
    expect(used).toBe(true);
    if (kind === 'bigBlow') expect(fired).toBe(true);
  });

  it('bots bring a mix of ults', () => {
    const sim = new GameSim({ map: DEALERSHIP, durationSec: 999 });
    const kinds = new Set<string>();
    for (let i = 0; i < 10; i++) kinds.add(sim.addBot(0.5).loadout.ult);
    expect(kinds.size).toBeGreaterThan(1);
  });
});

describe('ult loadout, unlocks and wire format', () => {
  it('deals one of the five character ults at random each spawn, all free', () => {
    expect(PLAYABLE_ULTS).toEqual(['juice', 'chase', 'cropDuster', 'robot', 'pride']);
    expect(unlockedAt(1).ults).toEqual([...ULT_IDS]);
    expect(sanitizeLoadout({}).ult).toBe('juice');
    const sim = new GameSim({ map: DEALERSHIP, durationSec: 999 });
    const p = sim.addPlayer('p', { loadout: sanitizeLoadout({ ult: 'bigBlow' }) });
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      sim.respawn(p);
      seen.add(ULT_IDS[p.state.ultKind]);
    }
    expect([...seen].sort()).toEqual([...PLAYABLE_ULTS].sort());
  });

  it('the snapshot carries the ult state for everyone to see', () => {
    const s = createPlayerState();
    s.ult = 1;
    s.chaseTimer = 3;
    s.chaseTarget = 7;
    const buf = encodeSnapshot(1, 1, 2, s, [{ id: 4, state: s, weapon: 0, streaming: false, crowned: false }]);
    const snap = decodeSnapshot(new DataView(buf));
    expect(snap.self!.chaseTarget).toBe(7);
    const pub = snap.players[0];
    expect(pub.ult).toBe(publicUlt(s));
    expect(pub.ult & ULT_BIT_READY).toBeTruthy();
    expect(publicUltKind(pub.ult)).toBe('chase');
    expect(pub.ultTarget).toBe(7);
  });

  it('homing turns toward the target at most the given angle', () => {
    const v = { vx: 10, vy: 0, vz: 0 };
    steerToward(v, 0, 0, 0, 0, 0, 10, 0.1);
    expect(Math.hypot(v.vx, v.vy, v.vz)).toBeCloseTo(10, 5);
    expect(Math.atan2(v.vz, v.vx)).toBeCloseTo(0.1, 5);
  });
});
