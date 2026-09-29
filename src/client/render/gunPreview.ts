import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { PartsInput, WeaponId } from '../../shared/loadout';
import { applyFinish } from './looks';
import { type WeaponModel, buildWeaponModel, weaponLookKey } from './weapons';

/**
 * A small turntable view of the gun you're building (the same model and finishes as in the game).
 * It has its own tiny renderer, only draws while it's on screen, and frees its WebGL context when
 * disposed (browsers only allow a handful at once).
 */
export class GunPreview {
  readonly canvas = document.createElement('canvas');
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(30, 1.4, 0.05, 20);
  private readonly envTex: THREE.Texture;
  /** Turns (yaw) and tilts; the model sits centered inside it. */
  private readonly pivot = new THREE.Group();
  private model: WeaponModel | null = null;
  private key = '';
  private finish = '';
  private color = -1;
  private raf = 0;
  private last = 0;
  private time = 0;
  private yaw = 0.7;
  private tilt = 0.18;
  private spinV = 0;
  private dragging = false;
  private dragX = 0;
  private dragY = 0;
  private onScreen = false;
  private disposed = false;
  private readonly observer: IntersectionObserver | null = null;
  private readonly box = new THREE.Box3();
  private readonly center = new THREE.Vector3();
  private readonly size = new THREE.Vector3();

  constructor() {
    this.canvas.className = 'gun-canvas';
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.environment = this.envTex;
    // Soft key light, a cool rim light from behind, and a gentle fill.
    const key = new THREE.DirectionalLight(0xfff4e6, 2.4);
    key.position.set(-2, 3, 3);
    const rim = new THREE.DirectionalLight(0x9fe8ff, 2.2);
    rim.position.set(2.5, 1.5, -3);
    this.scene.add(key, rim, new THREE.HemisphereLight(0xeaf6ff, 0xffe0f0, 0.8), this.pivot);
    // Drag to spin (mouse and touch); vertical touch drags still scroll the page.
    this.canvas.style.touchAction = 'pan-y';
    this.canvas.addEventListener('pointerdown', this.onDown);
    this.canvas.addEventListener('pointermove', this.onMove);
    this.canvas.addEventListener('pointerup', this.onUp);
    this.canvas.addEventListener('pointercancel', this.onUp);
    if (typeof IntersectionObserver !== 'undefined') {
      this.observer = new IntersectionObserver((entries) => {
        this.onScreen = entries.some((e) => e.isIntersecting);
        this.wake();
      });
      this.observer.observe(this.canvas);
    } else {
      this.onScreen = true;
    }
    document.addEventListener('visibilitychange', this.wake);
  }

  private readonly onDown = (e: PointerEvent) => {
    this.dragging = true;
    this.dragX = e.clientX;
    this.dragY = e.clientY;
    this.spinV = 0;
    this.canvas.setPointerCapture?.(e.pointerId);
  };

  private readonly onMove = (e: PointerEvent) => {
    if (!this.dragging) return;
    const dx = e.clientX - this.dragX;
    const dy = e.clientY - this.dragY;
    this.dragX = e.clientX;
    this.dragY = e.clientY;
    this.yaw += dx * 0.013;
    this.spinV = dx * 0.013 * 60;
    if (e.pointerType === 'mouse') this.tilt = Math.max(-0.7, Math.min(0.9, this.tilt + dy * 0.008));
    this.wake();
  };

  private readonly onUp = () => {
    this.dragging = false;
  };

  /** Shows a weapon with these parts, in the player's color and weapon finish. */
  setGun(id: WeaponId, parts: PartsInput, color: number, finish: string): void {
    if (this.disposed) return;
    const key = weaponLookKey(id, parts);
    if (key !== this.key) {
      this.key = key;
      if (this.model) {
        this.pivot.remove(this.model.root);
        this.model.dispose();
      }
      this.model = buildWeaponModel(id, color, parts);
      this.model.root.traverse((o) => (o.castShadow = false));
      this.pivot.add(this.model.root);
      this.finish = '';
      this.frame();
    }
    if (finish !== this.finish || color !== this.color) {
      this.finish = finish;
      this.color = color;
      applyFinish(this.model!, finish, color);
    }
    this.wake();
  }

  /** Centers the model and pulls the camera back so any barrel length fits. */
  private frame(): void {
    const root = this.model!.root;
    root.position.set(0, 0, 0);
    root.updateMatrixWorld(true);
    this.box.setFromObject(root);
    this.box.getCenter(this.center);
    this.box.getSize(this.size);
    root.position.copy(this.center).multiplyScalar(-1);
    const radius = Math.max(0.2, this.size.length() / 2);
    const dist = (radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2))) * 0.82;
    this.camera.position.set(0, radius * 0.25, dist);
    this.camera.lookAt(0, 0, 0);
    this.camera.near = dist / 20;
    this.camera.far = dist * 4;
    this.camera.updateProjectionMatrix();
  }

  private readonly wake = () => {
    if (this.raf || this.disposed || !this.onScreen || document.hidden || !this.canvas.isConnected) return;
    this.last = 0;
    this.raf = requestAnimationFrame(this.loop);
  };

  private readonly loop = (now: number) => {
    this.raf = 0;
    // Only draw while the builder is showing.
    if (this.disposed || !this.onScreen || document.hidden || !this.canvas.isConnected) return;
    const dt = Math.min(0.05, (now - (this.last || now)) / 1000);
    this.last = now;
    this.time += dt;
    const w = this.canvas.clientWidth || 260;
    const h = this.canvas.clientHeight || 180;
    if (this.canvas.width !== Math.round(w * this.renderer.getPixelRatio()) || this.canvas.height !== Math.round(h * this.renderer.getPixelRatio())) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    if (!this.dragging) {
      // Fling, then settle back into a slow idle spin.
      this.spinV += (0.45 - this.spinV) * Math.min(1, dt * 2);
      this.yaw += this.spinV * dt;
    }
    this.pivot.rotation.set(this.tilt, this.yaw, 0, 'XYZ');
    // A slow breath of charge so the pieces that move (tanks, pumps, valves) show off.
    const c = 0.5 - 0.5 * Math.cos(this.time * 1.4);
    this.model?.setCharge(c * 0.8, this.time, true);
    this.renderer.render(this.scene, this.camera);
    this.raf = requestAnimationFrame(this.loop);
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.observer?.disconnect();
    document.removeEventListener('visibilitychange', this.wake);
    if (this.model) {
      this.pivot.remove(this.model.root);
      this.model.dispose();
      this.model = null;
    }
    this.envTex.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
