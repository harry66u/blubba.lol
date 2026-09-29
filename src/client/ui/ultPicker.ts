import { unlockLevel } from '../../shared/economy';
import { ULT_IDS, ULT_INFO, type UltId } from '../../shared/game/ults';
import { el } from './dom';

/**
 * The "Ultimate" section of the loadout screen: one card per ult. Locked ones show the level they
 * unlock at (ults are earned by playing, never bought).
 */
export function buildUltPicker(current: UltId, locked: readonly string[], onPick: (id: UltId) => void): HTMLElement {
  const row = el('div', { class: 'ult-picker' });
  for (const id of ULT_IDS) {
    const info = ULT_INFO[id];
    const isLocked = locked.includes(id);
    row.append(
      el(
        'button',
        {
          class: `ult-card${id === current ? ' selected' : ''}`,
          style: `--ult:${info.color}`,
          attrs: isLocked ? { disabled: 'true', title: `Unlocks at level ${unlockLevel(id)}` } : {},
          on: { click: () => onPick(id) },
        },
        el('div', { class: 'ico', text: info.icon }),
        el('div', { class: 'title', text: `${isLocked ? '🔒 ' : ''}${info.name}` }),
        info.by ? el('div', { class: 'by', text: info.by }) : null,
        isLocked ? el('div', { class: 'lock-note', text: `Unlocks at level ${unlockLevel(id)}` }) : null,
        el('div', { class: 'blurb', text: info.blurb }),
      ),
    );
  }
  return el(
    'div',
    { class: 'ult-section' },
    el('div', { class: 'label', text: 'Ultimate (its meter fills as you play: pop it when it glows)' }),
    row,
  );
}
