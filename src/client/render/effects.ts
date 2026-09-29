import * as THREE from 'three';

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  size: number;
  grow: number;
  drag: number;
  gravity: number;
  spin: number;
  rot: number;
}

/** Pooled instanced particles (puffs, confetti). Dead particles are scaled to zero. */
class ParticlePool {
  readonly mesh: THREE.InstancedMesh;
  private readonly parts: Particle[] = [];
  private next = 0;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly c = new THREE.Color();

  constructor(geo: THREE.BufferGeometry, mat: THREE.Material, readonly capacity: number) {
    this.mesh = new THREE.InstancedMesh(geo, mat, capacity);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < capacity; i++) {
      this.parts.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, size: 0, grow: 0, drag: 0, gravity: 0, spin: 0, rot: 0 });
      this.mesh.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0));
      this.mesh.setColorAt(i, new THREE.Color(1, 1, 1));
    }
  }

  spawn(p: Partial<Particle> & { x: number; y: number; z: number }, color: number | THREE.Color): void {
    const i = this.next;
    this.next = (this.next + 1) % this.capacity;
    const part = this.parts[i];
    part.x = p.x;
    part.y = p.y;
    part.z = p.z;
    part.vx = p.vx ?? 0;
    part.vy = p.vy ?? 0;
    part.vz = p.vz ?? 0;
    part.max = part.life = p.max ?? 0.8;
    part.size = p.size ?? 0.3;
    part.grow = p.grow ?? 1;
    part.drag = p.drag ?? 2;
    part.gravity = p.gravity ?? 0;
    part.spin = p.spin ?? 0;
    part.rot = Math.random() * Math.PI * 2;
    this.mesh.setColorAt(i, typeof color === 'number' ? this.c.set(color) : color);
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** `near`: shrink particles that drift right up to the camera so they never blot out the view. */
  update(dt: number, near: THREE.Vector3 | null = null): void {
    for (let i = 0; i < this.capacity; i++) {
      const p = this.parts[i];
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) {
        this.mesh.setMatrixAt(i, this.m.makeScale(0, 0, 0));
        continue;
      }
      const f = Math.max(0, 1 - p.drag * dt);
      p.vx *= f;
      p.vy = p.vy * f - p.gravity * dt;
      p.vz *= f;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.rot += p.spin * dt;
      const t = 1 - p.life / p.max;
      // Pop in quickly, then shrink away.
      let scale = p.size * (1 + p.grow * t) * Math.min(1, t * 8) * (1 - Math.pow(t, 3));
      if (near) {
        const d = Math.hypot(p.x - near.x, p.y - near.y, p.z - near.z) - scale;
        if (d < 1.3) scale *= Math.max(0, d / 1.3);
      }
      this.e.set(p.rot, p.rot * 0.7, 0);
      this.q.setFromEuler(this.e);
      this.m.compose(this.v.set(p.x, p.y, p.z), this.q, this.s.set(scale, scale, scale));
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

const Z_AXIS = new THREE.Vector3(0, 0, 1);
const tmpDirV = new THREE.Vector3();

let starTex: THREE.Texture | null = null;
/** Soft star-burst texture for muzzle flashes and impacts. */
export function starTexture(): THREE.Texture {
  if (starTex) return starTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,250,220,0.9)');
  grad.addColorStop(1, 'rgba(255,240,200,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  g.translate(64, 64);
  for (let i = 0; i < 8; i++) {
    g.rotate(Math.PI / 4);
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.beginPath();
    g.moveTo(0, -6);
    g.lineTo(i % 2 ? 44 : 62, 0);
    g.lineTo(0, 6);
    g.fill();
  }
  starTex = new THREE.CanvasTexture(c);
  starTex.colorSpace = THREE.SRGBColorSpace;
  return starTex;
}

interface Flash {
  sprite: THREE.Sprite;
  life: number;
  max: number;
  size: number;
}

interface Ring {
  mesh: THREE.Mesh;
  life: number;
  max: number;
  size: number;
}

interface Rope {
  mesh: THREE.Mesh;
  from: () => THREE.Vector3 | null;
  to: () => THREE.Vector3 | null;
  life: number;
  max: number;
}

interface Balloon {
  mesh: THREE.Group;
  life: number;
  vx: number;
  vy: number;
  vz: number;
  t: number;
}

export interface Projectile3D {
  id: number;
  mesh: THREE.Mesh;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  r: number;
  /** Visual offset from the muzzle that decays so shots appear to leave the gun. */
  ox: number;
  oy: number;
  oz: number;
  /** Distance flown since the last trail puff. */
  trail: number;
  /** Last drawn position (for distance-based trails). */
  lx: number;
  ly: number;
  lz: number;
}

const AIR_VERT = /* glsl */ `
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;
const AIR_FRAG = /* glsl */ `
  uniform float time;
  uniform vec3 tint;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    float f = 1.0 - abs(dot(vN, vV));
    float swirl = 0.5 + 0.5 * sin(vN.x * 9.0 + vN.y * 7.0 + time * 14.0);
    float a = pow(f, 1.6) * 0.9 + swirl * 0.12;
    gl_FragColor = vec4(mix(vec3(1.0), tint, 0.35 + f * 0.3), a);
  }
`;

/** Visual effects: air blasts, puffs, confetti, shockwaves, projectiles, and KO balloons. */
export class Effects {
  readonly root = new THREE.Group();
  private readonly puffs: ParticlePool;
  private readonly confetti: ParticlePool;
  private readonly rings: Ring[] = [];
  private readonly flashes: Flash[] = [];
  private readonly balloons: Balloon[] = [];
  private readonly ropes: Rope[] = [];
  private readonly ropeGeo = new THREE.CylinderGeometry(0.045, 0.045, 1, 6, 1, true).translate(0, 0.5, 0).rotateX(Math.PI / 2);
  private readonly ropeMat = new THREE.MeshStandardMaterial({ color: 0xffd60a, roughness: 0.4, emissive: 0xffa000, emissiveIntensity: 0.3 });
  readonly projectiles = new Map<number, Projectile3D>();
  private readonly airMat: THREE.ShaderMaterial;
  private readonly airGeo = new THREE.SphereGeometry(1, 20, 14);
  private readonly tracers: { mesh: THREE.Mesh; life: number }[] = [];
  private readonly tracerGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true).translate(0, 0.5, 0).rotateX(Math.PI / 2);
  private readonly utilMats = [
    null,
    new THREE.MeshStandardMaterial({ color: 0x2ec5ff, emissive: 0x2ec5ff, emissiveIntensity: 0.4, roughness: 0.3 }),
    new THREE.MeshStandardMaterial({ color: 0x9b4dff, emissive: 0x9b4dff, emissiveIntensity: 0.5, roughness: 0.3 }),
    new THREE.MeshStandardMaterial({ color: 0xff4fa3, emissive: 0xff4fa3, emissiveIntensity: 0.3, roughness: 0.3 }),
    new THREE.MeshStandardMaterial({ color: 0x8ee000, emissive: 0x8ee000, emissiveIntensity: 0.3, roughness: 0.3 }),
    // Air Mine (dark puck with a red glow) and Helium Bomb (pink balloon).
    new THREE.MeshStandardMaterial({ color: 0x3a3450, emissive: 0xff2d55, emissiveIntensity: 0.35, roughness: 0.4 }),
    new THREE.MeshStandardMaterial({ color: 0xff8fd8, emissive: 0xff8fd8, emissiveIntensity: 0.45, roughness: 0.2 }),
  ];
  private readonly utilGeos = [
    null,
    new THREE.IcosahedronGeometry(0.3, 1),
    new THREE.IcosahedronGeometry(0.3, 1),
    new THREE.CylinderGeometry(0.35, 0.35, 0.15, 16),
    new THREE.BoxGeometry(0.45, 0.45, 0.45),
    new THREE.CylinderGeometry(0.3, 0.34, 0.14, 14),
    new THREE.SphereGeometry(0.34, 14, 10),
  ];
  private readonly ringGeo = new THREE.RingGeometry(0.8, 1, 40);
  private time = 0;
  /** Camera position, so particles right in front of the lens can fade out. */
  camPos: THREE.Vector3 | null = null;

  constructor() {
    const puffMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, emissive: 0x333333, transparent: true, opacity: 0.6, depthWrite: false });
    this.puffs = new ParticlePool(new THREE.IcosahedronGeometry(1, 1), puffMat, 500);
    const confMat = new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide, roughness: 0.5, emissive: 0x222222 });
    this.confetti = new ParticlePool(new THREE.PlaneGeometry(0.18, 0.28), confMat, 500);
    this.root.add(this.puffs.mesh, this.confetti.mesh);
    this.airMat = new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 }, tint: { value: new THREE.Color(0x9fe8ff) } },
      vertexShader: AIR_VERT,
      fragmentShader: AIR_FRAG,
      transparent: true,
      depthWrite: false,
    });
    for (let i = 0; i < 12; i++) {
      const mesh = new THREE.Mesh(
        this.ringGeo,
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }),
      );
      mesh.visible = false;
      this.root.add(mesh);
      this.rings.push({ mesh, life: 0, max: 1, size: 1 });
    }
  }

  /** Bright star flash (muzzle flashes, impacts). Additive, so it pops against anything. */
  flash(x: number, y: number, z: number, size: number, color = 0xfff3b0, life = 0.08): void {
    let f = this.flashes.find((q) => q.life <= 0);
    if (!f) {
      if (this.flashes.length >= 16) f = this.flashes[0];
      else {
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: starTexture(), color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
        sprite.renderOrder = 5;
        this.root.add(sprite);
        f = { sprite, life: 0, max: 1, size: 1 };
        this.flashes.push(f);
      }
    }
    f.life = f.max = life;
    f.size = size;
    f.sprite.visible = true;
    f.sprite.position.set(x, y, z);
    f.sprite.material.color.setHex(color);
    f.sprite.material.rotation = Math.random() * Math.PI;
  }

  /** Muzzle flash for a shot fired along (dx, dy, dz). */
  muzzleFlash(x: number, y: number, z: number, dx: number, dy: number, dz: number, power: number): void {
    this.flash(x + dx * 0.25, y + dy * 0.25, z + dz * 0.25, 0.9 + power * 1.4, 0xfff3b0, 0.07 + power * 0.03);
    for (let i = 0; i < 4 + Math.round(power * 5); i++) {
      this.puffs.spawn(
        {
          x: x + dx * 0.3,
          y: y + dy * 0.3,
          z: z + dz * 0.3,
          vx: dx * (4 + Math.random() * 6) + (Math.random() - 0.5) * 2,
          vy: dy * (4 + Math.random() * 6) + (Math.random() - 0.5) * 2,
          vz: dz * (4 + Math.random() * 6) + (Math.random() - 0.5) * 2,
          size: 0.12 + power * 0.1,
          grow: 1.5,
          max: 0.3 + Math.random() * 0.2,
          drag: 6,
        },
        0xffffff,
      );
    }
  }

  /** A landed hit: flash, a ring, and a spray of air and confetti along the knockback. */
  impactBurst(x: number, y: number, z: number, dx: number, dy: number, dz: number, strength: number, color: number, camPos: THREE.Vector3): void {
    const k = Math.min(1, strength / 30);
    this.flash(x, y, z, 2 + k * 3, 0xffffff, 0.1 + k * 0.06);
    // A second, colored flash lingers a moment longer so the hit reads at any distance.
    this.flash(x, y, z, 1.4 + k * 2.2, color, 0.16 + k * 0.08);
    this.shockwave(x, y, z, 1.8 + k * 3, 0.3, 0xffffff, false, camPos);
    if (k > 0.35) this.shockwave(x, y, z, 1.2 + k * 2, 0.22, 0xffd60a, false, camPos);
    // Speed streaks shooting out along the knockback.
    for (let i = 0; i < 4 + Math.round(k * 8); i++) {
      const sp = 14 + Math.random() * (10 + k * 18);
      this.puffs.spawn(
        { x, y, z, vx: dx * sp + (Math.random() - 0.5) * 3, vy: dy * sp + (Math.random() - 0.5) * 3, vz: dz * sp + (Math.random() - 0.5) * 3, size: 0.1 + k * 0.08, grow: 0.4, max: 0.22 + Math.random() * 0.12, drag: 7 },
        0xffffff,
      );
    }
    const n = 12 + Math.round(k * 22);
    for (let i = 0; i < n; i++) {
      const spread = 0.7;
      const vx = dx + (Math.random() - 0.5) * spread;
      const vy = dy + (Math.random() - 0.5) * spread + 0.2;
      const vz = dz + (Math.random() - 0.5) * spread;
      const sp = 4 + Math.random() * (6 + k * 10);
      this.puffs.spawn({ x, y, z, vx: vx * sp, vy: vy * sp, vz: vz * sp, size: 0.18 + k * 0.18, grow: 1.4, max: 0.4 + Math.random() * 0.3, drag: 4 }, i % 3 === 0 ? color : 0xffffff);
    }
    for (let i = 0; i < 6 + Math.round(k * 14); i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 3 + Math.random() * (4 + k * 6);
      this.confetti.spawn(
        { x, y, z, vx: dx * sp + Math.cos(a) * 2, vy: dy * sp + 2 + Math.random() * 3, vz: dz * sp + Math.sin(a) * 2, size: 0.8, grow: 0, max: 0.9 + Math.random() * 0.5, drag: 2, gravity: 8, spin: 10 },
        [color, 0xffd60a, 0xffffff][i % 3],
      );
    }
  }

  /** Dash fart: a greenish puff cloud trailing behind. */
  fartCloud(x: number, y: number, z: number, dirX: number, dirZ: number, big = false): void {
    const n = big ? 22 : 12;
    for (let i = 0; i < n; i++) {
      const c = new THREE.Color().setHSL(0.2 + Math.random() * 0.08, 0.55, 0.72 + Math.random() * 0.12);
      this.puffs.spawn(
        {
          x: x - dirX * 0.6 + (Math.random() - 0.5) * 0.4,
          y: y + 0.4 + Math.random() * 0.5,
          z: z - dirZ * 0.6 + (Math.random() - 0.5) * 0.4,
          vx: -dirX * (2 + Math.random() * 3) + (Math.random() - 0.5) * 2,
          vy: Math.random() * 1.2,
          vz: -dirZ * (2 + Math.random() * 3) + (Math.random() - 0.5) * 2,
          size: (big ? 0.4 : 0.28) + Math.random() * 0.2,
          grow: 1.8,
          max: (big ? 1.4 : 0.9) + Math.random() * 0.4,
          drag: 3,
          gravity: -0.6,
        },
        c,
      );
    }
  }

  /** White air puff (jumps, landings, blasts). */
  airPuff(x: number, y: number, z: number, count = 8, speed = 3, size = 0.25, color = 0xffffff): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const e = (Math.random() - 0.3) * 1.2;
      this.puffs.spawn(
        {
          x,
          y,
          z,
          vx: Math.cos(a) * Math.cos(e) * speed * (0.5 + Math.random()),
          vy: Math.sin(e) * speed * (0.5 + Math.random()),
          vz: Math.sin(a) * Math.cos(e) * speed * (0.5 + Math.random()),
          size: size * (0.7 + Math.random() * 0.6),
          grow: 1.2,
          max: 0.5 + Math.random() * 0.4,
          drag: 4,
        },
        color,
      );
    }
  }

  /** Ground ring puff when landing hard or jumping. */
  groundRing(x: number, y: number, z: number, size: number, color = 0xffffff): void {
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      this.puffs.spawn({ x: x + Math.cos(a) * 0.3, y: y + 0.1, z: z + Math.sin(a) * 0.3, vx: Math.cos(a) * size * 4, vy: 0.3, vz: Math.sin(a) * size * 4, size: 0.18 * size + 0.1, max: 0.45, drag: 6, grow: 1 }, color);
    }
    this.shockwave(x, y + 0.05, z, size * 1.6, 0.35, color, true);
  }

  shockwave(x: number, y: number, z: number, size: number, life: number, color = 0xffffff, flat = false, face?: THREE.Vector3): void {
    const r = this.rings.find((q) => q.life <= 0) ?? this.rings[0];
    r.life = r.max = life;
    r.size = size;
    r.mesh.visible = true;
    r.mesh.position.set(x, y, z);
    (r.mesh.material as THREE.MeshBasicMaterial).color.set(color);
    if (flat) r.mesh.rotation.set(-Math.PI / 2, 0, 0);
    else if (face) r.mesh.lookAt(face);
    else r.mesh.rotation.set(0, 0, 0);
  }

  /** Air cannon impact: expanding ring and a burst of air. */
  blast(x: number, y: number, z: number, radius: number, power: number, camPos: THREE.Vector3): void {
    // Blasts read mostly as rings; puffs stay small and thin out near the camera so a blast in
    // your face never blinds you.
    const dist = camPos.distanceTo(new THREE.Vector3(x, y, z));
    const near = Math.max(0, Math.min(1, (dist - 1.5) / 6));
    const count = Math.round((4 + power * 6) * near);
    if (count > 0) this.airPuff(x, y, z, count, 5 + power * 5, 0.14 + power * 0.1);
    this.shockwave(x, y, z, radius * (0.8 + power * 0.4), 0.3, 0xffffff, false, camPos);
    this.shockwave(x, y, z, radius * 0.6, 0.22, 0xbff0ff, false, camPos);
  }

  confettiBurst(x: number, y: number, z: number, count = 60, colors = [0xff3b5c, 0xffd60a, 0x2ec5ff, 0x8ee000, 0xff5fd2, 0x9b4dff]): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 3 + Math.random() * 7;
      this.confetti.spawn(
        {
          x,
          y,
          z,
          vx: Math.cos(a) * s,
          vy: 3 + Math.random() * 8,
          vz: Math.sin(a) * s,
          size: 1,
          grow: 0,
          max: 1.6 + Math.random(),
          drag: 1.5,
          gravity: 7,
          spin: 6 + Math.random() * 8,
        },
        colors[i % colors.length],
      );
    }
  }

  /** Cosmetic knockout effect everyone sees where someone got knocked out (see koFx items). */
  koEffect(kind: string, x: number, y: number, z: number): void {
    const rainbow = [0xff3b5c, 0xff8a1f, 0xffd60a, 0x8ee000, 0x2ec5ff, 0x3d6bff, 0x9b4dff];
    switch (kind) {
      case 'bubbles':
        for (let i = 0; i < 40; i++) {
          this.puffs.spawn(
            { x: x + (Math.random() - 0.5) * 3, y: y + Math.random() * 2, z: z + (Math.random() - 0.5) * 3, vx: (Math.random() - 0.5) * 2, vy: 2 + Math.random() * 4, vz: (Math.random() - 0.5) * 2, size: 0.2 + Math.random() * 0.35, grow: 0.3, max: 2 + Math.random(), drag: 0.8, gravity: -0.5 },
            new THREE.Color().setHSL(0.5 + Math.random() * 0.2, 0.8, 0.8),
          );
        }
        break;
      case 'stars':
        for (let i = 0; i < 36; i++) {
          const a = (i / 36) * Math.PI * 2;
          this.confetti.spawn({ x, y: y + 1, z, vx: Math.cos(a) * 12, vy: Math.sin(a * 3) * 3 + 4, vz: Math.sin(a) * 12, size: 1.6, grow: 0, max: 1.2, drag: 2.5, gravity: 2, spin: 12 }, i % 2 ? 0xffd60a : 0xffffff);
        }
        this.shockwave(x, y + 1, z, 6, 0.5, 0xffd60a);
        break;
      case 'balloons':
        for (let i = 0; i < 14; i++) {
          this.puffs.spawn(
            { x: x + (Math.random() - 0.5) * 2, y, z: z + (Math.random() - 0.5) * 2, vx: (Math.random() - 0.5) * 3, vy: 4 + Math.random() * 3, vz: (Math.random() - 0.5) * 3, size: 0.45, grow: 0, max: 3, drag: 0.4, gravity: -1 },
            rainbow[i % rainbow.length],
          );
        }
        break;
      case 'fireworks':
        for (let k = 0; k < 3; k++) {
          const fx = x + (Math.random() - 0.5) * 8;
          const fy = y + 6 + Math.random() * 5;
          const fz = z + (Math.random() - 0.5) * 8;
          const c = rainbow[Math.floor(Math.random() * rainbow.length)];
          window.setTimeout(() => {
            for (let i = 0; i < 40; i++) {
              const a = Math.random() * Math.PI * 2;
              const e = (Math.random() - 0.5) * Math.PI;
              const sp = 8 + Math.random() * 4;
              this.confetti.spawn({ x: fx, y: fy, z: fz, vx: Math.cos(a) * Math.cos(e) * sp, vy: Math.sin(e) * sp, vz: Math.sin(a) * Math.cos(e) * sp, size: 0.9, grow: 0, max: 1.3, drag: 2, gravity: 4, spin: 10 }, c);
            }
            this.shockwave(fx, fy, fz, 5, 0.4, c);
          }, k * 220);
        }
        break;
      case 'rainbow':
        for (let band = 0; band < rainbow.length; band++) {
          for (let i = 0; i <= 16; i++) {
            const a = (i / 16) * Math.PI;
            const r = 4 - band * 0.35;
            this.puffs.spawn({ x: x + Math.cos(a) * r, y: y + 1 + Math.sin(a) * r, z, vx: 0, vy: 0.3, vz: 0, size: 0.3, grow: 0.2, max: 2.2, drag: 1 }, rainbow[band]);
          }
        }
        break;
      default:
        this.confettiBurst(x, y, z, 70);
    }
  }

  /**
   * Knocked-out player: a deflating balloon in their color that zips away erratically, like a
   * balloon let go before it was tied.
   */
  deflatingBalloon(x: number, y: number, z: number, color: number, vx: number, vy: number, vz: number): void {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.25, emissive: color, emissiveIntensity: 0.25 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.9, 18, 14), mat);
    body.scale.set(1, 1.35, 1);
    const knot = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.35, 10), mat);
    knot.position.y = -1.3;
    knot.rotation.x = Math.PI;
    g.add(body, knot);
    g.position.set(x, y, z);
    this.root.add(g);
    // Fly back toward the sky so the pop is visible even after falling off the bottom.
    const up = y < -5 ? 16 : 8;
    this.balloons.push({ mesh: g, life: 2.2, vx: vx * 0.4, vy: Math.max(up, vy * 0.3), vz: vz * 0.4, t: 0 });
  }

  // --- Projectiles ------------------------------------------------------------------------

  addProjectile(id: number, x: number, y: number, z: number, vx: number, vy: number, vz: number, r: number, muzzle?: THREE.Vector3, kind = 0): Projectile3D {
    const mesh = kind > 0 ? new THREE.Mesh(this.utilGeos[kind]!, this.utilMats[kind]!) : new THREE.Mesh(this.airGeo, this.airMat);
    if (kind === 0) mesh.scale.setScalar(r);
    mesh.castShadow = kind > 0;
    mesh.renderOrder = 2;
    this.root.add(mesh);
    const p: Projectile3D = { id, mesh, x, y, z, vx, vy, vz, r, ox: 0, oy: 0, oz: 0, trail: 0, lx: x, ly: y, lz: z };
    if (muzzle) {
      p.ox = muzzle.x - x;
      p.oy = muzzle.y - y;
      p.oz = muzzle.z - z;
    }
    this.projectiles.set(id, p);
    return p;
  }

  removeProjectile(id: number): Projectile3D | undefined {
    const p = this.projectiles.get(id);
    if (!p) return undefined;
    this.root.remove(p.mesh);
    this.projectiles.delete(id);
    return p;
  }

  /** Places a projectile and leaves a thin air trail. */
  placeProjectile(p: Projectile3D, x: number, y: number, z: number, dt: number): void {
    const k = Math.max(0, 1 - dt * 12);
    p.ox *= k;
    p.oy *= k;
    p.oz *= k;
    p.x = x;
    p.y = y;
    p.z = z;
    const mx = x + p.ox;
    const my = y + p.oy;
    const mz = z + p.oz;
    p.mesh.position.set(mx, my, mz);
    if (p.mesh.material !== this.airMat) {
      p.mesh.rotation.y += dt * 8;
      p.mesh.rotation.x += dt * 5;
      return;
    }
    // Air shots are fast: stretch the blob along its flight into a streak.
    const sp = Math.hypot(p.vx, p.vy, p.vz);
    if (sp > 1) {
      tmpDirV.set(p.vx / sp, p.vy / sp, p.vz / sp);
      p.mesh.quaternion.setFromUnitVectors(Z_AXIS, tmpDirV);
      p.mesh.scale.set(p.r, p.r, p.r * (1 + Math.min(2.2, sp * 0.03)));
    }
    // Trail puffs every ~0.8 m travelled, so it stays continuous at any speed.
    const moved = Math.hypot(mx - p.lx, my - p.ly, mz - p.lz);
    p.trail += moved;
    const n = Math.min(6, Math.floor(p.trail / 0.8));
    for (let i = 0; i < n; i++) {
      const f = (i + 1) / (n + 1);
      this.puffs.spawn({ x: p.lx + (mx - p.lx) * f, y: p.ly + (my - p.ly) * f, z: p.lz + (mz - p.lz) * f, size: p.r * 0.3, grow: 0.9, max: 0.3, drag: 5, vx: Math.random() - 0.5, vy: Math.random() * 0.5, vz: Math.random() - 0.5 }, 0xe8fbff);
    }
    if (n > 0) p.trail = 0;
    p.lx = mx;
    p.ly = my;
    p.lz = mz;
  }

  /** Grapple line between two moving points; each getter returns null once its end is gone. */
  rope(from: () => THREE.Vector3 | null, to: () => THREE.Vector3 | null, life = 0.35): void {
    const mesh = new THREE.Mesh(this.ropeGeo, this.ropeMat);
    mesh.frustumCulled = false;
    this.root.add(mesh);
    this.ropes.push({ mesh, from, to, life, max: life });
  }

  /** Pump Rifle beam. */
  tracer(x: number, y: number, z: number, x2: number, y2: number, z2: number, color = 0xfff3a0): void {
    const mesh = new THREE.Mesh(this.tracerGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false }));
    const a = new THREE.Vector3(x, y, z);
    const b = new THREE.Vector3(x2, y2, z2);
    mesh.position.copy(a);
    mesh.lookAt(b);
    mesh.scale.set(0.04, 0.04, a.distanceTo(b));
    mesh.frustumCulled = false;
    this.root.add(mesh);
    this.tracers.push({ mesh, life: 0.25 });
    this.airPuff(x2, y2, z2, 5, 2, 0.15, 0xfff3a0);
  }

  /** Air Horn: a cone of air bursting forward. */
  honkBlast(x: number, y: number, z: number, dx: number, dy: number, dz: number, range: number, cone: number, power: number, camPos?: THREE.Vector3): void {
    // A honk aimed at your face shouldn't blind you: thin it out and shrink it near the camera.
    let near = 1;
    if (camPos) {
      const tx = camPos.x - x;
      const ty = camPos.y - y;
      const tz = camPos.z - z;
      const td = Math.hypot(tx, ty, tz) || 1;
      const facing = (tx * dx + ty * dy + tz * dz) / td;
      if (facing > 0.5) near = Math.max(0.25, Math.min(1, (td - 1) / 7));
    }
    const n = Math.round((14 + power * 10) * near);
    for (let i = 0; i < n; i++) {
      // Random direction inside the cone.
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * Math.tan(cone) * 0.9;
      const ux = Math.abs(dy) < 0.9 ? 0 : 1;
      const uy = Math.abs(dy) < 0.9 ? 1 : 0;
      // Two axes perpendicular to the aim.
      let px = uy * dz - 0 * dy;
      let py = 0 * dx - ux * dz;
      let pz = ux * dy - uy * dx;
      const pl = Math.hypot(px, py, pz) || 1;
      px /= pl;
      py /= pl;
      pz /= pl;
      const qx = dy * pz - dz * py;
      const qy = dz * px - dx * pz;
      const qz = dx * py - dy * px;
      const vx = dx + (px * Math.cos(a) + qx * Math.sin(a)) * r;
      const vy = dy + (py * Math.cos(a) + qy * Math.sin(a)) * r;
      const vz = dz + (pz * Math.cos(a) + qz * Math.sin(a)) * r;
      const sp = range * (2.2 + Math.random());
      this.puffs.spawn({ x: x + dx * 0.8, y: y + dy * 0.8, z: z + dz * 0.8, vx: vx * sp, vy: vy * sp, vz: vz * sp, size: (0.15 + power * 0.1) * (0.5 + 0.5 * near), grow: 1 + 1.5 * near, max: 0.4, drag: 5 }, 0xfff6c8);
    }
  }

  /** Leaves and air streaming out of a leaf blower (call every frame while blowing). */
  leafStream(x: number, y: number, z: number, dx: number, dy: number, dz: number, strength: number, dt: number): void {
    const n = Math.max(1, Math.round(dt * 60 * (1 + strength * 2)));
    const colors = [0x6fbf3a, 0xd98e2b, 0xc2d43a, 0xffffff];
    for (let i = 0; i < n; i++) {
      const sp = 12 + strength * 8;
      const j = 0.35;
      const c = colors[Math.floor(Math.random() * colors.length)];
      const pool = c === 0xffffff ? this.puffs : this.confetti;
      pool.spawn(
        {
          x,
          y,
          z,
          vx: (dx + (Math.random() - 0.5) * j) * sp,
          vy: (dy + (Math.random() - 0.5) * j) * sp,
          vz: (dz + (Math.random() - 0.5) * j) * sp,
          size: c === 0xffffff ? 0.12 : 0.9,
          grow: c === 0xffffff ? 2 : 0,
          max: 0.5,
          drag: 2.5,
          spin: 12,
        },
        c,
      );
    }
  }

  /** Swirl for a vacuum grenade's pull field. */
  vacuumSwirl(x: number, y: number, z: number, radius: number, dt: number): void {
    const n = Math.max(1, Math.round(dt * 90));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = radius * (0.6 + Math.random() * 0.4);
      const px = x + Math.cos(a) * r;
      const pz = z + Math.sin(a) * r;
      const py = y + (Math.random() - 0.5) * 2;
      // Inward and around.
      const vx = (x - px) * 2 - Math.sin(a) * 6;
      const vz = (z - pz) * 2 + Math.cos(a) * 6;
      this.puffs.spawn({ x: px, y: py, z: pz, vx, vy: (y - py) * 2, vz, size: 0.14, grow: -0.5, max: 0.45, drag: 0.5 }, 0xd6b8ff);
    }
  }

  /** Air spiralling up a tornado column (call every frame). */
  tornadoSwirl(x: number, y: number, z: number, radius: number, height: number, dt: number, near = 1): void {
    const n = Math.max(1, Math.round(dt * 70 * near));
    for (let i = 0; i < n; i++) {
      const h = Math.random();
      const r = (0.25 + h * 0.85) * radius * (0.7 + Math.random() * 0.4);
      const a = Math.random() * Math.PI * 2;
      const px = x + Math.cos(a) * r;
      const pz = z + Math.sin(a) * r;
      // Around (counter-clockwise from above, like the push) and up.
      const sp = 9 + h * 6;
      const dust = h < 0.2 && Math.random() < 0.5;
      this.puffs.spawn(
        { x: px, y: y + h * height, z: pz, vx: -Math.sin(a) * sp, vy: 2 + Math.random() * 3, vz: Math.cos(a) * sp, size: dust ? 0.18 : 0.08 + h * 0.12, grow: 0.8, max: 0.5, drag: 1.5 },
        dust ? 0xcbbfa8 : 0xeef4ff,
      );
    }
    if (Math.random() < dt * 20) {
      const a = Math.random() * Math.PI * 2;
      const r = radius * (0.3 + Math.random() * 0.5);
      this.confetti.spawn({ x: x + Math.cos(a) * r, y: y + Math.random() * height * 0.6, z: z + Math.sin(a) * r, vx: -Math.sin(a) * 10, vy: 4, vz: Math.cos(a) * 10, size: 0.9, max: 0.9, drag: 1, spin: 14 }, [0x6fbf3a, 0xd98e2b, 0xc2d43a][Math.floor(Math.random() * 3)]);
    }
  }

  /** Fizzing bubbles inside a helium cloud, and around anyone floating on it. */
  heliumFizz(x: number, y: number, z: number, radius: number, count = 1): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * radius;
      this.puffs.spawn(
        { x: x + Math.cos(a) * r, y: y + (Math.random() - 0.5) * radius, z: z + Math.sin(a) * r, vx: 0, vy: 1.5 + Math.random() * 2, vz: 0, size: 0.1 + Math.random() * 0.12, grow: 0.6, max: 0.9, drag: 0.8 },
        [0xffb3e6, 0xffffff, 0xd9c2ff][Math.floor(Math.random() * 3)],
      );
    }
  }

  /** A streak of wind for the giant fan. */
  windStreak(x: number, y: number, z: number, dx: number, dz: number): void {
    this.puffs.spawn({ x, y, z, vx: dx * 40, vy: 0, vz: dz * 40, size: 0.12, grow: 0.5, max: 1.4, drag: 0 }, 0xe8f6ff);
  }

  /** Floaty sparkle for low gravity. */
  sparkle(x: number, y: number, z: number): void {
    this.confetti.spawn({ x, y, z, vx: 0, vy: 0.6, vz: 0, size: 0.6, grow: 0, max: 2, drag: 0.5, gravity: -0.3, spin: 3 }, [0xc49bff, 0x9fe8ff, 0xffffff][Math.floor(Math.random() * 3)]);
  }

  /** A chunk crumbling off a collapsing edge. */
  debris(x: number, y: number, z: number): void {
    this.puffs.spawn({ x, y, z, vx: (Math.random() - 0.5) * 2, vy: -1, vz: (Math.random() - 0.5) * 2, size: 0.3 + Math.random() * 0.3, grow: 0, max: 1.6, drag: 0.2, gravity: 14, spin: 4 }, 0x8a7aa8);
    if (Math.random() < 0.3) this.puffs.spawn({ x, y: y + 0.2, z, vx: 0, vy: 1, vz: 0, size: 0.25, grow: 2, max: 0.6, drag: 3 }, 0xd8d0e8);
  }

  update(dt: number): void {
    this.time += dt;
    for (const f of this.flashes) {
      if (f.life <= 0) continue;
      f.life -= dt;
      if (f.life <= 0) {
        f.sprite.visible = false;
        continue;
      }
      const t = 1 - f.life / f.max;
      const s = f.size * (0.6 + 0.8 * Math.min(1, t * 4));
      f.sprite.scale.set(s, s, 1);
      f.sprite.material.opacity = 1 - t * t;
    }
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt;
      (t.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, t.life / 0.25);
      if (t.life <= 0) {
        this.root.remove(t.mesh);
        (t.mesh.material as THREE.Material).dispose();
        this.tracers.splice(i, 1);
      }
    }
    for (let i = this.ropes.length - 1; i >= 0; i--) {
      const r = this.ropes[i];
      r.life -= dt;
      const a = r.from();
      const b = r.to();
      if (r.life <= 0 || !a || !b) {
        this.root.remove(r.mesh);
        this.ropes.splice(i, 1);
        continue;
      }
      // Shoot out quickly, then hold.
      const t = Math.min(1, (1 - r.life / r.max) * 5);
      const len = a.distanceTo(b) * t;
      r.mesh.position.copy(a);
      r.mesh.lookAt(b);
      r.mesh.scale.set(1, 1, Math.max(0.01, len));
    }
    this.airMat.uniforms.time.value = this.time;
    this.puffs.update(dt, this.camPos);
    this.confetti.update(dt, this.camPos);
    for (const r of this.rings) {
      if (r.life <= 0) continue;
      r.life -= dt;
      const t = 1 - r.life / r.max;
      const s = r.size * (0.3 + t * 0.9);
      r.mesh.scale.set(s, s, s);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - t) * 0.8;
      if (r.life <= 0) r.mesh.visible = false;
    }
    for (let i = this.balloons.length - 1; i >= 0; i--) {
      const b = this.balloons[i];
      b.life -= dt;
      b.t += dt;
      // Erratic zig-zag thrust from the escaping air.
      const wig = b.t * 11;
      b.vx += Math.sin(wig) * 40 * dt;
      b.vz += Math.cos(wig * 1.3) * 40 * dt;
      b.vy += 6 * dt;
      b.mesh.position.x += b.vx * dt;
      b.mesh.position.y += b.vy * dt;
      b.mesh.position.z += b.vz * dt;
      b.mesh.rotation.x += dt * 9;
      b.mesh.rotation.z += dt * 13;
      const shrink = Math.max(0.05, b.life / 2.2);
      b.mesh.scale.setScalar(shrink);
      if (Math.random() < 0.6) {
        this.puffs.spawn({ x: b.mesh.position.x, y: b.mesh.position.y, z: b.mesh.position.z, size: 0.2, max: 0.5, drag: 3, grow: 1 }, 0xffffff);
      }
      if (b.life <= 0) {
        this.confettiBurst(b.mesh.position.x, b.mesh.position.y, b.mesh.position.z, 30);
        this.root.remove(b.mesh);
        this.balloons.splice(i, 1);
      }
    }
  }
}

/** Dark circle under a player showing exactly where they will land. */
export class LandingCircles {
  readonly root = new THREE.Group();
  private readonly pool: THREE.Mesh[] = [];
  private used = 0;
  private readonly geo = new THREE.CircleGeometry(1, 28);
  private readonly mat = new THREE.MeshBasicMaterial({ color: 0x14122a, transparent: true, opacity: 0.4, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });

  begin(): void {
    this.used = 0;
  }

  place(x: number, y: number, z: number, radius: number, height: number): void {
    let m = this.pool[this.used];
    if (!m) {
      m = new THREE.Mesh(this.geo, this.mat);
      m.rotation.x = -Math.PI / 2;
      m.renderOrder = 1;
      this.root.add(m);
      this.pool.push(m);
    }
    this.used++;
    m.visible = true;
    // Slightly smaller when high up, but never disappears so landings stay readable.
    const s = radius * (1.15 - Math.min(0.4, height * 0.02));
    m.scale.set(s, s, s);
    m.position.set(x, y + 0.03, z);
  }

  end(): void {
    for (let i = this.used; i < this.pool.length; i++) this.pool[i].visible = false;
  }
}
