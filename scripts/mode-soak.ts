/**
 * Plays full bot-only matches of every mode and prints how they went (scores, goals, pump fill,
 * match length). Run with: npx tsx scripts/mode-soak.ts
 */
import { GameSim } from '../src/shared/game/sim';
import { MODE_IDS } from '../src/shared/game/modes';
import { KNOCKOUT_MAPS, getMap, mapForMode } from '../src/shared/maps';

for (const mode of MODE_IDS) {
  const maps = mapForMode(mode) ? [mapForMode(mode)!] : KNOCKOUT_MAPS;
  for (const mapId of maps) {
    const sim = new GameSim({ map: getMap(mapId), mode });
    const n = mode === 'duel' ? 2 : 8;
    for (let i = 0; i < n; i++) sim.addBot([0.25, 0.45, 0.65, 0.35][i % 4]);
    let goals = 0;
    let outs = 0;
    let kos = 0;
    let falls = 0;
    const start = sim.time;
    while (sim.phase !== 'results' && sim.time - start < 400) {
      sim.step();
      for (const e of sim.drainEvents()) {
        if (e.t === 'goal') goals++;
        if (e.t === 'ballOut') outs++;
        if (e.t === 'ko') {
          if (e.killer >= 0) kos++;
          else falls++;
        }
      }
    }
    const r = sim.lastResult;
    const len = Math.round(sim.time - start);
    const pump = sim.pumpGame ? ` fill=${sim.pumpGame.fill.map((f) => Math.round(f * 100)).join('/')}%` : '';
    console.log(
      `${mode.padEnd(13)} ${mapId.padEnd(12)} ${len}s kos=${kos} falls=${falls}` +
        (sim.ballGame ? ` goals=${goals} outs=${outs}` : '') +
        pump +
        (r?.teams ? ` teams=${r.teams.scores.join('-')} winner=${r.teams.winner}` : ` top=${r?.standings[0]?.name}:${r?.standings[0]?.score}`),
    );
  }
}
