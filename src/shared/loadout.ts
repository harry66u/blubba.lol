import { BALANCE } from './balance';

export const WEAPON_IDS = ['airCannon', 'leafBlower', 'airHorn', 'pumpRifle'] as const;
export type WeaponId = (typeof WEAPON_IDS)[number];
export const MOD_IDS = ['wideNozzle', 'bigTank', 'chargeValve', 'quickValve', 'longBarrel'] as const;
export type ModId = (typeof MOD_IDS)[number];
export const UTILITY_IDS = ['bouncePad', 'airGrenade', 'inflatableWall', 'vacuumGrenade'] as const;
export type UtilityId = (typeof UTILITY_IDS)[number];

export type WeaponKind = 'projectile' | 'stream' | 'cone' | 'hitscan';

export interface Loadout {
  weapon: WeaponId;
  mods: ModId[];
  utils: [UtilityId, UtilityId];
}

export const DEFAULT_LOADOUT: Loadout = { weapon: 'airCannon', mods: [], utils: ['bouncePad', 'airGrenade'] };

export const MAX_MODS = 2;
/** Mods that pull in opposite directions can't be combined. */
export const EXCLUSIVE_MODS: [ModId, ModId][] = [
  ['chargeValve', 'quickValve'],
  ['wideNozzle', 'longBarrel'],
];

export const WEAPON_INFO: Record<WeaponId, { name: string; blurb: string }> = {
  airCannon: { name: 'Air Cannon', blurb: 'Medium range and balanced. Charge it into a heavy shot.' },
  leafBlower: { name: 'Leaf Blower', blurb: 'A steady stream that shoves people around. Aim at the ground to hover.' },
  airHorn: { name: 'Air Horn', blurb: 'Huge close-range HONK. Kicks you back too.' },
  pumpRifle: { name: 'Pump Rifle', blurb: 'Long-range precise shots that pump in extra air. Needs good aim.' },
};

export const MOD_INFO: Record<ModId, { name: string; plus: string; minus: string }> = {
  wideNozzle: { name: 'Wide Nozzle', plus: 'Wider blast', minus: 'Shorter range' },
  bigTank: { name: 'Big Tank', plus: 'More ammo', minus: 'Slower reload' },
  chargeValve: { name: 'Charge Valve', plus: 'Harder hits', minus: 'Slower fire rate' },
  quickValve: { name: 'Quick Valve', plus: 'Faster fire rate', minus: 'Weaker hits' },
  longBarrel: { name: 'Long Barrel', plus: 'Longer range', minus: 'Narrower blast' },
};

export const UTILITY_INFO: Record<UtilityId, { name: string; blurb: string }> = {
  bouncePad: { name: 'Bounce Pad', blurb: 'Throw it down to launch yourself or surprise enemies.' },
  airGrenade: { name: 'Air Grenade', blurb: 'Blasts everyone nearby outward.' },
  inflatableWall: { name: 'Inflatable Wall', blurb: 'Blocks shots. Thrown while falling, it catches you.' },
  vacuumGrenade: { name: 'Vacuum Grenade', blurb: 'Sucks nearby players together for a big follow-up.' },
};

/** Effective weapon stats after mods. Used by the server and by client prediction. */
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
  blastRadius: number;
  inflation: number;
  knockback: number;
  range: number;
  cone: number;
  rayRadius: number;
  recoil: number;
  hoverLift: number;
  hoverTime: number;
}

export function weaponIndex(id: WeaponId): number {
  return WEAPON_IDS.indexOf(id);
}

export function computeWeaponStats(id: WeaponId, mods: readonly ModId[]): WeaponStats {
  const b = BALANCE.weapons[id] as (typeof BALANCE.weapons)['leafBlower'];
  const w: WeaponStats = {
    id,
    kind: b.kind as WeaponKind,
    ammo: b.ammo,
    reloadTime: b.reloadTime,
    fireCooldown: b.fireCooldown,
    chargeTime: b.chargeTime,
    tapPower: b.tapPower,
    projSpeed: b.projSpeed,
    projRadius: b.projRadius,
    projLifetime: b.projLifetime,
    projGravity: b.projGravity,
    blastRadius: b.blastRadius,
    inflation: b.inflation,
    knockback: b.knockback,
    range: b.range,
    cone: b.cone,
    rayRadius: b.rayRadius,
    recoil: b.recoil,
    hoverLift: b.hoverLift ?? 0,
    hoverTime: b.hoverTime ?? 0,
  };
  const M = BALANCE.mods;
  for (const m of mods) {
    switch (m) {
      case 'wideNozzle':
        w.projRadius *= M.wideNozzle.radius;
        w.blastRadius *= M.wideNozzle.blast;
        w.cone *= M.wideNozzle.cone;
        w.rayRadius *= M.wideNozzle.radius * 1.5;
        w.projLifetime *= M.wideNozzle.range;
        w.range *= M.wideNozzle.range;
        break;
      case 'bigTank':
        w.ammo = w.kind === 'stream' ? w.ammo * M.bigTank.ammo : Math.round(w.ammo * M.bigTank.ammo);
        w.reloadTime *= M.bigTank.reload;
        break;
      case 'chargeValve':
        w.knockback *= M.chargeValve.knockback;
        w.inflation *= M.chargeValve.inflation;
        w.fireCooldown *= M.chargeValve.fireCooldown;
        w.chargeTime *= M.chargeValve.chargeTime;
        break;
      case 'quickValve':
        w.fireCooldown *= M.quickValve.fireCooldown;
        w.chargeTime *= M.quickValve.chargeTime;
        w.knockback *= M.quickValve.knockback;
        w.inflation *= M.quickValve.inflation;
        break;
      case 'longBarrel':
        w.projLifetime *= M.longBarrel.range;
        w.range *= M.longBarrel.range;
        w.projRadius *= M.longBarrel.radius;
        w.rayRadius *= M.longBarrel.radius;
        w.cone *= M.longBarrel.cone;
        w.blastRadius *= M.longBarrel.blast;
        break;
    }
  }
  return w;
}

/** Cleans up an untrusted loadout (from the network or storage). */
export function sanitizeLoadout(raw: unknown, allowed?: { mods?: readonly string[]; utils?: readonly string[] }): Loadout {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Loadout>;
  const weapon = WEAPON_IDS.includes(r.weapon as WeaponId) ? (r.weapon as WeaponId) : DEFAULT_LOADOUT.weapon;
  const mods: ModId[] = [];
  for (const m of Array.isArray(r.mods) ? r.mods : []) {
    if (!MOD_IDS.includes(m as ModId) || mods.includes(m as ModId)) continue;
    if (allowed?.mods && !allowed.mods.includes(m)) continue;
    if (EXCLUSIVE_MODS.some(([a, b]) => (m === a && mods.includes(b)) || (m === b && mods.includes(a)))) continue;
    if (mods.length < MAX_MODS) mods.push(m as ModId);
  }
  const utils: UtilityId[] = [];
  for (const u of Array.isArray(r.utils) ? r.utils : []) {
    if (!UTILITY_IDS.includes(u as UtilityId) || utils.includes(u as UtilityId)) continue;
    if (allowed?.utils && !allowed.utils.includes(u)) continue;
    if (utils.length < 2) utils.push(u as UtilityId);
  }
  for (const d of DEFAULT_LOADOUT.utils) if (utils.length < 2 && !utils.includes(d)) utils.push(d);
  for (const u of UTILITY_IDS) if (utils.length < 2 && !utils.includes(u)) utils.push(u);
  return { weapon, mods, utils: [utils[0], utils[1]] };
}

export function utilityCooldown(id: UtilityId): number {
  return BALANCE.utilities[id].cooldown;
}
