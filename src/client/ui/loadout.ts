import {
  EXCLUSIVE_MODS,
  type Loadout,
  MAX_MODS,
  MOD_IDS,
  MOD_INFO,
  type ModId,
  UTILITY_IDS,
  UTILITY_INFO,
  type UtilityId,
  WEAPON_IDS,
  WEAPON_INFO,
  type WeaponId,
  computeWeaponStats,
  sanitizeLoadout,
} from '../../shared/loadout';
import { clear, el } from './dom';

const KEY = 'bubba.loadout.v1';

export function loadLoadout(): Loadout {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) return sanitizeLoadout(JSON.parse(raw));
  } catch {
    // ignore
  }
  return sanitizeLoadout({});
}

export function saveLoadout(l: Loadout): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(l));
  } catch {
    // ignore
  }
}

const WEAPON_ICON: Record<WeaponId, string> = { airCannon: '💨', leafBlower: '🍃', airHorn: '📯', pumpRifle: '🎯' };
const UTIL_ICON: Record<UtilityId, string> = { bouncePad: '🟣', airGrenade: '💥', inflatableWall: '🧱', vacuumGrenade: '🌀' };

/** 0..1 ratings used for the little stat bars on each weapon card. */
function ratings(id: WeaponId, mods: ModId[]): [string, number][] {
  const w = computeWeaponStats(id, mods);
  let punch: number;
  let range: number;
  let forgiveness: number;
  if (w.kind === 'projectile') {
    punch = w.knockback;
    range = (w.projSpeed * w.projLifetime) / 60;
    forgiveness = (w.projRadius + w.blastRadius * 0.3) / 1.6;
  } else if (w.kind === 'stream') {
    punch = 0.55;
    range = w.range / 60;
    forgiveness = w.cone / 0.6;
  } else if (w.kind === 'cone') {
    punch = w.knockback * 0.85;
    range = w.range / 60;
    forgiveness = w.cone / 0.6;
  } else {
    punch = w.knockback * 0.9;
    range = w.range / 90;
    forgiveness = w.rayRadius / 0.6;
  }
  const rate = w.kind === 'stream' ? 0.95 : Math.min(1, 0.45 / (w.fireCooldown + w.chargeTime * 0.5));
  return [
    ['Punch', Math.min(1, punch)],
    ['Range', Math.min(1, range)],
    ['Fire rate', rate],
    ['Aim forgiveness', Math.min(1, forgiveness)],
  ];
}

export interface LoadoutLocks {
  mods: readonly string[];
  utils: readonly string[];
}

/**
 * Loadout picker: one weapon, up to two mods (conflicting ones can't be combined), and two
 * utilities. `locks` (from account progression) lists what's still locked.
 */
export function buildLoadout(current: Loadout, onChange: (l: Loadout) => void, onClose: () => void, locked: LoadoutLocks = { mods: [], utils: [] }, note = ''): HTMLElement {
  let l: Loadout = { weapon: current.weapon, mods: [...current.mods], utils: [...current.utils] as [UtilityId, UtilityId] };
  const body = el('div');
  const draw = () => {
    clear(body);
    const weapons = el('div', { class: 'loadout-grid' });
    for (const id of WEAPON_IDS) {
      const bars = el('div', { class: 'bars' });
      for (const [k, v] of ratings(id, l.mods)) {
        bars.append(el('div', { class: 'bar-row' }, el('span', { text: k }), el('div', { class: 'bar' }, el('div', { style: { width: `${Math.round(v * 100)}%` } }))));
      }
      weapons.append(
        el(
          'button',
          {
            class: `card${l.weapon === id ? ' selected' : ''}`,
            on: {
              click: () => {
                l.weapon = id;
                commit();
              },
            },
          },
          el('div', { class: 'icon', text: WEAPON_ICON[id] }),
          el('div', { class: 'title', text: WEAPON_INFO[id].name }),
          el('div', { class: 'blurb', text: WEAPON_INFO[id].blurb }),
          bars,
        ),
      );
    }
    const mods = el('div', { class: 'chip-row' });
    for (const id of MOD_IDS) {
      const on = l.mods.includes(id);
      const isLocked = locked.mods.includes(id);
      const conflict = EXCLUSIVE_MODS.some(([a, b]) => (id === a && l.mods.includes(b)) || (id === b && l.mods.includes(a)));
      const full = !on && l.mods.length >= MAX_MODS;
      const disabled = isLocked || (!on && (conflict || full));
      mods.append(
        el(
          'button',
          {
            class: `chip${on ? ' selected' : ''}`,
            attrs: disabled ? { disabled: 'true', title: isLocked ? 'Unlock by playing' : conflict ? 'Conflicts with a mod you picked' : 'Two mods max' } : {},
            on: {
              click: () => {
                l.mods = on ? l.mods.filter((m) => m !== id) : [...l.mods, id];
                commit();
              },
            },
          },
          el('div', { class: 'title', text: `${isLocked ? '🔒 ' : ''}${MOD_INFO[id].name}` }),
          el('div', { class: 'plus', text: `+ ${MOD_INFO[id].plus}` }),
          el('div', { class: 'minus', text: `− ${MOD_INFO[id].minus}` }),
        ),
      );
    }
    const utils = el('div', { class: 'chip-row' });
    for (const id of UTILITY_IDS) {
      const slot = l.utils.indexOf(id);
      const isLocked = locked.utils.includes(id);
      utils.append(
        el(
          'button',
          {
            class: `chip${slot >= 0 ? ' selected' : ''}`,
            attrs: isLocked ? { disabled: 'true', title: 'Unlock by playing' } : {},
            on: {
              click: () => {
                if (slot >= 0) return;
                // Replace the older of the two picks.
                l.utils = [l.utils[1], id];
                commit();
              },
            },
          },
          el('div', { class: 'title', text: `${isLocked ? '🔒 ' : ''}${UTIL_ICON[id]} ${UTILITY_INFO[id].name}` }),
          el('div', { class: 'blurb', text: UTILITY_INFO[id].blurb }),
          slot >= 0 ? el('div', { class: 'slot', text: slot === 0 ? 'Key 1 (C)' : 'Key 2 (V)' }) : null,
        ),
      );
    }
    body.append(
      el('div', { class: 'label', text: 'Weapon' }),
      weapons,
      el('div', { class: 'label', style: 'margin-top:14px', text: `Mods (up to ${MAX_MODS}; every mod is a trade-off)` }),
      mods,
      el('div', { class: 'label', style: 'margin-top:14px', text: 'Utilities (pick 2)' }),
      utils,
    );
  };
  const commit = () => {
    l = sanitizeLoadout(l, { mods: MOD_IDS.filter((m) => !locked.mods.includes(m)), utils: UTILITY_IDS.filter((u) => !locked.utils.includes(u)) });
    onChange(l);
    draw();
  };
  draw();
  return el(
    'div',
    { class: 'overlay interactive' },
    el(
      'div',
      { class: 'panel loadout', style: 'max-width:min(980px,96vw);width:980px' },
      el('h2', { text: 'Loadout' }),
      note ? el('div', { class: 'note', text: note }) : null,
      body,
      el('div', { style: 'text-align:center;margin-top:16px' }, el('button', { class: 'btn', text: 'DONE', on: { click: onClose } })),
    ),
  );
}
