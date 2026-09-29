import { describe, expect, it } from 'vitest';
import { MAPS } from '../src/shared/maps';
import { brandLayout } from '../src/client/render/branding';
import { edgeDistance } from '../src/client/render/sceneryKit';

describe('map branding placement', () => {
  for (const map of Object.values(MAPS)) {
    it(`${map.id}: signs and billboards stand past the blast zone, the big sign where spawns look`, () => {
      const L = brandLayout(map);
      const b = map.blast;
      for (const a of [L.sign, L.sign2, ...L.boards]) {
        const d = edgeDistance(b, a, 16);
        const x = Math.cos(a) * d;
        const z = Math.sin(a) * d;
        // Outside the blast zone's footprint: nobody alive can reach them.
        expect(x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ).toBe(true);
      }
      expect(L.deck).toBeGreaterThanOrEqual(0);
      // Most spawns face the big sign when they appear (they face the average spawn point).
      const n = map.spawns.length;
      const hx = map.spawns.reduce((a, s) => a + s[0], 0) / n;
      const hz = map.spawns.reduce((a, s) => a + s[2], 0) / n;
      const d = edgeDistance(b, L.sign, 22);
      const [px, pz] = [Math.cos(L.sign) * d, Math.sin(L.sign) * d];
      const facing = map.spawns.filter((s) => Math.hypot(hx - s[0], hz - s[2]) > 2);
      const seeing = facing.filter((s) => {
        const [fx, fz, tx, tz] = [hx - s[0], hz - s[2], px - s[0], pz - s[2]];
        return (fx * tx + fz * tz) / (Math.hypot(fx, fz) * Math.hypot(tx, tz)) > Math.cos((38 * Math.PI) / 180);
      });
      expect(seeing.length).toBeGreaterThanOrEqual(Math.min(2, facing.length));
    });
  }
});
