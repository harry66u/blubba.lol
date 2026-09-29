import * as THREE from 'three';
import { heartShape, seeded, starShape } from './shapes';
import type { WeaponModel } from './weapons';

/**
 * Cosmetic pieces: hats, face extras, eye styles, bases and weapon finishes. Purely visual;
 * hitboxes never change. Hats are built in the frame of the tube's tip (+y along the tube, +z
 * toward the face); bases stand on the ground with the tube coming out of the top.
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

const rainbowBands = () =>
  canvasTexture('rainbow', 128, 128, (g) => {
    const colors = ['#ff3b5c', '#ff8a1f', '#ffd60a', '#8ee000', '#2ec5ff', '#3d6bff', '#9b4dff'];
    for (let i = 0; i < 14; i++) {
      g.fillStyle = colors[i % colors.length];
      g.fillRect(0, (i * 128) / 14, 128, 128 / 14 + 1);
    }
  });

const woodGrain = () =>
  canvasTexture('wood', 128, 128, (g) => {
    const rnd = seeded(7);
    g.fillStyle = '#b87a45';
    g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 26; i++) {
      g.strokeStyle = rnd() < 0.5 ? 'rgba(90,50,20,0.45)' : 'rgba(230,170,110,0.35)';
      g.lineWidth = 1 + rnd() * 3;
      g.beginPath();
      const y0 = rnd() * 128;
      for (let x = 0; x <= 128; x += 8) g.lineTo(x, y0 + Math.sin(x * 0.05 + i) * 4);
      g.stroke();
    }
  });

/** Dark rock with glowing cracks (used as an emissive map). */
const lavaCracks = () =>
  canvasTexture('lava', 128, 128, (g) => {
    const rnd = seeded(11);
    g.fillStyle = '#000000';
    g.fillRect(0, 0, 128, 128);
    g.lineCap = 'round';
    for (let i = 0; i < 14; i++) {
      g.strokeStyle = i % 3 ? '#ff6a00' : '#ffd23a';
      g.lineWidth = 2 + rnd() * 3;
      g.beginPath();
      let x = rnd() * 128;
      let y = rnd() * 128;
      g.moveTo(x, y);
      for (let k = 0; k < 5; k++) {
        x += (rnd() - 0.5) * 40;
        y += (rnd() - 0.5) * 40;
        g.lineTo(x, y);
      }
      g.stroke();
    }
  });

/** Triangle facets in slightly different whites, so a diamond finish sparkles as it turns. */
const facets = () =>
  canvasTexture('facets', 128, 128, (g) => {
    const rnd = seeded(5);
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        for (let t = 0; t < 2; t++) {
          const v = Math.round(200 + rnd() * 55);
          g.fillStyle = `rgb(${v - 10},${v},255)`;
          g.beginPath();
          g.moveTo(x * 32, y * 32);
          if (t) g.lineTo(x * 32 + 32, y * 32);
          else g.lineTo(x * 32, y * 32 + 32);
          g.lineTo(x * 32 + 32, y * 32 + 32);
          g.fill();
        }
      }
    }
  });

const wizardStars = () =>
  canvasTexture('wizard', 128, 128, (g) => {
    const rnd = seeded(3);
    g.fillStyle = '#3d3bb8';
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#ffd60a';
    for (let i = 0; i < 12; i++) {
      const x = rnd() * 128;
      const y = rnd() * 128;
      const r = 3 + rnd() * 4;
      g.beginPath();
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2 - Math.PI / 2;
        const rr = k % 2 ? r * 0.45 : r;
        g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      }
      g.fill();
    }
  });

/** Zigzag top edge for the paper crown (white on transparent, cut out with alphaTest). */
const paperZigzag = () =>
  canvasTexture('paperzig', 256, 64, (g) => {
    g.clearRect(0, 0, 256, 64);
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.moveTo(0, 64);
    const n = 8;
    for (let i = 0; i <= n; i++) {
      g.lineTo((i / n) * 256, 2);
      if (i < n) g.lineTo(((i + 0.5) / n) * 256, 34);
    }
    g.lineTo(256, 64);
    g.fill();
  });

const spiral = () =>
  canvasTexture('spiral', 64, 64, (g) => {
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(32, 32, 31, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#1d1b3a';
    g.lineWidth = 5;
    g.beginPath();
    for (let a = 0; a < Math.PI * 6; a += 0.2) g.lineTo(32 + Math.cos(a) * a * 1.55, 32 + Math.sin(a) * a * 1.55);
    g.stroke();
  });

// --- Hats ------------------------------------------------------------------------------------

export const HAT_KEYS = [
  'spikes',
  'party',
  'cap',
  'beanie',
  'cone',
  'chef',
  'propeller',
  'tophat',
  'viking',
  'halo',
  'flower',
  'bucket',
  'papercrown',
  'antenna',
  'bunny',
  'cowboy',
  'headphones',
  'pirate',
  'wizard',
  'unicorn',
  'laurel',
] as const;

/** A pivot at the attachment point, so swaying parts (ears, antennae) rotate from their base. */
function pivot(x: number, y: number, z: number, rz: number, ...children: THREE.Object3D[]): THREE.Group {
  const p = new THREE.Group();
  p.position.set(x, y, z);
  p.rotation.z = rz;
  p.userData.rz = rz;
  p.add(...children);
  return p;
}

/**
 * Builds a hat. `userData.spin` (propeller), `userData.bob` (halo) and `userData.sway` (ears,
 * antennae, flower) are animated by the tube man.
 */
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
    case 'flower': {
      // A big daisy on a short stem, nodding toward the front.
      const stem = part(new THREE.CylinderGeometry(0.02, 0.025, 0.2, 6), stdMat(0x4caf50), 0, 0.08, 0);
      const head = new THREE.Group();
      head.position.y = 0.2;
      head.rotation.x = 0.55;
      head.add(part(new THREE.SphereGeometry(0.08, 14, 10).scale(1, 0.5, 1), stdMat(0xffc81e, { roughness: 0.7 }), 0, 0.02, 0));
      const petal = new THREE.SphereGeometry(0.075, 10, 8).scale(1, 0.25, 0.45);
      const petalMat = stdMat(0xffffff, { roughness: 0.6 });
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        const m = part(petal, petalMat, Math.cos(a) * 0.12, 0, Math.sin(a) * 0.12);
        m.rotation.y = -a;
        head.add(m);
      }
      const flower = pivot(0.06, -0.02, 0, -0.15, stem, head);
      g.add(flower);
      g.userData.sway = [flower];
      break;
    }
    case 'bucket': {
      const mat = stdMat(shade(body, -0.12), { roughness: 0.85, side: THREE.DoubleSide });
      g.add(part(new THREE.CylinderGeometry(0.27, 0.34, 0.26, 24), mat, 0, -0.08, 0));
      g.add(part(new THREE.SphereGeometry(0.27, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.35, 1), mat, 0, 0.05, 0));
      g.add(part(new THREE.CylinderGeometry(0.36, 0.52, 0.12, 28, 1, true), mat, 0, -0.26, 0));
      g.add(part(new THREE.CylinderGeometry(0.345, 0.345, 0.05, 24), stdMat(shade(body, 0.25), { roughness: 0.8 }), 0, -0.17, 0));
      break;
    }
    case 'papercrown': {
      // Tissue paper from a party cracker: matte, flat, a little crooked. Not the gold crown.
      const paper = stdMat(shade(body, 0.28), { roughness: 0.95, map: paperZigzag(), alphaTest: 0.5, side: THREE.DoubleSide });
      const band = part(new THREE.CylinderGeometry(0.34, 0.33, 0.24, 32, 1, true), paper, 0, -0.1, 0);
      band.castShadow = false;
      g.add(band);
      g.rotation.z = 0.14;
      g.rotation.x = -0.08;
      break;
    }
    case 'antenna': {
      const stalk = new THREE.CylinderGeometry(0.015, 0.02, 0.36, 6).translate(0, 0.18, 0);
      const stalkMat = stdMat(0x2b2d42);
      const ballMat = stdMat(shade(body, 0.2), { emissive: shade(body, 0.2), emissiveIntensity: 0.4, roughness: 0.3 });
      const sway: THREE.Object3D[] = [];
      for (const s of [-1, 1]) {
        const a = pivot(s * 0.12, -0.02, 0, -s * 0.35, part(stalk, stalkMat), part(new THREE.SphereGeometry(0.06, 12, 8), ballMat, 0, 0.38, 0));
        g.add(a);
        sway.push(a);
      }
      g.userData.sway = sway;
      break;
    }
    case 'bunny': {
      const ear = new THREE.CapsuleGeometry(0.075, 0.36, 4, 10).translate(0, 0.25, 0);
      const inner = new THREE.CapsuleGeometry(0.04, 0.28, 4, 8).translate(0, 0.25, 0.04);
      const white = stdMat(0xffffff, { roughness: 0.7 });
      const pink = stdMat(0xffa3c7, { roughness: 0.7 });
      const sway: THREE.Object3D[] = [];
      for (const s of [-1, 1]) {
        const earMesh = part(ear, white);
        earMesh.scale.z = 0.55;
        const e = pivot(s * 0.13, -0.06, 0, -s * 0.22, earMesh, part(inner, pink));
        g.add(e);
        sway.push(e);
      }
      g.userData.sway = sway;
      g.userData.floppy = true;
      break;
    }
    case 'cowboy': {
      const tan = stdMat(0xc98a4b, { roughness: 0.75 });
      const brim = part(new THREE.CylinderGeometry(0.58, 0.58, 0.03, 32), tan, 0, -0.14, 0);
      brim.scale.z = 0.82;
      g.add(brim);
      // Brim edges rolled up at the sides.
      for (const s of [-1, 1]) {
        const roll = part(new THREE.CylinderGeometry(0.05, 0.05, 0.62, 10), tan, s * 0.54, -0.1, 0);
        roll.rotation.x = Math.PI / 2;
        g.add(roll);
      }
      const crown = part(new THREE.CylinderGeometry(0.24, 0.29, 0.32, 24), tan, 0, 0.04, 0);
      crown.scale.z = 0.85;
      g.add(crown);
      const dent = part(new THREE.BoxGeometry(0.05, 0.06, 0.4), stdMat(0xa86d35, { roughness: 0.8 }), 0, 0.19, 0);
      g.add(dent);
      const band = part(new THREE.CylinderGeometry(0.295, 0.3, 0.06, 24), stdMat(0x5a3218), 0, -0.08, 0);
      band.scale.z = 0.85;
      g.add(band);
      break;
    }
    case 'headphones': {
      const dark = stdMat(0x2b2d42, { roughness: 0.4 });
      const band = part(new THREE.TorusGeometry(0.41, 0.035, 8, 28, Math.PI), dark, 0, -0.3, 0);
      g.add(band);
      const cupMat = stdMat(shade(body, -0.1), { roughness: 0.3 });
      for (const s of [-1, 1]) {
        const cup = part(new THREE.CylinderGeometry(0.13, 0.13, 0.1, 20), cupMat, s * 0.42, -0.32, 0);
        cup.rotation.z = Math.PI / 2;
        const pad = part(new THREE.TorusGeometry(0.1, 0.03, 8, 16), dark, s * 0.37, -0.32, 0);
        pad.rotation.y = Math.PI / 2;
        g.add(cup, pad);
      }
      break;
    }
    case 'pirate': {
      const black = stdMat(0x22222e, { roughness: 0.6 });
      const hat = part(new THREE.SphereGeometry(0.45, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), black, 0, -0.18, 0);
      hat.scale.set(1.3, 0.8, 0.85);
      g.add(hat);
      const trim = part(new THREE.TorusGeometry(0.45, 0.025, 6, 32), stdMat(0xffc933, { metalness: 0.6, roughness: 0.3 }), 0, -0.18, 0);
      trim.rotation.x = Math.PI / 2;
      trim.scale.set(1.3, 0.85, 1);
      g.add(trim);
      const bone = stdMat(0xf4ecd8, { roughness: 0.5 });
      g.add(part(new THREE.SphereGeometry(0.07, 12, 10), bone, 0, 0.02, 0.33));
      for (const s of [-1, 1]) {
        const x = part(new THREE.CapsuleGeometry(0.018, 0.16, 3, 6), bone, 0, -0.08, 0.37);
        x.rotation.z = s * 0.9;
        g.add(x);
      }
      break;
    }
    case 'wizard': {
      const cloth = stdMat(0xffffff, { roughness: 0.8, map: wizardStars() });
      g.add(part(new THREE.CylinderGeometry(0.54, 0.54, 0.03, 32), cloth, 0, -0.14, 0));
      g.add(part(new THREE.CylinderGeometry(0.15, 0.32, 0.46, 24), cloth, 0, 0.1, 0));
      const tip = part(new THREE.ConeGeometry(0.15, 0.42, 20), cloth, 0, 0.45, -0.06);
      tip.rotation.x = -0.45;
      g.add(tip);
      g.add(part(new THREE.CylinderGeometry(0.325, 0.33, 0.06, 24), stdMat(0xffd60a, { roughness: 0.4 }), 0, -0.1, 0));
      break;
    }
    case 'unicorn': {
      const swirl = stdMat(0xffffff, { roughness: 0.25, map: stripes('#fff4fb', '#ffb3e6', 5), emissive: 0xffc6f0, emissiveIntensity: 0.25 });
      const horn = part(new THREE.ConeGeometry(0.085, 0.5, 18, 6), swirl, 0, 0.18, 0.16);
      horn.rotation.x = 0.4;
      g.add(horn);
      for (const s of [-1, 1]) {
        const ear = part(new THREE.ConeGeometry(0.07, 0.16, 10), stdMat(shade(body, 0.2)), s * 0.24, -0.02, -0.02);
        ear.rotation.z = -s * 0.5;
        g.add(ear);
      }
      break;
    }
    case 'laurel': {
      // Level reward: a golden wreath of leaves around the head.
      const leafGeo = new THREE.SphereGeometry(0.07, 10, 6).scale(0.45, 0.25, 1);
      const gold = stdMat(0xffc933, { metalness: 0.75, roughness: 0.3, emissive: 0xffa000, emissiveIntensity: 0.3 });
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * Math.PI * 2;
        if (Math.abs(Math.sin(a / 2)) < 0.12) continue; // a gap at the front
        for (const row of [-1, 1]) {
          const leaf = part(leafGeo, gold, Math.sin(a) * 0.35, -0.14 + row * 0.03, Math.cos(a) * 0.35);
          leaf.rotation.set(row * 0.5, a + Math.PI / 2, 0);
          g.add(leaf);
        }
      }
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
  const sway = hat.userData.sway as THREE.Object3D[] | undefined;
  if (sway) {
    // Wobble from the base; floppy ears fold back while flying.
    const flop = flying && hat.userData.floppy ? -1.1 : 0;
    sway.forEach((o, i) => {
      o.rotation.z = (o.userData.rz as number) + Math.sin(t * 4.2 + i * 1.9) * 0.16;
      o.rotation.x = flop + Math.sin(t * 3.1 + i) * 0.1;
    });
  }
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

export const FACE_KEYS = ['smile', 'blush', 'tongue', 'grin', 'sleepy', 'surprised', 'winky', 'angry', 'derp', 'cyclops', 'mustache', 'fangs', 'shades', 'visor'] as const;

/** Faces that cover the eyes with their own (the eyes slot doesn't show with these). */
export const FACES_COVERING_EYES = new Set(['cyclops', 'shades', 'visor']);

/** Extra face parts (eyebrows, shades, teeth, a cyclops eye) in the face's frame (+z out of the tube). */
export function buildFaceExtras(key: string): THREE.Group {
  const g = new THREE.Group();
  const dark = stdMat(0x1d1b3a, { roughness: 0.5 });
  const flat = (m: THREE.Mesh) => {
    m.castShadow = false;
    g.add(m);
    return m;
  };
  switch (key) {
    case 'blush': {
      const pink = stdMat(0xff7aa8, { roughness: 0.8, transparent: true, opacity: 0.75, depthWrite: false });
      for (const s of [-1, 1]) {
        const cheek = flat(part(new THREE.CircleGeometry(0.055, 16), pink, s * 0.2, -0.11, 0.075));
        cheek.scale.y = 0.6;
        cheek.rotation.y = s * 0.45;
      }
      break;
    }
    case 'tongue': {
      const tongue = flat(part(new THREE.SphereGeometry(0.055, 14, 10), stdMat(0xff5c8a, { roughness: 0.45 }), 0.02, -0.27, 0.04));
      tongue.scale.set(1, 1.25, 0.45);
      tongue.rotation.z = 0.2;
      break;
    }
    case 'surprised':
      for (const s of [-1, 1]) {
        const brow = flat(part(new THREE.TorusGeometry(0.07, 0.014, 6, 12, Math.PI * 0.8), dark, s * 0.12, 0.13, 0.07));
        brow.rotation.z = Math.PI * 0.1;
      }
      break;
    case 'mustache': {
      const hair = stdMat(0x3a2418, { roughness: 0.7 });
      for (const s of [-1, 1]) {
        const half = flat(part(new THREE.CapsuleGeometry(0.03, 0.09, 4, 8), hair, s * 0.06, -0.14, 0.085));
        half.rotation.z = s * 1.25;
        const curl = flat(part(new THREE.TorusGeometry(0.025, 0.013, 6, 10, Math.PI * 1.3), hair, s * 0.125, -0.13, 0.08));
        curl.rotation.z = s > 0 ? -0.6 : Math.PI + 0.6;
      }
      break;
    }
    case 'fangs': {
      const white = stdMat(0xffffff, { roughness: 0.3 });
      for (const s of [-1, 1]) {
        const fang = flat(part(new THREE.ConeGeometry(0.017, 0.055, 8), white, s * 0.045, -0.225, 0.04));
        fang.rotation.x = Math.PI;
      }
      break;
    }
    case 'visor': {
      const glass = stdMat(0x39e6ff, { emissive: 0x39e6ff, emissiveIntensity: 0.9, roughness: 0.1, metalness: 0.3, side: THREE.DoubleSide });
      flat(part(new THREE.CylinderGeometry(0.28, 0.28, 0.12, 24, 1, true, -1.05, 2.1), glass, 0, 0.01, -0.2));
      const frame = stdMat(0x2b2d42, { roughness: 0.4, metalness: 0.5, side: THREE.DoubleSide });
      for (const y of [-0.06, 0.08]) flat(part(new THREE.CylinderGeometry(0.285, 0.285, 0.02, 24, 1, true, -1.1, 2.2), frame, 0, y, -0.2));
      break;
    }
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

// --- Eyes ------------------------------------------------------------------------------------

export const EYE_KEYS = ['classic', 'dot', 'lashes', 'cat', 'star', 'heart', 'googly', 'spiral', 'sparkle'] as const;

/**
 * How an eye style dresses the tube man's two eyes. Geometry and materials are shared by every
 * tube man and never disposed; `eyeChild` / `pupilChild` hang extra meshes on each eye or pupil
 * so they blink and squint along with it.
 */
export interface EyeStyle {
  eyeMat: THREE.Material;
  pupilGeo: THREE.BufferGeometry;
  pupilMat: THREE.Material;
  /** How far in front of the eye's center the pupil sits (flat shapes sit on the surface). */
  pupilZ: number;
  pupilScale: [number, number];
  eyeSize: number;
  hideWhites: boolean;
  /** Pupil spin speed (spirals). */
  spin: number;
  /** Heartbeat / twinkle pulse on the pupil. */
  pulse: boolean;
  /** Pupils rattle around like googly eyes. */
  wobble: boolean;
  eyeChild: ((side: number) => THREE.Object3D) | null;
  pupilChild: (() => THREE.Object3D) | null;
}

const eyeStyles = new Map<string, EyeStyle>();
let eyeParts: { white: THREE.Material; pupilGeo: THREE.BufferGeometry; pupil: THREE.Material; dot: THREE.Material; shine: THREE.Material; shineGeo: THREE.BufferGeometry; lash: THREE.BufferGeometry } | null = null;

function flatPart(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}

export function eyeStyle(key: string): EyeStyle {
  const cached = eyeStyles.get(key);
  if (cached) return cached;
  eyeParts ??= {
    white: stdMat(0xffffff, { roughness: 0.2 }),
    pupilGeo: new THREE.SphereGeometry(0.05, 12, 8),
    pupil: stdMat(0x14122a, { roughness: 0.3 }),
    dot: stdMat(0x14122a, { roughness: 0.08 }),
    shine: new THREE.MeshBasicMaterial({ color: 0xffffff }),
    shineGeo: new THREE.SphereGeometry(0.014, 8, 6),
    lash: new THREE.BoxGeometry(0.014, 0.055, 0.012).translate(0, 0.0275, 0),
  };
  const P = eyeParts;
  const st: EyeStyle = { eyeMat: P.white, pupilGeo: P.pupilGeo, pupilMat: P.pupil, pupilZ: 0.065, pupilScale: [1, 1], eyeSize: 1, hideWhites: false, spin: 0, pulse: false, wobble: false, eyeChild: null, pupilChild: null };
  const shineDots = () => {
    const g = new THREE.Group();
    g.add(flatPart(P.shineGeo, P.shine, 0.018, 0.022, 0.044));
    const small = flatPart(P.shineGeo, P.shine, -0.016, -0.018, 0.046);
    small.scale.setScalar(0.55);
    g.add(small);
    return g;
  };
  switch (key) {
    case 'dot':
      st.hideWhites = true;
      st.pupilMat = P.dot;
      st.pupilScale = [1.45, 1.45];
      st.pupilZ = 0.03;
      st.pupilChild = shineDots;
      break;
    case 'lashes':
      st.eyeChild = (side) => {
        const g = new THREE.Group();
        for (const a of [-0.35, 0.15, 0.65]) {
          const lash = flatPart(P.lash, P.pupil, Math.sin(a * side) * 0.088, Math.cos(a * side) * 0.088, 0.03);
          lash.rotation.z = -a * side;
          g.add(lash);
        }
        return g;
      };
      break;
    case 'cat':
      st.eyeMat = stdMat(0xc6f03c, { roughness: 0.2 });
      st.pupilScale = [0.35, 1.35];
      break;
    case 'star':
      st.pupilGeo = new THREE.ShapeGeometry(starShape(0.14));
      st.pupilMat = stdMat(0xffd60a, { emissive: 0xffb000, emissiveIntensity: 0.7, side: THREE.DoubleSide });
      st.pupilZ = 0.097;
      st.pulse = true;
      break;
    case 'heart':
      st.pupilGeo = new THREE.ShapeGeometry(heartShape(0.13));
      st.pupilMat = stdMat(0xff2d55, { emissive: 0xff2d55, emissiveIntensity: 0.5, side: THREE.DoubleSide });
      st.pupilZ = 0.097;
      st.pulse = true;
      break;
    case 'googly':
      st.eyeSize = 1.3;
      st.pupilScale = [0.85, 0.85];
      st.pupilZ = 0.07;
      st.wobble = true;
      break;
    case 'spiral':
      st.pupilGeo = new THREE.CircleGeometry(0.078, 24);
      st.pupilMat = new THREE.MeshBasicMaterial({ map: spiral(), transparent: true });
      st.pupilZ = 0.097;
      st.spin = 7;
      break;
    case 'sparkle':
      st.pupilMat = stdMat(0x2a1a5e, { roughness: 0.15 });
      st.pupilScale = [1.45, 1.6];
      st.pupilZ = 0.045;
      st.pupilChild = shineDots;
      break;
    default:
      break;
  }
  eyeStyles.set(key, st);
  return st;
}

// --- Bases -----------------------------------------------------------------------------------

export const BASE_KEYS = ['classic', 'tire', 'pot', 'trash', 'duck', 'cloud', 'cake', 'rocket', 'gold'] as const;

/**
 * The fan base the tube man stands on, about `h` tall (where the tube starts). `accent` (-1 for
 * none) tints the part that's normally painted. `userData.flame` (rocket), `userData.float`
 * (cloud) and `userData.candles` (cake) are animated by animateBase.
 */
export function buildBase(key: string, accent: number, h: number): THREE.Group {
  const g = new THREE.Group();
  const tint = (fallback: number) => (accent >= 0 ? accent : fallback);
  switch (key) {
    case 'tire': {
      const rubber = stdMat(0x24242c, { roughness: 0.9 });
      const tire = part(new THREE.TorusGeometry(0.34, 0.13, 12, 28), rubber, 0, 0.13, 0);
      tire.rotation.x = Math.PI / 2;
      g.add(tire);
      g.add(part(new THREE.CylinderGeometry(0.23, 0.25, h - 0.02, 20), stdMat(tint(0xc9d2e8), { roughness: 0.35, metalness: accent >= 0 ? 0.1 : 0.6 }), 0, (h - 0.02) / 2, 0));
      break;
    }
    case 'pot': {
      const clay = stdMat(0xc8643c, { roughness: 0.8 });
      g.add(part(new THREE.CylinderGeometry(0.46, 0.34, 0.3, 24), clay, 0, 0.15, 0));
      g.add(part(new THREE.CylinderGeometry(0.5, 0.5, 0.09, 24), stdMat(tint(0xd97a4f), { roughness: 0.75 }), 0, 0.3, 0));
      g.add(part(new THREE.CylinderGeometry(0.46, 0.46, 0.02, 24), stdMat(0x4a2e1c, { roughness: 1 }), 0, 0.34, 0));
      const leafGeo = new THREE.SphereGeometry(0.1, 10, 6).scale(0.5, 0.18, 1.2);
      const leafMat = stdMat(0x4caf50, { roughness: 0.6 });
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + 0.3;
        const leaf = part(leafGeo, leafMat, Math.sin(a) * 0.42, 0.4, Math.cos(a) * 0.42);
        leaf.rotation.set(-0.5, a, 0);
        g.add(leaf);
      }
      break;
    }
    case 'trash': {
      const can = stdMat(tint(0x9aa3b8), { roughness: 0.35, metalness: accent >= 0 ? 0.2 : 0.65 });
      g.add(part(new THREE.CylinderGeometry(0.5, 0.44, 0.44, 24), can, 0, 0.22, 0));
      const ribMat = stdMat(0x7d8599, { roughness: 0.4, metalness: 0.6 });
      for (const y of [0.1, 0.22, 0.34]) {
        const rib = part(new THREE.TorusGeometry(0.47 + y * 0.12, 0.018, 6, 28), ribMat, 0, y, 0);
        rib.rotation.x = Math.PI / 2;
        g.add(rib);
      }
      const rim = part(new THREE.TorusGeometry(0.505, 0.03, 8, 28), ribMat, 0, 0.44, 0);
      rim.rotation.x = Math.PI / 2;
      g.add(rim);
      // The lid, knocked off and leaning against the side.
      const lid = new THREE.Group();
      lid.add(part(new THREE.CylinderGeometry(0.46, 0.5, 0.05, 24), ribMat));
      lid.add(part(new THREE.BoxGeometry(0.2, 0.06, 0.05), ribMat, 0, 0.05, 0));
      lid.position.set(0.52, 0.42, -0.25);
      lid.rotation.set(0.2, 0.5, -1.2);
      g.add(lid);
      break;
    }
    case 'duck': {
      const yellow = stdMat(tint(0xffd60a), { roughness: 0.3 });
      const ring = part(new THREE.TorusGeometry(0.36, 0.15, 12, 28), yellow, 0, 0.15, 0);
      ring.rotation.x = Math.PI / 2;
      g.add(ring);
      g.add(part(new THREE.SphereGeometry(0.16, 16, 12), yellow, 0, 0.36, 0.42));
      const beak = part(new THREE.ConeGeometry(0.06, 0.14, 10), stdMat(0xff8a1f, { roughness: 0.4 }), 0, 0.34, 0.6);
      beak.rotation.x = Math.PI / 2;
      g.add(beak);
      for (const s of [-1, 1]) g.add(part(new THREE.SphereGeometry(0.025, 8, 6), stdMat(0x14122a), s * 0.07, 0.41, 0.54));
      break;
    }
    case 'cloud': {
      const puff = stdMat(0xffffff, { roughness: 0.9, emissive: tint(0xdff2ff), emissiveIntensity: accent >= 0 ? 0.25 : 0.35 });
      const cloud = new THREE.Group();
      const rnd = seeded(9);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const r = 0.2 + rnd() * 0.08;
        cloud.add(part(new THREE.SphereGeometry(r, 14, 10), puff, Math.cos(a) * 0.38, 0.12 + rnd() * 0.08, Math.sin(a) * 0.38));
      }
      cloud.add(part(new THREE.SphereGeometry(0.3, 16, 12), puff, 0, 0.14, 0));
      g.add(cloud);
      g.userData.float = cloud;
      break;
    }
    case 'cake': {
      g.add(part(new THREE.CylinderGeometry(0.48, 0.48, 0.2, 28), stdMat(0xf6d5a8, { roughness: 0.8 }), 0, 0.1, 0));
      g.add(part(new THREE.CylinderGeometry(0.5, 0.5, 0.08, 28), stdMat(tint(0xff9fd0), { roughness: 0.6 }), 0, 0.22, 0));
      const drip = part(new THREE.TorusGeometry(0.49, 0.035, 8, 28), stdMat(0xffffff, { roughness: 0.5 }), 0, 0.19, 0);
      drip.rotation.x = Math.PI / 2;
      g.add(drip);
      const candles: THREE.Object3D[] = [];
      const flameMat = new THREE.MeshBasicMaterial({ color: 0xffc933 });
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.25;
        const x = Math.sin(a) * 0.4;
        const z = Math.cos(a) * 0.4;
        g.add(part(new THREE.CylinderGeometry(0.022, 0.022, 0.16, 8), stdMat([0x2ec5ff, 0xff5fd2, 0x8ee000][i % 3], { roughness: 0.5 }), x, 0.34, z));
        const flame = part(new THREE.SphereGeometry(0.03, 8, 6).scale(1, 1.7, 1), flameMat, x, 0.45, z);
        flame.castShadow = false;
        g.add(flame);
        candles.push(flame);
      }
      g.userData.candles = candles;
      break;
    }
    case 'rocket': {
      const hull = stdMat(0xeef3fb, { roughness: 0.3, metalness: 0.3 });
      const paint = stdMat(tint(0xff3b5c), { roughness: 0.35 });
      g.add(part(new THREE.CylinderGeometry(0.4, 0.44, 0.3, 24), hull, 0, 0.15, 0));
      g.add(part(new THREE.CylinderGeometry(0.405, 0.405, 0.07, 24), paint, 0, 0.26, 0));
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        const fin = part(new THREE.BoxGeometry(0.04, 0.34, 0.26), paint, Math.sin(a) * 0.5, 0.17, Math.cos(a) * 0.5);
        fin.rotation.y = a;
        g.add(fin);
      }
      // Exhaust flame, lit while flying (see animateBase).
      const flame = new THREE.Group();
      const outer = part(new THREE.ConeGeometry(0.3, 0.9, 16), new THREE.MeshBasicMaterial({ color: 0xff8a1f, transparent: true, opacity: 0.85 }), 0, -0.45, 0);
      outer.rotation.x = Math.PI;
      const inner = part(new THREE.ConeGeometry(0.16, 0.55, 12), new THREE.MeshBasicMaterial({ color: 0xfff3a0 }), 0, -0.28, 0);
      inner.rotation.x = Math.PI;
      outer.castShadow = inner.castShadow = false;
      flame.add(outer, inner);
      flame.visible = false;
      g.add(flame);
      g.userData.flame = flame;
      break;
    }
    case 'gold': {
      // Level reward: a stepped trophy pedestal.
      const gold = stdMat(0xffc933, { metalness: 0.9, roughness: 0.22, emissive: 0xffa000, emissiveIntensity: 0.18 });
      g.add(part(new THREE.CylinderGeometry(0.5, 0.55, 0.1, 28), gold, 0, 0.05, 0));
      g.add(part(new THREE.CylinderGeometry(0.44, 0.48, 0.1, 28), gold, 0, 0.15, 0));
      g.add(part(new THREE.CylinderGeometry(0.4, 0.42, h - 0.2 + 0.02, 28), gold, 0, 0.2 + (h - 0.2) / 2, 0));
      const star = part(new THREE.ShapeGeometry(starShape(0.12)), stdMat(0xffffff, { emissive: 0xffffff, emissiveIntensity: 0.5, side: THREE.DoubleSide }), 0, 0.15, 0.49);
      star.castShadow = false;
      g.add(star);
      break;
    }
    default: {
      // The classic blower housing (dark gray unless you pick an accent color).
      g.add(part(new THREE.CylinderGeometry(0.4, 0.46, h, 20), stdMat(tint(0x3b3f55), { roughness: 0.55, metalness: accent >= 0 ? 0.1 : 0.2 }), 0, h / 2, 0));
      const ring = part(new THREE.TorusGeometry(0.34, 0.05, 8, 24), stdMat(0xc9d2e8, { roughness: 0.35, metalness: 0.4 }), 0, h, 0);
      ring.rotation.x = Math.PI / 2;
      g.add(ring);
    }
  }
  return g;
}

/** Rocket flames while flying, a floating cloud, flickering candles. */
export function animateBase(base: THREE.Group, t: number, flying: boolean): void {
  const flame = base.userData.flame as THREE.Object3D | undefined;
  if (flame) {
    flame.visible = flying;
    if (flying) flame.scale.set(1, 0.8 + Math.abs(Math.sin(t * 31)) * 0.5, 1);
  }
  const float = base.userData.float as THREE.Object3D | undefined;
  if (float) float.position.y = Math.sin(t * 2.2) * 0.03;
  const candles = base.userData.candles as THREE.Object3D[] | undefined;
  if (candles) candles.forEach((c, i) => c.scale.setScalar(0.85 + Math.abs(Math.sin(t * 13 + i * 2.1)) * 0.3));
}

// --- Weapon finishes -------------------------------------------------------------------------

export const FINISH_KEYS = ['team', 'bubblegum', 'wood', 'candy', 'frost', 'chrome', 'neon', 'rainbow', 'gold', 'lava', 'galaxy', 'diamond'] as const;

/** Repaints a weapon model. 'team' restores the normal look in the player's color. */
export function applyFinish(model: WeaponModel, key: string, playerColor: number): void {
  for (const { mat, base } of model.paint) {
    const own = base === 'player' ? playerColor : base;
    mat.map = null;
    mat.emissiveMap = null;
    mat.metalness = 0;
    mat.roughness = 0.35;
    mat.emissive.setHex(0x000000);
    mat.emissiveIntensity = 0;
    switch (key) {
      case 'wood':
        mat.color.setHex(0xffffff);
        mat.map = woodGrain();
        mat.roughness = 0.7;
        break;
      case 'frost':
        mat.color.setHex(0xc4ecff);
        mat.roughness = 0.08;
        mat.metalness = 0.15;
        mat.emissive.setHex(0x5fcfff);
        mat.emissiveIntensity = 0.25;
        break;
      case 'rainbow':
        mat.color.setHex(0xffffff);
        mat.map = rainbowBands();
        mat.roughness = 0.3;
        break;
      case 'lava':
        mat.color.setHex(0x2a1712);
        mat.roughness = 0.85;
        mat.emissive.setHex(0xffffff);
        mat.emissiveMap = lavaCracks();
        mat.emissiveIntensity = 1.3;
        break;
      case 'diamond':
        mat.color.setHex(0xffffff);
        mat.map = facets();
        mat.metalness = 1;
        mat.roughness = 0.05;
        mat.emissive.setHex(0x9fe8ff);
        mat.emissiveIntensity = 0.2;
        break;
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
