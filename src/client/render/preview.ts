import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { WeaponId } from '../../shared/loadout';
import { Effects, newTrailState } from './effects';
import { type Look, TubeMan, defaultPose } from './tubeMan';

/** Which part of the tube man an item thumbnail shows. */
export type ThumbFrame = 'body' | 'head' | 'hat' | 'base';

/** Thumbnails already drawn (item, color): kept for the whole visit, so reopening the locker is instant. */
const thumbCache = new Map<string, string>();
/** Thumbnail size in device pixels (drawn at about 48 px on a 2x screen). */
const THUMB_PX = 112;

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
  /** Turned to face the camera (yaw 0 faces away, down -z). */
  private angle = Math.PI;
  private dragging = false;
  private color: number;
  /** Seconds into the current hop (<0: not hopping). */
  private hopT = -1;
  private hopWait = 0;
  /** Keep hopping (the Trails tab is open). */
  private showTrail = false;
  /** Item thumbnails waiting to be drawn (a few per frame, before the preview itself). */
  private thumbQueue: { key: string; color: number; look: Look; frame: ThumbFrame; done: (url: string) => void }[] = [];
  private thumbScene: THREE.Scene | null = null;
  private thumbMan: TubeMan | null = null;
  private readonly thumbCam = new THREE.PerspectiveCamera(30, 1, 0.1, 50);

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
    // It stands still facing you; drag (mouse or finger) to turn it.
    this.canvas.style.touchAction = 'none';
    this.canvas.style.cursor = 'grab';
    this.canvas.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.dragX = e.clientX;
      this.canvas.style.cursor = 'grabbing';
      try {
        this.canvas.setPointerCapture(e.pointerId);
      } catch {
        // Not capturable (synthetic events): window pointerup still ends the drag.
      }
    });
    window.addEventListener('pointerup', this.stopDrag);
    window.addEventListener('pointercancel', this.stopDrag);
    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.angle += (e.clientX - this.dragX) * 0.012;
      this.dragX = e.clientX;
    });
  }

  private dragX = 0;

  private readonly stopDrag = () => {
    this.dragging = false;
    this.canvas.style.cursor = 'grab';
  };

  setLook(color: number, look: Look, weapon: WeaponId): void {
    if (color !== this.color) {
      this.color = color;
      this.man.setColor(color);
    }
    this.man.setLook(look);
    this.man.setWeapon(weapon);
  }

  /** Shows a face scan on the preview (null: the cartoon face). */
  setFace(tex: THREE.Texture | null): void {
    this.man.setFacePhoto(tex);
  }

  /** Shows a custom decal on the preview (null: none). */
  setDecal(tex: THREE.Texture | null): void {
    this.man.setDecal(tex);
  }

  /**
   * A picture of an item on a tube man in your color (the real 3D item, the same as in a match),
   * for the locker's item cards. Cached; the ones not drawn yet are drawn a few per frame.
   */
  thumb(key: string, color: number, look: Look, frame: ThumbFrame, done: (url: string) => void): void {
    const id = `${key}|${color}`;
    const hit = thumbCache.get(id);
    if (hit) return done(hit);
    this.thumbQueue.push({ key: id, color, look, frame, done });
  }

  /** Draws one queued thumbnail into the corner of the canvas and copies it out (the preview is drawn over it right after). */
  private drawThumb(): void {
    const job = this.thumbQueue.shift();
    if (!job) return;
    const hit = thumbCache.get(job.key);
    if (hit) return job.done(hit);
    if (!this.thumbScene || !this.thumbMan) {
      this.thumbScene = new THREE.Scene();
      this.thumbScene.environment = this.scene.environment;
      const sun = new THREE.DirectionalLight(0xffffff, 2.2);
      sun.position.set(3, 6, 4);
      this.thumbScene.add(sun, new THREE.HemisphereLight(0xdff2ff, 0xffe0f0, 1.1));
      this.thumbMan = new TubeMan(job.color, { seed: 4.2, look: job.look });
      this.thumbScene.add(this.thumbMan.group);
    }
    const man = this.thumbMan;
    man.setColor(job.color);
    man.setLook(job.look);
    // Stand still facing the camera; a few steps let the tube settle into its idle shape.
    const pose = defaultPose();
    pose.yaw = Math.PI;
    for (let i = 0; i < 8; i++) {
      pose.time = 0.4 + i / 30;
      pose.dt = 1 / 30;
      man.update(pose);
    }
    // Frame the part the item is on (arms left out: they flail and would zoom it out).
    const box = man.partBox(job.frame === 'hat' ? 'head' : job.frame);
    const size3 = box.getSize(new THREE.Vector3());
    const mid = box.getCenter(new THREE.Vector3());
    const pad = job.frame === 'body' ? 1.06 : job.frame === 'base' ? 1.25 : 1.3;
    const half = (Math.max(size3.y, size3.x * 0.9) / 2) * pad;
    const cam = this.thumbCam;
    const dist = half / Math.tan((cam.fov * Math.PI) / 360);
    // Bases are seen a little from above; everything else straight on.
    const tilt = job.frame === 'base' ? 0.45 : 0.06;
    cam.position.set(mid.x, mid.y + dist * tilt, mid.z + size3.z / 2 + dist);
    cam.lookAt(mid.x, mid.y, mid.z);
    cam.aspect = 1;
    cam.updateProjectionMatrix();
    // Drawn in the bottom-left corner, copied out, then the preview frame covers it.
    const r = this.renderer;
    const pr = r.getPixelRatio();
    const size = Math.min(THUMB_PX, this.canvas.width, this.canvas.height);
    r.setScissorTest(true);
    r.setViewport(0, 0, size / pr, size / pr);
    r.setScissor(0, 0, size / pr, size / pr);
    r.setClearColor(0x000000, 0);
    r.clear();
    r.render(this.thumbScene, cam);
    const out = document.createElement('canvas');
    out.width = out.height = size;
    out.getContext('2d')?.drawImage(this.canvas, 0, this.canvas.height - size, size, size, 0, 0, size, size);
    r.setScissorTest(false);
    r.setViewport(0, 0, this.canvas.width / pr, this.canvas.height / pr);
    const url = out.toDataURL('image/png');
    thumbCache.set(job.key, url);
    job.done(url);
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
      const pr = this.renderer.getPixelRatio();
      if (this.canvas.width !== Math.round(w * pr) || this.canvas.height !== Math.round(h * pr)) {
        this.renderer.setSize(w, h, false);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
      }
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
      // Two thumbnails a frame at most, so opening a category never stalls the preview.
      for (let i = 0; i < 2 && this.thumbQueue.length; i++) this.drawThumb();
      this.renderer.render(this.scene, this.camera);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('pointerup', this.stopDrag);
    window.removeEventListener('pointercancel', this.stopDrag);
    this.man.dispose();
    this.thumbMan?.dispose();
    this.thumbQueue = [];
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
