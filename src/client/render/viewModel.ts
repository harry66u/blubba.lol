import * as THREE from 'three';

/** First-person Air Cannon held in the lower right of the screen. */
export class ViewModel {
  readonly root = new THREE.Group();
  private readonly gun = new THREE.Group();
  private readonly tank: THREE.Mesh;
  private readonly gauge: THREE.Mesh;
  private readonly muzzleRing: THREE.Mesh;
  private readonly bodyMat: THREE.MeshStandardMaterial;
  private readonly glowMat: THREE.MeshStandardMaterial;
  private recoil = 0;
  private recoilV = 0;
  private bobT = 0;
  private reloadT = 0;
  private swayX = 0;
  private swayY = 0;
  readonly muzzle = new THREE.Object3D();

  constructor(color: number) {
    this.bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.3, metalness: 0.05 });
    const accent = new THREE.MeshStandardMaterial({ color: 0xffd60a, roughness: 0.35 });
    const metal = new THREE.MeshStandardMaterial({ color: 0xcfd6e6, roughness: 0.25, metalness: 0.7 });
    this.glowMat = new THREE.MeshStandardMaterial({ color: 0xbff4ff, emissive: 0x7fe7ff, emissiveIntensity: 0.3, roughness: 0.2, transparent: true, opacity: 0.85 });

    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.09, 0.62, 18), this.bodyMat);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.z = -0.3;
    const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.08, 0.14, 20, 1, true), accent);
    bell.rotation.x = -Math.PI / 2;
    bell.position.z = -0.66;
    (bell.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
    this.muzzleRing = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.02, 8, 24), this.glowMat);
    this.muzzleRing.position.z = -0.73;
    this.tank = new THREE.Mesh(new THREE.SphereGeometry(0.14, 20, 14), this.glowMat);
    this.tank.scale.set(1, 0.85, 1.35);
    this.tank.position.set(0, 0.13, -0.12);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.2, 0.09), metal);
    grip.position.set(0, -0.12, 0.02);
    grip.rotation.x = 0.3;
    this.gauge = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.02, 16), new THREE.MeshStandardMaterial({ color: 0xffffff }));
    this.gauge.rotation.z = Math.PI / 2;
    this.gauge.position.set(0.1, 0.05, -0.05);
    const needle = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.035, 0.006), new THREE.MeshBasicMaterial({ color: 0xff3b5c }));
    needle.position.set(0.012, 0.012, 0);
    this.gauge.add(needle);
    this.gauge.userData.needle = needle;
    const hose = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.018, 8, 16, Math.PI), metal);
    hose.position.set(-0.06, 0.05, 0.02);
    hose.rotation.y = Math.PI / 2;
    this.muzzle.position.set(0, 0, -0.75);
    this.gun.add(barrel, bell, this.muzzleRing, this.tank, grip, this.gauge, hose, this.muzzle);
    this.gun.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.renderOrder = 10;
        const mat = m.material as THREE.Material;
        mat.depthTest = true;
      }
    });
    this.root.add(this.gun);
    this.root.scale.setScalar(0.38);
    this.root.position.set(0.21, -0.19, -0.34);
  }

  setColor(hex: number): void {
    this.bodyMat.color.set(hex);
  }

  kick(power: number): void {
    this.recoilV += 3 + power * 6;
  }

  startReload(duration: number): void {
    this.reloadT = duration;
  }

  update(dt: number, opts: { speed: number; charge: number; onGround: boolean; lookDX: number; lookDY: number; ammoFrac: number; reloading: boolean }): void {
    // Spring recoil.
    this.recoilV += (-80 * this.recoil - 12 * this.recoilV) * dt;
    this.recoil += this.recoilV * dt;
    if (opts.onGround) this.bobT += dt * Math.min(12, opts.speed * 1.2);
    const bob = opts.onGround ? Math.min(1, opts.speed / 8) : 0;
    this.swayX += (-opts.lookDX * 0.0015 - this.swayX) * Math.min(1, dt * 10);
    this.swayY += (opts.lookDY * 0.0015 - this.swayY) * Math.min(1, dt * 10);
    const shake = opts.charge > 0.95 ? (Math.random() - 0.5) * 0.006 : 0;
    let reloadTilt = 0;
    if (this.reloadT > 0 || opts.reloading) {
      this.reloadT = Math.max(0, this.reloadT - dt);
      reloadTilt = opts.reloading ? 0.6 : 0;
    }
    this.gun.position.set(
      Math.sin(this.bobT) * 0.018 * bob + this.swayX + shake,
      Math.abs(Math.cos(this.bobT)) * 0.015 * bob + this.swayY - opts.charge * 0.02 - reloadTilt * 0.08,
      this.recoil * 0.06 + opts.charge * 0.05,
    );
    this.gun.rotation.set(this.recoil * 0.25 + reloadTilt * -0.5, 0, reloadTilt * 0.3);
    const pump = 1 + opts.charge * 0.35;
    this.tank.scale.set(pump, 0.85 * pump, 1.35 * pump);
    this.glowMat.emissiveIntensity = 0.15 + opts.charge * 0.9;
    const needle = this.gauge.userData.needle as THREE.Mesh;
    needle.rotation.x = -1.2 + opts.ammoFrac * 2.4;
  }
}
