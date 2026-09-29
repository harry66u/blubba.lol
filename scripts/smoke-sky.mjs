// Screenshots of the sky scenery and map branding: the main menu background, then first-person
// views looking out from a few spots on every knockout map, at each quality level. Also counts
// draw calls and triangles for the scene (the camera turned all the way around, so moving sky
// things don't skew it) and flags console errors.
// Usage: node scripts/smoke-sky.mjs [url] [outDir] [qualities] [maps]
//   qualities: comma list of low,medium,high (default: low,medium)
//   maps: comma list of map ids (default: every knockout map)
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:8080/';
const out = process.argv[3] ?? 'test-results/sky';
const qualities = (process.argv[4] || 'low,medium').split(',').filter(Boolean);
const onlyMaps = (process.argv[5] ?? '').split(',').filter(Boolean);
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const errors = [];
const stats = [];

/** Draw calls and triangles for one plain render of the scene, the camera turned to 8 headings. */
const measure = (page) =>
  page.evaluate(() => {
    const { renderer: r } = window.bubba;
    const cam = r.camera;
    const saved = cam.quaternion.clone();
    const pos = cam.position.clone();
    const info = r.renderer.info;
    const mv = window.bubba.game.mapView;
    // The sky scenery and branding (when this build has them), to count their share on their own.
    const extras = [mv.sky?.root, mv.brand?.root].filter(Boolean);
    let calls = 0;
    let tris = 0;
    let maxCalls = 0;
    let own = 0;
    let ownTris = 0;
    for (let k = 0; k < 8; k++) {
      cam.rotation.set(0.12, (k / 8) * Math.PI * 2, 0);
      cam.updateMatrixWorld();
      info.reset();
      r.renderer.render(r.scene, cam);
      const all = info.render.calls;
      const allTris = info.render.triangles;
      calls += all;
      tris += allTris;
      maxCalls = Math.max(maxCalls, all);
      const shown = extras.map((o) => o.visible);
      for (const o of extras) o.visible = false;
      info.reset();
      r.renderer.render(r.scene, cam);
      own += all - info.render.calls;
      ownTris += allTris - info.render.triangles;
      extras.forEach((o, i) => (o.visible = shown[i]));
    }
    cam.quaternion.copy(saved);
    cam.position.copy(pos);
    return {
      calls: Math.round(calls / 8),
      maxCalls,
      tris: Math.round(tris / 8),
      skyCalls: Math.round(own / 8),
      skyTris: Math.round(ownTris / 8),
      textures: info.memory.textures,
    };
  });

for (const q of qualities) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.addInitScript((quality) => {
    try {
      localStorage.setItem('bubba.settings.v1', JSON.stringify({ quality }));
    } catch {
      // ignore
    }
  }, q);
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`[${q}] ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`[${q}] [pageerror] ${e.message}`));
  await page.goto(url);
  await page.waitForSelector('.menu .btn.big', { timeout: 60000 });
  await page.waitForFunction(() => !document.getElementById('splash'), null, { timeout: 10000 }).catch(() => undefined);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}/${q}-menu-1.png`, timeout: 120000 });
  await page.waitForTimeout(6000);
  await page.screenshot({ path: `${out}/${q}-menu-2.png`, timeout: 120000 });
  stats.push({ q, where: 'menu', ...(await measure(page)) });

  // A private room (so we can pick the map), then views from fixed spots with the camera held.
  await page.locator('#ui button:visible:has-text("PRIVATE ROOM")').first().click();
  await page.waitForFunction(() => window.bubba?.game?.active && window.bubba.game.room?.isPrivate, null, { timeout: 90000 });
  // No bots: nothing in the way of the views (and no callouts over them).
  await page.evaluate(() => window.bubba.net.send({ type: 'host', action: 'settings', settings: { bots: false } }));
  await page.evaluate(() => {
    const b = window.bubba;
    b.input.locked = true;
    b.input.enabled = true;
    document.querySelectorAll('.click-to-play').forEach((e) => e.remove());
    const r = b.renderer;
    const render = r.render.bind(r);
    // While __view is set, every frame is drawn from that spot instead of the player's eyes.
    r.render = () => {
      const v = window.__view;
      if (v) {
        r.camera.position.set(v.x, v.y, v.z);
        r.camera.rotation.set(v.pitch, v.yaw, 0);
        r.camera.updateMatrixWorld();
      }
      render();
    };
  });
  const mapIds = onlyMaps.length ? onlyMaps : ['dealership', 'garage', 'bounceHouse', 'pier'];
  for (const id of mapIds) {
    // (Resent a few times: a settings change right after another one can be dropped.)
    for (let k = 0; k < 6; k++) {
      await page.evaluate((mapId) => window.bubba.net.send({ type: 'host', action: 'settings', settings: { mapId } }), id);
      const ok = await page.waitForFunction((mapId) => window.bubba.game.map.id === mapId, id, { timeout: 5000 }).then(() => true, () => false);
      if (ok) break;
    }
    await page.waitForTimeout(1500);
    // Spots: the middle of the main deck and two of its edges, eyes 1.7 m up, turned all around.
    const spots = await page.evaluate(() => {
      const m = window.bubba.game.map;
      const deck = m.solids.filter((s) => s.kind !== 'hidden').sort((a, b) => (b.max[0] - b.min[0]) * (b.max[2] - b.min[2]) - (a.max[0] - a.min[0]) * (a.max[2] - a.min[2]))[0];
      const y = deck.max[1] + 1.7;
      return [
        { name: 'mid', x: 0, y, z: 0 },
        { name: 'north', x: 0, y, z: deck.min[2] + 2 },
        { name: 'east', x: deck.max[0] - 2, y, z: 0 },
      ];
    });
    const views = [
      { spot: 'mid', dir: 'n', yaw: 0 },
      { spot: 'mid', dir: 'e', yaw: -Math.PI / 2 },
      { spot: 'mid', dir: 's', yaw: Math.PI },
      { spot: 'mid', dir: 'w', yaw: Math.PI / 2 },
      { spot: 'north', dir: 'n', yaw: 0.35 },
      { spot: 'east', dir: 'e', yaw: -Math.PI / 2 - 0.3 },
    ];
    for (const v of views) {
      const s = spots.find((p) => p.name === v.spot);
      await page.evaluate((view) => (window.__view = view), { x: s.x, y: s.y, z: s.z, yaw: v.yaw, pitch: 0.08 });
      await page.waitForTimeout(700);
      await page.screenshot({ path: `${out}/${q}-${id}-${v.spot}-${v.dir}.png`, timeout: 120000 });
    }
    await page.evaluate((y) => (window.__view = { x: 0, y, z: 0, yaw: 0, pitch: 0 }), spots[0].y);
    await page.waitForTimeout(300);
    stats.push({ q, where: id, ...(await measure(page)) });
    await page.evaluate(() => (window.__view = null));
  }
  await ctx.close();
}

for (const s of stats) {
  console.log(
    `${s.q.padEnd(6)} ${s.where.padEnd(12)} calls avg ${String(s.calls).padStart(4)} max ${String(s.maxCalls).padStart(4)}  tris ${String(s.tris).padStart(7)}  ` +
      `sky+brand calls ${String(s.skyCalls).padStart(3)} tris ${String(s.skyTris).padStart(6)}  textures ${s.textures}`,
  );
}
console.log('errors:', errors.length ? '\n' + errors.slice(0, 20).join('\n') : 'none');
await browser.close();
