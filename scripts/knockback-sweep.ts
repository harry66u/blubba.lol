/**
 * Tries knockback settings and reports how each feels in numbers:
 *  - single clean hit from rest at each inflation level: distance and peak height
 *  - hits to knock out, starting at the map center and pushed toward the edge
 *  - first hit that knocks out from 6 m from the edge (standing still, and steering back)
 *  - landed hits per knockout in a typical fight (random charge, mixed angles; TYPICAL=0 skips it)
 * Usage: npx tsx scripts/knockback-sweep.ts
 */
import { BALANCE } from '../src/shared/balance';
import { GameSim } from '../src/shared/game/sim';
import { DEALERSHIP } from '../src/shared/maps/dealership';
import { Driver, run } from '../tests/helpers';

type Cfg = { name: string; base: number; growth: number; growthExp: number; minUp: number; infl: number; massAtMax: number; tapPower?: number; chargeTime?: number };

const EAST = 25; // center of the dealership lot to its east edge

function shoot(sim: GameSim, ds: Driver, dt: Driver, dir: [number, number], steer: boolean) {
  const t = dt.player.state;
  const shooter = ds.player.state;
  Object.assign(shooter, { px: t.px - dir[0] * 8, pz: t.pz - dir[1] * 8, py: t.py, ammo: 5, reloadTimer: 0, spawnProt: 0, vx: 0, vy: 0, vz: 0 });
  ds.aimAt(t.px, t.py + 1.05 * (1 + 0.75 * t.inflation), t.pz);
  ds.setFire(true);
  run(sim, [ds, dt], 50);
  ds.setFire(false);
  // A skilled target holds "back toward the middle" while flying.
  if (steer) {
    dt.frame.yaw = Math.atan2(dir[0], dir[1]); // face the shooter (back toward center)
    dt.frame.moveZ = 1;
  }
}

function single(cfg: Cfg, inflationBefore: number): { dist: number; peak: number; speed: number } {
  const sim = new GameSim({ map: DEALERSHIP, durationSec: 999 });
  sim.eventMult = 0;
  const a = sim.addPlayer('a');
  const b = sim.addPlayer('b');
  sim.startMatch();
  const ds = new Driver(sim, a);
  const dt = new Driver(sim, b);
  Object.assign(b.state, { px: -10, pz: 0, py: 0, spawnProt: 0, inflation: inflationBefore, vx: 0, vy: 0, vz: 0 });
  run(sim, [ds, dt], 30);
  shoot(sim, ds, dt, [1, 0], false);
  const x0 = -10;
  let peak = 0;
  run(sim, [ds, dt], 180, () => (peak = Math.max(peak, b.state.py)));
  const hit = sim.drainEvents().filter((e) => e.t === 'hit' && e.target === b.id).pop() as { speed: number } | undefined;
  return { dist: b.state.px - x0, peak, speed: hit?.speed ?? 0 };
}

function hitsToKo(cfg: Cfg, startX: number, steer: boolean, fixedStart: boolean, dir: [number, number] = [1, 0], startZ = 0): number {
  // fixedStart: every hit starts from startX with (n-1) hits of inflation already applied.
  for (let n = 1; n <= 12; n++) {
    const sim = new GameSim({ map: DEALERSHIP, durationSec: 999 });
    sim.eventMult = 0;
    const a = sim.addPlayer('a');
    const b = sim.addPlayer('b');
    sim.startMatch();
    const ds = new Driver(sim, a);
    const dt = new Driver(sim, b);
    if (fixedStart) {
      Object.assign(b.state, { px: startX, pz: 0, py: 0, spawnProt: 0, inflation: Math.min(1, (n - 1) * cfg.infl) });
      run(sim, [ds, dt], 20);
      shoot(sim, ds, dt, [1, 0], steer);
      run(sim, [ds, dt], 240);
      if (b.stats.deaths > 0) return n;
    } else {
      Object.assign(b.state, { px: startX, pz: startZ, py: 0, spawnProt: 0 });
      for (let i = 1; i <= 12; i++) {
        run(sim, [ds, dt], 60);
        if (b.stats.deaths > 0) return i - 1;
        shoot(sim, ds, dt, dir, steer);
        dt.frame.moveZ = 0;
        run(sim, [ds, dt], 180);
        if (b.stats.deaths > 0) return i;
      }
      return 99;
    }
  }
  return 99;
}

/**
 * Like a real fight: charge held a random 0.13-0.9 s, shots from 10-14 m, mostly pushing the
 * target outward from the middle but sometimes from a random side, and the target steers back
 * half the time. Returns the average number of landed hits per knockout (capped at 40).
 */
function typicalHitsToKo(trials = Number(process.env.TRIALS ?? 16)): number {
  let total = 0;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let tr = 0; tr < trials; tr++) {
    const sim = new GameSim({ map: DEALERSHIP, durationSec: 999 });
    sim.eventMult = 0;
    const a = sim.addPlayer('a');
    const b = sim.addPlayer('b');
    sim.startMatch();
    const ds = new Driver(sim, a);
    const dt = new Driver(sim, b);
    Object.assign(b.state, { px: (rnd() - 0.5) * 10, pz: (rnd() - 0.5) * 10, py: 0, spawnProt: 0 });
    let hits = 0;
    for (; hits < 40 && b.stats.deaths === 0; ) {
      run(sim, [ds, dt], 40);
      if (b.stats.deaths > 0 || b.state.onGround === 0) continue;
      const t = b.state;
      let ang = Math.atan2(t.pz, t.px);
      if (rnd() < 0.35 || Math.hypot(t.px, t.pz) < 2) ang = rnd() * Math.PI * 2;
      const dist = 10 + rnd() * 4;
      const dir: [number, number] = [Math.cos(ang), Math.sin(ang)];
      Object.assign(a.state, { px: t.px - dir[0] * dist, pz: t.pz - dir[1] * dist, py: t.py, ammo: 5, reloadTimer: 0, spawnProt: 0, vx: 0, vy: 0, vz: 0, fireCool: 0 });
      ds.aimAt(t.px, t.py + 1.05 * (1 + 0.75 * t.inflation), t.pz);
      const before = b.stats.deaths;
      const infl0 = t.inflation;
      ds.setFire(true);
      run(sim, [ds, dt], 8 + Math.floor(rnd() * 46));
      ds.setFire(false);
      const steer = rnd() < 0.5;
      if (steer) {
        dt.frame.yaw = Math.atan2(dir[0], dir[1]);
        dt.frame.moveZ = 1;
      }
      run(sim, [ds, dt], 200);
      dt.frame.moveZ = 0;
      if (b.state.inflation > infl0 || b.stats.deaths > before) hits++;
    }
    total += hits;
  }
  return total / trials;
}

function apply(cfg: Cfg) {
  const K = BALANCE.knockback as { base: number; growth: number; growthExp: number; minUp: number };
  K.base = cfg.base;
  K.growth = cfg.growth;
  K.growthExp = cfg.growthExp;
  K.minUp = cfg.minUp;
  (BALANCE.weapons.airCannon as { inflation: number }).inflation = cfg.infl;
  (BALANCE.inflation as { massAtMax: number }).massAtMax = cfg.massAtMax;
  const W = BALANCE.weapons.airCannon as { tapPower: number; chargeTime: number };
  if (cfg.tapPower !== undefined) W.tapPower = cfg.tapPower;
  if (cfg.chargeTime !== undefined) W.chargeTime = cfg.chargeTime;
}

// Pass other settings as JSON in CFGS to compare; by default this reports the live BALANCE values.
const K0 = BALANCE.knockback;
const configs: Cfg[] = JSON.parse(process.env.CFGS ?? 'null') ?? [
  { name: 'current', base: K0.base, growth: K0.growth, growthExp: K0.growthExp, minUp: K0.minUp, infl: BALANCE.weapons.airCannon.inflation, massAtMax: BALANCE.inflation.massAtMax, tapPower: BALANCE.weapons.airCannon.tapPower, chargeTime: BALANCE.weapons.airCannon.chargeTime },
];

for (const cfg of configs) {
  apply(cfg);
  const levels = [0, 1, 2, 3, 4, 5, 6].map((n) => Math.min(1, n * cfg.infl));
  const singles = levels.map((l) => single(cfg, l));
  console.log(`\n== ${cfg.name}  base ${cfg.base} growth ${cfg.growth} exp ${cfg.growthExp} minUp ${cfg.minUp} infl/hit ${cfg.infl} massAtMax ${cfg.massAtMax} tap ${BALANCE.weapons.airCannon.tapPower} charge ${BALANCE.weapons.airCannon.chargeTime}s`);
  console.log('  hit#  before  speed   dist   peak');
  singles.forEach((s, i) => console.log(`  ${String(i + 1).padStart(4)}  ${String(Math.round(levels[i] * 100)).padStart(5)}%  ${s.speed.toFixed(1).padStart(5)}  ${s.dist.toFixed(1).padStart(5)}m  ${s.peak.toFixed(1)}m`));
  console.log(`  center, pushed toward edge: KO on hit ${hitsToKo(cfg, 0, false, false)} (steering back: ${hitsToKo(cfg, 0, true, false)})`);
  console.log(`  toward the short edge (20 m): KO on hit ${hitsToKo(cfg, 3.5, false, false, [0, 1])} (steering back: ${hitsToKo(cfg, 3.5, true, false, [0, 1])})`);
  console.log(`  6 m from edge: first KO on hit ${hitsToKo(cfg, EAST - 6, false, true)} (steering back: ${hitsToKo(cfg, EAST - 6, true, true)})`);
  console.log(`  12 m from edge: first KO on hit ${hitsToKo(cfg, EAST - 12, false, true)} (steering back: ${hitsToKo(cfg, EAST - 12, true, true)})`);
  if (process.env.TYPICAL !== '0') console.log(`  typical fight (random charge, mixed angles): ${typicalHitsToKo().toFixed(1)} landed hits per knockout`);
}
