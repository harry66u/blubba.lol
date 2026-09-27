// Headless smoke test: loads the game, joins a match, plays a little, takes screenshots.
// Usage: node scripts/smoke.mjs [url] [outDir]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:8080/';
const out = process.argv[3] ?? 'test-results';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
const t0 = Date.now();
await page.goto(url);
await page.evaluate(() => { try { localStorage.setItem('bubba.settings.v1', JSON.stringify({ showFps: true })); } catch {} });
await page.reload();
await page.waitForSelector('.btn.big', { timeout: 15000 });
console.log('menu visible after', Date.now() - t0, 'ms');
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/1-menu.png` });
await page.click('.btn.big');
await page.waitForFunction(() => window.bubba?.game?.active && window.bubba.game.pred.mode !== 4, null, { timeout: 15000 });
console.log('in match after', Date.now() - t0, 'ms');
// Headless has no pointer lock; pretend we have it.
await page.evaluate(() => { const b = window.bubba; b.input.locked = true; b.input.enabled = true; document.querySelectorAll('.click-to-play').forEach((e) => e.remove()); });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/2-spawn.png` });
// Walk, jump, dash, and fire a charged shot.
const before = await page.evaluate(() => { const g = window.bubba.game; return [g.pred.px, g.pred.pz, g.pred.ammo]; });
await page.keyboard.down('KeyW');
await page.waitForTimeout(600);
await page.keyboard.press('Space');
await page.waitForTimeout(250);
await page.keyboard.press('Space');
await page.waitForTimeout(200);
await page.keyboard.press('ShiftLeft');
await page.keyboard.up('KeyW');
await page.evaluate(() => { const b = window.bubba; b.input.held.add('Mouse0'); });
await page.waitForTimeout(700);
await page.screenshot({ path: `${out}/3-charging.png` });
await page.evaluate(() => { const b = window.bubba; b.input.held.delete('Mouse0'); });
await page.waitForTimeout(120);
const after = await page.evaluate(() => { const g = window.bubba.game; return [g.pred.px, g.pred.pz, g.pred.ammo, g.pred.mode]; });
console.log('moved', JSON.stringify(before), '->', JSON.stringify(after));
await page.screenshot({ path: `${out}/4-fired.png` });
await page.waitForTimeout(2500);
const info = await page.evaluate(() => {
  const g = window.bubba.game;
  return { pred: [g.pred.px, g.pred.py, g.pred.pz].map((v) => v.toFixed(2)), ammo: g.pred.ammo, roster: [...g.roster.values()].map((r) => `${r.name}${r.bot ? '(bot)' : ''}:${r.score}`), phase: g.match.phase, fps: document.querySelectorAll('.ping')[1]?.textContent };
});
console.log(JSON.stringify(info));
await page.keyboard.down('Tab');
await page.waitForTimeout(200);
await page.screenshot({ path: `${out}/5-scoreboard.png` });
await page.keyboard.up('Tab');
await page.waitForTimeout(4000);
await page.screenshot({ path: `${out}/6-later.png` });
console.log('errors:', errors.length ? '\n' + errors.slice(0, 20).join('\n') : 'none');
await browser.close();
