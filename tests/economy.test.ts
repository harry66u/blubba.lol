import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_COSMETICS, ITEMS, UNLOCKS, eloUpdate, levelForXp, matchReward, sanitizeCosmetics, unlockedAt } from '../src/shared/economy';
import { PART_IDS } from '../src/shared/loadout';
import { Api } from '../src/server/api';
import { awardMatch } from '../src/server/progress';
import { Store, accountKey, guestKey } from '../src/server/store';

const stats = (over: Partial<Record<string, number>> = {}) => ({
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

describe('economy rules', () => {
  it('levels up on a gentle curve', () => {
    expect(levelForXp(0).level).toBe(1);
    expect(levelForXp(99).level).toBe(1);
    expect(levelForXp(100).level).toBe(2);
    expect(levelForXp(250)).toMatchObject({ level: 3, into: 0 });
  });

  it('unlocks weapon parts and utilities by level, never weapons', () => {
    // New players get Standard everywhere plus a couple of parts to try right away.
    expect(unlockedAt(1)).toEqual({ parts: ['standard', 'stubbyBarrel', 'miniTank'], utils: ['bouncePad', 'airGrenade'] });
    expect(unlockedAt(2).parts).toContain('wideNozzle');
    // Every level up to 8 unlocks something, and by 8 everything is open.
    for (let lv = 2; lv <= 8; lv++) expect(UNLOCKS.some((u) => u.level === lv)).toBe(true);
    expect(unlockedAt(7).parts).not.toContain('kickStock');
    expect(unlockedAt(8).parts.length).toBe(PART_IDS.length);
    expect(unlockedAt(8).utils.length).toBe(4);
    expect(UNLOCKS.every((u) => (u.kind === 'part' ? (PART_IDS as readonly string[]).includes(u.id) : true))).toBe(true);
  });

  it('only lets you wear items you own', () => {
    const premium = ITEMS.find((i) => i.slot === 'hat' && i.price > 0)!;
    const free = ITEMS.find((i) => i.slot === 'color' && i.price === 0 && i.id !== DEFAULT_COSMETICS.color)!;
    expect(sanitizeCosmetics({ hat: premium.id, color: free.id }, []).hat).toBe(DEFAULT_COSMETICS.hat);
    expect(sanitizeCosmetics({ hat: premium.id, color: free.id }, []).color).toBe(free.id);
    expect(sanitizeCosmetics({ hat: premium.id }, [premium.id]).hat).toBe(premium.id);
    // Wrong slot or junk is ignored.
    expect(sanitizeCosmetics({ hat: free.id, face: 'nope' }, [])).toEqual(DEFAULT_COSMETICS);
  });

  it('rewards playing, not idling, and caps knockout farming', () => {
    const base = { secondsPlayed: 240, matchSeconds: 240, kos: 0, goals: 0, pumpSeconds: 0, hits: 0, shots: 0, won: false, firstWinToday: false };
    expect(matchReward(base).xp).toBe(0); // never fired a shot
    expect(matchReward({ ...base, shots: 5, secondsPlayed: 20 }).xp).toBe(0); // only 20 seconds
    const played = matchReward({ ...base, shots: 5 });
    expect(played.xp).toBeGreaterThan(0);
    const win = matchReward({ ...base, shots: 5, kos: 3, won: true, firstWinToday: true });
    expect(win.xp).toBeGreaterThan(played.xp);
    expect(win.coins).toBeGreaterThan(50);
    const farm = matchReward({ ...base, shots: 5, kos: 200 });
    expect(farm.xp).toBeLessThan(matchReward({ ...base, shots: 5, kos: 15 }).xp + 1);
  });

  it('Elo moves ratings toward the result', () => {
    const [w, l] = eloUpdate({ rating: 1000, games: 20 }, { rating: 1000, games: 20 });
    expect(w).toBe(1012);
    expect(l).toBe(988);
    const [upsetW] = eloUpdate({ rating: 900, games: 20 }, { rating: 1200, games: 20 });
    expect(upsetW - 900).toBeGreaterThan(18);
  });
});

describe('store', () => {
  it('creates accounts, logs in, resets with the recovery code', async () => {
    const s = new Store(':memory:');
    const made = await s.createAccount('Wobbly', 'hunter22!');
    expect(made).not.toBeNull();
    expect(await s.createAccount('wobbly', 'another-pass')).toBeNull(); // names are case-insensitive
    expect(await s.login('WOBBLY', 'hunter22!')).toMatchObject({ name: 'Wobbly' });
    expect(await s.login('Wobbly', 'wrong-pass')).toBeNull();
    const token = s.createSession(made!.account.id);
    expect(s.sessionAccount(token)?.name).toBe('Wobbly');
    const reset = await s.resetPassword('wobbly', made!.recoveryCode.toLowerCase().replace(/-/g, ''), 'new-password');
    expect(reset).not.toBeNull();
    expect(s.sessionAccount(token)).toBeNull(); // old sessions end after a reset
    expect(await s.login('Wobbly', 'new-password')).not.toBeNull();
    expect(await s.resetPassword('Wobbly', made!.recoveryCode, 'x-password')).toBeNull(); // codes are single use
  });

  it("keeps a guest's progress when they make an account", async () => {
    const s = new Store(':memory:');
    const g = s.profile(guestKey('guest-1234'));
    g.xp = 500;
    g.coins = 77;
    s.saveProfile(guestKey('guest-1234'));
    const made = await s.createAccount('Floppy', 'password1');
    s.adoptGuestProfile('guest-1234', made!.account.id);
    const p = s.profile(accountKey(made!.account.id));
    expect(p.xp).toBe(500);
    expect(p.coins).toBe(77);
    expect(s.hasProfile(guestKey('guest-1234'))).toBe(false);
  });

  it('awards XP, coins, stats and reports unlocks', () => {
    const s = new Store(':memory:');
    const key = guestKey('guest-abcdefgh');
    const rep = awardMatch(s, key, null, false, { mode: 'knockout', stats: stats({ kos: 4, shots: 30, hits: 12, longestLaunch: 21.37 }), secondsPlayed: 240, matchSeconds: 240, won: true });
    expect(rep.reward.xp).toBeGreaterThan(100);
    expect(rep.levelAfter).toBe(2);
    expect(rep.unlocked).toContain('wideNozzle');
    const p = s.profile(key);
    expect(p.stats).toMatchObject({ matches: 1, wins: 1, kos: 4, hits: 12, longestLaunch: 21.4 });
    expect(p.stats.modeWins.knockout).toBe(1);
    // Nothing for sitting still.
    const idle = awardMatch(s, key, null, false, { mode: 'knockout', stats: stats(), secondsPlayed: 240, matchSeconds: 240, won: false });
    expect(idle.reward.xp).toBe(0);
    expect(s.profile(key).stats.matches).toBe(1);
  });
});

describe('api', () => {
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

  it('registers, keeps guest progress, and gates purchases behind an account', async () => {
    const gid = 'guest-api-0001';
    store.profile(guestKey(gid)).coins = 120;
    store.saveProfile(guestKey(gid));
    const hat = ITEMS.find((i) => i.id === 'hat.party')!;

    // Guests can't buy.
    const g = await post('/api/store/buy', { itemId: hat.id }, { 'x-guest-id': gid });
    expect(g.status).toBe(401);
    expect(g.body.error).toBe('account_required');

    expect((await post('/api/account/register', { name: 'b', password: 'password1' })).status).toBe(400);
    expect((await post('/api/account/register', { name: 'sexy tube', password: 'password1' })).status).toBe(400);
    expect((await post('/api/account/register', { name: 'Balloonist', password: 'short' })).status).toBe(400);
    const reg = await post('/api/account/register', { name: 'Balloonist', password: 'password1', guestId: gid });
    expect(reg.status).toBe(200);
    expect(reg.body.recoveryCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(reg.body.profile.coins).toBe(120);
    const auth = { authorization: `Bearer ${reg.body.token}` };
    expect((await post('/api/account/register', { name: 'balloonist', password: 'password1' })).body.error).toBe('name_taken');

    const bought = await post('/api/store/buy', { itemId: hat.id }, auth);
    expect(bought.status).toBe(200);
    expect(bought.body.profile.coins).toBe(120 - hat.price);
    expect(bought.body.profile.cosmetics.hat).toBe(hat.id);
    expect((await post('/api/store/buy', { itemId: hat.id }, auth)).body.error).toBe('owned');
    expect((await post('/api/store/buy', { itemId: 'finish.galaxy' }, auth)).body.error).toBe('coins');

    // Equipping something you don't own is ignored.
    const eq = await post('/api/cosmetics', { cosmetics: { hat: 'hat.halo', face: 'face.smile' } }, auth);
    expect(eq.body.profile.cosmetics.hat).toBe('hat.spikes');

    const me = await fetch(`${base}/api/me`, { headers: auth }).then((r) => r.json());
    expect(me.account.name).toBe('Balloonist');
    const login = await post('/api/account/login', { name: 'balloonist', password: 'password1' });
    expect(login.status).toBe(200);
    expect((await post('/api/account/login', { name: 'balloonist', password: 'nope-nope' })).status).toBe(401);
  });
});
