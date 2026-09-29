import { PLAYER_COLORS } from '../../shared/colors';
import { MODE_INFO, type ModeId } from '../../shared/game/modes';
import { ITEM_BY_ID, type ProgressReport, SLOT_INFO, UNLOCKS, cosmeticKey, tierFor } from '../../shared/economy';
import { DAILY, type DailyChallengeView, type DailyView } from '../../shared/daily';
import { PART_INFO, type SpecialPartId, UTILITY_INFO, type UtilityId } from '../../shared/loadout';
import { checkName } from '../../shared/names';
import type { AccountClient, LeaderboardRow } from '../net/account';
import { add, clear, el, hexColor } from './dom';
import { tubeMan } from './mascot';

export type AccountTab = 'signup' | 'login' | 'reset';

function field(label: string, attrs: Record<string, string>): { wrap: HTMLElement; input: HTMLInputElement } {
  const input = el('input', { class: 'field', attrs: { spellcheck: 'false', autocomplete: 'off', ...attrs } });
  return { wrap: el('label', { class: 'form-row' }, el('span', { text: label }), input), input };
}

/** A tier name on a tinted pill in the tier's color. */
function tierPill(name: string, color: string, extra = ''): HTMLElement {
  const pill = el('span', { class: `tier-pill ${extra}`, text: name });
  pill.style.setProperty('--tier', color);
  return pill;
}

/**
 * Sign up / log in / reset. Accounts are just a name and password (no email or other personal
 * info). Sign-up shows a one-time recovery code instead of email recovery.
 */
export function buildAccountPanel(account: AccountClient, tab: AccountTab, onClose: () => void, onDone: () => void): HTMLElement {
  const panel = el('div', { class: 'panel account-panel interactive' });
  const draw = (t: AccountTab) => {
    clear(panel);
    const tabs = el(
      'div',
      { class: 'tabs', attrs: { role: 'tablist' } },
      ...(['signup', 'login', 'reset'] as AccountTab[]).map((k) =>
        el('button', {
          class: `tab${k === t ? ' on' : ''}`,
          text: k === 'signup' ? 'Sign up' : k === 'login' ? 'Log in' : 'Forgot password',
          attrs: { role: 'tab', 'aria-selected': String(k === t) },
          on: { click: () => draw(k) },
        }),
      ),
    );
    const err = el('div', { class: 'error-text', attrs: { role: 'alert' } });
    const name = field('Name', { maxlength: '16', 'aria-label': 'Name', autocomplete: 'username' });
    if (account.profile.name) name.input.value = account.profile.name;
    const pass = field(t === 'reset' ? 'New password' : 'Password', { type: 'password', maxlength: '128', autocomplete: t === 'login' ? 'current-password' : 'new-password' });
    const pass2 = field('Password again', { type: 'password', maxlength: '128', autocomplete: 'new-password' });
    const code = field('Recovery code', { maxlength: '14', placeholder: 'XXXX-XXXX-XXXX' });
    const submit = el('button', { class: 'btn green wide', attrs: { type: 'submit' }, text: t === 'signup' ? 'CREATE ACCOUNT' : t === 'login' ? 'LOG IN' : 'RESET PASSWORD' });
    const go = async () => {
      err.textContent = '';
      if (t === 'signup') {
        const c = checkName(name.input.value);
        if (!c.ok) return void (err.textContent = c.reason ?? 'Pick another name.');
      }
      if (t !== 'login' && pass.input.value.length < 8) return void (err.textContent = 'Passwords need at least 8 characters.');
      if (t !== 'login' && pass.input.value !== pass2.input.value) return void (err.textContent = "The passwords don't match.");
      submit.disabled = true;
      submit.classList.add('busy');
      try {
        if (t === 'login') {
          await account.login(name.input.value.trim(), pass.input.value);
          onDone();
        } else {
          const recovery = t === 'signup' ? await account.register(name.input.value.trim(), pass.input.value) : await account.reset(name.input.value.trim(), code.input.value, pass.input.value);
          showRecovery(recovery);
        }
      } catch (e) {
        err.textContent = (e as Error).message;
      } finally {
        submit.disabled = false;
        submit.classList.remove('busy');
      }
    };
    // A real form so browsers' password managers can help.
    const form = el('form', {
      class: 'account-form',
      on: {
        submit: (e) => {
          e.preventDefault();
          void go();
        },
      },
    });
    add(form, name.wrap, t === 'reset' ? code.wrap : null, pass.wrap, t !== 'login' ? pass2.wrap : null, err, submit);
    const blurb =
      t === 'signup'
        ? 'Free. Just a name and a password: no email, no personal info. Everything you earned as a guest comes with you.'
        : t === 'login'
          ? 'Log in to play ranked and use your coins on any computer.'
          : 'Use the recovery code you saved when you made your account.';
    add(
      panel,
      el('div', { class: 'account-head' }, tubeMan('#8a4dff', { className: 'sway' }), el('div', {}, el('h2', { text: t === 'login' ? 'Welcome back!' : 'Your account' }), el('div', { class: 'small-note', text: blurb }))),
      tabs,
      form,
      el('button', { class: 'btn small ghost not-now', text: 'Not now', on: { click: onClose } }),
    );
    (account.profile.name && t === 'login' ? pass.input : name.input).focus();
  };
  const showRecovery = (recovery: string) => {
    clear(panel);
    const copy = el('button', {
      class: 'btn small blue',
      text: 'Copy',
      on: {
        click: () => {
          navigator.clipboard?.writeText(recovery).then(
            () => (copy.textContent = 'Copied!'),
            () => undefined,
          );
        },
      },
    });
    panel.append(
      el('div', { class: 'account-head' }, tubeMan('#5ee05e', { className: 'flail' }), el('h2', { text: `Welcome, ${account.account?.name ?? ''}! 🎉` })),
      el('div', { class: 'recovery-note', text: 'Save this recovery code somewhere safe. It is the only way to reset your password (we never ask for your email).' }),
      el('div', { class: 'recovery-row' }, el('div', { class: 'recovery-code', text: recovery }), copy),
      el('button', { class: 'btn big green', text: 'I SAVED IT', on: { click: onDone } }),
    );
  };
  draw(tab);
  return el('div', { class: 'overlay interactive' }, panel);
}

/** The player card in the menu corner: level, name, XP and coins (opens the profile). */
export function buildAccountChip(account: AccountClient, onAccount: () => void, onProfile: () => void): HTMLElement {
  const chip = el('div', { class: 'account-chip interactive' });
  const draw = () => {
    clear(chip);
    const p = account.profile;
    const pct = Math.round((p.xpInto / p.xpNext) * 100);
    add(
      chip,
      el(
        'button',
        { class: 'chip-main', attrs: { title: 'Your profile', 'aria-label': `Your profile: level ${p.level}, ${p.coins} coins` }, on: { click: onProfile } },
        el('div', { class: 'lv' }, el('span', { class: 'lv-k', text: 'LV' }), el('span', { class: 'lv-n', text: String(p.level) })),
        el(
          'div',
          { class: 'who' },
          el('div', { class: 'nm', text: account.account?.name ?? 'Guest' }),
          el('div', { class: 'xp', attrs: { title: `${p.xpInto} / ${p.xpNext} XP` } }, el('div', { style: { width: `${pct}%` } })),
        ),
        el('div', { class: 'coins' }, el('span', { class: 'coin', text: '🪙', attrs: { 'aria-hidden': 'true' } }), el('span', { text: p.coins.toLocaleString('en-US') })),
      ),
      account.account ? null : el('button', { class: 'btn small blue', text: 'Sign up / Log in', on: { click: onAccount } }),
    );
  };
  account.onChange(draw);
  draw();
  return chip;
}

// --- Daily challenges ----------------------------------------------------------------------------

function dailyCount(c: DailyChallengeView): string {
  return `${Math.floor(c.progress)}/${c.target}${c.unit ? ` ${c.unit}` : ''}`;
}

function dailyBar(c: DailyChallengeView): HTMLElement {
  return el('div', { class: 'bar' }, el('div', { style: { width: `${Math.min(100, Math.round((c.progress / c.target) * 100))}%` } }));
}

function untilText(sec: number): string {
  const mins = Math.max(1, Math.ceil(sec / 60));
  const h = Math.floor(mins / 60);
  return h ? `${h}h ${mins % 60}m` : `${mins}m`;
}

/** What the streak line says: a nudge to play today, or a pat on the back. */
function streakHint(d: DailyView): string {
  if (d.playedToday) return d.streak > 1 ? `${d.streak} days in a row! See you tomorrow.` : 'Streak started! See you tomorrow.';
  const bonus = DAILY.streakCoins * Math.min(d.streak + 1, DAILY.streakCap);
  return d.streak ? `Play today for streak day ${d.streak + 1}: +${bonus} 🪙` : `Start a streak today: +${bonus} 🪙`;
}

/**
 * Today's three challenges and the play streak, for the main menu. Beside the main card on wide
 * screens; on narrow ones it folds into one line you can tap open.
 */
export function buildDailyCard(account: AccountClient): HTMLElement {
  const card = el('div', { class: 'panel daily-card interactive' });
  const countdown = el('div', { class: 'reset' });
  let open = false;
  let refreshing = false;
  const tick = () => {
    const d = account.profile.daily;
    const left = d.resetsIn - (Date.now() - account.profileAt) / 1000;
    countdown.textContent = `⏱ New challenges in ${untilText(Math.max(0, left))}`;
    // Midnight (UTC) passed while the menu was open: fetch the new day's challenges.
    if (left <= 0 && d.challenges.length && !refreshing) {
      refreshing = true;
      void account
        .refresh()
        .catch(() => undefined)
        .finally(() => (refreshing = false));
    }
  };
  const draw = () => {
    clear(card);
    const d = account.profile.daily;
    // Nothing to show until the server has answered (avoids flashing an empty card).
    card.classList.toggle('hidden', !d.challenges.length);
    card.classList.toggle('open', open);
    const done = d.challenges.filter((c) => c.done).length;
    const head = el(
      'button',
      { class: 'daily-head', attrs: { 'aria-expanded': String(open) }, on: { click: () => ((open = !open), draw()) } },
      el('span', { class: 'ttl', text: '🎯 Daily challenges' }),
      el('span', { class: 'count', text: `${done}/${d.challenges.length}` }),
      el('span', { class: `streak${d.streak ? '' : ' off'}`, text: `🔥 ${d.streak}`, attrs: { title: `Daily streak: ${d.streak} day${d.streak === 1 ? '' : 's'} in a row` } }),
      el('span', { class: 'caret', text: '▾' }),
    );
    const rows = el('div', { class: 'daily-rows' });
    for (const c of d.challenges) {
      rows.append(
        el(
          'div',
          { class: `daily-row${c.done ? ' done' : ''}` },
          el('div', { class: 'top' }, el('span', { class: 'lbl', text: c.label }), el('span', { class: 'rw', text: c.done ? '✓' : `+${c.coins} 🪙` })),
          el('div', { class: 'bottom' }, dailyBar(c), el('span', { class: 'n', text: c.done ? 'Done!' : dailyCount(c) })),
        ),
      );
    }
    add(card, head, rows, el('div', { class: 'daily-foot' }, el('div', { class: `streak-hint${d.playedToday ? '' : ' nudge'}`, text: streakHint(d) }), countdown));
    tick();
  };
  // Menus are rebuilt often; stop listening once this card is gone.
  const off = account.onChange(() => (card.isConnected ? draw() : stop()));
  const timer = window.setInterval(() => (card.isConnected ? tick() : stop()), 20_000);
  const stop = () => {
    off();
    window.clearInterval(timer);
  };
  draw();
  return card;
}

/** Compact progress on all three challenges, for the results screen. */
function buildDailyMini(d: DailyView): HTMLElement | null {
  if (!d.challenges.length) return null;
  return el(
    'div',
    { class: 'daily-mini' },
    el('div', { class: 'label' }, '🎯 Daily challenges', el('span', { class: 'streak', text: d.streak ? ` · 🔥 ${d.streak}-day streak` : '' })),
    el(
      'div',
      { class: 'cells' },
      ...d.challenges.map((c) =>
        el('div', { class: `cell${c.done ? ' done' : ''}` }, el('div', { class: 'lbl', text: c.label }), dailyBar(c), el('div', { class: 'n', text: c.done ? '✓ Done' : dailyCount(c) })),
      ),
    ),
  );
}

const MODE_ORDER: ModeId[] = ['knockout', 'suddenDeath', 'teamKnockout', 'ball', 'pump', 'duel'];
const MEDALS = ['🥇', '🥈', '🥉'];

/** Profile: level, coins, rank, lifetime stats, and the ranked leaderboard. */
export function buildProfile(account: AccountClient, onClose: () => void, onAccount: () => void, onLogout: () => void, onFaceScan?: () => void): HTMLElement {
  const p = account.profile;
  const s = p.stats;
  const stat = (icon: string, k: string, v: string) => el('div', { class: 'stat' }, el('div', { class: 'ico', text: icon, attrs: { 'aria-hidden': 'true' } }), el('div', {}, el('div', { class: 'v', text: v }), el('div', { class: 'k', text: k })));
  const hours = Math.floor(s.playSeconds / 3600);
  const mins = Math.round((s.playSeconds % 3600) / 60);
  const grid = el(
    'div',
    { class: 'stat-grid four' },
    stat('🎮', 'Matches', String(s.matches)),
    stat('🏆', 'Wins', String(s.wins)),
    stat('💥', 'Knockouts', String(s.kos)),
    stat('🎈', 'Times popped', String(s.popped)),
    stat('🚀', 'Longest launch', `${s.longestLaunch.toFixed(1)} m`),
    stat('⛓️', 'Chain knockouts', String(s.chainKos)),
    stat('🎯', 'Best air combo', String(s.bestCombo)),
    stat('🏐', 'Goals', String(s.goals)),
    stat('👊', 'Hits landed', String(s.hits)),
    stat('🌊', 'Fell off', String(s.falls)),
    stat('⏱️', 'Time played', hours ? `${hours}h ${mins}m` : `${mins}m`),
    stat('🪙', 'Coins', p.coins.toLocaleString('en-US')),
  );
  const modes = el('div', { class: 'mode-stats' });
  for (const m of MODE_ORDER) {
    const played = s.modeMatches[m] ?? 0;
    modes.append(el('div', { class: 'mode-stat' }, el('b', { text: MODE_INFO[m].name }), el('span', { text: `${s.modeWins[m] ?? 0} wins / ${played} played` })));
  }
  const rank = el('div', { class: 'rank-box' });
  if (p.isAccount && p.rating !== null) {
    const tier = p.rankedGames ? tierFor(p.rating) : { name: 'Unranked', color: '#9aa3b8' };
    rank.append(
      el('div', { class: 'label', text: 'Ranked' }),
      tierPill(tier.name, tier.color, 'big'),
      el('div', { class: 'rating', text: p.rankedGames ? `${p.rating} rating · ${p.rankedGames} ranked matches` : 'Play Ranked from the main menu' }),
    );
  } else {
    rank.append(el('div', { class: 'rating', text: 'Make a free account to play ranked.' }), el('button', { class: 'btn small blue', text: 'Sign up / Log in', on: { click: onAccount } }));
  }
  const board = el('div', { class: 'leaderboard' }, el('div', { class: 'label', text: '🏆 Top ranked players' }), el('div', { class: 'lb-empty', text: 'Loading...' }));
  account
    .leaderboard()
    .then((rows: LeaderboardRow[]) => {
      clear(board);
      board.append(el('div', { class: 'label', text: '🏆 Top ranked players' }));
      if (!rows.length) board.append(el('div', { class: 'lb-empty', text: 'Nobody yet. Be the first!' }));
      rows.forEach((r, i) => {
        const tier = tierFor(r.rating);
        const me = r.name === account.account?.name;
        board.append(
          el(
            'div',
            { class: `lb-row${me ? ' me' : ''}${i < 3 ? ` top${i + 1}` : ''}` },
            el('span', { class: 'n', text: i < 3 ? MEDALS[i] : String(i + 1) }),
            el('span', { class: 'nm' }, r.name, me ? el('span', { class: 'you-tag', text: 'YOU' }) : null),
            tierPill(tier.name, tier.color),
            el('span', { class: 'r', text: String(r.rating) }),
          ),
        );
      });
    })
    .catch(() => (board.lastElementChild!.textContent = "Couldn't load the leaderboard."));
  const xpPct = Math.round((p.xpInto / p.xpNext) * 100);
  const color = hexColor(PLAYER_COLORS[Number(cosmeticKey(p.cosmetics, 'color'))]?.hex ?? 0xff3b5c);
  return el(
    'div',
    { class: 'overlay interactive' },
    el(
      'div',
      { class: 'panel profile' },
      el(
        'div',
        { class: 'profile-head' },
        el('div', { class: 'avatar' }, tubeMan(color, { className: 'sway' }), el('div', { class: 'lv-badge', text: String(p.level) })),
        el(
          'div',
          { class: 'grow' },
          el('h2', { text: account.account?.name ?? 'Guest' }),
          el('div', { class: 'label', text: `Level ${p.level} · ${p.xpInto} / ${p.xpNext} XP` }),
          el('div', { class: 'xp-bar' }, el('div', { style: { width: `${xpPct}%` } })),
        ),
        rank,
      ),
      grid,
      el('div', { class: 'label section-label', text: 'By mode' }),
      modes,
      board,
      el(
        'div',
        { class: 'panel-foot row' },
        el('button', { class: 'btn', text: 'DONE', on: { click: onClose } }),
        onFaceScan ? el('button', { class: 'btn small blue', text: account.face?.version ? '📸 Change face scan' : '📸 Face scan', on: { click: account.account ? onFaceScan : onAccount } }) : null,
        account.account ? el('button', { class: 'btn small ghost', text: 'Log out', on: { click: onLogout } }) : null,
      ),
    ),
  );
}

function unlockName(id: string): string {
  // Cosmetic level rewards come through as item ids ('base.gold').
  const item = ITEM_BY_ID.get(id);
  if (item) return `${item.name} (${SLOT_INFO[item.slot].name.toLowerCase()}, in your locker)`;
  return PART_INFO[id as SpecialPartId]?.name ?? UTILITY_INFO[id as UtilityId]?.name ?? id;
}

/** XP / coins / unlocks / rating earned this match, for the results screen. */
export function buildProgressBox(r: ProgressReport, isGuest: boolean, onSignup: () => void): HTMLElement {
  const box = el('div', { class: 'progress-box' });
  if (!r.reward.xp && !r.rating) {
    box.append(el('div', { class: 'small-note', text: 'Play a bit more of a match to earn XP and coins.' }));
    return box;
  }
  const lines = el('div', { class: 'lines' });
  for (const l of r.reward.lines) {
    lines.append(el('div', { class: 'line' }, el('span', { text: l.label }), el('span', { class: 'amt', text: [l.xp ? `+${l.xp} XP` : '', l.coins ? `+${l.coins} 🪙` : ''].filter(Boolean).join('  ') })));
  }
  const p = r.profile;
  const pct = Math.round((p.xpInto / p.xpNext) * 100);
  // The bar fills from where it was before this match (from empty after a level up).
  const levelled = r.levelAfter > r.levelBefore;
  const from = levelled ? 0 : Math.max(0, Math.round(((p.xpInto - r.reward.xp) / p.xpNext) * 100));
  const fill = el('div', { style: { width: `${pct}%` } });
  fill.style.setProperty('--from', `${Math.min(from, pct)}%`);
  box.append(
    el('div', { class: 'totals' }, el('span', { class: 'xp', text: `+${r.reward.xp} XP` }), el('span', { class: 'cn', text: `+${r.reward.coins} 🪙` })),
    lines,
    el('div', { class: 'level-row small' }, el('div', { class: `lv-badge${levelled ? ' up' : ''}`, text: String(p.level) }), el('div', { class: 'xp-bar grow fill-in' }, fill)),
  );
  if (levelled) box.append(el('div', { class: 'levelup', text: `LEVEL UP! You're level ${r.levelAfter}.` }));
  for (const id of r.unlocked) box.append(el('div', { class: 'unlock', text: `🔓 Unlocked: ${unlockName(id)}` }));
  const next = UNLOCKS.find((u) => u.level > p.level);
  if (next && !r.unlocked.length) box.append(el('div', { class: 'small-note', text: `Next unlock at level ${next.level}: ${unlockName(next.id)}` }));
  if (r.rating) {
    const d = r.rating.after - r.rating.before;
    const tier = tierFor(r.rating.after);
    box.append(el('div', { class: `rating-change ${d >= 0 ? 'up' : 'down'}`, text: `Rating ${r.rating.before} → ${r.rating.after} (${d >= 0 ? '+' : ''}${d}) · ${tier.name}` }));
  }
  // Only matches that counted moved the challenges along.
  if (r.reward.xp) add(box, buildDailyMini(p.daily));
  if (isGuest) {
    box.append(
      el(
        'div',
        { class: 'guest-cta' },
        el('span', { text: 'Playing as a guest: progress is saved in this browser.' }),
        el('button', { class: 'btn small blue', text: 'Make an account', on: { click: onSignup } }),
      ),
    );
  }
  return box;
}

/** Ranked queue screen. */
export function buildQueue(seconds: number, searching: number, rating: number, onCancel: () => void): HTMLElement {
  const card = el(
    'div',
    { class: 'panel menu-card queue-card interactive', attrs: { role: 'status' } },
    el('h2', { text: 'Ranked 1v1' }),
    el('div', { class: 'q-tier' }),
    el('div', { class: 'radar', attrs: { 'aria-hidden': 'true' } }, el('i'), el('i'), el('i'), tubeMan('#ff8a1f', { className: 'flail' })),
    el('div', { class: 'q-status', text: 'Finding an opponent near your rating...' }),
    el('div', { class: 'q-time' }),
    el('div', { class: 'small-note q-note' }),
    el('button', { class: 'btn small ghost', text: 'Cancel', on: { click: onCancel } }),
  );
  const root = el('div', { class: 'menu' }, card);
  updateQueue(root, seconds, searching, rating);
  return root;
}

/** Ticks the queue screen in place (so its animation doesn't restart every second). */
export function updateQueue(root: HTMLElement, seconds: number, searching: number, rating: number): boolean {
  const card = root.querySelector('.queue-card');
  if (!card) return false;
  const tier = tierFor(rating);
  const tierEl = card.querySelector('.q-tier')!;
  clear(tierEl as HTMLElement);
  tierEl.append(tierPill(`${tier.name} · ${rating}`, tier.color, 'big'));
  card.querySelector('.q-time')!.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  card.querySelector('.q-note')!.textContent = searching > 1 ? `${searching} players searching` : 'The search widens the longer you wait.';
  return true;
}
