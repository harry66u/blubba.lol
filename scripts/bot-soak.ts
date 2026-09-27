// Runs bots against an idle player for a few simulated minutes and prints stats.
import { GameSim } from '../src/shared/game/sim';
import { DEALERSHIP } from '../src/shared/maps/dealership';
import { Driver, run } from '../tests/helpers';

const minutes = Number(process.argv[2] ?? 3);
const sim = new GameSim({ map: DEALERSHIP, durationSec: 999 });
const human = sim.addPlayer('idle');
const d = new Driver(sim, human);
for (const skill of [0.25, 0.45, 0.65]) sim.addBot(skill);
const t0 = Date.now();
run(sim, [d], minutes * 60 * 60, () => sim.drainEvents());
const ms = Date.now() - t0;
for (const p of sim.players.values()) {
  console.log(`${p.name.padEnd(14)} kos ${p.stats.kos} deaths ${p.stats.deaths} selfFalls ${p.stats.falls} shots ${p.stats.shots} hits ${p.stats.hits}`);
}
console.log(`simulated ${minutes} min in ${ms} ms (${((minutes * 60 * 1000) / ms).toFixed(0)}x realtime)`);
