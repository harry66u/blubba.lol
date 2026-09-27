import * as THREE from 'three';

/** Giant striped beach ball for Ball mode, with a landing shadow so its bounce is easy to read. */
export class BeachBall {
  readonly root = new THREE.Group();
  private readonly ball: THREE.Mesh;
  private readonly shadow: THREE.Mesh;
  private readonly spin = new THREE.Quaternion();
  private readonly axis = new THREE.Vector3();
  private shown = 1;

  constructor(readonly radius: number) {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 256;
    const g = c.getContext('2d')!;
    const colors = ['#ff3b5c', '#ffffff', '#ffd60a', '#ffffff', '#2ec5ff', '#ffffff'];
    const w = c.width / colors.length;
    colors.forEach((col, i) => {
      g.fillStyle = col;
      g.fillRect(i * w, 0, w + 1, c.height);
    });
    // White caps at the poles.
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, c.width, 18);
    g.fillRect(0, c.height - 18, c.width, 18);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.ball = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 36, 24),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.25, metalness: 0, emissive: 0xffffff, emissiveIntensity: 0.06 }),
    );
    this.ball.castShadow = true;
    this.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(radius * 0.9, 32),
      new THREE.MeshBasicMaterial({ color: 0x1d1b3a, transparent: true, opacity: 0.35, depthWrite: false }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.renderOrder = 2;
    this.root.add(this.ball, this.shadow);
  }

  /** Places the ball; `ground` is the height of the surface below (null if none). */
  update(x: number, y: number, z: number, vx: number, vz: number, inPlay: boolean, ground: number | null, dt: number): void {
    this.shown += ((inPlay ? 1 : 0) - this.shown) * Math.min(1, dt * 8);
    this.root.visible = this.shown > 0.02;
    this.ball.position.set(x, y, z);
    this.ball.scale.setScalar(Math.max(0.02, this.shown));
    // Roll: rotate about the axis perpendicular to horizontal travel.
    const sp = Math.hypot(vx, vz);
    if (sp > 0.05) {
      this.axis.set(vz / sp, 0, -vx / sp);
      this.spin.setFromAxisAngle(this.axis, (sp * dt) / this.radius);
      this.ball.quaternion.premultiply(this.spin);
    }
    if (ground === null || y - ground > 30) {
      this.shadow.visible = false;
    } else {
      this.shadow.visible = true;
      this.shadow.position.set(x, ground + 0.03, z);
      const h = Math.max(0, y - this.radius - ground);
      const k = Math.max(0.35, 1 - h / 14);
      this.shadow.scale.setScalar(k * this.shown);
      (this.shadow.material as THREE.MeshBasicMaterial).opacity = 0.4 * k;
    }
  }

  get position(): THREE.Vector3 {
    return this.ball.position;
  }

  dispose(): void {
    this.ball.geometry.dispose();
    (this.ball.material as THREE.MeshStandardMaterial).map?.dispose();
    (this.ball.material as THREE.Material).dispose();
    this.shadow.geometry.dispose();
    (this.shadow.material as THREE.Material).dispose();
  }
}
