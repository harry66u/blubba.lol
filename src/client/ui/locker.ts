import { PLAYER_COLORS } from '../../shared/colors';
import { COSMETIC_SLOTS, type CosmeticItem, type CosmeticSlot, ITEMS, SLOT_INFO, cosmeticKey, ownsItem } from '../../shared/economy';
import type { WeaponId } from '../../shared/loadout';
import type { Audio } from '../audio/audio';
import type { AccountClient } from '../net/account';
import { faceTexture } from '../render/facePhoto';
import { TubePreview } from '../render/preview';
import type { Look } from '../render/tubeMan';
import { clear, el, hexColor } from './dom';

const ICONS: Record<string, string> = {
  'face.smile': '🙂',
  'face.grin': '😁',
  'face.sleepy': '😴',
  'face.angry': '😠',
  'face.derp': '🤪',
  'face.cyclops': '👁️',
  'face.shades': '😎',
  'hat.spikes': '🌱',
  'hat.party': '🥳',
  'hat.cap': '🧢',
  'hat.beanie': '🧶',
  'hat.cone': '🚧',
  'hat.chef': '🍳',
  'hat.propeller': '🚁',
  'hat.tophat': '🎩',
  'hat.viking': '🪖',
  'hat.halo': '😇',
  'taunt.burp': '🫧',
  'taunt.wave': '👋',
  'taunt.spin': '🌀',
  'taunt.noodle': '🍜',
  'taunt.flex': '💪',
  'koFx.confetti': '🎊',
  'koFx.bubbles': '🫧',
  'koFx.stars': '⭐',
  'koFx.balloons': '🎈',
  'koFx.fireworks': '🎆',
  'koFx.rainbow': '🌈',
  'sound.classic': '🔊',
  'sound.boing': '🟣',
  'sound.kazoo': '🎶',
  'sound.duck': '🦆',
  'sound.slide': '🎵',
  'sound.trumpet': '🎺',
};

const PATTERN_CSS: Record<string, string> = {
  solid: 'none',
  stripes: 'repeating-linear-gradient(45deg, rgba(0,0,0,.18) 0 6px, transparent 6px 12px)',
  dots: 'radial-gradient(circle, rgba(0,0,0,.2) 3px, transparent 4px) 0 0 / 12px 12px',
  zigzag: 'linear-gradient(135deg, rgba(0,0,0,.18) 25%, transparent 25%) -6px 0 / 12px 12px, linear-gradient(225deg, rgba(0,0,0,.18) 25%, transparent 25%) -6px 0 / 12px 12px',
  stars: 'radial-gradient(circle, rgba(255,255,255,.7) 2px, transparent 3px) 0 0 / 10px 10px',
  checker: 'conic-gradient(rgba(0,0,0,.2) 25%, transparent 0 50%, rgba(0,0,0,.2) 0 75%, transparent 0) 0 0 / 14px 14px',
};

const FINISH_CSS: Record<string, string> = {
  bubblegum: '#ff8fd8',
  candy: 'repeating-linear-gradient(45deg, #fff 0 6px, #ff3b5c 6px 12px)',
  chrome: 'linear-gradient(135deg, #fff, #9aa3b8 45%, #fff 55%, #c9d2e8)',
  neon: '#39ff88',
  gold: 'linear-gradient(135deg, #fff3b0, #ffc933 45%, #d99a00)',
  galaxy: 'radial-gradient(circle at 30% 30%, #fff 1px, transparent 2px) 0 0 / 9px 9px, linear-gradient(135deg, #1b0b3a, #4a1a7a, #0b2a5a)',
};

export interface LockerOptions {
  account: AccountClient;
  audio: Audio;
  weapon: WeaponId;
  onClose: () => void;
  onSignup: () => void;
}

/**
 * The locker: customize your tube man and buy cosmetics at fixed prices. Nothing here changes
 * how you play.
 */
export function buildLocker(opts: LockerOptions): { root: HTMLElement; dispose: () => void } {
  const { account, audio } = opts;
  let slot: CosmeticSlot = 'color';
  let pending: string | null = null;
  const note = el('div', { class: 'locker-note' });
  const coins = el('div', { class: 'coins' });
  const tabs = el('div', { class: 'tabs' });
  const grid = el('div', { class: 'item-grid' });
  const lookOf = (): Look => {
    const c = account.profile.cosmetics;
    return { pattern: cosmeticKey(c, 'pattern'), face: cosmeticKey(c, 'face'), hat: cosmeticKey(c, 'hat'), finish: cosmeticKey(c, 'finish') };
  };
  const colorOf = () => PLAYER_COLORS[Number(cosmeticKey(account.profile.cosmetics, 'color'))]?.hex ?? 0xff3b5c;
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
    if (item.slot === 'color') return el('div', { class: 'swatch-big', style: { background: hexColor(PLAYER_COLORS[Number(item.key)]?.hex ?? 0xffffff) } });
    if (item.slot === 'pattern') return el('div', { class: 'swatch-big', style: { background: `${PATTERN_CSS[item.key]}, ${hexColor(colorOf())}` } });
    if (item.slot === 'finish') return el('div', { class: 'swatch-big', style: { background: item.key === 'team' ? hexColor(colorOf()) : FINISH_CSS[item.key] } });
    return el('div', { class: 'icon', text: ICONS[item.id] ?? '✨' });
  };

  const tryItem = (item: CosmeticItem) => {
    if (item.slot === 'taunt') {
      preview?.taunt(item.key);
      audio.tauntSound(cosmeticKey(account.profile.cosmetics, 'sound'), null);
    } else if (item.slot === 'sound') {
      audio.koSound(item.key, null);
      if (item.key === 'classic') audio.squeal(null);
    }
  };

  const draw = () => {
    const p = account.profile;
    coins.textContent = `🪙 ${p.coins}`;
    clear(tabs);
    for (const s of COSMETIC_SLOTS) {
      tabs.append(
        el('button', {
          class: `tab${s === slot ? ' on' : ''}`,
          text: SLOT_INFO[s].plural,
          on: {
            click: () => {
              slot = s;
              pending = null;
              note.textContent = '';
              draw();
            },
          },
        }),
      );
    }
    clear(grid);
    for (const item of ITEMS.filter((i) => i.slot === slot)) {
      const owned = ownsItem(p.owned, item.id);
      const equipped = p.cosmetics[item.slot] === item.id;
      let status: HTMLElement;
      if (equipped) status = el('div', { class: 'status on', text: 'WEARING' });
      else if (owned) status = el('div', { class: 'status', text: item.price === 0 ? 'Free' : 'Owned' });
      else if (pending === item.id) status = el('div', { class: 'status buy', text: `Tap again to buy · 🪙 ${item.price}` });
      else status = el('div', { class: `status price${p.coins < item.price ? ' short' : ''}`, text: `🪙 ${item.price}` });
      const card = el(
        'button',
        {
          class: `item${equipped ? ' equipped' : ''}${owned ? '' : ' locked'}`,
          attrs: { title: item.blurb ?? item.name },
          on: {
            click: async () => {
              tryItem(item);
              note.textContent = '';
              try {
                if (owned) {
                  if (!equipped) await account.equip({ [item.slot]: item.id });
                } else if (!p.isAccount) {
                  note.textContent = 'Make a free account to buy things. Your coins and progress come with you.';
                  note.append(el('button', { class: 'btn small blue', style: 'margin-left:10px', text: 'Sign up', on: { click: opts.onSignup } }));
                } else if (p.coins < item.price) {
                  note.textContent = `You need ${item.price - p.coins} more coins. Coins come from playing matches.`;
                } else if (pending !== item.id) {
                  pending = item.id;
                } else {
                  pending = null;
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

  const left = el(
    'div',
    { class: 'locker-left' },
    preview ? preview.canvas : el('div', { class: 'preview-canvas no-3d', text: '🎈' }),
    coins,
    el('div', { class: 'small-note', text: 'Everything here is just for looks. Nothing changes how you play.' }),
  );
  const root = el(
    'div',
    { class: 'overlay interactive' },
    el(
      'div',
      { class: 'panel locker' },
      el('h2', { text: 'Locker' }),
      el('div', { class: 'locker-body' }, left, el('div', { class: 'locker-right' }, tabs, grid, note)),
      el('div', { style: 'text-align:center;margin-top:14px' }, el('button', { class: 'btn', text: 'DONE', on: { click: opts.onClose } })),
    ),
  );
  return {
    root,
    dispose: () => {
      unsub();
      preview?.dispose();
    },
  };
}
