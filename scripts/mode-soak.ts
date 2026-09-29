/**
 * Plays full bot-only matches of every mode and prints how they went (scores, goals, pump fill,
 * match length, map shrinks, and for Sudden Death who was left standing). Run with:
 * npx tsx scripts/mode-soak.ts            (every mode once per map)
 * npx tsx scripts/mode-soak.ts suddenDeath 5   (one mode, five matches per map)
 */
import { GameSim } from '../src/shared/game/sim';
import { MODE_IDS, type ModeId } from '../src/shared/game/modes';
import { KNOCKOUT_MAPS, getMap, mapForMode } from '../src/shared/maps';

const only = process.argv[2] as ModeId | undefined;
const repeat = Number(process.argv[3] ?? 1);
let failures = 0;

for (const mode of MODE_IDS.filter((m) => !only || m === only)) {
  const maps = mapForMode(mode) ? [mapForMode(mode)!] : KNOCKOUT_MAPS;
  for (const mapId of maps) {
    for (let rep = 0; rep < repeat; rep++) {
      const sim = new GameSim({ map: getMap(mapId), mode });
      // Public rooms: 6 in free-for-all (like Knockout), 4v4 in team modes, two in a 1v1.
      const n = mode === 'duel' ? 2 : mode === 'knockout' || mode === 'suddenDeath' ? 6 : 8;
      for (let i = 0; i < n; i++) sim.addBot([0.25, 0.45, 0.65, 0.35][i % 4]);
      let goals = 0;
      let outs = 0;
      let kos = 0;
      let falls = 0;
      const shrinks: number[] = [];
      const left: string[] = [];
      let firstKoAt = -1;
      let ults = 0;
      // Supply drops and the newer gadgets, to see bots use them.
      const extra: Record<string, number> = { loot: 0, lootGrab: 0, mine: 0, helium: 0, tornado: 0 };
      const start = sim.time;
      while (sim.phase !== 'results' && sim.time - start < 400) {
        sim.step();
        for (const e of sim.drainEvents()) {
          if (e.t === 'goal') goals++;
          if (e.t === 'ballOut') outs++;
          if (e.t in extra) extra[e.t]++;
          if (e.t === 'ult') ults++;
          if (e.t === 'shrink') shrinks.push(Math.round(e.startTick * sim.dt - start));
          if (e.t === 'survivors') left.push(`${e.left.length}@${Math.round(sim.time - start)}s`);
          if (e.t === 'ko') {
            if (firstKoAt < 0) firstKoAt = Math.round(sim.time - start);
            if (e.killer >= 0) kos++;
            else falls++;
          }
        }
      }
      const r = sim.lastResult;
      const len = Math.round(sim.time - start);
      const pump = sim.pumpGame ? ` fill=${sim.pumpGame.fill.map((f) => Math.round(f * 100)).join('/')}%` : '';
      let sd = '';
      if (mode === 'suddenDeath') {
        const surv = r?.survivors ?? [];
        const winner = r?.standings[0];
        const ok = !!r && !!winner && r.winnerId === winner.id && (surv.length <= 1 ? true : len >= sim.durationSec - 1);
        if (!ok) failures++;
        sd =
          ` survivors=${surv.length} winner=${winner?.name}(${winner?.stats.kos} KO)` +
          ` ${surv.length <= 1 ? 'LAST STANDING' : 'TIME UP (tie-break)'} left=[${left.join(' ')}]${ok ? '' : ' FAILED'}`;
      }
      console.log(
        `${mode.padEnd(13)} ${mapId.padEnd(12)} ${String(len).padStart(3)}s kos=${kos} falls=${falls} ults=${ults} firstKo=${firstKoAt}s shrinks=[${shrinks.join(',')}]` +
          (sim.ballGame ? ` goals=${goals} outs=${outs}` : '') +
          pump +
          (r?.teams ? ` teams=${r.teams.scores.join('-')} winner=${r.teams.winner}` : mode === 'suddenDeath' ? sd : ` top=${r?.standings[0]?.name}:${r?.standings[0]?.score}`) +
          ` loot=${extra.lootGrab}/${extra.loot} mines=${extra.mine} helium=${extra.helium} tornados=${extra.tornado}`,
      );
    }
  }
}
if (failures) {
  console.log(`${failures} Sudden Death match(es) did not end properly`);
  process.exitCode = 1;
}
