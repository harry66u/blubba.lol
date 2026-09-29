import * as THREE from 'three';

/**
 * Flat 2D shapes (hearts, stars, music notes) used by eye styles, trails and knockout effects.
 * Each is centered on the origin in the XY plane, about `size` across.
 */

export function heartShape(size = 1): THREE.Shape {
  const s = size / 2;
  const h = new THREE.Shape();
  h.moveTo(0, -s * 0.9);
  h.bezierCurveTo(-s * 0.2, -s * 0.55, -s, -s * 0.15, -s, s * 0.3);
  h.bezierCurveTo(-s, s * 0.8, -s * 0.35, s * 0.95, 0, s * 0.5);
  h.bezierCurveTo(s * 0.35, s * 0.95, s, s * 0.8, s, s * 0.3);
  h.bezierCurveTo(s, -s * 0.15, s * 0.2, -s * 0.55, 0, -s * 0.9);
  return h;
}

export function starShape(size = 1, points = 5, inner = 0.45): THREE.Shape {
  const r = size / 2;
  const st = new THREE.Shape();
  for (let i = 0; i < points * 2; i++) {
    const a = (i / (points * 2)) * Math.PI * 2 + Math.PI / 2;
    const rr = i % 2 ? r * inner : r;
    if (i === 0) st.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    else st.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  st.closePath();
  return st;
}

/** An eighth note: a round head, a stem and a little flag. */
export function noteShape(size = 1): THREE.Shape[] {
  const s = size;
  const head = new THREE.Shape();
  head.absellipse(-s * 0.12, -s * 0.3, s * 0.2, s * 0.15, 0, Math.PI * 2, false, -0.4);
  const stem = new THREE.Shape();
  stem.moveTo(s * 0.02, -s * 0.3);
  stem.lineTo(s * 0.08, -s * 0.3);
  stem.lineTo(s * 0.08, s * 0.45);
  stem.lineTo(s * 0.02, s * 0.45);
  stem.closePath();
  const flag = new THREE.Shape();
  flag.moveTo(s * 0.08, s * 0.45);
  flag.bezierCurveTo(s * 0.12, s * 0.25, s * 0.38, s * 0.22, s * 0.3, s * 0.0);
  flag.bezierCurveTo(s * 0.3, s * 0.18, s * 0.14, s * 0.26, s * 0.08, s * 0.28);
  flag.closePath();
  return [head, stem, flag];
}

/** Tiny deterministic random numbers, so procedural textures look the same for everyone. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
