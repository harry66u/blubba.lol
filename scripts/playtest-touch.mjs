// Phone playtest: plays a match on an emulated phone held sideways using only touch input (move
// stick, drag to aim, fire button, jump, dash, gadgets, pause), with screenshots and an error log.
// Usage: node scripts/playtest-touch.mjs [url] [outDir] [seconds]
import { chromium, devices } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:8080/';
const out = process.argv[3] ?? 'test-results/playtest-touch';
const SECONDS = Number(process.argv[4] ?? 45);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const errors = [];
const ctx = await browser.newContext({ ...devices['iPhone 13 landscape'] });
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
await page.goto(url);
await page.waitForSelector('.btn.big', { timeout: 60000 });
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/1-menu.png` });
await page.tap('.btn.big');
await page.waitForFunction(() => window.bubba?.game?.active && window.bubba.game.pred.mode !== 4, null, { timeout: 60000 });
await page.waitForTimeout(1000);

const cdp = await ctx.newCDPSession(page);
const touches = new Map();
const send = (type) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: [...touches.entries()].map(([id, [x, y]]) => ({ x, y, id })) });
const down = async (id, x, y) => { touches.set(id, [x, y]); await send('touchStart'); };
const move = async (id, x, y) => { touches.set(id, [x, y]); await send('touchMove'); };
const up = async (id) => { const t = touches.get(id); touches.delete(id); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [...touches.entries()].map(([i, [x, y]]) => ({ x, y, id: i })) }); void t; };
const center = (sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e || e.classList.contains('hidden')) return null; const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }, sel);
const vp = page.viewportSize();

const state = () => page.evaluate(() => { const g = window.bubba.game; const p = g.pred; return { t: Math.round(g.match.endsAtTick), pos: [p.px, p.py, p.pz].map((v) => +v.toFixed(1)), infl: Math.round(p.inflation * 100), ammo: p.ammo, mode: p.mode, yaw: +window.bubba.input.yaw.toFixed(2), enabled: window.bubba.input.enabled, touchUi: !document.querySelector('.touch-controls').classList.contains('hidden') }; });
const log = [];
let shots = 0;
const start = Date.now();
let i = 0;
while ((Date.now() - start) / 1000 < SECONDS) {
  i++;
  // Walk: thumb down on the left, push in a random direction.
  const sx = 120, sy = vp.height - 110;
  await down(1, sx, sy);
  const ang = Math.random() * Math.PI * 2;
  for (let k = 1; k <= 4; k++) await move(1, sx + Math.cos(ang) * 14 * k, sy + Math.sin(ang) * 14 * k);
  // Aim: drag in the open area up and right.
  await down(2, vp.width * 0.62, vp.height * 0.3);
  for (let k = 1; k <= 5; k++) await move(2, vp.width * 0.62 + (Math.random() - 0.5) * 30 * k, vp.height * 0.3 + (Math.random() - 0.5) * 8 * k);
  await up(2);
  // Fire: hold to charge while still walking.
  const fire = await center('.tbtn.fire');
  if (fire) {
    await down(3, fire[0], fire[1]);
    await page.waitForTimeout(150 + Math.random() * 500);
    await up(3);
    shots++;
  }
  // Now and then: jump, dash, a gadget.
  const extra = ['.tbtn.jump', '.tbtn.dash', '.tbtn.util1', '.tbtn.grapple'][i % 4];
  const b = await center(extra);
  if (b && Math.random() < 0.6) {
    await down(4, b[0], b[1]);
    await page.waitForTimeout(60);
    await up(4);
  }
  await page.waitForTimeout(250);
  await up(1);
  if (i % 6 === 0) {
    const s = await state();
    log.push(s);
    await page.screenshot({ path: `${out}/game-${String(i).padStart(3, '0')}.png` });
  }
}
// Pause and resume with the touch buttons.
const pause = await center('.tbtn.pause');
if (pause) { await down(5, pause[0], pause[1]); await up(5); }
await page.waitForTimeout(600);
await page.screenshot({ path: `${out}/pause.png` });
const paused = await page.evaluate(() => !!document.querySelector('.overlay .panel'));
const resume = await page.$('text=RESUME');
if (resume) await resume.tap();
await page.waitForTimeout(600);
const after = await state();
console.log(JSON.stringify({ rounds: i, shots, paused, resumed: after.enabled && after.touchUi, samples: log }, null, 1));
console.log('errors:', errors.length ? '\n' + errors.slice(0, 20).join('\n') : 'none');
await browser.close();
