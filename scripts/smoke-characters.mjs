// Character bodies check: opens the Locker's Bodies tab, tries on every body (the four characters
// and the shapes), and screenshots the 3D preview from the front and the side.
// Usage: node scripts/smoke-characters.mjs [url] [outDir]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:8080/';
const out = process.argv[3] ?? 'test-results/characters';
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
await page.waitForSelector('.account-chip .chip-main', { timeout: 60000 });
await page.click('text=Locker');
await page.waitForSelector('.item-grid .item');
await page.click('.locker .tab:has-text("Bodies")');
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/0-bodies-tab.png` });
const names = ['BOR', 'ABAG', 'SOL', 'KESTY', 'Chonk', 'Noodle', 'Big Head'];
const box = await page.locator('.preview-canvas').boundingBox();
for (const n of names) {
  await page.click(`.item-grid .item:has-text("${n}")`);
  await page.waitForTimeout(1200);
  await page.locator('.preview-canvas').screenshot({ path: `${out}/${n.replace(' ', '')}-a.png` });
  // Spin it a quarter turn for a side view.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(700);
  await page.locator('.preview-canvas').screenshot({ path: `${out}/${n.replace(' ', '')}-b.png` });
}
const worn = await page.evaluate(() => window.bubba.account.profile.cosmetics.body);
console.log(JSON.stringify({ worn }));
console.log('errors:', errors.length ? errors.join('\n') : 'none');
await browser.close();
