/**
 * Progression and cosmetics: levels, unlocks, coins, the store catalog, and ranked ratings.
 * Shared so the server (which is authoritative) and the client UI agree on every number.
 *
 * Rules from the spec: mods and utilities unlock by playing, never by paying; the store sells
 * cosmetics only, at listed prices, with no random rewards; purchases need an account.
 */
import type { DailyView } from './daily';
import { MOD_IDS, type ModId, UTILITY_IDS, type UtilityId } from './loadout';

// --- Cosmetics -------------------------------------------------------------------------------

export const COSMETIC_SLOTS = ['color', 'pattern', 'face', 'hat', 'finish', 'taunt', 'koFx', 'sound'] as const;
export type CosmeticSlot = (typeof COSMETIC_SLOTS)[number];

export const SLOT_INFO: Record<CosmeticSlot, { name: string; plural: string }> = {
  color: { name: 'Color', plural: 'Colors' },
  pattern: { name: 'Pattern', plural: 'Patterns' },
  face: { name: 'Face', plural: 'Faces' },
  hat: { name: 'Hat', plural: 'Hats' },
  finish: { name: 'Weapon finish', plural: 'Weapon finishes' },
  taunt: { name: 'Taunt', plural: 'Taunts' },
  koFx: { name: 'Knockout effect', plural: 'Knockout effects' },
  sound: { name: 'Sound pack', plural: 'Sound packs' },
};

export interface CosmeticItem {
  /** `${slot}.${key}` */
  id: string;
  slot: CosmeticSlot;
  /** Renderer key (pattern name, hat name, color index as a string, ...). */
  key: string;
  name: string;
  /** Coins. 0 = everyone owns it. */
  price: number;
  blurb?: string;
}

function items(slot: CosmeticSlot, list: [key: string, name: string, price: number, blurb?: string][]): CosmeticItem[] {
  return list.map(([key, name, price, blurb]) => ({ id: `${slot}.${key}`, slot, key, name, price, blurb }));
}

/** Everything in the store. Prices are fixed and shown up front. */
export const ITEMS: CosmeticItem[] = [
  // Color keys are indexes into PLAYER_COLORS. The first ten are free.
  ...items('color', [
    ['0', 'Cherry', 0],
    ['1', 'Tangerine', 0],
    ['2', 'Banana', 0],
    ['3', 'Lime', 0],
    ['4', 'Mint', 0],
    ['5', 'Sky', 0],
    ['6', 'Blueberry', 0],
    ['7', 'Grape', 0],
    ['8', 'Bubblegum', 0],
    ['9', 'Coral', 0],
    ['10', 'Snow', 150, 'Bright white vinyl.'],
    ['11', 'Licorice', 150, 'Dark and glossy.'],
  ]),
  ...items('pattern', [
    ['solid', 'Solid', 0],
    ['stripes', 'Stripes', 0],
    ['dots', 'Polka Dots', 100],
    ['zigzag', 'Zigzag', 150],
    ['stars', 'Stars', 200],
    ['checker', 'Checkers', 200],
  ]),
  ...items('face', [
    ['smile', 'Smile', 0],
    ['grin', 'Big Grin', 100, 'All teeth, all the time.'],
    ['sleepy', 'Sleepy', 120, 'Too tired to dodge.'],
    ['angry', 'Grumpy', 150, 'Serious eyebrows.'],
    ['derp', 'Derp', 150, 'One eye does its own thing.'],
    ['cyclops', 'Cyclops', 200, 'One big eye.'],
    ['shades', 'Shades', 250, 'Too cool to deflate.'],
  ]),
  ...items('hat', [
    ['spikes', 'Tufts', 0, 'The classic air-dancer hair.'],
    ['party', 'Party Hat', 120],
    ['cap', 'Ball Cap', 150],
    ['beanie', 'Beanie', 150, 'With a pom-pom.'],
    ['cone', 'Traffic Cone', 200],
    ['chef', 'Chef Hat', 200],
    ['propeller', 'Propeller Cap', 250, 'Spins faster when you fly.'],
    ['tophat', 'Top Hat', 250],
    ['viking', 'Horned Helmet', 300],
    ['halo', 'Halo', 350],
  ]),
  ...items('finish', [
    ['team', 'Matching', 0, 'Same color as you.'],
    ['bubblegum', 'Bubblegum', 150],
    ['candy', 'Candy Stripe', 250],
    ['chrome', 'Chrome', 300],
    ['neon', 'Neon', 300, 'Glows in the dark.'],
    ['gold', 'Gold', 400],
    ['galaxy', 'Galaxy', 450],
  ]),
  ...items('taunt', [
    ['burp', 'Big Burp', 0],
    ['wave', 'Wave', 100, 'Hi!'],
    ['spin', 'Spin', 150, 'Twirl like nobody is watching.'],
    ['noodle', 'Noodle', 150, 'Go completely floppy.'],
    ['flex', 'Flex', 200, 'Puff up, then deflate.'],
  ]),
  ...items('koFx', [
    ['confetti', 'Confetti', 0],
    ['bubbles', 'Bubbles', 200],
    ['stars', 'Star Burst', 200],
    ['balloons', 'Balloon Release', 250],
    ['fireworks', 'Fireworks', 300],
    ['rainbow', 'Rainbow', 400],
  ]),
  ...items('sound', [
    ['classic', 'Classic', 0, 'Pop and burp.'],
    ['boing', 'Boing', 150],
    ['kazoo', 'Kazoo', 200],
    ['duck', 'Rubber Duck', 200],
    ['slide', 'Slide Whistle', 200],
    ['trumpet', 'Trumpet', 250],
  ]),
];

export const ITEM_BY_ID = new Map(ITEMS.map((i) => [i.id, i]));

export type Cosmetics = Record<CosmeticSlot, string>;

export const DEFAULT_COSMETICS: Cosmetics = {
  color: 'color.0',
  pattern: 'pattern.solid',
  face: 'face.smile',
  hat: 'hat.spikes',
  finish: 'finish.team',
  taunt: 'taunt.burp',
  koFx: 'koFx.confetti',
  sound: 'sound.classic',
};

/** The renderer key for a slot (e.g. 'shades' for face.shades). */
export function cosmeticKey(c: Partial<Cosmetics> | undefined, slot: CosmeticSlot): string {
  const item = ITEM_BY_ID.get(c?.[slot] ?? '');
  return item && item.slot === slot ? item.key : ITEM_BY_ID.get(DEFAULT_COSMETICS[slot])!.key;
}

export function ownsItem(owned: Iterable<string>, id: string): boolean {
  const item = ITEM_BY_ID.get(id);
  if (!item) return false;
  if (item.price === 0) return true;
  for (const o of owned) if (o === id) return true;
  return false;
}

/** Keeps only real items the player owns, in the right slots; anything else falls back to the default. */
export function sanitizeCosmetics(raw: unknown, owned: Iterable<string>): Cosmetics {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const ownedList = [...owned];
  const out = { ...DEFAULT_COSMETICS };
  for (const slot of COSMETIC_SLOTS) {
    const id = r[slot];
    if (typeof id !== 'string') continue;
    const item = ITEM_BY_ID.get(id);
    if (item && item.slot === slot && ownsItem(ownedList, id)) out[slot] = id;
  }
  return out;
}

// --- Levels and unlocks ------------------------------------------------------------------------

/** XP needed to go from `level` to `level + 1`. */
export function xpToNext(level: number): number {
  return 100 + 50 * (level - 1);
}

export function levelForXp(xp: number): { level: number; into: number; next: number } {
  let level = 1;
  let rest = Math.max(0, Math.floor(xp));
  while (rest >= xpToNext(level) && level < 99) {
    rest -= xpToNext(level);
    level++;
  }
  return { level, into: rest, next: xpToNext(level) };
}

/** Mods and utilities unlock by level. Weapons are all available from the start. */
export const UNLOCKS: { level: number; kind: 'mod' | 'utility'; id: ModId | UtilityId }[] = [
  { level: 1, kind: 'utility', id: 'bouncePad' },
  { level: 1, kind: 'utility', id: 'airGrenade' },
  { level: 2, kind: 'mod', id: 'wideNozzle' },
  { level: 3, kind: 'utility', id: 'inflatableWall' },
  { level: 4, kind: 'mod', id: 'quickValve' },
  { level: 5, kind: 'utility', id: 'vacuumGrenade' },
  { level: 6, kind: 'mod', id: 'bigTank' },
  { level: 7, kind: 'mod', id: 'chargeValve' },
  { level: 8, kind: 'mod', id: 'longBarrel' },
  { level: 9, kind: 'utility', id: 'airMine' },
  { level: 10, kind: 'utility', id: 'heliumBomb' },
  { level: 12, kind: 'utility', id: 'tornado' },
];

export function unlockLevel(id: string): number {
  return UNLOCKS.find((u) => u.id === id)?.level ?? 1;
}

export function unlockedAt(level: number): { mods: ModId[]; utils: UtilityId[] } {
  return {
    mods: MOD_IDS.filter((m) => unlockLevel(m) <= level),
    utils: UTILITY_IDS.filter((u) => unlockLevel(u) <= level),
  };
}

// --- Match rewards -----------------------------------------------------------------------------

export const REWARDS = {
  /** A full match; players who joined late get a share by time played. */
  matchXp: 60,
  koXp: 12,
  goalXp: 25,
  /** Per second standing on your own pump while it fills. */
  pumpXpPerSec: 0.5,
  winXp: 40,
  matchCoins: 10,
  koCoins: 3,
  goalCoins: 5,
  winCoins: 10,
  /** First win each day (UTC). */
  dailyWinCoins: 50,
  levelUpCoins: 50,
  /** Caps so nothing is farmable by grinding one thing. */
  maxKoReward: 15,
  /** Must be in the match at least this long and have done something to earn anything. */
  minSeconds: 45,
};

export interface MatchReward {
  xp: number;
  coins: number;
  /** Lines for the results screen, e.g. "Knockouts x3 +36 XP". */
  lines: { label: string; xp: number; coins: number }[];
}

export interface RewardInput {
  secondsPlayed: number;
  matchSeconds: number;
  kos: number;
  goals: number;
  pumpSeconds: number;
  hits: number;
  shots: number;
  won: boolean;
  firstWinToday: boolean;
  /**
   * Sudden Death rounds can end well inside the minimum time; being there from the first second
   * to the last (and doing something) still counts.
   */
  wholeMatch?: boolean;
}

export function matchReward(r: RewardInput): MatchReward {
  const lines: MatchReward['lines'] = [];
  const active = (r.secondsPlayed >= REWARDS.minSeconds || !!r.wholeMatch) && (r.shots > 0 || r.hits > 0 || r.kos > 0 || r.goals > 0 || r.pumpSeconds > 0);
  if (!active) return { xp: 0, coins: 0, lines: [] };
  const share = Math.max(0.25, Math.min(1, r.secondsPlayed / Math.max(1, r.matchSeconds)));
  lines.push({ label: 'Played the match', xp: Math.round(REWARDS.matchXp * share), coins: Math.round(REWARDS.matchCoins * share) });
  const kos = Math.min(REWARDS.maxKoReward, r.kos);
  if (kos > 0) lines.push({ label: `Knockouts x${r.kos}`, xp: kos * REWARDS.koXp, coins: kos * REWARDS.koCoins });
  if (r.goals > 0) lines.push({ label: `Goals x${r.goals}`, xp: r.goals * REWARDS.goalXp, coins: r.goals * REWARDS.goalCoins });
  if (r.pumpSeconds >= 5) lines.push({ label: `Pumping ${Math.round(r.pumpSeconds)}s`, xp: Math.round(r.pumpSeconds * REWARDS.pumpXpPerSec), coins: 0 });
  if (r.won) lines.push({ label: 'Win', xp: REWARDS.winXp, coins: REWARDS.winCoins });
  if (r.won && r.firstWinToday) lines.push({ label: 'First win today', xp: 0, coins: REWARDS.dailyWinCoins });
  return { xp: lines.reduce((a, l) => a + l.xp, 0), coins: lines.reduce((a, l) => a + l.coins, 0), lines };
}

// --- Lifetime stats ----------------------------------------------------------------------------

export interface LifetimeStats {
  matches: number;
  wins: number;
  kos: number;
  popped: number;
  falls: number;
  hits: number;
  chainKos: number;
  goals: number;
  longestLaunch: number;
  bestCombo: number;
  playSeconds: number;
  modeMatches: Record<string, number>;
  modeWins: Record<string, number>;
}

export function emptyStats(): LifetimeStats {
  return { matches: 0, wins: 0, kos: 0, popped: 0, falls: 0, hits: 0, chainKos: 0, goals: 0, longestLaunch: 0, bestCombo: 0, playSeconds: 0, modeMatches: {}, modeWins: {} };
}

// --- Ranked ------------------------------------------------------------------------------------

export const RANKED = {
  start: 1000,
  /** Bigger swings while your rating is still settling. */
  kNew: 40,
  k: 24,
  provisionalGames: 10,
  /** Matchmaking: accept opponents within this rating gap, widening while you wait. */
  baseWindow: 100,
  windowPerSec: 15,
  /** After this long, anyone will do (there may be few people online). */
  anyoneAfterSec: 45,
};

export const TIERS: { min: number; name: string; color: string }[] = [
  { min: -Infinity, name: 'Deflated', color: '#9aa3b8' },
  { min: 900, name: 'Puff', color: '#8ee000' },
  { min: 1050, name: 'Breeze', color: '#2ec5ff' },
  { min: 1200, name: 'Gust', color: '#9b4dff' },
  { min: 1350, name: 'Gale', color: '#ff8a1f' },
  { min: 1500, name: 'Hurricane', color: '#ff3b5c' },
];

export function tierFor(rating: number): { name: string; color: string } {
  let t = TIERS[0];
  for (const x of TIERS) if (rating >= x.min) t = x;
  return t;
}

/** Elo update for a 1v1. Returns the new ratings. */
export function eloUpdate(winner: { rating: number; games: number }, loser: { rating: number; games: number }): [number, number] {
  const expW = 1 / (1 + 10 ** ((loser.rating - winner.rating) / 400));
  const kW = winner.games < RANKED.provisionalGames ? RANKED.kNew : RANKED.k;
  const kL = loser.games < RANKED.provisionalGames ? RANKED.kNew : RANKED.k;
  return [Math.round(winner.rating + kW * (1 - expW)), Math.round(loser.rating - kL * (1 - expW))];
}

// --- Profile as the client sees it ---------------------------------------------------------------

export interface ProfileView {
  name: string | null;
  isAccount: boolean;
  level: number;
  xp: number;
  xpInto: number;
  xpNext: number;
  coins: number;
  owned: string[];
  cosmetics: Cosmetics;
  stats: LifetimeStats;
  rating: number | null;
  rankedGames: number;
  daily: DailyView;
}

/** Sent after each match. */
export interface ProgressReport {
  reward: MatchReward;
  levelBefore: number;
  levelAfter: number;
  unlocked: string[];
  profile: ProfileView;
  rating?: { before: number; after: number };
}

// --- Quick chat --------------------------------------------------------------------------------

/** The only way to talk: fixed, friendly presets. No free text. */
export const QUICK_CHAT = ['Nice shot!', 'Good game!', 'Watch out!', 'Help!', "Let's go!", 'Oops!', 'Thanks!', 'Rematch?'] as const;

export const REPORT_REASONS = ['name', 'face', 'cheating', 'mean', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
export const REPORT_REASON_TEXT: Record<ReportReason, string> = {
  name: 'Bad name',
  face: 'Bad face picture',
  cheating: 'Cheating',
  mean: 'Being mean / griefing',
  other: 'Something else',
};
