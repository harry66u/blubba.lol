import { describe, expect, it } from 'vitest';
import { MAX_PER_SIDE, checkTeamLobby, shuffleTeams } from '../src/shared/game/teamLobby';

const seat = (id: number, team: number, bot = false) => ({ id, team, bot });

describe('team lobby rules', () => {
  it('needs enough players on both sides', () => {
    const c = checkTeamLobby([seat(1, 0), seat(2, 1), seat(3, 0)], new Set([1, 2, 3]), 2);
    expect(c.ok).toBe(false);
    expect(c.teamsOk).toBe(false);
    expect(c.waiting).toBe('Need 2 per team: 1 more player');
  });

  it('needs even teams (one apart at most)', () => {
    const c = checkTeamLobby([seat(1, 0), seat(2, 0), seat(3, 0), seat(4, 1), seat(5, 1), seat(6, 0)], new Set([1, 2, 3, 4, 5, 6]), 2);
    expect(c.teamsOk).toBe(false);
    expect(c.waiting).toBe('Teams are uneven (4 v 2)');
    expect(checkTeamLobby([seat(1, 0), seat(2, 0), seat(3, 0), seat(4, 1), seat(5, 1)], new Set([1, 2, 3, 4, 5]), 2).ok).toBe(true);
  });

  it('waits for every human; bots are always ready', () => {
    const seats = [seat(1, 0), seat(2, 0, true), seat(3, 1), seat(4, 1, true)];
    const c = checkTeamLobby(seats, new Set([1]), 2);
    expect(c.teamsOk).toBe(true);
    expect(c.ok).toBe(false);
    expect(c.waiting).toBe('Waiting for 1 to ready up');
    expect(checkTeamLobby(seats, new Set([1, 3]), 2)).toMatchObject({ ok: true, waiting: '' });
  });

  it('a shuffle deals humans evenly first, then evens up with bots', () => {
    let seed = 7;
    const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let run = 0; run < 20; run++) {
      const seats = [seat(1, 0), seat(2, 0), seat(3, 0), seat(4, 0), seat(5, 0, true), seat(6, 0, true), seat(7, 0, true)];
      const teams = shuffleTeams(seats, rng);
      const humans = [1, 2, 3, 4].map((id) => teams.get(id));
      expect(humans.filter((t) => t === 0)).toHaveLength(2);
      const all = [...teams.values()];
      expect(Math.abs(all.filter((t) => t === 0).length - all.filter((t) => t === 1).length)).toBeLessThanOrEqual(1);
    }
    expect(MAX_PER_SIDE).toBe(5);
  });
});
