import { PLAYER_COLORS } from '../../shared/colors';
import { COSMETIC_SLOTS, type CosmeticItem, type CosmeticSlot, type Cosmetics, ITEMS, ITEM_BY_ID, SLOT_INFO, cosmeticKey, ownsItem, unlockLevelOf } from '../../shared/economy';
import type { WeaponId } from '../../shared/loadout';
import type { Audio } from '../audio/audio';
import type { AccountClient } from '../net/account';
import { faceTexture } from '../render/facePhoto';
import { FACES_COVERING_EYES } from '../render/looks';
import { TubePreview } from '../render/preview';
import { lookFromCosmetics, patternMask } from '../render/tubeMan';
import { clear, el, hexColor } from './dom';

const SLOT_ICONS: Record<CosmeticSlot, string> = {
  body: '🧍',
  color: '🎨',
  accent: '🖌️',
  pattern: '🦓',
  face: '🙂',
  eyes: '👀',
  hat: '🎩',
  base: '🛢️',
  trail: '✨',
  finish: '🎯',
  taunt: '💃',
  koFx: '💥',
  sound: '🔊',
};

const ICONS: Record<string, string> = {
  'body.classic': '🎈',
  'body.chonk': '🍩',
  'body.noodle': '🍝',
  'body.bighead': '🧠',
  'body.bor': '💪',
  'body.abag': '👃',
  'body.sol': '💨',
  'body.kesty': '🤖',
  'face.smile': '🙂',
  'face.blush': '☺️',
  'face.tongue': '😛',
  'face.grin': '😁',
  'face.sleepy': '😴',
  'face.surprised': '😮',
  'face.winky': '😉',
  'face.angry': '😠',
  'face.derp': '🤪',
  'face.cyclops': '👁️',
  'face.mustache': '🥸',
  'face.fangs': '🧛',
  'face.shades': '😎',
  'face.visor': '🤖',
  'eyes.classic': '⚪',
  'eyes.dot': '⚫',
  'eyes.lashes': '👁️',
  'eyes.cat': '🐱',
  'eyes.star': '🤩',
  'eyes.heart': '😍',
  'eyes.googly': '👀',
  'eyes.spiral': '🌀',
  'eyes.sparkle': '🥺',
  'hat.spikes': '🌱',
  'hat.flower': '🌼',
  'hat.bucket': '👒',
  'hat.party': '🥳',
  'hat.cap': '🧢',
  'hat.beanie': '🧶',
  'hat.papercrown': '👑',
  'hat.antenna': '📡',
  'hat.cone': '🚧',
  'hat.chef': '🍳',
  'hat.bunny': '🐰',
  'hat.propeller': '🚁',
  'hat.tophat': '🎩',
  'hat.cowboy': '🤠',
  'hat.headphones': '🎧',
  'hat.viking': '🪖',
  'hat.pirate': '🏴‍☠️',
  'hat.halo': '😇',
  'hat.wizard': '🧙',
  'hat.unicorn': '🦄',
  'hat.laurel': '🌿',
  'base.classic': '💨',
  'base.tire': '🛞',
  'base.pot': '🪴',
  'base.trash': '🗑️',
  'base.duck': '🦆',
  'base.cloud': '☁️',
  'base.cake': '🎂',
  'base.rocket': '🚀',
  'base.gold': '🏆',
  'trail.none': '🚫',
  'trail.bubbles': '🫧',
  'trail.smoke': '💨',
  'trail.confetti': '🎊',
  'trail.sparkles': '✨',
  'trail.hearts': '💕',
  'trail.notes': '🎶',
  'trail.fire': '🔥',
  'trail.rainbow': '🌈',
  'trail.comet': '☄️',
  'taunt.burp': '🫧',
  'taunt.wave': '👋',
  'taunt.spin': '🌀',
  'taunt.noodle': '🍜',
  'taunt.bow': '🙇',
  'taunt.flex': '💪',
  'taunt.dance': '🕺',
  'taunt.deflate': '🎈',
  'taunt.backflip': '🤸',
  'koFx.confetti': '🎊',
  'koFx.bubbles': '🫧',
  'koFx.stars': '⭐',
  'koFx.popcorn': '🍿',
  'koFx.balloons': '🎈',
  'koFx.hearts': '💖',
  'koFx.fireworks': '🎆',
  'koFx.splash': '🎨',
  'koFx.rainbow': '🌈',
  'koFx.supernova': '💥',
  'sound.classic': '🔊',
  'sound.boing': '🟣',
  'sound.kazoo': '🎶',
  'sound.duck': '🦆',
  'sound.slide': '🎵',
  'sound.trumpet': '🎺',
};

const FINISH_CSS: Record<string, string> = {
  bubblegum: '#ff8fd8',
  wood: 'repeating-linear-gradient(170deg, #b87a45 0 5px, #9c6435 5px 7px, #c98d55 7px 11px)',
  candy: 'repeating-linear-gradient(45deg, #fff 0 6px, #ff3b5c 6px 12px)',
  frost: 'linear-gradient(135deg, #ffffff, #c4ecff 50%, #7fd4ff)',
  chrome: 'linear-gradient(135deg, #fff, #9aa3b8 45%, #fff 55%, #c9d2e8)',
  neon: '#39ff88',
  rainbow: 'linear-gradient(180deg, #ff3b5c, #ff8a1f, #ffd60a, #8ee000, #2ec5ff, #3d6bff, #9b4dff)',
  gold: 'linear-gradient(135deg, #fff3b0, #ffc933 45%, #d99a00)',
  lava: 'radial-gradient(circle at 30% 60%, #ffd23a 0 2px, transparent 3px) 0 0 / 11px 11px, linear-gradient(45deg, transparent 45%, #ff6a00 48% 52%, transparent 55%) 0 0 / 14px 14px, #2a1712',
  galaxy: 'radial-gradient(circle at 30% 30%, #fff 1px, transparent 2px) 0 0 / 9px 9px, linear-gradient(135deg, #1b0b3a, #4a1a7a, #0b2a5a)',
  diamond: 'conic-gradient(from 20deg, #ffffff, #cfefff, #ffffff, #e6f7ff, #ffffff, #bfe9ff, #ffffff)',
};

/** Items the player has already seen in the locker (for the NEW badges). Per browser. */
const SEEN_KEY = 'bubba.lockerSeen.v1';

function loadSeen(): Set<string> {
  try {
    const raw = JSON.parse(window.localStorage.getItem(SEEN_KEY) ?? '[]') as unknown;
    return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

function saveSeen(seen: Set<string>): void {
  try {
    window.localStorage.setItem(SEEN_KEY, JSON.stringify([...seen]));
  } catch {
    // Private mode or storage full: the badges just show again next time.
  }
}

/** CSS for a color swatch, with a hint of its shine (metal foil, pearl, glow). */
function colorCss(index: number): string {
  const c = PLAYER_COLORS[index];
  if (!c) return '#ffffff';
  const hex = hexColor(c.hex);
  if (c.shine === 'metal') return `linear-gradient(135deg, #ffffff 0%, ${hex} 35%, ${hex} 60%, rgba(0,0,0,.35) 100%), ${hex}`;
  if (c.shine === 'pearl') return `linear-gradient(135deg, #ffd6f2, ${hex} 40%, #d6f0ff 75%, ${hex})`;
  if (c.shine === 'glow') return `radial-gradient(circle, #ffffff 0 15%, ${hex} 60%)`;
  return hex;
}

const patternSwatches = new Map<string, string>();

/** A pattern swatch drawn from the real pattern mask, in your body and accent colors. */
function patternSwatch(key: string, body: number, accent: number): string {
  const id = `${key}|${body}|${accent}`;
  const cached = patternSwatches.get(id);
  if (cached) return cached;
  const mask = patternMask(key);
  if (!mask) return hexColor(body);
  const c = document.createElement('canvas');
  c.width = c.height = 48;
  const g = c.getContext('2d')!;
  // About the patch of body you'd see from the front (the mask is stretched along the tube).
  const whole = key === 'ombre' || key === 'galaxy';
  g.drawImage(mask, 0, 0, whole ? 128 : 64, whole || key === 'flames' || key === 'lightning' ? 256 : 160, 0, 0, 48, 48);
  const img = g.getImageData(0, 0, 48, 48);
  const d = img.data;
  const rgb = (h: number) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
  const b = rgb(body);
  // Matching accent: the body color, darker (as the body shader does).
  const a = accent >= 0 ? rgb(accent) : b.map((v) => v * 0.73);
  for (let i = 0; i < d.length; i += 4) {
    const m = d[i] / 255;
    const hi = Math.max(0, d[i + 1] - d[i]);
    for (let k = 0; k < 3; k++) d[i + k] = Math.min(255, a[k] * (1 - m) + b[k] * m + hi);
    d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const url = `url(${c.toDataURL()}) center / cover`;
  patternSwatches.set(id, url);
  return url;
}

export interface LockerOptions {
  account: AccountClient;
  audio: Audio;
  weapon: WeaponId;
  onClose: () => void;
  onSignup: () => void;
}

/** The category list, in groups (a thin line between groups). */
const CATEGORY_GROUPS: readonly (readonly CosmeticSlot[])[] = (() => {
  const groups: CosmeticSlot[][] = [
    ['body', 'color', 'accent', 'pattern'],
    ['face', 'eyes', 'hat'],
    ['base', 'trail', 'finish'],
    ['taunt', 'koFx', 'sound'],
  ];
  // A slot added later still gets a row.
  const listed = new Set(groups.flat());
  const rest = COSMETIC_SLOTS.filter((s) => !listed.has(s));
  return rest.length ? [...groups, rest] : groups;
})();

const categoryName = (s: CosmeticSlot): string => (s === 'body' ? 'Body' : SLOT_INFO[s].plural);

/**
 * The locker: customize your tube man and buy cosmetics at fixed prices. Nothing here changes
 * how you play. Tap something you don't own to try it on in the preview, tap again to buy.
 */
export function buildLocker(opts: LockerOptions): { root: HTMLElement; dispose: () => void } {
  const { account, audio } = opts;
  let slot: CosmeticSlot = 'color';
  let pending: string | null = null;
  /** An item you're trying on (not owned yet): shown in the preview only. */
  let trying: CosmeticItem | null = null;
  const note = el('div', { class: 'locker-note' });
  const slotNote = el('div', { class: 'slot-note' });
  const coins = el('div', { class: 'locker-coins', attrs: { title: 'Your coins' } });
  const cats = el('div', { class: 'locker-cats', attrs: { role: 'tablist', 'aria-label': 'Categories' } });
  const grid = el('div', { class: 'item-grid' });
  // NEW badges: anything not seen before this visit stays marked until you close the locker. On
  // your very first visit everything is new, so nothing is marked (it would all be NEW).
  const seen = loadSeen();
  if (seen.size === 0) {
    for (const i of ITEMS) seen.add(i.id);
    saveSeen(seen);
  }
  const fresh = new Set(ITEMS.filter((i) => !seen.has(i.id)).map((i) => i.id));
  const viewed = new Set<CosmeticSlot>();
  const wearing = (): Partial<Cosmetics> => (trying ? { ...account.profile.cosmetics, [trying.slot]: trying.id } : account.profile.cosmetics);
  const colorIndex = (c: Partial<Cosmetics>) => Number(cosmeticKey(c, 'color'));
  const lookOf = () => lookFromCosmetics(wearing(), colorIndex(wearing()));
  const colorOf = () => PLAYER_COLORS[colorIndex(wearing())]?.hex ?? 0xff3b5c;
  const accentOf = () => {
    const k = cosmeticKey(wearing(), 'accent');
    return k === 'match' ? -1 : (PLAYER_COLORS[Number(k)]?.hex ?? -1);
  };
  let preview: TubePreview | null = null;
  try {
    preview = new TubePreview(colorOf(), lookOf(), opts.weapon);
    // Your face scan, if you have one showing.
    const f = account.face;
    if (f?.version && !f.hidden && account.account?.id) preview.setFace(faceTexture(account.account.id, f.version));
  } catch {
    // No WebGL for a second canvas: the locker still works, just without the 3D preview.
    preview = null;
  }

  const swatch = (item: CosmeticItem): HTMLElement => {
    if (item.slot === 'color') return el('div', { class: 'swatch-big', style: { background: colorCss(Number(item.key)) } });
    if (item.slot === 'accent') {
      // Split swatch: your body color with this accent.
      const body = hexColor(colorOf());
      const accent = item.key === 'match' ? body : colorCss(Number(item.key));
      return el('div', { class: 'swatch-big split' }, el('span', { style: { background: body } }), el('span', { style: { background: accent } }));
    }
    if (item.slot === 'pattern') return el('div', { class: 'swatch-big', style: { background: patternSwatch(item.key, colorOf(), accentOf()) } });
    if (item.slot === 'finish') return el('div', { class: 'swatch-big', style: { background: item.key === 'team' ? hexColor(colorOf()) : FINISH_CSS[item.key] } });
    return el('div', { class: 'icon', text: ICONS[item.id] ?? '✨' });
  };

  /** Shows an item off in the preview (taunts play, trails hop, sounds play). */
  const tryItem = (item: CosmeticItem) => {
    if (item.slot === 'taunt') {
      preview?.taunt(item.key);
      audio.tauntSound(cosmeticKey(account.profile.cosmetics, 'sound'), null);
    } else if (item.slot === 'sound') {
      audio.koSound(item.key, null);
      if (item.key === 'classic') audio.squeal(null);
    } else if (item.slot === 'trail' || item.slot === 'base') {
      preview?.hop();
    }
  };

  /** Wear a random owned item in every slot. */
  const randomize = async () => {
    const p = account.profile;
    const pick: Partial<Cosmetics> = {};
    for (const s of COSMETIC_SLOTS) {
      const mine = ITEMS.filter((i) => i.slot === s && ownsItem(p.owned, i.id, unlockLevelOf(p)));
      pick[s] = mine[Math.floor(Math.random() * mine.length)]?.id ?? p.cosmetics[s];
    }
    trying = null;
    pending = null;
    note.textContent = '';
    try {
      await account.equip(pick);
      preview?.taunt(cosmeticKey(pick, 'taunt'));
    } catch (err) {
      note.textContent = (err as Error).message;
    }
  };

  const slotHint = (s: CosmeticSlot): string => {
    const face = cosmeticKey(wearing(), 'face');
    if (s === 'eyes' && FACES_COVERING_EYES.has(face)) return `Your ${ITEM_BY_ID.get(`face.${face}`)?.name ?? face} face covers your eyes. Pick another face to see these.`;
    if (s === 'accent') return 'Colors your arms, your base and the dark parts of your pattern. Team games switch it off so teams are easy to tell apart.';
    if (s === 'trail') return "Shows behind you when you're launched, dashing or flying fast. Everyone sees it.";
    if (s === 'taunt') return 'Tap one to see it. Taunt in a match with the taunt key.';
    return '';
  };

  /** Scrolls the category list (not the page) so a row is fully in view. */
  const reveal = (b: HTMLElement) => {
    const c = cats.getBoundingClientRect();
    const r = b.getBoundingClientRect();
    const dx = r.left < c.left ? r.left - c.left - 12 : r.right > c.right ? r.right - c.right + 12 : 0;
    const dy = r.top < c.top ? r.top - c.top - 6 : r.bottom > c.bottom ? r.bottom - c.bottom + 6 : 0;
    if (dx || dy) cats.scrollBy({ left: dx, top: dy, behavior: 'smooth' });
  };

  // The category list is built once (so its scroll position stays put) and restyled on draw.
  const catRows = new Map<CosmeticSlot, { btn: HTMLButtonElement; dot: HTMLElement }>();
  CATEGORY_GROUPS.forEach((group, gi) => {
    if (gi > 0) cats.append(el('div', { class: 'cat-sep', attrs: { 'aria-hidden': 'true' } }));
    for (const s of group) {
      const dot = el('span', { class: 'new-dot', attrs: { title: 'Something new in here' } });
      const btn = el(
        'button',
        {
          class: 'cat',
          attrs: { role: 'tab', title: SLOT_INFO[s].plural },
          on: {
            click: () => {
              slot = s;
              pending = null;
              trying = null;
              note.textContent = '';
              draw();
              grid.scrollTop = 0;
              reveal(btn);
            },
          },
        },
        el('span', { class: 'cat-icon', text: SLOT_ICONS[s], attrs: { 'aria-hidden': 'true' } }),
        el('span', { class: 'cat-name', text: categoryName(s) }),
        dot,
      );
      catRows.set(s, { btn, dot });
      cats.append(btn);
    }
  });

  const draw = () => {
    const p = account.profile;
    coins.textContent = `🪙 ${p.coins.toLocaleString('en-US')}`;
    // Everything in this category has now been seen (the badges stay up until the locker closes).
    if (!viewed.has(slot)) {
      viewed.add(slot);
      for (const i of ITEMS) if (i.slot === slot) seen.add(i.id);
      saveSeen(seen);
    }
    preview?.showTrails(slot === 'trail');
    for (const [s, row] of catRows) {
      const on = s === slot;
      row.btn.classList.toggle('on', on);
      row.btn.setAttribute('aria-selected', String(on));
      row.dot.classList.toggle('hidden', viewed.has(s) || !ITEMS.some((i) => i.slot === s && fresh.has(i.id)));
    }
    slotNote.textContent = slotHint(slot);
    clear(grid);
    for (const item of ITEMS.filter((i) => i.slot === slot)) {
      const owned = ownsItem(p.owned, item.id, unlockLevelOf(p));
      const levelLocked = !!item.levelReq && !owned;
      const equipped = p.cosmetics[item.slot] === item.id;
      // One short status line, only when it matters (nothing for things you own).
      let status: HTMLElement | null = null;
      if (equipped) status = el('div', { class: 'status on', text: '✓ Wearing' });
      else if (levelLocked) status = el('div', { class: 'status level', text: `🔒 Lv ${item.levelReq}` });
      else if (owned) status = null;
      else if (pending === item.id) status = el('div', { class: 'status buy', text: `Tap again to buy · 🪙 ${item.price}` });
      else status = el('div', { class: `status price${p.coins < item.price ? ' short' : ''}`, text: `🪙 ${item.price}` });
      const card = el(
        'button',
        {
          class: `item${equipped ? ' equipped' : ''}${owned ? '' : ' locked'}${levelLocked ? ' level-locked' : ''}${trying?.id === item.id ? ' trying' : ''}`,
          attrs: { title: item.blurb ?? item.name, 'aria-pressed': String(equipped) },
          on: {
            click: async () => {
              tryItem(item);
              note.textContent = '';
              try {
                if (owned) {
                  trying = null;
                  pending = null;
                  if (!equipped) await account.equip({ [item.slot]: item.id });
                } else if (levelLocked) {
                  trying = item;
                  pending = null;
                  note.textContent = `${item.name} is a level ${item.levelReq} reward (you're level ${p.level}). It can't be bought: keep playing to earn it.`;
                } else if (!p.isAccount) {
                  trying = item;
                  note.textContent = 'Make a free account to buy things. Your coins and progress come with you.';
                  note.append(el('button', { class: 'btn small blue', text: 'Sign up', on: { click: opts.onSignup } }));
                } else if (p.coins < item.price) {
                  trying = item;
                  note.textContent = `You need ${item.price - p.coins} more coins. Coins come from playing matches.`;
                } else if (pending !== item.id) {
                  trying = item;
                  pending = item.id;
                } else {
                  pending = null;
                  trying = null;
                  await account.buy(item.id);
                  audio.koSound('trumpet', null);
                  note.textContent = `${item.name} is yours!`;
                }
              } catch (err) {
                note.textContent = (err as Error).message;
              }
              draw();
            },
          },
        },
        swatch(item),
        fresh.has(item.id) ? el('div', { class: 'new-badge', text: 'NEW' }) : null,
        el('div', { class: 'name', text: item.name }),
        status,
      );
      grid.append(card);
    }
    preview?.setLook(colorOf(), lookOf(), opts.weapon);
  };

  const unsub = account.onChange(draw);
  draw();
  preview?.start();

  const head = el(
    'div',
    { class: 'locker-head' },
    el('h2', { text: 'Locker' }),
    coins,
    el(
      'button',
      { class: 'btn small ghost randomize', attrs: { title: 'Wear a random mix of things you own', 'aria-label': 'Randomize' }, on: { click: randomize } },
      '🎲',
      el('span', { class: 'randomize-word', text: ' Randomize' }),
    ),
    el('button', { class: 'btn done-top', text: 'DONE', on: { click: opts.onClose } }),
  );
  const left = el(
    'div',
    { class: 'locker-left' },
    preview ? preview.canvas : el('div', { class: 'preview-canvas no-3d', text: '🎈' }),
    el('div', { class: 'looks-note', text: 'Everything here is just for looks. Nothing changes how you play.' }),
  );
  const root = el(
    'div',
    { class: 'overlay interactive' },
    el('div', { class: 'panel locker' }, head, el('div', { class: 'locker-body' }, left, cats, el('div', { class: 'locker-right' }, slotNote, grid, note))),
  );
  return {
    root,
    dispose: () => {
      unsub();
      preview?.dispose();
    },
  };
}
