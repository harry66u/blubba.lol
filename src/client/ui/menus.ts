import { BALANCE } from '../../shared/balance';
import { PLAYER_COLORS } from '../../shared/colors';
import { MODE_IDS, MODE_INFO, type ModeId } from '../../shared/game/modes';
import type { MatchResult } from '../../shared/game/sim';
import { type ProgressReport, REPORT_REASONS, REPORT_REASON_TEXT, type ReportReason } from '../../shared/economy';
import { buildProgressBox } from './accountUi';
import { KNOCKOUT_MAPS, MAPS, mapForMode } from '../../shared/maps';
import { checkName, randomGuestName } from '../../shared/names';
import type { EventFrequency, RoomInfo, RosterEntry } from '../../shared/protocol';
import { ACTION_LABELS, type Action, DEFAULT_BINDINGS, codeLabel } from '../input/input';
import type { Settings } from '../settings';
import { add, clear, el, hexColor } from './dom';

/** Everything the mode picker offers: the five modes plus ranked 1v1. */
export type PlayMode = ModeId | 'ranked';

export interface MenuCallbacks {
  onLoadout: () => void;
  onLocker: () => void;
  onProfile: () => void;
  onPlay: (name: string, mode: PlayMode) => void;
  onChallenge: (name: string) => void;
  onModeChange: (mode: PlayMode) => void;
  onCreate: (name: string) => void;
  onJoinCode: (name: string, code: string) => void;
  onSettings: () => void;
  onHowTo: () => void;
  onNameChange: (name: string) => void;
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

function logo(): HTMLElement {
  return el('div', { class: 'logo' }, ...'BUBBA'.split('').map((ch) => el('span', { text: ch })));
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

export function buildMainMenu(name: string, cb: MenuCallbacks, notice?: string, initialMode: PlayMode = 'knockout', accountName: string | null = null): HTMLElement {
  const err = el('div', { class: 'error-text', text: notice ?? '' });
  const nameInput = nameField(accountName ?? name, cb.onNameChange, err);
  if (accountName) {
    // Account names are fixed; guests can pick any (filtered) name.
    nameInput.disabled = true;
    nameInput.title = 'Your account name';
  }
  const dice = el('button', {
    class: 'btn small ghost',
    text: '🎲',
    attrs: { title: 'Random name', 'aria-label': 'Random name' },
    on: {
      click: () => {
        nameInput.value = randomGuestName();
        cb.onNameChange(nameInput.value);
        err.textContent = '';
      },
    },
  });
  let mode: PlayMode = initialMode;
  const blurb = el('div', { class: 'mode-blurb' });
  const picker = el('div', { class: 'mode-picker', attrs: { role: 'radiogroup', 'aria-label': 'Game mode' } });
  const play = el('button', {
    class: 'btn big',
    text: 'PLAY',
    on: {
      click: () => {
        const n = accountName ?? validName(nameInput, err);
        if (n) cb.onPlay(n, mode);
      },
    },
  });
  const info = (m: PlayMode) => (m === 'ranked' ? { name: 'Ranked', blurb: 'Rated 1v1 against someone near your skill. Needs a free account.' } : MODE_INFO[m]);
  const pick = (m: PlayMode) => {
    mode = m;
    for (const b of picker.querySelectorAll('button')) b.classList.toggle('on', b.dataset.mode === m);
    blurb.textContent = info(m).blurb;
  };
  for (const m of [...MODE_IDS, 'ranked'] as PlayMode[]) {
    const b = el('button', {
      text: info(m).name,
      attrs: { 'data-mode': m, role: 'radio', title: info(m).blurb },
      on: {
        click: () => {
          pick(m);
          cb.onModeChange(m);
        },
      },
    });
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
    el('div', { class: 'label', text: 'Your name' }),
    el('div', { class: 'row' }, nameInput, accountName ? null : dice),
    picker,
    blurb,
    play,
    el('div', { class: 'row split' }, create, challenge),
    el('div', { class: 'row' }, el('div', { class: 'grow', style: 'font-size:16px', text: 'Got a code?' }), codeInput, joinBtn),
    err,
  );
  const footer = el(
    'div',
    { class: 'menu-footer' },
    el('button', { class: 'btn small ghost', text: 'Loadout', on: { click: cb.onLoadout } }),
    el('button', { class: 'btn small ghost', text: 'Locker', on: { click: cb.onLocker } }),
    el('button', { class: 'btn small ghost', text: 'Profile', on: { click: cb.onProfile } }),
    el('button', { class: 'btn small ghost', text: 'How to play', on: { click: cb.onHowTo } }),
    el('button', { class: 'btn small ghost', text: 'Settings', on: { click: cb.onSettings } }),
  );
  return el('div', { class: 'menu' }, logo(), el('div', { class: 'tagline', text: 'Blast your friends off the map!' }), card, footer);
}

export function buildRoomJoin(
  code: string,
  name: string,
  cb: { onJoin: (name: string) => void; onBack: () => void; onNameChange: (n: string) => void },
  notice?: string,
  challenge = false,
): HTMLElement {
  const err = el('div', { class: 'error-text', text: notice ?? '' });
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
  const card = el(
    'div',
    { class: 'panel menu-card interactive' },
    el('div', { class: 'room-banner', html: challenge ? `⚔️ You've been challenged to a <b>1v1</b>! First to ${BALANCE.modes.duel.target} knockouts.` : `You're invited to room <b>${code}</b>` }),
    el('div', { class: 'label', text: 'Your name' }),
    nameInput,
    join,
    el('button', { class: 'btn small ghost', text: 'Back to menu', on: { click: cb.onBack } }),
    err,
  );
  return el('div', { class: 'menu' }, logo(), card);
}

export function buildClickToPlay(text: string, onClick: () => void): HTMLElement {
  return el(
    'div',
    { class: 'click-to-play interactive', on: { click: onClick } },
    el('div', { class: 'big-text', text }),
    el('div', { class: 'tagline', text: 'Click anywhere to play' }),
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
  onHost: (action: 'restart' | { durationSec?: number; bots?: boolean; events?: EventFrequency; mode?: ModeId; mapId?: string }) => void;
}

export function buildPause(room: RoomInfo | null, isHost: boolean, cb: PauseCallbacks): HTMLElement {
  const panel = el('div', { class: 'panel interactive', style: 'display:flex;flex-direction:column;gap:14px;min-width:360px' });
  panel.append(el('h2', { text: 'Paused' }));
  panel.append(el('button', { class: 'btn big', text: 'RESUME', on: { click: cb.onResume } }));
  if (room?.ranked) {
    panel.append(el('div', { class: 'room-banner', text: 'Ranked 1v1 · leaving now counts as a loss' }));
  } else if (room?.isPrivate) {
    panel.append(
      el(
        'div',
        { class: 'row' },
        el('div', { class: 'grow room-banner', html: room.challenge ? `1v1 challenge <b>${room.code}</b>` : `Room code <b>${room.code}</b>` }),
        el('button', { class: 'btn small blue', text: room.challenge ? 'Copy challenge link' : 'Copy invite link', on: { click: cb.onCopyLink } }),
      ),
    );
    if (isHost) {
      const selectStyle = 'font-size:16px;padding:6px';
      const mode = el('select', { class: 'field', style: selectStyle, attrs: { 'aria-label': 'Mode' } });
      for (const m of MODE_IDS) {
        const o = el('option', { text: MODE_INFO[m].name, attrs: { value: m } });
        if (m === room.settings.mode) o.selected = true;
        mode.append(o);
      }
      mode.addEventListener('change', () => cb.onHost({ mode: mode.value as ModeId }));
      const map = el('select', { class: 'field', style: selectStyle, attrs: { 'aria-label': 'Map' } });
      const forced = mapForMode(room.settings.mode);
      for (const id of forced ? [forced] : KNOCKOUT_MAPS) {
        const o = el('option', { text: MAPS[id].name, attrs: { value: id } });
        if (id === room.settings.mapId) o.selected = true;
        map.append(o);
      }
      map.disabled = !!forced;
      map.addEventListener('change', () => cb.onHost({ mapId: map.value }));
      const time = el('select', { class: 'field', style: 'font-size:16px;padding:6px' });
      for (const s of [180, 210, 240, 270, 300]) {
        const o = el('option', { text: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`, attrs: { value: String(s) } });
        if (s === room.settings.durationSec) o.selected = true;
        time.append(o);
      }
      time.addEventListener('change', () => cb.onHost({ durationSec: Number(time.value) }));
      const bots = el('input', { attrs: { type: 'checkbox' } });
      bots.checked = room.settings.bots;
      bots.addEventListener('change', () => cb.onHost({ bots: bots.checked }));
      const events = el('select', { class: 'field', style: 'font-size:16px;padding:6px' });
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
      panel.append(
        el('div', { class: 'label', text: 'Host controls' }),
        el('div', { class: 'row' }, el('span', { text: 'Mode' }), mode, el('span', { text: 'Map' }), map),
        el('div', { class: 'row' }, el('span', { text: 'Match length' }), time, el('label', { class: 'row', style: 'font-size:16px' }, bots, 'Bots')),
        el('div', { class: 'row' }, el('span', { text: 'Random events' }), events),
        el('button', { class: 'btn small yellow', text: 'Restart match', on: { click: () => cb.onHost('restart') } }),
      );
    }
  } else {
    panel.append(el('div', { class: 'room-banner', text: `Public match · ${MODE_INFO[room?.settings.mode ?? 'knockout'].name} · ${MAPS[room?.mapId ?? 'dealership']?.name ?? ''}` }));
  }
  panel.append(
    el(
      'div',
      { class: 'row' },
      el('button', { class: 'btn small ghost', text: 'Loadout', on: { click: cb.onLoadout } }),
      el('button', { class: 'btn small ghost', text: 'Locker', on: { click: cb.onLocker } }),
      el('button', { class: 'btn small ghost', text: 'Settings', on: { click: cb.onSettings } }),
      el('button', { class: 'btn small ghost', text: 'How to play', on: { click: cb.onHowTo } }),
      el('div', { class: 'grow' }),
      el('button', { class: 'btn small', text: 'Leave match', on: { click: cb.onLeave } }),
    ),
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
}

export function buildScoreboard(
  roster: RosterEntry[],
  youId: number,
  hostId: number,
  isPrivate: boolean,
  actions: ScoreActions | null,
  teams: TeamView | null = null,
): HTMLElement {
  const sorted = [...roster].sort((a, b) => b.score - a.score || b.kos - a.kos || a.deaths - b.deaths);
  const panel = el('div', { class: 'panel' });
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
  if (actions) panel.append(el('div', { class: 'small-note', style: 'margin-top:8px', text: '🔇 hides someone’s quick chat · ⚑ reports them to us' }));
  else panel.append(el('div', { class: 'small-note', style: 'margin-top:8px', text: 'Press Esc to free the mouse to mute or report players.' }));
  return el('div', { class: `scoreboard${actions ? ' interactive' : ''}` }, panel);
}

function reportMenu(target: RosterEntry, actions: ScoreActions, cell: HTMLElement): void {
  clear(cell);
  for (const reason of REPORT_REASONS) {
    cell.append(
      el('button', {
        class: 'btn small',
        style: 'margin:2px;font-size:11px;padding:3px 6px',
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

function scoreTable(rows: RosterEntry[], youId: number, hostId: number, isPrivate: boolean, actions: ScoreActions | null, teamColor: number | null): HTMLElement {
  const onKick = actions?.onKick ?? null;
  const table = el('table');
  table.append(el('tr', {}, el('th', { text: '#' }), el('th', { text: 'Player' }), el('th', { text: 'Score' }), el('th', { text: 'KOs' }), el('th', { text: 'Popped' }), el('th', { text: 'Ping' }), actions ? el('th') : null));
  rows.forEach((r, i) => {
    const tr = el(
      'tr',
      { class: r.id === youId ? 'me' : '' },
      el('td', { text: String(i + 1) }),
      el(
        'td',
        {},
        el('span', { class: 'swatch', style: { background: hexColor(teamColor ?? PLAYER_COLORS[r.color]?.hex ?? 0xffffff) } }),
        r.bot ? null : el('span', { class: 'lv-chip', text: `${r.level}`, attrs: { title: `Level ${r.level}` } }),
        r.name,
        r.rating !== undefined ? el('span', { class: 'small-note', style: 'margin-left:6px', text: String(r.rating) }) : null,
        r.bot ? el('span', { class: 'key', style: 'margin-left:6px;font-size:10px;min-width:0', text: 'BOT' }) : null,
        r.id === hostId && isPrivate ? el('span', { style: 'margin-left:6px', text: '👑', attrs: { title: 'Host' } }) : null,
      ),
      el('td', { text: String(r.score) }),
      el('td', { text: String(r.kos) }),
      el('td', { text: String(r.deaths) }),
      el('td', { text: r.bot ? '-' : String(r.ping) }),
      actions ? actionCell(r) : null,
    );
    table.append(tr);
  });
  function actionCell(r: RosterEntry): HTMLElement {
    const cell = el('td', { style: 'white-space:nowrap' });
    if (!actions || r.id === youId || r.bot) return cell;
    const muted = actions.muted.has(r.id);
    add(
      cell,
      el('button', {
        class: `btn small${muted ? ' yellow' : ''}`,
        style: 'padding:3px 8px',
        text: muted ? '🔈' : '🔇',
        attrs: { title: muted ? 'Show their quick chat' : 'Hide their quick chat' },
        on: {
          click: () => {
            actions.onMute(r.id);
          },
        },
      }),
      actions.reported.has(r.id)
        ? el('span', { class: 'small-note', text: ' reported' })
        : el('button', { class: 'btn small', style: 'padding:3px 8px;margin-left:4px', text: '⚑', attrs: { title: 'Report' }, on: { click: () => reportMenu(r, actions, cell) } }),
      onKick ? el('button', { class: 'btn small', style: 'padding:3px 8px;margin-left:4px', text: 'Kick', on: { click: () => onKick(r.id) } }) : null,
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

export function buildResults(
  result: MatchResult,
  roster: Map<number, RosterEntry>,
  youId: number,
  secondsLeft: number,
  teams: TeamView | null = null,
  progress: { report: ProgressReport | null; guest: boolean; onSignup: () => void; ranked: boolean } | null = null,
): HTMLElement {
  const top = result.standings.slice(0, 3);
  const order = [top[1], top[0], top[2]];
  const heights = [110, 150, 80];
  const colors = ['#c9d2e8', '#ffd60a', '#ff9f6a'];
  const podium = el('div', { class: 'podium' });
  order.forEach((s, i) => {
    if (!s) {
      podium.append(el('div', { class: 'step' }));
      return;
    }
    const team = roster.get(s.id)?.team ?? -1;
    const color = hexColor(teams && team >= 0 ? teams.colors[team] : (PLAYER_COLORS[roster.get(s.id)?.color ?? 0]?.hex ?? 0xffffff));
    podium.append(
      el(
        'div',
        { class: 'step' },
        el('span', { class: 'swatch', style: { background: color, width: '34px', height: '34px' } }),
        el('div', { style: 'font-size:18px', text: s.name }),
        el('div', { style: 'font-size:14px;opacity:.7', text: `${s.score} pts` }),
        el('div', { class: 'block', style: { height: `${heights[i]}px`, background: colors[i] }, text: String(i === 1 ? 1 : i === 0 ? 2 : 3) }),
      ),
    );
  });
  const me = result.standings.find((s) => s.id === youId);
  const winner = result.standings[0];
  let title = winner?.id === youId ? 'YOU WIN!' : `${winner?.name ?? 'Nobody'} wins!`;
  let teamLine: HTMLElement | null = null;
  const tr = result.teams;
  if (tr && teams) {
    const w = tr.winner;
    title = w < 0 ? "IT'S A DRAW!" : w === teams.youTeam ? 'YOUR TEAM WINS!' : `${teams.names[w]} TEAM WINS!`;
    const fmt = (v: number) => (result.mode === 'pump' ? `${v}%` : String(v));
    teamLine = el(
      'div',
      { class: 'team-result', style: 'text-align:center' },
      el('span', { text: `${teams.names[0]} ${fmt(tr.scores[0])}`, style: { color: hexColor(teams.colors[0]) } }),
      el('span', { text: '  –  ' }),
      el('span', { text: `${fmt(tr.scores[1])} ${teams.names[1]}`, style: { color: hexColor(teams.colors[1]) } }),
    );
  }
  const stats = el('div', { class: 'stat-grid' });
  const addStat = (k: string, v: string) => stats.append(el('div', { class: 'stat' }, el('div', { class: 'v', text: v }), el('div', { class: 'k', text: k })));
  if (me) {
    addStat('Your knockouts', String(me.stats.kos));
    addStat('Times popped', String(me.stats.deaths));
    addStat('Your longest launch', `${me.stats.longestLaunch.toFixed(1)} m`);
    addStat('Hits landed', String(me.stats.hits));
  }
  const nameOf = (id: number) => result.standings.find((s) => s.id === id)?.name ?? '?';
  const awardText: Record<string, (v: number) => string> = {
    longestLaunch: (v) => `Longest launch · ${v.toFixed(1)} m`,
    mostKos: (v) => `Most knockouts · ${v}`,
    mostChain: (v) => `Most chain knockouts · ${v}`,
    bestCombo: (v) => `Best air combo · ${v} hits`,
    mostPopped: (v) => `Popped the most · ${v}`,
  };
  const awards = el('div', { class: 'awards' });
  for (const a of result.awards ?? []) {
    awards.append(el('div', { class: `award${a.id === youId ? ' me' : ''}` }, el('div', { class: 'k', text: awardText[a.key]?.(a.value) ?? a.key }), el('div', { class: 'v', text: nameOf(a.id) })));
  }
  return el(
    'div',
    { class: 'overlay results' },
    el(
      'div',
      { class: 'panel', style: 'min-width:520px' },
      el('h2', { text: title, style: 'text-align:center' }),
      teamLine,
      podium,
      awards,
      stats,
      progress?.report ? buildProgressBox(progress.report, progress.guest, progress.onSignup) : null,
      el('div', { style: 'text-align:center;margin-top:14px;opacity:.7', text: progress?.ranked ? `Back to the menu in ${Math.ceil(secondsLeft)}...` : `Next match in ${Math.ceil(secondsLeft)}...` }),
    ),
  );
}

export function buildHowTo(onClose: () => void, bindings: Record<Action, string[]> = DEFAULT_BINDINGS, padLabels?: Record<string, string>): HTMLElement {
  const grid = el('div', { class: 'controls-grid' });
  const row = (keys: string[], what: string) => grid.append(el('div', {}, ...keys.map((k) => el('span', { class: 'key', text: k, style: 'margin-right:4px' }))), el('div', { text: what }));
  row(['W', 'A', 'S', 'D'], 'Move');
  row(['Trackpad'], 'Aim (or mouse)');
  for (const a of ['fire', 'jump', 'dash', 'brace', 'grapple', 'grab', 'reload', 'util1', 'util2', 'camera', 'taunt', 'chat', 'scoreboard'] as Action[]) {
    row(bindings[a].slice(0, 2).map(codeLabel), ACTION_LABELS[a]);
  }
  row(['Esc'], 'Menu');
  return el(
    'div',
    { class: 'overlay interactive' },
    el(
      'div',
      { class: 'panel' },
      el('h2', { text: 'How to play' }),
      el('p', {
        style: 'font-size:17px;line-height:1.4;margin-top:0',
        html: 'No health bars here. Every hit <b>inflates</b> you: bigger, lighter, and easier to launch. The only way out is off the edge! Hold fire to <b>charge</b> big shots. Aim at feet to pop people <b>up</b>, at their side to push them <b>sideways</b>. Shoot the ground near you to <b>blast jump</b>.',
      }),
      grid,
      padLabels ? el('div', { class: 'label', style: 'margin-top:16px', text: 'Controller' }) : null,
      padLabels ? buildPadGrid(padLabels) : null,
      el('div', { style: 'text-align:center;margin-top:16px' }, el('button', { class: 'btn', text: 'GOT IT', on: { click: onClose } })),
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
  const panel = el('div', { class: 'panel', style: 'min-width:560px' });
  const body = el('div');
  const tabs = el('div', { class: 'tabs' });
  const tabNames: ['controls' | 'audio' | 'graphics', string][] = [
    ['controls', 'Controls'],
    ['audio', 'Audio'],
    ['graphics', 'Graphics'],
  ];
  const render = (t: typeof tab) => {
    clear(tabs);
    for (const [id, label] of tabNames) {
      tabs.append(el('button', { class: `btn small ghost${id === t ? ' active' : ''}`, text: label, on: { click: () => render(id) } }));
    }
    clear(body);
    const grid = el('div', { class: 'settings-grid' });
    const slider = (label: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void, fmt: (v: number) => string = (v) => v.toFixed(2)) => {
      const input = el('input', { attrs: { type: 'range', min: String(min), max: String(max), step: String(step) } });
      input.value = String(get());
      const val = el('div', { class: 'val', text: fmt(get()) });
      input.addEventListener('input', () => {
        set(Number(input.value));
        val.textContent = fmt(Number(input.value));
        cb.onChange(s);
      });
      grid.append(el('div', { text: label }), input, val);
    };
    const check = (label: string, get: () => boolean, set: (v: boolean) => void) => {
      const input = el('input', { attrs: { type: 'checkbox' } });
      input.checked = get();
      input.addEventListener('change', () => {
        set(input.checked);
        cb.onChange(s);
      });
      grid.append(el('div', { text: label }), el('div', {}, input), el('div'));
    };
    const select = (label: string, options: [string, string][], get: () => string, set: (v: string) => void) => {
      const sel = el('select', { class: 'field', style: 'font-size:16px;padding:6px' });
      for (const [v, l] of options) {
        const o = el('option', { text: l, attrs: { value: v } });
        if (v === get()) o.selected = true;
        sel.append(o);
      }
      sel.addEventListener('change', () => {
        set(sel.value);
        cb.onChange(s);
      });
      grid.append(el('div', { text: label }), sel, el('div'));
    };
    if (t === 'controls') {
      select('Aiming with', [
        ['trackpad', 'Trackpad'],
        ['mouse', 'Mouse'],
      ], () => s.device, (v) => (s.device = v as Settings['device']));
      slider('Trackpad sensitivity', 0.2, 3, 0.05, () => s.sensTrackpad, (v) => (s.sensTrackpad = v));
      slider('Mouse sensitivity', 0.2, 3, 0.05, () => s.sensMouse, (v) => (s.sensMouse = v));
      slider('Controller sensitivity', 0.2, 3, 0.05, () => s.sensController, (v) => (s.sensController = v));
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
      body.append(grid, el('p', { style: 'font-size:14px;opacity:.7', text: 'Every sound in Bubba has an on-screen version, so the game is fully playable muted.' }));
    } else {
      select('Graphics quality', [
        ['auto', 'Auto (recommended)'],
        ['high', 'High'],
        ['medium', 'Medium'],
        ['low', 'Low (fastest)'],
      ], () => s.quality, (v) => (s.quality = v as Settings['quality']));
      check('Colorblind-friendly team colors', () => s.colorblindTeams, (v) => (s.colorblindTeams = v));
      check("Show other players' quick chat", () => s.showQuickChat, (v) => (s.showQuickChat = v));
      check('Show FPS', () => s.showFps, (v) => (s.showFps = v));
      body.append(grid);
    }
  };
  render(tab);
  panel.append(el('h2', { text: 'Settings' }), tabs, body, el('div', { style: 'text-align:center;margin-top:16px' }, el('button', { class: 'btn', text: 'DONE', on: { click: cb.onClose } })));
  return el('div', { class: 'overlay interactive' }, panel);
}

function buildPadGrid(labels: Record<string, string>): HTMLElement {
  const grid = el('div', { class: 'controls-grid' });
  grid.append(el('div', {}, el('span', { class: 'key', text: 'L-stick' })), el('div', { text: 'Move' }));
  grid.append(el('div', {}, el('span', { class: 'key', text: 'R-stick' })), el('div', { text: 'Aim' }));
  for (const [a, name] of Object.entries(PAD_ACTION_LABELS)) grid.append(el('div', {}, el('span', { class: 'key', text: labels[a] ?? '?' })), el('div', { text: name }));
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
  camera: 'Camera: first / third person',
  chat: 'Quick chat (hold, aim with R-stick)',
  scoreboard: 'Scoreboard',
  menu: 'Menu',
};

function buildPadBindings(s: Settings, cb: SettingsCallbacks): HTMLElement {
  const wrap = el('div', { style: 'margin-top:18px' }, el('div', { class: 'label', text: 'Controller buttons (click, then press a button). Left stick moves, right stick aims.' }));
  const grid = el('div', { class: 'controls-grid', style: 'grid-template-columns: 1fr auto auto' });
  const draw = () => {
    clear(grid);
    const labels = cb.padLabels!();
    for (const a of Object.keys(PAD_ACTION_LABELS)) {
      const btn = el('button', { class: 'btn small ghost', text: labels[a] ?? '?' });
      btn.addEventListener('click', () => {
        btn.textContent = 'Press a button...';
        cb.onRebindPad!(a, draw);
      });
      const reset = el('button', {
        class: 'btn small ghost',
        text: '↺',
        attrs: { title: 'Reset to default' },
        on: {
          click: () => {
            delete s.padBindings[a];
            cb.onChange(s);
            draw();
          },
        },
      });
      grid.append(el('div', { text: PAD_ACTION_LABELS[a] }), btn, reset);
    }
  };
  draw();
  wrap.append(grid);
  return wrap;
}

function buildBindings(s: Settings, cb: SettingsCallbacks): HTMLElement {
  const wrap = el('div', { style: 'margin-top:18px' }, el('div', { class: 'label', text: 'Key bindings (click to change)' }));
  const grid = el('div', { class: 'controls-grid', style: 'grid-template-columns: 1fr auto auto' });
  const actions = Object.keys(ACTION_LABELS) as Action[];
  const draw = () => {
    clear(grid);
    for (const a of actions) {
      const codes = s.bindings[a] ?? DEFAULT_BINDINGS[a];
      const btn = el('button', { class: 'btn small ghost', text: codes.map(codeLabel).join(' / ') || '—', attrs: { 'data-capture': '1' } });
      btn.addEventListener('click', () => {
        btn.textContent = 'Press a key...';
        cb.onRebind!(a, () => {
          draw();
        });
      });
      const reset = el('button', {
        class: 'btn small ghost',
        text: '↺',
        attrs: { title: 'Reset to default' },
        on: {
          click: () => {
            delete s.bindings[a];
            cb.onChange(s);
            draw();
          },
        },
      });
      grid.append(el('div', { text: ACTION_LABELS[a] }), btn, reset);
    }
  };
  draw();
  wrap.append(grid);
  return wrap;
}
