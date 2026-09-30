import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { FlexTube } from '../src/client/render/flexTube';

describe('flex tube normals', () => {
  it('match three.js computeVertexNormals exactly (just faster)', () => {
    let seed = 3;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    for (const section of [null, (a: number) => 1 + 0.3 * Math.cos(2 * a)]) {
      const tube = new FlexTube(14, 12, new THREE.MeshBasicMaterial());
      tube.setSection(section);
      for (let frame = 0; frame < 5; frame++) {
        for (let i = 0; i < tube.rings; i++) {
          tube.spine[i * 3] = rnd() * 0.3;
          tube.spine[i * 3 + 1] = i * 0.2 + rnd() * 0.05;
          tube.spine[i * 3 + 2] = rnd() * 0.3;
          tube.radii[i] = 0.2 + rnd() * 0.05;
        }
        tube.update(0, 0, 1);
        const fast = Float32Array.from(tube.geometry.getAttribute('normal').array as Float32Array);
        tube.geometry.computeVertexNormals();
        const reference = tube.geometry.getAttribute('normal').array as Float32Array;
        expect(fast).toEqual(reference);
      }
    }
  });

  it('keeps a bounding sphere around every vertex as it flexes (so it can be culled off screen)', () => {
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    for (const section of [null, (a: number) => 1 + 0.4 * Math.sin(3 * a)]) {
      const tube = new FlexTube(12, 10, new THREE.MeshBasicMaterial());
      tube.setSection(section);
      expect(tube.mesh.frustumCulled).toBe(true);
      for (let frame = 0; frame < 20; frame++) {
        for (let i = 0; i < tube.rings; i++) {
          tube.spine[i * 3] = rnd() * 2;
          tube.spine[i * 3 + 1] = i * 0.3 + rnd();
          tube.spine[i * 3 + 2] = rnd() * 2;
          tube.radii[i] = 0.1 + Math.abs(rnd()) * 0.4;
        }
        tube.update(0, 0, 1);
        const sphere = tube.geometry.boundingSphere!;
        const p = tube.geometry.getAttribute('position');
        const v = new THREE.Vector3();
        for (let k = 0; k < p.count; k++) expect(sphere.containsPoint(v.fromBufferAttribute(p, k))).toBe(true);
      }
    }
  });
});
