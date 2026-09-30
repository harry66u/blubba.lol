import * as THREE from 'three';

/**
 * A tube whose centerline and radius can be changed every frame without reallocating: used for
 * the flailing bodies and arms of the tube men. Vertices are rebuilt in place from `spine` and
 * `radii` using parallel-transport frames so the tube never twists.
 */
export class FlexTube {
  readonly mesh: THREE.Mesh;
  readonly geometry: THREE.BufferGeometry;
  /** Ring centers, xyz per ring, in the mesh's local space. */
  readonly spine: Float32Array;
  readonly radii: Float32Array;
  /** Frame of each ring after `update()` (normal and binormal, xyz each). */
  readonly normals: Float32Array;
  readonly binormals: Float32Array;
  private readonly pos: THREE.BufferAttribute;
  private readonly nrm: THREE.BufferAttribute;
  /** Cross-section: radius multiplier at each vertex around a ring (null = round). */
  private section: Float32Array | null = null;
  private sectionFn: ((a: number) => number) | null = null;
  /** The cross-section's widest point (radius multiplier), for the bounding sphere. */
  private sectionMax = 1;
  /** Kept around the tube as it flexes, so the renderer can skip tubes that are off screen. */
  private readonly sphere = new THREE.Sphere();

  constructor(
    readonly rings: number,
    readonly segs: number,
    material: THREE.Material,
  ) {
    this.spine = new Float32Array(rings * 3);
    this.radii = new Float32Array(rings);
    this.normals = new Float32Array(rings * 3);
    this.binormals = new Float32Array(rings * 3);
    const vcount = rings * (segs + 1);
    const positions = new Float32Array(vcount * 3);
    const uvs = new Float32Array(vcount * 2);
    for (let i = 0; i < rings; i++) {
      for (let j = 0; j <= segs; j++) {
        const k = i * (segs + 1) + j;
        uvs[k * 2] = j / segs;
        uvs[k * 2 + 1] = i / (rings - 1);
      }
    }
    const index: number[] = [];
    for (let i = 0; i < rings - 1; i++) {
      for (let j = 0; j < segs; j++) {
        const a = i * (segs + 1) + j;
        const b = a + segs + 1;
        // Counter-clockwise seen from outside, so the outer surface is the front face.
        index.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }
    this.geometry = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(positions, 3);
    this.pos.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', this.pos);
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    this.nrm = new THREE.BufferAttribute(new Float32Array(vcount * 3), 3);
    this.nrm.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('normal', this.nrm);
    this.geometry.setIndex(index);
    this.geometry.boundingSphere = this.sphere;
    this.mesh = new THREE.Mesh(this.geometry, material);
    // Culled against the camera like anything else (the sphere follows the flexing tube), so
    // players behind you aren't drawn; the sun's shadow pass culls on its own, so their
    // shadows still show.
    this.mesh.frustumCulled = true;
  }

  /**
   * Gives the tube a cross-section other than a circle: `fn(a)` multiplies the radius at angle
   * `a` around each ring (0 = along the ring normal, pi/2 = along the binormal). Null = round.
   */
  setSection(fn: ((a: number) => number) | null): void {
    this.sectionFn = fn;
    if (!fn) {
      this.section = null;
      this.sectionMax = 1;
      return;
    }
    const s = new Float32Array(this.segs + 1);
    for (let j = 0; j <= this.segs; j++) s[j] = fn((j / this.segs) * Math.PI * 2);
    this.section = s;
    this.sectionMax = Math.max(...s.map(Math.abs));
  }

  /** The cross-section's radius multiplier at angle `a` (1 for a round tube). */
  sectionAt(a: number): number {
    return this.sectionFn ? this.sectionFn(a) : 1;
  }

  /**
   * Rebuilds the vertices. `refX/refY/refZ` is the direction the first ring's normal should
   * point toward (e.g. the character's front) so faces and patterns stay oriented.
   */
  update(refX = 0, refY = 0, refZ = 1): void {
    const { rings, segs, spine, radii, normals: N, binormals: B } = this;
    const p = this.pos.array as Float32Array;
    let nx = refX;
    let ny = refY;
    let nz = refZ;
    for (let i = 0; i < rings; i++) {
      const i0 = Math.max(0, i - 1) * 3;
      const i1 = Math.min(rings - 1, i + 1) * 3;
      let tx = spine[i1] - spine[i0];
      let ty = spine[i1 + 1] - spine[i0 + 1];
      let tz = spine[i1 + 2] - spine[i0 + 2];
      const tl = Math.hypot(tx, ty, tz) || 1;
      tx /= tl;
      ty /= tl;
      tz /= tl;
      // Parallel transport: remove the tangent component from the previous normal.
      const d = nx * tx + ny * ty + nz * tz;
      nx -= tx * d;
      ny -= ty * d;
      nz -= tz * d;
      let nl = Math.hypot(nx, ny, nz);
      if (nl < 1e-5) {
        // Degenerate: pick any perpendicular.
        nx = ty;
        ny = -tx;
        nz = 0;
        nl = Math.hypot(nx, ny, nz) || 1;
      }
      nx /= nl;
      ny /= nl;
      nz /= nl;
      const bx = ty * nz - tz * ny;
      const by = tz * nx - tx * nz;
      const bz = tx * ny - ty * nx;
      N[i * 3] = nx;
      N[i * 3 + 1] = ny;
      N[i * 3 + 2] = nz;
      B[i * 3] = bx;
      B[i * 3 + 1] = by;
      B[i * 3 + 2] = bz;
      const cx = spine[i * 3];
      const cy = spine[i * 3 + 1];
      const cz = spine[i * 3 + 2];
      const r = radii[i];
      const sec = this.section;
      for (let j = 0; j <= segs; j++) {
        const a = (j / segs) * Math.PI * 2;
        const rj = sec ? r * sec[j] : r;
        const ca = Math.cos(a) * rj;
        const sa = Math.sin(a) * rj;
        const k = (i * (segs + 1) + j) * 3;
        p[k] = cx + nx * ca + bx * sa;
        p[k + 1] = cy + ny * ca + by * sa;
        p[k + 2] = cz + nz * ca + bz * sa;
      }
    }
    this.pos.needsUpdate = true;
    this.computeNormals();
    this.fitSphere();
  }

  /** A sphere around every ring (its center plus its widest radius). */
  private fitSphere(): void {
    const { rings, spine, radii } = this;
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < rings; i++) {
      const x = spine[i * 3];
      const y = spine[i * 3 + 1];
      const z = spine[i * 3 + 2];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const cz = (minZ + maxZ) / 2;
    let r = 0;
    for (let i = 0; i < rings; i++) {
      const d = Math.hypot(spine[i * 3] - cx, spine[i * 3 + 1] - cy, spine[i * 3 + 2] - cz) + Math.abs(radii[i]) * this.sectionMax;
      if (d > r) r = d;
    }
    this.sphere.center.set(cx, cy, cz);
    // A hair of margin for rounding.
    this.sphere.radius = r * 1.001 + 1e-3;
  }

  /**
   * Smooth normals, exactly what BufferGeometry.computeVertexNormals gives (the same sums in the
   * same order, so the shading is identical), but straight on the arrays: that generic version
   * reads and writes every vertex through Vector3 accessors, and with a dozen tube men flexing
   * every frame it was the biggest single cost on the CPU (a battery drain on laptops and phones).
   */
  private computeNormals(): void {
    const { rings, segs } = this;
    const p = this.pos.array as Float32Array;
    const n = this.nrm.array as Float32Array;
    n.fill(0);
    const w = segs + 1;
    // Adds (pC - pB) x (pA - pB) to all three corners' normals.
    const tri = (a: number, b: number, c: number) => {
      const ia = a * 3;
      const ib = b * 3;
      const ic = c * 3;
      const bx = p[ib];
      const by = p[ib + 1];
      const bz = p[ib + 2];
      const cbx = p[ic] - bx;
      const cby = p[ic + 1] - by;
      const cbz = p[ic + 2] - bz;
      const abx = p[ia] - bx;
      const aby = p[ia + 1] - by;
      const abz = p[ia + 2] - bz;
      const x = cby * abz - cbz * aby;
      const y = cbz * abx - cbx * abz;
      const z = cbx * aby - cby * abx;
      n[ia] += x;
      n[ia + 1] += y;
      n[ia + 2] += z;
      n[ib] += x;
      n[ib + 1] += y;
      n[ib + 2] += z;
      n[ic] += x;
      n[ic + 1] += y;
      n[ic + 2] += z;
    };
    // The index order from the constructor.
    for (let i = 0; i < rings - 1; i++) {
      for (let j = 0; j < segs; j++) {
        const a = i * w + j;
        const b = a + w;
        tri(a, a + 1, b);
        tri(b, a + 1, b + 1);
      }
    }
    for (let k = 0; k < n.length; k += 3) {
      const x = n[k];
      const y = n[k + 1];
      const z = n[k + 2];
      const inv = 1 / (Math.sqrt(x * x + y * y + z * z) || 1);
      n[k] = x * inv;
      n[k + 1] = y * inv;
      n[k + 2] = z * inv;
    }
    this.nrm.needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
  }
}

/** Cheap smooth 1D value noise in [-1, 1]. */
export function noise1(x: number, seed = 0): number {
  const i = Math.floor(x);
  const f = x - i;
  const h = (n: number) => {
    const s = Math.sin((n + seed * 57.13) * 127.1) * 43758.5453;
    return (s - Math.floor(s)) * 2 - 1;
  };
  const u = f * f * (3 - 2 * f);
  return h(i) * (1 - u) + h(i + 1) * u;
}
