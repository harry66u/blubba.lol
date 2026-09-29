// Screenshots of every screen outside the 3D match: main menu, settings, how to play, account
// screens, profile and leaderboard, loadout, locker, room invites, ranked queue, connecting,
// pause (host and public), scoreboard, results (as played, then a win with a full rewards box),
// and the error states (server down, version mismatch, disconnected). Desktop and phone sizes.
// Also flags anything that spills past the sides of the window (a sideways scroll on phones).
// Needs the server running with BUBBA_DEBUG=1 (for ending matches early and granting XP).
// Usage: node scripts/screens.mjs [url] [outDir] [viewports] [sections]
//   viewports: comma list of desktop,hd,phone-land,phone-port (default: all four)
//   sections: comma list of guest,invites,errors,account,private,public (default: all)
import { chromium, devices } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:8080/';
const out = process.argv[3] ?? 'test-results/screens';
const VIEWPORTS = {
  desktop: { viewport: { width: 1280, height: 720 } },
  hd: { viewport: { width: 1920, height: 1080 } },
  'phone-land': { ...devices['iPhone 13 landscape'], deviceScaleFactor: 2 },
  'phone-port': { ...devices['iPhone 13'], deviceScaleFactor: 2 },
};
const which = (process.argv[4] || Object.keys(VIEWPORTS).join(',')).split(',').filter(Boolean);
const sections = (process.argv[5] ?? '').split(',').filter(Boolean);
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const errors = [];
const unique = `Shots${Math.floor(Math.random() * 90000 + 10000)}`;

/** A believable leaderboard (the test server has no ranked players). */
const fakeBoard = (me) => ({
  players: [
    { name: 'GustyGus', rating: 1612, games: 88, level: 31 },
    { name: 'PuffDaddy', rating: 1544, games: 70, level: 27 },
    { name: 'NoodleArms', rating: 1418, games: 51, level: 22 },
    { name: me, rating: 1302, games: 24, level: 12 },
    { name: 'Wobbles', rating: 1260, games: 30, level: 15 },
    { name: 'AirHead', rating: 1180, games: 12, level: 9 },
    { name: 'FlapJack', rating: 1066, games: 19, level: 8 },
    { name: 'SirSqueaks', rating: 990, games: 7, level: 5 },
    { name: 'Deflato', rating: 870, games: 11, level: 4 },
  ],
});

for (const vpName of which) {
  const opts = VIEWPORTS[vpName];
  if (!opts) throw new Error(`unknown viewport ${vpName}`);
  const ctx = await browser.newContext({ ...opts, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${vpName}] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[${vpName}] [pageerror] ${e.message}`));
  const shot = async (name, settle = 500) => {
    await page.waitForTimeout(settle);
    await page.screenshot({ path: `${out}/${vpName}-${name}.png` });
    const wide = await page.evaluate(() => {
      const w = document.documentElement.clientWidth;
      return [...document.querySelectorAll('#ui *')]
        .filter((e) => { const r = e.getBoundingClientRect(); return r.width && r.height && (r.right > w + 1 || r.left < -1) && !e.closest('.touch-controls, .hud'); })
        .slice(0, 3)
        .map((e) => `${e.tagName}.${[...e.classList].join('.')}`);
    });
    console.log(`${vpName}-${name}${wide.length ? `  (spills sideways: ${wide.join(', ')})` : ''}`);
  };
  const clickText = (text) => page.locator(`#ui button:visible:has-text("${text}")`).first().click();
  // Buttons that get redrawn (queue, mode picker) are clicked through the DOM.
  const domClick = (sel) => page.evaluate((s) => document.querySelector(s)?.click(), sel);
  const menuReady = async () => {
    await page.waitForSelector('.menu .btn.big', { timeout: 60000 });
    await page.waitForFunction(() => !document.getElementById('splash'), null, { timeout: 10000 }).catch(() => undefined);
  };
  const joined = () => page.waitForFunction(() => window.bubba?.game?.active && window.bubba.game.pred.mode !== 4, null, { timeout: 90000 });
  const pause = async () => {
    for (let i = 0; i < 3 && !(await page.$('.overlay h2:has-text("Paused")')); i++) {
      await page.evaluate(() => window.bubba.input.onMenuButton?.());
      await page.waitForTimeout(150);
    }
  };
  const routeBoard = (who) => page.route('**/api/leaderboard', (route) => route.fulfill({ json: fakeBoard(who) }));
  const resetRoutes = async (who = unique) => {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await routeBoard(who);
  };
  /** One group of screens; a failure is logged (with a screenshot) and the next group still runs. */
  const section = async (title, fn) => {
    if (sections.length && !sections.includes(title)) return;
    try {
      await fn();
    } catch (e) {
      errors.push(`[${vpName}] section "${title}" failed: ${e.message.split('\n')[0]}`);
      await page.screenshot({ path: `${out}/${vpName}-FAILED-${title}.png` }).catch(() => undefined);
    }
  };
  await routeBoard(unique);

  await section('guest', async () => {
    await page.goto(url);
    await menuReady();
    await page.waitForSelector('.account-chip .chip-main');
    await shot('01-menu', 1500);
    await clickText('Settings');
    await shot('02-settings-controls');
    await page.locator('.tabs button:has-text("Audio")').click();
    await shot('03-settings-audio');
    await page.locator('.tabs button:has-text("Graphics")').click();
    await shot('04-settings-graphics');
    await clickText('DONE');
    await clickText('How to play');
    await shot('05-howto');
    await clickText('GOT IT');
    await page.click('.account-chip .chip-main');
    await shot('06-profile-guest', 900);
    await page.locator('.profile button:has-text("DONE")').click();
    await page.locator('.account-chip button:has-text("Sign up")').click();
    await shot('07-account-signup');
    await page.locator('.account-panel button[type="submit"]').click();
    await shot('08-account-signup-error');
    await page.locator('.account-panel .tabs button:has-text("Log in")').click();
    await shot('09-account-login');
    await page.locator('.account-panel .tabs button:has-text("Forgot")').click();
    await shot('10-account-reset');
    await clickText('Not now');
    await clickText('Loadout');
    await shot('11-loadout');
    await clickText('DONE');
    await clickText('Locker');
    await page.waitForSelector('.item-grid .item');
    await shot('12-locker', 900);
    await clickText('DONE');
  });

  await section('invites', async () => {
    await page.goto(new URL('/r/ABCDE', url).href);
    await page.waitForSelector('.menu .btn.big');
    await shot('13-room-join', 1200);
    await page.locator('.menu .btn.big').click();
    await page.waitForSelector('.menu .notice, .menu .error-text:not(:empty)', { timeout: 20000 }).catch(() => undefined);
    await shot('14-room-join-missing', 900);
    await page.goto(new URL('/c/ABCDE', url).href);
    await page.waitForSelector('.menu .btn.big');
    await shot('15-challenge-join', 1200);
  });

  await section('errors', async () => {
    // Server down: the socket never connects.
    await page.routeWebSocket(/\/ws$/, (ws) => ws.close());
    await page.goto(url);
    await menuReady();
    await page.locator('.menu .btn.big').click();
    await page.waitForTimeout(1500);
    await shot('16-error-server-down', 600);
    // Old client: the server answers hello with a version error.
    await resetRoutes();
    await page.routeWebSocket(/\/ws$/, (ws) => {
      ws.onMessage((m) => {
        if (typeof m === 'string' && m.includes('"hello"')) ws.send(JSON.stringify({ type: 'error', code: 'version', message: 'A new version of Blubba is out. Refresh the page!' }));
      });
    });
    await page.goto(url);
    await menuReady();
    await page.locator('.menu .btn.big').click();
    await page.waitForTimeout(1200);
    await shot('17-error-version', 600);
    // Connecting: the server never answers hello.
    await resetRoutes();
    await page.routeWebSocket(/\/ws$/, () => undefined);
    await page.goto(url);
    await menuReady();
    await page.locator('.menu .btn.big').click();
    await shot('18-connecting', 1200);
  });
  await resetRoutes();

  const name = `${unique}${vpName[0]}${vpName.slice(-1)}`.slice(0, 16);
  await section('account', async () => {
    await page.goto(url);
    await menuReady();
    await page.locator('.account-chip button:has-text("Sign up")').click();
    await page.fill('.account-panel input[aria-label="Name"]', name);
    const pw = page.locator('.account-panel input[type="password"]');
    await pw.nth(0).fill('password123');
    await pw.nth(1).fill('password123');
    await page.locator('.account-panel button[type="submit"]').click();
    await page.waitForSelector('.recovery-code', { timeout: 10000 });
    await shot('19-account-recovery');
    await clickText('I SAVED IT');
    await page.evaluate(async () => {
      const a = window.bubba.account;
      await fetch('/api/debug/grant', { method: 'POST', headers: { authorization: `Bearer ${a.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ coins: 1840, xp: 2600 }) });
      await a.refresh();
    });
    await resetRoutes(name);
    await shot('20-menu-account', 1200);
    await page.click('.account-chip .chip-main');
    await shot('21-profile-account', 900);
    await page.locator('.profile button:has-text("DONE")').click();
    await domClick('.mode-picker button[data-mode="ranked"]');
    await domClick('.menu .btn.big');
    await page.waitForTimeout(1500);
    await shot('22-queue', 300);
    await page.evaluate(() => [...document.querySelectorAll('.menu button')].find((b) => /cancel/i.test(b.textContent))?.click());
    await page.waitForSelector('.mode-picker button');
    await domClick('.mode-picker button[data-mode="knockout"]');
  });

  await section('private', async () => {
    await page.goto(url);
    await menuReady();
    await clickText('PRIVATE ROOM');
    await joined();
    await page.waitForTimeout(1500);
    await shot('23-click-to-play', 300);
    await pause();
    await shot('24-pause-host');
    await page.evaluate(() => { window.bubba.net.close(); window.bubba.game.leave(); });
  });

  await section('public', async () => {
    await page.goto(url);
    await menuReady();
    await domClick('.mode-picker button[data-mode="knockout"]');
    await page.locator('.menu .btn.big').click();
    await joined();
    await page.evaluate(() => window.bubba.net.send({ type: 'debug', action: 'bots', count: 6 }));
    await page.waitForTimeout(2500);
    await pause();
    await shot('25-pause-public');
    await page.evaluate(() => window.bubba.input.onMenuButton?.());
    await page.evaluate(() => window.bubba.input.onScoreboard?.(true));
    await shot('26-scoreboard');
    await page.evaluate(() => window.bubba.input.onScoreboard?.(false));
    await page.evaluate(() => window.bubba.net.send({ type: 'debug', action: 'endIn', seconds: 1 }));
    await page.waitForFunction(() => window.bubba.game.match.phase === 'results', null, { timeout: 30000 });
    await page.waitForTimeout(800);
    const skip = await page.$('.replay-banner .btn');
    if (skip) await skip.click({ force: true, timeout: 3000 }).catch(() => undefined);
    await page.waitForSelector('.results', { timeout: 20000 }).catch(() => undefined);
    await shot('27-results', 2200);
    // The same screen for a win with a full rewards box (level up, unlock, dailies).
    await page.evaluate(() => {
      const g = window.bubba.game;
      const r = g.match.result;
      const me = r.standings.find((s) => s.id === g.youId);
      if (me) {
        me.score = 9;
        Object.assign(me.stats, { kos: 7, deaths: 2, longestLaunch: 38.4, hits: 41 });
        r.standings.sort((a, b) => (b.id === g.youId) - (a.id === g.youId) || b.score - a.score);
        r.standings.forEach((s, i) => { if (s.id !== g.youId) s.score = Math.max(0, 6 - i); });
        r.winnerId = g.youId;
        r.awards = [{ key: 'longestLaunch', id: g.youId, value: 38.4 }, { key: 'mostKos', id: g.youId, value: 7 }, { key: 'bestCombo', id: r.standings[1].id, value: 4 }, { key: 'mostPopped', id: r.standings[2].id, value: 5 }];
      }
      const profile = structuredClone(window.bubba.account.profile);
      profile.level += 1;
      profile.xpInto = Math.round(profile.xpNext * 0.35);
      const report = {
        reward: { xp: 186, coins: 42, lines: [{ label: 'Played the match', xp: 60, coins: 10 }, { label: 'Knockouts x7', xp: 84, coins: 14 }, { label: 'Winner!', xp: 42, coins: 18 }] },
        levelBefore: profile.level - 1,
        levelAfter: profile.level,
        unlocked: ['longBarrel'],
        profile,
      };
      window.bubba.net.handlers.onMessage({ type: 'progress', report });
    });
    await shot('28-results-win', 2400);
    await page.evaluate(() => { const p = document.querySelector('.results .panel'); if (p) p.scrollTop = p.scrollHeight; });
    await shot('29-results-win-bottom', 400);
    // Wait for the next match, then lose the connection.
    await page.waitForFunction(() => window.bubba.game.match.phase !== 'results', null, { timeout: 40000 }).catch(() => undefined);
    await page.evaluate(() => window.bubba.net.ws?.close());
    await page.waitForSelector('.menu .btn.big', { timeout: 20000 });
    await shot('30-error-disconnected', 1200);
  });
  await ctx.close();
}
console.log('errors:', errors.length ? `\n${errors.slice(0, 30).join('\n')}` : 'none');
await browser.close();
