import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { MapTheme } from '../../shared/maps/types';

export type Quality = 'low' | 'medium' | 'high';

interface QualityProfile {
  maxPixelRatio: number;
  shadows: boolean;
  shadowSize: number;
  bloom: boolean;
  physical: boolean;
}

const PROFILES: Record<Quality, QualityProfile> = {
  low: { maxPixelRatio: 0.85, shadows: false, shadowSize: 512, bloom: false, physical: false },
  medium: { maxPixelRatio: 1.25, shadows: true, shadowSize: 1024, bloom: true, physical: false },
  high: { maxPixelRatio: 2, shadows: true, shadowSize: 2048, bloom: true, physical: true },
};

/**
 * Owns the WebGL renderer, scene, camera, lights, sky, and post-processing. Automatically lowers
 * the render resolution when frames get slow so the game holds 60 fps on a base M1 Air.
 */
export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private sky: THREE.Mesh;
  quality: Quality;
  profile: QualityProfile;
  /** Dynamic resolution scale (0.5..1) applied on top of the profile's pixel ratio. */
  renderScale = 1;
  private frameTimes: number[] = [];
  private lastAdjust = 0;
  baseFov = 80;

  constructor(
    readonly canvas: HTMLCanvasElement,
    quality: Quality,
  ) {
    this.quality = quality;
    this.profile = PROFILES[quality];
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: quality !== 'low',
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.camera = new THREE.PerspectiveCamera(this.baseFov, 1, 0.1, 900);
    this.camera.rotation.order = 'YXZ';

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.4;
    pmrem.dispose();

    this.hemi = new THREE.HemisphereLight(0xcfe8ff, 0x8a7fa5, 1.0);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff1d6, 2.1);
    this.sun.position.set(30, 60, 25);
    this.sun.target.position.set(0, 0, 0);
    const sc = this.sun.shadow.camera;
    sc.left = -48;
    sc.right = 48;
    sc.top = 48;
    sc.bottom = -48;
    sc.near = 10;
    sc.far = 160;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.sun.shadow.radius = 3;
    this.scene.add(this.sun, this.sun.target);

    this.sky = makeSky();
    this.scene.add(this.sky);

    this.applyQuality();
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  setTheme(theme: MapTheme): void {
    const mat = this.sky.material as THREE.ShaderMaterial;
    mat.uniforms.top.value.set(theme.skyTop);
    mat.uniforms.horizon.value.set(theme.skyHorizon);
    mat.uniforms.bottom.value.set(theme.skyBottom);
    this.scene.fog = new THREE.Fog(theme.fog, 120, 520);
    this.sun.color.set(theme.sun);
    this.hemi.color.set(theme.ambient);
  }

  setQuality(q: Quality): void {
    this.quality = q;
    this.profile = PROFILES[q];
    this.renderScale = 1;
    this.applyQuality();
    this.resize();
  }

  private applyQuality(): void {
    const p = this.profile;
    this.renderer.shadowMap.enabled = p.shadows;
    this.sun.castShadow = p.shadows;
    if (p.shadows) {
      this.sun.shadow.mapSize.set(p.shadowSize, p.shadowSize);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m) m.needsUpdate = true;
    });
    if (p.bloom) {
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.28, 0.45, 0.92);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
    } else {
      this.composer?.dispose();
      this.composer = null;
      this.bloom = null;
    }
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const pr = Math.min(window.devicePixelRatio || 1, this.profile.maxPixelRatio) * this.renderScale;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.composer) {
      this.composer.setPixelRatio(pr);
      this.composer.setSize(w, h);
      // Bloom at reduced resolution is plenty for a soft glow and much cheaper.
      this.bloom?.setSize(Math.round(w * pr * 0.5), Math.round(h * pr * 0.5));
    }
  }

  /** Tracks frame time and nudges the render scale to hold 60 fps. */
  trackFrame(dtMs: number, now: number): void {
    this.frameTimes.push(dtMs);
    if (this.frameTimes.length > 90) this.frameTimes.shift();
    if (now - this.lastAdjust < 1500 || this.frameTimes.length < 60) return;
    const sorted = [...this.frameTimes].sort((a, b) => a - b);
    const p75 = sorted[Math.floor(sorted.length * 0.75)];
    let changed = false;
    if (p75 > 18.5 && this.renderScale > 0.55) {
      this.renderScale = Math.max(0.55, this.renderScale - 0.1);
      changed = true;
    } else if (p75 < 15 && this.renderScale < 1) {
      this.renderScale = Math.min(1, this.renderScale + 0.05);
      changed = true;
    }
    if (changed) {
      this.lastAdjust = now;
      this.frameTimes.length = 0;
      this.resize();
    }
  }

  render(): void {
    this.sky.position.copy(this.camera.position);
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}

function makeSky(): THREE.Mesh {
  const geo = new THREE.SphereGeometry(800, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(0x4a9ff5) },
      horizon: { value: new THREE.Color(0xbfe6ff) },
      bottom: { value: new THREE.Color(0xf3f8ff) },
      sunDir: { value: new THREE.Vector3(30, 60, 25).normalize() },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 top;
      uniform vec3 horizon;
      uniform vec3 bottom;
      uniform vec3 sunDir;
      varying vec3 vDir;
      void main() {
        float h = vDir.y;
        vec3 col = h > 0.0 ? mix(horizon, top, pow(h, 0.6)) : mix(horizon, bottom, pow(-h, 0.5));
        float sun = max(dot(normalize(vDir), sunDir), 0.0);
        col += vec3(1.0, 0.95, 0.8) * (pow(sun, 400.0) * 1.5 + pow(sun, 12.0) * 0.18);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return mesh;
}
