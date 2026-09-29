import { MODE_INFO, type ModeId } from '../../shared/game/modes';
import type { AccountClient, Friend } from '../net/account';
import { clear, el } from './dom';

export interface FriendsOptions {
  account: AccountClient;
  /** Join a friend's match by its room code. */
  onJoin: (code: string) => void;
  onSignup: () => void;
  onClose: () => void;
}

/** What a friend is up to, in a few words. */
function doing(f: Friend): string {
  if (!f.online) return 'Offline';
  const p = f.playing;
  if (!p) return 'Online';
  if (p.mode === 'ranked') return 'Looking for a ranked match';
  const mode = MODE_INFO[p.mode as ModeId]?.name ?? 'a match';
  return `Playing ${mode}${p.private ? ' (private room)' : ''}`;
}

/**
 * Friends: add people by name, answer requests, and see who's online, with a JOIN button when
 * their match has room. Accounts only (a guest has nothing to be friends with). Refreshes every
 * few seconds while open.
 */
export function buildFriends(opts: FriendsOptions): { root: HTMLElement; dispose: () => void } {
  const { account } = opts;
  const list = el('div', { class: 'friends-list' });
  const note = el('div', { class: 'small-note friends-note' });
  const nameInput = el('input', { attrs: { type: 'text', maxlength: '16', placeholder: 'Their account name', 'aria-label': 'Friend name', autocomplete: 'off' } }) as HTMLInputElement;
  const addBtn = el('button', { class: 'btn small blue', text: 'Add' }) as HTMLButtonElement;

  const run = async (fn: () => Promise<unknown>, done?: string) => {
    try {
      await fn();
      if (done) note.textContent = done;
    } catch (err) {
      note.textContent = (err as Error).message;
    }
    draw();
  };

  const add = () => {
    const name = nameInput.value.trim();
    if (!name) return;
    void run(async () => {
      const r = await account.addFriend(name);
      nameInput.value = '';
      note.textContent = r === 'friends' ? `You and ${name} are friends now!` : `Request sent to ${name}.`;
    });
  };
  addBtn.addEventListener('click', add);
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') add();
  });

  const row = (f: Friend, ...right: (HTMLElement | null)[]) =>
    el(
      'div',
      { class: `friend-row ${f.status}${f.online ? ' online' : ''}` },
      el('span', { class: 'dot', attrs: { 'aria-hidden': 'true' } }),
      el('div', { class: 'who' }, el('div', { class: 'nm', text: f.name }), el('div', { class: 'what', text: f.status === 'friends' ? doing(f) : f.status === 'incoming' ? 'Wants to be friends' : 'Request sent' })),
      el('div', { class: 'acts' }, ...right),
    );

  const draw = () => {
    clear(list);
    if (!account.account) {
      list.append(el('div', { class: 'small-note', text: 'Make a free account to add friends and see when they play.' }), el('button', { class: 'btn small blue', text: 'Sign up', on: { click: opts.onSignup } }));
      addBtn.disabled = true;
      nameInput.disabled = true;
      return;
    }
    const fs = account.friends;
    const section = (title: string, items: Friend[], make: (f: Friend) => HTMLElement) => {
      if (!items.length) return;
      list.append(el('div', { class: 'label section-label', text: title }));
      for (const f of items) list.append(make(f));
    };
    section('Requests', fs.filter((f) => f.status === 'incoming'), (f) =>
      row(
        f,
        el('button', { class: 'btn small green', text: 'Accept', on: { click: () => void run(() => account.acceptFriend(f.id), `You and ${f.name} are friends now!`) } }),
        el('button', { class: 'btn small ghost', text: 'Decline', on: { click: () => void run(() => account.removeFriend(f.id)) } }),
      ),
    );
    const friends = fs.filter((f) => f.status === 'friends').sort((a, b) => Number(b.online) - Number(a.online));
    section(`Friends (${friends.filter((f) => f.online).length} online)`, friends, (f) =>
      row(
        f,
        f.playing?.joinable && f.playing.code ? el('button', { class: 'btn small', text: 'JOIN', on: { click: () => opts.onJoin(f.playing!.code) } }) : null,
        el('button', {
          class: 'btn small ghost icon-btn',
          text: '✕',
          attrs: { title: `Remove ${f.name}`, 'aria-label': `Remove ${f.name}` },
          on: {
            click: () => {
              if (confirm(`Remove ${f.name} from your friends?`)) void run(() => account.removeFriend(f.id));
            },
          },
        }),
      ),
    );
    section('Sent', fs.filter((f) => f.status === 'outgoing'), (f) => row(f, el('button', { class: 'btn small ghost', text: 'Cancel', on: { click: () => void run(() => account.removeFriend(f.id)) } })));
    if (!fs.length) list.append(el('div', { class: 'small-note', text: "No friends yet. Add someone by their account name, or tap 👥 next to a player on the scoreboard (Tab) in a match." }));
  };

  const refresh = () => void account.loadFriends().then(draw, () => undefined);
  refresh();
  const timer = window.setInterval(refresh, 8000);
  draw();

  const root = el(
    'div',
    { class: 'overlay interactive' },
    el(
      'div',
      { class: 'panel friends-panel' },
      el('h2', { text: '👥 Friends' }),
      el('div', { class: 'row friends-add' }, nameInput, addBtn),
      note,
      list,
      el('div', { class: 'panel-foot' }, el('button', { class: 'btn', text: 'DONE', on: { click: opts.onClose } })),
    ),
  );
  return { root, dispose: () => window.clearInterval(timer) };
}
