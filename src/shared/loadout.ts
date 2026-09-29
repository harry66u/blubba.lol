import { BALANCE } from './balance';

export const WEAPON_IDS = ['airCannon', 'leafBlower', 'airHorn', 'pumpRifle', 'bubbleShotgun', 'balloonMortar', 'popGun'] as const;
export type WeaponId = (typeof WEAPON_IDS)[number];
export const UTILITY_IDS = ['bouncePad', 'airGrenade', 'inflatableWall', 'vacuumGrenade', 'airMine', 'heliumBomb', 'tornado'] as const;
export type UtilityId = (typeof UTILITY_IDS)[number];

export type WeaponKind = 'projectile' | 'stream' | 'cone' | 'hitscan' | 'spread';

// --- Parts (the gun builder) -----------------------------------------------------------------

/** Every weapon has the same five part slots. */
export const PART_SLOTS = ['barrel', 'tank', 'valve', 'nozzle', 'grip'] as const;
export type PartSlot = (typeof PART_SLOTS)[number];

export const PART_IDS = [
  'standard',
  'longBarrel',
  'stubbyBarrel',
  'bigTank',
  'miniTank',
  'chargeValve',
  'quickValve',
  'hairTrigger',
  'wideNozzle',
  'jetNozzle',
  'pumpNozzle',
  'sprintGrip',
  'anchorStock',
  'kickStock',
] as const;
export type PartId = (typeof PART_IDS)[number];
/** A part that isn't 'standard' (these are what unlock by level). */
export type SpecialPartId = Exclude<PartId, 'standard'>;
export type Parts = Record<PartSlot, PartId>;

/** The options in each slot, 'standard' first. */
export const SLOT_PARTS: Record<PartSlot, readonly PartId[]> = {
  barrel: ['standard', 'longBarrel', 'stubbyBarrel'],
  tank: ['standard', 'bigTank', 'miniTank'],
  valve: ['standard', 'chargeValve', 'quickValve', 'hairTrigger'],
  nozzle: ['standard', 'wideNozzle', 'jetNozzle', 'pumpNozzle'],
  grip: ['standard', 'sprintGrip', 'anchorStock', 'kickStock'],
};

export const SPECIAL_PART_IDS = PART_IDS.filter((p): p is SpecialPartId => p !== 'standard');

export const PART_SLOT_INFO: Record<PartSlot, { name: string; blurb: string; standard: string }> = {
  barrel: { name: 'Barrel', blurb: 'Reach vs. forgiveness', standard: 'Balanced reach and shot size.' },
  tank: { name: 'Tank', blurb: 'Ammo vs. reload and weight', standard: 'The ammo and reload the weapon was made for.' },
  valve: { name: 'Valve', blurb: 'Charge speed vs. power', standard: 'Normal charge time and punch.' },
  nozzle: { name: 'Nozzle', blurb: 'Splash vs. focus', standard: 'Even mix of splash, knockback and air.' },
  grip: { name: 'Grip', blurb: 'Handling', standard: 'Normal speed and kick.' },
};

export const PART_INFO: Record<SpecialPartId, { slot: PartSlot; name: string; blurb: string; plus: string; minus: string }> = {
  longBarrel: { slot: 'barrel', name: 'Long Barrel', blurb: 'Reach out and shove someone.', plus: 'Longer range, faster shots', minus: 'Narrower shots, smaller blast' },
  stubbyBarrel: { slot: 'barrel', name: 'Stubby Barrel', blurb: 'Point-blank and forgiving.', plus: 'Bigger shots and blast', minus: 'Shorter range' },
  bigTank: { slot: 'tank', name: 'Big Tank', blurb: 'Keep firing through a whole fight.', plus: 'More ammo', minus: 'Slower reload, a bit slower on foot' },
  miniTank: { slot: 'tank', name: 'Mini Tank', blurb: 'Light and quick to refill.', plus: 'Much faster reload, a bit faster on foot', minus: 'Less ammo' },
  chargeValve: { slot: 'valve', name: 'Charge Valve', blurb: 'Fewer, heavier shots.', plus: 'Harder hits, more air', minus: 'Slower charge and fire rate' },
  quickValve: { slot: 'valve', name: 'Quick Valve', blurb: 'Pressure through volume.', plus: 'Faster charge and fire rate', minus: 'Weaker hits, less air' },
  hairTrigger: { slot: 'valve', name: 'Hair Trigger', blurb: 'Taps hit almost like charged shots.', plus: 'Strong quick taps (fast spin-up)', minus: 'Softer fully charged shots' },
  wideNozzle: { slot: 'nozzle', name: 'Wide Nozzle', blurb: 'Hard to miss.', plus: 'Wider shots, bigger blast', minus: 'Less knockback' },
  jetNozzle: { slot: 'nozzle', name: 'Jet Nozzle', blurb: 'All the air in one spot.', plus: 'More knockback', minus: 'Narrower shots, smaller blast' },
  pumpNozzle: { slot: 'nozzle', name: 'Pump Nozzle', blurb: 'Blow them up first, launch them later.', plus: 'More inflation per hit', minus: 'Less knockback' },
  sprintGrip: { slot: 'grip', name: 'Sprint Grip', blurb: 'Run and gun.', plus: 'Faster on foot, no slowdown while charging', minus: 'Less knockback' },
  anchorStock: { slot: 'grip', name: 'Anchor Stock', blurb: 'Plant your feet and hit hard.', plus: 'More knockback, almost no recoil', minus: 'Slower on foot' },
  kickStock: { slot: 'grip', name: 'Kick Stock', blurb: 'Every shot shoves you: fly around on recoil.', plus: 'Big recoil, stronger blast jumps', minus: 'Less knockback' },
};

export const STANDARD_PARTS: Parts = { barrel: 'standard', tank: 'standard', valve: 'standard', nozzle: 'standard', grip: 'standard' };

export function partSlot(id: string): PartSlot | null {
  return (PART_INFO as Record<string, { slot: PartSlot }>)[id]?.slot ?? null;
}

export function partName(id: PartId): string {
  return id === 'standard' ? 'Standard' : PART_INFO[id].name;
}

// --- Loadouts ------------------------------------------------------------------------------------

export interface Loadout {
  weapon: WeaponId;
  parts: Parts;
  utils: [UtilityId, UtilityId];
}

export const DEFAULT_LOADOUT: Loadout = { weapon: 'airCannon', parts: { ...STANDARD_PARTS }, utils: ['bouncePad', 'airGrenade'] };

export const WEAPON_INFO: Record<WeaponId, { name: string; blurb: string; role: string }> = {
  airCannon: { name: 'Air Cannon', blurb: 'Medium range and balanced. Charge it into a heavy shot.', role: 'All-rounder' },
  leafBlower: { name: 'Leaf Blower', blurb: 'A steady stream that shoves people around. Aim at the ground to hover.', role: 'Pusher' },
  airHorn: { name: 'Air Blaster', blurb: 'Huge close-range air blast. Kicks you back too.', role: 'Close range' },
  pumpRifle: { name: 'Pump Rifle', blurb: 'Long-range precise shots that pump in extra air. Needs good aim.', role: 'Long range' },
  bubbleShotgun: { name: 'Bubble Shotgun', blurb: 'A burst of bubble pellets. Brutal up close; charge it to tighten the spread.', role: 'Close-mid range' },
  balloonMortar: { name: 'Balloon Mortar', blurb: 'Lobs a big water balloon on an arc. Huge splash knocks whole groups off ledges.', role: 'Area denial' },
  popGun: { name: 'Pop Gun', blurb: 'Hold to spray corks. Each one pushes and inflates a little; stay on target.', role: 'Pressure' },
};

export const UTILITY_INFO: Record<UtilityId, { name: string; blurb: string; icon: string }> = {
  bouncePad: { name: 'Bounce Pad', blurb: 'Throw it down to launch yourself or surprise enemies.', icon: '🟣' },
  airGrenade: { name: 'Air Grenade', blurb: 'Blasts everyone nearby outward.', icon: '💥' },
  inflatableWall: { name: 'Inflatable Wall', blurb: 'Blocks shots. Thrown while falling, it catches you.', icon: '🧱' },
  vacuumGrenade: { name: 'Vacuum Grenade', blurb: 'Sucks nearby players together for a big follow-up.', icon: '🌀' },
  airMine: { name: 'Air Mine', blurb: 'A sneaky trap. Arms after a second and pops the first enemy who steps near it sky-high. One at a time.', icon: '🧨' },
  heliumBomb: { name: 'Helium Bomb', blurb: 'A cloud of helium: enemies inside float helplessly up for a few seconds and fly farther when hit.', icon: '🎈' },
  tornado: { name: 'Tornado', blurb: 'Sends a spinning wind column rolling forward that swirls up anyone it catches.', icon: '🌪️' },
};

/** Utility icon by display name (the HUD and touch buttons know utilities by name). */
export function utilityIcon(name: string): string {
  for (const id of UTILITY_IDS) if (UTILITY_INFO[id].name === name) return UTILITY_INFO[id].icon;
  return '?';
}

/** Effective weapon stats after parts. Used by the server and by client prediction. */
export interface WeaponStats {
  id: WeaponId;
  kind: WeaponKind;
  ammo: number;
  reloadTime: number;
  fireCooldown: number;
  chargeTime: number;
  tapPower: number;
  projSpeed: number;
  projRadius: number;
  projLifetime: number;
  projGravity: number;
  /** Added to a projectile's vertical aim direction (lobbed shots). */
  projLoft: number;
  blastRadius: number;
  inflation: number;
  knockback: number;
  range: number;
  cone: number;
  rayRadius: number;
  recoil: number;
  hoverLift: number;
  hoverTime: number;
  /** 1: fires repeatedly while held (chargeTime is the spin-up). */
  auto: number;
  /** 1: projectile hits push and inflate a little instead of launching. */
  light: number;
  /** Spread weapons: pellet count, ring half-angle on a tap, and its multiplier at full charge. */
  pellets: number;
  spread: number;
  spreadCharged: number;
  /** Spread weapons: fraction of punch lost between falloffStart and max range. */
  falloff: number;
  falloffStart: number;
  /** Mega Blast shots used per shot fired. */
  megaCost: number;
  /** Walking speed multiplier. */
  moveMult: number;
  /** Walking speed multiplier while charging (or blowing / spraying). */
  chargeMove: number;
  /** Multiplier on blast jumps from your own shots. */
  blastJump: number;
}

export function weaponIndex(id: WeaponId): number {
  return WEAPON_IDS.indexOf(id);
}

/** Parts as a slot map, a list of part ids (old saved mods), or nothing. */
export type PartsInput = Partial<Record<PartSlot, string>> | readonly string[] | null | undefined;

/** Turns any parts input into a full, valid slot map (unknown or misplaced parts become 'standard'). */
export function normalizeParts(input: PartsInput, allowed?: readonly string[]): Parts {
  const out: Parts = { ...STANDARD_PARTS };
  const ok = (id: string) => !allowed || allowed.includes(id);
  if (Array.isArray(input)) {
    // A list (old two-mod loadouts): the first part for each slot wins.
    for (const id of input) {
      const slot = typeof id === 'string' ? partSlot(id) : null;
      if (slot && out[slot] === 'standard' && ok(id)) out[slot] = id as PartId;
    }
  } else if (input && typeof input === 'object') {
    const rec = input as Partial<Record<PartSlot, string>>;
    for (const slot of PART_SLOTS) {
      const id = rec[slot];
      if (typeof id === 'string' && id !== 'standard' && partSlot(id) === slot && ok(id)) out[slot] = id as PartId;
    }
  }
  return out;
}

type WeaponBalance = Record<string, number | string>;

export function computeWeaponStats(id: WeaponId, partsIn: PartsInput = null): WeaponStats {
  const b = BALANCE.weapons[id] as unknown as WeaponBalance;
  const n = (k: string, d = 0) => (typeof b[k] === 'number' ? (b[k] as number) : d);
  const w: WeaponStats = {
    id,
    kind: b.kind as WeaponKind,
    ammo: n('ammo'),
    reloadTime: n('reloadTime'),
    fireCooldown: n('fireCooldown'),
    chargeTime: n('chargeTime'),
    tapPower: n('tapPower'),
    projSpeed: n('projSpeed'),
    projRadius: n('projRadius'),
    projLifetime: n('projLifetime'),
    projGravity: n('projGravity'),
    projLoft: n('projLoft'),
    blastRadius: n('blastRadius'),
    inflation: n('inflation'),
    knockback: n('knockback'),
    range: n('range'),
    cone: n('cone'),
    rayRadius: n('rayRadius'),
    recoil: n('recoil'),
    hoverLift: n('hoverLift'),
    hoverTime: n('hoverTime'),
    auto: n('auto'),
    light: n('light'),
    pellets: n('pellets', 1),
    spread: n('spread'),
    spreadCharged: n('spreadCharged', 1),
    falloff: n('falloff'),
    falloffStart: n('falloffStart'),
    megaCost: n('megaCost', 1),
    moveMult: 1,
    chargeMove: BALANCE.player.chargingMoveMult,
    blastJump: 1,
  };
  const parts = normalizeParts(partsIn);
  const P = BALANCE.parts;
  const auto = w.auto > 0;
  const range = (m: number, speed = 1) => {
    if (w.kind === 'projectile') {
      if (w.projGravity > 0) {
        // Lobbed shots: range grows with the square of launch speed.
        w.projSpeed *= Math.sqrt(m);
      } else {
        w.projSpeed *= speed;
        w.projLifetime *= m / speed;
      }
    } else {
      w.range *= m;
    }
  };
  const width = (m: number) => {
    w.projRadius *= m;
    w.cone = Math.min(1.1, w.cone * m);
    w.rayRadius *= m;
    w.spread *= m;
  };
  const rate = (m: number) => (auto ? 1 + (m - 1) * P.autoRateScale : m);
  const ammo = (m: number) => {
    w.ammo = w.kind === 'stream' ? w.ammo * m : Math.max(1, Math.round(w.ammo * m));
  };
  for (const slot of PART_SLOTS) {
    switch (parts[slot]) {
      case 'longBarrel':
        range(P.longBarrel.range, P.longBarrel.speed);
        width(P.longBarrel.width);
        w.blastRadius *= P.longBarrel.blast;
        break;
      case 'stubbyBarrel':
        range(P.stubbyBarrel.range);
        width(P.stubbyBarrel.width);
        w.blastRadius *= P.stubbyBarrel.blast;
        break;
      case 'bigTank':
        ammo(P.bigTank.ammo);
        w.reloadTime *= P.bigTank.reload;
        w.moveMult *= P.bigTank.move;
        break;
      case 'miniTank':
        ammo(P.miniTank.ammo);
        w.reloadTime *= P.miniTank.reload;
        w.moveMult *= P.miniTank.move;
        break;
      case 'chargeValve':
        w.knockback *= P.chargeValve.knockback;
        w.inflation *= P.chargeValve.inflation;
        w.fireCooldown *= rate(P.chargeValve.fireCooldown);
        w.chargeTime *= P.chargeValve.chargeTime;
        break;
      case 'quickValve':
        w.knockback *= P.quickValve.knockback;
        w.inflation *= P.quickValve.inflation;
        w.fireCooldown *= rate(P.quickValve.fireCooldown);
        w.chargeTime *= P.quickValve.chargeTime;
        break;
      case 'hairTrigger':
        w.tapPower = Math.min(1, w.tapPower + P.hairTrigger.tapPower);
        w.knockback *= P.hairTrigger.knockback;
        w.inflation *= P.hairTrigger.inflation;
        if (auto) w.chargeTime *= P.hairTrigger.spinUp;
        break;
      case 'wideNozzle':
        width(P.wideNozzle.width);
        w.blastRadius *= P.wideNozzle.blast;
        w.knockback *= P.wideNozzle.knockback;
        break;
      case 'jetNozzle':
        width(P.jetNozzle.width);
        w.blastRadius *= P.jetNozzle.blast;
        w.knockback *= P.jetNozzle.knockback;
        break;
      case 'pumpNozzle':
        w.inflation *= P.pumpNozzle.inflation;
        w.knockback *= P.pumpNozzle.knockback;
        break;
      case 'sprintGrip':
        w.moveMult *= P.sprintGrip.move;
        w.chargeMove = P.sprintGrip.chargeMove;
        w.knockback *= P.sprintGrip.knockback;
        break;
      case 'anchorStock':
        w.recoil *= P.anchorStock.recoil;
        w.knockback *= P.anchorStock.knockback;
        w.moveMult *= P.anchorStock.move;
        break;
      case 'kickStock':
        w.recoil = w.recoil * P.kickStock.recoilMult + P.kickStock.recoilAdd * (auto ? P.autoRecoilScale : 1);
        w.blastJump *= P.kickStock.blastJump;
        w.knockback *= P.kickStock.knockback;
        break;
    }
  }
  return w;
}

/** How far a weapon reaches (meters), for bots and the loadout screen. */
export function weaponRange(w: WeaponStats): number {
  if (w.kind !== 'projectile') return w.range;
  if (w.projGravity > 0) {
    // Farthest a lobbed shot lands on level ground (45 degrees, launched from about eye height).
    const v = w.projSpeed;
    return (v * v) / w.projGravity + 2;
  }
  return w.projSpeed * w.projLifetime;
}

export interface LoadoutAllowed {
  parts?: readonly string[];
  utils?: readonly string[];
}

/**
 * Cleans up an untrusted loadout (from the network or storage). Old loadouts that still carry a
 * `mods` list keep their mods: each one moves into its part slot.
 */
export function sanitizeLoadout(raw: unknown, allowed?: LoadoutAllowed): Loadout {
  const r = (raw && typeof raw === 'object' ? raw : {}) as { weapon?: unknown; parts?: unknown; mods?: unknown; utils?: unknown };
  const weapon = WEAPON_IDS.includes(r.weapon as WeaponId) ? (r.weapon as WeaponId) : DEFAULT_LOADOUT.weapon;
  const partsIn = (r.parts && typeof r.parts === 'object' ? r.parts : Array.isArray(r.mods) ? r.mods : null) as PartsInput;
  const parts = normalizeParts(partsIn, allowed?.parts);
  const utils: UtilityId[] = [];
  for (const u of Array.isArray(r.utils) ? r.utils : []) {
    if (!UTILITY_IDS.includes(u as UtilityId) || utils.includes(u as UtilityId)) continue;
    if (allowed?.utils && !allowed.utils.includes(u)) continue;
    if (utils.length < 2) utils.push(u as UtilityId);
  }
  for (const d of DEFAULT_LOADOUT.utils) if (utils.length < 2 && !utils.includes(d)) utils.push(d);
  for (const u of UTILITY_IDS) if (utils.length < 2 && !utils.includes(u)) utils.push(u);
  return { weapon, parts, utils: [utils[0], utils[1]] };
}

export function utilityCooldown(id: UtilityId): number {
  return BALANCE.utilities[id].cooldown;
}
