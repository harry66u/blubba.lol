import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { DecorDef } from '../../shared/maps/types';

/**
 * Procedural props for the maps (food trucks, candy, skate park and moon base pieces). Every prop
 * is built from shared materials so the map can merge all static props that look alike into one
 * draw call (see MapView), which keeps prop-heavy maps cheap on school laptops.
 */

type Mat = THREE.MeshStandardMaterial;

interface MatOpts {
  metal?: number;
  emissive?: number;
  glow?: number;
  map?: THREE.Texture | null;
  alphaMap?: THREE.Texture | null;
  side?: THREE.Side;
  flat?: boolean;
  opacity?: number;
  /** Doesn't cast a shadow (painted-on decals, glass). */
  noShadow?: boolean;
  /** Drawn on top of a surface without z-fighting. */
  decal?: boolean;
  fog?: boolean;
}

function hash(n: number): number {
  const s = Math.sin(n * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

const css = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

/** Materials, textures and per-frame animations shared by a map's props. */
export class PropKit {
  private readonly mats = new Map<string, Mat>();
  private readonly texs = new Map<string, THREE.Texture>();
  private readonly anims: ((dt: number, t: number) => void)[] = [];

  /** A shared material: every prop painted the same way gets the very same one. */
  mat(color: number, rough = 0.6, o: MatOpts = {}): Mat {
    const key = [color, rough, o.metal, o.emissive, o.glow, o.map?.uuid, o.alphaMap?.uuid, o.side, o.flat, o.opacity, o.noShadow, o.decal, o.fog].join('|');
    let m = this.mats.get(key);
    if (!m) {
      const opacity = o.opacity ?? 1;
      m = new THREE.MeshStandardMaterial({
        color,
        roughness: rough,
        metalness: o.metal ?? 0,
        emissive: o.emissive ?? 0x000000,
        emissiveIntensity: o.glow ?? 1,
        map: o.map ?? null,
        alphaMap: o.alphaMap ?? null,
        side: o.side ?? THREE.FrontSide,
        flatShading: !!o.flat,
        transparent: opacity < 1 || !!o.alphaMap,
        opacity,
        depthWrite: opacity >= 1 && !o.alphaMap,
        fog: o.fog ?? true,
      });
      if (o.noShadow || o.decal) m.userData.noShadow = true;
      if (o.decal) {
        m.polygonOffset = true;
        m.polygonOffsetFactor = -2;
        m.polygonOffsetUnits = -2;
      }
      this.mats.set(key, m);
    }
    return m;
  }

  /** A canvas texture drawn once per key. */
  tex(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, repeat = false): THREE.CanvasTexture {
    let t = this.texs.get(key) as THREE.CanvasTexture | undefined;
    if (!t) {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      draw(c.getContext('2d')!, w, h);
      t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
      this.texs.set(key, t);
    }
    return t;
  }

  /** Runs every frame (flowing chocolate, the orbiting satellite). */
  onFrame(fn: (dt: number, t: number) => void): void {
    this.anims.push(fn);
  }

  update(dt: number, t: number): void {
    for (const a of this.anims) a(dt, t);
  }

  dispose(): void {
    for (const m of this.mats.values()) m.dispose();
    for (const t of this.texs.values()) t.dispose();
    this.mats.clear();
    this.texs.clear();
    this.anims.length = 0;
  }

  // --- Shared textures ------------------------------------------------------------------------

  /** Big rounded letters with an outline, on a colored (or clear) background. */
  text(text: string, bg: string | null, fg: string, w = 512, h = 128, vertical = false): THREE.CanvasTexture {
    return this.tex(`text|${text}|${bg}|${fg}|${w}|${h}|${vertical}`, w, h, (g) => {
      if (bg) {
        g.fillStyle = bg;
        g.fillRect(0, 0, w, h);
      }
      g.fillStyle = fg;
      g.strokeStyle = '#1d1b3a';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      if (vertical) {
        const size = Math.min(w * 0.8, (h * 0.9) / text.length);
        g.font = `900 ${Math.round(size)}px "Arial Rounded MT Bold", Arial, sans-serif`;
        g.lineWidth = size * 0.12;
        [...text].forEach((ch, i) => {
          const y = h / 2 + (i - (text.length - 1) / 2) * size;
          g.strokeText(ch, w / 2, y);
          g.fillText(ch, w / 2, y);
        });
      } else {
        g.font = `900 ${Math.round(Math.min(h * 0.62, (w * 1.5) / Math.max(4, text.length)))}px "Arial Rounded MT Bold", Arial, sans-serif`;
        g.lineWidth = h * 0.08;
        g.strokeText(text, w / 2, h / 2 + h * 0.04);
        g.fillText(text, w / 2, h / 2 + h * 0.04);
      }
    });
  }

  /** Two-color stripes along the texture's u (diagonal ones wrap around a tube as a spiral). */
  stripes(c1: number, c2: number, diagonal: boolean): THREE.CanvasTexture {
    return this.tex(
      `stripes|${c1}|${c2}|${diagonal}`,
      64,
      64,
      (g, w, h) => {
        const img = g.createImageData(w, h);
        const a = new THREE.Color(c1);
        const b = new THREE.Color(c2);
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const c = ((diagonal ? x + y : y) / w) % 1 < 0.5 ? a : b;
            const i = (y * w + x) * 4;
            img.data[i] = c.r * 255;
            img.data[i + 1] = c.g * 255;
            img.data[i + 2] = c.b * 255;
            img.data[i + 3] = 255;
          }
        }
        g.putImageData(img, 0, 0);
      },
      true,
    );
  }

  /** Frosting in `base` with a scatter of rainbow sprinkles. */
  sprinkles(base: number): THREE.CanvasTexture {
    return this.tex(
      `sprinkles|${base}`,
      128,
      128,
      (g, w, h) => {
        g.fillStyle = css(base);
        g.fillRect(0, 0, w, h);
        const colors = ['#ff3b5c', '#ffd60a', '#2ec5ff', '#8ee000', '#ffffff', '#b06bff'];
        for (let i = 0; i < 70; i++) {
          g.save();
          g.translate(hash(i * 3.1) * w, hash(i * 7.7) * h);
          g.rotate(hash(i * 1.3) * Math.PI);
          g.fillStyle = colors[i % colors.length];
          g.fillRect(-5, -1.5, 10, 3);
          g.restore();
        }
      },
      true,
    );
  }

  /** Waffle-cone crosshatch. */
  waffle(): THREE.CanvasTexture {
    return this.tex(
      'waffle',
      64,
      64,
      (g, w, h) => {
        g.fillStyle = '#d9a55b';
        g.fillRect(0, 0, w, h);
        g.strokeStyle = 'rgba(120,65,20,0.55)';
        g.lineWidth = 5;
        for (let k = -w; k <= w * 2; k += 32) {
          g.beginPath();
          g.moveTo(k, 0);
          g.lineTo(k + h, h);
          g.moveTo(k, h);
          g.lineTo(k + h, 0);
          g.stroke();
        }
      },
      true,
    );
  }
}

// --- Geometry helpers ------------------------------------------------------------------------------

function put(g: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  g.add(m);
  return m;
}

/** A rounded rectangle path (half-sizes hx, hz, corner radius r) for shapes and holes. */
function roundRect(path: THREE.Path, hx: number, hz: number, r: number, reverse = false): void {
  const pts: [number, number][] = [];
  const corner = (cx: number, cz: number, a0: number) => {
    for (let i = 0; i <= 6; i++) {
      const a = a0 + (i / 6) * (Math.PI / 2);
      pts.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
    }
  };
  corner(hx - r, hz - r, 0);
  corner(-hx + r, hz - r, Math.PI / 2);
  corner(-hx + r, -hz + r, Math.PI);
  corner(hx - r, -hz + r, (3 * Math.PI) / 2);
  if (reverse) pts.reverse();
  path.moveTo(pts[0][0], pts[0][1]);
  for (const [x, z] of pts.slice(1)) path.lineTo(x, z);
  path.closePath();
}

/** Scales a geometry's UVs (so a repeating texture tiles at a fixed size in meters). */
function uvScale(geo: THREE.BufferGeometry, su: number, sv: number): THREE.BufferGeometry {
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  return geo;
}

const num = (d: DecorDef, k: string, fallback: number) => Number(d.data?.[k] ?? fallback);

// --- Car lots ----------------------------------------------------------------------------------------

function foodTruck(kit: PropKit, d: DecorDef): THREE.Group {
  const g = new THREE.Group();
  const paint = kit.mat(d.color ?? 0xfff1d6, 0.4, { metal: 0.1 });
  const glass = kit.mat(0x2c3550, 0.1, { metal: 0.3 });
  const trim = kit.mat(0x9aa3b8, 0.4, { metal: 0.5 });
  put(g, new RoundedBoxGeometry(2.4, 2.4, 4.8, 2, 0.22), paint, 0, 1.65, -0.8);
  put(g, new RoundedBoxGeometry(2.2, 1.6, 1.6, 2, 0.25), paint, 0, 1.25, 2.4);
  put(g, new THREE.BoxGeometry(1.9, 0.6, 0.08), glass, 0, 1.6, 3.2, -0.25);
  for (const s of [-1, 1]) put(g, new THREE.BoxGeometry(0.06, 0.5, 0.9), glass, s * 1.11, 1.6, 2.5);
  put(g, new THREE.BoxGeometry(2.3, 0.3, 0.2), trim, 0, 0.6, 3.25);
  // Serving window, counter and a striped awning on the right-hand side.
  put(g, new THREE.BoxGeometry(0.06, 0.9, 2.6), glass, 1.21, 1.95, -0.8);
  put(g, new THREE.BoxGeometry(0.4, 0.08, 2.8), kit.mat(0xffffff, 0.5), 1.38, 1.45, -0.8);
  put(g, new THREE.BoxGeometry(1.0, 0.06, 3.0), kit.mat(0xffffff, 0.6, { map: kit.stripes(0xff4d6d, 0xffffff, false) }), 1.62, 2.55, -0.8, 0, 0, -0.35);
  // Name board on the roof.
  const text = String(d.data?.text ?? 'SNACKS');
  put(g, new THREE.BoxGeometry(0.12, 0.7, 3.0), kit.mat(0xffffff, 0.5, { map: kit.text(text, '#ffd60a', '#ff3b8a', 512, 128) }), 0, 3.2, -1.4, 0, Math.PI / 2, 0);
  // The giant snack on the roof.
  const snack = String(d.data?.snack ?? 'hotdog');
  if (snack === 'hotdog') {
    put(g, new THREE.CapsuleGeometry(0.42, 1.5, 4, 12), kit.mat(0xe0a55a, 0.7), 0, 3.25, 1.0, Math.PI / 2);
    put(g, new THREE.CapsuleGeometry(0.26, 2.1, 4, 12), kit.mat(0xc0503a, 0.45), 0, 3.6, 1.0, Math.PI / 2);
    put(g, new THREE.CapsuleGeometry(0.06, 1.8, 3, 6), kit.mat(0xffd60a, 0.4), 0, 3.86, 1.0, Math.PI / 2, 0, 0.1);
  } else if (snack === 'taco') {
    const shell = new THREE.CylinderGeometry(0.85, 0.85, 1.7, 16, 1, true, Math.PI / 2, Math.PI);
    put(g, shell, kit.mat(0xf2c14e, 0.6, { side: THREE.DoubleSide }), 0, 3.75, 1.0, Math.PI / 2, 0, 0);
    put(g, new THREE.BoxGeometry(1.3, 0.35, 1.5), kit.mat(0x6cc24a, 0.7), 0, 3.95, 1.0);
    for (const [x, z] of [
      [-0.35, 0.5],
      [0.3, 1.0],
      [-0.1, 1.5],
    ]) put(g, new THREE.SphereGeometry(0.2, 10, 8), kit.mat(0xe23b3b, 0.4), x, 4.15, z);
  } else {
    put(g, new THREE.TorusGeometry(0.6, 0.3, 10, 20), kit.mat(0xff8fc4, 0.45), 0, 3.8, 1.0);
  }
  const tire = kit.mat(0x23242e, 0.8);
  const hub = kit.mat(0xd0d6e4, 0.3, { metal: 0.6 });
  for (const [x, z] of [
    [-1.05, 2.1],
    [1.05, 2.1],
    [-1.05, -2.3],
    [1.05, -2.3],
  ]) {
    put(g, new THREE.CylinderGeometry(0.42, 0.42, 0.3, 16), tire, x, 0.42, z, 0, 0, Math.PI / 2);
    put(g, new THREE.CylinderGeometry(0.2, 0.2, 0.32, 10), hub, x, 0.42, z, 0, 0, Math.PI / 2);
  }
  return g;
}

/** An arch of balloons: clusters along a half-ellipse from one foot to the other. */
function balloonArch(kit: PropKit, d: DecorDef): THREE.Group {
  const g = new THREE.Group();
  const span = num(d, 'span', 6);
  const h = num(d, 'h', 4.6);
  const colors = [0xff6fa8, 0xffd60a, 0x6fd3ff, 0x9dff6f, 0xc49bff].map((c) => kit.mat(c, 0.25, { emissive: c, glow: 0.12 }));
  const ball = new THREE.SphereGeometry(0.3, 10, 8).scale(1, 1.12, 1);
  const n = 30;
  for (let k = 0; k <= n; k++) {
    const a = (k / n) * Math.PI;
    const x = (span / 2) * Math.cos(a);
    const y = h * Math.sin(a) + 0.3;
    // Normal of the arch in its plane, so each cluster puffs out sideways.
    const nx = Math.cos(a) / (span / 2);
    const ny = Math.sin(a) / h;
    const nl = Math.hypot(nx, ny);
    for (let i = 0; i < 4; i++) {
      const s = i % 2 ? 0.28 : -0.28;
      const [ox, oy, oz] = i < 2 ? [(nx / nl) * s, (ny / nl) * s, 0] : [0, 0, s];
      put(g, ball, colors[(k + i) % colors.length], x + ox, y + oy, oz);
    }
  }
  for (const s of [-1, 1]) put(g, new THREE.BoxGeometry(0.45, 0.3, 0.45), kit.mat(0x5a5f73, 0.6), (s * span) / 2, 0.15, 0);
  return g;
}

/** A tall feather banner with one word down it. */
function banner(kit: PropKit, d: DecorDef): THREE.Group {
  const g = new THREE.Group();
  put(g, new THREE.CylinderGeometry(0.05, 0.06, 4.3, 8), kit.mat(0xe8ecf5, 0.4, { metal: 0.4 }), 0, 2.15, 0);
  const t = kit.text(String(d.data?.text ?? 'SALE'), '#ff3b8a', '#ffd60a', 128, 512, true);
  put(g, new THREE.PlaneGeometry(0.9, 3.0), kit.mat(0xffffff, 0.6, { map: t, side: THREE.DoubleSide }), 0.5, 2.7, 0);
  return g;
}

// --- Sugar Rush -------------------------------------------------------------------------------------

function lollipop(kit: PropKit, d: DecorDef): THREE.Group {
  const g = new THREE.Group();
  const h = num(d, 'h', 5);
  const r = num(d, 'r', 1.4);
  const c1 = d.color ?? 0xff4d8d;
  const c2 = num(d, 'c2', 0xffffff);
  put(g, new THREE.CylinderGeometry(0.12, 0.12, h, 8), kit.mat(0xfdf8f0, 0.5), 0, h / 2, 0);
  const swirl = kit.tex(`swirl|${c1}|${c2}`, 128, 128, (ctx, w) => {
    const img = ctx.createImageData(w, w);
    const a = new THREE.Color(c1);
    const b = new THREE.Color(c2);
    for (let y = 0; y < w; y++) {
      for (let x = 0; x < w; x++) {
        const dx = x - w / 2;
        const dy = y - w / 2;
        const t = ((Math.atan2(dy, dx) / (Math.PI * 2) + Math.hypot(dx, dy) / 26) * 3) % 1;
        const c = (t + 1) % 1 < 0.5 ? a : b;
        const i = (y * w + x) * 4;
        img.data[i] = c.r * 255;
        img.data[i + 1] = c.g * 255;
        img.data[i + 2] = c.b * 255;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  });
  const face = kit.mat(0xffffff, 0.22, { map: swirl });
  const cy = h + r * 0.95;
  put(g, new THREE.CircleGeometry(r, 32), face, 0, cy, 0.18);
  put(g, new THREE.CircleGeometry(r, 32), face, 0, cy, -0.18, 0, Math.PI, 0);
  put(g, new THREE.CylinderGeometry(r, r, 0.36, 32, 1, true), kit.mat(c1, 0.22), 0, cy, 0, Math.PI / 2);
  return g;
}

function candyCane(kit: PropKit, d: DecorDef): THREE.Group {
  const g = new THREE.Group();
  const h = num(d, 'h', 6);
  const R = 0.9;
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 8; i++) pts.push(new THREE.Vector3(0, ((h - R) * i) / 8, 0));
  for (let i = 1; i <= 16; i++) {
    const a = Math.PI - (i / 16) * Math.PI;
    pts.push(new THREE.Vector3(R + R * Math.cos(a), h - R + R * Math.sin(a), 0));
  }
  pts.push(new THREE.Vector3(2 * R, h - R - 0.5, 0));
  const curve = new THREE.CatmullRomCurve3(pts);
  const tube = new THREE.TubeGeometry(curve, 90, 0.28, 12, false);
  uvScale(tube, curve.getLength() / 0.7, 1);
  put(g, tube, kit.mat(0xffffff, 0.25, { map: kit.stripes(0xff2e4d, 0xffffff, true) }));
  put(g, new THREE.SphereGeometry(0.28, 12, 8), kit.mat(0xff2e4d, 0.25), 2 * R, h - R - 0.5, 0);
  return g;
}

function cupcake(kit: PropKit, d: DecorDef): THREE.Group {
  const g = new THREE.Group();
  const r = num(d, 'r', 1.6);
  const frost = num(d, 'frosting', 0xffffff);
  put(g, new THREE.CylinderGeometry(r, r * 0.8, 1.05, 18), kit.mat(d.color ?? 0x8fd3ff, 0.55, { flat: true }), 0, 0.525, 0);
  const tex = kit.sprinkles(frost);
  const icing = kit.mat(0xffffff, 0.4, { map: tex });
  const ring = new THREE.TorusGeometry(r * 0.7, r * 0.33, 10, 28).rotateX(Math.PI / 2).scale(1, 0.75, 1);
  put(g, uvScale(ring, 6, 2), icing, 0, 1.3, 0);
  const dome = new THREE.SphereGeometry(r * 0.72, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.62, 1);
  put(g, uvScale(dome, 4, 2), icing, 0, 1.3, 0);
  cherry(kit, g, 0.3, 1.3 + r * 0.72 * 0.62 - 0.05);
  return g;
}

function cherry(kit: PropKit, g: THREE.Group, r: number, y: number): void {
  put(g, new THREE.SphereGeometry(r, 16, 12), kit.mat(0xe0203c, 0.18), 0, y + r * 0.85, 0);
  put(g, new THREE.CylinderGeometry(r * 0.08, r * 0.08, r * 1.3, 6), kit.mat(0x5b8a2e, 0.6), r * 0.2, y + r * 2.2, 0, 0, 0, -0.35);
}

function gumdrop(kit: PropKit, d: DecorDef): THREE.Group {
  const g = new THREE.Group();
  const r = num(d, 'r', 1.1);
  const c = d.color ?? 0xff5f7e;
  put(g, new THREE.SphereGeometry(r, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), kit.mat(c, 0.5, { emissive: c, glow: 0.12 }));
  return g;
}

/** A giant donut lying flat, frosted on top; its hole shows the jelly (a solid) underneath. */
function donut(kit: PropKit, d: DecorDef): THREE.Group {
  const g = new THREE.Group();
  const o = num(d, 'outer', 6);
  const i = num(d, 'inner', 2.4);
  const h = num(d, 'h', 1.6);
  const ring = (outer: number, inner: number, depth: number, bevel: number, size: number) => {
    const s = new THREE.Shape();
    roundRect(s, outer - size, outer - size, (outer - size) * 0.55);
    const hole = new THREE.Path();
    roundRect(hole, inner + size, inner + size, (inner + size) * 0.6, true);
    s.holes.push(hole);
    return new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: size, bevelSegments: 3, curveSegments: 6 }).rotateX(-Math.PI / 2);
  };
  // After rotating, the extrusion runs from -bevel to depth + bevel in y.
  const dough = ring(o, i, h - 0.5, 0.25, 0.45);
  dough.translate(0, -(h - 0.25) - 0.2, 0);
  put(g, dough, kit.mat(0xe3a25f, 0.7));
  const icing = ring(o - 0.25, i + 0.25, 0.1, 0.15, 0.3);
  icing.translate(0, -0.23, 0);
  put(g, uvScale(icing, 1 / 3, 1 / 3), kit.mat(0xffffff, 0.4, { map: kit.sprinkles(0xff8fc4) }));
  return g;
}

function iceCream(kit: PropKit, d: DecorDef): THREE.Group {
  const g = new THREE.Group();
  const waffle = kit.mat(0xffffff, 0.8, { map: kit.waffle() });
  put(g, uvScale(new THREE.CylinderGeometry(1.35, 1.1, 1.3, 16), 4, 1), waffle, 0, 0.65, 0);
  put(g, uvScale(new THREE.ConeGeometry(1.75, 4.4, 16, 1, true), 4, 3), waffle, 0, 3.0, 0, Math.PI);
  const scoops: [number, number, number][] = [
    [1.8, 5.8, d.color ?? 0xff9ec7],
    [1.55, 7.85, 0xa8f0d0],
    [1.3, 9.6, 0xfff3d6],
  ];
  for (const [r, y, c] of scoops) put(g, new THREE.SphereGeometry(r, 20, 14), kit.mat(c, 0.55), 0, y, 0);
  cherry(kit, g, 0.42, 10.75);
  return g;
}

/**
 * The chocolate river: it wells up in the middle of the canyon and flows out both ends, pouring off
 * into the sky. Both the surface and the falls scroll.
 */
function chocoRiver(kit: PropKit, d: DecorDef): THREE.Group {
  const g = new THREE.Group();
  const w = num(d, 'w', 6);
  const len = num(d, 'len', 34);
  const flow = kit.tex(
    'chocoFlow',
    64,
    256,
    (ctx, cw, ch) => {
      ctx.fillStyle = '#6b3a1f';
      ctx.fillRect(0, 0, cw, ch);
      for (let i = 0; i < 40; i++) {
        ctx.fillStyle = hash(i) > 0.5 ? 'rgba(160,95,55,0.5)' : 'rgba(60,28,10,0.45)';
        const x = hash(i * 3.3) * cw;
        const y = hash(i * 5.1) * ch;
        ctx.fillRect(x, y, 2 + hash(i * 2.2) * 5, 20 + hash(i * 9.1) * 50);
        ctx.fillRect(x, y - ch, 2 + hash(i * 2.2) * 5, 20 + hash(i * 9.1) * 50);
      }
    },
    true,
  );
  const fallH = 24;
  // Opaque at the lip, fading out as it falls (the fade doesn't scroll with the chocolate).
  const fade = kit.tex('chocoFade', 4, 64, (ctx, cw, ch) => {
    const grad = ctx.createLinearGradient(0, 0, 0, ch);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.35, '#ffffff');
    grad.addColorStop(1, '#000000');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, cw, ch);
  });
  fade.repeat.set(1, 8 / fallH);
  const surface = kit.mat(0xffffff, 0.22, { map: flow, noShadow: true });
  const fall = kit.mat(0xffffff, 0.3, { map: flow, alphaMap: fade, side: THREE.DoubleSide, noShadow: true });
  for (const s of [-1, 1]) {
    // Each half flows away from the middle: the same scrolling texture, turned around.
    const half = uvScale(new THREE.PlaneGeometry(w, len / 2), w / 4, len / 8);
    put(g, half, surface, 0, 0, (s * len) / 4, -Math.PI / 2, 0, s < 0 ? Math.PI : 0);
    const f = uvScale(new THREE.PlaneGeometry(w, fallH), w / 4, fallH / 8);
    put(g, f, fall, 0, -fallH / 2 + 0.05, s * (len / 2 + 0.05), 0, s > 0 ? 0 : Math.PI, 0);
  }
  kit.onFrame((dt) => {
    flow.offset.y = (flow.offset.y + dt * 0.3) % 1;
  });
  return g;
}

// --- Skate Park -------------------------------------------------------------------------------------

const RAMP_PAINT = 0x9cc6f0;

/** A quarter pipe facing +x: the curve rises toward -x to a flat deck, with a metal coping. */
function quarterPipe(kit: PropKit, d: DecorDef): THREE.Group {
  const g = new THREE.Group();
  const r = num(d, 'r', 2.6);
  const deck = num(d, 'deck', 1.2);
  const len = num(d, 'len', 18);
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  const n = 14;
  for (let i = 1; i <= n; i++) {
    const a = (i / n) * (Math.PI / 2);
    s.lineTo(-r * Math.sin(a), r - r * Math.cos(a));
  }
  s.lineTo(-r - deck, r);
  s.lineTo(-r - deck, 0);
  s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, { depth: len, bevelEnabled: false });
  geo.translate(0, 0, -len / 2);
  put(g, geo, kit.mat(d.color ?? RAMP_PAINT, 0.55));
  put(g, new THREE.CylinderGeometry(0.09, 0.09, len, 8), kit.mat(0xdfe6f3, 0.25, { metal: 0.8 }), -r, r + 0.03, 0, Math.PI / 2);
  return g;
}

/** A wedge ramp rising along +x. */
function ramp(kit: PropKit, d: DecorDef): THREE.Group {
  const g = new THREE.Group();
  const len = num(d, 'len', 3.6);
  const w = num(d, 'w', 4);
  const h = num(d, 'h', 1.2);
  const s = new THREE.Shape();
  s.moveTo(-len / 2, 0);
  s.lineTo(len / 2, h);
  s.lineTo(len / 2, 0);
  s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, { depth: w, bevelEnabled: false });
  geo.translate(0, 0, -w / 2);
  put(g, geo, kit.mat(d.color ?? RAMP_PAINT, 0.55));
  put(g, new THREE.BoxGeometry(0.35, 0.03, w), kit.mat(0xdfe6f3, 0.25, { metal: 0.8 }), -len / 2 + 0.17, 0.02, 0);
  return g;
}

function rail(kit: PropKit, d: DecorDef): THREE.Group {
  const g = new THREE.Group();
  const len = num(d, 'len', 10);
  const h = num(d, 'h', 0.75);
  const steel = kit.mat(0xdfe6f3, 0.25, { metal: 0.8 });
  put(g, new THREE.CylinderGeometry(0.08, 0.08, len, 10), steel, 0, h - 0.08, 0, 0, 0, Math.PI / 2);
  const posts = Math.max(2, Math.round(len / 2.5) + 1);
  for (let i = 0; i < posts; i++) {
    const x = -len / 2 + 0.2 + ((len - 0.4) * i) / (posts - 1);
    put(g, new THREE.CylinderGeometry(0.05, 0.05, h - 0.1, 8), kit.mat(0x3b4256, 0.5, { metal: 0.4 }), x, (h - 0.1) / 2, 0);
  }
  return g;
}

/** A concrete wall painted on both sides. */
function graffiti(kit: PropKit, d: DecorDef): THREE.Group {
  const g = new THREE.Group();
  const len = num(d, 'len', 5);
  const h = num(d, 'h', 1.4);
  const text = String(d.data?.text ?? 'RAD');
  const color = d.color ?? 0xff4fa3;
  put(g, new THREE.BoxGeometry(len, h, 0.4), kit.mat(0xb9bec9, 0.85), 0, h / 2, 0);
  put(g, new THREE.BoxGeometry(len + 0.08, 0.08, 0.48), kit.mat(0x8e94a3, 0.7), 0, h + 0.04, 0);
  const tex = kit.tex(`graffiti|${text}|${color}`, 512, 144, (ctx, w, ch) => {
    ctx.fillStyle = '#b9bec9';
    ctx.fillRect(0, 0, w, ch);
    // Spray-paint splats behind the letters.
    for (let i = 0; i < 9; i++) {
      ctx.fillStyle = ['rgba(46,197,255,0.35)', 'rgba(255,214,10,0.4)', 'rgba(142,224,0,0.35)'][i % 3];
      ctx.beginPath();
      ctx.arc(hash(i * 4.1 + text.length) * w, hash(i * 2.7) * ch, 14 + hash(i * 6.3) * 26, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.font = `900 ${Math.round(Math.min(104, (w * 1.4) / text.length))}px "Arial Rounded MT Bold", Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 16;
    ctx.strokeStyle = '#1d1b3a';
    ctx.strokeText(text, w / 2, ch / 2 + 4);
    ctx.fillStyle = css(color);
    ctx.fillText(text, w / 2, ch / 2 + 4);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillText(text, w / 2 - 3, ch / 2 - 1);
    ctx.fillStyle = css(color);
    ctx.fillText(text, w / 2, ch / 2 + 4);
  });
  const paint = kit.mat(0xffffff, 0.8, { map: tex });
  put(g, new THREE.PlaneGeometry(len - 0.1, h - 0.1), paint, 0, h / 2, 0.205);
  put(g, new THREE.PlaneGeometry(len - 0.1, h - 0.1), paint, 0, h / 2, -0.205, 0, Math.PI, 0);
  return g;
}

function bench(kit: PropKit, d: DecorDef): THREE.Group {
  const g = new THREE.Group();
  const len = num(d, 'len', 2.4);
  const wood = kit.mat(0xc98f55, 0.7);
  for (const z of [-0.18, 0, 0.18]) put(g, new THREE.BoxGeometry(len, 0.08, 0.16), wood, 0, 0.46, z);
  for (const s of [-1, 1]) put(g, new THREE.BoxGeometry(0.1, 0.42, 0.52), kit.mat(0x3b4256, 0.5, { metal: 0.4 }), s * (len / 2 - 0.25), 0.21, 0);
  return g;
}

/** A basketball hoop; the backboard faces +x. */
function hoop(kit: PropKit, d: DecorDef): THREE.Group {
  const g = new THREE.Group();
  const dark = kit.mat(0x2b4b8a, 0.5, { metal: 0.3 });
  put(g, new THREE.CylinderGeometry(0.1, 0.12, 3.6, 10), dark, 0, 1.8, 0);
  put(g, new THREE.BoxGeometry(1.0, 0.1, 0.1), dark, 0.5, 3.15, 0);
  put(g, new THREE.BoxGeometry(0.08, 1.1, 1.8), kit.mat(0xffffff, 0.4), 1.0, 3.35, 0);
  put(g, new THREE.BoxGeometry(0.1, 0.5, 0.64), kit.mat(0xff3b30, 0.5), 1.0, 3.2, 0);
  put(g, new THREE.BoxGeometry(0.12, 0.38, 0.5), kit.mat(0xffffff, 0.4), 1.0, 3.2, 0);
  put(g, new THREE.TorusGeometry(0.24, 0.03, 6, 18), kit.mat(0xff7a1a, 0.4), 1.33, 3.05, 0, Math.PI / 2);
  put(g, new THREE.CylinderGeometry(0.24, 0.16, 0.42, 12, 1, true), kit.mat(0xffffff, 0.8, { opacity: 0.55, side: THREE.DoubleSide, noShadow: true }), 1.33, 2.83, 0);
  return g;
}

/**
 * A skateboard along x with its top at y = 0: a deck with kicked-up tails, grip tape, trucks and
 * big wheels in the prop's color.
 */
function skateboard(kit: PropKit, d: DecorDef): THREE.Group {
  const g = new THREE.Group();
  const L = num(d, 'len', 16);
  const W = num(d, 'w', 4.5);
  const tail = W * 0.8;
  const rise = W * 0.3;
  const stadium = (hl: number, hw: number) => {
    const s = new THREE.Shape();
    const steps = Math.ceil((2 * (hl - hw)) / 0.5);
    s.moveTo(-hl + hw, -hw);
    for (let i = 1; i <= steps; i++) s.lineTo(-hl + hw + ((2 * (hl - hw)) * i) / steps, -hw);
    s.absarc(hl - hw, 0, hw, -Math.PI / 2, Math.PI / 2, false);
    for (let i = 1; i <= steps; i++) s.lineTo(hl - hw - ((2 * (hl - hw)) * i) / steps, hw);
    s.absarc(-hl + hw, 0, hw, Math.PI / 2, (3 * Math.PI) / 2, false);
    return s;
  };
  const bend = (geo: THREE.BufferGeometry) => {
    const p = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const over = Math.abs(p.getX(i)) - (L / 2 - tail);
      if (over > 0) p.setY(i, p.getY(i) + (over / tail) ** 2 * rise);
    }
    geo.computeVertexNormals();
    return geo;
  };
  const deck = new THREE.ExtrudeGeometry(stadium(L / 2, W / 2), { depth: 0.24, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 2, curveSegments: 10 });
  deck.rotateX(-Math.PI / 2).translate(0, -0.29, 0);
  put(g, bend(deck), kit.mat(0xe8c48f, 0.6));
  const grip = new THREE.ShapeGeometry(stadium(L / 2 - 0.12, W / 2 - 0.12), 10).rotateX(-Math.PI / 2).translate(0, 0.012, 0);
  put(g, bend(grip), kit.mat(0x34364a, 0.95, { decal: true }));
  const steel = kit.mat(0xc9d1df, 0.3, { metal: 0.7 });
  const wheel = kit.mat(d.color ?? 0xff5f7e, 0.45);
  const rw = W * 0.13;
  for (const s of [-1, 1]) {
    const x = s * (L / 2 - tail - W * 0.15);
    put(g, new THREE.BoxGeometry(W * 0.22, 0.1, W * 0.3), steel, x, -0.36, 0);
    put(g, new THREE.CylinderGeometry(W * 0.035, W * 0.035, W * 0.92, 8), steel, x, -0.34 - rw * 0.8, 0, Math.PI / 2);
    for (const z of [-1, 1]) put(g, new THREE.CylinderGeometry(rw, rw, W * 0.1, 16), wheel, x, -0.34 - rw * 0.8, z * W * 0.46, Math.PI / 2);
  }
  return g;
}

/** A jungle gym: posts, a platform on top, a ladder at the back and a slide down the +z side. */
function jungleGym(kit: PropKit, d: DecorDef): THREE.Group {
  const g = new THREE.Group();
  const w = num(d, 'w', 6);
  const dd = num(d, 'd', 4);
  const h = num(d, 'h', 3);
  const slide = num(d, 'slide', 4.5);
  const red = kit.mat(0xff4d5e, 0.45);
  for (const [x, z] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ]) put(g, new THREE.CylinderGeometry(0.17, 0.17, h + 0.9, 10), red, x * (w / 2 - 0.2), (h + 0.9) / 2, z * (dd / 2 - 0.2));
  put(g, new RoundedBoxGeometry(w, 0.22, dd, 2, 0.08), kit.mat(0xffd23f, 0.45), 0, h - 0.11, 0);
  // Side railings and a ladder up the back.
  const bar = kit.mat(0x2ec5ff, 0.4);
  for (const s of [-1, 1]) put(g, new THREE.CylinderGeometry(0.06, 0.06, dd - 0.4, 8), bar, s * (w / 2 - 0.2), h + 0.8, 0, Math.PI / 2);
  put(g, new THREE.CylinderGeometry(0.06, 0.06, w - 0.4, 8), bar, 0, h + 0.8, -(dd / 2 - 0.2), 0, 0, Math.PI / 2);
  for (let i = 1; i <= 6; i++) put(g, new THREE.CylinderGeometry(0.05, 0.05, 1.2, 6), bar, 0, (i * h) / 7, -(dd / 2 - 0.2), 0, 0, Math.PI / 2);
  // The slide: a trough from the platform edge down to the ground.
  const len = Math.hypot(h, slide);
  const tilt = Math.atan2(h, slide);
  const chute = new THREE.Group();
  chute.position.set(0, h / 2 + 0.05, dd / 2 + slide / 2);
  chute.rotation.x = tilt;
  const green = kit.mat(0x5ad17a, 0.35);
  put(chute, new THREE.BoxGeometry(1.4, 0.1, len), green);
  for (const s of [-1, 1]) put(chute, new THREE.BoxGeometry(0.1, 0.35, len), green, s * 0.72, 0.15, 0);
  g.add(chute);
  return g;
}

function lamp(kit: PropKit): THREE.Group {
  const g = new THREE.Group();
  const dark = kit.mat(0x3b4256, 0.5, { metal: 0.4 });
  put(g, new THREE.CylinderGeometry(0.1, 0.13, 5, 8), dark, 0, 2.5, 0);
  put(g, new THREE.BoxGeometry(1.2, 0.08, 0.08), dark, 0.6, 4.95, 0);
  put(g, new THREE.BoxGeometry(0.6, 0.18, 0.35), dark, 1.2, 4.9, 0);
  put(g, new THREE.BoxGeometry(0.5, 0.05, 0.28), kit.mat(0xfff3c4, 0.4, { emissive: 0xffe9a0, glow: 0.9 }), 1.2, 4.8, 0);
  return g;
}

// --- Moon Base --------------------------------------------------------------------------------------

function rocket(kit: PropKit): THREE.Group {
  const g = new THREE.Group();
  const white = kit.mat(0xf4f6fb, 0.35, { metal: 0.1 });
  const red = kit.mat(0xff3b4e, 0.35);
  put(g, new THREE.CylinderGeometry(3.0, 3.2, 0.25, 24), kit.mat(0x5d6275, 0.7), 0, 0.12, 0);
  put(g, new THREE.CylinderGeometry(0.6, 1.1, 1.2, 16), kit.mat(0x8e95a8, 0.3, { metal: 0.7 }), 0, 0.85, 0);
  put(g, new THREE.CylinderGeometry(1.5, 1.5, 9, 24), white, 0, 5.95, 0);
  for (const y of [3.4, 8.8]) put(g, new THREE.CylinderGeometry(1.53, 1.53, 0.55, 24), red, 0, y, 0);
  put(g, new THREE.ConeGeometry(1.5, 3.4, 24), red, 0, 12.15, 0);
  const glass = kit.mat(0x8fe3ff, 0.1, { emissive: 0x4fc3ff, glow: 0.6 });
  for (const s of [-1, 1]) put(g, new THREE.CircleGeometry(0.45, 20), glass, 0, 7.2, s * 1.51, 0, s > 0 ? 0 : Math.PI, 0);
  const fin = new THREE.Shape();
  fin.moveTo(0, 0);
  fin.lineTo(1.5, 0);
  fin.lineTo(0, 2.8);
  fin.closePath();
  const finGeo = new THREE.ExtrudeGeometry(fin, { depth: 0.16, bevelEnabled: false }).translate(0, 0, -0.08);
  for (let k = 0; k < 4; k++) {
    const holder = new THREE.Group();
    holder.rotation.y = (k * Math.PI) / 2 + Math.PI / 4;
    put(holder, finGeo, red, 1.45, 1.45, 0);
    g.add(holder);
  }
  return g;
}

/** A radio dish on a mast, tilted up at the sky. */
function dish(kit: PropKit, d: DecorDef): THREE.Group {
  const g = new THREE.Group();
  const r = num(d, 'r', 3);
  const grey = kit.mat(0xb8bfcd, 0.4, { metal: 0.5 });
  put(g, new THREE.CylinderGeometry(0.3, 0.4, 2.6, 12), grey, 0, 1.3, 0);
  put(g, new THREE.BoxGeometry(1.0, 0.6, 1.0), grey, 0, 2.8, 0);
  const head = new THREE.Group();
  head.position.set(0, 3.1, 0);
  head.rotation.x = -0.65;
  const bowl = new THREE.SphereGeometry(r, 28, 6, 0, Math.PI * 2, 0, 0.6).rotateX(Math.PI).translate(0, r, 0);
  put(head, bowl, kit.mat(0xf2f4f8, 0.45, { side: THREE.DoubleSide }));
  put(head, new THREE.CylinderGeometry(0.05, 0.05, r * 0.55, 6), grey, 0, r * 0.3, 0);
  put(head, new THREE.ConeGeometry(0.22, 0.45, 10), kit.mat(0xff9f43, 0.5), 0, r * 0.58, 0, Math.PI);
  g.add(head);
  return g;
}

function solarPanel(kit: PropKit, d: DecorDef): THREE.Group {
  const g = new THREE.Group();
  const w = num(d, 'w', 6);
  const dd = num(d, 'd', 4);
  const h = num(d, 'h', 1.2);
  const grey = kit.mat(0x9aa3b8, 0.4, { metal: 0.6 });
  for (const [x, z] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ]) put(g, new THREE.CylinderGeometry(0.07, 0.07, h - 0.1, 8), grey, x * (w / 2 - 0.4), (h - 0.1) / 2, z * (dd / 2 - 0.4));
  const cells = kit.tex('solar', 192, 128, (ctx, cw, ch) => {
    ctx.fillStyle = '#1d3b8f';
    ctx.fillRect(0, 0, cw, ch);
    ctx.strokeStyle = 'rgba(190,220,255,0.55)';
    ctx.lineWidth = 2;
    for (let x = 0; x <= cw; x += cw / 12) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, ch);
      ctx.stroke();
    }
    for (let y = 0; y <= ch; y += ch / 8) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(cw, y);
      ctx.stroke();
    }
  });
  put(g, new THREE.BoxGeometry(w, 0.12, dd), kit.mat(0xffffff, 0.2, { map: cells, metal: 0.3 }), 0, h - 0.06, 0);
  return g;
}

/** The moon lab: a rounded module with a stripe, round windows, a sign and a glass cupola. */
function labModule(kit: PropKit, d: DecorDef): THREE.Group {
  const g = new THREE.Group();
  const w = num(d, 'w', 9);
  const dd = num(d, 'd', 6);
  const h = num(d, 'h', 3);
  put(g, new RoundedBoxGeometry(w, h, dd, 3, 0.6), kit.mat(0xeef1f7, 0.4), 0, h / 2, 0);
  put(g, new RoundedBoxGeometry(w + 0.06, 0.4, dd + 0.06, 2, 0.2), kit.mat(0x3d7bff, 0.4), 0, h * 0.4, 0);
  const glow = kit.mat(0x9fefff, 0.15, { emissive: 0x57d6ff, glow: 0.7 });
  for (let x = -w / 2 + 1.4; x <= w / 2 - 1.2; x += 1.9) {
    put(g, new THREE.CircleGeometry(0.36, 18), glow, x, h * 0.7, -dd / 2 - 0.01, 0, Math.PI, 0);
    if (Math.abs(x) > 2) put(g, new THREE.CircleGeometry(0.36, 18), glow, x, h * 0.7, dd / 2 + 0.01);
  }
  const text = String(d.data?.text ?? 'MOON LAB');
  put(g, new THREE.PlaneGeometry(3.2, 0.7), kit.mat(0xffffff, 0.5, { map: kit.text(text, '#3d7bff', '#ffffff', 512, 112) }), 0, h * 0.7, dd / 2 + 0.02);
  put(g, new THREE.BoxGeometry(0.1, 1.9, 1.3), kit.mat(0x8e95a8, 0.4, { metal: 0.5 }), -w / 2 - 0.02, 0.95, 0);
  put(g, new THREE.CylinderGeometry(1.5, 1.55, 0.2, 20), kit.mat(0x9aa3b8, 0.4, { metal: 0.5 }), -2.5, h + 0.1, 0);
  put(g, new THREE.SphereGeometry(1.4, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), kit.mat(0xbfe8ff, 0.08, { opacity: 0.5, metal: 0.2, noShadow: true }), -2.5, h + 0.2, 0);
  put(g, new THREE.CylinderGeometry(0.04, 0.04, 1.6, 6), kit.mat(0xb8bfcd, 0.4, { metal: 0.5 }), w / 2 - 0.8, h + 0.8, dd / 2 - 0.8);
  put(g, new THREE.SphereGeometry(0.12, 10, 8), kit.mat(0xff3b4e, 0.3, { emissive: 0xff3b4e, glow: 0.9 }), w / 2 - 0.8, h + 1.65, dd / 2 - 0.8);
  return g;
}

/** A lattice radio mast with a red light on top. */
function antenna(kit: PropKit, d: DecorDef): THREE.Group {
  const g = new THREE.Group();
  const h = num(d, 'h', 7);
  const steel = kit.mat(0xe8ecf5, 0.4, { metal: 0.5 });
  const legs: [number, number][] = [0, 1, 2].map((i) => [Math.cos((i * Math.PI * 2) / 3) * 0.4, Math.sin((i * Math.PI * 2) / 3) * 0.4]);
  for (const [x, z] of legs) put(g, new THREE.CylinderGeometry(0.05, 0.05, h, 6), steel, x, h / 2, z);
  for (let y = 0.8; y < h; y += 1) {
    for (let i = 0; i < 3; i++) {
      const [x0, z0] = legs[i];
      const [x1, z1] = legs[(i + 1) % 3];
      put(g, new THREE.BoxGeometry(Math.hypot(x1 - x0, z1 - z0), 0.04, 0.04), steel, (x0 + x1) / 2, y, (z0 + z1) / 2, 0, -Math.atan2(z1 - z0, x1 - x0), 0);
    }
  }
  put(g, new THREE.SphereGeometry(0.18, 10, 8), kit.mat(0xff3b4e, 0.3, { emissive: 0xff3b4e, glow: 1 }), 0, h + 0.15, 0);
  return g;
}

/** A tube corridor along x whose walkway top is at y = 0. */
function tube(kit: PropKit, d: DecorDef): THREE.Group {
  const g = new THREE.Group();
  const len = num(d, 'len', 7);
  const r = num(d, 'r', 1.1);
  const cy = -r - 0.05;
  put(g, new THREE.CylinderGeometry(r, r, len, 20), kit.mat(0xeef1f7, 0.4), 0, cy, 0, 0, 0, Math.PI / 2);
  const rib = kit.mat(0x9aa3b8, 0.4, { metal: 0.5 });
  for (let x = -len / 2 + 0.3; x <= len / 2; x += 1.6) put(g, new THREE.TorusGeometry(r + 0.03, 0.07, 6, 20), rib, x, cy, 0, 0, Math.PI / 2, 0);
  put(g, new THREE.BoxGeometry(len, 0.08, 1.5), kit.mat(0x6d7488, 0.5, { metal: 0.6 }), 0, -0.04, 0);
  const glow = kit.mat(0x9fefff, 0.15, { emissive: 0x57d6ff, glow: 0.7 });
  for (let x = -len / 2 + 1.1; x < len / 2; x += 1.6) {
    for (const s of [-1, 1]) put(g, new THREE.CircleGeometry(0.22, 12), glow, x, cy, s * (r + 0.01), 0, s > 0 ? 0 : Math.PI, 0);
  }
  return g;
}

function crater(kit: PropKit, d: DecorDef): THREE.Group {
  const g = new THREE.Group();
  const r = num(d, 'r', 2);
  put(g, new THREE.TorusGeometry(r, r * 0.17, 6, 28).rotateX(Math.PI / 2).scale(1, 0.35, 1), kit.mat(0xd4d5df, 0.95), 0, 0.02, 0);
  put(g, new THREE.CircleGeometry(r * 0.96, 28), kit.mat(0x9a9caf, 0.95, { decal: true }), 0, 0.01, 0, -Math.PI / 2);
  return g;
}

function moonRock(kit: PropKit, d: DecorDef): THREE.Group {
  const g = new THREE.Group();
  const r = num(d, 'r', 1.2);
  const h = num(d, 'h', 1.1);
  const geo = new THREE.IcosahedronGeometry(r, 1);
  const p = geo.attributes.position as THREE.BufferAttribute;
  const seed = d.x * 1.7 + d.z * 3.1;
  for (let i = 0; i < p.count; i++) {
    // Same jitter for vertices at the same spot, so the rock stays closed.
    const k = 0.8 + 0.35 * hash(Math.round(p.getX(i) * 10) * 7.1 + Math.round(p.getY(i) * 10) * 3.3 + Math.round(p.getZ(i) * 10) * 1.9 + seed);
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
  }
  geo.computeVertexNormals();
  const sy = (h * 0.62) / r;
  geo.scale(1, sy, 1);
  put(g, geo, kit.mat(0xa4a6b6, 0.95, { flat: true }), 0, h * 0.38, 0);
  return g;
}

function lander(kit: PropKit): THREE.Group {
  const g = new THREE.Group();
  const gold = kit.mat(0xd9a93a, 0.3, { metal: 0.7, flat: true });
  const silver = kit.mat(0xdfe3ec, 0.35, { metal: 0.3 });
  put(g, new THREE.CylinderGeometry(1.3, 1.3, 1.1, 8), gold, 0, 1.0, 0);
  put(g, new RoundedBoxGeometry(2.0, 1.0, 1.8, 2, 0.2), silver, 0, 2.0, 0);
  put(g, new THREE.CircleGeometry(0.28, 16), kit.mat(0x2c3550, 0.1, { metal: 0.3 }), 0, 2.1, 0.91);
  const leg = kit.mat(0xb8bfcd, 0.4, { metal: 0.5 });
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2 + Math.PI / 4;
    const holder = new THREE.Group();
    holder.rotation.y = a;
    put(holder, new THREE.CylinderGeometry(0.07, 0.07, 1.6, 6), leg, 1.55, 0.7, 0, 0, 0, 0.55);
    put(holder, new THREE.CylinderGeometry(0.3, 0.32, 0.08, 12), leg, 1.95, 0.04, 0);
    g.add(holder);
  }
  put(g, new THREE.CylinderGeometry(0.03, 0.03, 0.8, 6), leg, 0.5, 2.8, -0.4);
  put(g, new THREE.SphereGeometry(0.35, 12, 6, 0, Math.PI * 2, 0, 0.9), kit.mat(0xf2f4f8, 0.45, { side: THREE.DoubleSide }), 0.5, 3.15, -0.4, Math.PI);
  return g;
}

/** Stars, the Earth, a ringed planet and a satellite circling the map (for Moon Base). */
function space(kit: PropKit): THREE.Group {
  const g = new THREE.Group();
  const n = 1400;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const tint = [new THREE.Color(0xffffff), new THREE.Color(0xcfe0ff), new THREE.Color(0xfff0c8)];
  for (let i = 0; i < n; i++) {
    const u = hash(i * 1.31) * 2 - 1;
    const a = hash(i * 7.77) * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    pos.set([Math.cos(a) * s * 700, u * 700, Math.sin(a) * s * 700], i * 3);
    const c = tint[i % 3].clone().multiplyScalar(0.55 + 0.45 * hash(i * 3.9));
    col.set([c.r, c.g, c.b], i * 3);
  }
  const stars = new THREE.BufferGeometry();
  stars.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  stars.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.add(new THREE.Points(stars, new THREE.PointsMaterial({ size: 2, sizeAttenuation: false, vertexColors: true, fog: false, depthWrite: false })));
  const earthTex = kit.tex('earth', 512, 256, (ctx, w, h) => {
    ctx.fillStyle = '#2f7fe0';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 26; i++) {
      ctx.fillStyle = i % 4 === 0 ? '#d9c48a' : '#4fb35a';
      ctx.beginPath();
      const x = hash(i * 5.3) * w;
      const y = h * 0.2 + hash(i * 2.9) * h * 0.6;
      ctx.ellipse(x, y, 18 + hash(i * 1.7) * 40, 10 + hash(i * 8.1) * 26, hash(i) * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillRect(0, 0, w, h * 0.07);
    ctx.fillRect(0, h * 0.93, w, h * 0.07);
    for (let i = 0; i < 30; i++) {
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.beginPath();
      ctx.ellipse(hash(i * 4.4) * w, hash(i * 6.6) * h, 20 + hash(i * 2.2) * 40, 4 + hash(i * 3.3) * 6, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  const earth = put(g, new THREE.SphereGeometry(60, 48, 24), kit.mat(0xffffff, 0.8, { map: earthTex, fog: false, emissive: 0x16305c, glow: 0.35 }), -260, 170, -420);
  earth.rotation.z = 0.4;
  const halo = new THREE.MeshBasicMaterial({ color: 0x6fb8ff, transparent: true, opacity: 0.25, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  put(g, new THREE.SphereGeometry(66, 32, 16), halo, -260, 170, -420);
  put(g, new THREE.SphereGeometry(26, 32, 16), kit.mat(0xe9a36b, 0.9, { fog: false, emissive: 0x5a2a10, glow: 0.3 }), 380, 95, 250);
  put(g, new THREE.RingGeometry(34, 54, 64), kit.mat(0xf2d2a2, 0.9, { fog: false, opacity: 0.7, side: THREE.DoubleSide, noShadow: true }), 380, 95, 250, -Math.PI / 2 + 0.45, 0, 0.2);
  // A satellite that circles the map.
  const sat = new THREE.Group();
  const foil = kit.mat(0xd9a93a, 0.3, { metal: 0.7, flat: true });
  const panel = kit.mat(0x2a4db0, 0.25, { metal: 0.4 });
  put(sat, new THREE.BoxGeometry(2.2, 1.6, 1.6), foil);
  for (const s of [-1, 1]) put(sat, new THREE.BoxGeometry(4.2, 0.08, 1.5), panel, s * 3.3, 0, 0);
  put(sat, new THREE.ConeGeometry(0.7, 0.6, 14, 1, true), kit.mat(0xf2f4f8, 0.45, { side: THREE.DoubleSide }), 0, 1.1, 0);
  g.add(sat);
  kit.onFrame((dt, t) => {
    const a = t * 0.035;
    sat.position.set(Math.cos(a) * 95, 30 + Math.sin(t * 0.2) * 2, Math.sin(a) * 95);
    sat.rotation.set(Math.sin(t * 0.3) * 0.2, -a, 0.3);
  });
  return g;
}

/** Builds a map prop from this file, or null if it's one MapView draws itself. */
export function buildProp(kit: PropKit, d: DecorDef): THREE.Group | null {
  switch (d.type) {
    case 'foodTruck':
      return foodTruck(kit, d);
    case 'balloonArch':
      return balloonArch(kit, d);
    case 'banner':
      return banner(kit, d);
    case 'lollipop':
      return lollipop(kit, d);
    case 'candyCane':
      return candyCane(kit, d);
    case 'cupcake':
      return cupcake(kit, d);
    case 'cherry': {
      const g = new THREE.Group();
      cherry(kit, g, num(d, 'r', 0.6), 0);
      return g;
    }
    case 'gumdrop':
      return gumdrop(kit, d);
    case 'donut':
      return donut(kit, d);
    case 'iceCream':
      return iceCream(kit, d);
    case 'chocoRiver':
      return chocoRiver(kit, d);
    case 'quarterPipe':
      return quarterPipe(kit, d);
    case 'ramp':
      return ramp(kit, d);
    case 'rail':
      return rail(kit, d);
    case 'graffiti':
      return graffiti(kit, d);
    case 'bench':
      return bench(kit, d);
    case 'hoop':
      return hoop(kit, d);
    case 'skateboard':
      return skateboard(kit, d);
    case 'jungleGym':
      return jungleGym(kit, d);
    case 'lamp':
      return lamp(kit);
    case 'rocket':
      return rocket(kit);
    case 'dish':
      return dish(kit, d);
    case 'solarPanel':
      return solarPanel(kit, d);
    case 'module':
      return labModule(kit, d);
    case 'antenna':
      return antenna(kit, d);
    case 'tube':
      return tube(kit, d);
    case 'crater':
      return crater(kit, d);
    case 'moonRock':
      return moonRock(kit, d);
    case 'lander':
      return lander(kit);
    case 'space':
      return space(kit);
    default:
      return null;
  }
}
