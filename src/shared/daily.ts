/**
 * Daily challenges and the daily play streak: a reason to come back every day. Shared so the
 * server (which is authoritative) and the menu agree on labels, targets and rewards.
 *
 * Every challenge is measured from one match's stats and builds up over the day's matches. Each
 * player gets three per UTC day, picked from (day, profile key) so reloading never rerolls them.
 */
import { MODE_INFO, type ModeId } from './game/modes';
import type { MatchStats } from './game/sim';

export const DAILY = {
  /** Challenges per day. */
  count: 3,
  /** Streak bonus on the first counted match of a day: coins × min(streak, cap). */
  streakCoins: 10,
  streakCap: 7,
};

/** What a challenge can see of a match. Only matches that earned rewards are counted. */
export interface DailyMatch {
  mode: ModeId;
  won: boolean;
  stats: MatchStats;
}

export interface ChallengeDef {
  id: string;
  /** `{n}` is replaced by the target. */
  label: string;
  target: number;
  coins: number;
  xp: number;
  /** Only matches in this mode count (the label names the mode). */
  mode?: ModeId;
  /** Keep the best single match instead of adding matches up (e.g. longest launch). */
  best?: boolean;
  /** Shown after the progress, e.g. "18/30 m". */
  unit?: string;
  measure: (m: DailyMatch) => number;
}

/**
 * The pool. A full match pays about 10-40 coins and items cost 100-450, so a challenge is worth
 * roughly one or two matches: harder or rarer ones pay more.
 */
export const CHALLENGES: ChallengeDef[] = [
  { id: 'play', label: 'Play {n} matches', target: 3, coins: 25, xp: 40, measure: () => 1 },
  { id: 'hits', label: 'Land {n} hits', target: 40, coins: 30, xp: 40, measure: (m) => m.stats.hits },
  { id: 'pop', label: 'Pop {n} players', target: 8, coins: 40, xp: 50, measure: (m) => m.stats.kos },
  { id: 'throw', label: 'Grab and throw {n} players', target: 2, coins: 35, xp: 50, measure: (m) => m.stats.throws },
  { id: 'launch', label: 'Launch someone {n} m', target: 30, coins: 40, xp: 50, best: true, unit: 'm', measure: (m) => m.stats.longestLaunch },
  { id: 'win', label: 'Win a match', target: 1, coins: 50, xp: 60, measure: (m) => (m.won ? 1 : 0) },
  { id: 'combo', label: 'Land a {n}-hit air combo', target: 3, coins: 45, xp: 60, best: true, measure: (m) => m.stats.bestCombo },
  { id: 'chain', label: 'Get a chain-reaction pop', target: 1, coins: 50, xp: 60, measure: (m) => m.stats.chainKos },
  { id: 'crown', label: 'Pop the crown holder', target: 1, coins: 45, xp: 60, measure: (m) => m.stats.crownKos },
  { id: 'goal', label: `Score a goal in ${MODE_INFO.ball.name}`, target: 1, coins: 45, xp: 60, mode: 'ball', measure: (m) => m.stats.goals },
  { id: 'pump', label: `Pump for {n} seconds in ${MODE_INFO.pump.name}`, target: 45, coins: 40, xp: 50, mode: 'pump', unit: 's', measure: (m) => m.stats.pumpTime },
  { id: 'teamWin', label: `Win a ${MODE_INFO.teamKnockout.name} match`, target: 1, coins: 50, xp: 60, mode: 'teamKnockout', measure: (m) => (m.won ? 1 : 0) },
  { id: 'duelPop', label: `Pop {n} players in ${MODE_INFO.duel.name}`, target: 5, coins: 45, xp: 60, mode: 'duel', measure: (m) => m.stats.kos },
];

export const CHALLENGE_BY_ID = new Map(CHALLENGES.map((c) => [c.id, c]));

export function challengeLabel(c: ChallengeDef): string {
  return c.label.replace('{n}', String(c.target));
}

/** Saved per profile. */
export interface DailyState {
  /** UTC day (YYYY-MM-DD) the challenges are for. */
  day: string;
  challenges: { id: string; progress: number; done: boolean }[];
  /** Consecutive UTC days with a counted match, ending on `lastPlayedDay`. */
  streak: number;
  lastPlayedDay: string;
}

export function emptyDaily(): DailyState {
  return { day: '', challenges: [], streak: 0, lastPlayedDay: '' };
}

/** Keeps whatever is usable from a saved (possibly old or hand-edited) daily state. */
export function sanitizeDaily(raw: unknown): DailyState {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<DailyState>;
  const out = emptyDaily();
  if (typeof r.day === 'string') out.day = r.day;
  if (typeof r.lastPlayedDay === 'string') out.lastPlayedDay = r.lastPlayedDay;
  if (typeof r.streak === 'number' && r.streak >= 0) out.streak = Math.floor(r.streak);
  if (Array.isArray(r.challenges)) {
    for (const c of r.challenges) {
      if (c && CHALLENGE_BY_ID.has(c.id)) out.challenges.push({ id: c.id, progress: Number(c.progress) || 0, done: !!c.done });
    }
  }
  // A pool change could leave a day with unknown challenges: pick that day again.
  if (out.challenges.length !== DAILY.count) out.day = '';
  return out;
}

// --- Days ------------------------------------------------------------------------------------------

export function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

function dayBefore(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) - 86400_000).toISOString().slice(0, 10);
}

/** Seconds until the next UTC midnight, when new challenges arrive. */
export function secondsToReset(now: number): number {
  const next = Date.parse(`${utcDay(now)}T00:00:00Z`) + 86400_000;
  return Math.max(0, Math.ceil((next - now) / 1000));
}

// --- Picking -------------------------------------------------------------------------------------

function hash(s: string): number {
  // FNV-1a: tiny and stable across platforms.
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The day's challenges for a profile: no repeats and at most one tied to a mode, so nobody is
 * pushed through three different playlists in one day.
 */
export function pickChallenges(day: string, key: string): string[] {
  const rand = mulberry32(hash(`${day}|${key}`));
  const pool = [...CHALLENGES];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const out: string[] = [];
  let modeSpecific = false;
  for (const c of pool) {
    if (c.mode) {
      if (modeSpecific) continue;
      modeSpecific = true;
    }
    out.push(c.id);
    if (out.length === DAILY.count) break;
  }
  return out;
}

/** Moves the challenges to today if the day changed (yesterday's progress is dropped). */
export function rollDaily(d: DailyState, key: string, now: number): DailyState {
  const today = utcDay(now);
  if (d.day !== today) {
    d.day = today;
    d.challenges = pickChallenges(today, key).map((id) => ({ id, progress: 0, done: false }));
  }
  return d;
}

/** The streak as it stands today: still alive if you played today or yesterday. */
function liveStreak(d: DailyState, today: string): number {
  return d.lastPlayedDay === today || d.lastPlayedDay === dayBefore(today) ? d.streak : 0;
}

export interface DailyLine {
  label: string;
  xp: number;
  coins: number;
}

/**
 * Adds a counted match to today's challenges and the streak. Returns reward lines for the
 * challenges this match finished and, on the day's first match, the streak bonus.
 */
export function applyDailyMatch(d: DailyState, key: string, m: DailyMatch, now: number): DailyLine[] {
  rollDaily(d, key, now);
  const today = utcDay(now);
  const lines: DailyLine[] = [];
  if (d.lastPlayedDay !== today) {
    d.streak = liveStreak(d, today) + 1;
    d.lastPlayedDay = today;
    const coins = DAILY.streakCoins * Math.min(d.streak, DAILY.streakCap);
    lines.push({ label: d.streak > 1 ? `🔥 Day ${d.streak} streak!` : '🔥 First match today', xp: 0, coins });
  }
  for (const c of d.challenges) {
    const def = CHALLENGE_BY_ID.get(c.id);
    if (!def || c.done || (def.mode && def.mode !== m.mode)) continue;
    const v = Math.max(0, def.measure(m));
    const next = def.best ? Math.max(c.progress, v) : c.progress + v;
    c.progress = Math.min(def.target, Math.round(next * 10) / 10);
    if (c.progress >= def.target) {
      c.done = true;
      lines.push({ label: `Daily: ${challengeLabel(def)} ✓`, xp: def.xp, coins: def.coins });
    }
  }
  return lines;
}

// --- As the client sees it -------------------------------------------------------------------------

export interface DailyChallengeView {
  id: string;
  label: string;
  progress: number;
  target: number;
  unit: string;
  done: boolean;
  coins: number;
  xp: number;
  mode: ModeId | null;
}

export interface DailyView {
  challenges: DailyChallengeView[];
  /** Days in a row (0 once a day is missed). */
  streak: number;
  /** Today already counts toward the streak. */
  playedToday: boolean;
  /** Seconds until new challenges (next UTC midnight). */
  resetsIn: number;
}

/** Today's challenges and streak without changing the saved state. */
export function dailyView(d: DailyState, key: string, now: number): DailyView {
  const today = utcDay(now);
  const current = d.day === today ? d.challenges : pickChallenges(today, key).map((id) => ({ id, progress: 0, done: false }));
  const challenges: DailyChallengeView[] = [];
  for (const c of current) {
    const def = CHALLENGE_BY_ID.get(c.id);
    if (!def) continue;
    challenges.push({ id: def.id, label: challengeLabel(def), progress: c.progress, target: def.target, unit: def.unit ?? '', done: c.done, coins: def.coins, xp: def.xp, mode: def.mode ?? null });
  }
  return { challenges, streak: liveStreak(d, today), playedToday: d.lastPlayedDay === today, resetsIn: secondsToReset(now) };
}
