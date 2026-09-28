// Headless check of host controls: switches a private room through maps and modes, then ends a
// team match early (needs BUBBA_DEBUG=1 on the server) to see the results screen.
// Usage: node scripts/smoke-host.mjs [url] [outDir]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:8080/';
const out = process.argv[3] ?? 'test-results/host';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const errors = [];
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
await page.goto(url);
await page.waitForSelector('.mode-picker button');
await page.click('text=PRIVATE ROOM');
await page.waitForFunction(() => window.bubba?.game?.active, null, { timeout: 60000 });
const lock = () => page.evaluate(() => { const b = window.bubba; b.input.locked = true; b.input.enabled = true; document.querySelectorAll('.click-to-play').forEach((e) => e.remove()); });
await lock();
for (const [mode, mapId] of [['knockout', 'garage'], ['knockout', 'bounceHouse'], ['knockout', 'pier'], ['teamKnockout', 'bounceHouse']]) {
  await page.evaluate(([mode, mapId]) => window.bubba.net.send({ type: 'host', action: 'settings', settings: { mode, mapId, bots: true } }), [mode, mapId]);
  await page.waitForFunction((m) => window.bubba.game.map.id === m && window.bubba.game.pred.mode !== 4, mapId, { timeout: 30000 });
  await lock();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}/${mode}-${mapId}.png` });
  console.log(mode, mapId, await page.evaluate(() => [...window.bubba.game.roster.values()].length));
}
// Pause menu with host controls.
await page.evaluate(() => { window.bubba.input.locked = false; window.bubba.input.onLockChange?.(false); });
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/pause.png` });
await page.keyboard.press('Escape');
await lock();
await page.evaluate(() => window.bubba.net.send({ type: 'debug', action: 'endIn', seconds: 2 }));
await page.waitForFunction(() => window.bubba.game.match.phase === 'results', null, { timeout: 30000 });
// Skip the replay to the results card.
await page.waitForTimeout(500);
const skip = await page.$('.replay-banner .btn');
if (skip) await skip.click({ force: true, timeout: 3000 }).catch(() => undefined);
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/results.png` });
console.log('errors:', errors.length ? '\n' + errors.slice(0, 20).join('\n') : 'none');
await browser.close();
