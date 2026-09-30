import { el } from './dom';
import { icon } from './icons';

/** Shown while the game puts you back into your match after the connection dropped. */
export function buildReconnecting(updating: boolean, attempt: number, onCancel: () => void): HTMLElement {
  return el(
    'div',
    { class: 'menu' },
    el(
      'div',
      { class: 'panel menu-card interactive reconnecting', style: 'text-align:center' },
      el('h2', { text: updating ? 'Blubba is updating!' : 'Connection lost' }),
      el('div', { class: 'queue-spinner' }, icon('heliumBalloon')),
      el('div', { text: updating ? 'Putting you back in a match in a few seconds...' : `Reconnecting${attempt > 0 ? ` (try ${attempt + 1})` : ''}...` }),
      el('div', { class: 'small-note', text: 'Your coins and progress are saved.' }),
      el('button', { class: 'btn small ghost', text: 'Back to menu', on: { click: onCancel } }),
    ),
  );
}
