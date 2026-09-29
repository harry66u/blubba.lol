import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { WeaponId } from '../../shared/loadout';
import { Effects, newTrailState } from './effects';
import { type Look, TubeMan, defaultPose } from './tubeMan';

/** How long a showcase hop lasts, and how often the preview hops while you browse trails. */
const HOP_TIME = 1.1;
const HOP_EVERY = 1.9;
/** Trails are spaced by distance and a hop is short, so the preview draws them denser. */
const PREVIEW_TRAIL_DENSITY = 2.5;

/**
 * A small turntable view of your tube man for the locker. Uses its own little renderer so it
 * works from the menu without touching the game scene. Shows your base, plays taunts, and hops
 * to show off your trail.
 */
export class TubePreview {
  readonly canvas = document.createElement('canvas');
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
  private man: TubeMan;
  private readonly pose = defaultPose();
  private readonly effects = new Effects();
  private readonly trailState = newTrailState();
  private raf = 0;
  private last = 0;
  private angle = 0;
  private dragging = false;
  private color: number;
  /** Seconds into the current hop (<0: not hopping). */
  private hopT = -1;
  private hopWait = 0;
  /** Keep hopping (the Trails tab is open). */
  private showTrail = false;

  constructor(color: number, look: Look, weapon: WeaponId) {
    this.color = color;
    this.canvas.className = 'preview-canvas';
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(3, 6, 4);
    this.scene.add(sun, new THREE.HemisphereLight(0xdff2ff, 0xffe0f0, 1.1));
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.2, 0.12, 40), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }));
    disc.position.y = -0.06;
    this.scene.add(disc);
    this.man = new TubeMan(color, { seed: 4.2, look });
    this.man.setWeapon(weapon);
    this.scene.add(this.man.group, this.effects.root);
    this.effects.camQuat = this.camera.quaternion;
    this.effects.trailDensity = PREVIEW_TRAIL_DENSITY;
    this.camera.position.set(0, 1.55, 6.2);
    this.camera.lookAt(0, 1.15, 0);
    // Drag to spin.
    this.canvas.addEventListener('pointerdown', () => (this.dragging = true));
    window.addEventListener('pointerup', this.stopDrag);
    this.canvas.addEventListener('pointermove', (e) => {
      if (this.dragging) this.angle += e.movementX * 0.012;
    });
  }

  private readonly stopDrag = () => {
    this.dragging = false;
  };

  setLook(color: number, look: Look, weapon: WeaponId): void {
    if (color !== this.color) {
      this.color = color;
      this.man.setColor(color);
    }
    this.man.setLook(look);
    this.man.setWeapon(weapon);
  }

  /** Plays a taunt so you can see what you're buying. */
  taunt(style: string): void {
    this.man.taunt(style);
  }

  /** A little launch into the air, trail and all. */
  hop(): void {
    this.hopT = 0;
    this.hopWait = HOP_EVERY;
  }

  /** Keep hopping every couple of seconds (while the Trails tab is open). */
  showTrails(on: boolean): void {
    this.showTrail = on;
  }

  start(): void {
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - (this.last || now)) / 1000);
      this.last = now;
      const w = this.canvas.clientWidth || 260;
      const h = this.canvas.clientHeight || 320;
      if (this.canvas.width !== Math.round(w * this.renderer.getPixelRatio())) {
        this.renderer.setSize(w, h, false);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
      }
      if (!this.dragging) this.angle += dt * 0.5;
      if (this.showTrail && this.hopT < 0) {
        this.hopWait -= dt;
        if (this.hopWait <= 0) this.hop();
      }
      // Hop: up and over in an arc, flailing like a launch.
      let y = 0;
      let x = 0;
      if (this.hopT >= 0) {
        this.hopT += dt;
        const k = Math.min(1, this.hopT / HOP_TIME);
        y = Math.sin(k * Math.PI) * 0.75;
        x = Math.sin(k * Math.PI * 2) * 0.35;
        if (k >= 1) this.hopT = -1;
      }
      const flying = this.hopT >= 0;
      this.man.group.position.set(x, y, 0);
      this.pose.time += dt;
      this.pose.dt = dt;
      this.pose.yaw = this.angle;
      this.pose.launched = flying;
      this.pose.onGround = !flying;
      this.pose.vy = flying ? Math.cos(Math.min(1, this.hopT / HOP_TIME) * Math.PI) * 4 : 0;
      this.man.update(this.pose);
      this.effects.trail(this.trailState, this.man.trail, x, y + 0.95, 0, flying);
      this.effects.update(dt);
      this.renderer.render(this.scene, this.camera);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('pointerup', this.stopDrag);
    this.man.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
