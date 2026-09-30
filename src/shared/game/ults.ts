import { BALANCE } from '../balance';
import type { PlayerState } from '../player';

/**
 * Ultimate abilities ("ults"): a meter that fills as you play, then one big move. The five in play
 * are the signature moves of the regulars (BOR, ABAG, SOL, KESTY and BÆN). They're all free: every spawn
 * deals you one at random (PLAYABLE_ULTS). Big Blow is kept for the debug tools only.
 *
 * This file holds what both sides share: the list, the public snapshot bits, and the effects on
 * movement that client prediction has to reproduce exactly. The server side is game/ultSim.ts.
 * Numbers live in BALANCE.ults.
 */
export const ULT_IDS = ['bigBlow', 'juice', 'chase', 'cropDuster', 'robot', 'pride'] as const;
export type UltId = (typeof ULT_IDS)[number];

export const DEFAULT_ULT: UltId = 'juice';

/**
 * Popping an ult turns you into the regular it's the signature move of, for a while: their body,
 * outfit and props (render/characters.ts), and their own face if they lent it (Store.claimCharacter).
 */
export const ULT_CHARACTER: Partial<Record<UltId, { body: string; name: string; seconds: number; color: string }>> = {
  juice: { body: 'bor', name: 'BOR', seconds: 14, color: '#ff8a1f' },
  chase: { body: 'abag', name: 'ABAG', seconds: 7, color: '#ff5fd2' },
  cropDuster: { body: 'sol', name: 'SOL', seconds: 7, color: '#8ee000' },
  robot: { body: 'kesty', name: 'KESTY', seconds: 7, color: '#ff3b5c' },
  pride: { body: 'baen', name: 'BÆN', seconds: 8, color: '#b44dff' },
};

/** The ults dealt out in matches, one at random each time you spawn. */
export const PLAYABLE_ULTS: readonly UltId[] = ['juice', 'chase', 'cropDuster', 'robot', 'pride'];

export function randomUlt(): UltId {
  return PLAYABLE_ULTS[Math.floor(Math.random() * PLAYABLE_ULTS.length)];
}

export interface UltInfo {
  name: string;
  icon: string;
  /** The move itself (the ult is named after the regular you turn into). */
  by: string;
  blurb: string;
  /** What it says when you pop it (full-screen splash). */
  tagline: string;
  color: string;
}

export const ULT_INFO: Record<UltId, UltInfo> = {
  bigBlow: {
    name: 'Big Blow',
    icon: '🌪️',
    by: '',
    blurb: 'Your next shot is one giant air blast: double the blast and the knockback, whatever you carry.',
    tagline: 'Next shot: MAXIMUM AIR',
    color: '#2ec5ff',
  },
  juice: {
    name: 'BOR',
    icon: '💉',
    by: 'Juice',
    blurb: 'Jab the giant syringe (it is full of air) and get JACKED for 14 s: faster, and your shots hit 30% harder.',
    tagline: 'JUICED: faster, harder hits',
    color: '#ff8a1f',
  },
  chase: {
    name: 'ABAG',
    icon: '👃',
    by: 'The Chase',
    blurb: "ABAG picks someone at random and hunts them down to BAG them: you're faster, your shots curve toward them, touch them and you hug them automatically, and the throw after is extra hard. Everyone gets warned.",
    tagline: "Who's getting BAGGED?",
    color: '#ff5fd2',
  },
  cropDuster: {
    name: 'SOL',
    icon: '💨',
    by: 'Crop Duster',
    blurb: 'Bend over and let rip: a huge green shockwave launches everyone nearby and leaves a cloud that inflates and slows.',
    tagline: 'Everybody out of the cloud!',
    color: '#8ee000',
  },
  robot: {
    name: 'KESTY',
    icon: '🤖',
    by: 'Robot Mode',
    blurb: 'TARGET ACQUIRED. Locks on to up to 3 enemies in view, then fires a barrage of 6 homing mini-rockets.',
    tagline: 'TARGET ACQUIRED. EXECUTING.',
    color: '#ff3b5c',
  },
  pride: {
    name: 'BÆN',
    icon: '🌈',
    by: 'Bæn Is Gay',
    blurb: 'Turn into BÆN in full rainbow and lead a Pride Parade for 8 s: a rainbow burst launches everyone around you, you strut faster, and anyone who steps on your rainbow road gets bounced sky-high.',
    tagline: 'PRIDE PARADE! Everybody off the road!',
    color: '#b44dff',
  },
};

export function ultIndex(id: UltId): number {
  return ULT_IDS.indexOf(id);
}

/** The ult a player carries (the loadout's choice, copied into the state at spawn). */
export function ultOf(p: PlayerState): UltId {
  return ULT_IDS[p.ultKind] ?? DEFAULT_ULT;
}

export function ultReady(p: PlayerState): boolean {
  return p.ult >= 1 - 1e-6;
}

/** The ult that is doing something right now (Big Blow counts while it's loaded), or null. */
export function activeUlt(p: PlayerState): UltId | null {
  if (p.ultArmed > 0) return 'bigBlow';
  if (p.juiceTimer > 0) return 'juice';
  if (p.chaseTimer > 0) return 'chase';
  if (p.fartTimer > 0) return 'cropDuster';
  if (p.robotTimer > 0) return 'robot';
  if (p.prideTimer > 0) return 'pride';
  return null;
}

/** Adds to a player's meter (it doesn't fill while an ult is running). */
export function chargeUlt(p: PlayerState, amount: number): void {
  if (amount <= 0 || activeUlt(p) !== null) return;
  p.ult = Math.min(1, p.ult + amount);
}

/** Move speed multiplier: Juice, The Chase and a Pride Parade speed you up, a Crop Duster cloud slows you down. */
export function ultSpeedMult(p: PlayerState): number {
  const U = BALANCE.ults;
  let m = 1;
  if (p.juiceTimer > 0) m *= U.juice.speedMult;
  if (p.prideTimer > 0) m *= U.pride.speedMult;
  if (p.chaseTimer > 0) m *= U.chase.speedMult;
  if (p.gasTimer > 0) m *= U.cropDuster.cloudSlow;
  return m;
}

/** Extra mass against knockback (1 for every ult now: a bigger body never takes less). */
export function ultMassMult(p: PlayerState): number {
  return p.juiceTimer > 0 ? BALANCE.ults.juice.massMult : 1;
}

/** Knockback multiplier for your shots and throws (Juice). */
export function ultPowerMult(p: PlayerState): number {
  return p.juiceTimer > 0 ? BALANCE.ults.juice.powerMult : 1;
}

// --- Public snapshot byte ------------------------------------------------------------------

/** Bits 0-3: the active ult (index + 1, 0 = none). */
export const ULT_BIT_READY = 16;
/** Standing in someone's Crop Duster cloud. */
export const ULT_BIT_GASSED = 32;

/** What everyone else needs to see about your ult (flags are full, so it gets its own byte). */
export function publicUlt(p: PlayerState): number {
  const a = activeUlt(p);
  let b = a ? ultIndex(a) + 1 : 0;
  if (ultReady(p)) b |= ULT_BIT_READY;
  if (p.gasTimer > 0) b |= ULT_BIT_GASSED;
  return b;
}

export function publicUltKind(bits: number): UltId | null {
  const i = (bits & 15) - 1;
  return i >= 0 ? (ULT_IDS[i] ?? null) : null;
}

// --- Projectiles ---------------------------------------------------------------------------

/** Projectile kinds (the `weapon` of a sim Projectile), well clear of the weapon and utility ones. */
export const PROJ_BIG_BLOW = 20;
export const PROJ_ROCKET = 21;

/** Ult projectiles fly and burst like air shots (not like thrown utilities). */
export function isUltProjectile(kind: number | undefined): boolean {
  return kind === PROJ_BIG_BLOW || kind === PROJ_ROCKET;
}

// --- Homing (ult rockets, and shots fired during The Chase) --------------------------------

/**
 * Turns a velocity toward a point by at most `maxAngle` radians, keeping its speed. Shared so the
 * client can draw homing shots on the same curve the server flies them.
 */
export function steerToward(v: { vx: number; vy: number; vz: number }, fromX: number, fromY: number, fromZ: number, toX: number, toY: number, toZ: number, maxAngle: number): void {
  const sp = Math.hypot(v.vx, v.vy, v.vz);
  let wx = toX - fromX;
  let wy = toY - fromY;
  let wz = toZ - fromZ;
  const wl = Math.hypot(wx, wy, wz);
  if (sp < 1e-6 || wl < 1e-6 || maxAngle <= 0) return;
  const ux = v.vx / sp;
  const uy = v.vy / sp;
  const uz = v.vz / sp;
  wx /= wl;
  wy /= wl;
  wz /= wl;
  const dot = Math.max(-1, Math.min(1, ux * wx + uy * wy + uz * wz));
  const ang = Math.acos(dot);
  if (ang < 1e-5) return;
  const a = Math.min(ang, maxAngle);
  // Unit vector perpendicular to u, toward w.
  let px = wx - ux * dot;
  let py = wy - uy * dot;
  let pz = wz - uz * dot;
  const pl = Math.hypot(px, py, pz);
  if (pl < 1e-6) {
    // Straight behind: pick any perpendicular (up, unless we're flying straight up or down).
    px = Math.abs(uy) < 0.9 ? -ux * uy : 1;
    py = Math.abs(uy) < 0.9 ? 1 - uy * uy : 0;
    pz = Math.abs(uy) < 0.9 ? -uz * uy : 0;
  }
  const ql = Math.hypot(px, py, pz) || 1;
  const c = Math.cos(a);
  const s = Math.sin(a);
  v.vx = (ux * c + (px / ql) * s) * sp;
  v.vy = (uy * c + (py / ql) * s) * sp;
  v.vz = (uz * c + (pz / ql) * s) * sp;
}
