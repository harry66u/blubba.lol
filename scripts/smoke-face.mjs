// Face scan check: signs up, scans a face (the fake camera, then a generated test picture), joins a
// private room, and checks a second player sees the face on the first player's tube man.
// Usage: node scripts/smoke-face.mjs [url] [outDir]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:8080/';
const out = process.argv[3] ?? 'test-results/face';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
});
const errors = [];
async function newPage() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, permissions: ['camera'] });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  return page;
}
const a = await newPage();
await a.goto(url);
await a.waitForSelector('.account-chip .chip-main', { timeout: 30000 });
const name = `Facey${Math.floor(Math.random() * 90000 + 10000)}`;
await a.evaluate(async (n) => { await window.bubba.account.register(n, 'password123'); await window.bubba.account.refresh(); }, name);
// Profile -> Face scan.
await a.click('.account-chip .chip-main');
await a.waitForSelector('.profile');
await a.click('.profile button:has-text("Face scan")');
await a.waitForSelector('.face-scan');
// The fake camera first (a test pattern), snapped.
await a.click('.face-scan button:has-text("Use camera")');
await a.waitForTimeout(1500);
await a.screenshot({ path: `${out}/1-camera.png` });
await a.click('.face-scan button:has-text("Snap")');
// Then a generated test picture (a drawn cartoon face) from "Pick a photo".
const png = await a.evaluate(() => {
  const c = document.createElement('canvas');
  c.width = c.height = 400;
  const g = c.getContext('2d');
  g.fillStyle = '#7ec8ff'; g.fillRect(0, 0, 400, 400);
  g.fillStyle = '#ffcf9e'; g.beginPath(); g.ellipse(200, 210, 120, 150, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#4a2c1a'; g.beginPath(); g.ellipse(200, 90, 130, 60, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#222'; g.beginPath(); g.arc(155, 200, 14, 0, Math.PI * 2); g.arc(245, 200, 14, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#b3364f'; g.lineWidth = 10; g.beginPath(); g.arc(200, 260, 50, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
  return c.toDataURL('image/png').split(',')[1];
});
await a.setInputFiles('.face-scan input[type=file]', { name: 'me.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
await a.waitForTimeout(800);
await a.click('.face-scan button:has-text("SAVE FACE")');
const blocked = await a.textContent('.face-note');
await a.check('.face-scan input[type=checkbox]');
await a.click('.face-scan button:has-text("SAVE FACE")');
await a.waitForFunction(() => window.bubba.account.face?.version, null, { timeout: 10000 });
await a.screenshot({ path: `${out}/2-saved.png` });
const note = await a.textContent('.face-note');
await a.click('.face-scan button:has-text("Done")');
await a.click('.profile button:has-text("DONE")');
// Your face on your own tube man in the Locker.
await a.click('text=Locker');
await a.waitForSelector('.item-grid .item');
// Spin the preview by dragging it and grab a few angles.
const box = await a.locator('.preview-canvas').boundingBox();
for (let i = 0; i < 6; i++) {
  await a.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await a.mouse.down();
  await a.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2, { steps: 4 });
  await a.mouse.up();
  await a.waitForTimeout(700);
  await a.locator('.preview-canvas').screenshot({ path: `${out}/2b-locker-face-${i}.png` });
}
await a.click('.locker button:has-text("DONE")');
await a.waitForTimeout(400);
// Host a private room; a second player joins it.
await a.click('button:has-text("PRIVATE ROOM")');
await a.waitForFunction(() => window.bubba?.game?.active, null, { timeout: 30000 });
const code = await a.evaluate(() => window.bubba.game.room?.code);
const b = await newPage();
await b.goto(url + 'r/' + code);
await b.waitForSelector('.btn.big', { timeout: 30000 });
await b.click('.btn.big');
await b.waitForFunction(() => window.bubba?.game?.active, null, { timeout: 30000 });
await b.waitForTimeout(2500);
const seen = await b.evaluate(() => {
  const g = window.bubba.game;
  const mine = [...g.roster.values()].find((r) => r.face);
  const rv = mine ? g.remotes.get(mine.id) : null;
  if (rv?.cur) {
    const p = g.pred;
    const dx = rv.cur.px - p.px, dz = rv.cur.pz - p.pz, dy = rv.cur.py + 1.6 - (p.py + 1.85);
    window.bubba.input.yaw = Math.atan2(-dx, -dz);
    window.bubba.input.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  }
  return { face: mine?.face ?? null, faceKey: rv?.faceKey ?? null };
});
// Turn the scanned player to face the other one, a few meters apart, and look at them.
const bPos = await b.evaluate(() => { const p = window.bubba.game.pred; return [p.px, p.py, p.pz]; });
await a.evaluate(([x, y, z]) => {
  const p = window.bubba.game.pred;
  window.bubba.input.yaw = Math.atan2(-(x - p.px), -(z - p.pz));
  window.bubba.input.pitch = 0;
}, bPos);
for (let i = 0; i < 6; i++) {
  await b.evaluate(() => {
    const g = window.bubba.game;
    const mine = [...g.roster.values()].find((r) => r.face);
    const rv = mine ? g.remotes.get(mine.id) : null;
    if (!rv?.cur) return;
    const p = g.pred;
    const dx = rv.cur.px - p.px, dz = rv.cur.pz - p.pz, dy = rv.cur.py + 2.1 - (p.py + 1.85);
    window.bubba.input.yaw = Math.atan2(-dx, -dz);
    window.bubba.input.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  });
  await b.waitForTimeout(400);
}
await b.screenshot({ path: `${out}/3-other-player-sees-face.png` });
// Walk back a few steps for a wider look.
await b.keyboard.down('KeyS');
await b.waitForTimeout(700);
await b.keyboard.up('KeyS');
await b.waitForTimeout(600);
await b.screenshot({ path: `${out}/4-other-player-sees-face-far.png` });
const img = await b.evaluate(async (f) => f ? (await fetch(`/api/face/${f.account}?v=${f.v}`)).headers.get('content-type') : null, seen.face);
console.log(JSON.stringify({ name, code, blocked, note, seen, img }));
console.log('errors:', errors.length ? errors.join('\n') : 'none');
await browser.close();
