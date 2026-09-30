import { BALANCE } from '../../shared/balance';
import { MAX_PER_SIDE, checkTeamLobby } from '../../shared/game/teamLobby';
import type { RosterEntry, TeamLobbyState } from '../../shared/protocol';
import { clear, el } from './dom';

/** Everything the team lobby shows, read fresh on every update. */
export interface TeamLobbyData {
  roster: RosterEntry[];
  youId: number;
  hostId: number;
  isHost: boolean;
  isPrivate: boolean;
  code: string;
  mapName: string;
  names: string[];
  colors: number[];
  lobby: TeamLobbyState | null;
  /** Seconds until the match starts (null: not counting down). */
  startsIn: number | null;
  /** Public rooms: seconds until everyone counts as ready anyway (null: not running). */
  autoReadyIn: number | null;
}

export interface TeamLobbyActions {
  onJoin: (team: 0 | 1) => void;
  onReady: (ready: boolean) => void;
  onShuffle: () => void;
  onLock: (locked: boolean) => void;
  /** The pause menu (room settings for the host, loadout, locker, settings). */
  onMenu: () => void;
  onCopyLink: () => void;
  onLeave: () => void;
  /** A second of the countdown went by (for a tick sound). */
  onCountdownTick: (n: number) => void;
}

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

/**
 * Team Knockout's lobby, shown instead of the map before every match: both teams side by side,
 * a JOIN button on each, READY, and (in private rooms) the host's SHUFFLE and LOCK. The match
 * starts after a short countdown once the teams are even, both have enough players, and everyone
 * is ready; the line under the teams says what it's waiting for. Built once and updated in place,
 * so buttons never move under the pointer.
 */
export function buildTeamLobby(data: () => TeamLobbyData, act: TeamLobbyActions): { root: HTMLElement; update: () => void } {
  const title = el('div', { class: 'tl-title', text: 'TEAM KNOCKOUT' });
  const sub = el('div', { class: 'tl-sub' });
  const code = el('button', { class: 'tl-code', on: { click: act.onCopyLink }, attrs: { title: 'Copy invite link' } });
  const cols = [0, 1].map((t) => {
    const name = el('div', { class: 'tl-name' });
    const count = el('div', { class: 'tl-count' });
    const list = el('div', { class: 'tl-list' });
    const join = el('button', { class: 'btn tl-join', on: { click: () => act.onJoin(t as 0 | 1) } }) as HTMLButtonElement;
    const box = el('div', { class: 'tl-team' }, el('div', { class: 'tl-team-head' }, name, count), list, join);
    return { box, name, count, list, join, key: '' };
  });
  const vs = el('div', { class: 'tl-vs', text: 'VS' });
  const status = el('div', { class: 'tl-status', attrs: { 'aria-live': 'polite' } });
  const big = el('div', { class: 'tl-countdown hidden', attrs: { 'aria-hidden': 'true' } });
  const ready = el('button', { class: 'btn big tl-ready', on: { click: () => act.onReady(!isReady()) } }) as HTMLButtonElement;
  const shuffle = el('button', { class: 'btn small', text: '🔀 Shuffle', on: { click: act.onShuffle }, attrs: { title: 'Deal everyone onto new even teams' } });
  const lock = el('button', { class: 'btn small', on: { click: () => act.onLock(!data().lobby?.locked) } }) as HTMLButtonElement;
  const hostRow = el('div', { class: 'tl-host' }, el('span', { class: 'label', text: '👑 Host' }), shuffle, lock);
  const foot = el(
    'div',
    { class: 'tl-foot' },
    el('button', { class: 'btn small ghost', text: '⚙️ Menu', on: { click: act.onMenu }, attrs: { title: 'Loadout, locker, settings (and room settings for the host)' } }),
    el('span', { class: 'tl-keys', text: 'R ready · 1 / 2 pick a team' }),
    el('button', { class: 'btn small ghost', text: 'Leave', on: { click: act.onLeave } }),
  );
  const root = el(
    'div',
    { class: 'overlay interactive team-lobby' },
    el(
      'div',
      { class: 'tl-panel' },
      el('div', { class: 'tl-head' }, el('div', {}, title, sub), code),
      el('div', { class: 'tl-teams' }, cols[0].box, vs, cols[1].box),
      status,
      ready,
      hostRow,
      foot,
    ),
    big,
  );

  const isReady = () => {
    const d = data();
    return !!d.lobby?.ready.includes(d.youId);
  };
  let lastCount = -1;

  const update = () => {
    const d = data();
    const L = d.lobby;
    const readyIds = new Set(L?.ready ?? []);
    const me = d.roster.find((r) => r.id === d.youId);
    const min = L?.minPerSide ?? BALANCE.modes.teamKnockout.minPerSide;
    sub.textContent = `${d.mapName} · first team to ${BALANCE.modes.teamKnockout.target} knockouts`;
    code.classList.toggle('hidden', !d.isPrivate);
    code.textContent = `ROOM ${d.code} · copy invite`;
    for (const t of [0, 1] as const) {
      const c = cols[t];
      const color = hex(d.colors[t] ?? 0xffffff);
      c.box.style.setProperty('--team', color);
      c.box.classList.toggle('mine', me?.team === t);
      const members = d.roster.filter((r) => r.team === t).sort((a, b) => Number(a.bot) - Number(b.bot) || a.id - b.id);
      c.name.textContent = d.names[t] ?? (t === 0 ? 'RED' : 'BLUE');
      c.count.textContent = `${members.length}`;
      const key = members.map((m) => `${m.id}:${m.name}:${readyIds.has(m.id) || m.bot}:${m.id === d.hostId}`).join('|') + `/${min}`;
      if (key !== c.key) {
        c.key = key;
        clear(c.list);
        for (const m of members) {
          const on = m.bot || readyIds.has(m.id);
          c.list.append(
            el(
              'div',
              { class: `tl-player${m.id === d.youId ? ' you' : ''}${on ? ' ready' : ''}` },
              el('span', { class: 'tl-check', text: on ? '✓' : '…', attrs: { 'aria-label': on ? 'Ready' : 'Not ready' } }),
              el('span', { class: 'tl-pname', text: m.name }),
              m.id === d.hostId && d.isPrivate ? el('span', { class: 'tl-tag', text: '👑' }) : null,
              m.bot ? el('span', { class: 'tl-tag bot', text: 'BOT' }) : null,
              m.id === d.youId ? el('span', { class: 'tl-tag you', text: 'YOU' }) : null,
            ),
          );
        }
        // Open seats up to the minimum, so it's obvious how many more are needed.
        for (let i = members.length; i < min; i++) c.list.append(el('div', { class: 'tl-player open', text: 'Open seat' }));
      }
      const here = me?.team === t;
      const humans = members.filter((m) => !m.bot).length;
      const full = humans >= MAX_PER_SIDE;
      c.join.disabled = here || !!L?.locked || full;
      c.join.textContent = here ? "YOU'RE HERE" : L?.locked ? '🔒 LOCKED' : full ? 'FULL' : `JOIN ${d.names[t] ?? ''}`;
    }
    // What it's waiting for: the server's word, or our own read of the roster before it arrives.
    const check = checkTeamLobby(
      d.roster.map((r) => ({ id: r.id, team: r.team, bot: r.bot })),
      readyIds,
      min,
    );
    const counting = d.startsIn !== null;
    const waiting = L ? L.waiting : check.waiting;
    status.textContent = counting
      ? 'Everyone is ready!'
      : d.autoReadyIn !== null
        ? `${waiting} · starting in ${Math.ceil(d.autoReadyIn)}s anyway`
        : waiting || 'Ready when you are';
    status.classList.toggle('go', counting);
    const mine = isReady();
    ready.textContent = mine ? 'READY ✓' : 'READY UP';
    ready.classList.toggle('green', !mine);
    ready.classList.toggle('on', mine);
    ready.title = mine ? 'Click to take it back' : 'Tell everyone you are good to go';
    hostRow.classList.toggle('hidden', !d.isHost);
    lock.textContent = L?.locked ? '🔓 Unlock teams' : '🔒 Lock teams';
    // The countdown: a big number over everything, ticking once a second.
    const n = counting ? Math.max(1, Math.ceil(d.startsIn!)) : -1;
    big.classList.toggle('hidden', !counting);
    if (n !== lastCount) {
      lastCount = n;
      if (n > 0) {
        big.textContent = String(n);
        big.classList.remove('pop');
        void big.offsetWidth;
        big.classList.add('pop');
        act.onCountdownTick(n);
      }
    }
  };

  // Keys: R readies up, 1 and 2 pick a team.
  const onKey = (e: KeyboardEvent) => {
    if (!root.isConnected) {
      window.removeEventListener('keydown', onKey);
      return;
    }
    if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return;
    if (e.code === 'KeyR') act.onReady(!isReady());
    else if (e.code === 'Digit1') act.onJoin(0);
    else if (e.code === 'Digit2') act.onJoin(1);
  };
  window.addEventListener('keydown', onKey);
  update();
  return { root, update };
}
