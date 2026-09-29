// Bots play a few simulated minutes per mode; prints how often ults come up, where the charge
// comes from, and whether the leader or the last player gets more of them.
// Usage: npx tsx scripts/ult-soak.ts [minutes] [bots]
import { BALANCE } from '../src/shared/balance';
import { GameSim } from '../src/shared/game/sim';
import type { ModeId } from '../src/shared/game/modes';
import { getMap, mapForMode } from '../src/shared/maps';

const minutes = Number(process.argv[2] ?? 4);
const bots = Number(process.argv[3] ?? 8);

for (const mode of ['knockout', 'teamKnockout', 'ball', 'pump', 'duel'] as ModeId[]) {
  const map = getMap(mapForMode(mode) ?? 'dealership');
  const sim = new GameSim({ map, mode, durationSec: minutes * 60 });
  const n = mode === 'duel' ? 2 : bots;
  for (let i = 0; i < n; i++) sim.addBot(0.3 + (i % 4) * 0.15);
  if (sim.phase !== 'playing') sim.startMatch();
  const ults = new Map<number, number>();
  const firstUlt = new Map<number, number>();
  const chargeWhy = new Map<string, number>();
  const ticks = minutes * 60 * BALANCE.tickRate;
  for (let t = 0; t < ticks && sim.phase === 'playing'; t++) {
    sim.step();
    for (const e of sim.drainEvents()) {
      if (e.t === 'ult') {
        ults.set(e.id, (ults.get(e.id) ?? 0) + 1);
        if (!firstUlt.has(e.id)) firstUlt.set(e.id, sim.time);
      }
      if (e.t === 'charge') chargeWhy.set(e.why, (chargeWhy.get(e.why) ?? 0) + e.amount);
    }
  }
  const players = [...sim.players.values()].sort((a, b) => b.score - a.score);
  const total = [...ults.values()].reduce((a, b) => a + b, 0);
  const played = sim.time / 60;
  const perMin = total / Math.max(1, players.length) / Math.max(0.1, played);
  const firsts = [...firstUlt.values()];
  const avgFirst = firsts.length ? firsts.reduce((a, b) => a + b, 0) / firsts.length : NaN;
  console.log(`\n${mode.padEnd(13)} ${players.length} bots, ${played.toFixed(1)} min: ${total} ults, ${perMin.toFixed(2)} per player per minute, first after ${avgFirst.toFixed(0)} s on average`);
  console.log(`  announced charge: ${[...chargeWhy].map(([k, v]) => `${k} ${v}%`).join(', ') || 'none'}`);
  if (sim.teamScores[0] || sim.teamScores[1] || mode === 'teamKnockout') {
    for (const team of [0, 1]) {
      const mine = players.filter((p) => p.team === team);
      const u = mine.reduce((a, p) => a + (ults.get(p.id) ?? 0), 0);
      console.log(`  team ${team}: score ${sim.teamScoreOf(team).toFixed(mode === 'pump' ? 2 : 0)}, ${u} ults`);
    }
  } else {
    for (const p of players) console.log(`  ${p.name.padEnd(16)} score ${String(p.score).padStart(2)}  ults ${ults.get(p.id) ?? 0}`);
  }
}
