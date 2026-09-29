import * as THREE from 'three';
import type { PartsInput, WeaponId } from '../../shared/loadout';
import { inflationScale } from '../../shared/player';
import { buildFacePhoto, disposeFacePhoto } from './facePhoto';
import type { TubeManPose } from './tubeMan';
import { type WeaponModel, buildWeaponModel, weaponLookKey } from './weapons';

/**
 * The regulars as people: popping an ult turns you into BOR, ABAG, SOL or KESTY, a big human
 * body in their clothes (nothing of your own look carries over). Built from simple shapes and
 * painted canvas textures, animated from the same pose as a tube man: walking, flying, aiming,
 * plus each one's ult pose (BOR flexes, ABAG leans into the chase, SOL bends over, KESTY jerks
 * around like a robot). The face is a cartoon one unless the real person lent theirs (a face
 * scan they claimed for their character, which an admin approved).
 *
 * Local space: feet at the origin, facing +Z, about 1.9 tall before `spec.scale`.
 */
export type HumanKey = 'bor' | 'abag' | 'sol' | 'kesty';

export function isHumanKey(k: string): k is HumanKey {
  return k === 'bor' || k === 'abag' || k === 'sol' || k === 'kesty';
}

interface Spec {
  /** Overall size (1 = a 1.9 m person; a tube man is about 2.4, so these tower over them). */
  scale: number;
  legLen: number;
  legR: number;
  torsoH: number;
  waistR: number;
  chestR: number;
  armR: number;
  upper: number;
  fore: number;
  headR: number;
  skin: number;
  hair: number;
}

const SPECS: Record<HumanKey, Spec> = {
  // Short and very jacked.
  bor: { scale: 1.85, legLen: 0.74, legR: 0.1, torsoH: 0.64, waistR: 0.17, chestR: 0.29, armR: 0.085, upper: 0.29, fore: 0.26, headR: 0.15, skin: 0xd49b82, hair: 0x3b2618 },
  // Tall, lean runner.
  abag: { scale: 2.05, legLen: 0.96, legR: 0.075, torsoH: 0.62, waistR: 0.14, chestR: 0.19, armR: 0.052, upper: 0.32, fore: 0.29, headR: 0.15, skin: 0xbc876c, hair: 0x2a1c14 },
  sol: { scale: 1.95, legLen: 0.9, legR: 0.1, torsoH: 0.62, waistR: 0.23, chestR: 0.27, armR: 0.072, upper: 0.31, fore: 0.28, headR: 0.155, skin: 0xecba9d, hair: 0x5a3a22 },
  // A robot with a face.
  kesty: { scale: 2.0, legLen: 0.92, legR: 0.085, torsoH: 0.64, waistR: 0.16, chestR: 0.23, armR: 0.065, upper: 0.31, fore: 0.28, headR: 0.155, skin: 0xc2886f, hair: 0x4a2e1c },
};

// --- Painted textures ------------------------------------------------------------------------

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function tex(c: HTMLCanvasElement, repeatU = 1): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.repeat.x = repeatU;
  t.anisotropy = 4;
  return t;
}

/** Black and white check (BOR's button-down). */
function checks(g: CanvasRenderingContext2D, w: number, h: number, cell: number): void {
  for (let y = 0; y < h; y += cell)
    for (let x = 0; x < w; x += cell) {
      g.fillStyle = ((x + y) / cell) % 2 === 0 ? '#151515' : '#f4f4f4';
      g.fillRect(x, y, cell, cell);
    }
}

/**
 * Torso textures wrap around the body with the front center at u = 0.5 (x = w / 2), the wearer's
 * left toward larger u. The top of the canvas is the shoulders.
 */
function borShirt(): THREE.CanvasTexture {
  const [c, g] = canvas(512, 256);
  checks(g, 512, 256, 16);
  // Button placket down the front, with buttons.
  g.fillStyle = '#f4f4f4';
  g.fillRect(248, 0, 16, 256);
  g.strokeStyle = '#151515';
  g.lineWidth = 2;
  g.strokeRect(248, -2, 16, 260);
  g.fillStyle = '#d8d0c0';
  for (let y = 22; y < 256; y += 34) {
    g.beginPath();
    g.arc(256, y, 4, 0, Math.PI * 2);
    g.fill();
  }
  // Chest patch on the wearer's left.
  g.fillStyle = '#1d2a4a';
  g.fillRect(290, 46, 44, 38);
  g.strokeStyle = '#c9a34a';
  g.lineWidth = 3;
  g.strokeRect(293, 49, 38, 32);
  g.fillStyle = '#c9a34a';
  g.font = 'bold 18px sans-serif';
  g.textAlign = 'center';
  g.fillText('B', 312, 72);
  return tex(c);
}

function denim(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#3a5a8a';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1400; i++) {
    g.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,30,0.08)';
    g.fillRect(Math.random() * 256, Math.random() * 256, 2, 5);
  }
  // Side seams.
  g.fillStyle = '#c9a34a';
  g.fillRect(62, 0, 2, 256);
  g.fillRect(190, 0, 2, 256);
  return tex(c);
}

function polo(): THREE.CanvasTexture {
  const [c, g] = canvas(512, 256);
  g.fillStyle = '#1f2a44';
  g.fillRect(0, 0, 512, 256);
  // Placket with three buttons.
  g.fillStyle = '#18213a';
  g.fillRect(247, 0, 18, 70);
  g.fillStyle = '#e8e8e8';
  for (const y of [16, 36, 56]) {
    g.beginPath();
    g.arc(256, y, 3.5, 0, Math.PI * 2);
    g.fill();
  }
  // Subtle knit.
  for (let y = 0; y < 256; y += 4) {
    g.fillStyle = 'rgba(255,255,255,0.03)';
    g.fillRect(0, y, 512, 1);
  }
  return tex(c);
}

function solid(color: string, noise = 0.04): THREE.CanvasTexture {
  const [c, g] = canvas(128, 128);
  g.fillStyle = color;
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 300; i++) {
    g.fillStyle = `rgba(255,255,255,${noise * Math.random()})`;
    g.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
  }
  return tex(c);
}

/** AMIRI logo: the word, two bars and the M monogram between them. */
function amiriLogo(g: CanvasRenderingContext2D, cx: number, cy: number, s: number): void {
  g.fillStyle = '#f2ede2';
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  g.font = `bold ${Math.round(46 * s)}px Georgia, 'Times New Roman', serif`;
  g.fillText('AMIRI', cx, cy);
  const barY = cy + 14 * s;
  g.fillRect(cx - 110 * s, barY, 88 * s, 7 * s);
  g.fillRect(cx + 22 * s, barY, 88 * s, 7 * s);
  g.font = `bold ${Math.round(24 * s)}px Georgia, serif`;
  g.fillText('M', cx, barY + 12 * s);
}

function amiriCrew(): THREE.CanvasTexture {
  const [c, g] = canvas(1024, 512);
  g.fillStyle = '#121212';
  g.fillRect(0, 0, 1024, 512);
  // Ribbed hem.
  g.fillStyle = '#0b0b0b';
  for (let x = 0; x < 1024; x += 6) g.fillRect(x, 470, 3, 42);
  amiriLogo(g, 512, 170, 1.25);
  return tex(c);
}

/** Sweatpants: black, AMIRI on the front of this leg when `logo`. Front at u = 0.5. */
function amiriPants(logo: boolean): THREE.CanvasTexture {
  const [c, g] = canvas(512, 512);
  g.fillStyle = '#121212';
  g.fillRect(0, 0, 512, 512);
  if (logo) {
    g.save();
    g.translate(256, 150);
    amiriLogo(g, 0, 0, 0.7);
    g.restore();
  }
  return tex(c);
}

function joggers(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#6f7482';
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = '#ffffff';
  g.fillRect(60, 0, 6, 256);
  g.fillRect(188, 0, 6, 256);
  return tex(c);
}

/** Brushed metal plates with rivets; `panel` adds KESTY's chest panel. */
function metal(panel: boolean): THREE.CanvasTexture {
  const [c, g] = canvas(512, 256);
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#dfe5ee');
  grad.addColorStop(1, '#9aa4b4');
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 256);
  for (let i = 0; i < 500; i++) {
    g.fillStyle = 'rgba(255,255,255,0.12)';
    g.fillRect(Math.random() * 512, Math.random() * 256, 20, 1);
  }
  g.strokeStyle = 'rgba(40,48,64,0.55)';
  g.lineWidth = 2;
  for (const x of [64, 192, 320, 448]) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, 256);
    g.stroke();
  }
  g.beginPath();
  g.moveTo(0, 128);
  g.lineTo(512, 128);
  g.stroke();
  g.fillStyle = '#6b7486';
  for (const x of [72, 184, 328, 440]) for (const y of [12, 116, 140, 244]) {
    g.beginPath();
    g.arc(x, y, 3.5, 0, Math.PI * 2);
    g.fill();
  }
  if (panel) {
    g.fillStyle = '#1d2433';
    g.fillRect(196, 40, 120, 96);
    g.strokeStyle = '#6fe0ff';
    g.strokeRect(200, 44, 112, 88);
    const lights = ['#ff3b5c', '#ffd60a', '#5ee05e', '#2ec5ff'];
    lights.forEach((col, i) => {
      g.fillStyle = col;
      g.beginPath();
      g.arc(222 + i * 23, 70, 7, 0, Math.PI * 2);
      g.fill();
    });
    g.fillStyle = '#6fe0ff';
    g.font = 'bold 17px monospace';
    g.textAlign = 'center';
    g.fillText('KSTY-9000', 256, 112);
  }
  return tex(c);
}

// --- The model -------------------------------------------------------------------------------

type Mat = THREE.MeshStandardMaterial;

const photoLoader = new THREE.TextureLoader();
const photos = new Map<HumanKey, THREE.Texture>();

/**
 * Each regular's own photo (they sent it for their character), cropped to the face with a soft
 * oval edge so it blends into the head. Shared by every copy of that character.
 */
export function characterPhoto(key: HumanKey): THREE.Texture {
  let t = photos.get(key);
  if (!t) {
    t = photoLoader.load(`/characters/${key}.webp`);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    photos.set(key, t);
  }
  return t;
}

/** URL of a character's photo (for the ult splash). */
export function characterPhotoUrl(key: string): string | null {
  return isHumanKey(key) ? `/characters/${key}.webp` : null;
}

/**
 * The front of the head, just outside the skull, with the photo projected straight on: eyes a
 * little above the middle, chin at the bottom of the head, the soft edge fading into the skin.
 */
function faceCap(r: number): THREE.BufferGeometry {
  const R = r * 1.015;
  const g = new THREE.SphereGeometry(R, 40, 30, Math.PI * 0.06, Math.PI * 0.88, Math.PI * 0.06, Math.PI * 0.88);
  const pos = g.attributes.position;
  const uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) / R;
    const y = pos.getY(i) / R;
    uv.setXY(i, 0.5 + x * 0.45, 0.62 + (y - 0.1) * 0.55);
  }
  uv.needsUpdate = true;
  return g;
}

interface Limb {
  /** Shoulder or hip joint. */
  root: THREE.Group;
  /** Elbow or knee joint. */
  mid: THREE.Group;
}

export class Human {
  readonly group = new THREE.Group();
  readonly key: HumanKey;
  private readonly spec: Spec;
  private readonly mats: THREE.Material[] = [];
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly texs: THREE.Texture[] = [];
  private readonly body = new THREE.Group();
  private readonly hips = new THREE.Group();
  private readonly torso = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly face = new THREE.Group();
  /** A lent face scan (a disc with a rim), or the character's own photo (`photoCap`). */
  private photo: THREE.Group | null = null;
  private photoCap: THREE.Mesh | null = null;
  private readonly arms: [Limb, Limb];
  private readonly legs: [Limb, Limb];
  private readonly gunMount = new THREE.Group();
  private gun: WeaponModel | null = null;
  private gunKey = '';
  private nose: THREE.Object3D | null = null;
  private eyes: THREE.Mesh[] = [];
  private robotEyes: THREE.Mesh[] = [];
  private antennaTip: THREE.Mesh | null = null;
  private readonly biceps: THREE.Mesh[] = [];
  private stride = 0;
  private age = 0;
  private lean = 0;
  private bend = 0;

  constructor(key: HumanKey) {
    this.key = key;
    this.spec = SPECS[key];
    const s = this.spec;
    const skin = this.mat(s.skin, 0.75);
    const shirt = this.shirtMat();
    const sleeve = this.sleeveMat(shirt);
    const lower = this.lowerMat(skin, sleeve);

    // Hips at the top of the legs; the torso pivots there (SOL bends over from it).
    this.hips.position.y = s.legLen;
    this.body.add(this.hips);
    this.hips.add(this.torso);

    // Pelvis.
    const pants = this.pantsMat(false);
    const pelvis = this.mesh(new THREE.SphereGeometry(1, 20, 12), pants);
    pelvis.scale.set(s.waistR * 1.08, 0.13, s.waistR * 0.78);
    pelvis.position.y = 0.02;
    this.torso.add(pelvis);

    // Torso: a lathe from waist to shoulders, flattened front to back.
    const T = s.torsoH;
    const prof = [
      new THREE.Vector2(0.001, -0.02),
      new THREE.Vector2(s.waistR, 0),
      new THREE.Vector2(s.waistR * 1.04, T * 0.3),
      new THREE.Vector2(s.chestR * 0.95, T * 0.62),
      new THREE.Vector2(s.chestR, T * 0.8),
      new THREE.Vector2(s.chestR * 0.9, T * 0.94),
      new THREE.Vector2(s.chestR * 0.45, T * 1.0),
      new THREE.Vector2(0.001, T * 1.01),
    ];
    const torsoMesh = this.mesh(new THREE.LatheGeometry(prof, 28, Math.PI), shirt);
    torsoMesh.scale.z = key === 'bor' ? 0.72 : 0.64;
    this.torso.add(torsoMesh);
    if (key === 'bor') {
      // Pecs and traps.
      for (const side of [-1, 1]) {
        const pec = this.mesh(new THREE.SphereGeometry(1, 16, 10), shirt);
        pec.scale.set(0.12, 0.09, 0.07);
        pec.position.set(side * 0.1, T * 0.74, s.chestR * 0.6);
        this.torso.add(pec);
      }
      const traps = this.mesh(new THREE.SphereGeometry(1, 16, 10), shirt);
      traps.scale.set(0.2, 0.08, 0.12);
      traps.position.y = T * 0.97;
      this.torso.add(traps);
    }

    // Neck and head.
    const neckY = T * 0.98;
    const neck = this.mesh(new THREE.CylinderGeometry(s.headR * (key === 'bor' ? 0.62 : 0.45), s.headR * (key === 'bor' ? 0.72 : 0.52), 0.12, 14), key === 'kesty' ? this.mat(0x4a5366, 0.35, 0.8) : skin);
    neck.position.y = neckY + 0.05;
    this.torso.add(neck);
    this.head.position.y = neckY + 0.1 + s.headR * 1.05;
    this.torso.add(this.head);
    this.buildHead(skin);
    this.buildCollar(shirt);

    // Arms from the shoulders; legs from the hips.
    const shoulderX = s.chestR * 0.92 + s.armR * 0.55;
    this.arms = [this.buildArm(-1, shoulderX, T * 0.86, sleeve, lower, skin), this.buildArm(1, shoulderX, T * 0.86, sleeve, lower, skin)];
    this.legs = [this.buildLeg(-1, pants), this.buildLeg(1, this.pantsMat(true))];

    // Gun held forward at chest height (right hand), like the tube man's.
    this.gunMount.position.set(-shoulderX, T * 0.8, s.upper + s.fore * 0.85);
    this.torso.add(this.gunMount);
    this.buildProps(skin);

    this.body.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    this.group.add(this.body);
    this.group.scale.setScalar(s.scale);
  }

  // --- Building ------------------------------------------------------------------------------

  private mat(color: number, rough = 0.7, metal = 0, map: THREE.Texture | null = null): Mat {
    const m = new THREE.MeshStandardMaterial({ color: map ? 0xffffff : color, roughness: rough, metalness: metal, map });
    this.mats.push(m);
    return m;
  }

  private mesh(geo: THREE.BufferGeometry, mat: THREE.Material): THREE.Mesh {
    this.geos.push(geo);
    return new THREE.Mesh(geo, mat);
  }

  private tex(t: THREE.Texture): THREE.Texture {
    this.texs.push(t);
    return t;
  }

  private shirtMat(): Mat {
    switch (this.key) {
      case 'bor':
        return this.mat(0, 0.8, 0, this.tex(borShirt()));
      case 'abag':
        return this.mat(0, 0.85, 0, this.tex(polo()));
      case 'sol':
        return this.mat(0, 0.9, 0, this.tex(amiriCrew()));
      case 'kesty':
        return this.mat(0, 0.35, 0.75, this.tex(metal(true)));
    }
  }

  private sleeveMat(shirt: Mat): Mat {
    if (this.key === 'bor') {
      const t = this.tex(borShirt());
      (t as THREE.CanvasTexture).repeat.set(0.5, 0.5);
      return this.mat(0, 0.8, 0, t);
    }
    if (this.key === 'kesty') return this.mat(0, 0.35, 0.75, this.tex(metal(false)));
    return shirt.map ? this.mat(0, 0.9, 0, this.tex(solid(this.key === 'abag' ? '#1f2a44' : '#121212'))) : shirt;
  }

  /** Forearms: rolled sleeves (BOR) and short sleeves (ABAG) show skin. */
  private lowerMat(skin: Mat, sleeve: Mat): Mat {
    return this.key === 'bor' || this.key === 'abag' ? skin : sleeve;
  }

  private pantsMat(left: boolean): Mat {
    switch (this.key) {
      case 'bor':
        return this.mat(0, 0.9, 0, this.tex(denim()));
      case 'abag':
        return this.mat(0, 0.9, 0, this.tex(joggers()));
      case 'sol':
        return this.mat(0, 0.9, 0, this.tex(amiriPants(left)));
      case 'kesty':
        return this.mat(0, 0.35, 0.75, this.tex(metal(false)));
    }
  }

  private buildHead(skin: Mat): void {
    const s = this.spec;
    const r = s.headR;
    const k = this.key;
    const skull = this.mesh(new THREE.SphereGeometry(r, 24, 18), k === 'kesty' ? this.mat(0xc9d1de, 0.3, 0.8) : skin);
    skull.scale.set(0.92, 1.12, 1);
    this.head.add(skull);
    this.head.add(this.face);
    if (k === 'kesty') {
      // A robot head with a face screen in front (his face), bolts for ears and an antenna.
      const screen = this.mesh(new THREE.SphereGeometry(r * 0.86, 20, 14, Math.PI * 0.15, Math.PI * 0.7, Math.PI * 0.2, Math.PI * 0.62), skin);
      screen.position.z = r * 0.2;
      this.face.add(screen);
      for (const side of [-1, 1]) {
        const bolt = this.mesh(new THREE.CylinderGeometry(r * 0.22, r * 0.22, r * 0.2, 12), this.mat(0x6b7486, 0.3, 0.9));
        bolt.rotation.z = Math.PI / 2;
        bolt.position.x = side * r * 0.95;
        this.head.add(bolt);
      }
      const rod = this.mesh(new THREE.CylinderGeometry(0.008, 0.008, r * 1.4, 6), this.mat(0x9aa4b4, 0.3, 0.9));
      rod.position.y = r * 1.7;
      this.head.add(rod);
      this.antennaTip = this.mesh(new THREE.SphereGeometry(r * 0.2, 12, 8), new THREE.MeshStandardMaterial({ color: 0xff3b5c, emissive: 0xff3b5c, emissiveIntensity: 1 }));
      this.mats.push(this.antennaTip.material as Mat);
      this.antennaTip.position.y = r * 2.45;
      this.head.add(this.antennaTip);
    }
    // Ears.
    if (k !== 'kesty')
      for (const side of [-1, 1]) {
        const ear = this.mesh(new THREE.SphereGeometry(r * 0.22, 10, 8), skin);
        ear.scale.set(0.5, 1, 0.8);
        ear.position.set(side * r * 0.9, 0, 0);
        this.head.add(ear);
      }
    // Cartoon face (hidden under a lent face scan).
    const white = this.mat(0xffffff, 0.3);
    const dark = this.mat(0x1d1b3a, 0.4);
    for (const side of [-1, 1]) {
      const eye = this.mesh(new THREE.SphereGeometry(r * 0.2, 12, 10), white);
      eye.scale.set(1, 1.1, 0.6);
      eye.position.set(side * r * 0.36, r * 0.12, r * 0.84);
      const pupil = this.mesh(new THREE.SphereGeometry(r * 0.1, 10, 8), dark);
      pupil.position.set(side * r * 0.36, r * 0.1, r * 0.95);
      this.face.add(eye, pupil);
      this.eyes.push(eye);
      const brow = this.mesh(new THREE.BoxGeometry(r * 0.42, r * (k === 'bor' ? 0.13 : 0.08), r * 0.08), this.mat(s.hair, 0.8));
      brow.position.set(side * r * 0.36, r * 0.42, r * 0.86);
      brow.rotation.z = side * (k === 'bor' ? 0.22 : k === 'abag' ? -0.1 : 0.05);
      this.face.add(brow);
      if (k === 'kesty') {
        const glow = this.mesh(new THREE.BoxGeometry(r * 0.36, r * 0.1, r * 0.06), new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xff0000, emissiveIntensity: 1.5 }));
        this.mats.push(glow.material as Mat);
        glow.position.set(side * r * 0.34, r * 0.14, r * 1.06);
        glow.visible = false;
        this.head.add(glow);
        this.robotEyes.push(glow);
      }
    }
    const mouth = this.mesh(new THREE.TorusGeometry(r * 0.26, r * 0.045, 6, 14, Math.PI), this.mat(0x7a2a35, 0.5));
    mouth.rotation.z = Math.PI;
    mouth.position.set(0, -r * 0.3, r * 0.86);
    mouth.scale.z = 0.5;
    this.face.add(mouth);
    const g0: THREE.Object3D[] = [];
    if (k === 'abag') {
      // THE nose.
      const noseSkin = this.mat(0xe29a78, 0.6);
      const nose = this.mesh(new THREE.CapsuleGeometry(r * 0.3, r * 1.3, 6, 14), noseSkin);
      nose.rotation.x = Math.PI / 2 - 0.4;
      nose.position.set(0, -r * 0.12, r * 1.55);
      const tip = this.mesh(new THREE.SphereGeometry(r * 0.42, 16, 12), noseSkin);
      tip.position.set(0, -r * 0.42, r * 2.2);
      for (const side of [-1, 1]) {
        const nostril = this.mesh(new THREE.SphereGeometry(r * 0.1, 8, 6), this.mat(0x5a2a22, 0.8));
        nostril.position.set(side * r * 0.16, -r * 0.7, r * 2.25);
        g0.push(nostril);
      }
      const g = new THREE.Group();
      g.add(nose, tip, ...g0);
      this.head.add(g);
      this.nose = g;
    } else if (k !== 'kesty') {
      const nose = this.mesh(new THREE.SphereGeometry(r * 0.13, 10, 8), skin);
      nose.scale.set(0.9, 1, 1.2);
      nose.position.set(0, -r * 0.05, r * 1.0);
      this.face.add(nose);
    }
    this.buildHair();
  }

  private buildHair(): void {
    const s = this.spec;
    const r = s.headR;
    const hairMat = this.mat(s.hair, 0.9);
    if (this.key === 'kesty') return;
    if (this.key === 'sol') {
      // Shaggy: a cap over the top and back, and a fringe over the forehead.
      const cap = this.mesh(new THREE.SphereGeometry(r * 1.07, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.42), hairMat);
      cap.scale.set(0.95, 1.15, 1.05);
      cap.rotation.x = -0.35;
      this.head.add(cap);
      for (let i = 0; i < 7; i++) {
        const strand = this.mesh(new THREE.SphereGeometry(r * 0.2, 8, 6), hairMat);
        strand.scale.set(0.9, 1.6, 0.6);
        const a = -0.75 + i * 0.25;
        strand.position.set(Math.sin(a) * r * 0.75, r * 0.52, Math.cos(a) * r * 0.78);
        strand.rotation.z = -a * 0.6;
        this.head.add(strand);
      }
      return;
    }
    // Curly (BOR, ABAG): a mop of little curls over the top and back.
    const curl = new THREE.SphereGeometry(r * 0.24, 8, 6);
    this.geos.push(curl);
    const n = this.key === 'abag' ? 46 : 38;
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n;
      const phi = Math.acos(1 - u * 1.25);
      const th = i * 2.399;
      const x = Math.sin(phi) * Math.cos(th);
      const z = Math.sin(phi) * Math.sin(th);
      const y = Math.cos(phi);
      // Keep the forehead clear.
      if (z > 0.55 && y < 0.72) continue;
      const m = new THREE.Mesh(curl, hairMat);
      m.position.set(x * r * 1.02, y * r * 1.12 + r * 0.05, z * r * 1.02);
      m.scale.setScalar(0.85 + ((i * 37) % 10) / 25);
      this.head.add(m);
    }
    if (this.key === 'abag') {
      // A sweatband: he's always chasing someone.
      const band = this.mesh(new THREE.TorusGeometry(r * 1.0, r * 0.1, 8, 24), this.mat(0xff3b5c, 0.8));
      band.rotation.x = Math.PI / 2 - 0.2;
      band.position.set(0, r * 0.4, r * 0.05);
      this.head.add(band);
    }
  }

  private buildCollar(shirt: Mat): void {
    const s = this.spec;
    const y = s.torsoH * 0.98;
    if (this.key === 'bor' || this.key === 'abag') {
      const collar = this.mesh(new THREE.TorusGeometry(s.headR * (this.key === 'bor' ? 0.72 : 0.56), 0.02, 6, 18), this.key === 'bor' ? this.mat(0xf4f4f4, 0.8) : shirt);
      collar.rotation.x = Math.PI / 2;
      collar.position.y = y;
      this.torso.add(collar);
    }
    if (this.key === 'abag') {
      // Gold chain.
      const chain = this.mesh(new THREE.TorusGeometry(s.headR * 0.62, 0.007, 6, 28), this.mat(0xffc933, 0.25, 1));
      chain.rotation.x = Math.PI / 2 - 0.5;
      chain.position.set(0, y - 0.05, 0.035);
      this.torso.add(chain);
    }
    if (this.key === 'sol') {
      const rib = this.mesh(new THREE.TorusGeometry(s.headR * 0.55, 0.018, 6, 18), this.mat(0x0b0b0b, 0.9));
      rib.rotation.x = Math.PI / 2;
      rib.position.y = y;
      this.torso.add(rib);
    }
  }

  private buildArm(side: number, x: number, y: number, sleeve: Mat, lower: Mat, skin: Mat): Limb {
    const s = this.spec;
    const root = new THREE.Group();
    root.position.set(side * x, y, 0);
    const shoulder = this.mesh(new THREE.SphereGeometry(s.armR * 1.25, 14, 10), sleeve);
    root.add(shoulder);
    const up = this.mesh(new THREE.CapsuleGeometry(s.armR, s.upper - s.armR, 4, 12), sleeve);
    up.position.y = -s.upper / 2;
    root.add(up);
    if (this.key === 'bor') {
      const bi = this.mesh(new THREE.SphereGeometry(s.armR * 1.25, 14, 10), sleeve);
      bi.scale.set(1, 1.3, 1.05);
      bi.position.set(0, -s.upper * 0.5, s.armR * 0.35);
      root.add(bi);
      this.biceps.push(bi);
    }
    const mid = new THREE.Group();
    mid.position.y = -s.upper;
    root.add(mid);
    const fr = s.armR * (this.key === 'bor' ? 0.95 : 0.85);
    const fore = this.mesh(new THREE.CapsuleGeometry(fr, s.fore - fr, 4, 12), lower);
    fore.position.y = -s.fore / 2;
    mid.add(fore);
    if (this.key === 'kesty') {
      const joint = this.mesh(new THREE.SphereGeometry(s.armR * 1.05, 12, 8), this.mat(0x3b4252, 0.4, 0.7));
      mid.add(joint);
    }
    const hand = this.mesh(new THREE.SphereGeometry(s.armR * 1.15, 12, 10), this.key === 'kesty' ? this.mat(0x3b4252, 0.4, 0.7) : skin);
    hand.scale.set(0.9, 1.1, 1);
    hand.position.y = -s.fore;
    hand.name = 'hand';
    mid.add(hand);
    this.torso.add(root);
    return { root, mid };
  }

  private buildLeg(side: number, pants: Mat): Limb {
    const s = this.spec;
    const thighLen = s.legLen * 0.5;
    const shinLen = s.legLen * 0.46;
    const root = new THREE.Group();
    root.position.set(side * s.waistR * 0.55, s.legLen, 0);
    const thigh = this.mesh(new THREE.CapsuleGeometry(s.legR, thighLen - s.legR, 4, 14), pants);
    thigh.position.y = -thighLen / 2;
    // Put the texture's front (u = 0.5) forward, for SOL's thigh logo.
    thigh.rotation.y = Math.PI;
    root.add(thigh);
    const mid = new THREE.Group();
    mid.position.y = -thighLen;
    root.add(mid);
    const shin = this.mesh(new THREE.CapsuleGeometry(s.legR * 0.85, shinLen - s.legR, 4, 12), pants);
    shin.position.y = -shinLen / 2;
    mid.add(shin);
    if (this.key === 'kesty') mid.add(this.mesh(new THREE.SphereGeometry(s.legR * 1.1, 12, 8), this.mat(0x3b4252, 0.4, 0.7)));
    // Shoes: white sneakers (SOL), red runners (ABAG), white (BOR), metal boots (KESTY).
    const shoeCol = this.key === 'abag' ? 0xff3b5c : this.key === 'kesty' ? 0x5b6477 : 0xf4f1ea;
    const shoe = this.mesh(new THREE.BoxGeometry(s.legR * 1.6, 0.07, s.legR * 3.2), this.mat(shoeCol, 0.6, this.key === 'kesty' ? 0.7 : 0));
    shoe.position.set(0, -shinLen - 0.005, s.legR * 0.7);
    mid.add(shoe);
    if (this.key !== 'kesty') {
      const sole = this.mesh(new THREE.BoxGeometry(s.legR * 1.65, 0.025, s.legR * 3.25), this.mat(this.key === 'sol' ? 0xc58a4a : 0xffffff, 0.8));
      sole.position.set(0, -shinLen - 0.045, s.legR * 0.7);
      mid.add(sole);
    }
    this.body.add(root);
    return { root, mid };
  }

  private buildProps(skin: Mat): void {
    void skin;
    if (this.key !== 'bor') return;
    // BOR's giant syringe (full of air), in his left hand.
    const g = new THREE.Group();
    const glass = new THREE.MeshStandardMaterial({ color: 0xcff4ff, transparent: true, opacity: 0.55, roughness: 0.05, emissive: 0x6fd8ff, emissiveIntensity: 0.25, depthWrite: false });
    this.mats.push(glass);
    const barrel = this.mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.26, 14), glass);
    const air = this.mesh(new THREE.SphereGeometry(0.03, 10, 8), this.mat(0xffffff, 0.3));
    air.scale.set(1, 3, 1);
    const needle = this.mesh(new THREE.CylinderGeometry(0.005, 0.002, 0.14, 6), this.mat(0xdfe6f3, 0.2, 0.8));
    needle.position.y = -0.2;
    const plunger = this.mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.015, 12), this.mat(0xff3b5c, 0.4));
    plunger.position.y = 0.16;
    g.add(barrel, air, needle, plunger);
    g.rotation.x = Math.PI / 2;
    g.position.y = -this.spec.fore - 0.02;
    this.arms[1].mid.add(g);
  }

  // --- Runtime -------------------------------------------------------------------------------

  /**
   * Shows the real person's face: their own photo wrapped onto the head (`photo`), or a face
   * scan they lent (a disc). Null goes back to the cartoon face.
   */
  setFace(tex: THREE.Texture | null, photo = false): void {
    if (this.photo) {
      this.head.remove(this.photo);
      disposeFacePhoto(this.photo);
      this.photo = null;
    }
    if (this.photoCap) {
      this.head.remove(this.photoCap);
      (this.photoCap.material as THREE.Material).dispose();
      this.photoCap = null;
    }
    const r = this.spec.headR;
    if (tex && photo) {
      const geo = faceCap(r);
      this.geos.push(geo);
      this.photoCap = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.4, transparent: true, depthWrite: false, roughness: 0.8 }));
      this.photoCap.scale.set(0.92, 1.12, 1);
      this.photoCap.renderOrder = 1;
      this.head.add(this.photoCap);
    } else if (tex) {
      this.photo = buildFacePhoto(tex);
      this.photo.scale.setScalar(r * 0.92);
      this.photo.position.set(0, r * 0.02, r * (this.key === 'kesty' ? 1.08 : 0.98));
      this.head.add(this.photo);
    }
    this.face.visible = !tex;
    if (this.nose) this.nose.visible = !tex;
  }

  setWeapon(id: WeaponId | null, parts: PartsInput = null): void {
    const key = id ? weaponLookKey(id, parts) : '';
    if (key === this.gunKey) return;
    this.gunKey = key;
    if (this.gun) {
      this.gunMount.remove(this.gun.root);
      this.gun.dispose();
      this.gun = null;
    }
    if (id) {
      this.gun = buildWeaponModel(id, this.key === 'kesty' ? 0x9aa4b4 : 0x2ec5ff, parts);
      // The body is scaled up; keep the gun about tube-man size.
      this.gun.root.scale.setScalar(0.9 / this.spec.scale);
      this.gunMount.add(this.gun.root);
    }
  }

  muzzleWorld(out: THREE.Vector3): THREE.Vector3 | null {
    if (!this.gun || !this.group.visible) return null;
    return this.gun.muzzle.getWorldPosition(out);
  }

  headHeight(inflation: number): number {
    const s = this.spec;
    return (s.legLen + s.torsoH + 0.12 + s.headR * 2.3) * s.scale * this.puff(inflation);
  }

  setVisible(v: boolean): void {
    this.group.visible = v;
  }

  /** Getting inflated puffs them up a little, like everyone else. */
  private puff(inflation: number): number {
    return 1 + (inflationScale(inflation) - 1) * 0.5;
  }

  /** `since`: seconds since the transformation (BOR flexes first). */
  update(p: TubeManPose, since: number): void {
    const dt = Math.min(0.05, p.dt);
    this.age += dt;
    const robot = this.key === 'kesty';
    // Robots move in little steps.
    const t = robot ? Math.floor(p.time * 8) / 8 : p.time;
    this.group.rotation.y = p.yaw + Math.PI;
    this.group.scale.setScalar(this.spec.scale * this.puff(p.inflation));
    const speed = Math.hypot(p.vx, p.vz);
    const ground = p.onGround && !p.launched;

    // Walk cycle, by distance covered.
    this.stride += speed * dt * (this.key === 'bor' ? 5.2 : 4);
    const walk = ground ? Math.min(1, speed / 6) : 0;
    const sw = Math.sin(robot ? Math.round(this.stride * 2) / 2 : this.stride);
    const chase = this.key === 'abag';
    this.lean += ((chase && walk > 0.2 ? 0.32 : walk * 0.12) - this.lean) * Math.min(1, dt * 6);
    this.bend += ((p.bentOver ? 1 : 0) - this.bend) * Math.min(1, dt * 12);
    this.torso.rotation.x = this.lean + this.bend * 1.15;
    this.hips.position.z = -this.bend * 0.12;
    // A little bounce in the step.
    this.body.position.y = ground ? Math.abs(Math.cos(this.stride)) * 0.03 * walk : 0;

    const [L, R] = this.legs;
    if (ground) {
      L.root.rotation.set(sw * 0.7 * walk - this.bend * 0.5, 0, 0);
      R.root.rotation.set(-sw * 0.7 * walk - this.bend * 0.5, 0, 0);
      L.mid.rotation.x = Math.max(0, -sw) * 1.1 * walk + this.bend * 0.4;
      R.mid.rotation.x = Math.max(0, sw) * 1.1 * walk + this.bend * 0.4;
    } else if (p.launched) {
      // Flailing through the air.
      L.root.rotation.set(Math.sin(t * 13) * 0.8, 0, 0.3);
      R.root.rotation.set(Math.sin(t * 13 + 2) * 0.8, 0, -0.3);
      L.mid.rotation.x = 0.8 + Math.sin(t * 11) * 0.5;
      R.mid.rotation.x = 0.8 + Math.sin(t * 11 + 1) * 0.5;
    } else {
      // Jumping: knees tucked.
      L.root.rotation.set(-0.5, 0, 0.08);
      R.root.rotation.set(0.25, 0, -0.08);
      L.mid.rotation.x = 1.1;
      R.mid.rotation.x = 0.5;
    }

    // Arms: the right one (-X; the model faces +Z) aims the gun along the pose's pitch, like the
    // tube man's gun mount; the left one helps, swings, or holds BOR's syringe.
    const [AR, AL] = this.arms;
    const aim = p.pitch - Math.PI / 2 - this.torso.rotation.x;
    const flexing = this.key === 'bor' && since < 1.4;
    if (p.launched) {
      AL.root.rotation.set(Math.sin(t * 12) * 1.2, 0, 1.3 + Math.sin(t * 9) * 0.4);
      AR.root.rotation.set(Math.sin(t * 12 + 1.5) * 1.2, 0, -1.3 + Math.sin(t * 9 + 1) * 0.4);
      AL.mid.rotation.x = -0.6;
      AR.mid.rotation.x = -0.6;
    } else if (flexing) {
      // Double biceps.
      AL.root.rotation.set(0, 0, 1.45);
      AR.root.rotation.set(0, 0, -1.45);
      AL.mid.rotation.set(0, 0, 1.8);
      AR.mid.rotation.set(0, 0, -1.8);
    } else {
      AR.root.rotation.set(aim, 0, 0);
      AR.mid.rotation.set(-0.1, 0, 0);
      if (chase && walk > 0.2) {
        // Pumping arm while chasing.
        AL.root.rotation.set(-sw * 1.1, 0, 0.1);
        AL.mid.rotation.set(-1.4, 0, 0);
      } else {
        // The free arm swings (BOR's holds the syringe).
        AL.root.rotation.set(-sw * 0.6 * walk - (this.key === 'bor' ? 0.2 : 0.05), 0, 0.14);
        AL.mid.rotation.set(this.key === 'bor' ? -0.7 : -0.25, 0, 0);
      }
    }
    this.gunMount.rotation.set(p.pitch - this.torso.rotation.x, Math.PI, 0);
    this.gunMount.visible = !flexing && this.bend < 0.3;
    if (this.gun) this.gun.setCharge(p.charge, p.time, p.charge > 0 || p.streaming);

    // Juice: bigger arms.
    const pump = p.jacked ? 1.3 : 1;
    for (const b of this.biceps) b.scale.set(pump, 1.3 * pump, 1.05 * pump);
    // ABAG sniffs.
    if (this.nose) this.nose.scale.setScalar(1 + (chase ? Math.max(0, Math.sin(p.time * 9)) * 0.12 : 0));
    // KESTY: red eyes in Robot Mode, blinking antenna.
    for (const e of this.robotEyes) e.visible = p.robot;
    for (const e of this.eyes) e.visible = !(robot && p.robot);
    if (this.antennaTip) this.antennaTip.visible = Math.floor(p.time * 3) % 2 === 0;
    // Idle breathing and a head bob.
    this.head.rotation.x = p.pitch * 0.4 - this.torso.rotation.x * 0.6 + Math.sin(t * 2) * 0.03;
  }

  dispose(): void {
    if (this.gun) this.gun.dispose();
    if (this.photo) disposeFacePhoto(this.photo);
    if (this.photoCap) (this.photoCap.material as THREE.Material).dispose();
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    for (const x of this.texs) x.dispose();
  }
}
