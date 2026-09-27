// Headless check of the on-screen control hints, first-use tips and the third-person camera.
// Usage: node scripts/smoke-controls.mjs [url] [outDir]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:8080/';
const out = process.argv[3] ?? 'test-results/controls';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const errors = [];
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
// Software rendering is slow: low quality keeps the game clock close to real time.
await page.addInitScript(() => {
  if (!localStorage.getItem('bubba.settings.v1')) localStorage.setItem('bubba.settings.v1', JSON.stringify({ quality: 'low' }));
});
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
const fakeLock = () => page.evaluate(() => { const b = window.bubba; b.input.locked = true; b.input.enabled = true; document.querySelectorAll('.click-to-play').forEach((e) => e.remove()); });
const startMatch = async () => {
  await page.waitForSelector('.btn.big', { timeout: 60000 });
  await page.click('text=PRIVATE ROOM');
  await page.waitForFunction(() => window.bubba?.game?.active && window.bubba.game.pred.mode !== 4, null, { timeout: 60000 });
  await fakeLock();
};

await page.goto(url);
await startMatch();
// Skip the first tip's lead-in delay.
await page.evaluate(() => { window.bubba.game.tips.timer = 0; });
await page.waitForTimeout(1500);
console.log('keys:', await page.evaluate(() => [...document.querySelectorAll('.kc')].map((e) => e.textContent).join(' ')));
console.log('utility keys:', await page.evaluate(() => [...document.querySelectorAll('.util .k')].map((e) => e.textContent).join(' ')));
console.log('tip:', await page.evaluate(() => document.querySelector('.tip:not(.off)')?.textContent ?? 'none'));
await page.screenshot({ path: `${out}/1-hints-first-person.png` });

// Using the action from the tip marks it done.
await page.keyboard.press('ShiftLeft');
await page.waitForTimeout(300);
console.log('tip after dash:', await page.evaluate(() => document.querySelector('.tip')?.className + ' / ' + document.querySelector('.tip')?.textContent));

// Third person.
await page.keyboard.press('KeyV');
await page.waitForTimeout(1500);
const state = () => page.evaluate(() => {
  const g = window.bubba.game;
  return JSON.stringify({ third: g.settings.thirdPerson, camDist: +g.camDist.toFixed(2), selfVisible: !!g.selfMan?.group.visible, viewModel: g.viewModel.root.visible, camY: +g.r.camera.position.y.toFixed(2), eyeY: +(g.pred.py + 1.6).toFixed(2) });
});
console.log('third person:', await state());
await page.screenshot({ path: `${out}/2-third-person.png` });
// Charge and fire a shot.
await page.evaluate(() => window.bubba.input.held.add('Mouse0'));
await page.waitForTimeout(700);
await page.screenshot({ path: `${out}/3-third-person-charging.png` });
await page.evaluate(() => window.bubba.input.held.delete('Mouse0'));
await page.waitForTimeout(120);
await page.screenshot({ path: `${out}/4-third-person-shot.png` });
console.log('aim yaw/pitch (camera vs frame):', await page.evaluate(() => { const g = window.bubba.game; return [g.input.yaw, g.input.pitch, g.pred.yaw, g.pred.pitch].map((v) => v.toFixed(3)).join(' '); }));
// Looking up: the camera tucks in above the floor instead of clipping under it.
await page.evaluate(() => { window.bubba.input.pitch = 1.3; });
await page.waitForTimeout(800);
console.log('looking up:', await state());
await page.screenshot({ path: `${out}/5-third-person-look-up.png` });
await page.evaluate(() => { window.bubba.input.pitch = -0.2; window.bubba.input.yaw += 2.2; });
await page.waitForTimeout(3000);
await page.screenshot({ path: `${out}/6-third-person-turned.png` });

// The choice survives a reload.
await page.evaluate(() => { window.bubba.net.close(); window.bubba.game.leave(); });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
await startMatch();
await page.waitForTimeout(1500);
console.log('after reload:', await state());
await page.keyboard.press('KeyV');
await page.waitForTimeout(500);
console.log('toggled back:', await state());
console.log('errors:', errors.length ? '\n' + errors.slice(0, 20).join('\n') : 'none');
await browser.close();
