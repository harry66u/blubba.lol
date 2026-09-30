import {
  type Loadout,
  PART_IDS,
  PART_INFO,
  PART_SLOTS,
  PART_SLOT_INFO,
  type PartId,
  type PartSlot,
  SLOT_PARTS,
  UTILITY_IDS,
  UTILITY_INFO,
  type UtilityId,
  WEAPON_IDS,
  WEAPON_INFO,
  type WeaponId,
  type WeaponStats,
  computeWeaponStats,
  partName,
  sanitizeLoadout,
  weaponRange,
} from '../../shared/loadout';
import { type Cosmetics, ITEMS, cosmeticKey, ownsItem, unlockLevel } from '../../shared/economy';
import { PLAYER_COLORS } from '../../shared/colors';
import { GunPreview } from '../render/gunPreview';
import { clear, el } from './dom';

const KEY = 'bubba.loadout.v1';
const BUILDS_KEY = 'bubba.builds.v1';
export const MAX_BUILDS = 3;

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

/** A named build you saved to switch to quickly (kept in this browser only). */
export interface SavedBuild {
  name: string;
  loadout: Loadout;
}

export function cleanBuildName(raw: unknown, fallback: string): string {
  const s = typeof raw === 'string' ? raw.replace(/[^\p{L}\p{N} '!?.\-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 16) : '';
  return s || fallback;
}

export function loadBuilds(): (SavedBuild | null)[] {
  const out: (SavedBuild | null)[] = [];
  try {
    const raw = JSON.parse(window.localStorage.getItem(BUILDS_KEY) ?? '[]') as unknown;
    if (Array.isArray(raw)) {
      for (let i = 0; i < MAX_BUILDS; i++) {
        const b = raw[i] as { name?: unknown; loadout?: unknown } | null;
        out.push(b && typeof b === 'object' && b.loadout ? { name: cleanBuildName(b.name, `Build ${i + 1}`), loadout: sanitizeLoadout(b.loadout) } : null);
      }
    }
  } catch {
    // ignore
  }
  while (out.length < MAX_BUILDS) out.push(null);
  return out;
}

export function saveBuilds(builds: (SavedBuild | null)[]): void {
  try {
    window.localStorage.setItem(BUILDS_KEY, JSON.stringify(builds.slice(0, MAX_BUILDS)));
  } catch {
    // ignore
  }
}

export const WEAPON_ICON: Record<WeaponId, string> = {
  airCannon: '💨',
  leafBlower: '🍃',
  airHorn: '📯',
  pumpRifle: '🎯',
  bubbleShotgun: '🫧',
  balloonMortar: '🎈',
  popGun: '🍾',
  skyRocket: '🚀',
  gustRepeater: '🌀',
  windLance: '🔱',
};
const UTIL_ICON: Partial<Record<string, string>> = Object.fromEntries(UTILITY_IDS.map((u) => [u, UTILITY_INFO[u].icon]));
const SLOT_ICON: Record<PartSlot, string> = { barrel: '🔭', tank: '🛢️', valve: '🔧', nozzle: '🌬️', grip: '✊' };

/** Same swatches as the locker. */
const FINISH_CSS: Record<string, string> = {
  bubblegum: '#ff8fd8',
  candy: 'repeating-linear-gradient(45deg, #fff 0 6px, #ff3b5c 6px 12px)',
  chrome: 'linear-gradient(135deg, #fff, #b8c4d8 50%, #eef3fb)',
  neon: '#39ff88',
  gold: 'linear-gradient(135deg, #fff3b0, #ffc933 45%, #d99a00)',
  galaxy: 'radial-gradient(circle at 30% 30%, #fff 1px, transparent 2px) 0 0 / 9px 9px, linear-gradient(135deg, #1b0b3a, #4a1a7a, #0b2a5a)',
};

// --- Stats shown as bars -------------------------------------------------------------------------

interface StatLine {
  label: string;
  /** Value in display units. */
  value: number;
  /** 0..1 bar fill. */
  bar: number;
  /** 1: more is better, -1: less is better, 0: neither (just different). */
  better: 1 | -1 | 0;
  text: string;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** The stat bars for a weapon build (the relevant ones for its kind). */
export function statLines(w: WeaponStats): StatLine[] {
  const out: StatLine[] = [];
  const stream = w.kind === 'stream';
  const perShot = stream ? '/s' : w.kind === 'spread' ? ' (all pellets)' : '';
  // Knockback: the Air Cannon's full-charge shot is 100%.
  const kb = stream ? w.knockback / 22 : w.knockback;
  out.push({ label: 'Knockback', value: kb, bar: clamp01(kb / 1.8), better: 1, text: `${Math.round(kb * 100)}%${perShot}` });
  out.push({ label: 'Inflation', value: w.inflation, bar: clamp01(w.inflation / 0.3), better: 1, text: `+${(w.inflation * 100).toFixed(w.inflation < 0.05 ? 1 : 0)}%${perShot}` });
  if (stream) out.push({ label: 'Fire rate', value: 99, bar: 1, better: 1, text: 'Continuous' });
  else {
    const rate = 1 / Math.max(0.03, w.auto ? w.fireCooldown : w.fireCooldown + 0.1);
    out.push({ label: 'Fire rate', value: rate, bar: clamp01(Math.log(rate / 0.6) / Math.log(22 / 0.6)), better: 1, text: `${rate.toFixed(rate < 3 ? 1 : 0)}/s` });
  }
  out.push({ label: w.auto || stream ? 'Spin-up' : 'Charge time', value: w.chargeTime, bar: clamp01(w.chargeTime / 1.4), better: -1, text: `${w.chargeTime.toFixed(2)}s` });
  const range = weaponRange(w);
  out.push({ label: 'Range', value: range, bar: clamp01(Math.sqrt(range / 110)), better: 1, text: `${Math.round(range)} m` });
  out.push({ label: 'Ammo', value: w.ammo, bar: clamp01(Math.sqrt(w.ammo / 40)), better: 1, text: stream ? `${w.ammo.toFixed(1)}s` : String(w.ammo) });
  out.push({ label: 'Reload', value: w.reloadTime, bar: clamp01(w.reloadTime / 3.5), better: -1, text: `${w.reloadTime.toFixed(1)}s` });
  if (w.kind === 'projectile' && w.blastRadius > 0) out.push({ label: 'Blast', value: w.blastRadius, bar: clamp01(w.blastRadius / 7), better: 1, text: `${w.blastRadius.toFixed(1)} m` });
  else if (w.kind === 'projectile') out.push({ label: 'Shot size', value: w.projRadius, bar: clamp01(w.projRadius / 0.6), better: 1, text: `${w.projRadius.toFixed(2)} m` });
  else if (w.kind === 'cone' || stream) {
    const deg = (w.cone * 360) / Math.PI;
    out.push({ label: 'Cone', value: deg, bar: clamp01(deg / 130), better: 1, text: `${Math.round(deg)}°` });
  } else if (w.kind === 'hitscan') out.push({ label: 'Hitbox', value: w.rayRadius, bar: clamp01(w.rayRadius / 0.3), better: 1, text: `${w.rayRadius.toFixed(2)} m` });
  else if (w.kind === 'spread') {
    const deg = (w.spread * 360) / Math.PI;
    // Wider hits more up close, tighter reaches further: neither is simply better.
    out.push({ label: 'Spread', value: deg, bar: clamp01(deg / 30), better: 0, text: `${deg.toFixed(0)}° → ${(deg * w.spreadCharged).toFixed(0)}°` });
  }
  out.push({ label: 'Move speed', value: w.moveMult, bar: clamp01((w.moveMult - 0.7) / 0.5), better: 1, text: `${Math.round(w.moveMult * 100)}%` });
  if (w.recoil > 0) out.push({ label: 'Recoil', value: w.recoil, bar: clamp01(w.recoil / 14), better: 0, text: w.recoil.toFixed(1) });
  return out;
}

function sameLoadout(a: Loadout, b: Loadout): boolean {
  return a.weapon === b.weapon && PART_SLOTS.every((s) => a.parts[s] === b.parts[s]) && a.utils[0] === b.utils[0] && a.utils[1] === b.utils[1];
}

function sameGun(a: Loadout, b: Loadout): boolean {
  return a.weapon === b.weapon && PART_SLOTS.every((s) => a.parts[s] === b.parts[s]);
}

export interface LoadoutLocks {
  parts: readonly string[];
  utils: readonly string[];
  ults?: readonly string[];
}

/** What the gun wears (from the player's cosmetics) and a way to change the finish. */
export interface GunLooks {
  cosmetics: () => Cosmetics;
  owned: () => readonly string[];
  equipFinish: (id: string) => Promise<void>;
  /** Called whenever the cosmetics change; returns an unsubscribe function. */
  onChange: (fn: () => void) => () => void;
}

export interface BuilderOptions {
  current: Loadout;
  onChange: (l: Loadout) => void;
  onClose: () => void;
  locked?: LoadoutLocks;
  note?: string;
  looks?: GunLooks;
}

type BuilderTab = 'weapon' | 'parts' | 'gadgets';
const TAB_IDS: readonly BuilderTab[] = ['weapon', 'parts', 'gadgets'];
const TAB_LABEL: Record<BuilderTab, string> = { weapon: 'Weapon', parts: 'Parts', gadgets: 'Gadgets' };
/** The tab that was open when the builder last closed (this visit to the page only). */
let lastTab: BuilderTab = 'weapon';

/**
 * The gun builder. Three tabs on the left, one shown at a time: the weapon, a part for each slot
 * (every part is a trade-off) and the two gadgets (utilities). The live 3D view of the gun, its
 * finish and the stat bars stay on the right and show what a change does (green better, red
 * worse; hovering or tapping something previews it). Up to three named builds can be saved in
 * this browser to switch quickly. `locked` (from account progression) lists what's still locked.
 */
export function buildLoadout(opts: BuilderOptions): { root: HTMLElement; dispose: () => void } {
  const locked = opts.locked ?? { parts: [], utils: [] };
  const allowed = { parts: PART_IDS.filter((p) => !locked.parts.includes(p)), utils: UTILITY_IDS.filter((u) => !locked.utils.includes(u)) };
  let l: Loadout = sanitizeLoadout(opts.current, allowed);
  /** What the bars compare against: the build before your last change, or (while hovering) the current one. */
  let before: Loadout | null = null;
  let hover: Loadout | null = null;
  let builds = loadBuilds();
  let tip = '';
  let tab: BuilderTab = lastTab;

  let preview: GunPreview | null = null;
  try {
    preview = new GunPreview();
  } catch {
    // No WebGL for another canvas: the builder still works without the 3D view.
    preview = null;
  }

  const gunColor = () => {
    const c = opts.looks?.cosmetics();
    return PLAYER_COLORS[Number(cosmeticKey(c, 'color'))]?.hex ?? 0xff3b5c;
  };
  const gunFinish = () => cosmeticKey(opts.looks?.cosmetics(), 'finish');

  // Layout: the parts that get redrawn.
  const tabBar = el('div', { class: 'builder-tabs', attrs: { role: 'tablist', 'aria-label': 'Loadout' } });
  const tabs = {} as Record<BuilderTab, { btn: HTMLButtonElement; icon: HTMLElement; sub: HTMLElement }>;
  const weaponRow = el('div', { class: 'weapon-row' });
  const weaponBlurb = el('div', { class: 'weapon-blurb' });
  const partRows = el('div', { class: 'part-rows' });
  const utilGrid = el('div', { class: 'util-grid' });
  const buildsRow = el('div', { class: 'builds-row' });
  const gunName = el('div', { class: 'gun-name' });
  const gunRole = el('div', { class: 'gun-role' });
  const statBox = el('div', { class: 'stat-box' });
  const tipBox = el('div', { class: 'part-tip' });
  const finishRow = el('div', { class: 'finish-row' });
  const noGl = preview ? null : el('div', { class: 'gun-canvas no-3d' });
  const pane = (t: BuilderTab, ...children: HTMLElement[]) =>
    el('div', { class: `builder-pane pane-${t}`, attrs: { role: 'tabpanel', id: `builder-pane-${t}`, 'aria-labelledby': `builder-tab-${t}` } }, ...children);
  const panes: Record<BuilderTab, HTMLElement> = {
    weapon: pane('weapon', weaponRow, weaponBlurb),
    parts: pane('parts', el('p', { class: 'pane-intro', text: 'Every part is a trade-off. More unlock as you level up.' }), partRows),
    gadgets: pane('gadgets', el('p', { class: 'pane-intro', text: 'Pick two. A new pick replaces the older one.' }), utilGrid),
  };

  const commit = (next: Loadout) => {
    const clean = sanitizeLoadout(next, allowed);
    if (sameLoadout(clean, l)) return;
    before = l;
    l = clean;
    hover = null;
    opts.onChange(l);
    draw();
  };

  const setHover = (h: Loadout | null, text = '') => {
    hover = h;
    tip = text;
    drawStats();
  };

  const drawStats = () => {
    const shown = hover ?? l;
    const base = hover ? l : before && sameGun(before, l) ? null : before;
    const cur = statLines(computeWeaponStats(shown.weapon, shown.parts));
    const old = base ? statLines(computeWeaponStats(base.weapon, base.parts)) : null;
    clear(statBox);
    for (const s of cur) {
      const o = old?.find((x) => x.label === s.label) ?? null;
      const diff = o ? s.value - o.value : 0;
      const changed = o && Math.abs(diff) > 1e-6;
      const good = changed ? (s.better === 0 ? 'neutral' : Math.sign(diff) === s.better ? 'up' : 'down') : '';
      const lo = changed ? Math.min(s.bar, o!.bar) : s.bar;
      const hi = changed ? Math.max(s.bar, o!.bar) : s.bar;
      const pct = o && o.value !== 0 && changed ? Math.round((diff / Math.abs(o.value)) * 100) : 0;
      statBox.append(
        el(
          'div',
          { class: `stat-row ${good}` },
          el('span', { class: 'stat-label', text: s.label }),
          el(
            'div',
            { class: 'bar' },
            el('div', { class: 'fill', style: { width: `${Math.round(lo * 100)}%` } }),
            changed ? el('div', { class: `delta ${good}`, style: { left: `${Math.round(lo * 100)}%`, width: `${Math.max(1, Math.round((hi - lo) * 100))}%` } }) : null,
          ),
          el('span', { class: 'stat-val', text: s.text }),
          el('span', { class: `stat-diff ${good}`, text: changed && pct !== 0 && s.label !== 'Fire rate' ? `${pct > 0 ? '+' : ''}${pct}%` : changed ? (Math.sign(diff) > 0 ? '▲' : '▼') : '' }),
        ),
      );
    }
    tipBox.textContent = tip || (before && !hover ? 'Green: better than before. Red: worse.' : 'Hover or tap a part to see what it changes.');
    tipBox.classList.toggle('muted', !tip);
  };

  const drawTabs = () => {
    const changed = PART_SLOTS.filter((s) => l.parts[s] !== 'standard').length;
    tabs.weapon.icon.textContent = WEAPON_ICON[l.weapon];
    tabs.weapon.sub.textContent = WEAPON_INFO[l.weapon].name;
    tabs.parts.sub.textContent = changed ? `${changed} changed` : 'Standard';
    tabs.gadgets.sub.textContent = l.utils.map((u) => UTIL_ICON[u] ?? '✨').join(' ');
    tabs.gadgets.sub.title = l.utils.map((u) => UTILITY_INFO[u].name).join(' + ');
    for (const t of TAB_IDS) {
      const on = t === tab;
      tabs[t].btn.classList.toggle('on', on);
      tabs[t].btn.setAttribute('aria-selected', String(on));
      tabs[t].btn.tabIndex = on ? 0 : -1;
      panes[t].classList.toggle('hidden', !on);
    }
  };

  const setTab = (t: BuilderTab, focus = false) => {
    tab = lastTab = t;
    drawTabs();
    if (focus) tabs[t].btn.focus();
    // One scrolling column (phones held upright): bring the choices up under the header.
    if (panel.scrollHeight > panel.clientHeight + 2) {
      const top = panes[t].getBoundingClientRect().top - panel.getBoundingClientRect().top;
      const under = head.offsetHeight + 8;
      // (An instant jump: Chrome drops a smooth scroll started while the content just grew.)
      if (top > panel.clientHeight * 0.6 || top < under) panel.scrollTop += top - under;
    }
  };

  for (const t of TAB_IDS) {
    const icon = el('span', { class: 'bt-icon', text: t === 'parts' ? '🔧' : t === 'gadgets' ? '🧰' : '', attrs: { 'aria-hidden': 'true' } });
    const sub = el('span', { class: 'bt-sub' });
    const btn = el(
      'button',
      {
        class: 'builder-tab',
        attrs: { role: 'tab', id: `builder-tab-${t}`, 'aria-controls': `builder-pane-${t}` },
        on: {
          click: () => setTab(t),
          keydown: (e: KeyboardEvent) => {
            const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
            if (!d) return;
            e.preventDefault();
            setTab(TAB_IDS[(TAB_IDS.indexOf(t) + d + TAB_IDS.length) % TAB_IDS.length], true);
          },
        },
      },
      icon,
      el('span', { class: 'bt-text' }, el('span', { class: 'bt-label', text: TAB_LABEL[t] }), sub),
    );
    tabs[t] = { btn, icon, sub };
    tabBar.append(btn);
  }

  const drawBuilds = () => {
    clear(buildsRow);
    builds.forEach((b, i) => {
      const active = !!b && sameLoadout(b.loadout, l);
      const name = el('input', {
        class: 'build-name',
        attrs: { type: 'text', maxlength: '16', value: b?.name ?? '', placeholder: `Build ${i + 1}`, 'aria-label': `Build ${i + 1} name`, spellcheck: 'false' },
        on: {
          click: (e: Event) => {
            // The first click on a saved build switches to it; once it's in use, clicks edit its name.
            e.stopPropagation();
            if (b && !active) commit(b.loadout);
          },
          change: (e: Event) => {
            // Renames a saved build in place. (No redraw: that would swallow a click on SAVE
            // right after typing; an empty slot's name is used when SAVE is pressed.)
            if (!builds[i]) return;
            builds[i] = { ...builds[i]!, name: cleanBuildName((e.target as HTMLInputElement).value, `Build ${i + 1}`) };
            saveBuilds(builds);
          },
          keydown: (e: KeyboardEvent) => {
            // Typing a name must not also trigger the build (Enter) or anything else.
            e.stopPropagation();
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          },
        },
      });
      const save = el('button', {
        class: 'build-save',
        text: 'SAVE',
        attrs: { title: b ? `Save the current build over ${b.name}` : 'Save the current build in this slot' },
        on: {
          click: (e: Event) => {
            e.stopPropagation();
            const nm = cleanBuildName((name as HTMLInputElement).value, b?.name ?? WEAPON_INFO[l.weapon].name);
            builds = builds.map((x, j) => (j === i ? { name: nm, loadout: sanitizeLoadout(l) } : x));
            saveBuilds(builds);
            drawBuilds();
          },
        },
      });
      buildsRow.append(
        el(
          'div',
          {
            class: `build${active ? ' active' : ''}${b ? '' : ' empty'}`,
            attrs: b ? { role: 'button', tabindex: '0', title: `Use ${b.name} (${WEAPON_INFO[b.loadout.weapon].name})`, 'aria-pressed': String(active) } : {},
            on: b
              ? {
                  click: () => commit(b.loadout),
                  keydown: (e: KeyboardEvent) => {
                    if (e.key === 'Enter') commit(b.loadout);
                  },
                }
              : {},
          },
          el('span', { class: 'build-num', text: String(i + 1) }),
          name,
          el('span', { class: 'build-gun', text: b ? WEAPON_ICON[b.loadout.weapon] : '', attrs: { 'aria-hidden': 'true' } }),
          save,
        ),
      );
    });
  };

  const drawWeapons = () => {
    clear(weaponRow);
    for (const id of WEAPON_IDS) {
      const on = l.weapon === id;
      const next = { ...l, weapon: id };
      weaponRow.append(
        el(
          'button',
          {
            class: `weapon-btn${on ? ' selected' : ''}`,
            attrs: { title: WEAPON_INFO[id].blurb, 'aria-pressed': String(on) },
            on: {
              click: () => commit(next),
              mouseenter: () => !on && setHover(next, `${WEAPON_INFO[id].name}: ${WEAPON_INFO[id].blurb}`),
              mouseleave: () => setHover(null),
            },
          },
          el('span', { class: 'w-icon', text: WEAPON_ICON[id] }),
          el('span', { class: 'w-name', text: WEAPON_INFO[id].name }),
          el('span', { class: 'w-role', text: WEAPON_INFO[id].role }),
        ),
      );
    }
    const info = WEAPON_INFO[l.weapon];
    clear(weaponBlurb);
    weaponBlurb.append(
      el('span', { class: 'wb-icon', text: WEAPON_ICON[l.weapon], attrs: { 'aria-hidden': 'true' } }),
      el('div', {}, el('div', { class: 'wb-title' }, el('b', { text: info.name }), el('span', { class: 'wb-role', text: info.role })), el('div', { class: 'wb-text', text: info.blurb })),
    );
  };

  /** A part's full description (the tip line and the button's tooltip). */
  const partDesc = (slot: PartSlot, id: PartId) => {
    if (id === 'standard') return `Standard ${PART_SLOT_INFO[slot].name.toLowerCase()}: ${PART_SLOT_INFO[slot].standard}`;
    const info = PART_INFO[id];
    return `${info.name}: ${info.blurb} + ${info.plus}. − ${info.minus}.`;
  };

  const partButton = (slot: PartSlot, id: PartId) => {
    const on = l.parts[slot] === id;
    const isLocked = id !== 'standard' && locked.parts.includes(id);
    const next: Loadout = { ...l, parts: { ...l.parts, [slot]: id } };
    const desc = isLocked ? `${partDesc(slot, id)} Unlocks at level ${unlockLevel(id)}.` : partDesc(slot, id);
    return el(
      'button',
      {
        class: `part-btn${on ? ' selected' : ''}${isLocked ? ' locked' : ''}`,
        attrs: isLocked ? { 'aria-disabled': 'true', title: `Unlocks at level ${unlockLevel(id)}` } : { title: desc, 'aria-pressed': String(on) },
        on: {
          click: () => {
            if (!isLocked) commit(next);
            tip = desc;
            drawStats();
          },
          mouseenter: () => setHover(on || isLocked ? null : next, desc),
          mouseleave: () => setHover(null),
        },
      },
      isLocked ? el('span', { class: 'p-lock-icon', text: '🔒', attrs: { 'aria-hidden': 'true' } }) : null,
      el('span', { class: 'p-name', text: partName(id) }),
      isLocked ? el('span', { class: 'p-lock', text: `Lv ${unlockLevel(id)}` }) : null,
    );
  };

  const drawParts = () => {
    clear(partRows);
    for (const slot of PART_SLOTS) {
      const optsEl = el('div', { class: 'part-opts' });
      for (const id of SLOT_PARTS[slot]) optsEl.append(partButton(slot, id));
      // What's fitted now, in one quiet line (so every option doesn't need its own +/− box).
      const fitted = l.parts[slot];
      const info = fitted === 'standard' ? null : PART_INFO[fitted];
      const desc = info
        ? el('div', { class: 'part-desc' }, el('b', { text: `${info.name}: ` }), el('span', { class: 'plus', text: `+ ${info.plus}` }), ' · ', el('span', { class: 'minus', text: `− ${info.minus}` }))
        : el('div', { class: 'part-desc' }, el('b', { text: 'Standard: ' }), PART_SLOT_INFO[slot].standard);
      partRows.append(
        el(
          'div',
          { class: 'part-row' },
          el(
            'div',
            { class: 'slot-label' },
            el('span', { class: 'slot-icon', text: SLOT_ICON[slot], attrs: { 'aria-hidden': 'true' } }),
            el('div', { class: 'slot-text' }, el('b', { text: PART_SLOT_INFO[slot].name }), el('small', { text: PART_SLOT_INFO[slot].blurb })),
          ),
          el('div', { class: 'part-main' }, optsEl, desc),
        ),
      );
    }
  };

  const drawUtils = () => {
    clear(utilGrid);
    for (const id of UTILITY_IDS) {
      const slot = l.utils.indexOf(id);
      const isLocked = locked.utils.includes(id);
      const info = UTILITY_INFO[id as UtilityId];
      utilGrid.append(
        el(
          'button',
          {
            class: `gadget${slot >= 0 ? ' selected' : ''}${isLocked ? ' locked' : ''}`,
            attrs: isLocked ? { 'aria-disabled': 'true', title: `Unlocks at level ${unlockLevel(id)}` } : { title: info.blurb, 'aria-pressed': String(slot >= 0) },
            on: {
              click: () => {
                if (isLocked) {
                  tip = `${info.name} unlocks at level ${unlockLevel(id)}.`;
                  drawStats();
                  return;
                }
                if (slot >= 0) return;
                // Replace the older of the two picks.
                commit({ ...l, utils: [l.utils[1], id] });
              },
            },
          },
          el('span', { class: 'g-icon', text: UTIL_ICON[id] ?? '✨', attrs: { 'aria-hidden': 'true' } }),
          el('span', { class: 'g-name', text: info.name }),
          el('span', { class: 'g-blurb', text: info.blurb }),
          slot >= 0 ? el('span', { class: 'g-badge', text: String(slot + 1), attrs: { title: `Gadget ${slot + 1}` } }) : null,
          isLocked ? el('span', { class: 'g-lock', text: `🔒 Lv ${unlockLevel(id)}` }) : null,
        ),
      );
    }
  };

  const drawFinishes = () => {
    clear(finishRow);
    const looks = opts.looks;
    if (!looks) return;
    const cos = looks.cosmetics();
    const owned = looks.owned();
    finishRow.append(el('span', { class: 'finish-label', text: 'Finish' }));
    for (const item of ITEMS.filter((i) => i.slot === 'finish')) {
      if (!ownsItem(owned, item.id)) continue;
      const on = cos.finish === item.id;
      finishRow.append(
        el('button', {
          class: `finish-swatch${on ? ' selected' : ''}`,
          attrs: { title: item.name, 'aria-label': `${item.name} finish`, 'aria-pressed': String(on) },
          style: { background: item.key === 'team' ? `#${gunColor().toString(16).padStart(6, '0')}` : (FINISH_CSS[item.key] ?? '#ccc') },
          on: {
            click: () => {
              if (!on) void looks.equipFinish(item.id).catch(() => undefined);
            },
          },
        }),
      );
    }
    if (ITEMS.some((i) => i.slot === 'finish' && !ownsItem(owned, i.id))) finishRow.append(el('span', { class: 'finish-more', text: 'More in the Locker' }));
  };

  const drawGun = () => {
    const info = WEAPON_INFO[l.weapon];
    gunName.textContent = `${WEAPON_ICON[l.weapon]} ${info.name}`;
    gunRole.textContent = info.role;
    if (noGl) noGl.textContent = WEAPON_ICON[l.weapon];
    preview?.setGun(l.weapon, l.parts, gunColor(), gunFinish());
  };

  const draw = () => {
    drawTabs();
    drawBuilds();
    drawWeapons();
    drawParts();
    drawUtils();
    drawFinishes();
    drawGun();
    drawStats();
  };

  const unsub = opts.looks?.onChange(() => {
    drawFinishes();
    drawGun();
  });

  const head = el(
    'div',
    { class: 'builder-head' },
    el('h2', { text: 'Loadout' }),
    tabBar,
    el('button', { class: 'btn done-top', text: 'DONE', on: { click: opts.onClose } }),
    opts.note ? el('div', { class: 'note', text: opts.note }) : null,
  );
  const panel = el(
    'div',
    { class: 'panel loadout builder' },
    head,
    el('div', { class: 'builder-left' }, panes.weapon, panes.parts, panes.gadgets),
    el(
      'div',
      { class: 'builder-right' },
      el('div', { class: 'gun-view' }, preview ? preview.canvas : noGl, el('div', { class: 'gun-caption' }, gunName, gunRole)),
      finishRow,
      statBox,
      tipBox,
    ),
    el('div', { class: 'builds-bar' }, el('div', { class: 'label', text: 'Saved builds' }), buildsRow),
  );
  draw();
  const root = el('div', { class: 'overlay interactive' }, panel);
  return {
    root,
    dispose: () => {
      unsub?.();
      preview?.dispose();
      preview = null;
    },
  };
}
