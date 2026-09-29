import * as THREE from 'three';

/**
 * Body shapes and the four inside-joke characters (the Body slot in the locker). Everything here
 * is looks only: the hitbox never changes. A character is a body shape, an optional painted outfit
 * (torso and sleeves, with the head left in the player's own color so teams stay readable), and
 * a few props that ride on the face, the head or the free hand.
 *
 *  - BOR: short, absurdly jacked, black-and-white checkered button-down with a chest patch, and
 *    never without his giant syringe (full of AIR, this is an inflatable game).
 *  - ABAG: famous for chasing people down. The nose knows (and sniffs).
 *  - SOL: all-black crewneck and sweats with AMIRI across the chest. Farts constantly.
 *  - KESTY: a robot. Metal plating, chest lights, antenna, bolts, and a visor that scans.
 * Face scans go on any of them, so each friend can wear his own face.
 */

export interface BodyShape {
  /** Multipliers on the tube's radius, length, head size and arm thickness. */
  radius: number;
  length: number;
  head: number;
  arm: number;
  /** Radius multiplier up the body below the head (v: 0 at the base, 1 where the head starts). */
  profile?: (v: number) => number;
  /** Cross-section: radius multiplier by angle around the body (0 = the front). Round without. */
  section?: (a: number) => number;
}

const CLASSIC: BodyShape = { radius: 1, length: 1, head: 1, arm: 1 };

/** A round bump of height h centered at c, w wide (0 outside it). */
const bump = (v: number, c: number, w: number, h: number) => Math.sqrt(Math.max(0, 1 - ((v - c) / w) ** 2)) * h;

/** A rounded square (superellipse), flat side to the front. */
const squircle = (a: number) => {
  const n = 8;
  return 1 / Math.pow(Math.abs(Math.cos(a)) ** n + Math.abs(Math.sin(a)) ** n, 1 / n);
};

export const BODY_SHAPES: Record<string, BodyShape> = {
  classic: CLASSIC,
  chonk: { radius: 1.3, length: 0.86, head: 1.06, arm: 1.2 },
  noodle: { radius: 0.76, length: 1.1, head: 0.88, arm: 0.8 },
  bighead: { radius: 0.94, length: 0.95, head: 1.38, arm: 1 },
  // Different kinds of body, not just different sizes.
  blocky: { radius: 1.05, length: 0.95, head: 1.02, arm: 1.1, section: squircle },
  star: { radius: 1.05, length: 1, head: 1, arm: 1, section: (a) => 1 + 0.24 * Math.cos(5 * a) },
  snowman: { radius: 1, length: 0.95, head: 1.05, arm: 0.85, profile: (v) => Math.max(0.42, bump(v, 0.24, 0.3, 1.6), bump(v, 0.68, 0.22, 1.2)) },
  beads: { radius: 0.9, length: 1.05, head: 1, arm: 0.9, profile: (v) => 0.62 + 0.55 * Math.abs(Math.sin(v * Math.PI * 3.5 + 0.3)) },
  pear: { radius: 1, length: 0.92, head: 0.92, arm: 0.95, profile: (v) => 1.7 - 0.95 * v },
  ghost: { radius: 1.05, length: 0.95, head: 1.1, arm: 0.8, profile: (v) => 1 + 0.75 * Math.max(0, 1 - v * 2.4) ** 2, section: (a) => 1 + 0.06 * Math.cos(7 * a) },
  hourglass: { radius: 1.05, length: 1, head: 1, arm: 1, profile: (v) => 1.4 - 0.7 * Math.sin(Math.min(1, v * 1.15) * Math.PI) },
  bor: { radius: 1.24, length: 0.86, head: 1, arm: 2 },
  abag: { radius: 0.96, length: 1.03, head: 1, arm: 1 },
  sol: { radius: 1.22, length: 0.97, head: 1, arm: 1.15 },
  kesty: { radius: 1.08, length: 1, head: 1.02, arm: 1.12 },
};

export function bodyShape(body: string): BodyShape {
  return BODY_SHAPES[body] ?? CLASSIC;
}

/** Bodies that wear a painted outfit instead of the pattern. */
export function hasOutfit(body: string): boolean {
  return body === 'bor' || body === 'sol' || body === 'kesty';
}

/** Robots are shiny. */
export function outfitShine(body: string): { metal: number; rough: number } {
  return body === 'kesty' ? { metal: 0.65, rough: 0.32 } : { metal: 0, rough: 0.45 };
}

// --- Painted outfits ------------------------------------------------------------------------
// The tube's texture wraps once around (x) and runs from the base (bottom) to the top of the head
// (top). Outfits are painted with the front of the body in the middle of the canvas, then shifted
// so that lands on the front of the tube.

const W = 512;
const H = 512;
/** Canvas y for a height along the tube (0 = base, 1 = top of the head). */
const yAt = (v: number) => (1 - v) * H;

const outfitCache = new Map<string, { body: THREE.CanvasTexture; arm: THREE.CanvasTexture }>();

function canvas(w = W, h = H): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function toTexture(c: HTMLCanvasElement, frontCentered: boolean): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.anisotropy = 4;
  // The tube's u = 0 is its front; the canvas has the front in the middle.
  if (frontCentered) t.offset.x = 0.5;
  return t;
}

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

/** Body and sleeve textures for an outfit, with the head and hands in `color`. */
export function outfitTextures(body: string, color: number): { body: THREE.CanvasTexture; arm: THREE.CanvasTexture } | null {
  if (!hasOutfit(body) || typeof document === 'undefined') return null;
  const key = `${body}|${color}`;
  const hit = outfitCache.get(key);
  if (hit) return hit;
  const skin = hex(color);
  const [bc, b] = canvas();
  const [ac, a] = canvas(128, 256);
  if (body === 'sol') paintSol(b, a, skin);
  else if (body === 'bor') paintBor(b, a, skin);
  else paintKesty(b, a, skin);
  const out = { body: toTexture(bc, true), arm: toTexture(ac, false) };
  outfitCache.set(key, out);
  if (outfitCache.size > 48) {
    const [k, old] = outfitCache.entries().next().value!;
    outfitCache.delete(k);
    old.body.dispose();
    old.arm.dispose();
  }
  return out;
}

/** SOL: all-black crewneck and sweatpants, AMIRI across the chest in white serif caps. */
function paintSol(b: CanvasRenderingContext2D, a: CanvasRenderingContext2D, skin: string): void {
  const shirt = '#141418';
  const pants = '#1b1b20';
  const white = '#f4f1ea';
  b.fillStyle = skin;
  b.fillRect(0, 0, W, H);
  // Sweatpants up to the waist, crewneck up to the neck.
  b.fillStyle = pants;
  b.fillRect(0, yAt(0.29), W, H);
  b.fillStyle = shirt;
  b.fillRect(0, yAt(0.61), W, yAt(0.29) - yAt(0.61));
  // Ribbed collar, waistband and a side seam on the pants.
  b.fillStyle = '#26262d';
  b.fillRect(0, yAt(0.625), W, yAt(0.6) - yAt(0.625));
  b.fillRect(0, yAt(0.305), W, yAt(0.285) - yAt(0.305));
  b.strokeStyle = 'rgba(255,255,255,0.05)';
  b.lineWidth = 2;
  for (let x = 0; x < W; x += 6) {
    b.beginPath();
    b.moveTo(x, yAt(0.625));
    b.lineTo(x, yAt(0.6));
    b.moveTo(x, yAt(0.305));
    b.lineTo(x, yAt(0.285));
    b.stroke();
  }
  // Drawstrings.
  b.strokeStyle = white;
  b.lineWidth = 3;
  for (const dx of [-7, 7]) {
    b.beginPath();
    b.moveTo(W / 2 + dx, yAt(0.29));
    b.lineTo(W / 2 + dx * 1.4, yAt(0.23));
    b.stroke();
  }
  // AMIRI in wide white serif caps high on the chest (the gun is held lower), then a bar broken
  // by a little round badge.
  const cy = yAt(0.565);
  b.fillStyle = white;
  b.textAlign = 'center';
  b.textBaseline = 'middle';
  b.font = 'bold 44px Georgia, "Times New Roman", serif';
  const letters = 'AMIRI';
  const gap = 34;
  for (let i = 0; i < letters.length; i++) b.fillText(letters[i], W / 2 + (i - (letters.length - 1) / 2) * gap, cy);
  const barY = cy + 34;
  b.fillRect(W / 2 - 150, barY - 4, 124, 8);
  b.fillRect(W / 2 + 26, barY - 4, 124, 8);
  b.beginPath();
  b.arc(W / 2, barY, 14, 0, Math.PI * 2);
  b.fill();
  b.fillStyle = shirt;
  b.font = 'bold 20px Georgia, serif';
  b.fillText('A', W / 2, barY + 1);
  // And big across the back (that's the side most people see), split over the seam.
  b.fillStyle = white;
  b.font = 'bold 56px Georgia, "Times New Roman", serif';
  for (const x of [0, W]) b.fillText('AMIRI', x, yAt(0.46));
  for (const x of [0, W]) b.fillRect(x - 70, yAt(0.46) + 36, 140, 7);
  // Small AMIRI on the left thigh.
  b.fillStyle = white;
  b.font = 'bold 18px Georgia, serif';
  const tx = W / 2 + 52;
  b.fillText('AMIRI', tx, yAt(0.18));
  b.fillRect(tx - 30, yAt(0.18) + 14, 60, 4);
  // Sleeves: black to the wrist with a ribbed cuff, then the hand.
  a.fillStyle = shirt;
  a.fillRect(0, 0, 128, 256);
  a.fillStyle = '#26262d';
  a.fillRect(0, 256 * 0.12, 128, 18);
  a.fillStyle = skin;
  a.fillRect(0, 0, 128, 256 * 0.12);
}

/** BOR: black-and-white checkered button-down with a chest patch, and jeans. */
function paintBor(b: CanvasRenderingContext2D, a: CanvasRenderingContext2D, skin: string): void {
  b.fillStyle = skin;
  b.fillRect(0, 0, W, H);
  // Jeans and a belt.
  b.fillStyle = '#2c4a78';
  b.fillRect(0, yAt(0.22), W, H);
  b.fillStyle = '#3a2416';
  b.fillRect(0, yAt(0.235), W, yAt(0.205) - yAt(0.235));
  b.fillStyle = '#e8c048';
  b.fillRect(W / 2 - 12, yAt(0.237), 24, yAt(0.203) - yAt(0.237));
  // The checkered shirt.
  const top = yAt(0.61);
  const bottom = yAt(0.235);
  const sq = 22;
  for (let y = top; y < bottom; y += sq) {
    for (let x = 0; x < W; x += sq) {
      b.fillStyle = (Math.floor(x / sq) + Math.floor((y - top) / sq)) % 2 ? '#111114' : '#f6f6f2';
      b.fillRect(x, y, sq, Math.min(sq, bottom - y));
    }
  }
  // Collar points and the button placket down the front.
  b.fillStyle = '#f6f6f2';
  b.strokeStyle = '#111114';
  b.lineWidth = 3;
  for (const s of [-1, 1]) {
    b.beginPath();
    b.moveTo(W / 2, top + 30);
    b.lineTo(W / 2 + s * 46, top - 2);
    b.lineTo(W / 2 + s * 10, top - 2);
    b.closePath();
    b.fill();
    b.stroke();
  }
  b.fillStyle = '#f6f6f2';
  b.fillRect(W / 2 - 9, top + 26, 18, bottom - top - 26);
  b.strokeRect(W / 2 - 9, top + 26, 18, bottom - top - 26);
  b.fillStyle = '#1d1b3a';
  for (let y = top + 44; y < bottom - 10; y += 30) {
    b.beginPath();
    b.arc(W / 2, y, 4, 0, Math.PI * 2);
    b.fill();
  }
  // Chest patch on his left side: a red badge with a white star.
  const px = W / 2 + 58;
  const py = top + 58;
  b.fillStyle = '#ffffff';
  roundRect(b, px - 26, py - 20, 52, 40, 8);
  b.fill();
  b.fillStyle = '#d7263d';
  roundRect(b, px - 22, py - 16, 44, 32, 6);
  b.fill();
  star(b, px, py, 11, 5, '#ffffff');
  // Short checkered sleeves, then big bare arms.
  a.fillStyle = skin;
  a.fillRect(0, 0, 128, 256);
  const sleeveTop = 256 * 0.66;
  for (let y = sleeveTop; y < 256; y += 16) {
    for (let x = 0; x < 128; x += 16) {
      a.fillStyle = (x / 16 + Math.floor((y - sleeveTop) / 16)) % 2 ? '#111114' : '#f6f6f2';
      a.fillRect(x, y, 16, 16);
    }
  }
}

/** KESTY: brushed metal plating with seams and rivets, a chest panel with lights. */
function paintKesty(b: CanvasRenderingContext2D, a: CanvasRenderingContext2D, skin: string): void {
  const g = b.createLinearGradient(0, 0, W, 0);
  g.addColorStop(0, '#9aa3b0');
  g.addColorStop(0.5, '#d5dbe3');
  g.addColorStop(1, '#9aa3b0');
  b.fillStyle = g;
  b.fillRect(0, 0, W, H);
  // Brushed streaks.
  b.globalAlpha = 0.08;
  for (let i = 0; i < 90; i++) {
    b.fillStyle = i % 2 ? '#ffffff' : '#000000';
    b.fillRect(0, Math.random() * H, W, 1);
  }
  b.globalAlpha = 1;
  // Plates: horizontal seams with rivets, and a colored band at the neck in the player's color.
  b.strokeStyle = '#5d6572';
  b.lineWidth = 3;
  for (const v of [0.14, 0.3, 0.46, 0.62, 0.8]) {
    const y = yAt(v);
    b.beginPath();
    b.moveTo(0, y);
    b.lineTo(W, y);
    b.stroke();
    b.fillStyle = '#7b8492';
    for (let x = 10; x < W; x += 32) {
      b.beginPath();
      b.arc(x, y + 7, 3, 0, Math.PI * 2);
      b.fill();
    }
  }
  b.fillStyle = skin;
  b.fillRect(0, yAt(0.64), W, yAt(0.62) - yAt(0.64));
  // Chest panel: a dark screen with three lights and a speaker grille.
  const px = W / 2 - 52;
  const py = yAt(0.58);
  b.fillStyle = '#23272f';
  roundRect(b, px, py, 104, 70, 10);
  b.fill();
  b.strokeStyle = '#c9d0da';
  b.stroke();
  const lights = [skin, '#ffd60a', '#5ee05e'];
  lights.forEach((c, i) => {
    b.fillStyle = c;
    b.beginPath();
    b.arc(px + 22 + i * 30, py + 22, 8, 0, Math.PI * 2);
    b.fill();
  });
  b.fillStyle = '#4a515c';
  for (let i = 0; i < 6; i++) b.fillRect(px + 14 + i * 14, py + 42, 8, 18);
  // A serial number on the back.
  b.fillStyle = '#4a515c';
  b.font = 'bold 18px monospace';
  b.textAlign = 'center';
  b.fillText('KSTY-9000', W * 0.02 + 60, yAt(0.38));
  // Arms: an accordion hose with a metal hand.
  for (let y = 0; y < 256; y += 12) {
    a.fillStyle = (y / 12) % 2 ? '#8e97a4' : '#c3cad4';
    a.fillRect(0, y, 128, 12);
  }
  a.fillStyle = '#6c7582';
  a.fillRect(0, 0, 128, 256 * 0.12);
}

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function star(c: CanvasRenderingContext2D, x: number, y: number, outer: number, inner: number, fill: string): void {
  c.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? inner : outer;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    c.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  c.closePath();
  c.fillStyle = fill;
  c.fill();
}

// --- Props ------------------------------------------------------------------------------------

export interface CharacterProps {
  /** Rides on the face (+z out of the face, +y up the head). */
  face: THREE.Group | null;
  /** Face parts hidden under a face scan (KESTY's visor). */
  faceCartoonOnly: THREE.Group | null;
  /** Held in the free hand, pointing along the arm. */
  hand: THREE.Group | null;
  /** Hides the cartoon eyes (KESTY's visor covers them). */
  coversEyes: boolean;
  animate(t: number, dt: number, moving: number): void;
  dispose(): void;
}

const mat = (color: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.4, ...extra });

/** Builds the character's props (null for bodies without any). */
export function buildProps(body: string, color: number): CharacterProps | null {
  const mats: THREE.Material[] = [];
  const geos: THREE.BufferGeometry[] = [];
  const m = (c: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) => {
    const x = mat(c, extra);
    mats.push(x);
    return x;
  };
  const gm = <G extends THREE.BufferGeometry>(g: G): G => {
    geos.push(g);
    return g;
  };
  const dispose = () => {
    for (const x of mats) x.dispose();
    for (const g of geos) g.dispose();
  };
  if (body === 'abag') {
    // The nose: a big round honker with nostrils, and a sweatband for the chase.
    const face = new THREE.Group();
    const nose = new THREE.Group();
    const skin = m(0xf2a07b, { roughness: 0.35 });
    const bulb = new THREE.Mesh(gm(new THREE.SphereGeometry(0.16, 20, 16)), skin);
    bulb.scale.set(1, 0.95, 1.9);
    bulb.position.z = 0.17;
    const tip = new THREE.Mesh(gm(new THREE.SphereGeometry(0.13, 16, 12)), skin);
    tip.position.set(0, -0.03, 0.44);
    const nostril = gm(new THREE.SphereGeometry(0.035, 10, 8));
    const dark = m(0x3a1a14);
    for (const s of [-1, 1]) {
      const h = new THREE.Mesh(nostril, dark);
      h.position.set(s * 0.05, -0.12, 0.47);
      nose.add(h);
    }
    nose.add(bulb, tip);
    nose.position.set(0, -0.06, 0.02);
    const band = new THREE.Mesh(gm(new THREE.TorusGeometry(0.35, 0.036, 10, 32)), m(0xe8363e, { roughness: 0.8 }));
    band.rotation.x = Math.PI / 2;
    band.position.set(0, 0.14, -0.31);
    face.add(nose, band);
    let sniffT = 0;
    return {
      face,
      faceCartoonOnly: null,
      hand: null,
      coversEyes: false,
      animate(t, dt, moving) {
        // Sniffs every couple of seconds, faster when on the move (he's chasing someone).
        sniffT += dt * (1 + moving * 1.5);
        const s = 1 + Math.max(0, Math.sin(sniffT * 9)) * 0.12 * (Math.sin(sniffT * 0.9) > 0.3 ? 1 : 0);
        nose.scale.set(s, s, 1 + (s - 1) * 1.6);
        nose.rotation.y = Math.sin(t * 2.2) * 0.08;
      },
      dispose,
    };
  }
  if (body === 'bor') {
    // The syringe: glass barrel of bright blue AIR, a white label, plunger and needle.
    const hand = new THREE.Group();
    const glass = new THREE.Mesh(gm(new THREE.CylinderGeometry(0.075, 0.075, 0.46, 16, 1, true)), m(0xdff6ff, { transparent: true, opacity: 0.45, roughness: 0.05, side: THREE.DoubleSide }));
    const air = new THREE.Mesh(gm(new THREE.CylinderGeometry(0.062, 0.062, 0.34, 14)), m(0x2ec5ff, { emissive: 0x1a8fd0, emissiveIntensity: 0.6, roughness: 0.2 }));
    air.position.y = 0.05;
    const label = new THREE.Mesh(gm(new THREE.CylinderGeometry(0.078, 0.078, 0.1, 16, 1, true)), m(0xffffff, { roughness: 0.6 }));
    label.position.y = 0.02;
    const cap = gm(new THREE.CylinderGeometry(0.08, 0.08, 0.03, 16));
    const grey = m(0xc8ced8, { metalness: 0.6, roughness: 0.3 });
    const back = new THREE.Mesh(cap, grey);
    back.position.y = -0.23;
    const front = new THREE.Mesh(cap, grey);
    front.position.y = 0.23;
    const rod = new THREE.Mesh(gm(new THREE.CylinderGeometry(0.02, 0.02, 0.2, 8)), grey);
    rod.position.y = -0.33;
    const thumb = new THREE.Mesh(gm(new THREE.CylinderGeometry(0.07, 0.07, 0.025, 16)), grey);
    thumb.position.y = -0.43;
    const needle = new THREE.Mesh(gm(new THREE.CylinderGeometry(0.008, 0.012, 0.22, 6)), m(0xe8eef6, { metalness: 0.9, roughness: 0.15 }));
    needle.position.y = 0.35;
    const syringe = new THREE.Group();
    syringe.add(glass, air, label, back, front, rod, thumb, needle);
    hand.add(syringe);
    return {
      face: null,
      faceCartoonOnly: null,
      hand,
      coversEyes: false,
      animate(t) {
        // A little pump of the plunger now and then.
        const k = Math.max(0, Math.sin(t * 1.4)) ** 6;
        rod.position.y = -0.33 + k * 0.08;
        thumb.position.y = -0.43 + k * 0.08;
        air.scale.y = 1 - k * 0.2;
      },
      dispose,
    };
  }
  if (body === 'kesty') {
    const face = new THREE.Group();
    const steel = m(0xb9c1cc, { metalness: 0.8, roughness: 0.25 });
    // Antenna with a blinking bulb, and bolts on the sides of the head.
    const antenna = new THREE.Group();
    const stalk = new THREE.Mesh(gm(new THREE.CylinderGeometry(0.018, 0.018, 0.34, 8)), steel);
    stalk.position.y = 0.17;
    const bulbMat = m(0xff2d55, { emissive: 0xff2d55, emissiveIntensity: 1 });
    const bulb = new THREE.Mesh(gm(new THREE.SphereGeometry(0.06, 14, 10)), bulbMat);
    bulb.position.y = 0.36;
    antenna.add(stalk, bulb);
    antenna.position.set(0, 0.42, -0.34);
    const boltGeo = gm(new THREE.CylinderGeometry(0.09, 0.09, 0.08, 6));
    for (const s of [-1, 1]) {
      const bolt = new THREE.Mesh(boltGeo, steel);
      bolt.rotation.z = Math.PI / 2;
      bolt.position.set(s * 0.4, 0, -0.3);
      face.add(bolt);
    }
    // The visor (only without a face scan): dark glass with a red dot scanning side to side.
    const visor = new THREE.Group();
    const glass = new THREE.Mesh(gm(new THREE.BoxGeometry(0.5, 0.14, 0.06)), m(0x14161c, { metalness: 0.3, roughness: 0.1 }));
    const dotMat = m(0xff3040, { emissive: 0xff3040, emissiveIntensity: 1.6 });
    const dot = new THREE.Mesh(gm(new THREE.SphereGeometry(0.035, 10, 8)), dotMat);
    dot.position.z = 0.035;
    visor.add(glass, dot);
    visor.position.set(0, 0.02, 0.06);
    const mouth = new THREE.Mesh(gm(new THREE.BoxGeometry(0.22, 0.05, 0.03)), m(0x14161c));
    mouth.position.set(0, -0.2, 0.03);
    visor.add(mouth);
    face.add(antenna, visor);
    return {
      face,
      faceCartoonOnly: visor,
      hand: null,
      coversEyes: true,
      animate(t) {
        dot.position.x = Math.sin(t * 2.6) * 0.2;
        bulbMat.emissiveIntensity = Math.sin(t * 6) > 0 ? 1.4 : 0.15;
        antenna.rotation.z = Math.sin(t * 3.1) * 0.12;
      },
      dispose,
    };
  }
  return null;
}

/** Where SOL's constant little farts come out (behind the base), for the effects system. */
export const FART_INTERVAL: [min: number, max: number] = [1.6, 3.6];
