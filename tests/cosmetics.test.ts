import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PLAYER_COLORS } from '../src/shared/colors';
import {
  COSMETIC_SLOTS,
  DEFAULT_COSMETICS,
  ITEMS,
  ITEM_BY_ID,
  cosmeticKey,
  cosmeticsUnlockedBetween,
  levelForXp,
  ownsItem,
  sanitizeCosmetics,
  xpToNext,
} from '../src/shared/economy';
import { GameSim } from '../src/shared/game/sim';
import { DEALERSHIP } from '../src/shared/maps/dealership';
import { Api } from '../src/server/api';
import { awardMatch } from '../src/server/progress';
import { Store, accountKey, guestKey } from '../src/server/store';
import { BASE_KEYS, EYE_KEYS, FACE_KEYS, FINISH_KEYS, HAT_KEYS } from '../src/client/render/looks';

/** Total XP to reach `level` from nothing. */
const xpFor = (level: number) => Array.from({ length: level - 1 }, (_, i) => xpToNext(i + 1)).reduce((a, b) => a + b, 0);
const rewards = ITEMS.filter((i) => i.levelReq);

describe('cosmetics catalog', () => {
  it('has a free default in every slot, including the new ones', () => {
    expect(COSMETIC_SLOTS).toEqual(expect.arrayContaining(['accent', 'eyes', 'trail', 'base']));
    for (const slot of COSMETIC_SLOTS) {
      const def = ITEM_BY_ID.get(DEFAULT_COSMETICS[slot]);
      expect(def?.slot).toBe(slot);
      expect(def?.price).toBe(0);
      expect(def?.levelReq).toBeUndefined();
    }
    expect(cosmeticKey(DEFAULT_COSMETICS, 'accent')).toBe('match');
    expect(cosmeticKey(DEFAULT_COSMETICS, 'trail')).toBe('none');
  });

  it('uses fixed prices in range, unique ids, and some new free choices', () => {
    expect(new Set(ITEMS.map((i) => i.id)).size).toBe(ITEMS.length);
    for (const i of ITEMS) {
      expect(i.id).toBe(`${i.slot}.${i.key}`);
      expect(i.price === 0 || (i.price >= 100 && i.price <= 600)).toBe(true);
    }
    for (const slot of ['accent', 'pattern', 'face', 'eyes', 'hat', 'base', 'trail'] as const) {
      expect(ITEMS.filter((i) => i.slot === slot && i.price === 0 && !i.levelReq).length).toBeGreaterThanOrEqual(2);
    }
  });

  it('only uses real palette colors for colors and accents', () => {
    for (const i of ITEMS.filter((x) => x.slot === 'color' || (x.slot === 'accent' && x.key !== 'match'))) {
      expect(PLAYER_COLORS[Number(i.key)], i.id).toBeDefined();
    }
  });

  it('has a renderer for every look item', () => {
    const drawn: Record<string, readonly string[]> = { hat: HAT_KEYS, face: FACE_KEYS, eyes: EYE_KEYS, base: BASE_KEYS, finish: FINISH_KEYS };
    for (const [slot, keys] of Object.entries(drawn)) {
      for (const i of ITEMS.filter((x) => x.slot === slot)) expect(keys, i.id).toContain(i.key);
    }
  });

  it('never sells level rewards', () => {
    expect(rewards.length).toBeGreaterThanOrEqual(3);
    for (const r of rewards) expect(r.price).toBe(0);
  });
});

describe('sanitizing cosmetics', () => {
  it('fills slots missing from profiles saved before they existed', () => {
    const old = { color: 'color.5', pattern: 'pattern.stripes', face: 'face.smile', hat: 'hat.spikes', finish: 'finish.team', taunt: 'taunt.burp', koFx: 'koFx.confetti', sound: 'sound.classic' };
    const out = sanitizeCosmetics(old, []);
    expect(out.color).toBe('color.5');
    expect(out.pattern).toBe('pattern.stripes');
    expect(out.accent).toBe(DEFAULT_COSMETICS.accent);
    expect(out.eyes).toBe(DEFAULT_COSMETICS.eyes);
    expect(out.base).toBe(DEFAULT_COSMETICS.base);
    expect(out.trail).toBe(DEFAULT_COSMETICS.trail);
    expect(sanitizeCosmetics(null, [])).toEqual(DEFAULT_COSMETICS);
  });

  it('keeps free and owned new items, drops unowned ones and junk', () => {
    const free = { accent: 'accent.3', eyes: 'eyes.dot', base: 'base.tire', trail: 'trail.bubbles' };
    expect(sanitizeCosmetics(free, [])).toMatchObject(free);
    const paid = { trail: 'trail.rainbow', base: 'base.rocket', accent: 'accent.14' };
    expect(sanitizeCosmetics(paid, [])).toMatchObject({ trail: 'trail.none', base: 'base.classic', accent: 'accent.match' });
    expect(sanitizeCosmetics(paid, Object.values(paid))).toMatchObject(paid);
    // Right item, wrong slot.
    expect(sanitizeCosmetics({ accent: 'color.3', trail: 'koFx.hearts' }, ['koFx.hearts'])).toMatchObject({ accent: 'accent.match', trail: 'trail.none' });
  });
});

describe('level rewards', () => {
  const pedestal = ITEM_BY_ID.get('base.gold')!;

  it('are owned from their level, never before, whatever you own', () => {
    expect(pedestal.levelReq).toBe(10);
    expect(ownsItem([], pedestal.id, 9)).toBe(false);
    expect(ownsItem([pedestal.id], pedestal.id, 9)).toBe(false);
    expect(ownsItem([], pedestal.id, 10)).toBe(true);
    expect(ownsItem([], pedestal.id, 30)).toBe(true);
    // Without a level, no rewards.
    expect(ownsItem([], pedestal.id)).toBe(false);
    expect(sanitizeCosmetics({ base: pedestal.id }, [], 9).base).toBe('base.classic');
    expect(sanitizeCosmetics({ base: pedestal.id }, [], 10).base).toBe(pedestal.id);
  });

  it('are listed when you level past them', () => {
    expect(cosmeticsUnlockedBetween(1, 3).map((i) => i.id)).toContain('trail.comet');
    expect(cosmeticsUnlockedBetween(3, 9).map((i) => i.id)).not.toContain('trail.comet');
    expect(cosmeticsUnlockedBetween(9, 10).map((i) => i.id)).toEqual(['base.gold']);
  });

  it('show up in the match report when you reach the level', () => {
    const s = new Store(':memory:');
    const key = guestKey('guest-levelup-1');
    s.profile(key).xp = xpFor(3) - 20;
    const rep = awardMatch(s, key, null, false, { mode: 'knockout', stats: { kos: 2, deaths: 0, falls: 0, hits: 6, shots: 20, longestLaunch: 0, chainKos: 0, timesPopped: 0, bestCombo: 0, throws: 0, stomps: 0, goals: 0, pumpTime: 0, crownKos: 0 }, secondsPlayed: 240, matchSeconds: 240, won: false });
    expect(rep.levelAfter).toBeGreaterThanOrEqual(3);
    expect(rep.unlocked).toContain('trail.comet');
  });

  it('survive a reload only while your level allows them', () => {
    const s = new Store(':memory:');
    const hi = guestKey('guest-hi-level');
    const lo = guestKey('guest-lo-level');
    const cos = { ...DEFAULT_COSMETICS, base: 'base.gold', hat: 'hat.laurel' };
    const row = (xp: number) => JSON.stringify({ xp, coins: 0, owned: [], cosmetics: cos, stats: {}, rating: 1000, rankedGames: 0, lastWinDay: '' });
    s.db.prepare('INSERT INTO profiles (key, data, updated_at) VALUES (?, ?, ?)').run(hi, row(xpFor(10)), Date.now());
    s.db.prepare('INSERT INTO profiles (key, data, updated_at) VALUES (?, ?, ?)').run(lo, row(xpFor(6)), Date.now());
    expect(levelForXp(xpFor(10)).level).toBe(10);
    expect(s.profile(hi).cosmetics).toMatchObject({ base: 'base.gold', hat: 'hat.laurel' });
    expect(s.profile(lo).cosmetics).toMatchObject({ base: 'base.classic', hat: 'hat.laurel' });
  });

  it('loads an old saved profile with no new slots', () => {
    const s = new Store(':memory:');
    const key = guestKey('guest-pre-skins');
    const old = { xp: 50, coins: 5, owned: ['hat.party', 'face.grin'], cosmetics: { color: 'color.2', hat: 'hat.party', face: 'face.grin' }, stats: {}, rating: 1000, rankedGames: 0, lastWinDay: '' };
    s.db.prepare('INSERT INTO profiles (key, data, updated_at) VALUES (?, ?, ?)').run(key, JSON.stringify(old), Date.now());
    const view = s.view(key, null, false);
    expect(view.cosmetics).toEqual({ ...DEFAULT_COSMETICS, color: 'color.2', hat: 'hat.party', face: 'face.grin' });
  });

  it("aren't worn by bots", () => {
    const sim = new GameSim({ map: DEALERSHIP });
    for (let i = 0; i < 40; i++) {
      const bot = sim.addBot();
      for (const id of Object.values(bot.cos)) expect(ITEM_BY_ID.get(id)?.levelReq, id).toBeUndefined();
      sim.removePlayer(bot.id);
    }
  });
});

describe('store api with level rewards', () => {
  const store = new Store(':memory:');
  const api = new Api(store);
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    void api.handle(req, res, path);
  });
  let base = '';
  beforeAll(async () => {
    await new Promise<void>((r) => server.listen(0, r));
    base = `http://localhost:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server.close());

  const post = async (path: string, body: unknown, headers: Record<string, string> = {}) => {
    const r = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    return { status: r.status, body: (await r.json()) as Record<string, any> };
  };

  it("can't buy a level reward, can wear it once you reach the level, and buys new slots", async () => {
    const reg = await post('/api/account/register', { name: 'Skinny', password: 'password1' });
    expect(reg.status).toBe(200);
    const auth = { authorization: `Bearer ${reg.body.token}` };
    const key = accountKey(store.accountByName('Skinny')!.id);
    store.profile(key).coins = 5000;

    const buyReward = await post('/api/store/buy', { itemId: 'hat.laurel' }, auth);
    expect(buyReward.status).toBe(409);
    expect(buyReward.body.error).toBe('level_reward');
    expect(store.profile(key).coins).toBe(5000);

    // Level 1: wearing it is ignored.
    expect((await post('/api/cosmetics', { cosmetics: { ...DEFAULT_COSMETICS, hat: 'hat.laurel' } }, auth)).body.profile.cosmetics.hat).toBe('hat.spikes');
    // Level 6: it's yours.
    store.profile(key).xp = xpFor(6);
    expect((await post('/api/cosmetics', { cosmetics: { ...DEFAULT_COSMETICS, hat: 'hat.laurel' } }, auth)).body.profile.cosmetics.hat).toBe('hat.laurel');

    // New slots are bought and worn like any other.
    const trail = await post('/api/store/buy', { itemId: 'trail.rainbow' }, auth);
    expect(trail.status).toBe(200);
    expect(trail.body.profile.cosmetics).toMatchObject({ trail: 'trail.rainbow', hat: 'hat.laurel' });
    expect(trail.body.profile.coins).toBe(5000 - ITEM_BY_ID.get('trail.rainbow')!.price);
  });
});
