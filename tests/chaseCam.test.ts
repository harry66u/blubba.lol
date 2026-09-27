import { describe, expect, it } from 'vitest';
import { CHASE, aimFromCamera, chaseCamera, rebaseMove } from '../src/client/game/chaseCam';
import { DEALERSHIP } from '../src/shared/maps/dealership';
import { lookDir } from '../src/shared/player';
import { World } from '../src/shared/world';

// A floor (top at y = 0) and a tall wall whose face is at z = 3.
const world = new World({
  ...DEALERSHIP,
  solids: [
    { min: [-50, -2, -50], max: [50, 0, 50], kind: 'lot' },
    { min: [-50, 0, 3], max: [50, 10, 5], kind: 'building' },
  ],
});
const noPlayers = () => null;

describe('third-person camera', () => {
  it('sits behind and above the eye in open space', () => {
    const eye = { x: 0, y: 1.6, z: -10 };
    const out = { x: 0, y: 0, z: 0 };
    // yaw 0 looks toward -Z, so "behind" is +Z.
    const d = chaseCamera(world, eye, 0, 0, 1, out);
    expect(d).toBeCloseTo(CHASE.back, 5);
    expect(out.z).toBeGreaterThan(eye.z + 3);
    expect(out.y).toBeGreaterThan(eye.y);
    expect(out.x).toBeGreaterThan(eye.x); // over the right shoulder
  });

  it('pulls in instead of clipping through a wall behind you', () => {
    const eye = { x: 0, y: 1.6, z: 1.5 };
    const out = { x: 0, y: 0, z: 0 };
    const d = chaseCamera(world, eye, 0, 0, 1, out);
    expect(d).toBeLessThan(CHASE.back);
    expect(out.z).toBeLessThan(3);
    expect(out.z).toBeGreaterThan(eye.z);
  });

  it('never goes under the floor when looking up', () => {
    const eye = { x: 0, y: 1.6, z: -10 };
    const out = { x: 0, y: 0, z: 0 };
    chaseCamera(world, eye, 0, 1.4, 1, out);
    expect(out.y).toBeGreaterThan(0.5);
    // Still behind you, so you see your character from below-behind rather than from the floor.
    expect(out.z).toBeGreaterThan(eye.z + 2);
  });

  it('eases back out no faster than asked', () => {
    const eye = { x: 0, y: 1.6, z: -10 };
    const out = { x: 0, y: 0, z: 0 };
    expect(chaseCamera(world, eye, 0, 0, 1, out, 1.2)).toBeCloseTo(1.2, 5);
  });

  it('aims from the eye at whatever sits under the reticle', () => {
    const eye = { x: 0, y: 1.6, z: -10 };
    const cam = { x: 0, y: 0, z: 0 };
    chaseCamera(world, eye, Math.PI, 0, 1, cam); // facing +Z, toward the wall 13 m away
    const out = { yaw: 0, pitch: 0 };
    aimFromCamera(world, cam, Math.PI, 0, eye, noPlayers, out);
    // Follow the eye's corrected aim: it must land on the same wall point as the camera ray.
    const f = lookDir(out.yaw, out.pitch, { x: 0, y: 0, z: 0 });
    const tEye = (3 - eye.z) / f.z;
    const hitEye = { x: eye.x + f.x * tEye, y: eye.y + f.y * tEye };
    const c = lookDir(Math.PI, 0, { x: 0, y: 0, z: 0 });
    const tCam = (3 - cam.z) / c.z;
    const hitCam = { x: cam.x + c.x * tCam, y: cam.y + c.y * tCam };
    expect(Math.abs(hitEye.x - hitCam.x)).toBeLessThan(0.01);
    expect(Math.abs(hitEye.y - hitCam.y)).toBeLessThan(0.01);
  });

  it('aims at a player under the reticle rather than the wall behind them', () => {
    const eye = { x: 0, y: 1.6, z: -10 };
    const cam = { x: 0, y: 0, z: 0 };
    chaseCamera(world, eye, Math.PI, 0, 1, cam);
    const out = { yaw: 0, pitch: 0 };
    aimFromCamera(world, cam, Math.PI, 0, eye, () => 4, out);
    const far = { yaw: 0, pitch: 0 };
    aimFromCamera(world, cam, Math.PI, 0, eye, noPlayers, far);
    // A nearer target needs a bigger correction toward the camera's shoulder offset.
    expect(Math.abs(out.yaw - Math.PI)).toBeGreaterThan(Math.abs(far.yaw - Math.PI) - 1e-9);
  });

  it('movement keeps its world direction when the aim yaw is corrected', () => {
    const from = 0.3;
    const to = 0.45;
    const [mx, mz] = rebaseMove(0.6, 0.8, from, to);
    const world = (x: number, z: number, yaw: number) => [Math.cos(yaw) * x - Math.sin(yaw) * z, -Math.sin(yaw) * x - Math.cos(yaw) * z];
    const a = world(0.6, 0.8, from);
    const b = world(mx, mz, to);
    expect(b[0]).toBeCloseTo(a[0], 6);
    expect(b[1]).toBeCloseTo(a[1], 6);
  });
});
