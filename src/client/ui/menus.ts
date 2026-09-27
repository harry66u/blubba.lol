import { PLAYER_COLORS } from '../../shared/colors';
import type { MatchResult } from '../../shared/game/sim';
import { checkName, randomGuestName } from '../../shared/names';
import type { EventFrequency, RoomInfo, RosterEntry } from '../../shared/protocol';
import { ACTION_LABELS, type Action, DEFAULT_BINDINGS, codeLabel } from '../input/input';
import type { Settings } from '../settings';
import { clear, el, hexColor } from './dom';

export interface MenuCallbacks {
  onLoadout: () => void;
  onPlay: (name: string) => void;
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

export function buildMainMenu(name: string, cb: MenuCallbacks, notice?: string): HTMLElement {
  const err = el('div', { class: 'error-text', text: notice ?? '' });
  const nameInput = nameField(name, cb.onNameChange, err);
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
  const play = el('button', {
    class: 'btn big',
    text: 'PLAY',
    on: {
      click: () => {
        const n = validName(nameInput, err);
        if (n) cb.onPlay(n);
      },
    },
  });
  const codeInput = el('input', { class: 'field code', attrs: { maxlength: '5', placeholder: 'CODE', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Room code' } });
  const joinBtn = el('button', {
    class: 'btn blue',
    text: 'JOIN',
    on: {
      click: () => {
        const n = validName(nameInput, err);
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
    text: 'CREATE PRIVATE ROOM',
    on: {
      click: () => {
        const n = validName(nameInput, err);
        if (n) cb.onCreate(n);
      },
    },
  });
  const card = el(
    'div',
    { class: 'panel menu-card interactive' },
    el('div', { class: 'label', text: 'Your name' }),
    el('div', { class: 'row' }, nameInput, dice),
    play,
    create,
    el('div', { class: 'row' }, el('div', { class: 'grow', style: 'font-size:16px', text: 'Got a code?' }), codeInput, joinBtn),
    err,
  );
  const footer = el(
    'div',
    { class: 'menu-footer' },
    el('button', { class: 'btn small ghost', text: 'Loadout', on: { click: cb.onLoadout } }),
    el('button', { class: 'btn small ghost', text: 'How to play', on: { click: cb.onHowTo } }),
    el('button', { class: 'btn small ghost', text: 'Settings', on: { click: cb.onSettings } }),
  );
  return el('div', { class: 'menu' }, logo(), el('div', { class: 'tagline', text: 'Blast your friends off the map!' }), card, footer);
}

export function buildRoomJoin(code: string, name: string, cb: { onJoin: (name: string) => void; onBack: () => void; onNameChange: (n: string) => void }, notice?: string): HTMLElement {
  const err = el('div', { class: 'error-text', text: notice ?? '' });
  const nameInput = nameField(name, cb.onNameChange, err);
  const join = el('button', {
    class: 'btn big green',
    text: 'JOIN',
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
    el('div', { class: 'room-banner', html: `You're invited to room <b>${code}</b>` }),
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
  onResume: () => void;
  onLeave: () => void;
  onSettings: () => void;
  onHowTo: () => void;
  onCopyLink: () => void;
  onHost: (action: 'restart' | { durationSec?: number; bots?: boolean; events?: EventFrequency }) => void;
}

export function buildPause(room: RoomInfo | null, isHost: boolean, cb: PauseCallbacks): HTMLElement {
  const panel = el('div', { class: 'panel interactive', style: 'display:flex;flex-direction:column;gap:14px;min-width:360px' });
  panel.append(el('h2', { text: 'Paused' }));
  panel.append(el('button', { class: 'btn big', text: 'RESUME', on: { click: cb.onResume } }));
  if (room?.isPrivate) {
    panel.append(
      el(
        'div',
        { class: 'row' },
        el('div', { class: 'grow room-banner', html: `Room code <b>${room.code}</b>` }),
        el('button', { class: 'btn small blue', text: 'Copy invite link', on: { click: cb.onCopyLink } }),
      ),
    );
    if (isHost) {
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
        el('div', { class: 'row' }, el('span', { text: 'Match length' }), time, el('label', { class: 'row', style: 'font-size:16px' }, bots, 'Bots')),
        el('div', { class: 'row' }, el('span', { text: 'Random events' }), events),
        el('button', { class: 'btn small yellow', text: 'Restart match', on: { click: () => cb.onHost('restart') } }),
      );
    }
  } else {
    panel.append(el('div', { class: 'room-banner', text: 'Public match' }));
  }
  panel.append(
    el(
      'div',
      { class: 'row' },
      el('button', { class: 'btn small ghost', text: 'Loadout', on: { click: cb.onLoadout } }),
      el('button', { class: 'btn small ghost', text: 'Settings', on: { click: cb.onSettings } }),
      el('button', { class: 'btn small ghost', text: 'How to play', on: { click: cb.onHowTo } }),
      el('div', { class: 'grow' }),
      el('button', { class: 'btn small', text: 'Leave match', on: { click: cb.onLeave } }),
    ),
  );
  return el('div', { class: 'overlay interactive' }, panel);
}

export function buildScoreboard(roster: RosterEntry[], youId: number, hostId: number, isPrivate: boolean, onKick: ((id: number) => void) | null): HTMLElement {
  const rows = [...roster].sort((a, b) => b.score - a.score || b.kos - a.kos || a.deaths - b.deaths);
  const table = el('table');
  table.append(el('tr', {}, el('th', { text: '#' }), el('th', { text: 'Player' }), el('th', { text: 'Score' }), el('th', { text: 'KOs' }), el('th', { text: 'Popped' }), el('th', { text: 'Ping' }), onKick ? el('th') : null));
  rows.forEach((r, i) => {
    const tr = el(
      'tr',
      { class: r.id === youId ? 'me' : '' },
      el('td', { text: String(i + 1) }),
      el(
        'td',
        {},
        el('span', { class: 'swatch', style: { background: hexColor(PLAYER_COLORS[r.color]?.hex ?? 0xffffff) } }),
        r.name,
        r.bot ? el('span', { class: 'key', style: 'margin-left:6px;font-size:10px;min-width:0', text: 'BOT' }) : null,
        r.id === hostId && isPrivate ? el('span', { style: 'margin-left:6px', text: '👑', attrs: { title: 'Host' } }) : null,
      ),
      el('td', { text: String(r.score) }),
      el('td', { text: String(r.kos) }),
      el('td', { text: String(r.deaths) }),
      el('td', { text: r.bot ? '-' : String(r.ping) }),
      onKick ? el('td', {}, r.id !== youId && !r.bot ? el('button', { class: 'btn small', text: 'Kick', on: { click: () => onKick(r.id) } }) : null) : null,
    );
    table.append(tr);
  });
  return el('div', { class: `scoreboard${onKick ? ' interactive' : ''}` }, el('div', { class: 'panel' }, table));
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

export function buildResults(result: MatchResult, roster: Map<number, RosterEntry>, youId: number, secondsLeft: number): HTMLElement {
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
    const color = hexColor(PLAYER_COLORS[roster.get(s.id)?.color ?? 0]?.hex ?? 0xffffff);
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
  const title = winner?.id === youId ? 'YOU WIN!' : `${winner?.name ?? 'Nobody'} wins!`;
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
      podium,
      awards,
      stats,
      el('div', { style: 'text-align:center;margin-top:14px;opacity:.7', text: `Next match in ${Math.ceil(secondsLeft)}...` }),
    ),
  );
}

export function buildHowTo(onClose: () => void, bindings: Record<Action, string[]> = DEFAULT_BINDINGS): HTMLElement {
  const grid = el('div', { class: 'controls-grid' });
  const row = (keys: string[], what: string) => grid.append(el('div', {}, ...keys.map((k) => el('span', { class: 'key', text: k, style: 'margin-right:4px' }))), el('div', { text: what }));
  row(['W', 'A', 'S', 'D'], 'Move');
  row(['Trackpad'], 'Aim (or mouse)');
  for (const a of ['fire', 'jump', 'dash', 'brace', 'grapple', 'grab', 'reload', 'util1', 'util2', 'taunt', 'scoreboard'] as Action[]) {
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
      el('div', { style: 'text-align:center;margin-top:16px' }, el('button', { class: 'btn', text: 'GOT IT', on: { click: onClose } })),
    ),
  );
}

export interface SettingsCallbacks {
  onChange: (s: Settings) => void;
  onClose: () => void;
  onRebind?: (action: Action, done: () => void) => void;
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
      body.append(grid);
      if (cb.onRebind) body.append(buildBindings(s, cb));
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
      check('Show FPS', () => s.showFps, (v) => (s.showFps = v));
      body.append(grid);
    }
  };
  render(tab);
  panel.append(el('h2', { text: 'Settings' }), tabs, body, el('div', { style: 'text-align:center;margin-top:16px' }, el('button', { class: 'btn', text: 'DONE', on: { click: cb.onClose } })));
  return el('div', { class: 'overlay interactive' }, panel);
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
