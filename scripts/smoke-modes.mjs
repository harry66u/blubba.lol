// Headless check of every mode plus the 1v1 challenge-link flow. Takes screenshots.
// Usage: node scripts/smoke-modes.mjs [url] [outDir]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:8080/';
const out = process.argv[3] ?? 'test-results/modes';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const errors = [];
async function newPage(ctx) {
  const page = await ctx.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  return page;
}
async function fakeLock(page) {
  await page.evaluate(() => { const b = window.bubba; b.input.locked = true; b.input.enabled = true; document.querySelectorAll('.click-to-play').forEach((e) => e.remove()); });
}
const inMatch = (page) => page.waitForFunction(() => window.bubba?.game?.active && window.bubba.game.pred.mode !== 4, null, { timeout: 90000 });

const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const only = process.env.ONLY;
for (const mode of ['teamKnockout', 'ball', 'pump', 'duel'].filter((m) => !only || only.includes(m))) {
  const page = await newPage(ctx);
  await page.goto(url);
  await page.waitForSelector('.mode-picker button', { timeout: 15000 });
  await page.click(`.mode-picker button[data-mode="${mode}"]`);
  if (mode === 'teamKnockout') await page.screenshot({ path: `${out}/0-menu.png` });
  await page.click('.btn.big');
  await inMatch(page);
  await fakeLock(page);
  await page.waitForTimeout(2500);
  // Look toward the middle of the map for a better view.
  await page.screenshot({ path: `${out}/${mode}-1.png` });
  await page.keyboard.down('Tab');
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${out}/${mode}-scoreboard.png` });
  await page.keyboard.up('Tab');
  const info = await page.evaluate(() => {
    const g = window.bubba.game;
    return { room: g.room.settings, map: g.map.id, roster: [...g.roster.values()].map((r) => `${r.name}${r.bot ? '*' : ''}/t${r.team}`).join(' '), mode: g.modeState };
  });
  console.log(mode, JSON.stringify(info).slice(0, 400));
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${out}/${mode}-2.png` });
  await page.close();
}

// Challenge flow: A makes a link, B opens it.
const ctxA = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['clipboard-read', 'clipboard-write'] });
const a = await newPage(ctxA);
await a.goto(url);
await a.waitForSelector('.mode-picker button');
await a.click('text=1v1 CHALLENGE');
await inMatch(a);
await fakeLock(a);
await a.waitForTimeout(600);
const path = await a.evaluate(() => location.pathname);
console.log('challenge path', path);
await a.screenshot({ path: `${out}/challenge-a.png` });
const ctxB = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const b = await newPage(ctxB);
await b.goto(new URL(path, url).href, { waitUntil: 'domcontentloaded', timeout: 120000 });
await b.waitForSelector('.btn.big.green', { timeout: 120000 });
await b.screenshot({ path: `${out}/challenge-b-invite.png` });
await b.click('.btn.big.green');
await inMatch(b);
await fakeLock(b);
await b.waitForTimeout(1500);
const duel = await b.evaluate(() => [...window.bubba.game.roster.values()].map((r) => `${r.name}${r.bot ? '*' : ''}`));
console.log('duel roster', duel);
await b.screenshot({ path: `${out}/challenge-b.png` });
console.log('errors:', errors.length ? '\n' + errors.slice(0, 20).join('\n') : 'none');
await browser.close();
