// Headless check of the gun builder (loadout screen) and the new weapons in a real match.
// Screenshots the builder with its live 3D gun view at desktop and phone sizes, saves / switches
// named builds, checks the 3D view frees its WebGL context, then fires every new weapon in first
// and third person.
// Usage: node scripts/smoke-builder.mjs [url] [outDir] [--no-match]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const url = args[0] ?? 'http://localhost:8080/';
const out = args[1] ?? 'test-results/builder';
const skipMatch = process.argv.includes('--no-match');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const errors = [];
const problems = [];
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) problems.push(what);
};

async function newPage(viewport, opts = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: !!opts.touch, hasTouch: !!opts.touch });
  const page = await ctx.newPage();
  await page.addInitScript(
    ({ quality, loadout }) => {
      localStorage.setItem('bubba.settings.v1', JSON.stringify({ quality }));
      if (loadout) localStorage.setItem('bubba.loadout.v1', JSON.stringify(loadout));
    },
    { quality: opts.quality ?? 'low', loadout: opts.loadout ?? null },
  );
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${viewport.width}x${viewport.height}: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  return { ctx, page };
}

async function openBuilder(page) {
  await page.waitForSelector('text=Loadout', { timeout: 60000 });
  // The menu can redraw while it loads (account, daily challenges): retry the click.
  for (let i = 0; i < 5; i++) {
    await page.click('button:has-text("Loadout")');
    try {
      await page.waitForSelector('.panel.builder', { timeout: 4000 });
      break;
    } catch {
      if (i === 4) throw new Error('the builder never opened');
    }
  }
  await page.waitForTimeout(1200);
}

/** Does the builder fit (no sideways scrolling, nothing sticking out)? */
async function layout(page) {
  return page.evaluate(() => {
    const panel = document.querySelector('.panel.builder');
    const r = panel.getBoundingClientRect();
    const canvas = document.querySelector('.gun-canvas');
    const cr = canvas?.getBoundingClientRect();
    let widest = 0;
    for (const e of panel.querySelectorAll('*')) widest = Math.max(widest, e.getBoundingClientRect().right);
    return {
      vw: innerWidth,
      vh: innerHeight,
      panel: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
      scrolls: panel.scrollHeight > panel.clientHeight + 2,
      overflowX: Math.round(Math.max(document.documentElement.scrollWidth - innerWidth, widest - innerWidth, panel.scrollWidth - panel.clientWidth)),
      canvas: cr ? [Math.round(cr.width), Math.round(cr.height)] : null,
      stats: document.querySelectorAll('.stat-row').length,
      weapons: document.querySelectorAll('.weapon-btn').length,
      partRows: document.querySelectorAll('.part-row').length,
    };
  });
}

// --- The builder at every size ------------------------------------------------------------------
const sizes = [
  { name: 'desktop-1366x768', viewport: { width: 1366, height: 768 } },
  { name: 'desktop-1280x800', viewport: { width: 1280, height: 800 }, quality: 'medium' },
  { name: 'phone-390x844', viewport: { width: 390, height: 844 }, touch: true },
  { name: 'phone-750x342', viewport: { width: 750, height: 342 }, touch: true },
];
for (const s of sizes) {
  const { ctx, page } = await newPage(s.viewport, s);
  await page.goto(url);
  await openBuilder(page);
  const l = await layout(page);
  console.log(s.name, JSON.stringify(l));
  check(l.overflowX <= 1, `${s.name}: nothing sticks out sideways`);
  check(l.weapons === 7 && l.partRows === 5 && l.stats >= 8, `${s.name}: 7 weapons, 5 part slots, stat bars`);
  check(!!l.canvas && l.canvas[0] >= 150 && l.canvas[1] >= 100, `${s.name}: 3D gun view is on screen (${l.canvas})`);
  await page.screenshot({ path: `${out}/builder-${s.name}.png` });
  if (s.touch) {
    // Scroll to the bottom and check the rest is reachable.
    await page.evaluate(() => document.querySelector('.panel.builder').scrollTo(0, 99999));
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${out}/builder-${s.name}-bottom.png` });
    // Drag the gun with a finger.
    const box = await page.locator('.gun-canvas').boundingBox();
    await page.evaluate(() => document.querySelector('.panel.builder').scrollTo(0, 0));
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  }
  await ctx.close();
}

// --- Using the builder (desktop) -----------------------------------------------------------------
{
  const { ctx, page } = await newPage({ width: 1280, height: 800 }, { quality: 'medium' });
  await page.goto(url);
  await openBuilder(page);
  await page.click('.weapon-btn:has-text("Bubble Shotgun")');
  await page.waitForTimeout(600);
  // Hovering a part previews what it changes.
  await page.hover('.part-btn:has-text("Stubby Barrel")');
  await page.waitForTimeout(700);
  const deltas = await page.evaluate(() => [...document.querySelectorAll('.stat-row.up, .stat-row.down, .stat-row.neutral')].map((r) => `${r.className.split(' ')[1]}:${r.querySelector('.stat-label').textContent}`));
  console.log('hover Stubby Barrel on the shotgun:', deltas.join(' '));
  check(deltas.some((d) => d.startsWith('down')) && deltas.length >= 2, 'hovering a part shows green / red changes');
  await page.screenshot({ path: `${out}/builder-hover-part.png` });
  await page.click('.part-btn:has-text("Stubby Barrel")');
  await page.click('.part-btn:has-text("Mini Tank")');
  await page.mouse.move(5, 5);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${out}/builder-after-change.png` });
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('bubba.loadout.v1')));
  check(saved.weapon === 'bubbleShotgun' && saved.parts.barrel === 'stubbyBarrel' && saved.parts.tank === 'miniTank', `loadout saved with parts (${JSON.stringify(saved.parts)})`);
  // Save as build 1 with a name, switch weapon, then load it back.
  const name = page.locator('.build-name').first();
  await name.fill('Brawler');
  await page.locator('.build-save').first().click();
  await page.click('.weapon-btn:has-text("Pop Gun")');
  await page.waitForTimeout(500);
  await page.locator('.build-save').nth(1).click();
  await page.locator('.build').first().click();
  await page.waitForTimeout(700);
  const builds = await page.evaluate(() => JSON.parse(localStorage.getItem('bubba.builds.v1')));
  const now = await page.evaluate(() => JSON.parse(localStorage.getItem('bubba.loadout.v1')));
  console.log('builds:', builds.map((b) => (b ? `${b.name}=${b.loadout.weapon}` : '-')).join(', '));
  check(builds[0]?.name === 'Brawler' && builds[0].loadout.weapon === 'bubbleShotgun' && builds[1]?.loadout.weapon === 'popGun', 'two named builds saved');
  check(now.weapon === 'bubbleShotgun' && now.parts.barrel === 'stubbyBarrel', 'clicking a build switches to it');
  check(await page.locator('.build.active').count() === 1, 'the build in use is highlighted');
  await page.screenshot({ path: `${out}/builder-builds.png` });
  // Spin the gun by dragging it.
  const box = await page.locator('.gun-canvas').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 20, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  await page.locator('.gun-view').screenshot({ path: `${out}/builder-gun-dragged.png` });
  // Every weapon in the 3D view, with some parts, for a look.
  for (const w of ['Balloon Mortar', 'Pop Gun', 'Pump Rifle']) {
    await page.click(`.weapon-btn:has-text("${w}")`);
    await page.waitForTimeout(700);
    await page.locator('.gun-view').screenshot({ path: `${out}/gun-${w.replace(/ /g, '-').toLowerCase()}.png` });
  }
  // Opening and closing the builder many times must not leak WebGL contexts.
  for (let i = 0; i < 20; i++) {
    await page.click('.btn.done-top');
    await page.waitForTimeout(60);
    await page.click('button:has-text("Loadout")');
    await page.waitForSelector('.gun-canvas');
  }
  await page.waitForTimeout(800);
  const live = await page.evaluate(() => {
    const c = document.querySelector('.gun-canvas');
    const gl = c.getContext('webgl2') ?? c.getContext('webgl');
    return { canvases: document.querySelectorAll('.gun-canvas').length, lost: gl ? gl.isContextLost() : 'no-gl' };
  });
  check(live.canvases === 1 && live.lost === false, `builder reopened 20x: one live 3D view (${JSON.stringify(live)})`);
  await page.locator('.gun-view').screenshot({ path: `${out}/builder-after-reopen.png` });
  await page.click('.btn.done-top');
  check(!errors.some((e) => /too many active webgl|context lost/i.test(e)), 'no WebGL context warnings');
  await ctx.close();
}

// --- The new weapons in a match -----------------------------------------------------------------
if (!skipMatch) {
  const weapons = [
    { id: 'bubbleShotgun', hold: 450 },
    { id: 'balloonMortar', hold: 800 },
    { id: 'popGun', hold: 900 },
  ];
  for (const w of weapons) {
    const { ctx, page } = await newPage({ width: 1280, height: 800 }, { loadout: { weapon: w.id, parts: { barrel: 'standard' }, utils: ['bouncePad', 'airGrenade'] } });
    await page.goto(url);
    await page.waitForSelector('.btn.big', { timeout: 60000 });
    await page.click('text=PRIVATE ROOM');
    await page.waitForFunction(() => window.bubba?.game?.active && window.bubba.game.pred.mode !== 4, null, { timeout: 60000 });
    await page.evaluate(() => {
      const b = window.bubba;
      b.input.locked = true;
      b.input.enabled = true;
      document.querySelectorAll('.click-to-play').forEach((e) => e.remove());
    });
    await page.waitForTimeout(2500);
    const aim = () =>
      page.evaluate(() => {
        // Face the nearest bot.
        const g = window.bubba.game;
        const p = g.pred;
        let best = null;
        for (const rv of g.remotes.values()) {
          const c = rv.cur;
          if (!c || c.mode === 4) continue;
          const d = Math.hypot(c.px - p.px, c.pz - p.pz);
          if (!best || d < best.d) best = { d, c };
        }
        if (!best) return null;
        const dx = best.c.px - p.px;
        const dz = best.c.pz - p.pz;
        window.bubba.input.yaw = Math.atan2(-dx, -dz);
        window.bubba.input.pitch = Math.atan2(best.c.py + 1 - (p.py + 1.85), best.d) + (g.weapon.projGravity > 0 ? -0.25 : 0);
        return Math.round(best.d);
      });
    for (const view of ['first', 'third']) {
      if (view === 'third') {
        await page.keyboard.press('KeyV');
        await page.waitForTimeout(800);
      }
      const d = await aim();
      await page.evaluate(() => window.bubba.input.press('Mouse0'));
      await page.waitForTimeout(w.hold);
      if (w.id !== 'bubbleShotgun') await page.screenshot({ path: `${out}/${w.id}-${view}-holding.png` });
      await page.evaluate(() => window.bubba.input.release('Mouse0'));
      await page.waitForTimeout(w.id === 'balloonMortar' ? 450 : 90);
      await page.screenshot({ path: `${out}/${w.id}-${view}-fired.png` });
      console.log(`${w.id} ${view} person: target ${d} m, ammo ${await page.evaluate(() => window.bubba.game.pred.ammo)}`);
      await page.waitForTimeout(1500);
    }
    const shots = await page.evaluate(() => window.bubba.game.weapon.id);
    check(shots === w.id, `${w.id}: spawned with the weapon from the saved loadout`);
    await ctx.close();
  }
}

console.log('errors:', errors.length ? '\n' + errors.slice(0, 20).join('\n') : 'none');
console.log(problems.length ? `PROBLEMS:\n${problems.join('\n')}` : 'all checks passed');
await browser.close();
process.exit(problems.length ? 1 : 0);
