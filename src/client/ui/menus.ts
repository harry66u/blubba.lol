import { BALANCE } from '../../shared/balance';
import { PLAYER_COLORS } from '../../shared/colors';
import { MODE_IDS, MODE_INFO, type ModeId } from '../../shared/game/modes';
import type { MatchResult } from '../../shared/game/sim';
import { type ProgressReport, REPORT_REASONS, REPORT_REASON_TEXT, type ReportReason } from '../../shared/economy';
import { buildProgressBox } from './accountUi';
import { KNOCKOUT_MAPS, MAPS, homeMapFor, mapsForMode } from '../../shared/maps';
import { checkName, randomGuestName } from '../../shared/names';
import type { EventFrequency, JoinRequest, QueueCounts, RoomInfo, RosterEntry } from '../../shared/protocol';
import { ACTION_LABELS, type Action, DEFAULT_BINDINGS, codeLabel } from '../input/input';
import type { Settings } from '../settings';
import { add, clear, el, hexColor } from './dom';
import { MODE_ICON, mapIcon } from './gameIcons';
import { type IconName, icon, isIconName } from './icons';
import { tubeMan } from './mascot';

/** Everything the mode picker offers: every mode plus ranked 1v1. */
/** 'any': the default, everyone who just presses PLAY together in Sudden Death. */
export type PlayMode = ModeId | 'ranked' | 'any';

export interface MenuCallbacks {
  onLoadout: () => void;
  onLocker: () => void;
  onProfile: () => void;
  onFriends: () => void;
  onPlay: (name: string, mode: PlayMode) => void;
  onChallenge: (name: string) => void;
  onModeChange: (mode: PlayMode) => void;
  /** The map picked for quick play (null: any map). */
  onMapChange: (map: string | null) => void;
  /** Pointing at a map tile (or a mode with its own arena) previews that map behind the menu; null goes back to the picked one. */
  onMapPreview?: (map: string | null) => void;
  onCreate: (name: string) => void;
  /** The Bots switch for quick play (off: only real players). */
  onBotsChange: (on: boolean, mode: PlayMode) => void;
  onJoinCode: (name: string, code: string) => void;
  onSettings: () => void;
  onHowTo: () => void;
  onNameChange: (name: string) => void;
}

/** A message at the top of the menu: why you ended up back here, and what to do about it. */
export interface MenuNotice {
  text: string;
  title?: string;
  /** error: something went wrong; update: a newer version is out; info: just so you know. */
  kind?: 'error' | 'update' | 'info';
  action?: { label: string; run: () => void };
}

/** An icon followed by a label, for buttons and headings. */
function iconText(name: IconName, text: string): DocumentFragment {
  const f = document.createDocumentFragment();
  f.append(icon(name), el('span', { text }));
  return f;
}

/** Previews a map behind the menu while the mouse is over `target` (mice only: a tap is a click). */
function hoverPreview(target: HTMLElement, map: () => string | null, preview: ((m: string | null) => void) | undefined): void {
  if (!preview) return;
  target.addEventListener('pointerenter', (e) => {
    const m = map();
    if (e.pointerType === 'mouse' && m) preview(m);
  });
  target.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse') preview(null);
  });
}

function nameField(initial: string, onChange: (n: string) => void, errorEl: HTMLElement): HTMLInputElement {
  const input = el('input', { class: 'field grow', attrs: { maxlength: '16', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Your name' } });
  input.value = initial;
  input.addEventListener('input', () => {
    const c = checkName(input.value);
    errorEl.textContent = c.ok || input.value.length < 3 ? '' : (c.reason ?? '');
    if (c.ok) onChange(c.name);
  });
  return input;
}

function validName(input: HTMLInputElement, errorEl: HTMLElement): string | null {
  const c = checkName(input.value);
  if (!c.ok) {
    errorEl.textContent = c.reason ?? 'Pick another name.';
    input.focus();
    return null;
  }
  return c.name;
}

/** The wobbly logo, with a tube man flailing beside it. */
function logo(): HTMLElement {
  return el(
    'div',
    { class: 'logo-wrap' },
    el('h1', { class: 'logo', attrs: { 'aria-label': 'Blubba' } }, ...'BLUBBA'.split('').map((ch) => el('span', { text: ch, attrs: { 'aria-hidden': 'true' } }))),
    tubeMan('#ff3b5c', { className: 'logo-mascot flail' }),
  );
}

/** Balloons drifting up behind the menu (decoration only). */
function sky(): HTMLElement {
  const colors = ['var(--pink)', 'var(--yellow)', 'var(--blue)', 'var(--green)', 'var(--purple)', 'var(--orange)'];
  const wrap = el('div', { class: 'menu-sky', attrs: { 'aria-hidden': 'true' } });
  colors.forEach((c, i) => {
    const b = el('span', { class: 'balloon' });
    b.style.setProperty('--c', c);
    b.style.setProperty('--x', `${[6, 90, 16, 80, 30, 70][i]}%`);
    b.style.setProperty('--d', `${-i * 4.2}s`);
    b.style.setProperty('--t', `${22 + (i % 3) * 5}s`);
    b.style.setProperty('--s', String([1, 0.8, 0.65, 1.1, 0.7, 0.9][i]));
    wrap.append(b);
  });
  return wrap;
}

/** The notice banner (errors, updates, info) shown at the top of a menu card. */
function noticeBox(notice: MenuNotice | string | undefined): HTMLElement | null {
  if (!notice) return null;
  const n: MenuNotice = typeof notice === 'string' ? { text: notice } : notice;
  const kind = n.kind ?? 'error';
  const box = el('div', { class: `notice ${kind}`, attrs: { role: kind === 'info' ? 'status' : 'alert' } });
  add(
    box,
    el('div', { class: 'notice-icon', attrs: { 'aria-hidden': 'true' } }, icon(kind === 'update' ? 'sparkles' : kind === 'info' ? 'chat' : 'warning')),
    el('div', { class: 'notice-body' }, n.title ? el('div', { class: 'notice-title', text: n.title }) : null, el('div', { class: 'notice-text', text: n.text })),
    n.action ? el('button', { class: `btn small ${kind === 'update' ? 'purple' : 'yellow'}`, text: n.action.label, on: { click: n.action.run } }) : null,
    el('button', { class: 'notice-close', text: '✕', attrs: { 'aria-label': 'Dismiss', title: 'Dismiss' }, on: { click: () => box.remove() } }),
  );
  return box;
}

/** A nav button with an icon (menu side column, pause menu). */
function navButton(ico: IconName, label: string, onClick: () => void, extra = ''): HTMLButtonElement {
  return el(
    'button',
    { class: `btn small ghost nav-btn ${extra}`, on: { click: onClick } },
    el('span', { class: 'ico', attrs: { 'aria-hidden': 'true' } }, icon(ico)),
    el('span', { text: label }),
    el('span', { class: 'nav-badge hidden' }),
  );
}

/** Friend requests waiting: a number on the menu's Friends button. */
export function setFriendBadge(n: number): void {
  for (const b of document.querySelectorAll<HTMLElement>('.friends-btn .nav-badge')) {
    b.textContent = String(n);
    b.classList.toggle('hidden', n <= 0);
  }
}

/** Colors and names for team scoreboards and results. */
export interface TeamView {
  colors: number[];
  names: string[];
  scores: [number, number];
  youTeam: number;
  /** Pump: scores are fill fractions. */
  percent: boolean;
}

/**
 * The map row under the mode picker: any map, or one of the knockout maps, each a small tile in
 * that map's sky colors with its icon; the picked map's name shows above. Modes with their own
 * arena (and ranked) say so instead.
 */
function mapPicker(initial: string | null, onChange: (map: string | null) => void, onPreview?: (map: string | null) => void): { el: HTMLElement; setMode: (m: PlayMode) => void } {
  let picked = initial;
  let mode: PlayMode = 'knockout';
  const label = (id: string | null) => (id ? MAPS[id].name : 'Any map');
  const name = el('span', { class: 'map-name', attrs: { 'aria-live': 'polite' } });
  const tiles = el('div', { class: 'map-tiles', attrs: { role: 'radiogroup', 'aria-label': 'Map' } });
  const wrap = el('div', { class: 'map-picker' }, el('div', { class: 'map-head' }, el('span', { class: 'label', text: 'Map', attrs: { title: 'You join whoever is playing this mode; your pick votes for the next map (and picks the map of a new room).' } }), name), tiles);
  const refresh = () => {
    const forced = mode === 'ranked' || mode === 'any' ? null : homeMapFor(mode);
    const fixed = mode === 'ranked' || mode === 'any' || !!forced;
    wrap.classList.toggle('fixed', fixed);
    name.textContent = forced ? `${MAPS[forced].name} (its own arena)` : mode === 'ranked' ? 'Picked for you' : mode === 'any' ? 'Wherever everyone is' : picked ? `${label(picked)} (your vote)` : label(picked);
    for (const b of tiles.querySelectorAll('button')) {
      const on = !fixed && (b.dataset.map || null) === picked;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
      b.disabled = fixed;
    }
  };
  for (const id of [null, ...KNOCKOUT_MAPS]) {
    const b = el(
      'button',
      {
        class: 'map-tile',
        attrs: { 'data-map': id ?? '', role: 'radio', title: label(id), 'aria-label': label(id) },
        on: {
          click: () => {
            picked = id;
            onChange(id);
            refresh();
          },
        },
      },
      el('span', { class: 'ico', attrs: { 'aria-hidden': 'true' } }, icon(mapIcon(id))),
    );
    // Pointing at a map shows it behind the menu (only while maps can be picked).
    hoverPreview(b, () => (b.disabled ? null : id), onPreview);
    if (id) {
      b.style.setProperty('--sky-top', hexColor(MAPS[id].theme.skyTop));
      b.style.setProperty('--sky-mid', hexColor(MAPS[id].theme.skyHorizon));
    }
    tiles.append(b);
  }
  refresh();
  return {
    el: wrap,
    setMode: (m) => {
      mode = m;
      refresh();
    },
  };
}

/** `side` sits beside the main card on wide screens and below it on narrow ones (the daily challenges). */
/** "🟢 37 active": players who opened the game today. Hidden until the count arrives. */
function activePill(n: number | null): HTMLElement {
  const pill = el('div', { class: 'active-pill', attrs: { title: 'Players today' } }, el('span', { class: 'dot', attrs: { 'aria-hidden': 'true' } }), el('span', { class: 'n' }), el('span', { class: 'w', text: ' active today' }));
  setActiveCount(n, pill);
  return pill;
}

/** Players who opened the game today (from /api/me) and who's on right now (from /api/counts). */
let pillToday: number | null = null;
let pillOnline: number | null = null;

/** "🟢 3 active now · 37 today": right now (menus included) first, then today. Hidden until either count arrives. */
function drawPill(pill: Element | null = document.querySelector('.active-pill')): void {
  if (!pill) return;
  const online = pillOnline ?? 0;
  const today = Math.max(pillToday ?? 0, online);
  pill.classList.toggle('hidden', !online && !today);
  const num = pill.querySelector('.n');
  const word = pill.querySelector('.w');
  if (!num || !word) return;
  if (online) {
    num.textContent = online.toLocaleString();
    word.textContent = today ? ` active now · ${today.toLocaleString()} today` : ' active now';
    pill.setAttribute('title', 'On right now (in a match or on the menu), and players today');
  } else if (today) {
    num.textContent = today.toLocaleString();
    word.textContent = ' active today';
    pill.setAttribute('title', 'Players today');
  }
}

/** Updates the menu's "today" count in place (it arrives after the menu is drawn). */
export function setActiveCount(n: number | null, pill: Element | null = document.querySelector('.active-pill')): void {
  if (n !== null) pillToday = n;
  drawPill(pill);
}

/** Players in a mode right now: [in a match, waiting for more players]. */
function modeLive(c: QueueCounts, m: PlayMode): [number, number] {
  if (m === 'ranked') return [0, c.ranked];
  const x = c.modes[m === 'any' ? 'suddenDeath' : m];
  return [x?.playing ?? 0, x?.waiting ?? 0];
}

/** What the mode's live line says ('' when nobody's on). */
function liveText(c: QueueCounts, m: PlayMode): string {
  const [playing, waiting] = modeLive(c, m);
  if (m === 'ranked') return waiting ? `${waiting} searching for a ranked match` : '';
  const parts: string[] = [];
  if (playing) parts.push(`${playing} playing now`);
  if (waiting) parts.push(m === 'teamKnockout' ? `${waiting} in the team lobby` : `${waiting} waiting for players`);
  if (!parts.length) return m === 'teamKnockout' ? 'Nobody in Team Knockout yet: invite friends or turn bots on' : '';
  return parts.join(' · ');
}

let lastCounts: QueueCounts | null = null;

/** The live line under the picked mode: a green dot when people are on (not for the "nobody yet" hint). */
function setLive(live: HTMLElement, text: string): void {
  live.textContent = text;
  live.classList.toggle('on', /playing|waiting|lobby|searching/.test(text));
}

/**
 * Live player counts on the menu: a badge on each mode button, a line under the picked mode, and
 * "N online" in the pill (instead of today's count) once anyone is on.
 */
export function setModeCounts(c: QueueCounts | null = lastCounts): void {
  lastCounts = c;
  if (!c) return;
  for (const b of document.querySelectorAll<HTMLElement>('.mode-picker button[data-mode]')) {
    const m = b.dataset.mode as PlayMode;
    const [playing, waiting] = modeLive(c, m);
    const n = playing + waiting;
    let badge = b.querySelector<HTMLElement>('.cnt');
    if (!badge) {
      badge = el('span', { class: 'cnt', attrs: { 'aria-hidden': 'true' } });
      b.append(badge);
    }
    badge.textContent = n ? String(n) : '';
    badge.classList.toggle('hidden', !n);
    badge.classList.toggle('lobby', !playing && waiting > 0);
    b.title = `${b.dataset.blurb ?? ''}${n ? ` (${liveText(c, m)})` : ''}`;
  }
  const on = document.querySelector<HTMLElement>('.mode-picker button.on');
  const live = document.querySelector<HTMLElement>('.mode-live');
  if (live && on) setLive(live, liveText(c, on.dataset.mode as PlayMode));
  pillOnline = c.online;
  drawPill();
}

export function buildMainMenu(
  name: string,
  cb: MenuCallbacks,
  notice?: MenuNotice | string,
  initialMode: PlayMode = 'any',
  accountName: string | null = null,
  side: HTMLElement | null = null,
  initialMap: string | null = null,
  active: number | null = null,
  botsFor: (m: PlayMode) => boolean = () => false,
): HTMLElement {
  const err = el('div', { class: 'error-text' });
  const nameInput = nameField(accountName ?? name, cb.onNameChange, err);
  if (accountName) {
    // Account names are fixed; guests can pick any (filtered) name.
    nameInput.disabled = true;
    nameInput.title = 'Your account name';
  }
  const dice = el('button', {
    class: 'btn small ghost dice',
    attrs: { title: 'Random name', 'aria-label': 'Random name' },
    on: {
      click: () => {
        nameInput.value = randomGuestName();
        cb.onNameChange(nameInput.value);
        err.textContent = '';
        dice.classList.remove('roll');
        void dice.offsetWidth;
        dice.classList.add('roll');
      },
    },
  });
  dice.append(icon('dice'));
  let mode: PlayMode = initialMode;
  const maps = mapPicker(initialMap, cb.onMapChange, cb.onMapPreview);
  const blurb = el('div', { class: 'mode-blurb', attrs: { 'aria-live': 'polite' } });
  const live = el('div', { class: 'mode-live' });
  const picker = el('div', { class: 'mode-picker', attrs: { role: 'radiogroup', 'aria-label': 'Game mode' } });
  const play = el('button', {
    class: 'btn big play',
    text: 'PLAY',
    on: {
      click: () => {
        const n = accountName ?? validName(nameInput, err);
        if (n) cb.onPlay(n, mode);
      },
    },
  });
  // Quick play is real players only, unless you switch bots on (Team Knockout has its own switch).
  let botsOn = botsFor(mode);
  const botsLabel = el('span', { class: 'bots-state' });
  const botsBtn = el('button', {
    class: 'bots-switch',
    attrs: { role: 'switch', 'aria-label': 'Bots', title: 'Off: only real people. On: bots fill the empty spots while everyone in your match has bots on too.' },
    on: {
      click: () => {
        botsOn = !botsOn;
        cb.onBotsChange(botsOn, mode);
        drawBots();
      },
    },
  });
  const drawBots = () => {
    botsBtn.setAttribute('aria-checked', String(botsOn));
    botsBtn.classList.toggle('on', botsOn);
    botsLabel.textContent = botsOn ? 'Bots fill empty spots (if everyone agrees)' : 'Only real players';
  };
  drawBots();
  const botsRow = el('div', { class: 'bots-row' }, el('span', { class: 'label', text: 'Bots' }), botsBtn, botsLabel);
  const info = (m: PlayMode) =>
    m === 'ranked'
      ? { name: 'Ranked', blurb: 'Rated 1v1 against someone near your skill. Needs a free account.' }
      : m === 'any'
        ? { name: 'Public Queue', blurb: 'The quickest way in: everyone online in one match, real players only. Sudden Death rules: one life each round.' }
        : MODE_INFO[m];
  const pick = (m: PlayMode) => {
    mode = m;
    for (const b of picker.querySelectorAll('button')) {
      b.classList.toggle('on', b.dataset.mode === m);
      b.setAttribute('aria-checked', String(b.dataset.mode === m));
    }
    blurb.textContent = info(m).blurb;
    setLive(live, lastCounts ? liveText(lastCounts, m) : '');
    maps.setMode(m);
    // Ranked and the Public Queue never have bots.
    botsRow.classList.toggle('hidden', m === 'ranked' || m === 'any');
    botsOn = botsFor(m);
    drawBots();
  };
  // The Public Queue first (the default, a wide button of its own), then Sudden Death (the main
  // mode), then the rest.
  const order: PlayMode[] = ['any', 'suddenDeath', ...MODE_IDS.filter((x) => x !== 'suddenDeath'), 'ranked'];
  for (const m of order) {
    const b = el(
      'button',
      {
        class: m === 'any' ? 'public-queue' : '',
        attrs: { 'data-mode': m, 'data-blurb': info(m).blurb, role: 'radio', title: info(m).blurb },
        on: {
          click: () => {
            pick(m);
            cb.onModeChange(m);
          },
        },
      },
      el('span', { class: 'ico', attrs: { 'aria-hidden': 'true' } }, icon(MODE_ICON[m])),
      el('span', { class: 'nm' }, info(m).name, m === 'any' ? el('span', { class: 'pq-sub', text: 'Everyone online, one match' }) : null),
    );
    // Modes with their own arena show it while you point at them.
    hoverPreview(b, () => (m === 'ranked' || m === 'any' ? null : homeMapFor(m)), cb.onMapPreview);
    picker.append(b);
  }
  pick(mode);
  const challenge = el('button', {
    class: 'btn blue',
    text: '1v1 CHALLENGE',
    attrs: { title: 'Get a link: the first person to open it plays you 1v1.' },
    on: {
      click: () => {
        const n = accountName ?? validName(nameInput, err);
        if (n) cb.onChallenge(n);
      },
    },
  });
  const codeInput = el('input', { class: 'field code', attrs: { maxlength: '5', placeholder: 'CODE', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Room code' } });
  const joinBtn = el('button', {
    class: 'btn blue',
    text: 'JOIN',
    on: {
      click: () => {
        const n = accountName ?? validName(nameInput, err);
        const code = codeInput.value.trim().toUpperCase();
        if (!n) return;
        if (code.length < 5) {
          err.textContent = 'Room codes are 5 letters.';
          codeInput.focus();
          return;
        }
        cb.onJoinCode(n, code);
      },
    },
  });
  codeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') joinBtn.click();
  });
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') play.click();
  });
  const create = el('button', {
    class: 'btn yellow',
    text: 'PRIVATE ROOM',
    on: {
      click: () => {
        const n = accountName ?? validName(nameInput, err);
        if (n) cb.onCreate(n);
      },
    },
  });
  const card = el(
    'div',
    { class: 'panel menu-card interactive' },
    noticeBox(notice),
    el('div', { class: 'name-row' }, el('label', { class: 'label', text: 'Your name' }), el('div', { class: 'row' }, nameInput, accountName ? null : dice)),
    picker,
    blurb,
    live,
    maps.el,
    botsRow,
    play,
    el('div', { class: 'row split' }, create, challenge),
    el('div', { class: 'row code-row' }, el('div', { class: 'grow code-label', text: 'Got a code?' }), codeInput, joinBtn),
    err,
  );
  const nav = el(
    'nav',
    { class: 'menu-nav', attrs: { 'aria-label': 'More' } },
    navButton('target', 'Loadout', cb.onLoadout),
    navButton('locker', 'Locker', cb.onLocker),
    navButton('trophy', 'Profile', cb.onProfile),
    navButton('friends', 'Friends', cb.onFriends, 'friends-btn'),
    navButton('help', 'How to play', cb.onHowTo),
    navButton('settings', 'Settings', cb.onSettings),
  );
  return el(
    'div',
    { class: 'menu main-menu' },
    sky(),
    el('header', { class: 'menu-head' }, logo(), el('div', { class: 'tagline', text: 'Blast your friends off the map!' }), activePill(active)),
    el('div', { class: 'menu-body' }, nav, card, side),
  );
}

export function buildRoomJoin(
  code: string,
  name: string,
  cb: { onJoin: (name: string) => void; onBack: () => void; onNameChange: (n: string) => void },
  notice?: MenuNotice | string,
  challenge = false,
): HTMLElement {
  const err = el('div', { class: 'error-text' });
  const nameInput = nameField(name, cb.onNameChange, err);
  const join = el('button', {
    class: 'btn big green',
    text: challenge ? 'ACCEPT CHALLENGE' : 'JOIN',
    on: {
      click: () => {
        const n = validName(nameInput, err);
        if (n) cb.onJoin(n);
      },
    },
  });
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') join.click();
  });
  const banner = challenge
    ? el(
        'div',
        { class: 'invite-banner challenge' },
        el('div', { class: 'kicker' }, iconText('duel', "You've been challenged!")),
        el('div', { class: 'invite-title', text: '1v1 DUEL' }),
        el('div', { class: 'invite-sub', text: `First to ${BALANCE.modes.duel.target} knockouts wins.` }),
      )
    : el(
        'div',
        { class: 'invite-banner' },
        el('div', { class: 'kicker' }, iconText('party', "You're invited to a room!")),
        el('div', { class: 'code-tiles', attrs: { 'aria-label': `Room code ${code}` } }, ...code.split('').map((ch) => el('span', { text: ch, attrs: { 'aria-hidden': 'true' } }))),
      );
  const card = el(
    'div',
    { class: 'panel menu-card invite-card interactive' },
    noticeBox(notice),
    banner,
    el('div', { class: 'name-row' }, el('label', { class: 'label', text: 'Your name' }), nameInput),
    join,
    el('button', { class: 'btn small ghost back', text: '← Back to menu', on: { click: cb.onBack } }),
    err,
  );
  return el('div', { class: 'menu' }, sky(), el('header', { class: 'menu-head' }, logo()), card);
}

/** While the server finds a room: a bouncing tube man and a way back out. */
export function buildConnecting(join: JoinRequest, onCancel: () => void): HTMLElement {
  const title =
    join.kind === 'quick'
      ? `Finding a ${MODE_INFO[join.mode ?? 'knockout']?.name ?? ''} match${join.map && MAPS[join.map] ? ` on ${MAPS[join.map].name}` : ''}`
      : join.kind === 'create'
        ? 'Making your room'
        : join.kind === 'challenge'
          ? 'Setting up your 1v1'
          : join.kind === 'code'
            ? `Joining room ${join.code}`
            : join.kind === 'friend'
              ? 'Joining your friend'
              : 'Connecting';
  return el(
    'div',
    { class: 'menu' },
    sky(),
    el(
      'div',
      { class: 'panel menu-card connecting-card interactive', attrs: { role: 'status' } },
      el('div', { class: 'pump-stage' }, tubeMan('#2ec5ff', { className: 'inflating' }), el('div', { class: 'pump-shadow' })),
      el('h2', { class: 'connecting-title' }, title, el('span', { class: 'dots', attrs: { 'aria-hidden': 'true' } }, el('i', { text: '.' }), el('i', { text: '.' }), el('i', { text: '.' }))),
      el('div', { class: 'small-note', text: 'Pumping up the tube men' }),
      el('button', { class: 'btn small ghost', text: 'Cancel', on: { click: onCancel } }),
    ),
  );
}

export function buildClickToPlay(text: string, onClick: () => void, pad = false, device?: { current: 'mouse' | 'trackpad'; onPick: (d: 'mouse' | 'trackpad') => void }): HTMLElement {
  // First time only: which do you aim with? (Trackpads need faster turning than a mouse.) Picking
  // one also starts playing, since it's a click like any other here.
  const ask = device
    ? el(
        'div',
        { class: 'device-ask' },
        el('span', { class: 'label', text: 'Aiming with' }),
        ...(['mouse', 'trackpad'] as const).map((d) =>
          el('button', { class: `btn small${device.current === d ? ' blue' : ' ghost'}`, on: { click: () => device.onPick(d) } }, iconText(d === 'mouse' ? 'mouse' : 'laptop', d === 'mouse' ? 'Mouse' : 'Trackpad')),
        ),
      )
    : null;
  return el(
    'div',
    { class: 'click-to-play interactive', on: { click: onClick } },
    el('div', { class: 'big-text', text }),
    el('div', { class: 'click-hint' }, el('span', { class: 'tap-ring', attrs: { 'aria-hidden': 'true' } }), pad ? 'Press Ⓐ to play' : 'Click anywhere to play'),
    ask,
  );
}

export interface PauseCallbacks {
  onLoadout: () => void;
  onLocker: () => void;
  onResume: () => void;
  onLeave: () => void;
  onSettings: () => void;
  onHowTo: () => void;
  onCopyLink: () => void;
  onHost: (action: 'restart' | 'start' | { durationSec?: number; bots?: boolean; events?: EventFrequency; mode?: ModeId; mapId?: string; teamNames?: [string, string] }) => void;
  /** Public matches: your vote for bots filling the empty spots. */
  onBots?: (on: boolean) => void;
  onFriends?: () => void;
}

/**
 * Public matches: the Bots switch is a vote. Bots fill the empty spots once everyone here wants
 * them, and leave when the match ends if anyone changes their mind.
 */
export function botsVote(room: RoomInfo, you: number, humans: number, onBots: (on: boolean) => void): HTMLElement {
  const votes = room.botVotes ?? [];
  const mine = votes.includes(you);
  const sw = el('button', {
    class: `bots-switch${mine ? ' on' : ''}`,
    attrs: { role: 'switch', 'aria-checked': String(mine), 'aria-label': 'Bots', title: 'Bots fill the empty spots once everyone here switches them on.' },
    on: { click: () => onBots(!mine) },
  });
  const text = room.settings.bots
    ? mine
      ? 'Bots are filling the empty spots'
      : 'Bots leave when this match ends'
    : humans <= 1
      ? mine
        ? 'Bots on'
        : 'Off: waiting for real players'
      : `${votes.length}/${humans} want bots · they join once everyone does`;
  return el('div', { class: 'bots-row vote' }, el('span', { class: 'label', text: 'Bots' }), sw, el('span', { class: 'bots-state', text }));
}

/** Funny team name pairs for the dice button. */
const TEAM_NAME_PAIRS: [string, string][] = [
  ['Gusty Bois', 'Air Heads'],
  ['Big Blowers', 'Hot Air'],
  ['Floppy Arms', 'Noodle Gang'],
  ['Puff Daddies', 'Wind Bags'],
  ['Team Pump', 'Team Pop'],
  ['Squeakers', 'Wobblers'],
  ['Balloon Boys', 'Blimp Squad'],
  ['Jacked', 'Deflated'],
];

/** The private-room lobby: waiting for the host's START, and how many are in. */
export interface LobbyState {
  waiting: boolean;
  players: number;
  /** Your player id and how many real people are here (public matches' bots vote). */
  you?: number;
  humans?: number;
}

export function buildPause(room: RoomInfo | null, isHost: boolean, cb: PauseCallbacks, lobby: LobbyState = { waiting: false, players: 0 }): HTMLElement {
  const panel = el('div', { class: 'panel pause-panel interactive' });
  panel.append(el('h2', { text: 'Paused' }));
  panel.append(el('button', { class: 'btn big', text: 'RESUME', on: { click: cb.onResume } }));
  if (room?.ranked) {
    panel.append(el('div', { class: 'room-banner warn', text: 'Ranked 1v1 · leaving now counts as a loss' }));
  } else if (room?.isPrivate) {
    panel.append(
      el(
        'div',
        { class: 'room-ticket' },
        el('div', { class: 'grow' }, el('div', { class: 'label', text: room.challenge ? '1v1 challenge' : 'Room code' }), el('div', { class: 'code', text: room.code })),
        el('button', { class: 'btn small blue', text: room.challenge ? 'Copy challenge link' : 'Copy invite link', on: { click: cb.onCopyLink } }),
        cb.onFriends && !room.challenge ? el('button', { class: 'btn small', attrs: { title: 'Invite friends from your friends list' }, on: { click: cb.onFriends } }, iconText('invite', 'Invite')) : null,
      ),
    );
    if (isHost) {
      const field = (label: string, control: HTMLElement) => el('label', { class: 'host-field' }, el('span', { class: 'label', text: label }), control);
      const mode = el('select', { class: 'field', attrs: { 'aria-label': 'Mode' } });
      for (const m of MODE_IDS) {
        const o = el('option', { text: MODE_INFO[m].name, attrs: { value: m } });
        if (m === room.settings.mode) o.selected = true;
        mode.append(o);
      }
      mode.addEventListener('change', () => cb.onHost({ mode: mode.value as ModeId }));
      const map = el('select', { class: 'field', attrs: { 'aria-label': 'Map' } });
      const choices = mapsForMode(room.settings.mode);
      for (const id of choices) {
        const o = el('option', { text: MAPS[id].name, attrs: { value: id } });
        if (id === room.settings.mapId) o.selected = true;
        map.append(o);
      }
      map.disabled = choices.length < 2;
      map.addEventListener('change', () => cb.onHost({ mapId: map.value }));
      const time = el('select', { class: 'field', attrs: { 'aria-label': 'Match length' } });
      // Sudden Death always runs its own short length.
      const sd = room.settings.mode === 'suddenDeath';
      for (const s of sd ? [BALANCE.modes.suddenDeath.durationSec] : [180, 210, 240, 270, 300]) {
        const o = el('option', { text: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`, attrs: { value: String(s) } });
        if (sd || s === room.settings.durationSec) o.selected = true;
        time.append(o);
      }
      time.disabled = sd;
      time.addEventListener('change', () => cb.onHost({ durationSec: Number(time.value) }));
      const bots = el('input', { attrs: { type: 'checkbox', 'aria-label': 'Bots' } });
      bots.checked = room.settings.bots;
      bots.addEventListener('change', () => cb.onHost({ bots: bots.checked }));
      const events = el('select', { class: 'field', attrs: { 'aria-label': 'Random events' } });
      for (const [v, l] of [
        ['off', 'Off'],
        ['rare', 'Rare'],
        ['normal', 'Normal'],
        ['frequent', 'Frequent'],
      ] as [EventFrequency, string][]) {
        const o = el('option', { text: l, attrs: { value: v } });
        if (v === room.settings.events) o.selected = true;
        events.append(o);
      }
      events.addEventListener('change', () => cb.onHost({ events: events.value as EventFrequency }));
      // Team modes: the host names the teams (the server filters the names).
      let teamRow: HTMLElement | null = null;
      if (MODE_INFO[room.settings.mode].teams) {
        const names = room.settings.teamNames ?? ['', ''];
        const inputs = [0, 1].map((t) =>
          el('input', {
            class: 'field team-name',
            attrs: { type: 'text', maxlength: '16', value: names[t] ?? '', placeholder: t === 0 ? 'RED' : 'BLUE', 'aria-label': `Team ${t + 1} name`, spellcheck: 'false' },
          }),
        ) as HTMLInputElement[];
        const send = () => cb.onHost({ teamNames: [inputs[0].value, inputs[1].value] });
        for (const i of inputs) {
          i.addEventListener('change', send);
          i.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Enter') i.blur();
          });
        }
        const dice = el('button', {
          class: 'btn small ghost dice',
          attrs: { title: 'Random team names', 'aria-label': 'Random team names' },
          on: {
            click: () => {
              const pair = TEAM_NAME_PAIRS[Math.floor(Math.random() * TEAM_NAME_PAIRS.length)];
              inputs[0].value = pair[0];
              inputs[1].value = pair[1];
              send();
            },
          },
        });
        dice.append(icon('dice'));
        teamRow = el('div', { class: 'host-field team-names' }, el('span', { class: 'label', text: 'Team names' }), el('div', { class: 'row' }, inputs[0], inputs[1], dice));
      }
      const top = lobby.waiting
        ? el('button', {
            class: 'btn big green start-match',
            text: lobby.players >= 2 ? `START · ${lobby.players} IN` : 'START MATCH',
            attrs: lobby.players >= 2 ? {} : { disabled: 'true', title: 'Needs at least 2 players: invite friends or switch bots on.' },
            on: { click: () => cb.onHost('start') },
          })
        : null;
      panel.append(
        el(
          'div',
          { class: 'host-box' },
          top,
          lobby.waiting && lobby.players < 2 ? el('div', { class: 'small-note', text: 'Waiting for friends. Share the invite link, or switch bots on to play with bots.' }) : null,
          el(
            'div',
            { class: 'host-head' },
            el('span', {}, iconText('crown', 'Host controls')),
            lobby.waiting ? null : el('button', { class: 'btn small yellow', text: 'Restart match', on: { click: () => cb.onHost('restart') } }),
          ),
          el(
            'div',
            { class: 'host-grid' },
            field('Mode', mode),
            field('Map', map),
            field('Match length', time),
            field('Random events', events),
            el('label', { class: 'host-field toggle-field' }, bots, el('span', { text: 'Fill empty spots with bots' })),
            teamRow,
          ),
        ),
      );
    }
  } else if (room) {
    // Public match: its code works as an invite link too, and bots are up to everyone here.
    panel.append(
      el('div', { class: 'room-banner', text: `Public match · ${MODE_INFO[room.settings.mode].name} · ${MAPS[room.mapId]?.name ?? ''}` }),
      el(
        'div',
        { class: 'room-ticket' },
        el('div', { class: 'grow' }, el('div', { class: 'label', text: 'Bring friends into this match' }), el('div', { class: 'code', text: room.code })),
        el('button', { class: 'btn small blue', text: 'Copy invite link', on: { click: cb.onCopyLink } }),
        cb.onFriends ? el('button', { class: 'btn small', attrs: { title: 'Invite friends from your friends list' }, on: { click: cb.onFriends } }, iconText('invite', 'Invite')) : null,
      ),
    );
    if (cb.onBots) panel.append(botsVote(room, lobby.you ?? -1, lobby.humans ?? 1, cb.onBots));
  }
  panel.append(
    el(
      'div',
      { class: 'pause-nav' },
      navButton('target', 'Loadout', cb.onLoadout),
      navButton('locker', 'Locker', cb.onLocker),
      navButton('settings', 'Settings', cb.onSettings),
      navButton('help', 'How to play', cb.onHowTo),
    ),
    el('button', { class: 'btn small ghost leave', text: 'Leave match', on: { click: cb.onLeave } }),
  );
  return el('div', { class: 'overlay interactive' }, panel);
}

/** Things you can do from the scoreboard while the mouse is free. */
export interface ScoreActions {
  onKick: ((id: number) => void) | null;
  onReport: (id: number, reason: ReportReason) => void;
  onMute: (id: number) => void;
  muted: Set<number>;
  reported: Set<number>;
  /** Add someone with an account as a friend (null for guests: you need an account too). */
  onFriend: ((r: RosterEntry) => void) | null;
  /** Where you stand with an account ('' = not friends yet). */
  friendState: (acc: number) => '' | 'friends' | 'incoming' | 'outgoing';
}

export function buildScoreboard(
  roster: RosterEntry[],
  youId: number,
  hostId: number,
  isPrivate: boolean,
  actions: ScoreActions | null,
  teams: TeamView | null = null,
): HTMLElement {
  // Sudden Death: whoever is still in comes first.
  const sorted = [...roster].sort((a, b) => Number(!!a.out) - Number(!!b.out) || b.score - a.score || b.kos - a.kos || a.deaths - b.deaths);
  const panel = el('div', { class: 'panel scoreboard-panel' }, el('h2', { class: 'sb-title', text: 'Scoreboard' }));
  if (!teams) {
    panel.append(scoreTable(sorted, youId, hostId, isPrivate, actions, null));
  } else {
    for (const t of [0, 1]) {
      const score = teams.percent ? `${Math.floor(teams.scores[t] * 100)}%` : String(teams.scores[t]);
      const head = el('div', { class: 'team-head' }, el('span', { text: `${teams.names[t]}${teams.youTeam === t ? ' (YOU)' : ''}` }), el('span', { text: score }));
      head.style.setProperty('--team', hexColor(teams.colors[t]));
      panel.append(head, scoreTable(sorted.filter((r) => r.team === t), youId, hostId, isPrivate, actions, teams.colors[t]));
    }
  }
  if (actions) panel.append(el('div', { class: 'small-note sb-note' }, icon('mute'), ' hides someone’s quick chat · ', icon('flag'), ' reports them to us'));
  else panel.append(el('div', { class: 'small-note sb-note', text: 'Press Esc to free the mouse to mute or report players.' }));
  return el('div', { class: `scoreboard${actions ? ' interactive' : ''}` }, panel);
}

function reportMenu(target: RosterEntry, actions: ScoreActions, cell: HTMLElement): void {
  clear(cell);
  for (const reason of REPORT_REASONS) {
    // Picture reasons only for players showing that picture.
    if ((reason === 'face' && !target.face) || (reason === 'decal' && !target.decal)) continue;
    cell.append(
      el('button', {
        class: 'btn small ghost report-pick',
        text: REPORT_REASON_TEXT[reason],
        on: {
          click: () => {
            actions.onReport(target.id, reason);
            clear(cell);
            cell.append(el('span', { class: 'small-note', text: 'Reported. Thanks!' }));
          },
        },
      }),
    );
  }
}

const MEDALS: IconName[] = ['medalGold', 'medalSilver', 'medalBronze'];

function scoreTable(rows: RosterEntry[], youId: number, hostId: number, isPrivate: boolean, actions: ScoreActions | null, teamColor: number | null): HTMLElement {
  const onKick = actions?.onKick ?? null;
  const table = el('table');
  table.append(el('tr', {}, el('th', { text: '#' }), el('th', { text: 'Player' }), el('th', { text: 'Score' }), el('th', { text: 'KOs' }), el('th', { text: 'Popped' }), el('th', { text: 'Ping' }), actions ? el('th') : null));
  rows.forEach((r, i) => {
    const tr = el(
      'tr',
      { class: `${r.id === youId ? 'me' : ''}${r.out ? ' out' : ''}` },
      el('td', { class: 'rank' }, i < 3 && r.score > 0 && !r.out ? icon(MEDALS[i]) : String(i + 1)),
      el(
        'td',
        { class: 'who' },
        el('span', { class: 'swatch', style: { background: hexColor(teamColor ?? PLAYER_COLORS[r.color]?.hex ?? 0xffffff) } }),
        r.bot ? null : el('span', { class: 'lv-chip', text: `${r.level}`, attrs: { title: `Level ${r.level}` } }),
        r.name,
        r.rating !== undefined ? el('span', { class: 'small-note', style: 'margin-left:6px', text: String(r.rating) }) : null,
        r.bot ? el('span', { class: 'bot-tag', text: 'BOT' }) : null,
        r.id === hostId && isPrivate ? el('span', { style: 'margin-left:6px', attrs: { title: 'Host' } }, icon('crown')) : null,
        r.out ? el('span', { class: 'small-note', style: 'margin-left:6px', attrs: { title: 'Out of this Sudden Death match' } }, iconText('skull', 'OUT')) : null,
      ),
      el('td', { class: 'num score', text: String(r.score) }),
      el('td', { class: 'num', text: String(r.kos) }),
      el('td', { class: 'num', text: String(r.deaths) }),
      el('td', { class: 'num ping', text: r.bot ? '-' : String(r.ping) }),
      actions ? actionCell(r) : null,
    );
    table.append(tr);
  });
  function actionCell(r: RosterEntry): HTMLElement {
    const cell = el('td', { class: 'acts' });
    if (!actions || r.id === youId || r.bot) return cell;
    const muted = actions.muted.has(r.id);
    add(
      cell,
      el('button', {
        class: `btn small icon-btn${muted ? ' yellow' : ' ghost'}`,
        attrs: { title: muted ? 'Show their quick chat' : 'Hide their quick chat', 'aria-label': muted ? 'Show their quick chat' : 'Hide their quick chat' },
        on: {
          click: () => {
            actions.onMute(r.id);
          },
        },
      }, icon(muted ? 'sound' : 'mute')),
      r.acc && actions.onFriend && actions.friendState(r.acc) !== 'friends'
        ? actions.friendState(r.acc) === 'outgoing'
          ? el('span', { class: 'small-note', text: ' sent ' })
          : el(
              'button',
              {
                class: 'btn small ghost icon-btn',
                attrs: { title: actions.friendState(r.acc) === 'incoming' ? 'Accept their friend request' : 'Add as a friend', 'aria-label': 'Add as a friend' },
                on: { click: () => actions.onFriend?.(r) },
              },
              icon('invite'),
            )
        : null,
      actions.reported.has(r.id)
        ? el('span', { class: 'small-note', text: ' reported' })
        : el('button', { class: 'btn small ghost icon-btn', attrs: { title: 'Report', 'aria-label': 'Report' }, on: { click: () => reportMenu(r, actions, cell) } }, icon('flag')),
      onKick ? el('button', { class: 'btn small icon-btn', text: 'Kick', on: { click: () => onKick(r.id) } }) : null,
    );
    return cell;
  }
  return table;
}

export function buildReplayBanner(victim: string, by: string, distance: number, ko: boolean, onSkip: () => void): HTMLElement {
  return el(
    'div',
    { class: 'replay-wrap' },
    el('div', { class: 'letterbox top' }),
    el('div', { class: 'letterbox bottom' }),
    el(
      'div',
      { class: 'replay-banner interactive' },
      el('div', { class: 'tag', text: 'REPLAY' }),
      el('div', { class: 'title', text: 'LONGEST LAUNCH' }),
      el('div', { class: 'sub', text: `${by} sent ${victim} flying ${distance.toFixed(1)} m${ko ? ' right off the map!' : '!'}` }),
      el('button', { class: 'btn small ghost', text: 'Skip ▸', on: { click: onSkip } }),
    ),
  );
}

/** "Next match in 12..." under the results (ticked in place by main.ts). */
export function resultsCountdownText(secondsLeft: number, ranked: boolean, lobby = false): string {
  const s = Math.ceil(secondsLeft);
  return ranked ? `Back to the menu in ${s}...` : lobby ? `Back to the lobby in ${s}...` : `Next match in ${s}...`;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

function confetti(): HTMLElement {
  const colors = ['#ff3b8a', '#ffd60a', '#2ec5ff', '#5ee05e', '#8a4dff', '#ff8a1f'];
  const wrap = el('div', { class: 'confetti', attrs: { 'aria-hidden': 'true' } });
  for (let i = 0; i < 44; i++) {
    const p = el('i');
    p.style.setProperty('--x', `${(i * 37) % 100}%`);
    p.style.setProperty('--c', colors[i % colors.length]);
    p.style.setProperty('--d', `${((i * 7) % 13) * 0.09}s`);
    p.style.setProperty('--t', `${2.4 + ((i * 5) % 9) * 0.18}s`);
    p.style.setProperty('--r', `${((i * 53) % 360) - 180}deg`);
    p.style.setProperty('--w', `${8 + (i % 3) * 3}px`);
    p.style.setProperty('--dx', `${((i * 29) % 80) - 40}px`);
    wrap.append(p);
  }
  return wrap;
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

/** The results screen's buttons: PLAY AGAIN (with who's ready) and back to the menu. */
export interface ResultsActions {
  /** null hides PLAY AGAIN (challenge links). */
  again: { label: string; done: boolean; onClick: () => void } | null;
  onMenu: () => void;
}

/** What the game was played to, in a few words (the results kicker). */
function goalText(result: MatchResult): string {
  if (result.rounds) return `First to ${result.rounds.target} rounds`;
  if (result.mode === 'knockout') return `First to ${BALANCE.modes.knockout.target} KOs`;
  if (result.mode === 'teamKnockout') return `First team to ${BALANCE.modes.teamKnockout.target} KOs`;
  if (result.mode === 'duel') return `First to ${BALANCE.modes.duel.target} KOs`;
  return 'Match over';
}

/**
 * The end-of-match screen: who won, a small podium, your line, rewards and PLAY AGAIN. `intro`
 * plays the entrance (podium rising, confetti); main.ts turns it off when redrawing the same
 * results (e.g. when the rewards arrive or someone presses PLAY AGAIN).
 */
export function buildResults(
  result: MatchResult,
  roster: Map<number, RosterEntry>,
  youId: number,
  secondsLeft: number,
  teams: TeamView | null = null,
  progress: { report: ProgressReport | null; guest: boolean; onSignup: () => void; ranked: boolean; lobby?: boolean } | null = null,
  intro = true,
  actions: ResultsActions | null = null,
): HTMLElement {
  const animate = intro && !prefersReducedMotion();
  const top = result.standings.slice(0, 3);
  const order = [top[1], top[0], top[2]];
  const places = [2, 1, 3];
  const podium = el('div', { class: 'podium' });
  order.forEach((s, i) => {
    if (!s) {
      podium.append(el('div', { class: 'step empty' }));
      return;
    }
    const team = roster.get(s.id)?.team ?? -1;
    const color = hexColor(teams && team >= 0 ? teams.colors[team] : (PLAYER_COLORS[roster.get(s.id)?.color ?? 0]?.hex ?? 0xffffff));
    // Sudden Death ranks by rounds won, so the podium shows those instead of knockouts.
    const line = result.rounds ? `${s.roundWins ?? 0} round${s.roundWins === 1 ? '' : 's'}` : `${s.stats.kos} KO${s.stats.kos === 1 ? '' : 's'}`;
    const place = places[i];
    podium.append(
      el(
        'div',
        { class: `step p${place}${s.id === youId ? ' you' : ''}` },
        el(
          'div',
          { class: 'who' },
          place === 1 ? el('span', { class: 'crown', attrs: { 'aria-hidden': 'true' } }, icon('crown')) : null,
          tubeMan(color, { className: place === 1 ? 'flail' : 'sway', mood: place === 1 ? 'happy' : 'wow' }),
          el('div', { class: 'nm', text: s.id === youId ? 'You' : s.name }),
          el('div', { class: 'pts', text: line }),
        ),
        el('div', { class: 'block' }, icon(MEDALS[place - 1])),
      ),
    );
  });
  const me = result.standings.find((s) => s.id === youId);
  const myPlace = result.standings.findIndex((s) => s.id === youId) + 1;
  const winner = result.standings[0];
  let won = winner?.id === youId;
  let title = won ? 'YOU WIN!' : `${winner?.name ?? 'Nobody'} wins!`;
  let teamLine: HTMLElement | null = null;
  const tr = result.teams;
  if (tr && teams) {
    const w = tr.winner;
    won = w >= 0 && w === teams.youTeam;
    title = w < 0 ? "IT'S A DRAW!" : won ? 'YOUR TEAM WINS!' : `${teams.names[w]} TEAM WINS!`;
    const fmt = (v: number) => (result.mode === 'pump' ? `${v}%` : String(v));
    teamLine = el(
      'div',
      { class: 'team-result' },
      el('span', { class: 'team', text: `${teams.names[0]} ${fmt(tr.scores[0])}`, style: { color: hexColor(teams.colors[0]) } }),
      el('span', { class: 'dash', text: '–' }),
      el('span', { class: 'team', text: `${fmt(tr.scores[1])} ${teams.names[1]}`, style: { color: hexColor(teams.colors[1]) } }),
    );
  }
  // Your match in one line.
  const mine = me
    ? (
        [
          !tr && !won && myPlace > 0 ? [null, `${ordinal(myPlace)} of ${result.standings.length}`] : null,
          result.rounds ? ['finishFlag', `${me.roundWins ?? 0} round${me.roundWins === 1 ? '' : 's'}`] : null,
          ['boom', `${me.stats.kos} KO${me.stats.kos === 1 ? '' : 's'}`],
          ['heliumBalloon', `popped ${me.stats.deaths}×`],
        ] as ([IconName | null, string] | null)[]
      ).filter((x) => x !== null)
    : [];
  const myLine = mine.length ? el('div', { class: 'my-line' }, ...mine.map(([i, t]) => el('span', {}, i ? icon(i) : null, t))) : null;
  const countdown = el('div', { class: 'countdown', attrs: { 'data-countdown': '' } }, resultsCountdownText(secondsLeft, !!progress?.ranked, !!progress?.lobby));
  const buttons = actions
    ? el(
        'div',
        { class: 'results-buttons' },
        actions.again
          ? el('button', {
              class: `btn big play-again${actions.again.done ? ' done' : ''}`,
              text: actions.again.label,
              attrs: actions.again.done ? { disabled: '' } : {},
              on: { click: actions.again.onClick },
            })
          : null,
        el('button', { class: 'btn ghost results-menu', text: 'MENU', on: { click: actions.onMenu } }),
      )
    : null;
  const cls = `overlay results${won ? ' won' : ''}${animate ? '' : ' settled'}`;
  return el(
    'div',
    { class: cls },
    won && animate ? confetti() : null,
    el(
      'div',
      { class: 'panel results-panel' },
      el(
        'div',
        { class: 'results-head' },
        el('div', { class: 'kicker', text: `${MODE_INFO[result.mode]?.name ?? ''} · ${goalText(result)}` }),
        el('h2', { class: 'results-title', text: title }),
        teamLine,
      ),
      podium,
      myLine,
      progress?.report ? buildProgressBox(progress.report, progress.guest, progress.onSignup) : null,
      buttons,
      el('div', { class: 'results-foot' }, countdown),
    ),
  );
}

export function buildHowTo(onClose: () => void, bindings: Record<Action, string[]> = DEFAULT_BINDINGS, padLabels?: Record<string, string>, touch = false): HTMLElement {
  const grid = el('div', { class: 'controls-grid two-col' });
  // A key's label, or the icon on the touch button of that name.
  const row = (keys: string[], what: string) =>
    grid.append(el('div', { class: 'keys' }, ...keys.map((k) => (touch && isIconName(k) ? el('span', { class: 'key ico-key' }, icon(k)) : el('span', { class: 'key', text: k })))), el('div', { class: 'what', text: what }));
  if (touch) {
    row(['Left thumb'], 'Move (the stick appears where you touch)');
    row(['Drag right side'], 'Aim');
    row(['FIRE'], 'Fire (hold to charge, drag to aim while charging)');
    row(['JUMP'], 'Jump / double jump');
    row(['dash'], 'Dash');
    row(['shield'], 'Brace (right before a hit)');
    row(['fist'], 'Grab / catch a ledge');
    row(['hook'], 'Grapple');
    row(['reload'], 'Reload');
    row(['bouncePad', 'grenade'], 'Your two gadgets');
    row(['ULT'], 'Ultimate ability (glows when the meter is full)');
    row(['video'], 'First / third person');
    row(['chat'], 'Quick chat');
    row(['trophy'], 'Scoreboard (hold)');
    row(['pause'], 'Pause');
  } else {
    row(['W', 'A', 'S', 'D'], 'Move');
    row(['Trackpad'], 'Aim (or mouse)');
    for (const a of ['fire', 'jump', 'dash', 'brace', 'grapple', 'grab', 'reload', 'util1', 'util2', 'ult', 'camera', 'taunt', 'chat', 'scoreboard'] as Action[]) {
      row(bindings[a].slice(0, 2).map(codeLabel), ACTION_LABELS[a]);
    }
    row(['Esc'], 'Menu');
  }
  const card = (ico: IconName, title: string, html: string) =>
    el('div', { class: 'howto-card' }, el('div', { class: 'ico', attrs: { 'aria-hidden': 'true' } }, icon(ico)), el('div', {}, el('div', { class: 'ttl', text: title }), el('div', { class: 'txt', html })));
  return el(
    'div',
    { class: 'overlay interactive' },
    el(
      'div',
      { class: 'panel howto-panel' },
      el('h2', { text: 'How to play' }),
      el(
        'div',
        { class: 'howto-cards' },
        card('heliumBalloon', 'Hits inflate you', 'No health bars here. Every hit makes you <b>bigger, lighter</b> and easier to launch.'),
        card('wave', 'Off the edge = out', 'The only way out is off the edge! Knock everyone else off the map.'),
        card('airCannon', 'Charge big shots', 'Hold fire to <b>charge</b>. Aim at feet to pop people <b>up</b>, at their side to push them <b>sideways</b>.'),
        card('rocket', 'Blast jump', 'Shoot the ground near you to <b>blast jump</b> out of trouble.'),
      ),
      el('div', { class: 'label section-label', text: touch ? 'Touch controls' : 'Keyboard and mouse' }),
      grid,
      padLabels ? el('div', { class: 'label section-label', text: 'Controller' }) : null,
      padLabels ? buildPadGrid(padLabels) : null,
      el('div', { class: 'panel-foot' }, el('button', { class: 'btn', text: 'GOT IT', on: { click: onClose } })),
    ),
  );
}

export interface SettingsCallbacks {
  onChange: (s: Settings) => void;
  onClose: () => void;
  onRebind?: (action: Action, done: () => void) => void;
  /** Controller remapping: current button names per action, and a capture hook. */
  padLabels?: () => Record<string, string>;
  onRebindPad?: (action: string, done: () => void) => void;
}

export function buildSettings(s: Settings, cb: SettingsCallbacks, tab: 'controls' | 'audio' | 'graphics' = 'controls'): HTMLElement {
  const panel = el('div', { class: 'panel settings-panel' });
  const body = el('div');
  const tabs = el('div', { class: 'tabs', attrs: { role: 'tablist' } });
  const tabNames: ['controls' | 'audio' | 'graphics', string, IconName][] = [
    ['controls', 'Controls', 'gamepad'],
    ['audio', 'Audio', 'sound'],
    ['graphics', 'Graphics', 'sparkles'],
  ];
  const render = (t: typeof tab) => {
    clear(tabs);
    for (const [id, label, ico] of tabNames) {
      tabs.append(el('button', { class: `tab${id === t ? ' on' : ''}`, attrs: { role: 'tab', 'aria-selected': String(id === t) }, on: { click: () => render(id) } }, iconText(ico, label)));
    }
    clear(body);
    const grid = el('div', { class: 'settings-grid' });
    const slider = (label: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void, fmt: (v: number) => string = (v) => v.toFixed(2)) => {
      const input = el('input', { attrs: { type: 'range', min: String(min), max: String(max), step: String(step), 'aria-label': label } });
      input.value = String(get());
      const val = el('div', { class: 'val', text: fmt(get()) });
      // The filled part of the track.
      const fill = () => input.style.setProperty('--pct', `${((Number(input.value) - min) / (max - min)) * 100}%`);
      fill();
      input.addEventListener('input', () => {
        set(Number(input.value));
        val.textContent = fmt(Number(input.value));
        fill();
        cb.onChange(s);
      });
      grid.append(el('div', { class: 'lbl', text: label }), input, val);
    };
    const check = (label: string, get: () => boolean, set: (v: boolean) => void) => {
      const input = el('input', { attrs: { type: 'checkbox', 'aria-label': label } });
      input.checked = get();
      input.addEventListener('change', () => {
        set(input.checked);
        cb.onChange(s);
      });
      grid.append(el('div', { class: 'lbl', text: label }), el('div', {}, input), el('div'));
    };
    const select = (label: string, options: [string, string][], get: () => string, set: (v: string) => void) => {
      const sel = el('select', { class: 'field', attrs: { 'aria-label': label } });
      for (const [v, l] of options) {
        const o = el('option', { text: l, attrs: { value: v } });
        if (v === get()) o.selected = true;
        sel.append(o);
      }
      sel.addEventListener('change', () => {
        set(sel.value);
        cb.onChange(s);
      });
      grid.append(el('div', { class: 'lbl', text: label }), sel, el('div'));
    };
    if (t === 'controls') {
      select('Aiming with', [
        ['trackpad', 'Trackpad'],
        ['mouse', 'Mouse'],
      ], () => s.device, (v) => {
        s.device = v as Settings['device'];
        s.deviceAsked = true;
      });
      slider('Trackpad sensitivity', 0.2, 3, 0.05, () => s.sensTrackpad, (v) => (s.sensTrackpad = v));
      slider('Mouse sensitivity', 0.2, 3, 0.05, () => s.sensMouse, (v) => (s.sensMouse = v));
      slider('Controller sensitivity', 0.2, 3, 0.05, () => s.sensController, (v) => (s.sensController = v));
      slider('Touch aim sensitivity', 0.2, 3, 0.05, () => s.sensTouch, (v) => (s.sensTouch = v));
      slider('Controller aim assist', 0, 1, 0.05, () => s.aimAssist, (v) => (s.aimAssist = v), (v) => (v === 0 ? 'Off' : `${Math.round(v * 100)}%`));
      check('Invert Y', () => s.invertY, (v) => (s.invertY = v));
      slider('Field of view', 65, 105, 1, () => s.fov, (v) => (s.fov = v), (v) => `${v}°`);
      check('Third-person camera', () => s.thirdPerson, (v) => (s.thirdPerson = v));
      body.append(grid);
      if (cb.onRebind) body.append(buildBindings(s, cb));
      if (cb.onRebindPad && cb.padLabels) body.append(buildPadBindings(s, cb));
    } else if (t === 'audio') {
      check('Mute everything', () => s.volumes.muted, (v) => (s.volumes.muted = v));
      const pct = (v: number) => `${Math.round(v * 100)}%`;
      slider('Master', 0, 1, 0.01, () => s.volumes.master, (v) => (s.volumes.master = v), pct);
      slider('Effects', 0, 1, 0.01, () => s.volumes.effects, (v) => (s.volumes.effects = v), pct);
      slider('Announcer', 0, 1, 0.01, () => s.volumes.announcer, (v) => (s.volumes.announcer = v), pct);
      slider('Music', 0, 1, 0.01, () => s.volumes.music, (v) => (s.volumes.music = v), pct);
      body.append(grid, el('p', { class: 'small-note settings-note', text: 'Every sound in Blubba has an on-screen version, so the game is fully playable muted.' }));
    } else {
      select('Graphics quality', [
        ['auto', 'Auto (recommended)'],
        ['high', 'High'],
        ['medium', 'Medium'],
        ['low', 'Low (fastest)'],
      ], () => s.quality, (v) => (s.quality = v as Settings['quality']));
      const pctOff = (v: number) => (v === 0 ? 'Off' : `${Math.round(v * 100)}%`);
      slider('Screen shake', 0, 1, 0.05, () => s.screenShake, (v) => (s.screenShake = v), pctOff);
      slider('Screen flashes', 0, 1, 0.05, () => s.screenFlashes, (v) => (s.screenFlashes = v), pctOff);
      select('Comic words over players', [
        ['near', 'Mine + nearby (recommended)'],
        ['all', 'Everyone'],
        ['mine', 'Only mine'],
      ], () => s.popupWords, (v) => (s.popupWords = v as Settings['popupWords']));
      check('Colorblind-friendly team colors', () => s.colorblindTeams, (v) => (s.colorblindTeams = v));
      check("Show other players' quick chat", () => s.showQuickChat, (v) => (s.showQuickChat = v));
      check("Show other players' face scans", () => s.showFaces, (v) => (s.showFaces = v));
      check('Show FPS', () => s.showFps, (v) => (s.showFps = v));
      body.append(grid);
    }
  };
  render(tab);
  panel.append(el('h2', { text: 'Settings' }), tabs, body, el('div', { class: 'panel-foot' }, el('button', { class: 'btn', text: 'DONE', on: { click: cb.onClose } })));
  return el('div', { class: 'overlay interactive' }, panel);
}

function buildPadGrid(labels: Record<string, string>): HTMLElement {
  const grid = el('div', { class: 'controls-grid two-col' });
  const row = (key: string, what: string) => grid.append(el('div', { class: 'keys' }, el('span', { class: 'key', text: key })), el('div', { class: 'what', text: what }));
  row('L-stick', 'Move');
  row('R-stick', 'Aim');
  for (const [a, name] of Object.entries(PAD_ACTION_LABELS)) row(labels[a] ?? '?', name);
  return grid;
}

const PAD_ACTION_LABELS: Record<string, string> = {
  fire: 'Fire (hold to charge)',
  grapple: 'Grapple',
  jump: 'Jump',
  dash: 'Dash',
  brace: 'Brace',
  grab: 'Grab / ledge grab',
  reload: 'Reload',
  util1: 'Utility 1',
  util2: 'Utility 2',
  taunt: 'Taunt',
  ult: 'Ultimate ability',
  camera: 'Camera: first / third person',
  chat: 'Quick chat (hold, aim with R-stick)',
  scoreboard: 'Scoreboard',
  menu: 'Menu',
};

function buildPadBindings(s: Settings, cb: SettingsCallbacks): HTMLElement {
  const wrap = el('div', { class: 'bindings' }, el('div', { class: 'label section-label', text: 'Controller buttons (click, then press a button). Left stick moves, right stick aims.' }));
  const grid = el('div', { class: 'bind-grid' });
  const draw = () => {
    clear(grid);
    const labels = cb.padLabels!();
    for (const a of Object.keys(PAD_ACTION_LABELS)) {
      const btn = el('button', { class: 'btn small ghost keycap', text: labels[a] ?? '?' });
      btn.addEventListener('click', () => {
        btn.textContent = 'Press a button...';
        btn.classList.add('listening');
        cb.onRebindPad!(a, draw);
      });
      const reset = el('button', {
        class: 'btn small ghost icon-btn',
        text: '↺',
        attrs: { title: 'Reset to default', 'aria-label': `Reset ${PAD_ACTION_LABELS[a]} to default` },
        on: {
          click: () => {
            delete s.padBindings[a];
            cb.onChange(s);
            draw();
          },
        },
      });
      grid.append(el('div', { class: 'lbl', text: PAD_ACTION_LABELS[a] }), btn, reset);
    }
  };
  draw();
  wrap.append(grid);
  return wrap;
}

function buildBindings(s: Settings, cb: SettingsCallbacks): HTMLElement {
  const wrap = el('div', { class: 'bindings' }, el('div', { class: 'label section-label', text: 'Key bindings (click to change)' }));
  const grid = el('div', { class: 'bind-grid' });
  const actions = Object.keys(ACTION_LABELS) as Action[];
  const draw = () => {
    clear(grid);
    for (const a of actions) {
      const codes = s.bindings[a] ?? DEFAULT_BINDINGS[a];
      const btn = el('button', { class: 'btn small ghost keycap', text: codes.map(codeLabel).join(' / ') || '—', attrs: { 'data-capture': '1' } });
      btn.addEventListener('click', () => {
        btn.textContent = 'Press a key...';
        btn.classList.add('listening');
        cb.onRebind!(a, () => {
          draw();
        });
      });
      const reset = el('button', {
        class: 'btn small ghost icon-btn',
        text: '↺',
        attrs: { title: 'Reset to default', 'aria-label': `Reset ${ACTION_LABELS[a]} to default` },
        on: {
          click: () => {
            delete s.bindings[a];
            cb.onChange(s);
            draw();
          },
        },
      });
      grid.append(el('div', { class: 'lbl', text: ACTION_LABELS[a] }), btn, reset);
    }
  };
  draw();
  wrap.append(grid);
  return wrap;
}
