import type { LootKind } from '../../shared/game/events';
import type { UltId } from '../../shared/game/ults';
import { type PartSlot, UTILITY_IDS, UTILITY_INFO, type UtilityId, type WeaponId } from '../../shared/loadout';
import type { IconName } from './icons';
import type { PlayMode } from './menus';

/** Which Blubba icon stands for each mode, map, gun, gadget, ult and pickup. */

export const MODE_ICON: Record<PlayMode, IconName> = {
  any: 'globe',
  knockout: 'boom',
  suddenDeath: 'fire',
  teamKnockout: 'team',
  ball: 'ball',
  pump: 'pump',
  duel: 'duel',
  ranked: 'trophy',
};

const MAP_ICONS: Record<string, IconName> = {
  dealership: 'car',
  candy: 'lollipop',
  garage: 'parking',
  skatepark: 'skateboard',
  bounceHouse: 'castle',
  moonBase: 'rocket',
  pier: 'ferris',
  faceoff: 'flags',
  ballArena: 'ball',
  pumpArena: 'pump',
};

/** A map's icon (null: any map, the dice). */
export function mapIcon(id: string | null): IconName {
  return id ? (MAP_ICONS[id] ?? 'pin') : 'dice';
}

export const WEAPON_ICON: Record<WeaponId, IconName> = {
  airCannon: 'airCannon',
  leafBlower: 'leafBlower',
  airHorn: 'airBlaster',
  pumpRifle: 'target',
  bubbleShotgun: 'bubbles',
  balloonMortar: 'waterBalloon',
  popGun: 'cork',
  skyRocket: 'rocket',
  gustRepeater: 'swirl',
  windLance: 'trident',
};

export const UTIL_ICON: Record<UtilityId, IconName> = {
  bouncePad: 'bouncePad',
  airGrenade: 'grenade',
  inflatableWall: 'wall',
  vacuumGrenade: 'vortex',
  airMine: 'mine',
  heliumBomb: 'heliumBalloon',
  tornado: 'tornado',
};

/** A gadget's icon from its display name (the HUD knows gadgets by name). */
export function utilIconByName(name: string): IconName | null {
  const id = UTILITY_IDS.find((u) => UTILITY_INFO[u].name === name);
  return id ? UTIL_ICON[id] : null;
}

export const SLOT_ICON: Record<PartSlot, IconName> = { barrel: 'barrel', tank: 'tank', valve: 'wrench', nozzle: 'nozzle', grip: 'grip' };

export const ULT_ICON: Record<UltId, IconName> = {
  bigBlow: 'bigBlow',
  juice: 'syringe',
  chase: 'nose',
  cropDuster: 'gasCloud',
  robot: 'robot',
  pride: 'rainbow',
};

export const LOOT_ICON: Record<LootKind, IconName> = {
  deflate: 'bandage',
  mega: 'boom',
  turbo: 'bolt',
  gadgets: 'battery',
  feather: 'feather',
  spring: 'spring',
};
