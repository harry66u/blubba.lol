import * as THREE from 'three';
import type { PartId, PartsInput, WeaponId } from '../../shared/loadout';
import { normalizeParts } from '../../shared/loadout';

/** A weapon mesh that can show its charge. Forward is -Z; the muzzle marks where shots leave. */
export interface WeaponModel {
  root: THREE.Group;
  muzzle: THREE.Object3D;
  setCharge(charge: number, time: number, active: boolean): void;
  setColor(hex: number): void;
  dispose(): void;
  /** Materials a weapon finish repaints; 'player' means it normally wears the player's color. */
  paint: { mat: THREE.MeshStandardMaterial; base: number | 'player' }[];
}

/**
 * How the weapon parts change the model: barrels stretch or shrink the barrel, tanks scale the
 * tank, nozzles flare or narrow the muzzle, and valves / grips / the pump nozzle add small pieces.
 */
interface Look {
  barrel: number;
  bore: number;
  tank: number;
  nozzle: number;
  pump: boolean;
  valve: PartId;
  grip: PartId;
}

function partLook(parts: PartsInput): Look {
  const p = normalizeParts(parts);
  return {
    barrel: p.barrel === 'longBarrel' ? 1.38 : p.barrel === 'stubbyBarrel' ? 0.66 : 1,
    bore: p.barrel === 'longBarrel' ? 0.85 : p.barrel === 'stubbyBarrel' ? 1.22 : 1,
    tank: p.tank === 'bigTank' ? 1.34 : p.tank === 'miniTank' ? 0.7 : 1,
    nozzle: p.nozzle === 'wideNozzle' ? 1.5 : p.nozzle === 'jetNozzle' ? 0.62 : 1,
    pump: p.nozzle === 'pumpNozzle',
    valve: p.valve,
    grip: p.grip,
  };
}

const metal = () => new THREE.MeshStandardMaterial({ color: 0xcfd6e6, roughness: 0.25, metalness: 0.7 });
const dark = () => new THREE.MeshStandardMaterial({ color: 0x2b2d3a, roughness: 0.6 });
const yellow = () => new THREE.MeshStandardMaterial({ color: 0xffd60a, roughness: 0.35 });
const glow = () => new THREE.MeshStandardMaterial({ color: 0xbff4ff, emissive: 0x7fe7ff, emissiveIntensity: 0.3, roughness: 0.2, transparent: true, opacity: 0.85 });
const plastic = (color: number) => new THREE.MeshStandardMaterial({ color, roughness: 0.35 });

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, pos?: [number, number, number], rot?: [number, number, number]): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  if (pos) m.position.set(...pos);
  if (rot) m.rotation.set(...rot);
  m.castShadow = true;
  return m;
}

/** A cylinder lying along Z from z0 to z1 (z1 < z0 is forward). */
function tube(r0: number, r1: number, z0: number, z1: number, mat: THREE.Material, y = 0, x = 0, seg = 16, open = false): THREE.Mesh {
  const len = Math.abs(z1 - z0);
  // CylinderGeometry's top (r0) points +Y; rotating by -PI/2 about X points it toward -Z.
  return mesh(new THREE.CylinderGeometry(r1, r0, len, seg, 1, open), mat, [x, y, (z0 + z1) / 2], [-Math.PI / 2, 0, 0]);
}

interface Anchors {
  /** Side of the body for the valve (x > 0 is the right side). */
  side: [number, number, number];
  /** Under the body, just in front of the hand, for a grip. */
  under: [number, number, number];
  /** Rear end of the body, for a stock. */
  back: [number, number, number];
  /** Just behind the muzzle, for the pump nozzle's bulb. */
  tip: [number, number, number];
  /** Radius of the barrel at the tip. */
  tipR: number;
}

/**
 * Valve, grip and pump-nozzle pieces every weapon can carry. Returns the moving pieces so
 * setCharge can animate them.
 */
function addExtras(root: THREE.Group, L: Look, a: Anchors, accent: THREE.MeshStandardMaterial): { valve: THREE.Object3D | null; bulb: THREE.Object3D | null; spring: THREE.Object3D | null } {
  let valve: THREE.Object3D | null = null;
  let bulb: THREE.Object3D | null = null;
  let spring: THREE.Object3D | null = null;
  const [sx, sy, sz] = a.side;
  switch (L.valve) {
    case 'chargeValve': {
      // A big red hand wheel.
      const g = new THREE.Group();
      const red = plastic(0xff3b5c);
      g.add(mesh(new THREE.TorusGeometry(0.06, 0.014, 8, 20), red), mesh(new THREE.BoxGeometry(0.11, 0.014, 0.014), red), mesh(new THREE.BoxGeometry(0.014, 0.11, 0.014), red));
      g.add(mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.05, 8), metal(), [0, 0, -0.02], [Math.PI / 2, 0, 0]));
      g.position.set(sx + 0.035, sy, sz);
      g.rotation.y = Math.PI / 2;
      root.add(g);
      valve = g;
      break;
    }
    case 'quickValve': {
      // A green flip lever.
      const g = new THREE.Group();
      g.add(mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.03, 10), metal(), [0, 0, 0], [0, 0, Math.PI / 2]));
      g.add(mesh(new THREE.BoxGeometry(0.02, 0.1, 0.022), plastic(0x5ee05e), [0.01, 0.045, 0]));
      g.position.set(sx + 0.015, sy, sz);
      g.rotation.z = -0.5;
      root.add(g);
      valve = g;
      break;
    }
    case 'hairTrigger': {
      // A thin yellow trigger with a coil spring.
      const g = new THREE.Group();
      g.add(mesh(new THREE.TorusGeometry(0.03, 0.006, 6, 14, Math.PI * 1.2), yellow(), [0, 0, 0], [0, Math.PI / 2, 0]));
      const coil = mesh(new THREE.TorusGeometry(0.014, 0.004, 5, 10), metal(), [0, 0.02, 0.03], [Math.PI / 2, 0, 0]);
      coil.scale.z = 3;
      g.add(coil);
      g.position.set(0, a.under[1] + 0.02, a.under[2] - 0.08);
      root.add(g);
      valve = g;
      break;
    }
    default:
      // A small grey valve knob.
      root.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.025, 10), metal(), [sx + 0.012, sy, sz], [0, 0, Math.PI / 2]));
  }
  const [ux, uy, uz] = a.under;
  const [bx, by, bz] = a.back;
  switch (L.grip) {
    case 'sprintGrip': {
      // A slim foregrip wrapped in grippy tape.
      const tape = new THREE.MeshStandardMaterial({ color: 0x2ec5ff, roughness: 0.8 });
      const g = mesh(new THREE.CylinderGeometry(0.026, 0.022, 0.13, 10), tape, [ux, uy - 0.07, uz - 0.14]);
      for (let i = 0; i < 3; i++) g.add(mesh(new THREE.TorusGeometry(0.027, 0.005, 5, 12), dark(), [0, -0.045 + i * 0.045, 0], [Math.PI / 2, 0, 0]));
      root.add(g);
      break;
    }
    case 'anchorStock': {
      // A heavy padded stock.
      root.add(mesh(new THREE.BoxGeometry(0.08, 0.13, 0.2), accent, [bx, by - 0.02, bz + 0.1]));
      root.add(mesh(new THREE.BoxGeometry(0.09, 0.15, 0.04), dark(), [bx, by - 0.02, bz + 0.21]));
      break;
    }
    case 'kickStock': {
      // A spring stock: the shot shoves you back.
      const g = new THREE.Group();
      const coil = mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.16, 12, 8, true), new THREE.MeshStandardMaterial({ color: 0xcfd6e6, roughness: 0.3, metalness: 0.6, wireframe: true }), [0, 0, 0.08], [Math.PI / 2, 0, 0]);
      g.add(coil, mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.03, 16), plastic(0xff8a1f), [0, 0, 0.17], [Math.PI / 2, 0, 0]));
      g.position.set(bx, by, bz);
      root.add(g);
      spring = g;
      break;
    }
  }
  if (L.pump) {
    // Pump nozzle: a squeeze bulb clamped behind the muzzle.
    const g = new THREE.Group();
    const b = mesh(new THREE.SphereGeometry(0.05, 14, 10), plastic(0xff5fd2), [0, a.tipR + 0.05, 0]);
    b.scale.set(1, 0.8, 1.3);
    g.add(b, mesh(new THREE.TorusGeometry(a.tipR + 0.008, 0.01, 6, 16), metal()));
    g.position.set(...a.tip);
    root.add(g);
    bulb = b;
  }
  return { valve, bulb, spring };
}

/** Shared charge animation for the add-ons. */
function animateExtras(x: { valve: THREE.Object3D | null; bulb: THREE.Object3D | null; spring: THREE.Object3D | null }, L: Look, c: number): void {
  if (x.valve && L.valve === 'chargeValve') x.valve.rotation.x = c * 3;
  if (x.bulb) x.bulb.scale.set(1 + c * 0.35, 0.8 + c * 0.3, 1.3 + c * 0.35);
  if (x.spring) x.spring.scale.z = 1 - c * 0.35;
}

function airCannon(color: number, L: Look): WeaponModel {
  const root = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color, roughness: 0.3 });
  const g = glow();
  const tip = -0.61 * L.barrel;
  const tank = mesh(new THREE.SphereGeometry(0.14, 20, 14), g, [0, 0.13 + (L.tank - 1) * 0.1, -0.12]);
  tank.scale.set(L.tank, 0.85 * L.tank, 1.35 * L.tank);
  const bellMat = yellow();
  bellMat.side = THREE.DoubleSide;
  const bell = tube(0.08 * L.bore, 0.13 * L.nozzle, tip + 0.02, tip - 0.12, bellMat, 0, 0, 20, true);
  const ring = mesh(new THREE.TorusGeometry(0.13 * L.nozzle, 0.02, 8, 24), g, [0, 0, tip - 0.12]);
  root.add(
    tube(0.09 * L.bore, 0.075 * L.bore, 0.01, tip, body, 0, 0, 18),
    bell,
    ring,
    tank,
    mesh(new THREE.BoxGeometry(0.07, 0.2, 0.09), metal(), [0, -0.12, 0.02], [0.3, 0, 0]),
    mesh(new THREE.TorusGeometry(0.1, 0.018, 8, 16, Math.PI), metal(), [-0.06, 0.05, 0.02], [0, Math.PI / 2, 0]),
  );
  const extras = addExtras(root, L, { side: [0.09 * L.bore, 0, -0.3], under: [0, -0.08, 0], back: [0, 0, 0.02], tip: [0, 0, tip + 0.06], tipR: 0.075 * L.bore }, body);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0, tip - 0.14);
  root.add(muzzle);
  return {
    root,
    muzzle,
    setCharge(c) {
      const k = 1 + c * 0.35;
      tank.scale.set(k * L.tank, 0.85 * k * L.tank, 1.35 * k * L.tank);
      g.emissiveIntensity = 0.15 + c * 0.9;
      animateExtras(extras, L, c);
    },
    setColor(hex) {
      body.color.set(hex);
    },
    dispose() {},
    paint: [{ mat: body, base: 'player' }],
  };
}

function leafBlower(color: number, L: Look): WeaponModel {
  const root = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: 0xff8a1f, roughness: 0.4 });
  const accent = new THREE.MeshStandardMaterial({ color, roughness: 0.35 });
  const engine = mesh(new THREE.BoxGeometry(0.26, 0.24, 0.3), body, [0, 0.02, 0.05]);
  engine.scale.setScalar(L.tank);
  const cap = mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.05, 16), accent, [0.14 * L.tank, 0.02, 0.05], [0, 0, Math.PI / 2]);
  const fan = mesh(new THREE.BoxGeometry(0.02, 0.16, 0.03), metal(), [0.17 * L.tank, 0.02, 0.05]);
  const tip = -0.69 * L.barrel;
  const tubeM = tube(0.065 * L.bore, 0.055 * L.bore, -0.08, tip, dark(), -0.02, 0, 14);
  accent.side = THREE.DoubleSide;
  const nozzle = tube(0.055 * L.bore, 0.09 * L.nozzle, tip + 0.02, tip - 0.1, accent, -0.02, 0, 14, true);
  const handle = mesh(new THREE.TorusGeometry(0.08, 0.018, 8, 16, Math.PI), dark(), [0, 0.15 + (L.tank - 1) * 0.12, 0.05], [0, Math.PI / 2, 0]);
  root.add(engine, cap, fan, tubeM, nozzle, handle);
  const extras = addExtras(root, L, { side: [0.06 * L.bore, -0.02, -0.3], under: [0, -0.1, 0.02], back: [0, 0.02, 0.2 * L.tank], tip: [0, -0.02, tip + 0.06], tipR: 0.055 * L.bore }, accent);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, -0.02, tip - 0.1);
  root.add(muzzle);
  let spin = 0;
  return {
    root,
    muzzle,
    setCharge(c, t, active) {
      spin += active ? 0.6 + c * 1.2 : 0.02;
      fan.rotation.x = spin;
      engine.position.x = active ? Math.sin(t * 90) * 0.004 : 0;
      animateExtras(extras, L, active ? c : 0);
    },
    setColor(hex) {
      accent.color.set(hex);
    },
    dispose() {},
    paint: [
      { mat: accent, base: 'player' },
      { mat: body, base: 0xff8a1f },
    ],
  };
}

function airHorn(color: number, L: Look): WeaponModel {
  const root = new THREE.Group();
  const can = new THREE.MeshStandardMaterial({ color: 0xff3b5c, roughness: 0.3, metalness: 0.2 });
  const accent = new THREE.MeshStandardMaterial({ color, roughness: 0.35 });
  const canister = mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.3, 18), can, [0, 0, 0.02], [Math.PI / 2, 0, 0]);
  canister.scale.set(L.tank, 1 + (L.tank - 1) * 0.6, L.tank);
  const neckEnd = -0.25 * L.barrel;
  const neck = tube(0.05 * L.bore, 0.035 * L.bore, -0.11, neckEnd, metal(), 0, 0, 12);
  const hornMat = yellow();
  hornMat.side = THREE.DoubleSide;
  const horn = tube(0.04 * L.bore, 0.2 * L.nozzle, neckEnd + 0.01, neckEnd - 0.36, hornMat, 0, 0, 22, true);
  const button = mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.05, 12), accent, [0, 0.12, 0.05]);
  const band = mesh(new THREE.TorusGeometry(0.102, 0.012, 6, 20), accent, [0, 0, 0.1]);
  band.scale.setScalar(L.tank);
  root.add(canister, neck, horn, button, band);
  const extras = addExtras(root, L, { side: [0.1 * L.tank, 0, 0.02], under: [0, -0.1 * L.tank, 0.05], back: [0, 0, 0.17 + (L.tank - 1) * 0.1], tip: [0, 0, neckEnd + 0.05], tipR: 0.045 * L.bore }, accent);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0, neckEnd - 0.37);
  root.add(muzzle);
  return {
    root,
    muzzle,
    setCharge(c, t) {
      const k = 1 + c * 0.25;
      horn.scale.set(k, 1, k);
      canister.position.x = c > 0.9 ? Math.sin(t * 70) * 0.006 : 0;
      button.position.y = 0.12 - c * 0.02;
      animateExtras(extras, L, c);
    },
    setColor(hex) {
      accent.color.set(hex);
    },
    dispose() {},
    paint: [
      { mat: accent, base: 'player' },
      { mat: can, base: 0xff3b5c },
    ],
  };
}

function pumpRifle(color: number, L: Look): WeaponModel {
  const root = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color, roughness: 0.35 });
  const g = glow();
  const tip = -0.9 * L.barrel;
  const stock = mesh(new THREE.BoxGeometry(0.09, 0.14, 0.34), body, [0, -0.02, 0.12]);
  const barrel = tube(0.03 * L.bore, 0.026 * L.bore, 0, tip, metal(), 0.03, 0, 12);
  const pump = mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.16, 12), dark(), [0, -0.035, -0.32], [Math.PI / 2, 0, 0]);
  const scope = mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.22, 12), dark(), [0, 0.11, -0.05], [Math.PI / 2, 0, 0]);
  const lens = mesh(new THREE.CircleGeometry(0.03, 12), g, [0, 0.11, -0.161], [0, Math.PI, 0]);
  const tipRing = mesh(new THREE.TorusGeometry(0.035 * L.nozzle, 0.012, 6, 16), g, [0, 0.03, tip]);
  // Air canister under the stock (the tank part scales it).
  const canister = mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.2, 12), glow(), [0, -0.12, 0.1], [Math.PI / 2, 0, 0]);
  canister.scale.set(L.tank, L.tank, L.tank);
  root.add(stock, barrel, pump, scope, lens, tipRing, canister);
  const extras = addExtras(root, L, { side: [0.045, 0.0, 0.05], under: [0, -0.09, -0.05], back: [0, -0.02, 0.29], tip: [0, 0.03, tip + 0.08], tipR: 0.028 * L.bore }, body);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.03, tip - 0.02);
  root.add(muzzle);
  return {
    root,
    muzzle,
    setCharge(c) {
      pump.position.z = -0.32 + c * 0.12;
      g.emissiveIntensity = 0.2 + c * 1.2;
      animateExtras(extras, L, c);
    },
    setColor(hex) {
      body.color.set(hex);
    },
    dispose() {},
    paint: [{ mat: body, base: 'player' }],
  };
}

/** Iridescent soap film. */
function soap(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0xe8f7ff, emissive: 0xb88cff, emissiveIntensity: 0.25, roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.55 });
}

function bubbleShotgun(color: number, L: Look): WeaponModel {
  const root = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color, roughness: 0.3 });
  const pink = plastic(0xff8fd8);
  const film = soap();
  const tip = -0.5 * L.barrel;
  // Chunky body with a rounded nose.
  const shell = mesh(new THREE.BoxGeometry(0.15, 0.15, 0.3), body, [0, 0, 0]);
  const nose = mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.15, 16), body, [0, 0, -0.14], [0, 0, Math.PI / 2]);
  // Twin barrels.
  const r = 0.035 * L.bore;
  const b1 = tube(r, r * 0.9, -0.12, tip, metal(), 0.02, -0.04, 12);
  const b2 = tube(r, r * 0.9, -0.12, tip, metal(), 0.02, 0.04, 12);
  // Bubble wand ring at the muzzle (the nozzle part sizes it).
  const wandMat = new THREE.MeshStandardMaterial({ color: 0x2ec5ff, emissive: 0x2ec5ff, emissiveIntensity: 0.2, roughness: 0.3 });
  const wand = mesh(new THREE.TorusGeometry(0.085 * L.nozzle, 0.016, 8, 28), wandMat, [0, 0.02, tip - 0.02]);
  const filmDisc = mesh(new THREE.CircleGeometry(0.08 * L.nozzle, 24), film, [0, 0.02, tip - 0.021]);
  // Pump slide under the barrels.
  const pump = tube(0.042, 0.042, -0.18, -0.34, pink, -0.05, 0, 12);
  // Soap tank on top (the tank part sizes it) with bubbles floating inside.
  const tank = new THREE.Group();
  tank.position.set(0, 0.13 + (L.tank - 1) * 0.08, 0.02);
  tank.scale.setScalar(L.tank);
  tank.add(mesh(new THREE.SphereGeometry(0.075, 18, 14), film), mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.05, 12), pink, [0, -0.07, 0]));
  const inner: THREE.Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const m = mesh(new THREE.SphereGeometry(0.018 + i * 0.006, 10, 8), film, [(i - 1) * 0.025, 0, 0]);
    inner.push(m);
    tank.add(m);
  }
  const grip = mesh(new THREE.BoxGeometry(0.06, 0.16, 0.08), dark(), [0, -0.13, 0.08], [0.3, 0, 0]);
  root.add(shell, nose, b1, b2, wand, filmDisc, pump, tank, grip);
  const extras = addExtras(root, L, { side: [0.075, 0.0, 0.0], under: [0, -0.08, -0.02], back: [0, 0, 0.15], tip: [0, 0.02, tip + 0.1], tipR: 0.075 }, body);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.02, tip - 0.06);
  root.add(muzzle);
  return {
    root,
    muzzle,
    setCharge(c, t) {
      pump.position.z = -0.26 + c * 0.1;
      wandMat.emissiveIntensity = 0.2 + c * 0.9;
      filmDisc.scale.setScalar(1 - c * 0.35);
      inner.forEach((m, i) => (m.position.y = Math.sin(t * 3 + i * 2) * 0.03));
      animateExtras(extras, L, c);
    },
    setColor(hex) {
      body.color.set(hex);
    },
    dispose() {},
    paint: [
      { mat: body, base: 'player' },
      { mat: pink, base: 0xff8fd8 },
    ],
  };
}

function balloonMortar(color: number, L: Look): WeaponModel {
  const root = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color, roughness: 0.3 });
  const rim = yellow();
  const tip = -0.46 * L.barrel;
  const R = 0.11 * L.bore;
  // Wide launch tube.
  const tubeMat = body;
  const launcher = tube(R * 0.95, R, 0.1, tip, tubeMat, 0.02, 0, 22);
  const inside = tube(R * 0.8, R * 0.85, tip + 0.06, tip - 0.001, dark(), 0.02, 0, 22, true);
  (inside.material as THREE.MeshStandardMaterial).side = THREE.BackSide;
  const lip = mesh(new THREE.TorusGeometry(R * L.nozzle, 0.022, 8, 26), rim, [0, 0.02, tip]);
  const lipCone = tube(R, R * L.nozzle, tip + 0.04, tip, rim, 0.02, 0, 22, true);
  (lipCone.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
  // A water balloon peeking out; it swells as you charge.
  const balloonMat = new THREE.MeshStandardMaterial({ color: 0x3ab8ff, roughness: 0.15, metalness: 0.05, transparent: true, opacity: 0.9, emissive: 0x1060a0, emissiveIntensity: 0.15 });
  const balloon = mesh(new THREE.SphereGeometry(0.085, 18, 14), balloonMat, [0, 0.02, tip + 0.02]);
  balloon.scale.set(1, 1, 1.2);
  // Air bladder under the tube (the tank part sizes it) and a hand pump.
  const bladder = mesh(new THREE.SphereGeometry(0.08, 16, 12), plastic(0x8ee000), [0, -0.1 - (L.tank - 1) * 0.04, -0.05]);
  bladder.scale.set(L.tank, 0.75 * L.tank, 1.3 * L.tank);
  const pumpRod = mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.16, 8), metal(), [0.1, 0.09, 0.02]);
  const pumpHandle = mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.1, 8), dark(), [0.1, 0.17, 0.02], [Math.PI / 2, 0, 0]);
  const pumpBody = mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.14, 12), rim, [0.1, 0.02, 0.02]);
  const grip = mesh(new THREE.BoxGeometry(0.06, 0.15, 0.08), dark(), [0, -0.13, 0.08], [0.3, 0, 0]);
  const band1 = mesh(new THREE.TorusGeometry(R + 0.004, 0.012, 6, 22), dark(), [0, 0.02, 0.0]);
  root.add(launcher, inside, lip, lipCone, balloon, bladder, pumpRod, pumpHandle, pumpBody, grip, band1);
  const extras = addExtras(root, L, { side: [R, 0.02, -0.2], under: [0, -0.08, 0.0], back: [0, 0.02, 0.1], tip: [0, 0.02, tip + 0.08], tipR: R }, body);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.02, tip - 0.08);
  root.add(muzzle);
  return {
    root,
    muzzle,
    setCharge(c, t) {
      const k = 0.7 + c * 0.55;
      balloon.scale.set(k, k, k * 1.2);
      balloon.position.z = tip + 0.03 - c * 0.05;
      const pumpY = c > 0 && c < 1 ? Math.abs(Math.sin(t * 9)) * 0.05 : 0;
      pumpRod.position.y = 0.09 - pumpY;
      pumpHandle.position.y = 0.17 - pumpY;
      animateExtras(extras, L, c);
    },
    setColor(hex) {
      body.color.set(hex);
    },
    dispose() {},
    paint: [
      { mat: body, base: 'player' },
      { mat: rim, base: 0xffd60a },
    ],
  };
}

function popGun(color: number, L: Look): WeaponModel {
  const root = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color, roughness: 0.3 });
  const tan = plastic(0xd9a066);
  const tip = -0.46 * L.barrel;
  const shell = mesh(new THREE.BoxGeometry(0.12, 0.13, 0.3), body, [0, 0, 0]);
  const top = mesh(new THREE.BoxGeometry(0.06, 0.03, 0.22), dark(), [0, 0.08, 0.0]);
  // Three spinning barrels, each with a cork in the end (the nozzle part sizes the corks).
  const spinner = new THREE.Group();
  spinner.position.set(0, 0.01, 0);
  const r = 0.024 * L.bore;
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const x = Math.cos(a) * 0.035;
    const y = Math.sin(a) * 0.035;
    spinner.add(tube(r, r, -0.12, tip, metal(), y, x, 10));
    spinner.add(tube(r * 0.95 * L.nozzle, r * 1.15 * L.nozzle, tip + 0.005, tip - 0.035, tan, y, x, 10));
  }
  spinner.add(mesh(new THREE.TorusGeometry(0.06, 0.012, 6, 18), dark(), [0, 0, tip + 0.06]));
  // Drum magazine (the tank part sizes it).
  const drum = mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.06, 20), yellow(), [0, -0.12, -0.05], [0, 0, Math.PI / 2]);
  drum.scale.set(L.tank, L.tank, L.tank);
  const drumCap = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.066, 12), body, [0, -0.12, -0.05], [0, 0, Math.PI / 2]);
  drumCap.scale.set(L.tank, L.tank, L.tank);
  const grip = mesh(new THREE.BoxGeometry(0.05, 0.14, 0.07), dark(), [0, -0.12, 0.11], [0.25, 0, 0]);
  root.add(shell, top, spinner, drum, drumCap, grip);
  const extras = addExtras(root, L, { side: [0.06, 0.02, 0.02], under: [0, -0.07, -0.02], back: [0, 0, 0.15], tip: [0, 0.01, tip + 0.08], tipR: 0.065 }, body);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.01, tip - 0.05);
  root.add(muzzle);
  let spin = 0;
  return {
    root,
    muzzle,
    setCharge(c, _t, active) {
      spin += (active || c > 0.05 ? 0.1 + c * 0.6 : 0) * 1;
      spinner.rotation.z = spin;
      animateExtras(extras, L, c);
    },
    setColor(hex) {
      body.color.set(hex);
    },
    dispose() {},
    paint: [
      { mat: body, base: 'player' },
      { mat: tan, base: 0xd9a066 },
    ],
  };
}

/** Sky Rocket: a shoulder tube with a red-nosed rocket peeking out and fins at the back. */
function skyRocket(color: number, L: Look): WeaponModel {
  const root = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color, roughness: 0.3 });
  const red = plastic(0xff3b5c);
  const tip = -0.55 * L.barrel;
  const R = 0.085 * L.bore;
  // The launch tube, open at the front, with a dark inside.
  const launcher = tube(R, R, 0.22, tip, body, 0.02, 0, 20);
  const inside = tube(R * 0.82, R * 0.82, tip + 0.08, tip - 0.001, dark(), 0.02, 0, 20, true);
  (inside.material as THREE.MeshStandardMaterial).side = THREE.BackSide;
  const lip = mesh(new THREE.TorusGeometry(R * L.nozzle, 0.018, 8, 22), yellow(), [0, 0.02, tip]);
  const band = mesh(new THREE.TorusGeometry(R + 0.004, 0.014, 6, 20), red, [0, 0.02, 0.05]);
  // The rocket's nose in the mouth of the tube (it slides forward as you charge).
  const nose = mesh(new THREE.ConeGeometry(R * 0.72, 0.12, 14), red, [0, 0.02, tip + 0.03], [-Math.PI / 2, 0, 0]);
  // Fins and a flared exhaust at the back.
  const exhaust = tube(R * 0.9, R * 1.25, 0.22, 0.3, dark(), 0.02, 0, 20, true);
  (exhaust.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
  const fins: THREE.Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const f = mesh(new THREE.BoxGeometry(0.012, 0.07, 0.1), red, [0, 0.02, 0.24]);
    const a = (i / 3) * Math.PI * 2 + Math.PI / 2;
    f.position.x = Math.cos(a) * (R + 0.03);
    f.position.y = 0.02 + Math.sin(a) * (R + 0.03);
    f.rotation.z = a - Math.PI / 2;
    fins.push(f);
  }
  // A sight on top and a grip underneath; a fuel can for the tank part.
  const sight = mesh(new THREE.BoxGeometry(0.03, 0.05, 0.08), dark(), [0, 0.02 + R + 0.03, -0.1]);
  const can = mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.14, 14), glow(), [0, -0.1, -0.12], [Math.PI / 2, 0, 0]);
  can.scale.setScalar(L.tank);
  const grip = mesh(new THREE.BoxGeometry(0.06, 0.15, 0.08), dark(), [0, -0.12, 0.06], [0.3, 0, 0]);
  root.add(launcher, inside, lip, band, nose, exhaust, ...fins, sight, can, grip);
  const extras = addExtras(root, L, { side: [R, 0.02, -0.25], under: [0, -0.07, -0.05], back: [0, 0.02, 0.3], tip: [0, 0.02, tip + 0.08], tipR: R }, body);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.02, tip - 0.08);
  root.add(muzzle);
  const canMat = can.material as THREE.MeshStandardMaterial;
  return {
    root,
    muzzle,
    setCharge(c) {
      nose.position.z = tip + 0.03 - c * 0.05;
      canMat.emissiveIntensity = 0.2 + c * 1.1;
      animateExtras(extras, L, c);
    },
    setColor(hex) {
      body.color.set(hex);
    },
    dispose() {},
    paint: [
      { mat: body, base: 'player' },
      { mat: red, base: 0xff3b5c },
    ],
  };
}

/** Gust Repeater: a boxy auto air gun with a fan in a cage at the back and a finned barrel. */
function gustRepeater(color: number, L: Look): WeaponModel {
  const root = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color, roughness: 0.3 });
  const teal = plastic(0x2ec5ff);
  const tip = -0.62 * L.barrel;
  const shell = mesh(new THREE.BoxGeometry(0.13, 0.14, 0.34), body, [0, 0, 0.02]);
  const barrel = tube(0.035 * L.bore, 0.032 * L.bore, -0.15, tip, metal(), 0.02, 0, 14);
  // Cooling fins along the barrel.
  const finsG = new THREE.Group();
  for (let i = 0; i < 4; i++) finsG.add(mesh(new THREE.TorusGeometry(0.05 * L.bore, 0.01, 6, 16), dark(), [0, 0.02, -0.2 - i * 0.07 * L.barrel]));
  const tipRing = mesh(new THREE.TorusGeometry(0.045 * L.nozzle, 0.014, 6, 16), teal, [0, 0.02, tip]);
  // A fan in a cage at the back: it spins up as you fire.
  const cage = mesh(new THREE.TorusGeometry(0.085, 0.012, 6, 22), dark(), [0, 0.02, 0.2]);
  const fan = new THREE.Group();
  fan.position.set(0, 0.02, 0.2);
  for (let i = 0; i < 4; i++) {
    const blade = mesh(new THREE.BoxGeometry(0.02, 0.07, 0.008), teal, [0, 0.035, 0]);
    const arm = new THREE.Group();
    arm.rotation.z = (i / 4) * Math.PI * 2;
    blade.rotation.y = 0.5;
    arm.add(blade);
    fan.add(arm);
  }
  // Air magazine underneath (the tank part sizes it) and a grip.
  const mag = mesh(new THREE.BoxGeometry(0.06, 0.12, 0.1), glow(), [0, -0.12, -0.08]);
  mag.scale.set(L.tank, L.tank, L.tank);
  const grip = mesh(new THREE.BoxGeometry(0.05, 0.14, 0.07), dark(), [0, -0.12, 0.12], [0.25, 0, 0]);
  root.add(shell, barrel, finsG, tipRing, cage, fan, mag, grip);
  const extras = addExtras(root, L, { side: [0.065, 0.02, -0.02], under: [0, -0.07, -0.02], back: [0, 0, 0.19], tip: [0, 0.02, tip + 0.08], tipR: 0.035 * L.bore }, body);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.02, tip - 0.03);
  root.add(muzzle);
  const magMat = mag.material as THREE.MeshStandardMaterial;
  let spin = 0;
  return {
    root,
    muzzle,
    setCharge(c, _t, active) {
      spin += active || c > 0.05 ? 0.12 + c * 0.7 : 0.01;
      fan.rotation.z = spin;
      magMat.emissiveIntensity = 0.2 + c * 0.8;
      animateExtras(extras, L, c);
    },
    setColor(hex) {
      body.color.set(hex);
    },
    dispose() {},
    paint: [
      { mat: body, base: 'player' },
      { mat: teal, base: 0x2ec5ff },
    ],
  };
}

/** Wind Lance: a long, thin barrel wrapped in a spiral, ending in a narrow flared tip. */
function windLance(color: number, L: Look): WeaponModel {
  const root = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color, roughness: 0.3 });
  const g = glow();
  const gold = yellow();
  const tip = -0.85 * L.barrel;
  const housing = mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.24, 16), body, [0, 0, 0.02], [Math.PI / 2, 0, 0]);
  const lance = tube(0.03 * L.bore, 0.022 * L.bore, -0.1, tip, metal(), 0, 0, 14);
  // A spiral wrapped around the lance (the wind), which turns as you charge.
  const spiral = new THREE.Group();
  const len = Math.abs(tip + 0.1);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 4;
    const seg = mesh(new THREE.SphereGeometry(0.014, 8, 6), g, [Math.cos(a) * 0.045, Math.sin(a) * 0.045, -0.1 - (i / 9) * len]);
    spiral.add(seg);
  }
  const flare = tube(0.024 * L.bore, 0.06 * L.nozzle, tip + 0.02, tip - 0.05, gold, 0, 0, 16, true);
  (flare.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
  // An air bulb on top (the tank part sizes it) and a grip.
  const bulb = mesh(new THREE.SphereGeometry(0.075, 16, 12), g, [0, 0.1, 0.04]);
  bulb.scale.set(L.tank, 0.8 * L.tank, 1.2 * L.tank);
  const grip = mesh(new THREE.BoxGeometry(0.055, 0.15, 0.08), dark(), [0, -0.12, 0.08], [0.3, 0, 0]);
  root.add(housing, lance, spiral, flare, bulb, grip);
  const extras = addExtras(root, L, { side: [0.07, 0, -0.02], under: [0, -0.07, -0.02], back: [0, 0, 0.14], tip: [0, 0, tip + 0.1], tipR: 0.03 * L.bore }, body);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0, tip - 0.06);
  root.add(muzzle);
  return {
    root,
    muzzle,
    setCharge(c, t) {
      spiral.rotation.z = t * (1 + c * 8);
      g.emissiveIntensity = 0.2 + c * 1.2;
      const k = 1 + c * 0.25;
      bulb.scale.set(k * L.tank, 0.8 * k * L.tank, 1.2 * k * L.tank);
      animateExtras(extras, L, c);
    },
    setColor(hex) {
      body.color.set(hex);
    },
    dispose() {},
    paint: [
      { mat: body, base: 'player' },
      { mat: gold, base: 0xffd60a },
    ],
  };
}

/** Builds a weapon, shaped by its parts (barrel length, tank size, nozzle, valve and grip pieces). */
export function buildWeaponModel(id: WeaponId, color: number, parts: PartsInput = null): WeaponModel {
  const L = partLook(parts);
  let m: WeaponModel;
  switch (id) {
    case 'leafBlower':
      m = leafBlower(color, L);
      break;
    case 'airHorn':
      m = airHorn(color, L);
      break;
    case 'pumpRifle':
      m = pumpRifle(color, L);
      break;
    case 'bubbleShotgun':
      m = bubbleShotgun(color, L);
      break;
    case 'balloonMortar':
      m = balloonMortar(color, L);
      break;
    case 'popGun':
      m = popGun(color, L);
      break;
    case 'skyRocket':
      m = skyRocket(color, L);
      break;
    case 'gustRepeater':
      m = gustRepeater(color, L);
      break;
    case 'windLance':
      m = windLance(color, L);
      break;
    default:
      m = airCannon(color, L);
  }
  // Free the GPU copies of everything this model made when it's thrown away.
  const root = m.root;
  m.dispose = () => {
    root.traverse((o) => {
      const mm = o as THREE.Mesh;
      if (!mm.isMesh) return;
      mm.geometry.dispose();
      // (Finish textures are shared and cached, so they stay.)
      const mats = Array.isArray(mm.material) ? mm.material : [mm.material];
      for (const mat of mats) mat.dispose();
    });
  };
  return m;
}

/** A stable key for a weapon + parts combination (to know when a model must be rebuilt). */
export function weaponLookKey(id: WeaponId, parts: PartsInput): string {
  const p = normalizeParts(parts);
  return `${id}|${p.barrel}|${p.tank}|${p.valve}|${p.nozzle}|${p.grip}`;
}
