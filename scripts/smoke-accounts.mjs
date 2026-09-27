// Headless check of accounts and the economy: guest menu, locker, sign-up with recovery code,
// buying a hat, match rewards, quick chat, and a ranked 1v1 between two accounts.
// Needs the server running with BUBBA_DEBUG=1 (for /api/debug/grant and ending matches early).
// Usage: node scripts/smoke-accounts.mjs [url] [outDir]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:8080/';
const out = process.argv[3] ?? 'test-results/accounts';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const errors = [];
async function newPage() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  return page;
}
const fakeLock = (page) => page.evaluate(() => { const b = window.bubba; b.input.locked = true; b.input.enabled = true; document.querySelectorAll('.click-to-play').forEach((e) => e.remove()); });
const unique = `Tester${Math.floor(Math.random() * 9000 + 1000)}`;

const page = await newPage();
await page.goto(url);
await page.waitForSelector('.account-chip .chip-main', { timeout: 30000 });
await page.waitForTimeout(600);
await page.screenshot({ path: `${out}/1-menu-guest.png` });

// Locker as a guest: can wear free things, buying asks for an account.
await page.click('text=Locker');
await page.waitForSelector('.item-grid .item');
await page.waitForTimeout(800);
await page.click('.locker .tab:has-text("Hats")');
await page.click('.item-grid .item:has-text("Top Hat")');
await page.waitForTimeout(300);
console.log('guest buy note:', await page.textContent('.locker-note'));
await page.screenshot({ path: `${out}/2-locker-guest.png` });

// Sign up from the locker.
await page.click('.locker-note .btn');
await page.waitForSelector('.account-panel');
await page.fill('.account-panel input[aria-label="Name"]', unique);
const pw = page.locator('.account-panel input[type="password"]');
await pw.nth(0).fill('password123');
await pw.nth(1).fill('password123');
await page.click('text=CREATE ACCOUNT');
await page.waitForSelector('.recovery-code', { timeout: 10000 });
console.log('recovery code:', await page.textContent('.recovery-code'));
await page.screenshot({ path: `${out}/3-recovery.png` });
await page.click('text=I SAVED IT');

// Grant coins (debug) and buy + wear a hat and a finish.
await page.evaluate(async () => {
  const a = window.bubba.account;
  await fetch('/api/debug/grant', { method: 'POST', headers: { authorization: `Bearer ${a.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ coins: 2000, xp: 400 }) });
  await a.refresh();
});
await page.click('text=Locker');
await page.waitForSelector('.item-grid .item');
await page.click('.locker .tab:has-text("Hats")');
await page.click('.item-grid .item:has-text("Top Hat")');
await page.click('.item-grid .item:has-text("Top Hat")');
await page.waitForTimeout(500);
await page.click('.locker .tab:has-text("Faces")');
await page.click('.item-grid .item:has-text("Shades")');
await page.click('.item-grid .item:has-text("Shades")');
await page.waitForTimeout(500);
await page.click('.locker .tab:has-text("Weapon finishes")');
await page.click('.item-grid .item:has-text("Gold")');
await page.click('.item-grid .item:has-text("Gold")');
await page.waitForTimeout(1200);
console.log('coins after buying:', await page.textContent('.locker-left .coins'));
await page.screenshot({ path: `${out}/4-locker-bought.png` });
await page.click('text=DONE');

// Profile.
await page.click('.account-chip .chip-main');
await page.waitForSelector('.profile');
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/5-profile.png` });
await page.click('.profile >> text=DONE');

// Play a private match, chat, then end it early to see rewards.
await page.click('text=PRIVATE ROOM');
await page.waitForFunction(() => window.bubba?.game?.active && window.bubba.game.pred.mode !== 4, null, { timeout: 60000 });
await fakeLock(page);
await page.waitForTimeout(1500);
await page.keyboard.down('KeyZ');
await page.mouse.move(640, 400);
await page.evaluate(() => { const i = window.bubba.input; i.onMouseMove?.call?.(i, { movementX: 0, movementY: -80 }); });
await page.waitForTimeout(200);
await page.screenshot({ path: `${out}/6-chat-wheel.png` });
await page.keyboard.press('Digit1');
await page.keyboard.up('KeyZ');
// Fire a few shots so the match counts as played.
for (let i = 0; i < 3; i++) {
  await page.evaluate(() => window.bubba.input.held.add('Mouse0'));
  await page.waitForTimeout(250);
  await page.evaluate(() => window.bubba.input.held.delete('Mouse0'));
  await page.waitForTimeout(250);
}
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/7-chat-sent.png` });
// Rewards need 45+ seconds in the match, so stick around, then end it early (server debug).
await page.waitForTimeout(46000);
await page.evaluate(() => window.bubba.net.send({ type: 'debug', action: 'endIn', seconds: 1 }));
await page.waitForFunction(() => window.bubba.game.match.phase === 'results', null, { timeout: 30000 });
await page.waitForTimeout(800);
const skip = await page.$('.replay-banner .btn');
if (skip) await skip.click({ force: true, timeout: 3000 }).catch(() => undefined);
await page.waitForTimeout(1000);
await page.screenshot({ path: `${out}/8-results.png` });
console.log('progress:', await page.evaluate(() => JSON.stringify(window.bubba.game.lastProgress?.reward ?? null)));

// Ranked: two accounts queue and get matched.
const p2 = await newPage();
await p2.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
await p2.waitForSelector('.account-chip .chip-main', { timeout: 120000 });
const unique2 = `${unique}b`;
await p2.evaluate(async (name) => { await window.bubba.account.register(name, 'password123'); }, unique2);
await page.evaluate(() => { window.bubba.net.close(); window.bubba.game.leave(); });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('.mode-picker button', { timeout: 120000 });
for (const pg of [page, p2]) {
  await pg.waitForSelector('.mode-picker button[data-mode="ranked"]', { timeout: 60000 });
  await pg.click('.mode-picker button[data-mode="ranked"]');
  await pg.click('.btn.big');
}
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/9-queue.png` });
await page.waitForFunction(() => window.bubba?.game?.active && window.bubba.game.room?.ranked, null, { timeout: 120000 });
await fakeLock(page);
await page.waitForTimeout(1500);
await page.keyboard.down('Tab');
await page.waitForTimeout(200);
await page.screenshot({ path: `${out}/10-ranked.png` });
await page.keyboard.up('Tab');
// Rival quits: we win by forfeit.
await p2.close();
await page.waitForFunction(() => !!window.bubba.game.lastProgress?.rating, null, { timeout: 30000 });
console.log('rating:', await page.evaluate(() => JSON.stringify(window.bubba.game.lastProgress.rating)));
await page.waitForTimeout(1000);
const skip2 = await page.$('.replay-banner .btn');
if (skip2) await skip2.click({ force: true, timeout: 3000 }).catch(() => undefined);
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/11-ranked-result.png` });
console.log('errors:', errors.length ? '\n' + errors.slice(0, 20).join('\n') : 'none');
await browser.close();
