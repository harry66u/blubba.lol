import { BALANCE } from './balance';
import { BTN_FIRE, BTN_GRAB, type InputFrame, pressesSince } from './input';
import type { WeaponStats } from './loadout';
import { type Environment, NORMAL_ENV } from './game/chaos';
import type { World } from './world';

export type { WeaponStats } from './loadout';

/**
 * Complete simulation state of one player. Every field is a number so the whole state can be
 * copied, diffed, and serialized cheaply (the server sends it to its owner for reconciliation).
 */
export const PLAYER_FIELDS = [
  'px', 'py', 'pz', 'vx', 'vy', 'vz', 'yaw', 'pitch',
  'mode', 'onGround', 'groundId', 'jumpsUsed', 'coyote', 'airTime',
  'dashCharges', 'dashRecharge', 'dashCool', 'dashTimer', 'slideTimer',
  'launchTimer', 'launchElapsed', 'inflation', 'sinceHit',
  'braceTimer', 'braceCool',
  'hangId', 'hangX', 'hangY', 'hangZ', 'hangNx', 'hangNz', 'hangTimer', 'regrabCool', 'grabBuffer',
  'climbTimer', 'climbFromX', 'climbFromY', 'climbFromZ',
  'doubledTimer', 'grabCool', 'heldBy', 'holding', 'holdTimer', 'escapeUsed',
  'grappleCool', 'zipTimer', 'zipX', 'zipY', 'zipZ',
  'spawnProt', 'hoverTimer', 'hovering', 'pinTimer', 'blownTimer',
  'ammo', 'reloadTimer', 'fireCool', 'charge', 'charging',
  'u1Cool', 'u2Cool', 'u1Uses', 'u2Uses',
  'cJump', 'cDash', 'cBrace', 'cGrab', 'cGrapple', 'cReload', 'cU1', 'cU2', 'cTaunt',
  // Hit-stop: frozen for a moment on impact, then the stored knockback plays out.
  'hitStop', 'hsVx', 'hsVy', 'hsVz',
  // Streak rewards: Turbo Tank seconds left, Mega Blast shots left.
  'turboTimer', 'megaShots',
] as const;

export type PlayerField = (typeof PLAYER_FIELDS)[number];
export type PlayerState = Record<PlayerField, number>;

export const MODE_NORMAL = 0;
export const MODE_HANG = 1;
export const MODE_CLIMB = 2;
export const MODE_HELD = 3;
export const MODE_DEAD = 4;

export function createPlayerState(): PlayerState {
  const s = {} as PlayerState;
  for (const f of PLAYER_FIELDS) s[f] = 0;
  s.groundId = -1;
  s.hangId = -1;
  s.heldBy = -1;
  s.holding = -1;
  s.dashCharges = BALANCE.dash.charges;
  s.ammo = BALANCE.weapons.airCannon.ammo;
  s.hoverTimer = BALANCE.weapons.leafBlower.hoverTime;
  s.sinceHit = 999;
  return s;
}

export function copyPlayerState(dst: PlayerState, src: PlayerState): void {
  for (const f of PLAYER_FIELDS) dst[f] = src[f];
}

/** Scale of the avatar and its hitbox for a given inflation (0..1). */
export function inflationScale(inflation: number): number {
  return 1 + (BALANCE.inflation.scaleAtMax - 1) * inflation;
}

export function inflationMass(inflation: number): number {
  return 1 + (BALANCE.inflation.massAtMax - 1) * inflation;
}

export function playerRadius(p: PlayerState): number {
  return BALANCE.player.radius * inflationScale(p.inflation);
}

export function playerHeight(p: PlayerState): number {
  return BALANCE.player.height * inflationScale(p.inflation);
}

export function eyeHeight(p: PlayerState): number {
  return BALANCE.player.eyeHeight * inflationScale(p.inflation);
}

/** Unit look vector for a yaw/pitch pair (yaw 0 looks toward -Z, like a three.js camera). */
export function lookDir(yaw: number, pitch: number, out: { x: number; y: number; z: number }) {
  const cp = Math.cos(pitch);
  out.x = -Math.sin(yaw) * cp;
  out.y = Math.sin(pitch);
  out.z = -Math.cos(yaw) * cp;
  return out;
}

export interface ShotSpec {
  ox: number;
  oy: number;
  oz: number;
  dx: number;
  dy: number;
  dz: number;
  /** Final shot power 0..1 (tap power up to full charge). */
  power: number;
  charge: number;
  /** A Mega Blast shot (streak reward): full power, bigger and harder. */
  mega: boolean;
}

/** Everything notable that happened during one player step; used for effects and server logic. */
export class StepResult {
  jumped = false;
  doubleJumped = false;
  dashed = false;
  slid = false;
  techEscape = false;
  landed = 0;
  bounced = false;
  padBounce = -1;
  wallBounce = false;
  braced = false;
  ledgeGrab = false;
  climbed = false;
  reloadStart = false;
  grabIntent = false;
  throwIntent = false;
  escapeAttempt = false;
  grapple = false;
  util1 = false;
  util2 = false;
  taunt = false;
  fired: ShotSpec | null = null;
  /** Leaf Blower stream strength this step (0 = not blowing). */
  stream = 0;

  reset(): void {
    this.jumped = false;
    this.doubleJumped = false;
    this.dashed = false;
    this.slid = false;
    this.techEscape = false;
    this.landed = 0;
    this.bounced = false;
    this.padBounce = -1;
    this.wallBounce = false;
    this.braced = false;
    this.ledgeGrab = false;
    this.climbed = false;
    this.reloadStart = false;
    this.grabIntent = false;
    this.throwIntent = false;
    this.escapeAttempt = false;
    this.grapple = false;
    this.util1 = false;
    this.util2 = false;
    this.taunt = false;
    this.fired = null;
    this.stream = 0;
  }
}

export interface Features {
  brace: boolean;
  ledge: boolean;
  grab: boolean;
  grapple: boolean;
}

export const ALL_FEATURES: Features = { brace: true, ledge: true, grab: true, grapple: true };

export interface StepContext {
  world: World;
  dt: number;
  weapon: WeaponStats;
  /** Feature switches so earlier build phases can be played without later mechanics. */
  features: Features;
  /** Random-event modifiers (gravity, ice, wind). */
  env?: Environment;
}

const tmpSweep = { d: 0, hit: -1 };

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Advances one player by one fixed step. Shared by the server and client-side prediction. */
export function stepPlayer(p: PlayerState, inp: InputFrame, ctx: StepContext, out: StepResult): void {
  out.reset();
  const dt = ctx.dt;

  // Hit-stop: hold still for a beat after being hit, then launch. Button presses made during the
  // freeze aren't lost (their counters are read on the next real step).
  if (p.hitStop > 0 && p.mode !== MODE_DEAD) {
    p.yaw = inp.yaw;
    p.pitch = clamp(inp.pitch, -1.55, 1.55);
    p.hitStop -= dt;
    if (p.hitStop <= 1e-6) {
      p.hitStop = 0;
      p.vx += p.hsVx;
      p.vy += p.hsVy;
      p.vz += p.hsVz;
      p.hsVx = p.hsVy = p.hsVz = 0;
    }
    return;
  }

  const jumpP = pressesSince(inp.jump, p.cJump) > 0;
  const dashP = pressesSince(inp.dash, p.cDash) > 0;
  const braceP = pressesSince(inp.brace, p.cBrace) > 0;
  const grabP = pressesSince(inp.grab, p.cGrab) > 0;
  const grappleP = pressesSince(inp.grapple, p.cGrapple) > 0;
  const reloadP = pressesSince(inp.reload, p.cReload) > 0;
  const u1P = pressesSince(inp.util1, p.cU1) > 0;
  const u2P = pressesSince(inp.util2, p.cU2) > 0;
  const tauntP = pressesSince(inp.taunt, p.cTaunt) > 0;
  p.cJump = inp.jump;
  p.cDash = inp.dash;
  p.cBrace = inp.brace;
  p.cGrab = inp.grab;
  p.cGrapple = inp.grapple;
  p.cReload = inp.reload;
  p.cU1 = inp.util1;
  p.cU2 = inp.util2;
  p.cTaunt = inp.taunt;

  if (p.mode === MODE_DEAD) return;

  p.yaw = inp.yaw;
  p.pitch = clamp(inp.pitch, -1.55, 1.55);

  tickTimers(p, dt);

  if (tauntP) out.taunt = true;
  if (u1P) out.util1 = true;
  if (u2P) out.util2 = true;
  if (grappleP) out.grapple = true;

  if (ctx.features.brace && braceP && p.braceCool <= 0 && p.mode !== MODE_HELD) {
    p.braceTimer = BALANCE.brace.window;
    p.braceCool = BALANCE.brace.cooldown;
    out.braced = true;
  }

  switch (p.mode) {
    case MODE_HANG:
      stepHang(p, inp, ctx, out, jumpP);
      break;
    case MODE_CLIMB:
      stepClimb(p, ctx, out);
      break;
    case MODE_HELD:
      if (dashP) out.escapeAttempt = true;
      p.vx = p.vy = p.vz = 0;
      break;
    default:
      stepMove(p, inp, ctx, out, jumpP, dashP, grabP);
      break;
  }

  stepWeapon(p, inp, ctx, out, reloadP);
}

function tickTimers(p: PlayerState, dt: number): void {
  const D = BALANCE.dash;
  if (p.dashCharges < D.charges) {
    p.dashRecharge -= dt;
    if (p.dashRecharge <= 0) {
      p.dashCharges += 1;
      p.dashRecharge = p.dashCharges < D.charges ? D.rechargeTime : 0;
    }
  } else {
    p.dashRecharge = 0;
  }
  p.dashCool = Math.max(0, p.dashCool - dt);
  p.braceTimer = Math.max(0, p.braceTimer - dt);
  p.braceCool = Math.max(0, p.braceCool - dt);
  p.doubledTimer = Math.max(0, p.doubledTimer - dt);
  p.grabCool = Math.max(0, p.grabCool - dt);
  p.grappleCool = Math.max(0, p.grappleCool - dt);
  p.regrabCool = Math.max(0, p.regrabCool - dt);
  p.grabBuffer = Math.max(0, p.grabBuffer - dt);
  p.spawnProt = Math.max(0, p.spawnProt - dt);
  p.fireCool = Math.max(0, p.fireCool - dt);
  p.u1Cool = Math.max(0, p.u1Cool - dt);
  p.u2Cool = Math.max(0, p.u2Cool - dt);
  p.pinTimer = Math.max(0, p.pinTimer - dt);
  p.blownTimer = Math.max(0, p.blownTimer - dt);
  p.sinceHit += dt;
  if (p.mode === MODE_HELD || p.holding >= 0) p.holdTimer += dt;
  if (p.launchTimer > 0) {
    p.launchTimer = Math.max(0, p.launchTimer - dt);
    p.launchElapsed += dt;
  }
  const I = BALANCE.inflation;
  if (I.decayPerSec > 0 && p.sinceHit > I.decayDelay && p.inflation > 0) {
    p.inflation = Math.max(0, p.inflation - I.decayPerSec * dt);
  }
}

function stepMove(
  p: PlayerState,
  inp: InputFrame,
  ctx: StepContext,
  out: StepResult,
  jumpP: boolean,
  dashP: boolean,
  grabP: boolean,
): void {
  const P = BALANCE.player;
  const D = BALANCE.dash;
  const K = BALANCE.knockback;
  const dt = ctx.dt;
  const world = ctx.world;
  const env = ctx.env ?? NORMAL_ENV;

  // Ride moving platforms.
  if (p.onGround && p.groundId >= 0) {
    const s = world.solid(p.groundId);
    if (s && s.enabled) {
      p.px += s.dX;
      p.py += s.dY;
      p.pz += s.dZ;
    }
  }
  depenetrate(p, world);

  const launched = p.launchTimer > 0;
  const doubled = p.doubledTimer > 0;

  // Wish direction on the ground plane, relative to where the camera faces.
  let mx = inp.moveX;
  let mz = inp.moveZ;
  const mlen = Math.hypot(mx, mz);
  if (mlen > 1) {
    mx /= mlen;
    mz /= mlen;
  }
  const wishLen = Math.min(1, mlen);
  const sinY = Math.sin(p.yaw);
  const cosY = Math.cos(p.yaw);
  let wx = cosY * mx - sinY * mz;
  let wz = -sinY * mx - cosY * mz;
  const wl = Math.hypot(wx, wz);
  if (wl > 1e-6) {
    wx /= wl;
    wz /= wl;
  }

  if (p.onGround) {
    p.coyote = P.coyoteTime;
    p.jumpsUsed = 0;
    p.airTime = 0;
  } else {
    p.coyote -= dt;
    p.airTime += dt;
    if (p.coyote <= 0 && p.jumpsUsed === 0) p.jumpsUsed = 1;
  }

  // --- Grapple zip: pulled toward the grapple point, ignoring gravity. ---------------------
  if (p.zipTimer > 0) {
    p.zipTimer -= dt;
    const h = playerHeight(p);
    const dx = p.zipX - p.px;
    const dy = p.zipY - (p.py + h * 0.5);
    const dz = p.zipZ - p.pz;
    const d = Math.hypot(dx, dy, dz);
    const G = BALANCE.grapple;
    if (d < 1.2 || p.zipTimer <= 0) {
      p.zipTimer = 0;
      p.vx *= 0.6;
      p.vy = Math.max(p.vy * 0.6, 4);
      p.vz *= 0.6;
      p.jumpsUsed = Math.min(p.jumpsUsed, 1);
    } else {
      p.vx = (dx / d) * G.zipSpeed;
      p.vy = (dy / d) * G.zipSpeed;
      p.vz = (dz / d) * G.zipSpeed;
      p.launchTimer = 0;
      p.dashTimer = 0;
      p.slideTimer = 0;
      moveBody(p, world, dt, out);
      if (p.onGround) p.zipTimer = 0;
      return;
    }
  }

  // --- Jumping ---------------------------------------------------------------------------
  let jumpedNow = false;
  if (jumpP && !launched && !doubled && p.zipTimer <= 0) {
    if ((p.onGround || p.coyote > 0) && p.jumpsUsed === 0) {
      p.vy = P.jumpVelocity;
      p.jumpsUsed = 1;
      p.onGround = 0;
      p.coyote = 0;
      jumpedNow = true;
      out.jumped = true;
      p.slideTimer = 0; // slide-jumps keep all their horizontal speed
    } else if (p.jumpsUsed < 2) {
      p.vy = P.doubleJumpVelocity;
      p.jumpsUsed = 2;
      p.dashTimer = 0;
      jumpedNow = true;
      out.doubleJumped = true;
      if (wishLen > 0.1) {
        const hs = Math.hypot(p.vx, p.vz);
        const target = Math.max(hs, P.walkSpeed * wishLen);
        const k = P.doubleJumpRedirect;
        p.vx = p.vx * (1 - k) + wx * target * k;
        p.vz = p.vz * (1 - k) + wz * target * k;
      }
    }
  }

  // --- Dashing ---------------------------------------------------------------------------
  if (
    dashP &&
    p.dashCharges >= 1 &&
    p.dashCool <= 0 &&
    !doubled &&
    (!launched || p.launchElapsed >= D.launchLockout)
  ) {
    let dx = wx;
    let dz = wz;
    if (wishLen < 0.1) {
      dx = -sinY;
      dz = -cosY;
    }
    if (p.dashCharges >= D.charges) p.dashRecharge = D.rechargeTime;
    p.dashCharges -= 1;
    p.dashCool = D.minInterval;
    if (launched) {
      p.vx = p.vx * D.launchKeep + dx * D.speed;
      p.vz = p.vz * D.launchKeep + dz * D.speed;
      p.vy = Math.max(p.vy * D.launchKeep, D.airUpBoost);
      p.launchTimer = 0;
      p.dashTimer = D.duration;
      out.techEscape = true;
    } else {
      const along = Math.max(D.speed, p.vx * dx + p.vz * dz);
      p.vx = dx * along;
      p.vz = dz * along;
      if (p.onGround && !jumpedNow) {
        p.slideTimer = D.duration + D.slideDuration;
        out.slid = true;
      } else {
        p.vy = Math.max(p.vy, D.airUpBoost);
        p.dashTimer = D.duration;
      }
    }
    out.dashed = true;
  }

  // --- Friction and acceleration ---------------------------------------------------------
  // Weapon parts change walking speed (tanks, grips) and the slow-down while charging.
  const W = ctx.weapon;
  const moveMult = (doubled ? K.doubleOverMoveMult : 1) * (p.charging ? W.chargeMove : 1) * W.moveMult * (p.holding >= 0 ? 0.6 : 1);
  if (p.onGround && !jumpedNow) {
    const sliding = p.slideTimer > 0;
    // Caught in a leaf blower's stream: you skid instead of gripping the ground.
    const fr = (sliding || p.blownTimer > 0 ? D.slideFriction : P.groundFriction) * env.frictionMult;
    const speed = Math.hypot(p.vx, p.vz);
    if (speed > 1e-4) {
      const control = Math.max(speed, P.stopSpeed);
      const ns = Math.max(0, speed - control * fr * dt);
      p.vx *= ns / speed;
      p.vz *= ns / speed;
    }
    if (sliding) {
      p.vx += wx * D.slideSteerAccel * wishLen * dt;
      p.vz += wz * D.slideSteerAccel * wishLen * dt;
      p.slideTimer = Math.max(0, p.slideTimer - dt);
      if (Math.hypot(p.vx, p.vz) < D.speed * 0.3) p.slideTimer = 0;
    } else {
      accelerate(p, wx, wz, P.walkSpeed * wishLen * moveMult, P.groundAccel * env.accelMult, dt);
    }
  } else if (p.dashTimer > 0) {
    p.dashTimer -= dt;
    if (p.dashTimer <= 0) {
      p.dashTimer = 0;
      // Keep some of the dash as momentum, but not all of it.
      const hs = Math.hypot(p.vx, p.vz);
      const cap = 11;
      if (hs > cap) {
        p.vx *= cap / hs;
        p.vz *= cap / hs;
      }
    }
  } else {
    p.slideTimer = 0;
    let drag = P.airDrag;
    if (launched) {
      p.vx += wx * K.launchSteerAccel * wishLen * dt;
      p.vz += wz * K.launchSteerAccel * wishLen * dt;
      drag = K.launchDrag;
    } else {
      accelerate(p, wx, wz, P.airMaxSpeed * wishLen * moveMult, P.airAccel, dt);
    }
    const f = Math.max(0, 1 - drag * dt);
    p.vx *= f;
    p.vz *= f;
  }

  // --- Wind (giant fan event) -----------------------------------------------------------
  if (env.windX !== 0 || env.windZ !== 0) {
    const k = p.onGround ? 1 : env.windAirMult;
    p.vx += env.windX * k * dt;
    p.vz += env.windZ * k * dt;
  }

  // --- Gravity ---------------------------------------------------------------------------
  if (p.dashTimer <= 0) {
    p.vy -= P.gravity * env.gravityMult * dt;
    if (p.vy < -P.maxFallSpeed) p.vy = -P.maxFallSpeed;
  }

  moveBody(p, world, dt, out);

  // Bounce pads.
  if (p.onGround) {
    for (const pad of world.pads) {
      if (Math.abs(p.px - pad.x) <= pad.half + 0.2 && Math.abs(p.pz - pad.z) <= pad.half + 0.2 && Math.abs(p.py - pad.y) < 0.3) {
        p.vy = pad.strength;
        p.vx = pad.pushX ?? p.vx;
        p.vz = pad.pushZ ?? p.vz;
        p.onGround = 0;
        p.jumpsUsed = 1;
        p.slideTimer = 0;
        out.padBounce = pad.id;
        break;
      }
    }
  }

  // --- Ledge grabbing ----------------------------------------------------------------------
  if (grabP) {
    if (p.holding >= 0) {
      out.throwIntent = true;
    } else {
      out.grabIntent = true;
      p.grabBuffer = BALANCE.ledge.buffer;
    }
  }
  if (
    ctx.features.ledge &&
    (p.grabBuffer > 0 || (inp.buttons & BTN_GRAB) !== 0) &&
    !p.onGround &&
    p.vy < 2 &&
    p.regrabCool <= 0 &&
    p.holding < 0 &&
    (!launched || p.launchElapsed >= D.launchLockout)
  ) {
    if (tryLedgeGrab(p, world)) {
      p.grabBuffer = 0;
      out.ledgeGrab = true;
      out.grabIntent = false;
    }
  }
}

function accelerate(p: PlayerState, wx: number, wz: number, wishSpeed: number, accel: number, dt: number): void {
  if (wishSpeed <= 0) return;
  const current = p.vx * wx + p.vz * wz;
  const add = wishSpeed - current;
  if (add <= 0) return;
  const a = Math.min(accel * dt, add);
  p.vx += wx * a;
  p.vz += wz * a;
}

/** Pushes the player out of any solid it overlaps (e.g. after inflating near a wall). */
export function depenetrate(p: PlayerState, world: World): void {
  const r = playerRadius(p);
  const h = playerHeight(p);
  for (let iter = 0; iter < 4; iter++) {
    let moved = false;
    for (const s of world.solids) {
      if (!s.enabled) continue;
      const minX = p.px - r;
      const maxX = p.px + r;
      const minY = p.py;
      const maxY = p.py + h;
      const minZ = p.pz - r;
      const maxZ = p.pz + r;
      if (maxX <= s.minX || minX >= s.maxX || maxY <= s.minY || minY >= s.maxY || maxZ <= s.minZ || minZ >= s.maxZ) continue;
      // Smallest push out of the box.
      const pushes = [
        { a: 0, d: s.minX - maxX },
        { a: 0, d: s.maxX - minX },
        { a: 1, d: s.minY - maxY },
        { a: 1, d: s.maxY - minY },
        { a: 2, d: s.minZ - maxZ },
        { a: 2, d: s.maxZ - minZ },
      ];
      let best = pushes[0];
      for (const c of pushes) if (Math.abs(c.d) < Math.abs(best.d)) best = c;
      if (best.a === 0) p.px += best.d;
      else if (best.a === 1) {
        p.py += best.d;
        if (best.d > 0) {
          p.onGround = 1;
          p.groundId = s.id;
          if (p.vy < 0) p.vy = 0;
        }
      } else p.pz += best.d;
      moved = true;
    }
    if (!moved) break;
  }
}

/** Moves the player through the world with per-axis swept collision. */
export function moveBody(p: PlayerState, world: World, dt: number, out: StepResult): void {
  const P = BALANCE.player;
  const K = BALANCE.knockback;
  const r = playerRadius(p);
  const h = playerHeight(p);
  const maxD = Math.max(Math.abs(p.vx), Math.abs(p.vy), Math.abs(p.vz)) * dt;
  const steps = Math.max(1, Math.ceil(maxD / 0.35));
  const sdt = dt / steps;
  const wasGround = p.onGround === 1;
  p.onGround = 0;
  const launched = p.launchTimer > 0;

  for (let i = 0; i < steps; i++) {
    // Vertical.
    const dy = p.vy * sdt;
    world.sweepAxis(1, dy, p.px - r, p.py, p.pz - r, p.px + r, p.py + h, p.pz + r, tmpSweep);
    p.py += tmpSweep.d;
    if (tmpSweep.hit >= 0) {
      if (dy < 0) {
        const impact = -p.vy;
        const floor = world.solid(tmpSweep.hit);
        const rubber = floor ? floor.bounce : 0;
        if (rubber > 0 && impact > 5) {
          // Bouncy castle floor: every real landing springs you back up.
          p.vy = Math.max(impact * rubber, 6);
          out.bounced = true;
          if (!launched) p.jumpsUsed = Math.min(p.jumpsUsed, 1);
        } else if (launched && impact > P.landingBounceMinSpeed) {
          p.vy = impact * P.landingBounce;
          out.bounced = true;
        } else {
          p.vy = 0;
          p.onGround = 1;
          p.groundId = tmpSweep.hit;
          if (!wasGround && impact > 2) out.landed = impact;
        }
      } else {
        p.vy = Math.min(0, -p.vy * 0.2);
      }
    }

    // Horizontal X then Z.
    moveHorizontal(p, world, 0, p.vx * sdt, r, h, wasGround || p.onGround === 1, launched, out, K.wallBounce, K.wallBounceMinSpeed);
    moveHorizontal(p, world, 2, p.vz * sdt, r, h, wasGround || p.onGround === 1, launched, out, K.wallBounce, K.wallBounceMinSpeed);
  }
  if (p.onGround === 0) p.groundId = -1;
}

function moveHorizontal(
  p: PlayerState,
  world: World,
  axis: 0 | 2,
  d: number,
  r: number,
  h: number,
  grounded: boolean,
  launched: boolean,
  out: StepResult,
  bounce: number,
  bounceMin: number,
): void {
  if (d === 0) return;
  world.sweepAxis(axis, d, p.px - r, p.py, p.pz - r, p.px + r, p.py + h, p.pz + r, tmpSweep);
  if (tmpSweep.hit < 0) {
    if (axis === 0) p.px += d;
    else p.pz += d;
    return;
  }
  const blocker = world.solid(tmpSweep.hit)!;
  const rise = blocker.maxY - p.py;
  // Step up small ledges (curbs, crates' lips) while walking.
  if (grounded && rise > 0 && rise <= BALANCE.player.stepHeight) {
    const nx = axis === 0 ? p.px + d : p.px;
    const nz = axis === 2 ? p.pz + d : p.pz;
    if (!world.boxBlocked(nx - r, blocker.maxY + 0.001, nz - r, nx + r, blocker.maxY + h + 0.001, nz + r)) {
      p.py = blocker.maxY + 0.001;
      if (axis === 0) p.px = nx;
      else p.pz = nz;
      p.onGround = 1;
      p.groundId = blocker.id;
      if (p.vy < 0) p.vy = 0;
      return;
    }
  }
  if (axis === 0) {
    p.px += tmpSweep.d;
    if (launched && Math.abs(p.vx) > bounceMin) {
      p.vx = -p.vx * bounce;
      out.wallBounce = true;
    } else p.vx = 0;
  } else {
    p.pz += tmpSweep.d;
    if (launched && Math.abs(p.vz) > bounceMin) {
      p.vz = -p.vz * bounce;
      out.wallBounce = true;
    } else p.vz = 0;
  }
  p.slideTimer = 0;
}

// --- Ledges ---------------------------------------------------------------------------------

const HANG_DROP = 0.82; // fraction of body height hanging below the ledge top

function tryLedgeGrab(p: PlayerState, world: World): boolean {
  const r = playerRadius(p);
  const h = playerHeight(p);
  let bestDist = Infinity;
  let best: { id: number; ex: number; ez: number; nx: number; nz: number; top: number } | null = null;
  for (const s of world.solids) {
    if (!s.enabled || !s.ledge) continue;
    const top = s.maxY;
    if (top < p.py + 0.45 * h || top > p.py + h + 0.55) continue;
    const cx = clamp(p.px, s.minX, s.maxX);
    const cz = clamp(p.pz, s.minZ, s.maxZ);
    const ddx = p.px - cx;
    const ddz = p.pz - cz;
    const dist = Math.hypot(ddx, ddz);
    if (dist < 1e-3 || dist > r + 0.6) continue;
    let nx = 0;
    let nz = 0;
    let ex = cx;
    let ez = cz;
    if (Math.abs(ddx) >= Math.abs(ddz)) {
      nx = Math.sign(ddx);
      ex = nx > 0 ? s.maxX : s.minX;
      ez = clamp(p.pz, s.minZ + r * 0.5, s.maxZ - r * 0.5);
    } else {
      nz = Math.sign(ddz);
      ez = nz > 0 ? s.maxZ : s.minZ;
      ex = clamp(p.px, s.minX + r * 0.5, s.maxX - r * 0.5);
    }
    // Room to hang and room to climb up onto the top.
    const hx = ex + nx * (r + 0.02);
    const hz = ez + nz * (r + 0.02);
    const hy = top - h * HANG_DROP;
    if (world.boxBlocked(hx - r, hy, hz - r, hx + r, hy + h, hz + r)) continue;
    const tx = ex - nx * (r + 0.1);
    const tz = ez - nz * (r + 0.1);
    if (world.boxBlocked(tx - r, top + 0.01, tz - r, tx + r, top + h, tz + r)) continue;
    if (dist < bestDist) {
      bestDist = dist;
      best = { id: s.id, ex, ez, nx, nz, top };
    }
  }
  if (!best) return false;
  p.mode = MODE_HANG;
  p.hangId = best.id;
  p.hangX = best.ex;
  p.hangZ = best.ez;
  p.hangY = best.top;
  p.hangNx = best.nx;
  p.hangNz = best.nz;
  p.hangTimer = 0;
  p.px = best.ex + best.nx * (r + 0.02);
  p.pz = best.ez + best.nz * (r + 0.02);
  p.py = best.top - h * HANG_DROP;
  p.vx = p.vy = p.vz = 0;
  p.launchTimer = 0;
  p.dashTimer = 0;
  p.slideTimer = 0;
  p.onGround = 0;
  p.jumpsUsed = 1;
  return true;
}

/** Releases a hanging player (dropped, stomped, hit, or timed out). */
export function releaseLedge(p: PlayerState, vy = 0): void {
  p.mode = MODE_NORMAL;
  p.hangId = -1;
  p.vy = vy;
  p.regrabCool = BALANCE.ledge.regrabCooldown;
}

function stepHang(p: PlayerState, inp: InputFrame, ctx: StepContext, out: StepResult, jumpP: boolean): void {
  const s = ctx.world.solid(p.hangId);
  if (!s || !s.enabled) {
    releaseLedge(p, 0);
    return;
  }
  // Follow moving ledges.
  p.px += s.dX;
  p.py += s.dY;
  p.pz += s.dZ;
  p.hangX += s.dX;
  p.hangY += s.dY;
  p.hangZ += s.dZ;
  p.hangTimer += ctx.dt;

  const sinY = Math.sin(p.yaw);
  const cosY = Math.cos(p.yaw);
  const wx = cosY * inp.moveX - sinY * inp.moveZ;
  const wz = -sinY * inp.moveX - cosY * inp.moveZ;
  const toward = -(wx * p.hangNx + wz * p.hangNz);

  if (jumpP) {
    p.mode = MODE_NORMAL;
    p.hangId = -1;
    p.vy = BALANCE.player.jumpVelocity * 1.05;
    p.vx = -p.hangNx * 3;
    p.vz = -p.hangNz * 3;
    p.jumpsUsed = 1;
    p.regrabCool = 0.35;
    out.jumped = true;
  } else if (toward > 0.5) {
    p.mode = MODE_CLIMB;
    p.climbTimer = BALANCE.ledge.climbTime;
    p.climbFromX = p.px;
    p.climbFromY = p.py;
    p.climbFromZ = p.pz;
    out.climbed = true;
  } else if (toward < -0.5 || p.hangTimer > BALANCE.ledge.maxHang) {
    releaseLedge(p, 0);
  }
}

function stepClimb(p: PlayerState, ctx: StepContext, _out: StepResult): void {
  const s = ctx.world.solid(p.hangId);
  if (s) {
    p.hangX += s.dX;
    p.hangY += s.dY;
    p.hangZ += s.dZ;
    p.climbFromX += s.dX;
    p.climbFromY += s.dY;
    p.climbFromZ += s.dZ;
  }
  p.climbTimer -= ctx.dt;
  const r = playerRadius(p);
  const tx = p.hangX - p.hangNx * (r + 0.1);
  const tz = p.hangZ - p.hangNz * (r + 0.1);
  const ty = p.hangY + 0.002;
  const t = clamp(1 - p.climbTimer / BALANCE.ledge.climbTime, 0, 1);
  // Rise first, then pull in over the lip.
  const ty1 = clamp(t / 0.6, 0, 1);
  const tx1 = clamp((t - 0.4) / 0.6, 0, 1);
  p.py = p.climbFromY + (ty - p.climbFromY) * ty1;
  p.px = p.climbFromX + (tx - p.climbFromX) * tx1;
  p.pz = p.climbFromZ + (tz - p.climbFromZ) * tx1;
  p.vx = p.vy = p.vz = 0;
  if (p.climbTimer <= 0) {
    p.mode = MODE_NORMAL;
    p.px = tx;
    p.py = ty;
    p.pz = tz;
    p.onGround = 1;
    p.groundId = p.hangId;
    p.hangId = -1;
    p.jumpsUsed = 0;
  }
}

// --- Weapon -----------------------------------------------------------------------------

const tmpDir = { x: 0, y: 0, z: 0 };

function stepWeapon(p: PlayerState, inp: InputFrame, ctx: StepContext, out: StepResult, reloadP: boolean): void {
  const W = ctx.weapon;
  const dt = ctx.dt;
  // Turbo Tank (streak reward): reloads and fire cooldowns run faster.
  const rate = p.turboTimer > 0 ? BALANCE.streaks.turboRate : 1;
  if (p.turboTimer > 0) p.turboTimer = Math.max(0, p.turboTimer - dt);
  if (p.reloadTimer > 0) {
    p.reloadTimer -= dt;
    if (p.reloadTimer <= 0) {
      p.reloadTimer = 0;
      p.ammo = W.ammo;
    }
  }
  if (p.onGround) p.hoverTimer = W.hoverTime;
  p.hovering = 0;
  const canAct = p.mode === MODE_NORMAL && p.doubledTimer <= 0 && p.holding < 0;
  const fireHeld = (inp.buttons & BTN_FIRE) !== 0 && canAct;
  // While holding someone, pulling the trigger throws them instead of shooting.
  if (p.holding >= 0 && (inp.buttons & BTN_FIRE) !== 0) out.throwIntent = true;

  if (!canAct && p.charging) {
    p.charging = 0;
    p.charge = 0;
  }

  if (reloadP && canAct && p.ammo < W.ammo && p.reloadTimer <= 0 && !p.charging) {
    p.reloadTimer = W.reloadTime / rate;
    out.reloadStart = true;
  }

  if (W.kind === 'stream') {
    // Leaf Blower: blows while held, spinning up to full strength; the tank drains in seconds.
    if (fireHeld && p.ammo > 0 && p.reloadTimer <= 0 && p.fireCool <= 0) {
      p.charging = 1;
      p.charge = Math.min(1, p.charge + dt / W.chargeTime);
      p.ammo = Math.max(0, p.ammo - dt);
      p.spawnProt = 0;
      out.stream = W.tapPower + (1 - W.tapPower) * p.charge;
      if (W.recoil > 0 && p.mode === MODE_NORMAL) {
        // A kick stock turns the blower into a (weak) jet pack.
        lookDir(p.yaw, p.pitch, tmpDir);
        const k = W.recoil * 5 * out.stream * dt;
        p.vx -= tmpDir.x * k;
        p.vz -= tmpDir.z * k;
        if (tmpDir.y < -0.3 && !p.onGround) p.vy -= tmpDir.y * k;
      }
      // Aimed at the ground while airborne: hover.
      if (p.pitch < -0.75 && !p.onGround && p.hoverTimer > 0 && p.mode === MODE_NORMAL) {
        const g = ctx.world.groundBelow(p.px, p.py + 0.1, p.pz, 7);
        if (g !== null) {
          p.hoverTimer -= dt;
          p.hovering = 1;
          if (p.vy < W.hoverLift * out.stream) p.vy = Math.min(W.hoverLift * out.stream, p.vy + 60 * dt);
        }
      }
      if (p.ammo <= 0) {
        p.charging = 0;
        p.reloadTimer = W.reloadTime / rate;
        out.reloadStart = true;
      }
    } else {
      if (p.charging) p.fireCool = W.fireCooldown / rate;
      p.charging = 0;
      p.charge = Math.max(0, p.charge - dt * 3);
    }
    return;
  }

  if (W.auto) {
    // Pop Gun: sprays while held. The spin-up (chargeTime) ramps the fire rate up to full.
    if (fireHeld && p.ammo >= 1 && p.reloadTimer <= 0) {
      p.charging = 1;
      p.charge = Math.min(1, p.charge + dt / Math.max(0.01, W.chargeTime));
      if (p.fireCool <= 0) {
        fireShot(p, W, out, rate, true);
        p.fireCool = (W.fireCooldown * (1 + (1 - p.charge) * 1.5)) / rate;
      }
    } else {
      p.charging = 0;
      p.charge = Math.max(0, p.charge - dt * 4);
    }
    return;
  }

  if (p.charging) {
    if (fireHeld) {
      p.charge = Math.min(1, p.charge + dt / W.chargeTime);
    } else {
      fireShot(p, W, out, rate, false);
      p.fireCool = W.fireCooldown / rate;
      p.charging = 0;
      p.charge = 0;
    }
  } else if (fireHeld && p.fireCool <= 0 && p.reloadTimer <= 0 && p.ammo >= 1) {
    p.charging = 1;
    p.charge = Math.min(1, dt / W.chargeTime);
  }
}

/** Fires one shot (or one pellet volley) with the current charge; spends ammo and applies recoil. */
function fireShot(p: PlayerState, W: WeaponStats, out: StepResult, rate: number, auto: boolean): void {
  // Mega Blast shots always fire at full charge (auto weapons spend a fraction per shot).
  const mega = p.megaShots > 0;
  if (mega) {
    p.megaShots = Math.max(0, p.megaShots - W.megaCost);
    if (p.megaShots < 1e-4) p.megaShots = 0;
    if (!auto) p.charge = 1;
  }
  const charge = auto ? 1 : p.charge;
  const power = W.tapPower + (1 - W.tapPower) * charge;
  lookDir(p.yaw, p.pitch, tmpDir);
  const eye = eyeHeight(p);
  out.fired = {
    ox: p.px + tmpDir.x * 0.5,
    oy: p.py + eye + tmpDir.y * 0.5,
    oz: p.pz + tmpDir.z * 0.5,
    dx: tmpDir.x,
    dy: tmpDir.y,
    dz: tmpDir.z,
    power,
    charge,
    mega,
  };
  p.ammo -= 1;
  p.spawnProt = 0;
  if (W.recoil > 0 && p.mode === MODE_NORMAL) {
    // Kick: the Air Blaster (and any kick stock) shoves you backwards, and up if you fire at the
    // floor. Auto weapons only push a little per shot and never reset a fall.
    const k = W.recoil * power;
    p.vx -= tmpDir.x * k;
    p.vz -= tmpDir.z * k;
    if (tmpDir.y < -0.3) {
      p.vy = auto ? p.vy - tmpDir.y * k : Math.max(p.vy, 0) - tmpDir.y * k;
      if (!auto || p.vy > 0) p.onGround = 0;
    }
  }
  if (p.ammo <= 0) {
    p.ammo = 0;
    p.charging = 0;
    p.reloadTimer = W.reloadTime / rate;
    out.reloadStart = true;
  }
}
