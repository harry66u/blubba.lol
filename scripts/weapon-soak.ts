// Pits one bot per weapon (equal skill) against each other and prints knockouts per weapon.
// Usage: npx tsx scripts/weapon-soak.ts [minutes] [runs]
import { GameSim } from '../src/shared/game/sim';
import { WEAPON_IDS, sanitizeLoadout } from '../src/shared/loadout';
import { DEALERSHIP } from '../src/shared/maps/dealership';

const minutes = Number(process.argv[2] ?? 5);
const runs = Number(process.argv[3] ?? 4);
const totals = new Map<string, { kos: number; deaths: number }>();
for (let r = 0; r < runs; r++) {
  const sim = new GameSim({ map: DEALERSHIP, durationSec: 9999 });
  for (const w of WEAPON_IDS) {
    const p = sim.addBot(0.55);
    sim.setLoadout(p.id, sanitizeLoadout({ weapon: w, mods: [], utils: ['bouncePad', 'airGrenade'] }));
    p.loadout = sanitizeLoadout({ weapon: w, mods: [], utils: ['bouncePad', 'airGrenade'] });
    p.name = w;
  }
  sim.startMatch();
  for (let t = 0; t < minutes * 3600; t++) {
    sim.step();
    sim.drainEvents();
  }
  for (const p of sim.players.values()) {
    const e = totals.get(p.loadout.weapon) ?? { kos: 0, deaths: 0 };
    e.kos += p.stats.kos;
    e.deaths += p.stats.deaths;
    totals.set(p.loadout.weapon, e);
  }
}
for (const [w, e] of totals) console.log(`${w.padEnd(12)} kos ${String(e.kos).padStart(3)} deaths ${String(e.deaths).padStart(3)}`);
