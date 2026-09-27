import { MODE_INFO, type ModeId } from '../../shared/game/modes';
import { type ProgressReport, UNLOCKS, tierFor } from '../../shared/economy';
import { MOD_INFO, type ModId, UTILITY_INFO, type UtilityId } from '../../shared/loadout';
import { checkName } from '../../shared/names';
import type { AccountClient, LeaderboardRow } from '../net/account';
import { add, clear, el } from './dom';

export type AccountTab = 'signup' | 'login' | 'reset';

function field(label: string, attrs: Record<string, string>): { wrap: HTMLElement; input: HTMLInputElement } {
  const input = el('input', { class: 'field', attrs: { spellcheck: 'false', autocomplete: 'off', ...attrs } });
  return { wrap: el('label', { class: 'form-row' }, el('span', { text: label }), input), input };
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
      { class: 'tabs' },
      ...(['signup', 'login', 'reset'] as AccountTab[]).map((k) =>
        el('button', { class: `tab${k === t ? ' on' : ''}`, text: k === 'signup' ? 'Sign up' : k === 'login' ? 'Log in' : 'Forgot password', on: { click: () => draw(k) } }),
      ),
    );
    const err = el('div', { class: 'error-text' });
    const name = field('Name', { maxlength: '16', 'aria-label': 'Name', autocomplete: 'username' });
    if (account.profile.name) name.input.value = account.profile.name;
    const pass = field(t === 'reset' ? 'New password' : 'Password', { type: 'password', maxlength: '128', autocomplete: t === 'login' ? 'current-password' : 'new-password' });
    const pass2 = field('Password again', { type: 'password', maxlength: '128', autocomplete: 'new-password' });
    const code = field('Recovery code', { maxlength: '14', placeholder: 'XXXX-XXXX-XXXX' });
    const submit = el('button', { class: 'btn big green', attrs: { type: 'submit' }, text: t === 'signup' ? 'CREATE ACCOUNT' : t === 'login' ? 'LOG IN' : 'RESET PASSWORD' });
    const go = async () => {
      err.textContent = '';
      if (t === 'signup') {
        const c = checkName(name.input.value);
        if (!c.ok) return void (err.textContent = c.reason ?? 'Pick another name.');
      }
      if (t !== 'login' && pass.input.value.length < 8) return void (err.textContent = 'Passwords need at least 8 characters.');
      if (t !== 'login' && pass.input.value !== pass2.input.value) return void (err.textContent = "The passwords don't match.");
      submit.disabled = true;
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
    add(form, name.wrap, t === 'reset' ? code.wrap : null, pass.wrap, t !== 'login' ? pass2.wrap : null, submit, err);
    const blurb =
      t === 'signup'
        ? 'Free. Just a name and a password: no email, no personal info. Everything you earned as a guest comes with you.'
        : t === 'login'
          ? 'Log in to play ranked and use your coins on any computer.'
          : 'Use the recovery code you saved when you made your account.';
    add(
      panel,
      el('h2', { text: 'Your account' }),
      tabs,
      el('div', { class: 'small-note', text: blurb }),
      form,
      el('button', { class: 'btn small ghost', text: 'Not now', on: { click: onClose } }),
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
      el('h2', { text: `Welcome, ${account.account?.name ?? ''}!` }),
      el('div', { text: 'Save this recovery code somewhere safe. It is the only way to reset your password (we never ask for your email).' }),
      el('div', { class: 'row', style: 'justify-content:center;margin:12px 0' }, el('div', { class: 'recovery-code', text: recovery }), copy),
      el('button', { class: 'btn big green', text: "I SAVED IT", on: { click: onDone } }),
    );
  };
  draw(tab);
  return el('div', { class: 'overlay interactive' }, panel);
}

/** A little "Lv 3 · 🪙 120" chip for the main menu. */
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
        { class: 'chip-main', attrs: { title: 'Your profile' }, on: { click: onProfile } },
        el('div', { class: 'lv', text: `Lv ${p.level}` }),
        el('div', { class: 'who' }, el('div', { class: 'nm', text: account.account?.name ?? 'Guest' }), el('div', { class: 'xp' }, el('div', { style: { width: `${pct}%` } }))),
        el('div', { class: 'coins', text: `🪙 ${p.coins}` }),
      ),
      account.account ? null : el('button', { class: 'btn small blue', text: 'Sign up / Log in', on: { click: onAccount } }),
    );
  };
  account.onChange(draw);
  draw();
  return chip;
}

const MODE_ORDER: ModeId[] = ['knockout', 'teamKnockout', 'ball', 'pump', 'duel'];

/** Profile: level, coins, rank, lifetime stats, and the ranked leaderboard. */
export function buildProfile(account: AccountClient, onClose: () => void, onAccount: () => void, onLogout: () => void): HTMLElement {
  const p = account.profile;
  const s = p.stats;
  const stat = (k: string, v: string) => el('div', { class: 'stat' }, el('div', { class: 'v', text: v }), el('div', { class: 'k', text: k }));
  const hours = Math.floor(s.playSeconds / 3600);
  const mins = Math.round((s.playSeconds % 3600) / 60);
  const grid = el(
    'div',
    { class: 'stat-grid four' },
    stat('Matches', String(s.matches)),
    stat('Wins', String(s.wins)),
    stat('Knockouts', String(s.kos)),
    stat('Times popped', String(s.popped)),
    stat('Longest launch', `${s.longestLaunch.toFixed(1)} m`),
    stat('Chain knockouts', String(s.chainKos)),
    stat('Best air combo', String(s.bestCombo)),
    stat('Goals', String(s.goals)),
    stat('Hits landed', String(s.hits)),
    stat('Fell off', String(s.falls)),
    stat('Time played', hours ? `${hours}h ${mins}m` : `${mins}m`),
    stat('Coins', `🪙 ${p.coins}`),
  );
  const modes = el('div', { class: 'mode-stats' });
  for (const m of MODE_ORDER) {
    const played = s.modeMatches[m] ?? 0;
    modes.append(el('div', {}, el('b', { text: MODE_INFO[m].name }), ` ${s.modeWins[m] ?? 0} wins / ${played} played`));
  }
  const rank = el('div', { class: 'rank-box' });
  if (p.isAccount && p.rating !== null) {
    const tier = p.rankedGames ? tierFor(p.rating) : { name: 'Unranked', color: '#9aa3b8' };
    rank.append(
      el('div', { class: 'tier', text: tier.name, style: { color: tier.color } }),
      el('div', { class: 'rating', text: p.rankedGames ? `${p.rating} rating · ${p.rankedGames} ranked matches` : 'Play Ranked from the main menu' }),
    );
  } else {
    rank.append(el('div', { text: 'Make a free account to play ranked.' }), el('button', { class: 'btn small blue', text: 'Sign up / Log in', on: { click: onAccount } }));
  }
  const board = el('div', { class: 'leaderboard' }, el('div', { class: 'label', text: 'Top ranked players' }), el('div', { class: 'small-note', text: 'Loading...' }));
  account
    .leaderboard()
    .then((rows: LeaderboardRow[]) => {
      clear(board);
      board.append(el('div', { class: 'label', text: 'Top ranked players' }));
      if (!rows.length) board.append(el('div', { class: 'small-note', text: 'Nobody yet. Be the first!' }));
      rows.forEach((r, i) => {
        const tier = tierFor(r.rating);
        board.append(
          el(
            'div',
            { class: `lb-row${r.name === account.account?.name ? ' me' : ''}` },
            el('span', { class: 'n', text: String(i + 1) }),
            el('span', { class: 'nm', text: r.name }),
            el('span', { class: 'tier', text: tier.name, style: { color: tier.color } }),
            el('span', { class: 'r', text: String(r.rating) }),
          ),
        );
      });
    })
    .catch(() => (board.lastElementChild!.textContent = "Couldn't load the leaderboard."));
  const xpPct = Math.round((p.xpInto / p.xpNext) * 100);
  return el(
    'div',
    { class: 'overlay interactive' },
    el(
      'div',
      { class: 'panel profile', style: 'width:min(820px,96vw)' },
      el('h2', { text: account.account?.name ?? 'Guest' }),
      el(
        'div',
        { class: 'level-row' },
        el('div', { class: 'lv-badge', text: String(p.level) }),
        el('div', { class: 'grow' }, el('div', { class: 'label', text: `Level ${p.level} · ${p.xpInto} / ${p.xpNext} XP` }), el('div', { class: 'xp-bar' }, el('div', { style: { width: `${xpPct}%` } }))),
        rank,
      ),
      grid,
      el('div', { class: 'label', style: 'margin-top:12px', text: 'By mode' }),
      modes,
      board,
      el(
        'div',
        { class: 'row', style: 'justify-content:center;margin-top:14px' },
        el('button', { class: 'btn', text: 'DONE', on: { click: onClose } }),
        account.account ? el('button', { class: 'btn small ghost', text: 'Log out', on: { click: onLogout } }) : null,
      ),
    ),
  );
}

function unlockName(id: string): string {
  return MOD_INFO[id as ModId]?.name ?? UTILITY_INFO[id as UtilityId]?.name ?? id;
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
  box.append(
    el('div', { class: 'totals' }, el('span', { class: 'xp', text: `+${r.reward.xp} XP` }), el('span', { class: 'cn', text: `+${r.reward.coins} 🪙` })),
    lines,
    el('div', { class: 'level-row small' }, el('div', { class: 'lv-badge', text: String(p.level) }), el('div', { class: 'xp-bar grow' }, el('div', { style: { width: `${pct}%` } }))),
  );
  if (r.levelAfter > r.levelBefore) box.append(el('div', { class: 'levelup', text: `LEVEL UP! You're level ${r.levelAfter}.` }));
  for (const id of r.unlocked) box.append(el('div', { class: 'unlock', text: `🔓 Unlocked: ${unlockName(id)}` }));
  const next = UNLOCKS.find((u) => u.level > p.level);
  if (next && !r.unlocked.length) box.append(el('div', { class: 'small-note', text: `Next unlock at level ${next.level}: ${unlockName(next.id)}` }));
  if (r.rating) {
    const d = r.rating.after - r.rating.before;
    const tier = tierFor(r.rating.after);
    box.append(el('div', { class: `rating-change ${d >= 0 ? 'up' : 'down'}`, text: `Rating ${r.rating.before} → ${r.rating.after} (${d >= 0 ? '+' : ''}${d}) · ${tier.name}` }));
  }
  if (isGuest) {
    box.append(
      el(
        'div',
        { class: 'small-note' },
        'Playing as a guest: progress is saved in this browser. ',
        el('button', { class: 'btn small blue', text: 'Make an account', on: { click: onSignup } }),
      ),
    );
  }
  return box;
}

/** Ranked queue screen. */
export function buildQueue(seconds: number, searching: number, rating: number, onCancel: () => void): HTMLElement {
  const tier = tierFor(rating);
  const m = Math.floor(seconds / 60);
  const sec = String(seconds % 60).padStart(2, '0');
  return el(
    'div',
    { class: 'menu' },
    el(
      'div',
      { class: 'panel menu-card interactive', style: 'text-align:center' },
      el('h2', { text: 'Ranked 1v1' }),
      el('div', { class: 'tier big', text: `${tier.name} · ${rating}`, style: { color: tier.color } }),
      el('div', { class: 'queue-spinner', text: '🎈' }),
      el('div', { text: `Finding an opponent near your rating... ${m}:${sec}` }),
      el('div', { class: 'small-note', text: searching > 1 ? `${searching} players searching` : 'The search widens the longer you wait.' }),
      el('button', { class: 'btn small ghost', text: 'Cancel', on: { click: onCancel } }),
    ),
  );
}
