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
        index.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    this.geometry = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(positions, 3);
    this.pos.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', this.pos);
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    const normalAttr = new THREE.BufferAttribute(new Float32Array(vcount * 3), 3);
    normalAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('normal', normalAttr);
    this.geometry.setIndex(index);
    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.frustumCulled = false;
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
      for (let j = 0; j <= segs; j++) {
        const a = (j / segs) * Math.PI * 2;
        const ca = Math.cos(a) * r;
        const sa = Math.sin(a) * r;
        const k = (i * (segs + 1) + j) * 3;
        p[k] = cx + nx * ca + bx * sa;
        p[k + 1] = cy + ny * ca + by * sa;
        p[k + 2] = cz + nz * ca + bz * sa;
      }
    }
    this.pos.needsUpdate = true;
    this.geometry.computeVertexNormals();
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
