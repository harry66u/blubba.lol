import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/shared/balance';
import { CHALLENGE_BY_ID, applyDailyMatch, emptyDaily } from '../src/shared/daily';
import type { GameEvent } from '../src/shared/game/events';
import { GameSim, type SimPlayer } from '../src/shared/game/sim';
import { KNOCKOUT_MAPS, getMap } from '../src/shared/maps';
import { DEALERSHIP } from '../src/shared/maps/dealership';
import { MODE_DEAD } from '../src/shared/player';
import { Driver, run } from './helpers';

const SD = BALANCE.modes.suddenDeath;

function setup(n: number) {
  const sim = new GameSim({ map: DEALERSHIP, mode: 'suddenDeath' });
  const ps: SimPlayer[] = [];
  const ds: Driver[] = [];
  for (let i = 0; i < n; i++) {
    const p = sim.addPlayer(`p${i}`);
    ps.push(p);
    ds.push(new Driver(sim, p));
  }
  sim.startMatch();
  sim.drainEvents();
  return { sim, ps, ds };
}

/** Knocks `victim` off the map, credited to `by` (or a fall with no credit). */
function pop(sim: GameSim, ds: Driver[], victim: SimPlayer, by?: SimPlayer): GameEvent[] {
  if (by) {
    victim.lastAttacker = by.id;
    victim.lastAttackTime = sim.time;
  }
  Object.assign(victim.state, { px: 0, py: -60, pz: 0, vx: 0, vy: 0, vz: 0, spawnProt: 0 });
  const ev: GameEvent[] = [];
  run(sim, ds, 2, () => ev.push(...sim.drainEvents()));
  return [...ev, ...sim.drainEvents()];
}

const survivorEvents = (ev: GameEvent[]) => ev.filter((e): e is Extract<GameEvent, { t: 'survivors' }> => e.t === 'survivors');

describe('sudden death', () => {
  it('everyone starts at 100% inflation, and nobody gets a second life', () => {
    const { sim, ps, ds } = setup(3);
    for (const p of ps) expect(p.state.inflation).toBe(BALANCE.inflation.max);
    expect(sim.durationSec).toBe(SD.durationSec);
    expect(sim.eventMult > 0 && sim.chaosNext === null).toBe(true);
    const ev = pop(sim, ds, ps[0], ps[1]);
    expect(survivorEvents(ev).map((e) => e.left)).toEqual([[ps[1].id, ps[2].id]]);
    // Well past the normal respawn delay: still out.
    run(sim, ds, Math.ceil((BALANCE.match.respawnDelay + 3) * 60));
    expect(ps[0].state.mode).toBe(MODE_DEAD);
    expect(sim.isOut(ps[0])).toBe(true);
    expect(sim.phase).toBe('playing');
    // No random events in Sudden Death.
    run(sim, ds, 60 * 60, () => {
      for (const p of ps) p.state.spawnProt = 1;
      expect(sim.drainEvents().some((e) => e.t === 'chaos')).toBe(false);
    });
  });

  it('the last one standing wins, and the rest place by how long they lasted', () => {
    const { sim, ps, ds } = setup(4);
    const [a, b, c, d] = ps;
    pop(sim, ds, b, a);
    run(sim, ds, 30);
    pop(sim, ds, c); // fell off with nobody's help
    run(sim, ds, 30);
    const ev = pop(sim, ds, d, a);
    const last = survivorEvents(ev).pop()!;
    expect(last.left).toEqual([a.id]);
    // A short victory beat, then the results.
    expect(sim.phase).toBe('playing');
    run(sim, ds, Math.ceil(SD.winnerDelay * 60) + 2);
    expect(sim.phase).toBe('results');
    const r = sim.lastResult!;
    expect(r.winnerId).toBe(a.id);
    expect(r.survivors).toEqual([a.id]);
    expect(r.standings.map((s) => s.id)).toEqual([a.id, d.id, c.id, b.id]);
    // Results are shorter than usual, then everyone is back in, fully inflated.
    run(sim, ds, Math.ceil(SD.resultsSec * 60) + 2);
    expect(sim.phase).toBe('playing');
    for (const p of ps) {
      expect(p.state.mode).not.toBe(MODE_DEAD);
      expect(p.state.inflation).toBe(BALANCE.inflation.max);
      expect(sim.isOut(p)).toBe(false);
    }
  });

  it('when time runs out, the most knockouts among the survivors wins', () => {
    const { sim, ps, ds } = setup(4);
    const [a, b, c, d] = ps;
    pop(sim, ds, c, b);
    pop(sim, ds, d, a);
    b.stats.hits = 9;
    a.stats.hits = 2;
    // Tied on knockouts: more hits landed wins. Keep both safe until the buzzer.
    run(sim, ds, Math.ceil((sim.phaseEndsAt - sim.time) * 60) + 2, () => {
      for (const p of [a, b]) Object.assign(p.state, { px: 0, py: 0.01, pz: 0, vx: 0, vy: 0, vz: 0, onGround: 1, spawnProt: 1 });
    });
    expect(sim.phase).toBe('results');
    const r = sim.lastResult!;
    expect(r.survivors!.sort()).toEqual([a.id, b.id].sort());
    expect(r.winnerId).toBe(b.id);
  });

  it('someone who joins mid-match watches until the next one', () => {
    const { sim, ps, ds } = setup(3);
    run(sim, ds, Math.ceil((SD.joinGrace + 1) * 60));
    const late = sim.addPlayer('late');
    const ld = new Driver(sim, late);
    const all = [...ds, ld];
    expect(late.state.mode).toBe(MODE_DEAD);
    expect(sim.isOut(late)).toBe(true);
    run(sim, all, 5 * 60);
    expect(late.state.mode).toBe(MODE_DEAD);
    // The late joiner doesn't count as a survivor: two pops end it.
    pop(sim, all, ps[1], ps[0]);
    const ev = pop(sim, all, ps[2], ps[0]);
    expect(survivorEvents(ev).pop()!.left).toEqual([ps[0].id]);
    run(sim, all, Math.ceil(SD.winnerDelay * 60) + 2);
    expect(sim.phase).toBe('results');
    expect(sim.lastResult!.standings.map((s) => s.id).pop()).toBe(late.id);
    run(sim, all, Math.ceil(SD.resultsSec * 60) + 2);
    expect(sim.phase).toBe('playing');
    expect(late.state.mode).not.toBe(MODE_DEAD);
    expect(sim.isOut(late)).toBe(false);
  });

  it('someone joining in the first seconds still plays', () => {
    const { sim, ds } = setup(2);
    run(sim, ds, 60);
    const p = sim.addPlayer('quick');
    expect(p.state.mode).not.toBe(MODE_DEAD);
    expect(sim.isOut(p)).toBe(false);
  });

  it('the map starts shrinking at 40 s and keeps shrinking', () => {
    const { sim, ps, ds } = setup(2);
    const t0 = sim.matchStartedAt;
    const ev: GameEvent[] = [];
    // Keep both players safe in the middle so the match runs to the cap.
    run(sim, ds, Math.ceil(SD.durationSec * 60) - 30, () => {
      for (const p of ps) Object.assign(p.state, { px: p.id * 2, py: 0.01, pz: 0, vx: 0, vy: 0, vz: 0, onGround: 1, spawnProt: 1 });
      ev.push(...sim.drainEvents());
    });
    const shrinks = ev.filter((e): e is Extract<GameEvent, { t: 'shrink' }> => e.t === 'shrink');
    // Sky Motors has outer islands (order 3), side islands (order 2) and no order 1.
    expect(shrinks.map((e) => Math.round(e.startTick * sim.dt - t0))).toEqual([40, 60, 80, 100, 120]);
    for (const e of shrinks) expect(Math.round((e.startTick - e.tick) * sim.dt)).toBe(BALANCE.shrink.warning);
    expect(shrinks[0].sink).toEqual([3]);
    expect(shrinks[1].sink).toEqual([2]);
    const deck = sim.world.solids.find((s) => s.collapse === 0)!;
    // By the end the deck has crumbled to a small arena.
    expect(deck.maxX - deck.minX).toBeLessThan(50 * (1 - 0.44));
    expect(sim.world.solids.filter((s) => s.collapse > 0).every((s) => !s.enabled)).toBe(true);
  });

  it('bots finish a match with a winner on every knockout map', () => {
    for (const id of KNOCKOUT_MAPS) {
      const sim = new GameSim({ map: getMap(id), mode: 'suddenDeath' });
      for (let i = 0; i < 6; i++) sim.addBot(0.5);
      const start = sim.time;
      while (sim.phase === 'playing' && sim.time - start < SD.durationSec + 5) {
        sim.step();
        sim.drainEvents();
      }
      expect(sim.phase, id).toBe('results');
      const r = sim.lastResult!;
      expect(r.winnerId, id).toBe(r.standings[0].id);
      // Last one standing (or the last ones went out together), or time ran out.
      expect(r.survivors!.length <= 1 || sim.time - start >= SD.durationSec - 0.1, id).toBe(true);
    }
  });

  it('has a daily challenge for making the final 3', () => {
    const c = CHALLENGE_BY_ID.get('sdFinal3')!;
    expect(c.mode).toBe('suddenDeath');
    expect(c.label).toContain('Sudden Death');
    const stats = setup(2).ps[0].stats;
    const d = emptyDaily();
    d.day = '2026-09-29';
    d.lastPlayedDay = d.day;
    d.challenges = [{ id: 'sdFinal3', progress: 0, done: false }];
    const now = Date.parse('2026-09-29T12:00:00Z');
    expect(applyDailyMatch(d, 'g:x', { mode: 'suddenDeath', won: false, stats, place: 5 }, now)).toEqual([]);
    expect(applyDailyMatch(d, 'g:x', { mode: 'knockout', won: true, stats, place: 1 }, now)).toEqual([]);
    expect(applyDailyMatch(d, 'g:x', { mode: 'suddenDeath', won: false, stats, place: 3 }, now)).toHaveLength(1);
    expect(d.challenges[0].done).toBe(true);
  });
});
