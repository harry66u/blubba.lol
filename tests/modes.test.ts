import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/shared/balance';
import type { GameEvent } from '../src/shared/game/events';
import { GameSim, type ModeId, type SimPlayer } from '../src/shared/game/sim';
import { KNOCKOUT_MAPS, getMap, mapForMode } from '../src/shared/maps';
import { DEALERSHIP } from '../src/shared/maps/dealership';
import { MODE_DEAD, createPlayerState } from '../src/shared/player';
import { decodeSnapshot, encodeSnapshot } from '../src/shared/protocol';
import { fitMap, sanitizeSettings } from '../src/server/room';
import { Driver, run } from './helpers';

function setup(mode: ModeId, n: number) {
  const map = getMap(mapForMode(mode) ?? DEALERSHIP.id);
  const sim = new GameSim({ map, mode, durationSec: 999 });
  sim.eventMult = 0;
  const ps: SimPlayer[] = [];
  const ds: Driver[] = [];
  for (let i = 0; i < n; i++) {
    const p = sim.addPlayer(`p${i}`);
    ps.push(p);
    ds.push(new Driver(sim, p));
  }
  sim.startMatch();
  for (const p of ps) p.state.spawnProt = 0;
  return { sim, ps, ds };
}

function place(p: SimPlayer, x: number, y: number, z: number) {
  Object.assign(p.state, { px: x, py: y, pz: z, vx: 0, vy: 0, vz: 0, spawnProt: 0, onGround: 1, inflation: 0 });
}

function collect(sim: GameSim, ds: Driver[], ticks: number, each?: (t: number) => void): GameEvent[] {
  const out: GameEvent[] = [];
  run(sim, ds, ticks, (t) => {
    each?.(t);
    out.push(...sim.drainEvents());
  });
  out.push(...sim.drainEvents());
  return out;
}

/** Holds fire for a quick charge and releases at the target. */
function shoot(sim: GameSim, d: Driver, ds: Driver[], x: number, y: number, z: number): GameEvent[] {
  d.aimAt(x, y, z);
  d.setFire(true);
  const ev = collect(sim, ds, 20);
  d.setFire(false);
  return [...ev, ...collect(sim, ds, 60)];
}

describe('teams', () => {
  it('splits players evenly and rebalances when someone leaves', () => {
    const { sim, ps } = setup('teamKnockout', 6);
    const count = (t: number) => [...sim.players.values()].filter((p) => p.team === t).length;
    expect(count(0)).toBe(3);
    expect(count(1)).toBe(3);
    // Two players from the same team leave: someone moves over.
    const t0 = ps.filter((p) => p.team === 0);
    sim.removePlayer(t0[0].id);
    sim.removePlayer(t0[1].id);
    expect(Math.abs(count(0) - count(1))).toBeLessThanOrEqual(1);
  });

  it('has no friendly fire, but enemies still get inflated', () => {
    const { sim, ps, ds } = setup('teamKnockout', 3);
    // Three players split 2v1: shoot from the side with two.
    const big = ps.filter((p) => p.team === 0).length === 2 ? 0 : 1;
    const [a, ally] = ps.filter((p) => p.team === big);
    const enemy = ps.find((p) => p.team !== big)!;
    place(a, 0, 0, 0);
    place(ally, 0, 0, -8);
    place(enemy, 12, 0, 12);
    shoot(sim, ds[ps.indexOf(a)], ds, 0, 1, -8);
    expect(ally.state.inflation).toBe(0);
    place(a, 0, 0, 0);
    place(enemy, 0, 0, -8);
    place(ally, 12, 0, 12);
    shoot(sim, ds[ps.indexOf(a)], ds, 0, 1, -8);
    expect(enemy.state.inflation).toBeGreaterThan(0);
  });

  it('team knockouts add to the team score', () => {
    const { sim, ps, ds } = setup('teamKnockout', 2);
    const [a, b] = ps;
    expect(a.team).not.toBe(b.team);
    b.lastAttacker = a.id;
    b.lastAttackTime = sim.time;
    place(b, 0, -60, 0);
    collect(sim, ds, 2);
    expect(sim.teamScores[a.team]).toBe(1);
    expect(sim.teamScores[b.team]).toBe(0);
  });
});

describe('ball', () => {
  it('shooting the ball sends it flying', () => {
    const { sim, ps, ds } = setup('ball', 2);
    const ball = sim.ballGame!.ball;
    const [a] = ps;
    collect(sim, ds, 60); // let the ball settle
    place(a, ball.x - 8, 0, ball.z);
    const x0 = ball.x;
    shoot(sim, ds[0], ds, ball.x, ball.y, ball.z);
    expect(ball.x - x0).toBeGreaterThan(3);
    expect(ball.lastTouch).toBe(a.id);
  });

  it('a ball in a goal scores for the other team and resets', () => {
    const { sim, ps, ds } = setup('ball', 2);
    const map = sim.map;
    const goal = map.ball!.goals.find((g) => g.team === 1)!; // team 1 defends this one
    const scorer = ps.find((p) => p.team === 0)!;
    const b = sim.ballGame!.ball;
    Object.assign(b, { x: goal.min[0] - 2, y: 1.8, z: 0, vx: 20, vy: 0, vz: 0, lastTouch: scorer.id });
    const ev = collect(sim, ds, 30);
    const goalEv = ev.find((e) => e.t === 'goal');
    expect(goalEv).toMatchObject({ team: 0, scorer: scorer.id });
    expect(sim.teamScores).toEqual([1, 0]);
    expect(scorer.score).toBe(1);
    const reset = collect(sim, ds, (BALANCE.modes.ball.resetDelay + 0.2) * 60);
    expect(reset.some((e) => e.t === 'ballReset')).toBe(true);
    expect(Math.abs(b.x - map.ball!.spawn[0])).toBeLessThan(2);
  });

  it('reaching the goal target ends the match', () => {
    const { sim, ds } = setup('ball', 2);
    sim.teamScores = [BALANCE.modes.ball.goalTarget - 1, 0];
    const goal = sim.map.ball!.goals.find((g) => g.team === 1)!;
    Object.assign(sim.ballGame!.ball, { x: goal.min[0] - 2, y: 1.8, z: 0, vx: 20, vy: 0, vz: 0 });
    collect(sim, ds, 40);
    expect(sim.phase).toBe('results');
    expect(sim.lastResult?.teams).toMatchObject({ winner: 0 });
  });
});

describe('pump', () => {
  it('standing on your pump fills your giant; an enemy on it stops that', () => {
    const { sim, ps, ds } = setup('pump', 2);
    const a = ps.find((p) => p.team === 0)!;
    const b = ps.find((p) => p.team === 1)!;
    const pump = sim.map.pumps!.find((p) => p.team === 0)!;
    place(a, pump.x, pump.y, pump.z);
    place(b, 34, 0, -8);
    collect(sim, ds, 120);
    const filled = sim.pumpGame!.fill[0];
    expect(filled).toBeGreaterThan(0.005);
    expect(sim.pumpGame!.fill[1]).toBe(0);
    place(b, pump.x + 0.5, pump.y, pump.z + 0.5);
    place(a, pump.x - 0.5, pump.y, pump.z - 0.5);
    collect(sim, ds, 120, () => {
      a.state.px = pump.x - 0.5;
      a.state.pz = pump.z - 0.5;
      b.state.px = pump.x + 0.5;
      b.state.pz = pump.z + 0.5;
    });
    expect(sim.pumpGame!.fill[0]).toBeCloseTo(filled, 5);
    expect(sim.pumpGame!.states[sim.map.pumps!.indexOf(pump)]).toBe(2);
  });

  it('a full giant wins the match for that team', () => {
    const { sim, ps, ds } = setup('pump', 2);
    const b = ps.find((p) => p.team === 1)!;
    const pump = sim.map.pumps!.find((p) => p.team === 1)!;
    sim.pumpGame!.fill = [0.2, 0.999];
    place(b, pump.x, pump.y, pump.z);
    const ev = collect(sim, ds, 60);
    expect(ev.some((e) => e.t === 'pumpFull' && e.team === 1)).toBe(true);
    expect(sim.phase).toBe('results');
    expect(sim.lastResult?.teams?.winner).toBe(1);
  });
});

describe('1v1', () => {
  it('ends when someone reaches the knockout target', () => {
    const { sim, ps, ds } = setup('duel', 2);
    const [a, b] = ps;
    for (let i = 0; i < BALANCE.modes.duel.target; i++) {
      expect(sim.phase).toBe('playing');
      b.lastAttacker = a.id;
      b.lastAttackTime = sim.time;
      place(b, 0, -60, 0);
      collect(sim, ds, 2);
      collect(sim, ds, (BALANCE.match.respawnDelay + 0.2) * 60);
    }
    expect(sim.phase).toBe('results');
    expect(sim.lastResult?.winnerId).toBe(a.id);
  });

  it('falling off on your own scores for your rival', () => {
    const { sim, ps, ds } = setup('duel', 2);
    const [a, b] = ps;
    place(b, 0, -60, 0);
    const ko = collect(sim, ds, 2).find((e) => e.t === 'ko');
    expect(ko).toMatchObject({ victim: b.id, killer: a.id, points: 1 });
    expect((ko as { tags: string[] }).tags).toContain('sd');
    expect(a.score).toBe(1);
  });
});

describe('mode plumbing', () => {
  it('snapshots carry team scores, the ball and pump fill', () => {
    const buf = encodeSnapshot(10, 3, 1, createPlayerState(), [], {
      teamScores: [3, 5],
      ball: { x: 1, y: 2, z: 3, vx: 4, vy: -5, vz: 6, inPlay: true },
      pump: { fill: [0.25, 0.5], states: [1, 0, 2, 0] },
    });
    const snap = decodeSnapshot(new DataView(buf));
    expect(snap.mode?.teamScores).toEqual([3, 5]);
    expect(snap.mode?.ball).toMatchObject({ x: 1, y: 2, z: 3, vx: 4, vy: -5, vz: 6, inPlay: true });
    expect(snap.mode?.pump?.fill[1]).toBeCloseTo(0.5, 3);
    expect(snap.mode?.pump?.states).toEqual([1, 0, 2, 0]);
    const plain = decodeSnapshot(new DataView(encodeSnapshot(10, 3, 1, null, [])));
    expect(plain.mode).toBeNull();
  });

  it('room settings keep modes on maps that fit them', () => {
    const base = { mode: 'knockout' as const, mapId: 'dealership', durationSec: 240, bots: true, events: 'normal' as const };
    expect(fitMap({ ...base, mode: 'ball' }).mapId).toBe('ballArena');
    expect(fitMap({ ...base, mode: 'pump', mapId: 'garage' }).mapId).toBe('pumpArena');
    expect(fitMap({ ...base, mapId: 'ballArena' }).mapId).toBe('dealership');
    expect(fitMap({ ...base, mode: 'duel', mapId: 'bounceHouse' }).mapId).toBe('bounceHouse');
    expect(fitMap({ ...base, mode: 'teamKnockout', mapId: 'pier' }).mapId).toBe('pier');
    expect(sanitizeSettings({ mapId: 'pier' })).toEqual({ mapId: 'pier' });
    expect(sanitizeSettings({ mode: 'nope' as ModeId, mapId: '__proto__' })).toEqual({});
  });

  it('bots play every mode without errors', () => {
    for (const mode of ['teamKnockout', 'ball', 'pump', 'duel'] as ModeId[]) {
      const map = getMap(mapForMode(mode) ?? 'garage');
      const sim = new GameSim({ map, mode, durationSec: 999 });
      for (let i = 0; i < (mode === 'duel' ? 2 : 8); i++) sim.addBot(0.6);
      for (let t = 0; t < 60 * 30; t++) {
        sim.step();
        sim.drainEvents();
      }
      if (mode === 'pump') expect(sim.pumpGame!.fill[0] + sim.pumpGame!.fill[1]).toBeGreaterThan(0.02);
    }
  });
});

describe('knockout maps', () => {
  it.each(KNOCKOUT_MAPS)('%s: spawns and pickups sit on open ground away from the edges', (id) => {
    const sim = new GameSim({ map: getMap(id), mode: 'knockout' });
    const w = sim.world;
    for (const [x, y, z] of sim.map.spawns) {
      expect(w.groundBelow(x, y + 0.1, z, 0.2)).toBe(y);
      // Room to stand, and floor a few steps away in every direction.
      expect(w.boxBlocked(x - 0.5, y + 0.05, z - 0.5, x + 0.5, y + 2.2, z + 0.5)).toBe(false);
      for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) expect(w.groundBelow(x + dx, y + 0.1, z + dz, 0.6)).not.toBeNull();
    }
    for (const [x, y, z] of sim.map.pickups) expect(w.groundBelow(x, y + 0.1, z, 0.2)).toBe(y);
  });

  it.each(KNOCKOUT_MAPS)('%s: bounce pads land you on the map, not off it', (id) => {
    const map = getMap(id);
    for (const pad of map.bouncePads) {
      const sim = new GameSim({ map, mode: 'knockout', durationSec: 999 });
      sim.eventMult = 0;
      const p = sim.addPlayer('p');
      const d = new Driver(sim, p);
      sim.startMatch();
      place(p, pad.x, pad.y, pad.z);
      let launched = false;
      let landed = -1;
      run(sim, [d], 60 * 5, () => {
        if (!p.state.onGround) launched = true;
        else if (launched && landed < 0) landed = p.state.groundId;
      });
      expect(launched).toBe(true);
      expect(p.state.mode).not.toBe(MODE_DEAD);
      expect(landed).toBeGreaterThanOrEqual(0);
    }
  });

  it('bots knock each other off every knockout map', () => {
    for (const id of KNOCKOUT_MAPS) {
      const sim = new GameSim({ map: getMap(id), mode: 'knockout', durationSec: 999 });
      for (let i = 0; i < 6; i++) sim.addBot(0.6);
      // The first knockout usually lands within 15-25 s; allow plenty of slack.
      let kos = 0;
      for (let t = 0; t < 60 * 150 && kos === 0; t++) {
        sim.step();
        for (const e of sim.drainEvents()) if (e.t === 'ko' && e.killer >= 0) kos++;
      }
      expect(kos, id).toBeGreaterThan(0);
    }
  });
});
