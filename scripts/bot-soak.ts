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
const counts = new Map<string, number>();
const ults = new Map<string, number>();
run(sim, [d], minutes * 60 * 60, () => {
  for (const e of sim.drainEvents()) {
    counts.set(e.t, (counts.get(e.t) ?? 0) + 1);
    if (e.t === 'ult') ults.set(e.kind, (ults.get(e.kind) ?? 0) + 1);
  }
});
const ms = Date.now() - t0;
for (const p of sim.players.values()) {
  const st = p.stats;
  console.log(`${p.name.padEnd(14)} kos ${st.kos} deaths ${st.deaths} selfFalls ${st.falls} shots ${st.shots} hits ${st.hits} throws ${st.throws} stomps ${st.stomps} bestCombo ${st.bestCombo}`);
}
console.log('events:', [...counts].filter(([k]) => !['move', 'shot', 'boom', 'fizzle', 'hit'].includes(k)).map(([k, v]) => `${k}=${v}`).join(' '));
console.log('ults:', [...ults].map(([k, v]) => `${k}=${v}`).join(' ') || 'none', '| loadouts:', [...sim.players.values()].map((p) => `${p.name}:${p.loadout.ult}`).join(' '));
console.log(`simulated ${minutes} min in ${ms} ms (${((minutes * 60 * 1000) / ms).toFixed(0)}x realtime)`);
