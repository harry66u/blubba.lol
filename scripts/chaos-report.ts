/**
 * Plays normal bot matches (4-minute Knockout, events on) and counts how often each chaos system
 * shows up: random events, chain reactions, crown, revenge, multi-knockouts, final 30 seconds.
 * Usage: npx tsx scripts/chaos-report.ts [matches]
 */
import { GameSim } from '../src/shared/game/sim';
import { KNOCKOUT_MAPS, getMap } from '../src/shared/maps';

const N = Number(process.argv[2] ?? 6);
const totals: Record<string, number> = {};
const firstEvent: number[] = [];
const add = (k: string, n = 1) => (totals[k] = (totals[k] ?? 0) + n);
for (let m = 0; m < N; m++) {
  const sim = new GameSim({ map: getMap(KNOCKOUT_MAPS[m % KNOCKOUT_MAPS.length]), mode: 'knockout' });
  for (let i = 0; i < 6; i++) sim.addBot([0.25, 0.45, 0.65, 0.35][i % 4]);
  const start = sim.time;
  let first = -1;
  while (sim.phase !== 'results') {
    sim.step();
    for (const e of sim.drainEvents()) {
      if (e.t === 'chaos') {
        add(`event:${e.kind}`);
        add('events');
        if (first < 0) first = (e.startTick - sim.tick) * sim.dt + sim.time - start;
      }
      if (e.t === 'chain') add('chain hits');
      if (e.t === 'crown' && e.id >= 0) add('crown changes');
      if (e.t === 'final') add('final 30s');
      if (e.t === 'ko') {
        add('knockouts');
        for (const tag of e.tags) add(`ko tag:${tag}`);
      }
      if (e.t === 'shot' && e.w !== 0) add('utility throws');
    }
  }
  firstEvent.push(first);
}
console.log(`${N} matches (6 bots, 4 min, events normal). Per match:`);
for (const [k, v] of Object.entries(totals).sort()) console.log(`  ${k.padEnd(22)} ${(v / N).toFixed(1)}`);
console.log(`  first event warning at ${firstEvent.map((t) => `${Math.round(t)}s`).join(', ')}`);
