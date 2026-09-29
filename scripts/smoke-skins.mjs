// Headless check of skin customization: the locker (new slots, NEW badges, level locks, try-on,
// randomize) on desktop and on a phone held sideways, and a match where another player shows off
// a trail and a new hat. Needs the server running with BUBBA_DEBUG=1 (for /api/debug/grant).
// Usage: node scripts/smoke-skins.mjs [url] [outDir]
import { chromium, devices } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:8080/';
const out = process.argv[3] ?? 'test-results/skins';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const errors = [];
async function newPage(ctxOpts, settings = {}) {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  await page.addInitScript((s) => { try { localStorage.setItem('bubba.settings.v1', JSON.stringify(s)); } catch {} }, { quality: 'medium', ...settings });
  await page.goto(url);
  await page.waitForSelector('.account-chip .chip-main', { timeout: 30000 });
  return page;
}
const shot = (page, name) => page.screenshot({ path: `${out}/${name}.png` });
const fakeLock = (page) => page.evaluate(() => { const b = window.bubba; b.input.locked = true; b.input.enabled = true; document.querySelectorAll('.click-to-play').forEach((e) => e.remove()); });

/** Makes an account with coins and XP (level 10), buys some items and wears a look. */
async function dressUp(page, name, look, buy) {
  await page.evaluate(async ({ name, look, buy }) => {
    const a = window.bubba.account;
    await a.register(name, 'password123');
    await fetch('/api/debug/grant', { method: 'POST', headers: { authorization: `Bearer ${a.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ coins: 6000, xp: 2750 }) });
    await a.refresh();
    for (const id of buy) await a.buy(id);
    await a.equip(look);
  }, { name, look, buy });
}

const tag = Math.floor(Math.random() * 9000 + 1000);
const showoff = { color: 'color.5', accent: 'accent.14', pattern: 'pattern.flames', face: 'face.tongue', eyes: 'eyes.star', hat: 'hat.cowboy', base: 'base.rocket', trail: 'trail.rainbow', taunt: 'taunt.backflip' };
const bought = ['accent.14', 'pattern.flames', 'eyes.star', 'hat.cowboy', 'base.rocket', 'trail.rainbow', 'taunt.backflip', 'hat.wizard', 'trail.hearts'];

// --- Desktop locker ---------------------------------------------------------------------------
const page = await newPage({ viewport: { width: 1280, height: 720 } });
await dressUp(page, `Skins${tag}`, showoff, bought);
await page.click('text=Locker');
await page.waitForSelector('.item-grid .item');
await page.waitForTimeout(1200);
console.log('new badges on first open:', await page.locator('.item-grid .new-badge').count(), '| category dots:', await page.locator('.locker-cats .new-dot:not(.hidden)').count());
await shot(page, 'desktop-1-colors');
for (const [tab, name, wait] of [['Accents', 'desktop-2-accents', 600], ['Patterns', 'desktop-3-patterns', 600], ['Eyes', 'desktop-4-eyes', 600], ['Hats', 'desktop-5-hats', 600], ['Bases', 'desktop-6-bases', 600], ['Trails', 'desktop-7-trails', 1450], ['Weapon finishes', 'desktop-8-finishes', 600], ['Taunts', 'desktop-9-taunts', 400], ['Knockout effects', 'desktop-10-ko', 400]]) {
  await page.click(`.locker .cat:has-text("${tab}")`);
  await page.waitForTimeout(wait);
  await shot(page, name);
}
// A level reward you can't have yet, and trying on something you don't own.
await page.click('.locker .cat:has-text("Weapon finishes")');
await page.click('.item-grid .item:has-text("Diamond")');
console.log('level-locked note:', await page.textContent('.locker-note'));
await page.click('.locker .cat:has-text("Hats")');
await page.click('.item-grid .item:has-text("Unicorn Horn")');
await page.waitForTimeout(700);
console.log('try-on status:', await page.textContent('.item-grid .item.trying .status'));
await shot(page, 'desktop-11-try-on');
await page.click('.locker .cat:has-text("Taunts")');
await page.click('.item-grid .item:has-text("Backflip")');
await page.waitForTimeout(450);
await shot(page, 'desktop-12-taunt');
await page.click('.locker .randomize');
await page.waitForTimeout(900);
console.log('randomized to:', JSON.stringify(await page.evaluate(() => window.bubba.account.profile.cosmetics)));
await shot(page, 'desktop-13-randomized');
await page.click('text=DONE');
await page.click('text=Locker');
await page.waitForSelector('.item-grid .item');
console.log('new badges on second open:', await page.locator('.item-grid .new-badge').count());
await page.click('text=DONE');
// Put the show-off look back on for the match.
await page.evaluate((look) => window.bubba.account.equip(look), showoff);

// --- Phone held sideways ----------------------------------------------------------------------
const phone = await newPage({ ...devices['iPhone 13 landscape'] });
await dressUp(phone, `Phone${tag}`, { hat: 'hat.bunny', trail: 'trail.hearts', base: 'base.duck', accent: 'accent.8', pattern: 'pattern.hearts' }, ['hat.bunny', 'trail.hearts', 'base.duck', 'pattern.hearts']);
await phone.tap('text=Locker');
await phone.waitForSelector('.item-grid .item');
await phone.waitForTimeout(1200);
await shot(phone, 'phone-1-locker');
await phone.tap('.locker .cat:has-text("Trails")');
await phone.waitForTimeout(1400);
await shot(phone, 'phone-2-trails');
await phone.tap('.locker .cat:has-text("Hats")');
await phone.waitForTimeout(500);
await phone.evaluate(() => document.querySelector('.item-grid').scrollTo(0, 400));
await phone.waitForTimeout(300);
await shot(phone, 'phone-3-hats-scrolled');
const fits = await phone.evaluate(() => {
  const r = document.querySelector('.panel.locker').getBoundingClientRect();
  const done = document.querySelector('.locker .done-top').getBoundingClientRect();
  return { panel: [Math.round(r.width), Math.round(r.height)], screen: [innerWidth, innerHeight], doneVisible: done.bottom <= innerHeight && done.right <= innerWidth, scrollW: document.documentElement.scrollWidth };
});
console.log('phone locker fits:', JSON.stringify(fits));
await phone.tap('text=DONE');
const portrait = await newPage({ ...devices['iPhone 13'] });
await portrait.tap('text=Locker');
await portrait.waitForSelector('.item-grid .item');
await portrait.waitForTimeout(1000);
await shot(portrait, 'phone-4-portrait');
await portrait.context().close();
await phone.context().close();

// --- A match: someone with a trail and a new hat ----------------------------------------------
// The show-off player (desktop page) joins first; an observer joins the same public room and
// watches them dash sideways.
await page.click('.btn.big');
await page.waitForFunction(() => window.bubba?.game?.active && window.bubba.game.pred.mode !== 4, null, { timeout: 60000 });
const code = await page.evaluate(() => window.bubba.game.room?.code);
const observer = await newPage({ viewport: { width: 1280, height: 720 } });
await observer.evaluate(() => window.bubba.account.refresh());
await observer.click('.btn.big');
await observer.waitForFunction(() => window.bubba?.game?.active && window.bubba.game.pred.mode !== 4, null, { timeout: 60000 });
const code2 = await observer.evaluate(() => window.bubba.game.room?.code);
console.log('rooms:', code, code2);
await fakeLock(page);
await fakeLock(observer);
const showId = await page.evaluate(() => window.bubba.game.youId);
let shots = 0;
for (let i = 0; i < 14 && shots < 4; i++) {
  const [a, b] = await Promise.all([observer.evaluate(() => { const p = window.bubba.game.pred; return [p.px, p.py, p.pz]; }), page.evaluate(() => { const p = window.bubba.game.pred; return [p.px, p.py, p.pz]; })]);
  const dist = Math.hypot(b[0] - a[0], b[2] - a[2]);
  if (dist > 40) {
    // Too far to see: walk the show-off toward the observer first.
    await page.evaluate(([ax, az, bx, bz]) => { window.bubba.input.yaw = Math.atan2(-(ax - bx), -(az - bz)); }, [a[0], a[2], b[0], b[2]]);
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(900);
    await page.keyboard.up('KeyW');
    continue;
  }
  // Observer looks at the show-off; the show-off faces the observer and dashes sideways.
  await observer.evaluate(([ax, ay, az, bx, by, bz]) => { const inp = window.bubba.input; inp.yaw = Math.atan2(-(bx - ax), -(bz - az)); inp.pitch = Math.atan2(by + 1.2 - (ay + 1.6), Math.hypot(bx - ax, bz - az)); }, [...a, ...b]);
  await page.evaluate(([ax, az, bx, bz]) => { window.bubba.input.yaw = Math.atan2(-(ax - bx), -(az - bz)); }, [a[0], a[2], b[0], b[2]]);
  const side = i % 2 ? 'KeyA' : 'KeyD';
  await page.keyboard.down(side);
  await page.waitForTimeout(120);
  await page.keyboard.press('ShiftLeft');
  await page.keyboard.press('Space');
  await observer.waitForTimeout(220);
  const seen = await observer.evaluate((id) => { const rv = window.bubba.game.remotes.get(id); return !!rv && rv.man.group.visible; }, showId);
  await shot(observer, `match-${String(i).padStart(2, '0')}`);
  if (seen) shots++;
  await page.keyboard.up(side);
  await page.waitForTimeout(500);
}
// The show-off's own view in third person, taunting.
await page.evaluate(() => { const b = window.bubba; b.settings.thirdPerson = true; });
await page.keyboard.press('KeyT');
await page.waitForTimeout(350);
await shot(page, 'match-self-taunt');
await page.keyboard.down('KeyW');
await page.keyboard.press('ShiftLeft');
await page.waitForTimeout(180);
await shot(page, 'match-self-dash');
await page.keyboard.up('KeyW');
console.log('roster cosmetics seen by observer:', JSON.stringify(await observer.evaluate((id) => window.bubba.game.roster.get(id)?.cos, showId)));

console.log('errors:', errors.length ? errors.slice(0, 10).join(' | ') : 'none');
await browser.close();
