import { describe, expect, it } from 'vitest';
import {
  CHALLENGES,
  CHALLENGE_BY_ID,
  DAILY,
  type DailyMatch,
  type DailyState,
  applyDailyMatch,
  dailyView,
  emptyDaily,
  pickChallenges,
  rollDaily,
  sanitizeDaily,
  secondsToReset,
} from '../src/shared/daily';
import { awardMatch } from '../src/server/progress';
import { Store, guestKey } from '../src/server/store';
import type { MatchStats } from '../src/shared/game/sim';

const KEY = 'g:guest-daily-01';
const at = (day: string, time = '12:00:00') => Date.parse(`${day}T${time}Z`);

const stats = (over: Partial<MatchStats> = {}): MatchStats => ({
  kos: 0,
  deaths: 0,
  falls: 0,
  hits: 0,
  shots: 0,
  longestLaunch: 0,
  chainKos: 0,
  timesPopped: 0,
  bestCombo: 0,
  throws: 0,
  stomps: 0,
  goals: 0,
  pumpTime: 0,
  crownKos: 0,
  ...over,
});

const match = (over: Partial<MatchStats> = {}, mode: DailyMatch['mode'] = 'knockout', won = false): DailyMatch => ({ mode, won, stats: stats(over) });

/** A daily state already on `day` with the given challenges (so tests don't depend on the pick). */
function withChallenges(day: string, ids: string[]): DailyState {
  const d = emptyDaily();
  d.day = day;
  d.challenges = ids.map((id) => ({ id, progress: 0, done: false }));
  return d;
}

describe('daily challenge pool', () => {
  it('has sensible targets and rewards', () => {
    expect(CHALLENGES.length).toBeGreaterThanOrEqual(10);
    expect(new Set(CHALLENGES.map((c) => c.id)).size).toBe(CHALLENGES.length);
    for (const c of CHALLENGES) {
      expect(c.target).toBeGreaterThan(0);
      expect(c.coins).toBeGreaterThanOrEqual(25);
      expect(c.coins).toBeLessThanOrEqual(60);
      expect(c.xp).toBeGreaterThan(0);
    }
    // Mode-specific challenges say which mode.
    expect(CHALLENGE_BY_ID.get('goal')!.label).toContain('Ball');
    expect(CHALLENGE_BY_ID.get('pump')!.label).toContain('Pump');
  });

  it('picks the same three for a day and profile, all different, at most one tied to a mode', () => {
    expect(pickChallenges('2026-09-28', KEY)).toEqual(pickChallenges('2026-09-28', KEY));
    const seen = new Set<string>();
    let withMode = 0;
    for (let d = 1; d <= 28; d++) {
      for (let k = 0; k < 20; k++) {
        const ids = pickChallenges(`2026-02-${String(d).padStart(2, '0')}`, `g:guest-${k}`);
        expect(ids.length).toBe(DAILY.count);
        expect(new Set(ids).size).toBe(DAILY.count);
        const modes = ids.filter((id) => CHALLENGE_BY_ID.get(id)!.mode).length;
        expect(modes).toBeLessThanOrEqual(1);
        if (modes) withMode++;
        for (const id of ids) seen.add(id);
      }
    }
    // Everything in the pool comes up, and some days have a mode challenge.
    expect(seen.size).toBe(CHALLENGES.length);
    expect(withMode).toBeGreaterThan(0);
    // Different players (and days) get different sets.
    const sets = new Set(Array.from({ length: 20 }, (_, k) => pickChallenges('2026-09-28', `g:guest-${k}`).join()));
    expect(sets.size).toBeGreaterThan(5);
  });

  it('counts down to the next UTC midnight', () => {
    expect(secondsToReset(at('2026-09-28', '23:00:00'))).toBe(3600);
    expect(secondsToReset(at('2026-09-28', '00:00:00'))).toBe(86400);
  });
});

describe('daily progress', () => {
  it('adds up over the day and pays each challenge exactly once', () => {
    const d = withChallenges('2026-09-28', ['hits', 'launch', 'goal']);
    d.lastPlayedDay = '2026-09-28'; // no streak line in the way
    expect(applyDailyMatch(d, KEY, match({ hits: 25 }), at('2026-09-28'))).toEqual([]);
    expect(d.challenges[0]).toEqual({ id: 'hits', progress: 25, done: false });
    const lines = applyDailyMatch(d, KEY, match({ hits: 30 }), at('2026-09-28', '13:00:00'));
    const hits = CHALLENGE_BY_ID.get('hits')!;
    expect(lines).toEqual([{ label: 'Daily: Land 40 hits ✓', xp: hits.xp, coins: hits.coins }]);
    expect(d.challenges[0]).toEqual({ id: 'hits', progress: 40, done: true });
    // Done is done: more hits pay nothing.
    expect(applyDailyMatch(d, KEY, match({ hits: 100 }), at('2026-09-28', '14:00:00'))).toEqual([]);
  });

  it('keeps the best match for "best" challenges and ignores other modes for mode ones', () => {
    const d = withChallenges('2026-09-28', ['hits', 'launch', 'goal']);
    d.lastPlayedDay = '2026-09-28';
    applyDailyMatch(d, KEY, match({ longestLaunch: 18.37, goals: 2 }), at('2026-09-28'));
    applyDailyMatch(d, KEY, match({ longestLaunch: 12 }), at('2026-09-28'));
    expect(d.challenges[1].progress).toBe(18.4);
    // Goals only count in Ball.
    expect(d.challenges[2].progress).toBe(0);
    const lines = applyDailyMatch(d, KEY, match({ longestLaunch: 31, goals: 1 }, 'ball'), at('2026-09-28'));
    expect(lines.map((l) => l.label)).toEqual(['Daily: Launch someone 30 m ✓', 'Daily: Score a goal in Ball ✓']);
    expect(d.challenges.map((c) => c.done)).toEqual([false, true, true]);
  });

  it('rolls over to new challenges at UTC midnight', () => {
    const d = withChallenges('2026-09-27', ['hits', 'launch', 'goal']);
    d.challenges[0].progress = 39;
    d.challenges[1].done = true;
    rollDaily(d, KEY, at('2026-09-27', '23:59:59'));
    expect(d.challenges[0].progress).toBe(39);
    rollDaily(d, KEY, at('2026-09-28', '00:00:01'));
    expect(d.day).toBe('2026-09-28');
    expect(d.challenges.map((c) => c.id)).toEqual(pickChallenges('2026-09-28', KEY));
    expect(d.challenges.every((c) => c.progress === 0 && !c.done)).toBe(true);
    // Rolling again the same day changes nothing.
    d.challenges[0].progress = 1;
    rollDaily(d, KEY, at('2026-09-28', '18:00:00'));
    expect(d.challenges[0].progress).toBe(1);
  });

  it('the view shows today without changing what is saved', () => {
    const d = withChallenges('2026-09-27', ['hits', 'launch', 'goal']);
    d.challenges[0].progress = 12;
    const v = dailyView(d, KEY, at('2026-09-27', '20:00:00'));
    expect(v.challenges[0]).toMatchObject({ id: 'hits', label: 'Land 40 hits', progress: 12, target: 40, done: false });
    expect(v.challenges[2].mode).toBe('ball');
    expect(v.resetsIn).toBe(4 * 3600);
    const next = dailyView(d, KEY, at('2026-09-28'));
    expect(next.challenges.map((c) => c.id)).toEqual(pickChallenges('2026-09-28', KEY));
    expect(next.challenges.every((c) => c.progress === 0)).toBe(true);
    expect(d.day).toBe('2026-09-27');
  });
});

describe('daily streak', () => {
  const bonus = (d: DailyState, day: string) => applyDailyMatch(d, KEY, match(), at(day)).filter((l) => l.label.startsWith('🔥'));

  it('grows on consecutive days, pays once a day, and resets after a missed day', () => {
    const d = emptyDaily();
    expect(bonus(d, '2026-09-01')).toEqual([{ label: '🔥 First match today', xp: 0, coins: DAILY.streakCoins }]);
    expect(d.streak).toBe(1);
    expect(bonus(d, '2026-09-01')).toEqual([]); // second match the same day
    expect(bonus(d, '2026-09-02')).toEqual([{ label: '🔥 Day 2 streak!', xp: 0, coins: 2 * DAILY.streakCoins }]);
    expect(bonus(d, '2026-09-03')[0].coins).toBe(3 * DAILY.streakCoins);
    expect(d.streak).toBe(3);
    // Skipped the 4th.
    expect(dailyView(d, KEY, at('2026-09-04')).streak).toBe(3); // still alive: play today to keep it
    expect(dailyView(d, KEY, at('2026-09-05')).streak).toBe(0);
    expect(bonus(d, '2026-09-05')).toEqual([{ label: '🔥 First match today', xp: 0, coins: DAILY.streakCoins }]);
    expect(d.streak).toBe(1);
  });

  it('caps the bonus and crosses month and year ends', () => {
    const d = emptyDaily();
    const days = ['2026-12-27', '2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03', '2027-01-04'];
    const coins = days.map((day) => bonus(d, day)[0].coins);
    expect(d.streak).toBe(9);
    expect(coins).toEqual([1, 2, 3, 4, 5, 6, 7, 7, 7].map((n) => n * DAILY.streakCoins));
    const v = dailyView(d, KEY, at('2027-01-04'));
    expect(v).toMatchObject({ streak: 9, playedToday: true });
  });
});

describe('daily challenges on the server', () => {
  const outcome = (over: Partial<MatchStats>, won = false) => ({ mode: 'knockout' as const, stats: stats(over), secondsPlayed: 240, matchSeconds: 240, won });

  it('match rewards include finished challenges and the streak bonus; idle matches count for nothing', () => {
    const s = new Store(':memory:');
    const key = guestKey('guest-daily-02');
    const now = at('2026-09-28');
    const p = s.profile(key);
    rollDaily(p.daily, key, now);
    p.daily.challenges = [
      { id: 'hits', progress: 30, done: false },
      { id: 'play', progress: 0, done: false },
      { id: 'pop', progress: 0, done: false },
    ];
    // Sitting still: no rewards, no streak, no progress.
    const idle = awardMatch(s, key, null, false, outcome({}), now);
    expect(idle.reward.lines).toEqual([]);
    expect(p.daily.streak).toBe(0);
    expect(p.daily.challenges[1].progress).toBe(0);

    const plain = awardMatch(s, key, null, false, outcome({ shots: 20, hits: 5 }), now);
    const labels = plain.reward.lines.map((l) => l.label);
    expect(labels).toContain('🔥 First match today');
    expect(labels.some((l) => l.startsWith('Daily:'))).toBe(false);

    const rep = awardMatch(s, key, null, false, outcome({ shots: 20, hits: 5 }), now + 1000);
    const done = rep.reward.lines.find((l) => l.label === 'Daily: Land 40 hits ✓')!;
    expect(done.coins).toBe(CHALLENGE_BY_ID.get('hits')!.coins);
    expect(rep.reward.lines.some((l) => l.label.startsWith('🔥'))).toBe(false);
    // The totals and the saved profile include the challenge reward.
    expect(rep.reward.coins).toBe(rep.reward.lines.reduce((a, l) => a + l.coins, 0));
    expect(rep.profile.coins).toBe(plain.reward.coins + rep.reward.coins);
    expect(rep.profile.daily.challenges.find((c) => c.id === 'hits')).toMatchObject({ progress: 40, done: true });
    expect(rep.profile.daily.challenges.find((c) => c.id === 'play')).toMatchObject({ progress: 2, done: false });
    expect(rep.profile.daily).toMatchObject({ streak: 1, playedToday: true });

    // A third match finishes "Play 3 matches"; the hits challenge doesn't pay again.
    const third = awardMatch(s, key, null, false, outcome({ shots: 20, hits: 50 }), now + 2000);
    expect(third.reward.lines.filter((l) => l.label.startsWith('Daily:')).map((l) => l.label)).toEqual(['Daily: Play 3 matches ✓']);

    // Saved: a fresh store on the same database sees the same state.
    const reloaded = JSON.parse((s.db.prepare('SELECT data FROM profiles WHERE key = ?').get(key) as { data: string }).data);
    expect(reloaded.daily.challenges[0]).toEqual({ id: 'hits', progress: 40, done: true });
    expect(reloaded.daily.streak).toBe(1);
  });

  it('challenge XP can level you up', () => {
    const s = new Store(':memory:');
    const key = guestKey('guest-daily-03');
    const now = at('2026-09-28');
    const p = s.profile(key);
    rollDaily(p.daily, key, now);
    p.daily.lastPlayedDay = '2026-09-28';
    p.daily.challenges = [
      { id: 'win', progress: 0, done: false },
      { id: 'play', progress: 2, done: false },
      { id: 'pop', progress: 7, done: false },
    ];
    p.xp = 0;
    // 60 for the match + 12 for a knockout; the challenges push it past 100.
    const rep = awardMatch(s, key, null, false, outcome({ shots: 5, kos: 1 }), now);
    expect(rep.reward.lines.filter((l) => l.label.startsWith('Daily:')).length).toBe(2);
    expect(rep.levelAfter).toBe(2);
    expect(rep.reward.lines.some((l) => l.label === 'Level 2!')).toBe(true);
  });

  it('loads profiles saved before daily challenges existed', () => {
    const s = new Store(':memory:');
    const key = guestKey('guest-old-0001');
    const old = { xp: 300, coins: 55, owned: [], cosmetics: {}, stats: { matches: 4 }, rating: 1000, rankedGames: 0, lastWinDay: '2026-01-01' };
    s.db.prepare('INSERT INTO profiles (key, data, updated_at) VALUES (?, ?, ?)').run(key, JSON.stringify(old), Date.now());
    const p = s.profile(key);
    expect(p.daily).toEqual(emptyDaily());
    expect(p.coins).toBe(55);
    const view = s.view(key, null, false, at('2026-09-28'));
    expect(view.daily.challenges.map((c) => c.id)).toEqual(pickChallenges('2026-09-28', key));
    expect(view.daily.streak).toBe(0);
    const rep = awardMatch(s, key, null, false, outcome({ shots: 10, hits: 3 }), at('2026-09-28'));
    expect(rep.profile.daily.streak).toBe(1);
    expect(rep.profile.daily.challenges.length).toBe(DAILY.count);
  });

  it('cleans up junk in a saved daily state', () => {
    expect(sanitizeDaily(null)).toEqual(emptyDaily());
    expect(sanitizeDaily({ day: '2026-09-28', streak: -3, challenges: [{ id: 'nope', progress: 3 }] })).toMatchObject({ day: '', streak: 0, challenges: [] });
    const ok = sanitizeDaily({ day: '2026-09-28', streak: 4, lastPlayedDay: '2026-09-28', challenges: pickChallenges('2026-09-28', KEY).map((id) => ({ id, progress: '2', done: 1 })) });
    expect(ok.day).toBe('2026-09-28');
    expect(ok.streak).toBe(4);
    expect(ok.challenges[0]).toMatchObject({ progress: 2, done: true });
  });
});
