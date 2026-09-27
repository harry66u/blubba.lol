import * as THREE from 'three';
import type { WeaponId } from '../../shared/loadout';

/** A weapon mesh that can show its charge. Forward is -Z; the muzzle marks where shots leave. */
export interface WeaponModel {
  root: THREE.Group;
  muzzle: THREE.Object3D;
  setCharge(charge: number, time: number, active: boolean): void;
  setColor(hex: number): void;
  dispose(): void;
}

const metal = () => new THREE.MeshStandardMaterial({ color: 0xcfd6e6, roughness: 0.25, metalness: 0.7 });
const dark = () => new THREE.MeshStandardMaterial({ color: 0x2b2d3a, roughness: 0.6 });
const yellow = () => new THREE.MeshStandardMaterial({ color: 0xffd60a, roughness: 0.35 });
const glow = () => new THREE.MeshStandardMaterial({ color: 0xbff4ff, emissive: 0x7fe7ff, emissiveIntensity: 0.3, roughness: 0.2, transparent: true, opacity: 0.85 });

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, pos?: [number, number, number], rot?: [number, number, number]): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  if (pos) m.position.set(...pos);
  if (rot) m.rotation.set(...rot);
  m.castShadow = true;
  return m;
}

function airCannon(color: number): WeaponModel {
  const root = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color, roughness: 0.3 });
  const g = glow();
  const tank = mesh(new THREE.SphereGeometry(0.14, 20, 14), g, [0, 0.13, -0.12]);
  tank.scale.set(1, 0.85, 1.35);
  const bell = mesh(new THREE.CylinderGeometry(0.13, 0.08, 0.14, 20, 1, true), yellow(), [0, 0, -0.66], [-Math.PI / 2, 0, 0]);
  (bell.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
  const ring = mesh(new THREE.TorusGeometry(0.13, 0.02, 8, 24), g, [0, 0, -0.73]);
  root.add(
    mesh(new THREE.CylinderGeometry(0.075, 0.09, 0.62, 18), body, [0, 0, -0.3], [Math.PI / 2, 0, 0]),
    bell,
    ring,
    tank,
    mesh(new THREE.BoxGeometry(0.07, 0.2, 0.09), metal(), [0, -0.12, 0.02], [0.3, 0, 0]),
    mesh(new THREE.TorusGeometry(0.1, 0.018, 8, 16, Math.PI), metal(), [-0.06, 0.05, 0.02], [0, Math.PI / 2, 0]),
  );
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0, -0.75);
  root.add(muzzle);
  return {
    root,
    muzzle,
    setCharge(c) {
      const k = 1 + c * 0.35;
      tank.scale.set(k, 0.85 * k, 1.35 * k);
      g.emissiveIntensity = 0.15 + c * 0.9;
    },
    setColor(hex) {
      body.color.set(hex);
    },
    dispose() {},
  };
}

function leafBlower(color: number): WeaponModel {
  const root = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: 0xff8a1f, roughness: 0.4 });
  const accent = new THREE.MeshStandardMaterial({ color, roughness: 0.35 });
  const engine = mesh(new THREE.BoxGeometry(0.26, 0.24, 0.3), body, [0, 0.02, 0.05]);
  const cap = mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.05, 16), accent, [0.14, 0.02, 0.05], [0, 0, Math.PI / 2]);
  const fan = mesh(new THREE.BoxGeometry(0.02, 0.16, 0.03), metal(), [0.17, 0.02, 0.05]);
  const tube = mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.62, 14), dark(), [0, -0.02, -0.38], [Math.PI / 2, 0, 0]);
  const nozzle = mesh(new THREE.CylinderGeometry(0.09, 0.055, 0.12, 14, 1, true), accent, [0, -0.02, -0.72], [-Math.PI / 2, 0, 0]);
  (nozzle.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
  const handle = mesh(new THREE.TorusGeometry(0.08, 0.018, 8, 16, Math.PI), dark(), [0, 0.15, 0.05], [0, Math.PI / 2, 0]);
  root.add(engine, cap, fan, tube, nozzle, handle);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, -0.02, -0.8);
  root.add(muzzle);
  let spin = 0;
  return {
    root,
    muzzle,
    setCharge(c, t, active) {
      spin += active ? 0.6 + c * 1.2 : 0.02;
      fan.rotation.x = spin;
      engine.position.x = active ? Math.sin(t * 90) * 0.004 : 0;
    },
    setColor(hex) {
      accent.color.set(hex);
    },
    dispose() {},
  };
}

function airHorn(color: number): WeaponModel {
  const root = new THREE.Group();
  const can = new THREE.MeshStandardMaterial({ color: 0xff3b5c, roughness: 0.3, metalness: 0.2 });
  const accent = new THREE.MeshStandardMaterial({ color, roughness: 0.35 });
  const canister = mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.3, 18), can, [0, 0, 0.02], [Math.PI / 2, 0, 0]);
  const neck = mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.14, 12), metal(), [0, 0, -0.18], [Math.PI / 2, 0, 0]);
  const hornMat = yellow();
  hornMat.side = THREE.DoubleSide;
  const horn = mesh(new THREE.CylinderGeometry(0.2, 0.04, 0.36, 22, 1, true), hornMat, [0, 0, -0.42], [-Math.PI / 2, 0, 0]);
  const button = mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.05, 12), accent, [0, 0.12, 0.05]);
  const band = mesh(new THREE.TorusGeometry(0.102, 0.012, 6, 20), accent, [0, 0, 0.1]);
  root.add(canister, neck, horn, button, band);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0, -0.62);
  root.add(muzzle);
  return {
    root,
    muzzle,
    setCharge(c, t) {
      const k = 1 + c * 0.25;
      horn.scale.set(k, 1, k);
      canister.position.x = c > 0.9 ? Math.sin(t * 70) * 0.006 : 0;
      button.position.y = 0.12 - c * 0.02;
    },
    setColor(hex) {
      accent.color.set(hex);
    },
    dispose() {},
  };
}

function pumpRifle(color: number): WeaponModel {
  const root = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color, roughness: 0.35 });
  const g = glow();
  const stock = mesh(new THREE.BoxGeometry(0.09, 0.14, 0.34), body, [0, -0.02, 0.12]);
  const barrel = mesh(new THREE.CylinderGeometry(0.026, 0.03, 0.9, 12), metal(), [0, 0.03, -0.45], [Math.PI / 2, 0, 0]);
  const pump = mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.16, 12), dark(), [0, -0.035, -0.32], [Math.PI / 2, 0, 0]);
  const scope = mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.22, 12), dark(), [0, 0.11, -0.05], [Math.PI / 2, 0, 0]);
  const lens = mesh(new THREE.CircleGeometry(0.03, 12), g, [0, 0.11, -0.161], [0, Math.PI, 0]);
  const tip = mesh(new THREE.TorusGeometry(0.035, 0.012, 6, 16), g, [0, 0.03, -0.9]);
  root.add(stock, barrel, pump, scope, lens, tip);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.03, -0.92);
  root.add(muzzle);
  return {
    root,
    muzzle,
    setCharge(c) {
      pump.position.z = -0.32 + c * 0.12;
      g.emissiveIntensity = 0.2 + c * 1.2;
    },
    setColor(hex) {
      body.color.set(hex);
    },
    dispose() {},
  };
}

export function buildWeaponModel(id: WeaponId, color: number): WeaponModel {
  switch (id) {
    case 'leafBlower':
      return leafBlower(color);
    case 'airHorn':
      return airHorn(color);
    case 'pumpRifle':
      return pumpRifle(color);
    default:
      return airCannon(color);
  }
}
