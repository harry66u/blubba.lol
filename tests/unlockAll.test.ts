import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_COSMETICS, ITEMS, UNLOCK_ALL_COINS, ownsItem, sanitizeCosmetics, unlockLevelOf, unlockedAt } from '../src/shared/economy';
import { PART_IDS, UTILITY_IDS } from '../src/shared/loadout';
import { Store, accountKey } from '../src/server/store';

const saved = process.env.BUBBA_UNLOCK_ALL;
afterEach(() => {
  if (saved === undefined) delete process.env.BUBBA_UNLOCK_ALL;
  else process.env.BUBBA_UNLOCK_ALL = saved;
});

describe('unlock-all accounts', () => {
  it('Harry gets unlimited coins, every item and every loadout part; others and guests do not', async () => {
    delete process.env.BUBBA_UNLOCK_ALL;
    const s = new Store(':memory:');
    const harry = (await s.createAccount('harry', 'hunter22pass'))!.account;
    const bob = (await s.createAccount('Bobby', 'hunter22pass'))!.account;
    const hk = accountKey(harry.id);
    const bk = accountKey(bob.id);
    expect(s.unlocksAll(hk)).toBe(true);
    expect(s.unlocksAll(bk)).toBe(false);
    expect(s.unlocksAll('g:harry')).toBe(false);

    const view = s.view(hk, harry.name, true);
    expect(view.unlockAll).toBe(true);
    expect(view.coins).toBe(UNLOCK_ALL_COINS);
    for (const i of ITEMS) expect(ownsItem(view.owned, i.id, unlockLevelOf(view))).toBe(true);
    // Level rewards can be worn from level 1.
    const gold = sanitizeCosmetics({ ...DEFAULT_COSMETICS, base: 'base.gold' }, view.owned, unlockLevelOf(view));
    expect(gold.base).toBe('base.gold');
    expect(unlockedAt(s.unlockLevel(hk)).parts).toEqual([...PART_IDS]);
    expect(unlockedAt(s.unlockLevel(hk)).utils).toEqual([...UTILITY_IDS]);

    // Spending never runs the coins out.
    s.profile(hk).coins -= 5000;
    expect(s.profile(hk).coins).toBe(UNLOCK_ALL_COINS);

    const other = s.view(bk, bob.name, true);
    expect(other.unlockAll).toBeUndefined();
    expect(other.coins).toBe(0);
    expect(ownsItem(other.owned, 'base.gold', unlockLevelOf(other))).toBe(false);
  });

  it('BUBBA_UNLOCK_ALL picks who (and can switch it off)', async () => {
    process.env.BUBBA_UNLOCK_ALL = 'Bobby, Zed';
    const s = new Store(':memory:');
    const harry = (await s.createAccount('Harry', 'hunter22pass'))!.account;
    const bob = (await s.createAccount('bobby', 'hunter22pass'))!.account;
    expect(s.unlocksAll(accountKey(harry.id))).toBe(false);
    expect(s.unlocksAll(accountKey(bob.id))).toBe(true);
    process.env.BUBBA_UNLOCK_ALL = '';
    const off = new Store(':memory:');
    const h2 = (await off.createAccount('Harry', 'hunter22pass'))!.account;
    expect(off.unlocksAll(accountKey(h2.id))).toBe(false);
  });
});
