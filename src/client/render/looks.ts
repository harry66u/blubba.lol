import * as THREE from 'three';
import type { WeaponModel } from './weapons';

/**
 * Cosmetic pieces: hats, face extras and weapon finishes. Purely visual; hitboxes never change.
 * Hats are built in the frame of the tube's tip (+y along the tube, +z toward the face).
 */

function stdMat(color: number, opts: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.4, ...opts });
}

function part(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

function shade(hex: number, amount: number): number {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL((hsl.h + 0.08) % 1, Math.min(1, hsl.s * 1.05), Math.max(0, Math.min(1, hsl.l + amount)));
  return c.getHex();
}

const textures = new Map<string, THREE.Texture>();

function canvasTexture(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.Texture {
  const cached = textures.get(key);
  if (cached) return cached;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  textures.set(key, tex);
  return tex;
}

const stripes = (a: string, b: string, n = 8) =>
  canvasTexture(`stripes-${a}-${b}-${n}`, 128, 128, (g) => {
    g.fillStyle = a;
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = b;
    for (let i = -n; i < n * 2; i++) {
      g.beginPath();
      const x = (i * 128) / n;
      g.moveTo(x, 0);
      g.lineTo(x + 64 / n, 0);
      g.lineTo(x + 64 / n + 64, 128);
      g.lineTo(x + 64, 128);
      g.fill();
    }
  });

const galaxy = () =>
  canvasTexture('galaxy', 256, 256, (g) => {
    const grad = g.createLinearGradient(0, 0, 256, 256);
    grad.addColorStop(0, '#1b0b3a');
    grad.addColorStop(0.5, '#4a1a7a');
    grad.addColorStop(1, '#0b2a5a');
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 160; i++) {
      const r = Math.random() < 0.1 ? 2 : 1;
      g.fillStyle = ['#ffffff', '#ffe9a8', '#b9e6ff', '#ffb3f0'][i % 4];
      g.fillRect(Math.random() * 256, Math.random() * 256, r, r);
    }
  });

// --- Hats ------------------------------------------------------------------------------------

export const HAT_KEYS = ['spikes', 'party', 'cap', 'beanie', 'cone', 'chef', 'propeller', 'tophat', 'viking', 'halo'] as const;

/** Builds a hat. `userData.spin` (propeller) and `userData.bob` (halo) are animated by the tube man. */
export function buildHat(key: string, body: number): THREE.Group {
  const g = new THREE.Group();
  const dome = (r: number, color: THREE.Material, y: number, squash = 1) => {
    const m = part(new THREE.SphereGeometry(r, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), color, 0, y, 0);
    m.scale.y = squash;
    return m;
  };
  switch (key) {
    case 'party': {
      const cone = part(new THREE.ConeGeometry(0.2, 0.55, 20), stdMat(0xffffff, { map: stripes('#ff5fd2', '#ffd60a', 6) }), 0, 0.2, 0);
      const pom = part(new THREE.SphereGeometry(0.07, 12, 8), stdMat(0xffd60a), 0, 0.5, 0);
      g.add(cone, pom);
      g.rotation.z = 0.15;
      break;
    }
    case 'cap': {
      const mat = stdMat(shade(body, -0.2));
      g.add(dome(0.37, mat, -0.3, 0.75));
      const brim = part(new THREE.CylinderGeometry(0.22, 0.22, 0.035, 20), stdMat(0xffffff), 0, -0.28, 0.33);
      brim.scale.z = 1.3;
      const button = part(new THREE.SphereGeometry(0.04, 8, 6), stdMat(0xffffff), 0, -0.02, 0);
      g.add(brim, button);
      break;
    }
    case 'beanie': {
      const mat = stdMat(shade(body, 0.18), { roughness: 0.9 });
      g.add(dome(0.38, mat, -0.3, 0.85));
      g.add(part(new THREE.CylinderGeometry(0.385, 0.385, 0.1, 24), stdMat(0xffffff, { roughness: 0.9 }), 0, -0.28, 0));
      g.add(part(new THREE.SphereGeometry(0.1, 12, 8), stdMat(0xffffff, { roughness: 1 }), 0, 0.06, 0));
      break;
    }
    case 'cone': {
      const orange = stdMat(0xff7a1a, { roughness: 0.5 });
      g.add(part(new THREE.BoxGeometry(0.6, 0.05, 0.6), orange, 0, -0.12, 0));
      g.add(part(new THREE.ConeGeometry(0.26, 0.7, 20), orange, 0, 0.24, 0));
      g.add(part(new THREE.CylinderGeometry(0.13, 0.17, 0.12, 20), stdMat(0xffffff), 0, 0.2, 0));
      break;
    }
    case 'chef': {
      const white = stdMat(0xffffff, { roughness: 0.8 });
      g.add(part(new THREE.CylinderGeometry(0.3, 0.3, 0.28, 20), white, 0, -0.02, 0));
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        g.add(part(new THREE.SphereGeometry(0.18, 12, 10), white, Math.cos(a) * 0.14, 0.24, Math.sin(a) * 0.14));
      }
      g.add(part(new THREE.SphereGeometry(0.2, 12, 10), white, 0, 0.3, 0));
      break;
    }
    case 'propeller': {
      g.add(dome(0.34, stdMat(0xffd60a), -0.28, 0.7));
      g.add(part(new THREE.CylinderGeometry(0.02, 0.02, 0.2, 8), stdMat(0x9aa3b8, { metalness: 0.5 }), 0, 0.0, 0));
      const blades = new THREE.Group();
      blades.position.y = 0.1;
      blades.add(part(new THREE.BoxGeometry(0.5, 0.02, 0.09), stdMat(0xff3b5c), 0.25, 0, 0), part(new THREE.BoxGeometry(0.5, 0.02, 0.09), stdMat(0x2ec5ff), -0.25, 0, 0));
      g.add(blades);
      g.userData.spin = blades;
      break;
    }
    case 'tophat': {
      const black = stdMat(0x2b2d42, { roughness: 0.35 });
      g.add(part(new THREE.CylinderGeometry(0.42, 0.42, 0.035, 28), black, 0, -0.1, 0));
      g.add(part(new THREE.CylinderGeometry(0.27, 0.28, 0.5, 24), black, 0, 0.16, 0));
      g.add(part(new THREE.CylinderGeometry(0.285, 0.285, 0.08, 24), stdMat(body), 0, -0.03, 0));
      break;
    }
    case 'viking': {
      g.add(dome(0.4, stdMat(0x9aa3b8, { metalness: 0.6, roughness: 0.3 }), -0.32, 0.9));
      g.add(part(new THREE.TorusGeometry(0.4, 0.035, 8, 28), stdMat(0xc9a14a, { metalness: 0.7, roughness: 0.3 }), 0, -0.3, 0).rotateX(Math.PI / 2));
      for (const s of [-1, 1]) {
        const horn = part(new THREE.ConeGeometry(0.075, 0.38, 12), stdMat(0xf4ecd8), s * 0.4, -0.02, 0);
        horn.rotation.z = -s * 0.9;
        g.add(horn);
      }
      break;
    }
    case 'halo': {
      const ring = part(new THREE.TorusGeometry(0.26, 0.035, 10, 32), stdMat(0xffd84a, { emissive: 0xffc933, emissiveIntensity: 0.9, metalness: 0.4 }), 0, 0.38, 0);
      ring.rotation.x = Math.PI / 2;
      ring.castShadow = false;
      g.add(ring);
      g.userData.bob = ring;
      break;
    }
    default: {
      // Tufts: the classic air-dancer hair.
      const hairMat = stdMat(shade(body, 0.12), { roughness: 0.35 });
      const spike = new THREE.ConeGeometry(0.07, 0.3, 8);
      for (let i = 0; i < 6; i++) {
        const m = new THREE.Mesh(spike, hairMat);
        const a = (i / 6) * Math.PI * 2;
        m.position.set(Math.cos(a) * 0.12, 0.08, Math.sin(a) * 0.12);
        m.rotation.set(Math.sin(a) * 0.7, 0, -Math.cos(a) * 0.7);
        m.castShadow = true;
        g.add(m);
      }
    }
  }
  return g;
}

/** Animates spinning/bobbing hats. */
export function animateHat(hat: THREE.Group, t: number, dt: number, flying: boolean): void {
  const spin = hat.userData.spin as THREE.Object3D | undefined;
  if (spin) spin.rotation.y += dt * (flying ? 40 : 9);
  const bob = hat.userData.bob as THREE.Object3D | undefined;
  if (bob) bob.position.y = 0.38 + Math.sin(t * 3) * 0.04;
}

export function disposeGroup(g: THREE.Object3D): void {
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.geometry.dispose();
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats) mat.dispose();
  });
}

// --- Faces -----------------------------------------------------------------------------------

export const FACE_KEYS = ['smile', 'grin', 'sleepy', 'angry', 'derp', 'cyclops', 'shades'] as const;

/** Extra face parts (eyebrows, shades, teeth, a cyclops eye) in the face's frame (+z out of the tube). */
export function buildFaceExtras(key: string): THREE.Group {
  const g = new THREE.Group();
  const dark = stdMat(0x1d1b3a, { roughness: 0.5 });
  switch (key) {
    case 'grin': {
      const teeth = part(new THREE.BoxGeometry(0.15, 0.045, 0.02), stdMat(0xffffff, { roughness: 0.3 }), 0, -0.2, 0.025);
      teeth.castShadow = false;
      g.add(teeth);
      break;
    }
    case 'angry':
      for (const s of [-1, 1]) {
        const brow = part(new THREE.BoxGeometry(0.15, 0.035, 0.03), dark, s * 0.12, 0.13, 0.07);
        brow.rotation.z = s * 0.4;
        brow.castShadow = false;
        g.add(brow);
      }
      break;
    case 'shades': {
      const lens = stdMat(0x111122, { roughness: 0.1, metalness: 0.6 });
      for (const s of [-1, 1]) {
        const l = part(new THREE.BoxGeometry(0.18, 0.12, 0.04), lens, s * 0.12, 0.01, 0.09);
        l.castShadow = false;
        g.add(l);
      }
      const bridge = part(new THREE.BoxGeometry(0.08, 0.025, 0.03), lens, 0, 0.04, 0.09);
      bridge.castShadow = false;
      g.add(bridge);
      break;
    }
    case 'cyclops': {
      const eye = part(new THREE.SphereGeometry(0.15, 18, 14), stdMat(0xffffff, { roughness: 0.2 }), 0, 0.01, 0);
      const pupil = part(new THREE.SphereGeometry(0.075, 14, 10), stdMat(0x14122a, { roughness: 0.3 }), 0, 0.01, 0.105);
      eye.castShadow = pupil.castShadow = false;
      g.add(eye, pupil);
      g.userData.eye = eye;
      g.userData.pupil = pupil;
      break;
    }
    default:
      break;
  }
  return g;
}

// --- Weapon finishes -------------------------------------------------------------------------

export const FINISH_KEYS = ['team', 'bubblegum', 'candy', 'chrome', 'neon', 'gold', 'galaxy'] as const;

/** Repaints a weapon model. 'team' restores the normal look in the player's color. */
export function applyFinish(model: WeaponModel, key: string, playerColor: number): void {
  for (const { mat, base } of model.paint) {
    const own = base === 'player' ? playerColor : base;
    mat.map = null;
    mat.metalness = 0;
    mat.roughness = 0.35;
    mat.emissive.setHex(0x000000);
    mat.emissiveIntensity = 0;
    switch (key) {
      case 'bubblegum':
        mat.color.setHex(0xff8fd8);
        break;
      case 'candy':
        mat.color.setHex(0xffffff);
        mat.map = stripes('#ffffff', '#ff3b5c', 6);
        break;
      case 'chrome':
        mat.color.setHex(0xeef3fb);
        mat.metalness = 1;
        mat.roughness = 0.12;
        break;
      case 'neon':
        mat.color.setHex(playerColor);
        mat.emissive.setHex(playerColor);
        mat.emissiveIntensity = 0.9;
        break;
      case 'gold':
        mat.color.setHex(0xffc933);
        mat.metalness = 0.9;
        mat.roughness = 0.25;
        break;
      case 'galaxy':
        mat.color.setHex(0xffffff);
        mat.map = galaxy();
        mat.emissive.setHex(0x2a1050);
        mat.emissiveIntensity = 0.5;
        break;
      default:
        mat.color.setHex(own);
    }
    mat.needsUpdate = true;
  }
}
