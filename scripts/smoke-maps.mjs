// Every knockout map in a real browser: an overview from above, a player's view, and how many
// draw calls a frame takes (so new maps stay about as light as the old ones on school
// Chromebooks). Also screenshots the main-menu map picker on a desktop and on a phone held
// sideways, and checks that picking a map lands you in a match on it.
// Needs the server running with BUBBA_DEBUG=1.
// Usage: [QUALITY=medium] [MAPS=candy,skatepark] node scripts/smoke-maps.mjs [url] [outDir]
import { chromium, devices } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:8080/';
const out = process.argv[3] ?? 'test-results/maps';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const errors = [];
const watch = (page, tag) => {
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${tag}] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[${tag}] [pageerror] ${e.message}`));
};
const quality = process.env.QUALITY ?? 'medium';
const setup = (q) => localStorage.setItem('bubba.settings.v1', JSON.stringify({ ...JSON.parse(localStorage.getItem('bubba.settings.v1') ?? '{}'), quality: q }));
const inMatch = (page) => page.waitForFunction(() => window.bubba?.game?.active && window.bubba.game.pred.mode !== 4, null, { timeout: 90000 });
const fakeLock = (page) =>
  page.evaluate(() => {
    const b = window.bubba;
    b.input.locked = true;
    b.input.enabled = true;
    document.querySelectorAll('.click-to-play').forEach((e) => e.remove());
  });

// --- The main-menu map picker: desktop and a phone held sideways -------------------------------
for (const [tag, opts] of [
  ['desktop', { viewport: { width: 1280, height: 720 } }],
  ['phone-land', { ...devices['iPhone 13 landscape'], deviceScaleFactor: 2 }],
]) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  watch(page, `menu-${tag}`);
  await page.addInitScript(setup, 'low');
  await page.goto(url);
  await page.waitForSelector('.map-picker .map-tile', { timeout: 60000 });
  await page.waitForFunction(() => !document.getElementById('splash'), null, { timeout: 10000 }).catch(() => undefined);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/menu-${tag}.png` });
  await page.evaluate(() => document.querySelector('.map-tile[data-map="candy"]').click());
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/menu-${tag}-picked.png` });
  await page.locator('.map-picker').screenshot({ path: `${out}/menu-${tag}-row.png` });
  const spill = await page.evaluate(() => {
    const w = document.documentElement.clientWidth;
    const h = document.documentElement.clientHeight;
    const tiles = [...document.querySelectorAll('.map-tile')].map((e) => e.getBoundingClientRect());
    return { sideways: tiles.some((r) => r.right > w + 1 || r.left < -1), below: tiles.some((r) => r.bottom > h), picked: document.querySelector('.map-name').textContent };
  });
  console.log(`menu ${tag}: picked "${spill.picked}"${spill.sideways ? ' (tiles spill sideways!)' : ''}${spill.below ? ' (tiles below the fold)' : ''}`);
  if (tag === 'desktop') {
    // Ball has its own arena: the row greys out.
    await page.evaluate(() => document.querySelector('.mode-picker button[data-mode="ball"]').click());
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${out}/menu-${tag}-ball.png` });
    await page.evaluate(() => document.querySelector('.mode-picker button[data-mode="knockout"]').click());
    // Quick play on the picked map.
    await page.locator('.menu .btn.big.play').click();
    await page.waitForFunction(() => !!window.bubba?.game?.room, null, { timeout: 60000 });
    await inMatch(page);
    const got = await page.evaluate(() => ({ map: window.bubba.game.map.id, private: window.bubba.game.room.isPrivate }));
    console.log(`quick play with Sugar Rush picked -> ${got.map}${got.private ? ' (private?!)' : ''}`);
    if (got.map !== 'candy') errors.push(`quick play landed on ${got.map}, not candy`);
  }
  await ctx.close();
}

// --- Matches: a private room, switching maps as the host -------------------------------------
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
watch(page, 'match');
await page.addInitScript(setup, quality);
await page.goto(url);
await page.waitForSelector('.menu .btn.big', { timeout: 60000 });
await page.waitForFunction(() => !document.getElementById('splash'), null, { timeout: 10000 }).catch(() => undefined);
await page.locator('#ui button:visible:has-text("PRIVATE ROOM")').first().click();
await page.waitForFunction(() => window.bubba?.game?.room?.isPrivate === true, null, { timeout: 60000 });
await inMatch(page);
await fakeLock(page);
console.log('room:', await page.evaluate(() => JSON.stringify({ code: window.bubba.game.room.code, private: window.bubba.game.room.isPrivate })));
const ids = (process.env.MAPS ?? '').split(',').filter(Boolean);
const list = ids.length ? ids : ['dealership', 'candy', 'garage', 'skatepark', 'bounceHouse', 'moonBase', 'pier'];
for (const id of list) {
  await page.waitForTimeout(1000);
  await page.evaluate((mapId) => window.bubba.net.send({ type: 'host', action: 'settings', settings: { mapId, bots: true } }), id);
  await page
    .waitForFunction((mapId) => window.bubba.game.map.id === mapId && window.bubba.game.pred.mode !== 4, id, { timeout: 45000 })
    .catch(async (e) => {
      console.log('stuck:', await page.evaluate(() => ({ map: window.bubba.game.map.id, mode: window.bubba.game.pred.mode, host: window.bubba.game.room?.hostId, you: window.bubba.game.youId })));
      throw e;
    });
  await page.waitForTimeout(2500);
  // Overview: a camera high above one corner looking at the middle, HUD hidden.
  const stats = await page.evaluate(async () => {
    const g = window.bubba.game;
    const r = window.bubba.renderer;
    g.__cam = g.__cam ?? g.updateCamera;
    g.updateCamera = function () {
      const cam = this.r.camera;
      // Inside the ring of clouds around the map (they start about 50 m out).
      cam.position.set(27, 29, 33);
      cam.lookAt(-2, -4, 0);
      cam.fov = 60;
      cam.updateProjectionMatrix();
      this.viewModel.root.visible = false;
    };
    document.getElementById('ui').style.visibility = 'hidden';
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    let meshes = 0;
    g.mapView.root.traverse((o) => { if ((o.isMesh || o.isPoints || o.isLine) && o.visible) meshes++; });
    const info = r.renderer.info;
    info.autoReset = false;
    info.reset();
    await new Promise((res) => requestAnimationFrame(res));
    const calls = info.render.calls;
    const tris = info.render.triangles;
    info.autoReset = true;
    return { meshes, calls, tris };
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/${id}-overview.png` });
  // A player's view: back in first person, looking toward the middle of the map.
  await page.evaluate(() => {
    const g = window.bubba.game;
    g.updateCamera = g.__cam;
    g.r.camera.fov = g.settings.fov;
    document.getElementById('ui').style.visibility = '';
    const p = g.pred;
    window.bubba.input.yaw = Math.atan2(-(0 - p.px), -(0 - p.pz));
    window.bubba.input.pitch = -0.05;
  });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/${id}-player.png` });
  console.log(`${id.padEnd(12)} map objects=${stats.meshes} frame draw calls=${stats.calls} triangles=${stats.tris}`);
}

console.log('errors:', errors.length ? '\n' + errors.slice(0, 30).join('\n') : 'none');
await browser.close();
