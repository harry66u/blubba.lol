import { describe, expect, it } from 'vitest';
import { BODY_SHAPES, buildProps, hasOutfit } from '../src/client/render/characters';
import { lookFromCosmetics } from '../src/client/render/tubeMan';
import { DEFAULT_COSMETICS, ITEMS, sanitizeCosmetics } from '../src/shared/economy';

describe('bodies and characters', () => {
  const bodies = ITEMS.filter((i) => i.slot === 'body');

  it('every body in the store has a shape, and the four characters are free to wear', () => {
    for (const b of bodies) expect(BODY_SHAPES[b.key], b.key).toBeTruthy();
    for (const key of ['bor', 'abag', 'sol', 'kesty']) {
      expect(bodies.find((b) => b.key === key)?.price).toBe(0);
      expect(sanitizeCosmetics({ body: `body.${key}` }, []).body).toBe(`body.${key}`);
    }
    expect(DEFAULT_COSMETICS.body).toBe('body.classic');
    // Bought bodies need owning; old saves without a body get the classic one.
    expect(sanitizeCosmetics({ body: 'body.noodle' }, []).body).toBe('body.classic');
    expect(sanitizeCosmetics({ body: 'body.noodle' }, ['body.noodle']).body).toBe('body.noodle');
    expect(sanitizeCosmetics({}, []).body).toBe('body.classic');
    expect(lookFromCosmetics({ body: 'body.kesty' }, 0).body).toBe('kesty');
  });

  it('characters come with their outfits and props', () => {
    expect(hasOutfit('bor') && hasOutfit('sol') && hasOutfit('kesty')).toBe(true);
    expect(hasOutfit('abag') || hasOutfit('classic')).toBe(false);
    expect(buildProps('bor', 0xff0000)?.hand).toBeTruthy();
    expect(buildProps('abag', 0xff0000)?.face).toBeTruthy();
    const kesty = buildProps('kesty', 0xff0000)!;
    expect(kesty.coversEyes).toBe(true);
    expect(kesty.faceCartoonOnly).toBeTruthy();
    expect(buildProps('classic', 0xff0000)).toBeNull();
  });
});
