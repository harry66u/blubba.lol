// Full-match playtest in a real browser. An autopilot plays your character against the bots the
// way a person would (turns toward targets at a human rate, leads shots, charges, strafes, stays
// away from edges, recovers when knocked off, uses abilities and utilities, tries third person),
// while every game event is logged. Ends the match early to see the final 30 seconds and results.
// Needs the server running with BUBBA_DEBUG=1.
// Usage: [QUALITY=low] [VIEW=1100x700] node scripts/playtest.mjs [url] [outDir] [seconds]
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:8080/';
const out = process.argv[3] ?? 'test-results/playtest';
const PLAY_SECONDS = Number(process.argv[4] ?? 150);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const errors = [];
const [vw, vh] = (process.env.VIEW ?? '1100x700').split('x').map(Number);
const page = await browser.newPage({ viewport: { width: vw, height: vh } });
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
await page.addInitScript((q) => {
  if (!localStorage.getItem('bubba.settings.v1')) localStorage.setItem('bubba.settings.v1', JSON.stringify({ quality: q }));
}, process.env.QUALITY ?? 'low');

await page.goto(url);
await page.waitForSelector('.mode-picker button[data-mode="knockout"]', { timeout: 60000 });
await page.click('.mode-picker button[data-mode="knockout"]');
await page.click('.btn.big');
await page.waitForFunction(() => window.bubba?.game?.active && window.bubba.game.pred.mode !== 4, null, { timeout: 60000 });
await page.evaluate(() => { const b = window.bubba; b.input.locked = true; b.input.enabled = true; document.querySelectorAll('.click-to-play').forEach((e) => e.remove()); });
await page.waitForTimeout(500);

// --- In-page autopilot and event log --------------------------------------------------------
await page.evaluate(() => {
  const B = window.bubba;
  const g = B.game;
  const inp = B.input;
  const pt = (window.__pt = {
    t0: performance.now(),
    log: [],
    s: { shots: 0, myHits: 0, myDirect: 0, gotHit: 0, myKOs: 0, deaths: 0, falls: 0, chaos: [], chains: 0, crowns: 0, braces: 0, grabs: 0, grapples: 0, pads: 0, callouts: [], koTags: {}, hitSpeeds: [], travel: [], maxCorrection: 0, corrections: 0 },
    shotTick: new Map(),
  });
  const now = () => ((performance.now() - pt.t0) / 1000).toFixed(1);
  const note = (m) => pt.log.push(`${now()}s ${m}`);
  const name = (id) => g.roster.get(id)?.name ?? `#${id}`;
  const orig = g.handleEvent.bind(g);
  g.handleEvent = (e, imm) => {
    const you = g.youId;
    const s = pt.s;
    switch (e.t) {
      case 'shot': if (e.owner === you) { s.shots++; pt.shotTick.set(e.id, e.tick); } break;
      case 'boom': if (e.owner === you && pt.shotTick.has(e.id)) { s.travel.push((e.tick - pt.shotTick.get(e.id)) / 60); pt.shotTick.delete(e.id); } break;
      case 'hit':
        if (e.attacker === you) { s.myHits++; if (e.direct) s.myDirect++; s.hitSpeeds.push(Math.round(e.speed)); }
        if (e.target === you) s.gotHit++;
        break;
      case 'ko':
        if (e.killer === you) { s.myKOs++; note(`KO ${name(e.victim)} [${e.tags.join(',')}] +${e.points}`); for (const t of e.tags) s.koTags[t] = (s.koTags[t] ?? 0) + 1; }
        if (e.victim === you) { s.deaths++; if (e.killer < 0) s.falls++; note(`DIED (${e.killer >= 0 ? 'popped by ' + name(e.killer) : 'fell'}) [${e.tags.join(',')}] at ${e.x.toFixed(0)},${e.y.toFixed(0)},${e.z.toFixed(0)}`); }
        break;
      case 'chaos': s.chaos.push(e.kind); note(`EVENT ${e.kind}`); break;
      case 'chain': s.chains++; break;
      case 'crown': s.crowns++; note(`crown -> ${e.id >= 0 ? name(e.id) : 'nobody'}`); break;
      case 'final': note('FINAL 30'); break;
      case 'brace': if (e.id === you) s.braces++; break;
      case 'grab': if (e.id === you) s.grabs++; break;
      case 'grapple': if (e.id === you) s.grapples++; break;
      case 'pad': s.pads++; break;
    }
    return orig(e, imm);
  };

  // Human-ish controls.
  const tap = (code, ms = 70) => { inp.press(code); setTimeout(() => inp.release(code), ms); };
  const hold = (code, on) => { if (on && !inp.held.has(code)) inp.press(code); if (!on && inp.held.has(code)) inp.release(code); };
  let fireUntil = 0;
  let firing = false;
  let strafe = 'KeyA';
  let strafeUntil = 0;
  let nextAbility = performance.now() + 4000;
  let nextUtil = performance.now() + 9000;
  let lastCallout = '';
  let lastMode = -1;
  const turnRate = 5.5; // rad/s, a quick but human flick
  const angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
  let lastT = performance.now();
  pt.timer = setInterval(() => {
    const t = performance.now();
    const dt = Math.min(0.2, (t - lastT) / 1000);
    lastT = t;
    const p = g.pred;
    const err = Math.hypot(g.errX, g.errY, g.errZ);
    if (err > 0.3) { pt.s.corrections++; pt.s.maxCorrection = Math.max(pt.s.maxCorrection, err); }
    const co = document.querySelector('.callout .main')?.textContent ?? '';
    if (co && co !== lastCallout) { pt.s.callouts.push(co); note(`callout: ${co}`); }
    lastCallout = co;
    if (p.mode !== lastMode) { lastMode = p.mode; }
    if (!g.active || p.mode === 4 || g.match.phase === 'results') {
      for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Mouse0']) hold(k, false);
      firing = false;
      return;
    }
    const cam = g.r.camera.position;
    const w = g.weapon;
    const ground = g.world.groundBelow(p.px, p.py + 0.2, p.pz, 60);
    const offMap = p.onGround === 0 && (ground === null || ground < p.py - 12);
    if (offMap) {
      // Recover: face the middle, drift back, jump, dash, grapple the deck.
      const dx = -p.px;
      const dz = -p.pz;
      const yaw = Math.atan2(-dx, -dz);
      inp.yaw += Math.max(-turnRate * dt, Math.min(turnRate * dt, angDiff(inp.yaw, yaw)));
      inp.pitch = -0.25;
      hold('KeyW', true);
      hold('KeyS', false);
      hold('Mouse0', false);
      if (p.jumpsUsed < 2 && p.vy < 2) tap('Space');
      if (p.dashCharges > 0 && Math.random() < 0.15) tap('ShiftLeft');
      if (p.grappleCool <= 0 && Math.random() < 0.2) tap('KeyE');
      return;
    }
    // Pick the nearest visible enemy.
    let best = null;
    let bestD = 1e9;
    for (const rv of g.remotes.values()) {
      const c = rv.cur;
      if (!c || c.mode === 4 || (c.flags & 32)) continue;
      const cy = c.py + 1.0 * (1 + c.inflation * 0.75);
      const dx = c.px - cam.x, dy = cy - cam.y, dz = c.pz - cam.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > 50) continue;
      const hit = g.world.raycast(cam.x, cam.y, cam.z, dx / d, dy / d, dz / d, d);
      if (hit) continue;
      if (d < bestD) { bestD = d; best = { c, cy, d }; }
    }
    // Movement: keep a fighting distance, strafe, never walk off an edge.
    const fy = inp.yaw;
    const fwdX = -Math.sin(fy), fwdZ = -Math.cos(fy);
    const safe = (x, z) => { const gb = g.world.groundBelow(x, p.py + 0.5, z, 6); return gb !== null; };
    let wantW = false, wantS = false;
    if (best) { wantW = best.d > 16; wantS = best.d < 7; } else wantW = true;
    if (wantW && !safe(p.px + fwdX * 3, p.pz + fwdZ * 3)) { wantW = false; wantS = true; }
    if (wantS && !safe(p.px - fwdX * 3, p.pz - fwdZ * 3)) wantS = false;
    hold('KeyW', wantW);
    hold('KeyS', wantS);
    if (t > strafeUntil) { strafe = Math.random() < 0.5 ? 'KeyA' : 'KeyD'; strafeUntil = t + 700 + Math.random() * 1500; }
    const rX = Math.cos(fy), rZ = -Math.sin(fy);
    const sgn = strafe === 'KeyD' ? 1 : -1;
    const strafeOk = safe(p.px + rX * sgn * 3, p.pz + rZ * sgn * 3);
    hold('KeyA', strafe === 'KeyA' && strafeOk);
    hold('KeyD', strafe === 'KeyD' && strafeOk);
    if (!best) {
      // Wander toward the middle.
      const yaw = Math.atan2(p.px, p.pz);
      inp.yaw += Math.max(-turnRate * dt, Math.min(turnRate * dt, angDiff(inp.yaw, yaw)));
      inp.pitch *= 0.9;
      hold('Mouse0', false);
      firing = false;
      return;
    }
    // Aim with lead (projectile) and a little human error.
    const c = best.c;
    const lead = w.kind === 'projectile' ? best.d / w.projSpeed : 0;
    const ax = c.px + c.vx * lead, ay = best.cy + c.vy * lead * 0.5, az = c.pz + c.vz * lead;
    const dx = ax - cam.x, dy = ay - cam.y, dz = az - cam.z;
    const yaw = Math.atan2(-dx, -dz) + (Math.random() - 0.5) * 0.03;
    const pitch = Math.atan2(dy, Math.hypot(dx, dz)) + (Math.random() - 0.5) * 0.02;
    inp.yaw += Math.max(-turnRate * dt, Math.min(turnRate * dt, angDiff(inp.yaw, yaw)));
    inp.pitch += Math.max(-turnRate * dt, Math.min(turnRate * dt, pitch - inp.pitch));
    const onTarget = Math.abs(angDiff(inp.yaw, yaw)) < 0.06 && Math.abs(pitch - inp.pitch) < 0.06;
    const range = w.kind === 'projectile' ? w.projSpeed * w.projLifetime : w.range || 40;
    if (!firing && onTarget && best.d < range * 0.9 && p.ammo > 0) {
      firing = true;
      fireUntil = t + 150 + Math.random() * (w.chargeTime * 1000);
      hold('Mouse0', true);
    }
    if (firing && t > fireUntil) { hold('Mouse0', false); firing = false; }
    if (p.ammo === 0 && !firing) hold('Mouse0', false);
    // Abilities now and then, like a person would.
    if (t > nextAbility) {
      nextAbility = t + 2500 + Math.random() * 4000;
      const r = Math.random();
      if (r < 0.3 && p.dashCharges > 0) tap('ShiftLeft');
      else if (r < 0.5) tap('Space');
      else if (r < 0.7 && best.d < 12) tap('KeyQ');
      else if (r < 0.8 && best.d < 3) tap('KeyF');
      else if (r < 0.9 && best.d < 20) tap('KeyE');
      else if (p.ammo < w.ammo) tap('KeyR');
    }
    if (t > nextUtil && best.d < 18) {
      nextUtil = t + 12000 + Math.random() * 8000;
      tap(Math.random() < 0.5 ? 'KeyC' : 'KeyG');
    }
  }, 50);
});

// --- Watch the match ------------------------------------------------------------------------
const status = () => page.evaluate(() => {
  const g = window.bubba.game;
  const p = g.pred;
  const me = g.roster.get(g.youId);
  const pf = window.bubba.perf;
  const fps = pf.frames ? Math.round(pf.frames / Math.max(0.001, (performance.now() - (window.__ptFps ?? window.__pt.t0)) / 1000)) : 0;
  window.__ptFps = performance.now();
  pf.frames = 0;
  return {
    t: +((performance.now() - window.__pt.t0) / 1000).toFixed(0),
    phase: g.match.phase,
    pos: [p.px, p.py, p.pz].map((v) => +v.toFixed(1)),
    infl: Math.round(p.inflation * 100),
    mode: p.mode,
    score: me?.score,
    fps,
    rtt: Math.round(window.bubba.net.rtt),
    event: document.querySelector('.event-banner:not(.hidden)')?.textContent ?? '',
    third: g.settings.thirdPerson,
  };
});
let shot = 0;
const snap = async (label) => { shot++; await page.screenshot({ path: `${out}/${String(shot).padStart(2, '0')}-${label}.png` }); };
const start = Date.now();
let lastSnap = 0;
let toggled1 = false;
let toggled2 = false;
while ((Date.now() - start) / 1000 < PLAY_SECONDS) {
  await page.waitForTimeout(5000);
  const st = await status();
  console.log(JSON.stringify(st));
  const el = (Date.now() - start) / 1000;
  if (!toggled1 && el > PLAY_SECONDS * 0.4) { toggled1 = true; await page.keyboard.press('KeyV'); console.log('-> third person'); }
  if (!toggled2 && el > PLAY_SECONDS * 0.75) { toggled2 = true; await page.keyboard.press('KeyV'); console.log('-> first person'); }
  if (el - lastSnap >= 15) { lastSnap = el; await snap(`t${Math.round(el)}${st.event ? '-event' : ''}${st.third ? '-3p' : ''}`); }
}
// Final 30 seconds and results.
await page.evaluate(() => window.bubba.net.send({ type: 'debug', action: 'endIn', seconds: 34 }));
await page.waitForTimeout(8000);
await snap('final30');
console.log(JSON.stringify(await status()));
await page.waitForFunction(() => window.bubba.game.match.phase === 'results', null, { timeout: 90000 });
await page.waitForTimeout(1500);
await snap('results');
await page.waitForTimeout(4000);
const skip = await page.$('.replay-banner .btn');
if (skip) { await snap('replay'); await skip.click({ force: true, timeout: 3000 }).catch(() => undefined); await page.waitForTimeout(1500); await snap('results2'); }

const report = await page.evaluate(() => {
  clearInterval(window.__pt.timer);
  const s = window.__pt.s;
  const avg = (a) => (a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2) : 0);
  return { ...s, hitSpeeds: undefined, travel: undefined, avgHitSpeed: avg(s.hitSpeeds), avgTravel: avg(s.travel), maxTravel: Math.max(0, ...s.travel), accuracy: s.shots ? +(s.myHits / s.shots).toFixed(2) : 0, log: window.__pt.log };
});
writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, log: undefined }, null, 1));
console.log('timeline:\n' + report.log.join('\n'));
console.log('errors:', errors.length ? '\n' + errors.slice(0, 20).join('\n') : 'none');
await browser.close();
