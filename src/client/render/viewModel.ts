import * as THREE from 'three';
import type { PartsInput, WeaponId } from '../../shared/loadout';
import { type WeaponModel, buildWeaponModel, weaponLookKey } from './weapons';
import { applyFinish } from './looks';
import { starTexture } from './effects';

/** First-person weapon held in the lower right of the screen. */
export class ViewModel {
  readonly root = new THREE.Group();
  private readonly gun = new THREE.Group();
  private model: WeaponModel;
  private weaponId: WeaponId = 'airCannon';
  private lookKey = weaponLookKey('airCannon', null);
  private color: number;
  private finish = 'team';
  private recoil = 0;
  private recoilV = 0;
  private bobT = 0;
  private swayX = 0;
  private swayY = 0;
  private time = 0;
  /** World-space muzzle marker (follows the current weapon). */
  readonly muzzle = new THREE.Object3D();
  private readonly flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: starTexture(), color: 0xfff3b0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
  private flashT = 0;
  private flashSize = 1;
  /** Brief freeze of the gun's motion when your shot lands (hit-stop). */
  private freezeT = 0;

  constructor(color: number) {
    this.color = color;
    this.model = buildWeaponModel('airCannon', color);
    this.gun.add(this.model.root);
    this.model.muzzle.add(this.muzzle);
    this.root.add(this.gun);
    this.root.scale.setScalar(0.38);
    this.root.position.set(0.21, -0.19, -0.34);
    this.markLayer();
    this.flash.visible = false;
    this.flash.renderOrder = 12;
    this.muzzle.add(this.flash);
  }

  private markLayer(): void {
    this.gun.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.renderOrder = 10;
        m.castShadow = false;
      }
    });
  }

  get weapon(): WeaponId {
    return this.weaponId;
  }

  /** Shows a weapon built with the given parts (rebuilt only when either changes). */
  setWeapon(id: WeaponId, parts: PartsInput = null): void {
    const key = weaponLookKey(id, parts);
    if (key === this.lookKey) return;
    this.lookKey = key;
    this.weaponId = id;
    this.gun.remove(this.model.root);
    this.model.dispose();
    this.model = buildWeaponModel(id, this.color, parts);
    applyFinish(this.model, this.finish, this.color);
    this.gun.add(this.model.root);
    this.model.muzzle.add(this.muzzle);
    this.markLayer();
    const scale: Record<WeaponId, number> = { airCannon: 0.38, leafBlower: 0.3, airHorn: 0.36, pumpRifle: 0.36, bubbleShotgun: 0.37, balloonMortar: 0.36, popGun: 0.4, skyRocket: 0.3, gustRepeater: 0.33, windLance: 0.34 };
    this.root.scale.setScalar(scale[id]);
    this.root.position.set(id === 'leafBlower' ? 0.19 : 0.21, id === 'leafBlower' ? -0.2 : -0.19, -0.34);
  }

  setColor(hex: number): void {
    this.color = hex;
    applyFinish(this.model, this.finish, hex);
  }

  /** Weapon finish from the player's cosmetics. */
  setFinish(key: string): void {
    if (key === this.finish) return;
    this.finish = key;
    applyFinish(this.model, key, this.color);
  }

  kick(power: number): void {
    this.recoilV += 3 + power * 6;
    this.flashT = 0.07 + power * 0.03;
    this.flashSize = 0.9 + power * 1.3;
    this.flash.material.rotation = Math.random() * Math.PI;
  }

  /** Your shot landed: hold the gun still for a beat. */
  hitStop(seconds: number): void {
    this.freezeT = Math.max(this.freezeT, seconds);
  }

  startReload(_duration: number): void {
    this.recoilV -= 2;
  }

  update(dt: number, opts: { speed: number; charge: number; onGround: boolean; lookDX: number; lookDY: number; ammoFrac: number; reloading: boolean; active: boolean }): void {
    this.time += dt;
    this.flash.visible = this.flashT > 0;
    if (this.flashT > 0) {
      this.flashT -= dt;
      const s = this.flashSize * (1 + Math.random() * 0.2);
      this.flash.scale.set(s, s, 1);
    }
    if (this.freezeT > 0) {
      this.freezeT -= dt;
      return;
    }
    this.recoilV += (-80 * this.recoil - 12 * this.recoilV) * dt;
    this.recoil += this.recoilV * dt;
    if (opts.onGround) this.bobT += dt * Math.min(12, opts.speed * 1.2);
    const bob = opts.onGround ? Math.min(1, opts.speed / 8) : 0;
    this.swayX += (-opts.lookDX * 0.0015 - this.swayX) * Math.min(1, dt * 10);
    this.swayY += (opts.lookDY * 0.0015 - this.swayY) * Math.min(1, dt * 10);
    const shake = opts.charge > 0.95 && this.weaponId !== 'leafBlower' ? (Math.random() - 0.5) * 0.006 : 0;
    const reloadTilt = opts.reloading ? 0.6 : 0;
    this.gun.position.set(
      Math.sin(this.bobT) * 0.018 * bob + this.swayX + shake,
      Math.abs(Math.cos(this.bobT)) * 0.015 * bob + this.swayY - opts.charge * 0.02 - reloadTilt * 0.08,
      this.recoil * 0.06 + opts.charge * 0.05,
    );
    this.gun.rotation.set(this.recoil * 0.25 + reloadTilt * -0.5, 0, reloadTilt * 0.3);
    this.model.setCharge(opts.charge, this.time, opts.active);
  }
}
