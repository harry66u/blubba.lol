// Prints how far a target travels per clean hit and how many hits it takes to knock them out.
// Usage: npx tsx scripts/balance-report.ts
import { GameSim } from '../src/shared/game/sim';
import { DEALERSHIP } from '../src/shared/maps/dealership';
import { Driver, run } from '../tests/helpers';

const lanes: [string, number, number, number, number][] = [
  ['center -> east edge (25 m)', 0, 0, 1, 0],
  ['lane x=3.5 -> south edge (20 m)', 3.5, 0, 0, 1],
];
for (const [label, sx, sz, dx, dz] of lanes) {
  const sim = new GameSim({ map: DEALERSHIP });
  sim.eventMult = 0;
  const shooter = sim.addPlayer('shooter');
  const target = sim.addPlayer('target');
  const ds = new Driver(sim, shooter);
  const dt = new Driver(sim, target);
  Object.assign(target.state, { px: sx, pz: sz, py: 0, spawnProt: 0 });
  const log: string[] = [];
  for (let i = 0; i < 12; i++) {
    run(sim, [ds, dt], 200);
    if (target.stats.deaths > 0) break;
    const t = target.state;
    Object.assign(shooter.state, { px: t.px - dx * 8, pz: t.pz - dz * 8, py: t.py, ammo: 5, reloadTimer: 0, spawnProt: 0 });
    ds.aimAt(t.px, t.py + 1.05 * (1 + 0.75 * t.inflation), t.pz);
    ds.setFire(true);
    run(sim, [ds, dt], 50);
    ds.setFire(false);
    const x0 = t.px;
    const z0 = t.pz;
    let maxY = t.py;
    run(sim, [ds, dt], 150, () => (maxY = Math.max(maxY, target.state.py)));
    const hit = sim.drainEvents().filter((e) => e.t === 'hit' && e.target === target.id).pop();
    const speed = hit && hit.t === 'hit' ? hit.speed.toFixed(1) : '-';
    log.push(
      `  hit ${i + 1}: moved ${Math.hypot(t.px - x0, t.pz - z0).toFixed(1).padStart(5)} m  peak ${maxY.toFixed(1)} m  inflation ${String(Math.round(t.inflation * 100)).padStart(3)}%  launch ${speed} m/s${target.stats.deaths ? '  -> KNOCKED OUT' : ''}`,
    );
  }
  console.log(label + '\n' + log.join('\n'));
}
