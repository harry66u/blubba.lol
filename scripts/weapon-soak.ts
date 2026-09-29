// Pits one bot per weapon (equal skill) against each other in free-for-all matches and prints how
// every weapon did: knockouts, deaths, self-falls (fell off with nobody's credit), hits per
// knockout and accuracy. Pop Gun corks count as a quarter of a shot / hit each (as in match stats).
//
// Usage: npx tsx scripts/weapon-soak.ts [minutes] [runs] [--maps] [--parts] [--skill=0.55] [--set=path=value]
//   --maps   rotate through every knockout map (default: Sky Motors only)
//   --parts  bots use random weapon parts too, and a second table compares the parts
//   --set    try a balance value without editing balance.ts, e.g. --set=weapons.popGun.knockback=0.13
//   --duels  also play every pair of weapons 1v1 ([runs] duels per pair) and print who wins
//            (free-for-all knockouts also reward finishing other people's targets; duels don't)
import { BALANCE } from '../src/shared/balance';
import { GameSim } from '../src/shared/game/sim';
import { PART_SLOTS, type PartId, SLOT_PARTS, WEAPON_IDS, WEAPON_INFO, type WeaponId, sanitizeLoadout } from '../src/shared/loadout';
import { KNOCKOUT_MAPS, getMap } from '../src/shared/maps';

const args = process.argv.slice(2);
const nums = args.filter((a) => !a.startsWith('--')).map(Number);
const minutes = nums[0] ?? 5;
const runs = nums[1] ?? 4;
const rotateMaps = args.includes('--maps');
const withParts = args.includes('--parts');
const duels = args.includes('--duels');
const skill = Number(args.find((a) => a.startsWith('--skill='))?.split('=')[1] ?? 0.55);
for (const a of args.filter((x) => x.startsWith('--set='))) {
  const [path, value] = a.slice(6).split('=');
  const keys = path.split('.');
  let obj = BALANCE as unknown as Record<string, unknown>;
  for (const k of keys.slice(0, -1)) obj = obj[k] as Record<string, unknown>;
  obj[keys[keys.length - 1]] = Number(value);
  console.log(`set ${path} = ${value}`);
}

interface Tally {
  kos: number;
  deaths: number;
  falls: number;
  hits: number;
  shots: number;
  lives: number;
}
const empty = (): Tally => ({ kos: 0, deaths: 0, falls: 0, hits: 0, shots: 0, lives: 0 });
const byWeapon = new Map<WeaponId, Tally>(WEAPON_IDS.map((w) => [w, empty()]));
const byPart = new Map<string, Tally>();

let seed = 12345;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};

for (let r = 0; r < runs; r++) {
  const map = getMap(rotateMaps ? KNOCKOUT_MAPS[r % KNOCKOUT_MAPS.length] : 'dealership');
  const sim = new GameSim({ map, durationSec: 9999 });
  sim.eventMult = 0;
  const partsOf = new Map<number, Record<string, PartId>>();
  // Rotate the order so nobody always spawns in the same place.
  const order = WEAPON_IDS.map((_, i) => WEAPON_IDS[(i + r) % WEAPON_IDS.length]);
  for (const w of order) {
    const p = sim.addBot(skill);
    const parts: Record<string, PartId> = {};
    if (withParts) for (const slot of PART_SLOTS) parts[slot] = SLOT_PARTS[slot][Math.floor(rnd() * SLOT_PARTS[slot].length)];
    const l = sanitizeLoadout({ weapon: w, parts, utils: ['bouncePad', 'airGrenade'] });
    sim.setLoadout(p.id, l);
    partsOf.set(p.id, l.parts);
    p.name = w;
  }
  sim.startMatch();
  for (let t = 0; t < minutes * 3600; t++) {
    sim.step();
    sim.drainEvents();
  }
  for (const p of sim.players.values()) {
    const add = (e: Tally) => {
      e.kos += p.stats.kos;
      e.deaths += p.stats.deaths;
      e.falls += p.stats.falls;
      e.hits += p.stats.hits;
      e.shots += p.stats.shots;
      e.lives += p.stats.deaths + 1;
    };
    add(byWeapon.get(p.loadout.weapon)!);
    if (withParts) {
      for (const id of Object.values(partsOf.get(p.id) ?? {})) {
        const slot = PART_SLOTS.find((s) => SLOT_PARTS[s].includes(id))!;
        const key = id === 'standard' ? `standard ${slot}` : id;
        if (!byPart.has(key)) byPart.set(key, empty());
        add(byPart.get(key)!);
      }
    }
  }
}

const f1 = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : '-');
function table(title: string, rows: [string, Tally][]): void {
  console.log(`\n${title}`);
  console.log(`${'name'.padEnd(18)}${['KOs', 'deaths', 'K/D', 'self-falls', 'hits', 'hits/KO', 'accuracy'].map((h) => h.padStart(11)).join('')}`);
  for (const [name, e] of rows) {
    const cells = [String(e.kos), String(e.deaths), (e.kos / Math.max(1, e.deaths)).toFixed(2), String(e.falls), String(e.hits), f1(e.hits / e.kos), `${Math.round((100 * e.hits) / Math.max(1, e.shots))}%`];
    console.log(`${name.padEnd(18)}${cells.map((c) => c.padStart(11)).join('')}`);
  }
}

console.log(`${runs} runs x ${minutes} min, ${WEAPON_IDS.length} bots (skill ${skill})${rotateMaps ? ', all knockout maps' : ', Sky Motors'}${withParts ? ', random parts' : ''}`);
const rows = [...byWeapon.entries()].map(([w, e]) => [WEAPON_INFO[w].name, e] as [string, Tally]);
table('Weapons', rows);
const kos = rows.map(([, e]) => e.kos);
const mean = kos.reduce((a, b) => a + b, 0) / kos.length;
console.log(`KO spread: min ${Math.min(...kos)} / mean ${mean.toFixed(1)} / max ${Math.max(...kos)} (max/min ${(Math.max(...kos) / Math.max(1, Math.min(...kos))).toFixed(2)})`);
if (withParts) table('Parts (every bot that carried it)', [...byPart.entries()].sort((a, b) => a[0].localeCompare(b[0])));

if (duels) {
  // Round robin: KO share of every weapon against every other one.
  const n = WEAPON_IDS.length;
  const won = WEAPON_IDS.map(() => WEAPON_IDS.map(() => 0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      for (let r = 0; r < runs; r++) {
        const sim = new GameSim({ map: getMap(KNOCKOUT_MAPS[(r + i + j) % KNOCKOUT_MAPS.length]), durationSec: 9999 });
        sim.eventMult = 0;
        const pair = r % 2 ? [j, i] : [i, j];
        const bots = pair.map((w) => {
          const p = sim.addBot(skill);
          sim.setLoadout(p.id, sanitizeLoadout({ weapon: WEAPON_IDS[w], utils: ['bouncePad', 'airGrenade'] }));
          return { p, w };
        });
        sim.startMatch();
        for (let t = 0; t < minutes * 3600; t++) {
          sim.step();
          sim.drainEvents();
        }
        for (const { p, w } of bots) won[w][w === i ? j : i] += p.stats.kos;
      }
    }
  }
  console.log(`\nDuels (${runs} x ${minutes} min per pair): share of the knockouts each row weapon scored against each column`);
  const short = (w: WeaponId) => WEAPON_INFO[w].name.split(' ').map((x) => x.slice(0, 4)).join(' ');
  console.log(`${''.padEnd(18)}${WEAPON_IDS.map((w) => short(w).padStart(11)).join('')}${'overall'.padStart(11)}`);
  for (let i = 0; i < n; i++) {
    let mine = 0;
    let total = 0;
    const cells = WEAPON_IDS.map((_, j) => {
      if (i === j) return '-';
      const t = won[i][j] + won[j][i];
      mine += won[i][j];
      total += t;
      return t ? `${Math.round((100 * won[i][j]) / t)}%` : '-';
    });
    console.log(`${WEAPON_INFO[WEAPON_IDS[i]].name.padEnd(18)}${cells.map((c) => c.padStart(11)).join('')}${`${Math.round((100 * mine) / Math.max(1, total))}%`.padStart(11)}`);
  }
}
