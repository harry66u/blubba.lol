import { describe, expect, it } from 'vitest';
import { Store, dayKey } from '../src/server/store';

describe('players active today', () => {
  it('counts each player once per day, starts over the next day, and forgets old days', () => {
    const store = new Store(':memory:');
    const day1 = Date.UTC(2026, 8, 29, 16);
    store.markActive('g:one', day1);
    store.markActive('g:one', day1 + 1000);
    store.markActive('a:7', day1 + 2000);
    expect(store.activeToday(day1 + 3000)).toBe(2);
    const day2 = day1 + 86400_000;
    expect(dayKey(day2)).not.toBe(dayKey(day1));
    expect(store.activeToday(day2)).toBe(0);
    store.markActive('g:one', day2);
    expect(store.activeToday(day2 + 1)).toBe(1);
    // Two days later, day 1's rows are pruned.
    store.prune(day1 + 3 * 86400_000);
    expect(store.activeToday(day1 + 60_000)).toBe(0);
  });
});
