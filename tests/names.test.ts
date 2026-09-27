import { describe, expect, it } from 'vitest';
import { checkName, isNameBlocked, randomGuestName } from '../src/shared/names';

describe('username filter', () => {
  it('blocks profanity, slurs and sexual terms including disguised spellings', () => {
    for (const bad of ['fuck', 'FuCkBoy', 'f.u.c.k', 'sh1t', 'b1tch', 'pr0n', 'S3XY', 'nudes', 'x x x', 'boobs', 'retard', 'n1gga', 'kys', 'd1ck', 'a$$', 'Ass', 'butt', 'fatass', 'shiiiit', 'admin']) {
      expect(isNameBlocked(bad), bad).toBe(true);
    }
  });

  it('allows ordinary names, even ones containing blocked letters', () => {
    for (const good of ['Classy', 'Grasshopper', 'Peacock', 'Raccoon', 'Savage', 'Pineapple', 'Butterfly', 'Shoe Lover', 'Dickens', 'Glasses', 'Moonpie', 'Michelle', 'Molly', 'Sharpshooter', 'Cucumber']) {
      expect(isNameBlocked(good), good).toBe(false);
    }
  });

  it('enforces length and character rules', () => {
    expect(checkName('ab').ok).toBe(false);
    expect(checkName('a'.repeat(17)).ok).toBe(false);
    expect(checkName('1234').ok).toBe(false);
    expect(checkName('  Tube  Man  ').name).toBe('Tube Man');
    expect(checkName('Tube<script>').name).toBe('Tubescript');
  });

  it('generates guest names that pass the filter', () => {
    for (let i = 0; i < 200; i++) {
      const n = randomGuestName();
      expect(checkName(n).ok, n).toBe(true);
    }
  });
});
