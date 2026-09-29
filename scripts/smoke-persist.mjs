// Checks accounts survive a server restart with a wiped disk (the Postgres copy, DATABASE_URL).
// Step 1 signs up in the browser and earns coins; step 2 (after you restart the server with a new
// empty BUBBA_DB and the same DATABASE_URL) logs in from a fresh browser and checks everything.
// Needs the server running with BUBBA_DEBUG=1 (for /api/debug/grant).
// Usage: node scripts/smoke-persist.mjs signup|login [url] [stateFile]
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync } from 'node:fs';

const step = process.argv[2];
const url = process.argv[3] ?? 'http://localhost:8080/';
const stateFile = process.argv[4] ?? 'test-results/persist-state.json';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const errors = [];
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
await page.goto(url);
await page.waitForSelector('.account-chip .chip-main', { timeout: 30000 });

async function openAccount(tab) {
  await page.click('.account-chip button:has-text("Sign up / Log in")');
  await page.waitForSelector('.account-panel');
  await page.click(`.account-panel .tab:has-text("${tab}")`);
}

let result;
if (step === 'signup') {
  const name = `Keeper${Math.floor(Math.random() * 90000 + 10000)}`;
  const password = 'staying-power';
  await openAccount('Sign up');
  await page.fill('.account-panel input[aria-label="Name"]', name);
  const pw = page.locator('.account-panel input[type="password"]');
  await pw.nth(0).fill(password);
  await pw.nth(1).fill(password);
  await page.click('text=CREATE ACCOUNT');
  await page.waitForSelector('.recovery-code', { timeout: 10000 });
  const recovery = (await page.textContent('.recovery-code')).trim();
  await page.click('text=I SAVED IT');
  const token = await page.evaluate(async () => {
    const a = window.bubba.account;
    await fetch('/api/debug/grant', { method: 'POST', headers: { authorization: `Bearer ${a.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ coins: 777, xp: 900 }) });
    await a.refresh();
    return a.token;
  });
  const profile = await page.evaluate(() => ({ coins: window.bubba.account.profile.coins, level: window.bubba.account.profile.level }));
  writeFileSync(stateFile, JSON.stringify({ name, password, recovery, token, profile }));
  result = { step, name, profile };
} else {
  const saved = JSON.parse(readFileSync(stateFile, 'utf8'));
  // The old session token still works...
  const me = await page.evaluate(async (t) => (await (await fetch('/api/me', { headers: { authorization: `Bearer ${t}` } })).json()).account?.name ?? null, saved.token);
  // ...and logging in from a new browser brings back the same progress.
  await openAccount('Log in');
  await page.fill('.account-panel input[aria-label="Name"]', saved.name);
  await page.locator('.account-panel input[type="password"]').nth(0).fill(saved.password);
  await page.click('.account-panel button[type="submit"]');
  await page.waitForFunction(() => window.bubba.account.account, null, { timeout: 10000 });
  await page.waitForTimeout(500);
  const profile = await page.evaluate(() => ({ coins: window.bubba.account.profile.coins, level: window.bubba.account.profile.level }));
  const same = profile.coins === saved.profile.coins && profile.level === saved.profile.level;
  result = { step, name: saved.name, oldTokenStillLoggedIn: me === saved.name, profile, same };
  if (!same || me !== saved.name) process.exitCode = 1;
}
console.log(JSON.stringify(result));
console.log('errors:', errors.length ? errors.join('\n') : 'none');
if (errors.length) process.exitCode = 1;
await browser.close();
