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

  it('the body types really are different shapes, and stay sensible', () => {
    // Profiles change the radius up the body; sections change the shape around it.
    expect(BODY_SHAPES.blocky.section!(Math.PI / 4)).toBeGreaterThan(1.1);
    expect(BODY_SHAPES.blocky.section!(0)).toBeCloseTo(1, 5);
    expect(BODY_SHAPES.star.section!(0)).toBeGreaterThan(BODY_SHAPES.star.section!(Math.PI / 5));
    const snow = BODY_SHAPES.snowman.profile!;
    expect(snow(0.24)).toBeGreaterThan(snow(0.5));
    expect(BODY_SHAPES.pear.profile!(0.1)).toBeGreaterThan(BODY_SHAPES.pear.profile!(0.9));
    for (const [key, sh] of Object.entries(BODY_SHAPES)) {
      for (let v = 0; v <= 1; v += 0.05) {
        const r = sh.profile ? sh.profile(v) : 1;
        expect(r, `${key} profile at ${v}`).toBeGreaterThan(0.3);
        expect(r, `${key} profile at ${v}`).toBeLessThan(2.5);
      }
      for (let a = 0; a < Math.PI * 2; a += 0.2) {
        const s = sh.section ? sh.section(a) : 1;
        expect(s, `${key} section`).toBeGreaterThan(0.6);
        expect(s, `${key} section`).toBeLessThan(1.5);
      }
    }
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
