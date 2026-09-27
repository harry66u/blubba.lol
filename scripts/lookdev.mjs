// Screenshot of the ?lookdev lineup (tube men at 0-100% inflation) for judging the look.
// Usage: QUALITY=medium node scripts/lookdev.mjs [url] [outDir] [label]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:8080/';
const out = process.argv[3] ?? 'test-results/lookdev';
const label = process.argv[4] ?? 'shot';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(url);
await page.evaluate((q) => { try { localStorage.setItem('bubba.settings.v1', JSON.stringify({ quality: q })); } catch {} }, process.env.QUALITY ?? 'medium');
await page.goto(new URL(`/?lookdev=${process.env.VIEW ?? ''}`, url).href);
await page.waitForTimeout(6000);
await page.screenshot({ path: `${out}/${label}.png` });
console.log('errors:', errors.length ? errors.slice(0, 5).join(' | ') : 'none');
await browser.close();
