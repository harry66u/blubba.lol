// Ult check in a real browser: joins a match, then for each ult fills the meter (debug action),
// lines the bots up in front, pops it and takes screenshots as it plays out (waiting on the game
// state, since software-rendered frames are slow). Then fills every bot's meter to catch other
// players' ults (kill feed, world popups). Needs the server running with BUBBA_DEBUG=1.
// Usage: [QUALITY=medium] [VIEW=1280x720] [THIRD=1] node scripts/playtest-ults.mjs [url] [outDir] [ults]
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:8080/';
const out = process.argv[3] ?? 'test-results/ults';
const only = (process.argv[4] ?? 'bigBlow,juice,chase,cropDuster,robot').split(',');
const ULTS = ['bigBlow', 'juice', 'chase', 'cropDuster', 'robot'];
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const errors = [];
const [vw, vh] = (process.env.VIEW ?? '1280x720').split('x').map(Number);
const page = await browser.newPage({ viewport: { width: vw, height: vh } });
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
await page.addInitScript(
  ([q, third]) => {
    if (!localStorage.getItem('bubba.settings.v1')) localStorage.setItem('bubba.settings.v1', JSON.stringify({ quality: q, thirdPerson: third }));
  },
  [process.env.QUALITY ?? 'medium', process.env.THIRD === '1'],
);
await page.goto(url);
// A private room with three bots: busy enough to show everything, calm enough to see it.
await page.waitForSelector('text=PRIVATE ROOM', { timeout: 60000 });
await page.click('text=PRIVATE ROOM');
await page.waitForFunction(() => window.bubba?.game?.active, null, { timeout: 60000 });
await page.evaluate(() => window.bubba.net.send({ type: 'host', action: 'settings', settings: { bots: false, events: 'off' } }));
await page.waitForTimeout(500);
await page.evaluate(() => window.bubba.net.send({ type: 'debug', action: 'bots', count: 3 }));
// Private rooms wait in the lobby until the host starts.
await page.waitForTimeout(500);
await page.evaluate(() => window.bubba.net.send({ type: 'host', action: 'start' }));
await page.waitForFunction(() => window.bubba.game.pred.mode !== 4 && window.bubba.game.match.phase === 'playing', null, { timeout: 60000 });
await page.evaluate(() => {
  const b = window.bubba;
  b.input.locked = true;
  b.input.enabled = true;
  document.querySelectorAll('.click-to-play').forEach((e) => e.remove());
  // Log every ult event this client sees.
  const g = b.game;
  window.__ults = [];
  const orig = g.handleEvent.bind(g);
  g.handleEvent = (e, imm) => {
    if (['ult', 'fart', 'sniff', 'gotcha'].includes(e.t)) window.__ults.push(`${e.t}:${e.kind ?? ''} by ${g.roster.get(e.id)?.name ?? e.id}${e.targets?.length ? ` -> ${e.targets.map((t) => g.roster.get(t)?.name).join(',')}` : ''}`);
    return orig(e, imm);
  };
});
await page.waitForTimeout(1500);

const shot = (name) => page.screenshot({ path: `${out}/${name}.png` });
const debug = (msg) => page.evaluate((m) => window.bubba.net.send({ type: 'debug', ...m }), msg);
/** Waits until an expression on the predicted state `p` is true (or gives up quietly). */
const until = (expr, timeout = 8000) =>
  page.waitForFunction((e) => new Function('p', 'g', `return (${e});`)(window.bubba.game.pred, window.bubba.game), expr, { timeout, polling: 30 }).then(
    () => true,
    () => false,
  );
/** Turns to face the nearest living bot (optionally aiming at its feet) and returns its distance. */
const aimNearest = (feet = false) =>
  page.evaluate((feet) => {
    const g = window.bubba.game;
    const inp = window.bubba.input;
    const p = g.pred;
    const eye = { x: p.px, y: p.py + 1.85 * (1 + 0.75 * p.inflation), z: p.pz };
    let best = null;
    for (const rv of g.remotes.values()) {
      const c = rv.cur;
      if (!c || c.mode === 4) continue;
      const d = Math.hypot(c.px - eye.x, c.pz - eye.z);
      if (!best || d < best.d) best = { c, d };
    }
    if (!best) return -1;
    const c = best.c;
    const ty = feet ? c.py + 0.3 : c.py + 1.1;
    inp.yaw = Math.atan2(-(c.px - eye.x), -(c.pz - eye.z));
    inp.pitch = Math.atan2(ty - eye.y, best.d);
    return best.d;
  }, feet);
const tap = (code, ms = 80) =>
  page.evaluate(
    ([c, ms]) => {
      const inp = window.bubba.input;
      inp.press(c);
      setTimeout(() => inp.release(c), ms);
    },
    [code, ms],
  );

/** Freezes (or releases) the full-screen ult splash so a slow software-rendered frame can catch it. */
const pinSplash = (at) =>
  page.evaluate((at) => {
    for (const a of document.querySelector('.ult-splash').getAnimations({ subtree: true })) {
      if (at === null) a.play();
      else {
        a.pause();
        a.currentTime = at;
      }
    }
  }, at);

await page.waitForTimeout(2500);
await shot('00-meter-filling');

/** Pops one ult and screenshots it. False if we got knocked out before it went off. */
async function tryUlt(kind) {
  await until('p.mode !== 4', 15000);
  await debug({ action: 'gather' });
  await debug({ action: 'ult', kind });
  await until(`p.ult >= 1 && p.ultKind === ${ULTS.indexOf(kind)}`);
  await page.waitForTimeout(300);
  await aimNearest(kind === 'bigBlow');
  await shot(`${kind}-0-ready`);
  await tap('KeyX');
  const popped = await until('p.ult < 0.5');
  console.log(`${kind}: popped=${popped}`);
  if (!popped) return false;
  if (await until("document.querySelector('.ult-splash.go') !== null", 3000)) {
    await pinSplash(450);
    await shot(`${kind}-splash`);
    await pinSplash(null);
  }
  if (kind === 'bigBlow') {
    await until('p.ultArmed > 0');
    await page.waitForTimeout(250);
    await shot(`${kind}-1-loaded`);
    await aimNearest(true);
    await tap('Mouse0', 60);
    await until('p.ultArmed === 0');
    await shot(`${kind}-2-fired`);
    await until('[...g.effects.projectiles.values()].every((q) => q.r < 1)', 3000);
    await shot(`${kind}-3-boom`);
  } else if (kind === 'juice') {
    await until('p.juiceTimer < 7.5');
    await shot(`${kind}-2-jab`);
    await until('p.juiceTimer < 6.6');
    await shot(`${kind}-3-flex`);
    await aimNearest();
    await until('p.juiceTimer < 4');
    await shot(`${kind}-4-jacked`);
  } else if (kind === 'chase') {
    await until('p.chaseTarget >= 0');
    await page.waitForTimeout(400);
    await aimNearest();
    await shot(`${kind}-2-locked`);
    await until('p.chaseTimer < 3.5');
    await aimNearest();
    await shot(`${kind}-3-hunting`);
  } else if (kind === 'cropDuster') {
    await shot(`${kind}-1-bent`);
    await until('p.fartTimer < 0.62');
    await shot(`${kind}-2-blast`);
    await until('p.fartTimer === 0');
    await page.waitForTimeout(400);
    await shot(`${kind}-3-cloud`);
  } else if (kind === 'robot') {
    await shot(`${kind}-1-scan`);
    await until('p.robotTimer < 1.4');
    await shot(`${kind}-2-rockets`);
    await until('p.robotTimer < 0.5');
    await shot(`${kind}-3-barrage`);
  }
  await page.waitForTimeout(1500);
  return true;
}

for (const kind of only) {
  for (let attempt = 0; attempt < 3; attempt++) if (await tryUlt(kind)) break;
}

// Everyone else's ults: line the bots up, fill every meter and watch them use theirs.
await debug({ action: 'gather' });
await debug({ action: 'ult', all: true });
for (let i = 0; i < 5; i++) {
  await page.waitForTimeout(1200);
  await aimNearest();
  await shot(`others-${i}`);
}

const log = await page.evaluate(() => window.__ults);
console.log('ult events seen:\n ', log.join('\n  '));
writeFileSync(`${out}/log.txt`, `${log.join('\n')}\n\nerrors:\n${errors.join('\n')}\n`);
console.log(errors.length ? `console errors:\n${errors.join('\n')}` : 'no console errors');
await browser.close();
