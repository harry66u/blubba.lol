import * as THREE from 'three';
import { type BodyShape, type CharacterProps, bodyShape, buildProps, hasOutfit, outfitShine, outfitTextures } from './characters';
import { buildFacePhoto, disposeFacePhoto } from './facePhoto';
import { PLAYER_COLORS } from '../../shared/colors';
import { type Cosmetics, cosmeticKey } from '../../shared/economy';
import { inflationScale } from '../../shared/player';
import type { PartsInput, WeaponId } from '../../shared/loadout';
import { FlexTube, noise1 } from './flexTube';
import { seeded } from './shapes';
import { type WeaponModel, buildWeaponModel, weaponLookKey } from './weapons';
import { type EyeStyle, FACES_COVERING_EYES, animateBase, animateHat, applyFinish, buildBase, buildFaceExtras, buildHat, disposeGroup, eyeStyle } from './looks';

/** Cosmetic keys (see shared/economy.ts), with the accent color already turned into a hex. */
export interface Look {
  /** Body shape or character (see characters.ts). */
  body: string;
  pattern: string;
  face: string;
  eyes: string;
  hat: string;
  base: string;
  /** Drawn by the effects system, not the tube man (see Effects.trail). */
  trail: string;
  finish: string;
  /** Second color for the arms, the base and the dark parts of the pattern; -1 matches the body. */
  accent: number;
  /** Surface of the body color and of the accent: '' (vinyl), 'metal', 'pearl' or 'glow'. */
  shine: string;
  accentShine: string;
}

export const DEFAULT_LOOK: Look = { body: 'classic', pattern: 'solid', face: 'smile', eyes: 'classic', hat: 'spikes', base: 'classic', trail: 'none', finish: 'team', accent: -1, shine: '', accentShine: '' };

/**
 * Someone's look from their cosmetics. `colorIndex` is the PLAYER_COLORS entry they're drawn in
 * (its metal/pearl/glow comes along). Team modes drop the accent and the shine so arms and
 * patterns never show the other team's color.
 */
export function lookFromCosmetics(cos: Partial<Cosmetics> | undefined, colorIndex: number, teamMode = false): Look {
  const accentKey = cosmeticKey(cos, 'accent');
  const accent = teamMode || accentKey === 'match' ? undefined : PLAYER_COLORS[Number(accentKey)];
  return {
    body: cosmeticKey(cos, 'body'),
    pattern: cosmeticKey(cos, 'pattern'),
    face: cosmeticKey(cos, 'face'),
    eyes: cosmeticKey(cos, 'eyes'),
    hat: cosmeticKey(cos, 'hat'),
    base: cosmeticKey(cos, 'base'),
    trail: cosmeticKey(cos, 'trail'),
    finish: cosmeticKey(cos, 'finish'),
    accent: accent?.hex ?? -1,
    shine: teamMode ? '' : (PLAYER_COLORS[colorIndex]?.shine ?? ''),
    accentShine: accent?.shine ?? '',
  };
}

/** How long each taunt animation lasts, in seconds. */
const TAUNT_TIME: Record<string, number> = { burp: 0.9, wave: 1.6, spin: 1.1, noodle: 1.8, flex: 1.4, bow: 1.5, dance: 2.2, deflate: 2.4, backflip: 1.1 };

export interface TubeManPose {
  time: number;
  dt: number;
  inflation: number;
  vx: number;
  vy: number;
  vz: number;
  /** World yaw the character faces (0 = -Z). */
  yaw: number;
  onGround: boolean;
  launched: boolean;
  doubled: boolean;
  bracing: boolean;
  charge: number;
  hanging: boolean;
  dashing: boolean;
  protected: boolean;
  holding: boolean;
  held: boolean;
  /** Aim pitch, used to point the weapon. */
  pitch: number;
  streaming: boolean;
  hasPin: boolean;
  crowned: boolean;
  /** Has a streak reward active (Turbo Tank / Mega Blast): flickers orange-gold. */
  powered: boolean;
  /** This player last knocked you out (drawn with a red revenge glow). */
  nemesis: boolean;
  /** Ults: Juice bulks you up, Crop Duster bends you over, Robot Mode turns your eyes red. */
  jacked: boolean;
  bentOver: boolean;
  robot: boolean;
}

export function defaultPose(): TubeManPose {
  return {
    time: 0,
    dt: 1 / 60,
    inflation: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    yaw: 0,
    onGround: true,
    launched: false,
    doubled: false,
    bracing: false,
    charge: 0,
    hanging: false,
    dashing: false,
    protected: false,
    holding: false,
    held: false,
    pitch: 0,
    streaming: false,
    hasPin: false,
    crowned: false,
    powered: false,
    nemesis: false,
    jacked: false,
    bentOver: false,
    robot: false,
  };
}

const BODY_LEN = 1.72;
const BODY_R = 0.36;
const BASE_H = 0.24;
/** A little self-glow so saturated colors catch the bloom. */
const BASE_GLOW = 0.1;
/** The head swells out of the tube (rounder, friendlier silhouette). */
const HEAD_R = BODY_R * 1.3;
const ARM_LEN = 0.95;
const ARM_R = 0.125;
const BODY_RINGS = 24;
const ARM_RINGS = 11;
/** With a Matching accent, the dark parts of a pattern are the body color times this. */
const MATCH_DARK = 0.5;

/** Surface settings for each color shine. */
const SHINES: Record<string, { metal: number; rough: number; glow: number; env: number }> = {
  '': { metal: 0, rough: 0.2, glow: BASE_GLOW, env: 2.2 },
  metal: { metal: 0.85, rough: 0.24, glow: 0.05, env: 2.6 },
  pearl: { metal: 0.1, rough: 0.12, glow: 0.14, env: 2.6 },
  glow: { metal: 0, rough: 0.25, glow: 0.75, env: 1.6 },
};

// Scratch objects so animating a dozen tube men every frame allocates nothing.
const SV1 = new THREE.Vector3();
const SV2 = new THREE.Vector3();
const SV3 = new THREE.Vector3();
const SM = new THREE.Matrix4();
const Y_UP = new THREE.Vector3(0, 1, 0);

/** Pattern keys (see the pattern items in shared/economy.ts). */
export type Pattern = string;

/** How many times a pattern repeats around and along the tube (the default is 2 x 2). */
const PATTERN_REPEAT: Record<string, [number, number]> = { ombre: [1, 1], flames: [2, 1], lightning: [2, 1], galaxy: [1, 1] };
/**
 * The texture is stretched about this much more along the tube than around it (at 2 x 2), so
 * shapes are drawn this much taller to come out round on the body.
 */
const TALL = 2.4;

const maskCache = new Map<string, HTMLCanvasElement | null>();
const patternCache = new Map<string, THREE.Texture | null>();

/**
 * A pattern's mask: white = body color, black = accent color (or darker body with a Matching
 * accent), grays blend. Green on black marks white sparkles (galaxy stars). Shared with the
 * locker's swatches.
 */
export function patternMask(p: Pattern): HTMLCanvasElement | null {
  if (p === 'solid') return null;
  const cached = maskCache.get(p);
  if (cached !== undefined) return cached;
  const c = document.createElement('canvas');
  const W = (c.width = 128);
  const H = (c.height = 256);
  const g = c.getContext('2d')!;
  const rnd = seeded([...p].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7));
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#000000';
  g.strokeStyle = '#000000';
  // Draws something at x and at x +- W (and y +- H) so shapes crossing an edge tile seamlessly.
  const wrapped = (draw: (dx: number, dy: number) => void) => {
    for (const dx of [-W, 0, W]) for (const dy of [-H, 0, H]) draw(dx, dy);
  };
  const ellipse = (x: number, y: number, rx: number, ry: number) => {
    g.beginPath();
    g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    g.fill();
  };
  if (p === 'stripes') {
    for (let y = 0; y < H; y += 32) g.fillRect(0, y, W, 14);
  } else if (p === 'dots') {
    for (let y = 16; y < H; y += 32) for (let x = (y / 32) % 2 ? 16 : 0; x < W + 16; x += 32) ellipse(x, y, 8, 8);
  } else if (p === 'zigzag') {
    g.lineWidth = 9;
    for (let y = 20; y < H; y += 40) {
      g.beginPath();
      for (let x = 0; x <= W; x += 16) g.lineTo(x, y + ((x / 16) % 2 ? 10 : -10));
      g.stroke();
    }
  } else if (p === 'stars') {
    for (let y = 20; y < H; y += 42) for (let x = (y / 42) % 2 ? 22 : 0; x < 150; x += 44) {
      g.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
        const r = i % 2 ? 5 : 12;
        g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      }
      g.fill();
    }
  } else if (p === 'checker') {
    for (let y = 0; y < H; y += 32) for (let x = (y / 32) % 2 ? 32 : 0; x < W; x += 64) g.fillRect(x, y, 32, 32);
  } else if (p === 'ombre') {
    const grad = g.createLinearGradient(0, H * 0.9, 0, H * 0.12);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(1, '#000000');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
  } else if (p === 'swirl') {
    // Diagonal bands that line up across both edges (a barber pole once wrapped round).
    for (let y = 0; y < H; y++) for (let x = -32; x < W; x += 32) g.fillRect(x + ((y * 0.5) % 32), y, 16, 1);
  } else if (p === 'waves') {
    for (let yc = 16; yc < H; yc += 64) {
      g.beginPath();
      for (let x = 0; x <= W; x += 4) g.lineTo(x, yc + Math.sin((x / W) * Math.PI * 4) * 9 - 11);
      for (let x = W; x >= 0; x -= 4) g.lineTo(x, yc + Math.sin((x / W) * Math.PI * 4) * 9 + 11);
      g.fill();
    }
  } else if (p === 'hearts') {
    const heart = (x: number, y: number, w: number, h: number) => {
      g.beginPath();
      g.moveTo(x, y + h * 0.45);
      g.bezierCurveTo(x - w * 0.1, y + h * 0.3, x - w * 0.5, y + h * 0.1, x - w * 0.5, y - h * 0.15);
      g.bezierCurveTo(x - w * 0.5, y - h * 0.4, x - w * 0.18, y - h * 0.48, x, y - h * 0.25);
      g.bezierCurveTo(x + w * 0.18, y - h * 0.48, x + w * 0.5, y - h * 0.4, x + w * 0.5, y - h * 0.15);
      g.bezierCurveTo(x + w * 0.5, y + h * 0.1, x + w * 0.1, y + h * 0.3, x, y + h * 0.45);
      g.fill();
    };
    for (let row = 0; row < 4; row++) for (let x = row % 2 ? 16 : 0; x < W + 16; x += 32) heart(x, row * 64 + 32, 20, 20 * TALL * 0.9);
  } else if (p === 'hex') {
    // Honeycomb outlines: 4 cells around, 6 rows along.
    const w = 32;
    const pitch = H / 6;
    const hh = pitch / 0.75;
    g.lineWidth = 5;
    g.lineJoin = 'round';
    for (let row = 0; row < 7; row++) {
      for (let col = -1; col <= 4; col++) {
        const cx = col * w + (row % 2 ? w / 2 : 0);
        const cy = row * pitch;
        g.beginPath();
        g.moveTo(cx, cy - hh / 2);
        g.lineTo(cx + w / 2, cy - hh / 4);
        g.lineTo(cx + w / 2, cy + hh / 4);
        g.lineTo(cx, cy + hh / 2);
        g.lineTo(cx - w / 2, cy + hh / 4);
        g.lineTo(cx - w / 2, cy - hh / 4);
        g.closePath();
        g.stroke();
      }
    }
  } else if (p === 'pixel') {
    for (let y = 0; y < H; y += 32) {
      for (let x = 0; x < W; x += 16) {
        const r = rnd();
        if (r < 0.28) g.fillStyle = '#000000';
        else if (r < 0.45) g.fillStyle = '#808080';
        else continue;
        g.fillRect(x, y, 16, 32);
      }
    }
  } else if (p === 'camo') {
    for (const tone of ['#8a8a8a', '#000000']) {
      g.fillStyle = tone;
      for (let i = 0; i < 16; i++) {
        const x = rnd() * W;
        const y = rnd() * H;
        const r = 9 + rnd() * 12;
        const blob: [number, number, number][] = [0, 1, 2].map(() => [(rnd() - 0.5) * r, (rnd() - 0.5) * r * TALL, r * (0.6 + rnd() * 0.5)]);
        wrapped((dx, dy) => {
          for (const [ox, oy, rr] of blob) ellipse(x + ox + dx, y + oy + dy, rr, rr * TALL * 0.8);
        });
      }
    }
  } else if (p === 'tiger') {
    for (let yc = 12; yc < H; yc += 32) {
      const x0 = (yc / 32) % 2 ? 64 : 0;
      const len = 60 + rnd() * 30;
      const wob = rnd() * 6;
      wrapped((dx) => {
        g.beginPath();
        for (let k = 0; k <= 12; k++) {
          const t = k / 12;
          g.lineTo(x0 + dx + t * len, yc + Math.sin(t * 5 + wob) * 5 - 8 * (1 - t));
        }
        for (let k = 12; k >= 0; k--) {
          const t = k / 12;
          g.lineTo(x0 + dx + t * len, yc + Math.sin(t * 5 + wob) * 5 + 8 * (1 - t));
        }
        g.fill();
      });
    }
  } else if (p === 'lightning') {
    g.lineWidth = 7;
    g.lineJoin = 'miter';
    for (const x0 of [30, 94]) {
      g.beginPath();
      let x = x0;
      for (let y = 0; y <= H; y += 32) {
        g.lineTo(x, y);
        x = x0 + ((y / 32) % 2 ? -12 : 12);
      }
      g.stroke();
    }
  } else if (p === 'flames') {
    // Hot-rod flames licking up from the base (the bottom of the texture is the bottom of the tube).
    const tongues = (color: string, top: number, inset: number) => {
      g.fillStyle = color;
      g.beginPath();
      g.moveTo(0, H);
      for (let i = 0; i < 4; i++) {
        const x = i * 32;
        const tip = H * (top + (i % 2 ? 0.14 : 0) + inset);
        g.lineTo(x + inset * 40, H * 0.8);
        g.quadraticCurveTo(x + 4, H * 0.55, x + 22, tip);
        g.quadraticCurveTo(x + 18, H * 0.62, x + 32 - inset * 40, H * 0.8);
      }
      g.lineTo(W, H);
      g.fill();
    };
    tongues('#000000', 0.18, 0);
    tongues('#8a8a8a', 0.34, 0.12);
  } else if (p === 'galaxy') {
    g.fillStyle = '#000000';
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 9; i++) {
      const x = rnd() * W;
      const y = rnd() * H;
      const r = 20 + rnd() * 26;
      const a = 0.35 + rnd() * 0.4;
      wrapped((dx) => {
        const grad = g.createRadialGradient(x + dx, y, 0, x + dx, y, r);
        grad.addColorStop(0, `rgba(255,255,255,${a})`);
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grad;
        g.fillRect(x + dx - r, y - r, r * 2, r * 2);
      });
    }
    // Stars: green on black means "white sparkle" to the body shader.
    for (let i = 0; i < 70; i++) {
      const x = rnd() * W;
      const y = rnd() * H;
      const big = rnd() < 0.2;
      g.fillStyle = '#000000';
      g.fillRect(x - 1, y - 2, 3, 5);
      g.fillStyle = '#00ff00';
      g.fillRect(x, y - (big ? 3 : 1), 1, big ? 7 : 3);
      if (big) g.fillRect(x - 1, y, 3, 1);
    }
  }
  maskCache.set(p, c);
  return c;
}

/** The pattern mask as a texture for the body material (see addPatternAccent). */
export function patternTexture(p: Pattern): THREE.Texture | null {
  const cached = patternCache.get(p);
  if (cached !== undefined) return cached;
  const mask = patternMask(p);
  if (!mask) {
    patternCache.set(p, null);
    return null;
  }
  const tex = new THREE.CanvasTexture(mask);
  // A mask, not a picture: read the values as they are.
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(...(PATTERN_REPEAT[p] ?? [2, 2]));
  patternCache.set(p, tex);
  return tex;
}

/** Adds a soft candy-colored rim light (fresnel glow) to a standard material. */
export function addRim(mat: THREE.MeshStandardMaterial, strength = 0.55): void {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.rimStrength = { value: strength };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float rimStrength;')
      .replace(
        '#include <opaque_fragment>',
        `float rimF = pow(1.0 - saturate(dot(normalize(normal), normalize(vViewPosition))), 2.6);
        outgoingLight += (diffuseColor.rgb * 0.5 + vec3(0.5)) * rimF * rimStrength;
        #include <opaque_fragment>`,
      );
  };
  mat.customProgramCacheKey = () => `rim${strength}`;
}

/**
 * Paints the pattern mask two-tone: white parts keep the material color, black parts take
 * `accent`, and green-on-black marks white sparkles. Call after addRim.
 */
function addPatternAccent(mat: THREE.MeshStandardMaterial, accent: { value: THREE.Color }): void {
  const rim = mat.onBeforeCompile;
  const rimKey = mat.customProgramCacheKey();
  mat.onBeforeCompile = (shader, renderer) => {
    rim.call(mat, shader, renderer);
    shader.uniforms.accentColor = accent;
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 accentColor;').replace(
      '#include <map_fragment>',
      `#ifdef USE_MAP
        vec4 patternMask = texture2D( map, vMapUv );
        diffuseColor.rgb = mix( accentColor, diffuseColor.rgb, patternMask.r ) + vec3( max( 0.0, patternMask.g - patternMask.r ) );
      #endif`,
    );
  };
  mat.customProgramCacheKey = () => `${rimKey}|accent`;
}

const sharedGeo = {
  eye: new THREE.SphereGeometry(0.095, 16, 12),
  mouthSmile: new THREE.TorusGeometry(0.085, 0.022, 6, 14, Math.PI),
  mouthO: new THREE.TorusGeometry(0.05, 0.022, 6, 14),
  bubble: new THREE.SphereGeometry(1, 24, 16),
  visor: new THREE.BoxGeometry(0.44, 0.13, 0.05),
};

const sharedMat = {
  mouth: new THREE.MeshStandardMaterial({ color: 0x3a0f22, roughness: 0.6 }),
  robotEye: new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xff0000, emissiveIntensity: 1.3, roughness: 0.3 }),
  visor: new THREE.MeshStandardMaterial({ color: 0x1d1b3a, roughness: 0.25, metalness: 0.5 }),
  bubble: new THREE.MeshStandardMaterial({
    color: 0x9fe8ff,
    transparent: true,
    opacity: 0.22,
    roughness: 0.05,
    depthWrite: false,
    emissive: 0x6fd8ff,
    emissiveIntensity: 0.4,
  }),
};

type BodyMat = THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial;

/** A flailing inflatable tube man. Visual only: gameplay hitboxes follow the body capsule. */
export class TubeMan {
  readonly group = new THREE.Group();
  /** Everything that scales with inflation. */
  private readonly rig = new THREE.Group();
  private readonly body: FlexTube;
  private readonly arms: FlexTube[];
  private readonly face = new THREE.Group();
  private readonly eyes: THREE.Mesh[] = [];
  private readonly pupils: THREE.Mesh[] = [];
  private readonly mouthSmile: THREE.Mesh;
  private readonly mouthO: THREE.Mesh;
  private readonly hair = new THREE.Group();
  private base: THREE.Group;
  private readonly bubble: THREE.Mesh;
  readonly bodyMat: BodyMat;
  /** The arms' material when an accent color is picked (otherwise the arms use bodyMat). */
  private readonly armMat: BodyMat;
  private readonly accentU = { value: new THREE.Color() };
  private readonly accentColor = new THREE.Color();
  private readonly seed: number;
  // Spring state for the wobbly lean (local x/z) and squash.
  private leanX = 0;
  private leanZ = 0;
  private leanVX = 0;
  private leanVZ = 0;
  private squash = 0;
  private squashV = 0;
  private spin = 0;
  private flail = 1;
  private lastVy = 0;
  private color = new THREE.Color();
  private readonly gunMount = new THREE.Group();
  private gun: WeaponModel | null = null;
  private gunId: WeaponId | null = null;
  private gunKey = '';
  private readonly pin: THREE.Group;
  private readonly crown: THREE.Group;
  private look: Look = { ...DEFAULT_LOOK };
  private hat: THREE.Group;
  private faceExtras: THREE.Group;
  /** A player's face scan, worn instead of the cartoon eyes and mouth. */
  private facePhoto: THREE.Group | null = null;
  private eyeKind: EyeStyle;
  private shineP = SHINES[''];
  private accentShineP = SHINES[''];
  private tauntStyle = '';
  private tauntT = 0;
  /** Body shape, outfit and props of the current body (characters.ts). */
  private shape: BodyShape = bodyShape('classic');
  private readonly outfitMat: BodyMat;
  private readonly sleeveMat: BodyMat;
  private props: CharacterProps | null = null;
  private readonly handProp = new THREE.Group();
  private static readonly BLACK = new THREE.Color(0);
  /** Ult poses, eased in and out (0..1): Juice's bulk, Crop Duster's bend. */
  private bulk = 0;
  private bend = 0;
  /** Juice: the syringe jab, then a double-biceps flex (seconds left of each). */
  private jabT = 0;
  private flexT = 0;
  private syringe: THREE.Group | null = null;
  private robotEyes = false;
  /** Robot Mode: a dark visor with the eyes glowing red through it. */
  private readonly visor = new THREE.Mesh(sharedGeo.visor, sharedMat.visor);

  constructor(colorHex: number, opts: { physical?: boolean; seed?: number; pattern?: Pattern; look?: Partial<Look> } = {}) {
    this.seed = opts.seed ?? Math.random() * 100;
    this.look = { ...DEFAULT_LOOK, ...(opts.pattern ? { pattern: opts.pattern } : {}), ...opts.look };
    // Glossy vinyl: low roughness, strong environment reflections, a clear coat when the GPU can
    // afford it, and a rim light so the silhouette pops.
    const makeMat = (map: THREE.Texture | null): BodyMat => {
      const matOpts = { color: colorHex, roughness: 0.2, metalness: 0.0, emissive: new THREE.Color(colorHex), emissiveIntensity: BASE_GLOW, envMapIntensity: 2.2, map };
      const mat = opts.physical ? new THREE.MeshPhysicalMaterial({ ...matOpts, clearcoat: 0.9, clearcoatRoughness: 0.08 }) : new THREE.MeshStandardMaterial(matOpts);
      addRim(mat);
      return mat;
    };
    this.bodyMat = makeMat(patternTexture(this.look.pattern));
    addPatternAccent(this.bodyMat, this.accentU);
    this.armMat = makeMat(null);
    this.outfitMat = makeMat(null);
    this.sleeveMat = makeMat(null);
    for (const m of [this.outfitMat, this.sleeveMat]) {
      m.color.set(0xffffff);
      m.emissive.set(0);
    }
    this.color.set(colorHex);

    this.body = new FlexTube(BODY_RINGS, 24, this.bodyMat);
    this.arms = [new FlexTube(ARM_RINGS, 9, this.bodyMat), new FlexTube(ARM_RINGS, 9, this.bodyMat)];
    this.body.mesh.castShadow = true;
    for (const a of this.arms) a.mesh.castShadow = true;

    this.base = buildBase(this.look.base, this.look.accent, BASE_H);

    this.eyeKind = eyeStyle(this.look.eyes);
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(sharedGeo.eye, this.eyeKind.eyeMat);
      const pupil = new THREE.Mesh(this.eyeKind.pupilGeo, this.eyeKind.pupilMat);
      eye.position.set(side * 0.12, 0, 0);
      pupil.position.set(side * 0.12, 0, 0.065);
      this.eyes.push(eye);
      this.pupils.push(pupil);
      this.face.add(eye, pupil);
    }
    this.mouthSmile = new THREE.Mesh(sharedGeo.mouthSmile, sharedMat.mouth);
    this.mouthSmile.rotation.z = Math.PI;
    this.mouthSmile.position.set(0, -0.2, 0.0);
    this.mouthO = new THREE.Mesh(sharedGeo.mouthO, sharedMat.mouth);
    this.mouthO.position.set(0, -0.2, 0.0);
    this.mouthO.visible = false;
    this.face.add(this.mouthSmile, this.mouthO);
    this.visor.position.set(0, 0, 0.035);
    this.visor.visible = false;
    this.face.add(this.visor);

    this.hat = buildHat(this.look.hat, colorHex);
    this.hair.add(this.hat);
    this.faceExtras = buildFaceExtras(this.look.face);
    this.face.add(this.faceExtras);
    this.applyFaceBase();
    this.applyShine();
    this.applyAccent();
    // Bigger, friendlier face and hats sized for the rounder head.
    this.face.scale.setScalar(1.3);
    this.hair.scale.setScalar(HEAD_R / BODY_R);

    this.bubble = new THREE.Mesh(sharedGeo.bubble, sharedMat.bubble);
    this.bubble.visible = false;

    this.gunMount.rotation.order = 'YXZ';
    this.pin = makePin();
    this.pin.visible = false;
    this.crown = makeCrown();
    this.crown.visible = false;
    this.rig.add(this.crown);
    this.rig.add(this.base, this.body.mesh, this.arms[0].mesh, this.arms[1].mesh, this.face, this.hair, this.bubble, this.gunMount, this.pin, this.handProp);
    this.group.add(this.rig);
    this.applyBody();
  }

  /** Shape, outfit and props for the current body (the classic tube man has none). */
  private applyBody(): void {
    const body = this.look.body;
    this.shape = bodyShape(body);
    if (this.props) {
      if (this.props.face) this.face.remove(this.props.face);
      if (this.props.hand) this.handProp.remove(this.props.hand);
      this.props.dispose();
    }
    this.props = buildProps(body, this.color.getHex());
    if (this.props?.face) this.face.add(this.props.face);
    if (this.props?.hand) this.handProp.add(this.props.hand);
    this.applyOutfit();
    this.hair.scale.setScalar((HEAD_R * this.shape.head) / BODY_R);
    this.applyFaceBase();
    if (this.props?.faceCartoonOnly) this.props.faceCartoonOnly.visible = !this.facePhoto;
  }

  /** Characters with an outfit wear it on the body and sleeves (head and hands in their color). */
  private applyOutfit(): void {
    const tex = hasOutfit(this.look.body) ? outfitTextures(this.look.body, this.color.getHex()) : null;
    if (tex) {
      const sh = outfitShine(this.look.body);
      this.outfitMat.map = tex.body;
      this.sleeveMat.map = tex.arm;
      for (const m of [this.outfitMat, this.sleeveMat]) {
        m.metalness = sh.metal;
        m.roughness = sh.rough;
        m.needsUpdate = true;
      }
      this.body.mesh.material = this.outfitMat;
      for (const arm of this.arms) arm.mesh.material = this.sleeveMat;
    } else {
      this.body.mesh.material = this.bodyMat;
      this.applyAccent();
    }
  }

  setColor(hex: number): void {
    this.color.set(hex);
    this.bodyMat.color.set(hex);
    this.bodyMat.emissive.set(hex);
    if (this.gun) applyFinish(this.gun, this.look.finish, hex);
    // A Matching accent follows the body color; some hats are tinted from it too.
    this.applyAccent();
    this.rebuildHat();
    // Outfits paint the head and hands in the body color.
    this.applyOutfit();
  }

  /** Puts a face scan on the head (null goes back to the cartoon face). */
  setFacePhoto(tex: THREE.Texture | null): void {
    if (this.facePhoto) {
      this.face.remove(this.facePhoto);
      disposeFacePhoto(this.facePhoto);
      this.facePhoto = null;
    }
    if (tex) {
      this.facePhoto = buildFacePhoto(tex);
      this.face.add(this.facePhoto);
    }
    this.faceExtras.visible = !tex;
    if (this.props?.faceCartoonOnly) this.props.faceCartoonOnly.visible = !tex;
    // Eyes follow the face and eye style (and hide under a photo).
    this.applyFaceBase();
  }

  /** The trail drawn behind this tube man while flying (see Effects.trail). */
  get trail(): string {
    return this.look.trail;
  }

  /** Changes pattern, face, eyes, hat, base, accent, shine and weapon finish. */
  setLook(look: Partial<Look>): void {
    const next = { ...this.look, ...look };
    const prev = this.look;
    this.look = next;
    if (next.pattern !== prev.pattern) {
      this.bodyMat.map = patternTexture(next.pattern);
      this.bodyMat.needsUpdate = true;
    }
    if (next.hat !== prev.hat) this.rebuildHat();
    if (next.face !== prev.face) {
      this.face.remove(this.faceExtras);
      disposeGroup(this.faceExtras);
      this.faceExtras = buildFaceExtras(next.face);
      this.faceExtras.visible = !this.facePhoto;
      this.face.add(this.faceExtras);
    }
    if (next.face !== prev.face || next.eyes !== prev.eyes) this.applyFaceBase();
    if (next.shine !== prev.shine || next.accentShine !== prev.accentShine) this.applyShine();
    if (next.accent !== prev.accent) this.applyAccent();
    if (next.body !== prev.body) this.applyBody();
    if (next.base !== prev.base || next.accent !== prev.accent) {
      this.rig.remove(this.base);
      disposeGroup(this.base);
      this.base = buildBase(next.base, next.accent, BASE_H);
      this.rig.add(this.base);
    }
    if (next.finish !== prev.finish && this.gun) applyFinish(this.gun, next.finish, this.color.getHex());
  }

  private rebuildHat(): void {
    this.hair.remove(this.hat);
    disposeGroup(this.hat);
    this.hat = buildHat(this.look.hat, this.color.getHex());
    this.hair.add(this.hat);
  }

  /** Base eye/mouth layout for the current face and eye style (update() animates on top). */
  private applyFaceBase(): void {
    const f = this.look.face;
    const covered = FACES_COVERING_EYES.has(f) || !!this.props?.coversEyes;
    const st = eyeStyle(this.look.eyes);
    this.eyeKind = st;
    for (let i = 0; i < 2; i++) {
      const eye = this.eyes[i];
      const pupil = this.pupils[i];
      eye.material = st.eyeMat;
      pupil.geometry = st.pupilGeo;
      pupil.material = st.pupilMat;
      // Style extras share geometry and materials, so they're dropped without disposing.
      eye.clear();
      pupil.clear();
      if (st.eyeChild) eye.add(st.eyeChild(i === 0 ? -1 : 1));
      if (st.pupilChild) pupil.add(st.pupilChild());
      pupil.rotation.z = 0;
      eye.visible = !covered && !st.hideWhites && !this.facePhoto;
      pupil.visible = !covered && !this.facePhoto;
    }
    this.mouthSmile.scale.setScalar(f === 'grin' ? 1.45 : 1);
  }

  private applyShine(): void {
    this.shineP = SHINES[this.look.shine] ?? SHINES[''];
    this.accentShineP = SHINES[this.look.accentShine] ?? SHINES[''];
    for (const [mat, s] of [
      [this.bodyMat, this.shineP],
      [this.armMat, this.accentShineP],
    ] as const) {
      mat.roughness = s.rough;
      mat.metalness = s.metal;
      mat.envMapIntensity = s.env;
      // Pearl shimmers pink and blue where the GPU can afford iridescence.
      if (mat instanceof THREE.MeshPhysicalMaterial) {
        const pearl = s === SHINES.pearl;
        mat.iridescence = pearl ? 1 : 0;
        mat.iridescenceIOR = 1.35;
        mat.iridescenceThicknessRange = [250, 650];
      }
    }
  }

  /** Arms and the pattern's dark parts in the accent color (or body-colored when Matching). */
  private applyAccent(): void {
    const a = this.look.accent;
    if (a >= 0) {
      this.accentColor.set(a);
      this.armMat.color.set(a);
      this.armMat.emissive.set(a);
      this.accentU.value.set(a);
    } else {
      this.accentColor.copy(this.color);
      this.accentU.value.copy(this.color).multiplyScalar(MATCH_DARK);
    }
    if (hasOutfit(this.look.body)) return;
    for (const arm of this.arms) arm.mesh.material = a >= 0 ? this.armMat : this.bodyMat;
  }

  private impactT = 0;

  /** Got hit: a squash, a jolt away from the hit, and a white flash. `dx/dz` in world space. */
  impact(strength: number, dx: number, dz: number): void {
    const k = Math.min(1, strength / 25);
    this.squashV -= 3 + k * 7;
    // Into the tube's local frame (+z forward, +x left).
    const yaw = this.group.rotation.y;
    const lx = dx * Math.cos(yaw) - dz * Math.sin(yaw);
    const lz = dx * Math.sin(yaw) + dz * Math.cos(yaw);
    this.leanVX += lx * (4 + k * 8);
    this.leanVZ += lz * (4 + k * 8);
    this.impactT = 0.1;
  }

  /** Juice: jab the giant syringe into your arm, then flex. */
  jab(): void {
    this.jabT = JAB_TIME;
    this.flexT = JAB_TIME + FLEX_TIME;
    if (!this.syringe) {
      this.syringe = makeSyringe();
      this.rig.add(this.syringe);
    }
  }

  /** World position of the face (Robot Mode's laser comes out of the eyes). */
  eyeWorld(out: THREE.Vector3): THREE.Vector3 {
    return this.face.getWorldPosition(out);
  }

  /** Plays a taunt animation (visual only). */
  taunt(style: string): void {
    this.tauntStyle = style;
    this.tauntT = TAUNT_TIME[style] ?? 1;
  }

  get weapon(): WeaponId | null {
    return this.gunId;
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
    this.gunId = id;
    if (id) {
      this.gun = buildWeaponModel(id, this.color.getHex(), parts);
      applyFinish(this.gun, this.look.finish, this.color.getHex());
      this.gun.root.scale.setScalar(0.9);
      this.gunMount.add(this.gun.root);
    }
  }

  /** World position of the weapon's muzzle (for streams, honks and tracers). */
  muzzleWorld(out: THREE.Vector3): THREE.Vector3 | null {
    if (!this.gun || !this.group.visible) return null;
    return this.gun.muzzle.getWorldPosition(out);
  }

  /** Height of the top of the head above the feet, in world units, for name tags. */
  headHeight(inflation: number): number {
    return (BASE_H + BODY_LEN * this.shape.length + 0.35) * inflationScale(inflation);
  }

  update(p: TubeManPose): void {
    const dt = Math.min(0.05, p.dt);
    const t = p.time;
    let s = inflationScale(p.inflation);
    this.bulk += ((p.jacked ? 1 : 0) - this.bulk) * Math.min(1, dt * (p.jacked ? 3.5 : 2));
    this.bend += ((p.bentOver ? 1 : 0) - this.bend) * Math.min(1, dt * 14);
    this.jabT = Math.max(0, this.jabT - dt);
    this.flexT = Math.max(0, this.flexT - dt);
    // Taunts are pure animation: spin, flex, wave, go floppy, dance, bow, flip, deflate.
    let tauntSpin = 0;
    let flop = 0;
    let wave = 0;
    let dance = 0;
    let bow = 0;
    let flip = 0;
    let hop = 0;
    let deflate = 0;
    if (this.tauntT > 0) {
      this.tauntT = Math.max(0, this.tauntT - dt);
      const total = TAUNT_TIME[this.tauntStyle] ?? 1;
      const k = 1 - this.tauntT / total;
      const env = Math.sin(Math.min(1, k) * Math.PI);
      const style = this.tauntStyle;
      if (style === 'spin') tauntSpin = k * Math.PI * 4;
      else if (style === 'flex') s *= 1 + 0.35 * env;
      else if (style === 'noodle') flop = env;
      else if (style === 'wave') wave = env;
      else if (style === 'dance') dance = Math.min(1, env * 2.5);
      else if (style === 'bow') bow = Math.min(1, env * 1.6);
      else if (style === 'backflip') {
        const e = k * k * (3 - 2 * k);
        flip = -e * Math.PI * 2;
        hop = Math.sin(k * Math.PI);
      } else if (style === 'deflate') {
        // Sag like the fan switched off, hold, then pop back up (the squash spring overshoots).
        deflate = k < 0.35 ? k / 0.35 : k < 0.75 ? 1 : Math.max(0, 1 - (k - 0.75) / 0.08);
        flop = deflate * 0.7;
      }
    }
    // Danger (0..1) from 60% inflation up: more wobble, a straining tremble, a red warning pulse.
    const danger = Math.max(0, Math.min(1, (p.inflation - 0.6) / 0.4));
    this.rig.scale.setScalar(s);
    if (danger > 0) {
      // Straining at the seams: a fast shiver that gets harder near max.
      const shiver = danger * danger * 0.035 * s;
      this.rig.position.set(Math.sin(t * 47 + this.seed) * shiver, 0, Math.cos(t * 53 + this.seed) * shiver);
      this.rig.scale.set(s * (1 + Math.sin(t * 31) * 0.02 * danger), s, s * (1 + Math.cos(t * 29) * 0.02 * danger));
    } else {
      this.rig.position.set(0, 0, 0);
    }
    this.group.rotation.y = p.yaw + Math.PI + tauntSpin;

    // Velocity in the character's local frame (+z forward, +x left).
    const cy = Math.cos(p.yaw + Math.PI);
    const sy = Math.sin(p.yaw + Math.PI);
    const lvx = p.vx * cy - p.vz * sy;
    const lvz = p.vx * sy + p.vz * cy;

    // --- Lean springs: the tube trails behind its motion like a real air dancer. ---
    let targetX = -lvx * 0.055;
    let targetZ = -lvz * 0.055;
    if (p.launched) {
      targetX = lvx * 0.06;
      targetZ = lvz * 0.06;
    }
    if (p.doubled) targetZ += 1.6;
    if (p.hanging) targetZ += 0.25;
    if (flop > 0) targetX += Math.sin(t * 7) * 1.4 * flop;
    if (dance > 0) targetX += Math.sin(t * 9) * 0.75 * dance;
    const lim = p.launched ? 1.8 : 1.1;
    targetX = Math.max(-lim, Math.min(lim, targetX));
    targetZ = Math.max(-lim, Math.min(lim, targetZ));
    const k = p.bracing ? 260 : 60;
    const c = p.bracing ? 22 : 7;
    this.leanVX += (k * (targetX - this.leanX) - c * this.leanVX) * dt;
    this.leanVZ += (k * (targetZ - this.leanZ) - c * this.leanVZ) * dt;
    this.leanX += this.leanVX * dt;
    this.leanZ += this.leanVZ * dt;

    // Squash on landing, stretch when rising fast.
    if (p.onGround && this.lastVy < -5) this.squashV -= Math.min(8, -this.lastVy * 0.5);
    this.lastVy = p.vy;
    // Idle: a slow, bouncy breathing so nobody ever stands dead still.
    const speedH = Math.hypot(lvx, lvz);
    const idle = p.onGround && speedH < 1.5 ? Math.sin(t * 3.4 + this.seed) * 0.05 : 0;
    let squashTarget = p.bracing ? -0.22 : p.onGround ? idle : Math.max(-0.12, Math.min(0.22, p.vy * 0.02));
    squashTarget += Math.abs(Math.sin(t * 9)) * 0.12 * dance - 0.55 * deflate;
    this.squashV += (95 * (squashTarget - this.squash) - 6 * this.squashV) * dt;
    this.squash += this.squashV * dt;

    // Tumble while launched.
    if (p.launched) this.spin += dt * (4 + Math.hypot(p.vx, p.vz) * 0.25);
    else this.spin *= Math.max(0, 1 - dt * 8);
    this.rig.rotation.x = Math.sin(this.spin) * 0.25 + flip;
    if (flip !== 0 || hop > 0) {
      // Flip around the middle of the body, not the feet, with a little hop.
      const h = (BASE_H + BODY_LEN * 0.5) * s;
      this.rig.position.y += h * (1 - Math.cos(flip)) + hop * 0.9 * s;
      this.rig.position.z -= h * Math.sin(flip);
    }

    // --- Body spine. ---
    const lenScale = 1 + this.squash;
    const radScale = (1 / Math.sqrt(Math.max(0.6, lenScale))) * (1 - 0.3 * deflate);
    const wobbleAmp = (p.bracing ? 0.02 : 0.09 + Math.min(0.12, Math.hypot(lvx, lvz) * 0.01)) + flop * 0.25 + p.inflation * p.inflation * 0.12;
    const spine = this.body.spine;
    const radii = this.body.radii;
    const n = BODY_RINGS;
    const capStart = n - 6;
    const sh = this.shape;
    const bodyLen = BODY_LEN * sh.length;
    const bodyR = BODY_R * sh.radius;
    const headR = HEAD_R * sh.head;
    for (let i = 0; i < n; i++) {
      let u: number;
      let r: number;
      const capU = 1 - headR / bodyLen;
      if (i < capStart) {
        u = (i / capStart) * capU;
        // Slight flare at the bottom where the tube meets the blower, and the head swelling out
        // toward the top.
        const flare = 1 + 0.25 * Math.max(0, 1 - u * 6);
        const k = Math.min(1, Math.max(0, (u - 0.42) / (capU - 0.42)));
        const swell = k * k * (3 - 2 * k);
        r = bodyR * flare * (1 + (headR / bodyR - 1) * swell);
      } else {
        const a = ((i - capStart) / (n - 1 - capStart)) * (Math.PI / 2);
        u = capU + (Math.sin(a) * headR) / bodyLen;
        r = headR * Math.cos(a);
      }
      const sArc = u * bodyLen * lenScale;
      const bend = u * u;
      const wob1 = noise1(t * 1.7 + u * 1.2, this.seed) * wobbleAmp;
      const wob2 = noise1(t * 1.3 + u * 1.5, this.seed + 3) * wobbleAmp;
      // Doubled over (or taking a bow): fold forward sharply above the waist.
      let fold = 0;
      if (p.doubled) fold = Math.max(0, u - 0.35) * 1.3;
      if (bow > 0) fold = Math.max(fold, Math.max(0, u - 0.3) * 1.25 * bow);
      // Crop Duster: bent over at the waist, butt out.
      if (this.bend > 0) fold = Math.max(fold, Math.max(0, u - 0.3) * 1.35 * this.bend);
      const buttOut = this.bend * 0.2 * Math.min(1, u / 0.3);
      const x = (this.leanX * bend + wob1 * u) * bodyLen;
      const z = (this.leanZ * bend * (p.doubled ? 0.4 : 1) + wob2 * u) * bodyLen + fold * 0.9 - buttOut;
      const y = BASE_H + sArc - (Math.abs(x) + Math.abs(z)) * 0.18 * u - fold * 0.8;
      spine[i * 3] = x;
      spine[i * 3 + 1] = y;
      spine[i * 3 + 2] = z;
      // Juice: a big V-shaped chest.
      radii[i] = r * radScale * (1 + this.bulk * 0.45 * Math.max(0, 1 - Math.abs(u - 0.55) / 0.3));
    }
    this.body.update(0, 0, 1);

    // --- Face, placed on the front of the head ring. ---
    const headRing = n - 8;
    const hx = spine[headRing * 3];
    const hy = spine[headRing * 3 + 1];
    const hz = spine[headRing * 3 + 2];
    const N = this.body.normals;
    const B = this.body.binormals;
    const nx = N[headRing * 3];
    const ny = N[headRing * 3 + 1];
    const nz = N[headRing * 3 + 2];
    const hr = radii[headRing];
    this.face.position.set(hx + nx * hr * 0.92, hy + ny * hr * 0.92, hz + nz * hr * 0.92);
    // Orient the face so +z points along the ring normal and +y along the tube.
    const ti = headRing + 1;
    const up = SV1.set(spine[ti * 3] - hx, spine[ti * 3 + 1] - hy, spine[ti * 3 + 2] - hz).normalize();
    const fwd = SV2.set(nx, ny, nz);
    const right = SV3.crossVectors(up, fwd).normalize();
    const m = SM.makeBasis(right, up, fwd);
    this.face.quaternion.setFromRotationMatrix(m);
    if (this.facePhoto) {
      // Sized to the head (it grows as you inflate) and squashed a little when you get hit.
      const k = (hr * 0.8) / this.face.scale.x;
      this.facePhoto.scale.set(k * (p.doubled ? 1.12 : 1), k * (p.launched ? 1.1 : p.doubled ? 0.85 : 1), k);
      // The face group sits just under the skin; the photo goes on top of it.
      this.facePhoto.position.z = (hr * 0.12) / this.face.scale.x;
    }

    // Expressions.
    const scared = p.launched;
    const ouch = p.doubled;
    const face = this.look.face;
    this.mouthO.visible = (scared || face === 'surprised') && !ouch && !this.facePhoto;
    this.mouthSmile.visible = !this.mouthO.visible && !this.facePhoto;
    this.mouthSmile.rotation.z = ouch ? 0 : Math.PI;
    this.mouthSmile.position.set(0, ouch ? -0.26 : -0.2, 0);
    if (face === 'angry' && !scared && !ouch) this.mouthSmile.rotation.z = 0;
    if (face === 'winky' && !ouch) {
      // A sly half smile.
      this.mouthSmile.rotation.z = Math.PI + 0.3;
      this.mouthSmile.position.x = 0.03;
    }
    const blink = noise1(t * 0.9, this.seed + 9) > 0.93 ? 0.1 : 1;
    const lids = face === 'sleepy' ? 0.42 : 1;
    const squint = (ouch ? 0.15 : p.charge > 0.5 ? 0.7 : 1) * lids;
    const st = this.eyeKind;
    for (let i = 0; i < 2; i++) {
      const eye = this.eyes[i];
      const pupil = this.pupils[i];
      const size = (face === 'derp' ? (i === 0 ? 1.3 : 0.8) : face === 'surprised' ? 1.12 : 1) * st.eyeSize;
      const wink = face === 'winky' && i === 1 && !scared ? 0.12 : 1;
      const lid = squint * blink * wink;
      eye.scale.set(size, size * lid, size);
      const beat = st.pulse ? 1 + Math.max(0, Math.sin(t * 7 + i * 0.6)) * 0.2 : 1;
      const pk = (scared ? 0.6 : face === 'surprised' ? 0.75 : 1) * beat * size;
      pupil.scale.set(pk * st.pupilScale[0], pk * st.pupilScale[1] * lid, size);
      const look = noise1(t * 0.6 + i * 0.01, this.seed + 5) * 0.025;
      pupil.position.x = (i === 0 ? -0.12 : 0.12) + look + (face === 'derp' ? (i === 0 ? -0.03 : 0.03) : 0);
      pupil.position.y = face === 'derp' ? (i === 0 ? 0.03 : -0.03) : face === 'sleepy' ? -0.02 : 0;
      pupil.position.z = st.pupilZ * size;
      if (st.spin) pupil.rotation.z = t * st.spin * (i === 0 ? 1 : -1);
      if (st.wobble) {
        // Googly pupils rattle around, more when moving.
        const shake = 0.012 + Math.min(0.03, (speedH + Math.abs(p.vy)) * 0.002);
        pupil.position.x += noise1(t * 9 + i * 3, this.seed + 31) * shake;
        pupil.position.y += noise1(t * 8 + i * 5, this.seed + 37) * shake - 0.015;
      }
    }
    const cyc = this.faceExtras.userData.eye as THREE.Object3D | undefined;
    if (cyc) {
      cyc.scale.set(1, squint * blink, 1);
      const cp = this.faceExtras.userData.pupil as THREE.Object3D;
      const k = scared ? 0.6 : 1;
      cp.scale.set(k, k * squint * blink, 1);
      cp.position.x = noise1(t * 0.6, this.seed + 5) * 0.04;
    }

    // Hair tuft on the very top, following the tip's direction.
    const top = n - 1;
    const pre = n - 3;
    this.hair.position.set(spine[top * 3], spine[top * 3 + 1] - 0.05, spine[top * 3 + 2]);
    const tip = SV1.set(spine[top * 3] - spine[pre * 3], spine[top * 3 + 1] - spine[pre * 3 + 1], spine[top * 3 + 2] - spine[pre * 3 + 2]).normalize();
    this.hair.quaternion.setFromUnitVectors(Y_UP, tip);
    const flying = p.launched || (!p.onGround && Math.hypot(p.vx, p.vy, p.vz) > 12);
    animateHat(this.hat, t, dt, flying);
    animateBase(this.base, t, flying);

    // --- Arms: constant, joyful flailing. ---
    let flailTarget = p.bracing || p.holding ? 0.15 : p.held ? 2.4 : p.hanging ? 0.3 : p.launched ? 1.8 : 1 + Math.min(0.6, Math.hypot(lvx, lvz) * 0.05);
    flailTarget *= 1 - 0.8 * deflate;
    this.flail += (flailTarget - this.flail) * Math.min(1, dt * 6);
    const shoulderRing = Math.round(n * 0.52);
    const sx0 = spine[shoulderRing * 3];
    const sy0 = spine[shoulderRing * 3 + 1];
    const sz0 = spine[shoulderRing * 3 + 2];
    const sr = radii[shoulderRing] * 0.85;
    const bx = B[shoulderRing * 3];
    const by = B[shoulderRing * 3 + 1];
    const bz = B[shoulderRing * 3 + 2];
    const fnx = N[shoulderRing * 3];
    const fny = N[shoulderRing * 3 + 1];
    const fnz = N[shoulderRing * 3 + 2];
    for (let side = 0; side < 2; side++) {
      const sgn = side === 0 ? 1 : -1;
      const arm = this.arms[side];
      const as = arm.spine;
      let px = sx0 + bx * sr * sgn;
      let py = sy0 + by * sr * sgn;
      let pz = sz0 + bz * sr * sgn;
      // Base direction: out and up.
      // Robot Mode: the arms move in stiff little steps.
      const ta = p.robot ? Math.floor(t * 7) / 7 : t;
      let ang = 0.5 + noise1(ta * 2.2, this.seed + side * 11) * 0.7 * this.flail;
      let yaw = noise1(ta * 1.6, this.seed + side * 17) * 0.8 * this.flail;
      // Juice: a double-biceps flex (after the jab, and now and then while jacked).
      const flex = this.flexT > 0 && this.jabT <= 0 ? Math.min(1, this.flexT * 4, (FLEX_TIME - this.flexT) * 5) : this.bulk > 0.9 ? Math.max(0, Math.sin(t * 2.1 + this.seed) * 3 - 2) : 0;
      if (flex > 0) {
        ang = ang * (1 - flex) + 0.1 * flex;
        yaw = yaw * (1 - flex) + 0.2 * flex;
      }
      if (this.bend > 0.3) {
        // Hands on knees.
        ang = ang * (1 - this.bend) - 0.9 * this.bend;
        yaw = yaw * (1 - this.bend) + 0.9 * this.bend;
      }
      if (wave > 0 && side === 0) {
        // Big friendly wave.
        ang = 1.2 * wave + ang * (1 - wave);
        yaw = Math.sin(t * 12) * 0.9 * wave;
      } else if (dance > 0) {
        // Arms up, pumping in turn.
        ang = (1.05 + Math.sin(t * 9 + side * Math.PI) * 0.45) * dance + ang * (1 - dance);
        yaw = Math.sin(t * 9 + side) * 0.5 * dance + yaw * (1 - dance);
      } else if (bow > 0) {
        // One hand to the tummy, one sweeping out behind.
        ang = (side === 0 ? -0.1 : 0.2) * bow + ang * (1 - bow);
        yaw = (side === 0 ? 1.2 : -1.3) * bow + yaw * (1 - bow);
      } else if (deflate > 0) {
        ang = -1.1 * deflate + ang * (1 - deflate);
      } else if (p.hanging) {
        // Reaching up to the ledge.
        ang = 1.25;
        yaw = 0.9;
      } else if (p.holding) {
        // Bear hug out in front.
        ang = 0.15;
        yaw = 1.2;
      }
      const seg = ARM_LEN / (ARM_RINGS - 1);
      for (let i = 0; i < ARM_RINGS; i++) {
        as[i * 3] = px;
        as[i * 3 + 1] = py;
        as[i * 3 + 2] = pz;
        const fi = i / (ARM_RINGS - 1);
        const armR = ARM_R * this.shape.arm;
        // Juice: huge biceps (and forearms), cartoon style.
        const pump = 1 + this.bulk * (0.45 + 1.5 * Math.max(0, 1 - Math.abs(fi - 0.33) / 0.2) + 0.6 * Math.max(0, 1 - Math.abs(fi - 0.72) / 0.15));
        arm.radii[i] = (i === ARM_RINGS - 1 ? 0.02 : i === ARM_RINGS - 2 ? armR * 0.8 : armR * (1.15 - fi * 0.25)) * pump * (1 - 0.3 * deflate);
        const wig = 1 - flex;
        ang += noise1(ta * 3.4 + i * 0.45, this.seed + side * 23) * 0.42 * this.flail * wig + (i >= 4 && i <= 7 ? 0.42 * flex : 0);
        yaw += noise1(ta * 2.9 + i * 0.4, this.seed + side * 29) * 0.3 * this.flail * wig;
        if (p.doubled) ang -= 0.2;
        // Direction = out (binormal) / up / forward (ring normal) mix.
        const ca = Math.cos(ang);
        const outK = ca * Math.cos(yaw) * sgn;
        const upK = Math.sin(ang);
        const fwdK = ca * Math.sin(yaw);
        px += (bx * outK + fnx * fwdK) * seg;
        py += (by * outK + upK + fny * fwdK) * seg;
        pz += (bz * outK + fnz * fwdK) * seg;
      }
      arm.update(0, 1, 0);
    }

    // Character props: the syringe rides in the free hand, pointing along the arm.
    if (this.props) {
      if (this.props.hand) {
        const a = this.arms[1].spine;
        const k = (ARM_RINGS - 2) * 3;
        const j = (ARM_RINGS - 4) * 3;
        this.handProp.position.set(a[k], a[k + 1], a[k + 2]);
        this.handProp.quaternion.setFromUnitVectors(Y_UP, SV1.set(a[k] - a[j], a[k + 1] - a[j + 1], a[k + 2] - a[j + 2]).normalize());
        this.handProp.visible = !p.held;
      }
      this.props.animate(t, dt, Math.min(1, speedH / 8));
    }

    // Glow while charging, flash while braced; the crown wearer glows gold, your nemesis red.
    let boost = p.charge * 0.55 + (p.bracing ? 0.6 : 0);
    let tint = -1;
    if (p.crowned) boost += 0.35 + Math.sin(t * 5) * 0.15;
    if (p.nemesis) {
      boost += 0.45 + Math.sin(t * 8) * 0.25;
      tint = 0xff2040;
    } else if (danger > 0) {
      // Warning pulse that speeds up as they get close to popping.
      const pulse = 0.5 + 0.5 * Math.sin(t * (5 + danger * 9));
      boost += danger * (0.25 + 0.45 * pulse);
      tint = 0xff2a2a;
    } else if (p.powered) {
      boost += 0.4 + 0.25 * Math.abs(Math.sin(t * 13 + this.seed));
      tint = 0xffa51f;
    }
    let flash = 0;
    if (this.impactT > 0) {
      // Hit flash.
      this.impactT -= dt;
      tint = 0xffffff;
      flash = 0.9 * (this.impactT / 0.1);
    }
    paintGlow(this.bodyMat, this.color, this.shineP.glow + boost, tint, flash);
    if (hasOutfit(this.look.body)) {
      paintGlow(this.outfitMat, TubeMan.BLACK, boost, tint, flash);
      paintGlow(this.sleeveMat, TubeMan.BLACK, boost, tint, flash);
    }
    if (this.look.accent >= 0) paintGlow(this.armMat, this.accentColor, this.accentShineP.glow + boost, tint, flash);
    // Robot Mode: red slit eyes glowing through a visor (back to your own eyes after).
    if (p.robot !== this.robotEyes) {
      this.robotEyes = p.robot;
      if (p.robot) {
        for (const e of this.eyes) {
          e.material = sharedMat.robotEye;
          e.visible = !this.facePhoto;
        }
        for (const pu of this.pupils) pu.visible = false;
      } else this.applyFaceBase();
      this.visor.visible = p.robot && !this.facePhoto;
    }
    if (p.robot) for (const e of this.eyes) e.scale.set(1.2, 0.38, 0.8);
    this.updateSyringe(spine, radii, N, B, shoulderRing - 1);
    this.crown.visible = p.crowned;
    if (p.crowned) {
      this.crown.position.set(spine[(n - 1) * 3], spine[(n - 1) * 3 + 1] + 0.1, spine[(n - 1) * 3 + 2]);
      this.crown.rotation.y = t * 1.5;
    }
    this.bodyMat.metalness = p.bracing ? Math.max(0.6, this.shineP.metal) : this.shineP.metal;
    this.armMat.metalness = p.bracing ? Math.max(0.6, this.accentShineP.metal) : this.accentShineP.metal;

    // Weapon held out in front of the chest, pointing where the player aims.
    if (this.gun) {
      const gi = Math.round(n * 0.4);
      const gr = radii[gi] + 0.12;
      this.gunMount.position.set(spine[gi * 3] + N[gi * 3] * gr, spine[gi * 3 + 1] + N[gi * 3 + 1] * gr, spine[gi * 3 + 2] + N[gi * 3 + 2] * gr);
      this.gunMount.rotation.set(p.pitch - this.rig.rotation.x, Math.PI, 0);
      this.gun.root.visible = !p.held && !p.holding;
      this.gun.setCharge(p.charge, t, p.streaming);
    }
    this.pin.visible = p.hasPin;
    if (p.hasPin) {
      this.pin.position.set(spine[(n - 1) * 3], spine[(n - 1) * 3 + 1] + 0.55, spine[(n - 1) * 3 + 2]);
      this.pin.rotation.y = t * 3;
    }

    this.bubble.visible = p.protected;
    if (p.protected) {
      this.bubble.position.set(0, BASE_H + BODY_LEN * 0.55, 0);
      this.bubble.scale.set(1.25, 1.55, 1.25);
    }
  }

  /** The Juice syringe: jabs into the front of the shoulder, the plunger pushes the air in, then it's gone. */
  private updateSyringe(spine: Float32Array, radii: Float32Array, N: Float32Array, B: Float32Array, ring: number): void {
    const g = this.syringe;
    if (!g) return;
    g.visible = this.jabT > 0;
    if (!g.visible) return;
    const k = 1 - this.jabT / JAB_TIME;
    // Out of the chest, toward one shoulder (where everyone in front can see it).
    const out = SV1.set(N[ring * 3] * 0.7 + B[ring * 3], N[ring * 3 + 1] * 0.7 + B[ring * 3 + 1] - 0.15, N[ring * 3 + 2] * 0.7 + B[ring * 3 + 2]).normalize();
    // Approach, hold (needle in) while pushing the plunger, pull back out.
    const away = 0.05 + (k < 0.3 ? (0.3 - k) * 2 : k > 0.8 ? (k - 0.8) * 2.5 : 0);
    const r = radii[ring];
    g.position.set(spine[ring * 3] + out.x * (r + away), spine[ring * 3 + 1] + out.y * (r + away), spine[ring * 3 + 2] + out.z * (r + away));
    // The needle end (-y) points into the body.
    g.quaternion.setFromUnitVectors(Y_UP, out);
    const plunger = g.userData.plunger as THREE.Object3D;
    plunger.position.y = 0.95 - 0.45 * Math.min(1, Math.max(0, (k - 0.3) / 0.45));
    g.scale.setScalar(k > 0.85 ? Math.max(0.01, (1 - k) / 0.15) : Math.min(1, k * 6));
  }

  setVisible(v: boolean): void {
    this.group.visible = v;
  }

  dispose(): void {
    this.body.dispose();
    for (const a of this.arms) a.dispose();
    this.bodyMat.dispose();
    this.armMat.dispose();
    disposeGroup(this.hat);
    disposeGroup(this.faceExtras);
    if (this.facePhoto) disposeFacePhoto(this.facePhoto);
    disposeGroup(this.base);
    this.props?.dispose();
    this.outfitMat.dispose();
    this.sleeveMat.dispose();
    if (this.syringe) disposeGroup(this.syringe);
  }
}

/** Emissive color and strength for a body/arm material this frame. */
function paintGlow(mat: BodyMat, own: THREE.Color, glow: number, tint: number, flash: number): void {
  if (tint >= 0) mat.emissive.setHex(tint);
  else mat.emissive.copy(own);
  mat.emissiveIntensity = Math.max(glow, flash);
}

const JAB_TIME = 0.9;
const FLEX_TIME = 1.3;

/**
 * Juice's giant syringe (full of air, not anything else): a see-through barrel with a puff of air
 * inside, a plunger and a needle. Points along +y with the needle at the bottom.
 */
function makeSyringe(): THREE.Group {
  const g = new THREE.Group();
  const glass = new THREE.MeshStandardMaterial({ color: 0xcff4ff, transparent: true, opacity: 0.55, roughness: 0.05, emissive: 0x6fd8ff, emissiveIntensity: 0.25, depthWrite: false });
  const metal = new THREE.MeshStandardMaterial({ color: 0xdfe6f3, metalness: 0.8, roughness: 0.2 });
  const red = new THREE.MeshStandardMaterial({ color: 0xff3b5c, roughness: 0.4 });
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.62, 16), glass);
  barrel.position.y = 0.52;
  const air = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 8), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x9fe8ff, emissiveIntensity: 0.6, roughness: 0.3 }));
  air.scale.set(1, 3, 1);
  air.position.y = 0.5;
  const needle = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.004, 0.3, 6), metal);
  needle.position.y = 0.06;
  const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.11, 0.08, 12), metal);
  tip.position.y = 0.2;
  const flange = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.03, 0.1), red);
  flange.position.y = 0.83;
  const plunger = new THREE.Group();
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.5, 8), red);
  rod.position.y = -0.1;
  const thumb = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.035, 14), red);
  thumb.position.y = 0.16;
  plunger.add(rod, thumb);
  plunger.position.y = 0.95;
  g.add(barrel, air, needle, tip, flange, plunger);
  g.userData.plunger = plunger;
  g.visible = false;
  return g;
}

/** A giant sewing pin that floats over whoever is carrying one. */
function makePin(): THREE.Group {
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.005, 0.7, 8), new THREE.MeshStandardMaterial({ color: 0xdfe6f3, metalness: 0.8, roughness: 0.2 }));
  shaft.position.y = -0.35;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), new THREE.MeshStandardMaterial({ color: 0xff2d55, emissive: 0xff2d55, emissiveIntensity: 0.5, roughness: 0.2 }));
  g.add(shaft, head);
  const holder = new THREE.Group();
  holder.add(g);
  return holder;
}

/** A chunky golden crown for the player on the longest streak. */
function makeCrown(): THREE.Group {
  const g = new THREE.Group();
  const gold = new THREE.MeshStandardMaterial({ color: 0xffc933, metalness: 0.8, roughness: 0.25, emissive: 0xffa000, emissiveIntensity: 0.35 });
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.3, 0.2, 20, 1, true), gold);
  band.material.side = THREE.DoubleSide;
  g.add(band);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.24, 8), gold);
    spike.position.set(Math.cos(a) * 0.3, 0.2, Math.sin(a) * 0.3);
    const gem = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), new THREE.MeshStandardMaterial({ color: [0xff2d55, 0x2ec5ff, 0x8ee000][i % 3], emissive: 0xffffff, emissiveIntensity: 0.2 }));
    gem.position.set(Math.cos(a) * 0.31, 0.02, Math.sin(a) * 0.31);
    g.add(spike, gem);
  }
  g.traverse((o) => ((o as THREE.Mesh).castShadow = true));
  return g;
}
