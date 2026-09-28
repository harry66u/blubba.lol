import { type ProgressReport, REWARDS, UNLOCKS, eloUpdate, levelForXp, matchReward, unlockedAt } from '../shared/economy';
import { applyDailyMatch } from '../shared/daily';
import type { MatchStats } from '../shared/game/sim';
import type { ModeId } from '../shared/game/modes';
import type { ProfileData, Store } from './store';

export interface MatchOutcome {
  mode: ModeId;
  stats: MatchStats;
  secondsPlayed: number;
  matchSeconds: number;
  won: boolean;
}

function today(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** What a player can put in their loadout right now. */
export function allowedLoadout(p: ProfileData): { mods: string[]; utils: string[] } {
  return unlockedAt(levelForXp(p.xp).level);
}

/** Adds a finished match to a profile: XP, coins, lifetime stats, daily challenges, unlocks. */
export function awardMatch(store: Store, key: string, name: string | null, isAccount: boolean, o: MatchOutcome, now = Date.now()): ProgressReport {
  const p = store.profile(key);
  const before = levelForXp(p.xp).level;
  const firstWinToday = o.won && p.lastWinDay !== today(now);
  const reward = matchReward({
    secondsPlayed: o.secondsPlayed,
    matchSeconds: o.matchSeconds,
    kos: o.stats.kos,
    goals: o.stats.goals,
    pumpSeconds: o.stats.pumpTime,
    hits: o.stats.hits,
    shots: o.stats.shots,
    won: o.won,
    firstWinToday,
  });
  // Only matches you actually played (the same rule as XP) count toward the daily challenges
  // and streak. Done before the level check so challenge XP can level you up too.
  if (reward.xp > 0) {
    for (const line of applyDailyMatch(p.daily, key, o, now)) {
      reward.lines.push(line);
      reward.xp += line.xp;
      reward.coins += line.coins;
    }
  }
  p.xp += reward.xp;
  p.coins += reward.coins;
  const after = levelForXp(p.xp).level;
  if (after > before) {
    const bonus = (after - before) * REWARDS.levelUpCoins;
    p.coins += bonus;
    reward.coins += bonus;
    reward.lines.push({ label: `Level ${after}!`, xp: 0, coins: bonus });
  }
  if (reward.xp > 0) {
    // Only matches you actually played count toward lifetime stats.
    const s = p.stats;
    s.matches++;
    if (o.won) s.wins++;
    s.kos += o.stats.kos;
    s.popped += o.stats.deaths;
    s.falls += o.stats.falls;
    s.hits += o.stats.hits;
    s.chainKos += o.stats.chainKos;
    s.goals += o.stats.goals;
    s.longestLaunch = Math.max(s.longestLaunch, Math.round(o.stats.longestLaunch * 10) / 10);
    s.bestCombo = Math.max(s.bestCombo, o.stats.bestCombo);
    s.playSeconds += Math.round(o.secondsPlayed);
    s.modeMatches[o.mode] = (s.modeMatches[o.mode] ?? 0) + 1;
    if (o.won) s.modeWins[o.mode] = (s.modeWins[o.mode] ?? 0) + 1;
    if (o.won) p.lastWinDay = today(now);
  }
  store.saveProfile(key);
  const unlocked = UNLOCKS.filter((u) => u.level > before && u.level <= after).map((u) => u.id);
  return { reward, levelBefore: before, levelAfter: after, unlocked, profile: store.view(key, name, isAccount, now) };
}

/** Applies a ranked 1v1 result. Returns [winner, loser] rating changes. */
export function applyRanked(store: Store, winnerKey: string, loserKey: string): [{ before: number; after: number }, { before: number; after: number }] {
  const w = store.profile(winnerKey);
  const l = store.profile(loserKey);
  const [wr, lr] = eloUpdate({ rating: w.rating, games: w.rankedGames }, { rating: l.rating, games: l.rankedGames });
  const out: [{ before: number; after: number }, { before: number; after: number }] = [
    { before: w.rating, after: wr },
    { before: l.rating, after: lr },
  ];
  w.rating = wr;
  l.rating = lr;
  w.rankedGames++;
  l.rankedGames++;
  store.saveProfile(winnerKey);
  store.saveProfile(loserKey);
  return out;
}
