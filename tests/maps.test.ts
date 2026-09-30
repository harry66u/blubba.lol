import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/shared/balance';
import { GameSim } from '../src/shared/game/sim';
import { collapsePlan } from '../src/shared/game/shrink';
import { KNOCKOUT_MAPS, MAPS, getMap, homeMapFor, mapsForMode } from '../src/shared/maps';
import type { MapDef } from '../src/shared/maps/types';
import { MODE_DEAD } from '../src/shared/player';
import { World } from '../src/shared/world';
import { Driver, run } from './helpers';

/**
 * Sanity checks every knockout map has to pass (the new ones especially): players spawn on solid
 * ground inside the play area and can walk or jump between every spawn, the collapse orders make
 * the mid-match shrink and the final collapse work, and nothing is left floating when the piece
 * under it sinks.
 */

/** Places a player standing still at (x, y, z). */
function place(sim: GameSim, id: number, x: number, y: number, z: number) {
  const p = sim.players.get(id)!;
  Object.assign(p.state, { px: x, py: y + 0.01, pz: z, vx: 0, vy: 0, vz: 0, spawnProt: 0, onGround: 1 });
}

interface Node {
  x: number;
  z: number;
  y: number;
}

/**
 * Every spot on the map a player could stand (a 0.5 m grid of floor tops with head room), and
 * which spots lead to which by walking, jumping up to a single jump's height, dropping down, or
 * jumping a gap of up to 4 m (a running double jump). Bounce pads and movers are left out on
 * purpose: spawns must connect without them.
 */
function standGraph(map: MapDef) {
  const world = new World(map);
  const g = 0.5;
  const nodes: Node[] = [];
  const cells = new Map<string, number[]>();
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const s of world.solids) {
    if (s.mover) continue;
    minX = Math.min(minX, s.minX);
    maxX = Math.max(maxX, s.maxX);
    minZ = Math.min(minZ, s.minZ);
    maxZ = Math.max(maxZ, s.maxZ);
  }
  const statics = world.solids.filter((s) => !s.mover);
  for (let ix = Math.floor(minX / g); ix <= Math.ceil(maxX / g); ix++) {
    for (let iz = Math.floor(minZ / g); iz <= Math.ceil(maxZ / g); iz++) {
      const x = ix * g + 0.01;
      const z = iz * g + 0.01;
      const col = statics.filter((s) => x >= s.minX && x <= s.maxX && z >= s.minZ && z <= s.maxZ);
      const ids: number[] = [];
      for (const s of col) {
        const y = s.maxY;
        // Head room: nothing else in this column between the feet and head height.
        if (col.some((o) => o !== s && o.minY < y + 2 && o.maxY > y + 0.05)) continue;
        if (ids.some((i) => Math.abs(nodes[i].y - y) < 0.01)) continue;
        ids.push(nodes.length);
        nodes.push({ x, z, y });
      }
      if (ids.length) cells.set(`${ix},${iz}`, ids);
    }
  }
  const jump = (BALANCE.player.jumpVelocity * BALANCE.player.jumpVelocity) / (2 * BALANCE.player.gravity);
  const near = (n: Node, r: number) => {
    const out: number[] = [];
    const ix = Math.round((n.x - 0.01) / g);
    const iz = Math.round((n.z - 0.01) / g);
    const k = Math.ceil(r / g);
    for (let dx = -k; dx <= k; dx++) for (let dz = -k; dz <= k; dz++) for (const i of cells.get(`${ix + dx},${iz + dz}`) ?? []) out.push(i);
    return out;
  };
  const edges = nodes.map((a) => {
    const out: number[] = [];
    for (const j of near(a, 4)) {
      const b = nodes[j];
      const d = Math.hypot(b.x - a.x, b.z - a.z);
      if (d < 0.01 || d > 4) continue;
      const rise = b.y - a.y;
      // Next door: walk, climb a jump's height, or drop down. Further: jump a gap at about the same height.
      const ok = d <= g * 1.5 ? rise <= jump - 0.05 && rise >= -12 : rise <= 0.8 && rise >= -6;
      if (ok) out.push(j);
    }
    return out;
  });
  const at = (x: number, y: number, z: number) => {
    const ids = near({ x, y, z }, g);
    let best = -1;
    let bestD = Infinity;
    for (const i of ids) {
      const n = nodes[i];
      if (Math.abs(n.y - y) > 0.05) continue;
      const d = Math.hypot(n.x - x, n.z - z);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  };
  const reach = (from: number, back = false) => {
    const rev: number[][] = back ? nodes.map(() => []) : [];
    if (back) edges.forEach((out, i) => out.forEach((j) => rev[j].push(i)));
    const seen = new Uint8Array(nodes.length);
    const queue = [from];
    seen[from] = 1;
    while (queue.length) {
      const i = queue.pop()!;
      for (const j of back ? rev[i] : edges[i]) {
        if (!seen[j]) {
          seen[j] = 1;
          queue.push(j);
        }
      }
    }
    return seen;
  };
  return { at, reach };
}

describe.each(KNOCKOUT_MAPS)('map %s', (id) => {
  const map = getMap(id);

  it('has a name, an icon for the menus, and 6-10 spawns', () => {
    expect(map.name.length).toBeGreaterThan(2);
    expect(map.icon).toBeTruthy();
    expect(map.spawns.length).toBeGreaterThanOrEqual(6);
    expect(map.spawns.length).toBeLessThanOrEqual(10);
  });

  it('spawns are well inside the blast zone and a player spawned there just stands', () => {
    const B = map.blast;
    for (const [x, y, z] of map.spawns) {
      expect(x - B.minX).toBeGreaterThan(20);
      expect(B.maxX - x).toBeGreaterThan(20);
      expect(z - B.minZ).toBeGreaterThan(20);
      expect(B.maxZ - z).toBeGreaterThan(20);
      expect(y - B.minY).toBeGreaterThan(20);
    }
    const sim = new GameSim({ map, mode: 'knockout', durationSec: 999 });
    sim.eventMult = 0;
    const p = sim.addPlayer('p');
    const d = new Driver(sim, p);
    run(sim, [d], 10);
    for (const [x, y, z] of map.spawns) {
      place(sim, p.id, x, y, z);
      run(sim, [d], 120);
      expect(p.state.mode, `${x},${z}`).not.toBe(MODE_DEAD);
      expect(p.state.onGround, `${x},${z}`).toBe(1);
      expect(Math.hypot(p.state.px - x, p.state.py - y, p.state.pz - z), `${x},${z}`).toBeLessThan(0.3);
    }
  });

  it('every spawn can reach every other one on foot (no pads or movers needed)', () => {
    const graph = standGraph(map);
    const ids = map.spawns.map(([x, y, z]) => graph.at(x, y, z));
    for (const i of ids) expect(i).toBeGreaterThanOrEqual(0);
    const fwd = graph.reach(ids[0]);
    const back = graph.reach(ids[0], true);
    map.spawns.forEach(([x, , z], k) => {
      expect(fwd[ids[k]], `reach ${x},${z}`).toBe(1);
      expect(back[ids[k]], `back from ${x},${z}`).toBe(1);
    });
  });

  it('collapse orders make the shrink and the final collapse work', () => {
    const orders = map.solids.map((s) => s.collapse).filter((c): c is number => c !== undefined);
    for (const o of orders) expect([0, 1, 2, 3]).toContain(o);
    // One main deck (the biggest floor) that crumbles inward; outer pieces that sink at half time.
    const decks = map.solids.filter((s) => s.collapse === 0);
    expect(decks).toHaveLength(1);
    const area = (s: (typeof map.solids)[number]) => (s.max[0] - s.min[0]) * (s.max[2] - s.min[2]);
    for (const s of map.solids) expect(area(s)).toBeLessThanOrEqual(area(decks[0]));
    expect(orders).toContain(3);
    // Spawns stay usable until the final 30 seconds.
    const world = new World(map);
    for (const [x, y, z] of map.spawns) {
      const under = world.solids.find((s) => Math.abs(s.maxY - y) < 0.01 && x >= s.minX && x <= s.maxX && z >= s.minZ && z <= s.maxZ)!;
      expect(under, `${x},${z}`).toBeTruthy();
      expect(under.collapse, `${x},${z}`).toBeLessThanOrEqual(1);
    }
    // At the very end of a match there's still somewhere to respawn.
    world.setCollapse(collapsePlan('knockout', map, 240, 240));
    world.setTime(239.9);
    const left = map.spawns.filter(([x, y, z]) => world.groundBelow(x, y + 0.1, z, 0.6) !== null);
    expect(left.length).toBeGreaterThanOrEqual(2);
  });

  it('nothing is left floating when the piece under it sinks', () => {
    const overlap = (a: number, b: number, c: number, d: number) => Math.min(b, d) - Math.max(a, c) > 0.01;
    map.solids.forEach((a, i) => {
      if (a.mover) return;
      map.solids.forEach((b, j) => {
        if (i === j || (b.collapse ?? 0) < 1 || b.mover) return;
        const rests = Math.abs(a.min[1] - b.max[1]) < 0.01 && overlap(a.min[0], a.max[0], b.min[0], b.max[0]) && overlap(a.min[2], a.max[2], b.min[2], b.max[2]);
        if (rests) expect(a.collapse, `solid ${i} on ${j}`).toBe(b.collapse);
      });
    });
    for (const d of map.decor) {
      if (d.ride === undefined) continue;
      const s = map.solids[d.ride];
      expect(s, `${d.type} rides ${d.ride}`).toBeTruthy();
      expect((s.collapse ?? 0) >= 1 || !!s.mover, `${d.type} rides ${d.ride}`).toBe(true);
    }
    // Bounce pads sit on something.
    const world = new World(map);
    for (const pad of map.bouncePads) expect(world.groundBelow(pad.x, pad.y + 0.1, pad.z, 0.2), `pad ${pad.x},${pad.z}`).toBe(pad.y);
  });
});

it('every map id is unique and knockout maps are all registered', () => {
  for (const id of KNOCKOUT_MAPS) expect(MAPS[id]?.id).toBe(id);
  expect(new Set(KNOCKOUT_MAPS).size).toBe(KNOCKOUT_MAPS.length);
  expect(KNOCKOUT_MAPS.length).toBeGreaterThanOrEqual(7);
});

describe('Face-Off (the Team Knockout map)', () => {
  const map = getMap('faceoff');

  it('is where Team Knockout plays, and stays out of the free-for-all rotation', () => {
    expect(map.id).toBe('faceoff');
    expect(homeMapFor('teamKnockout')).toBe('faceoff');
    expect(mapsForMode('teamKnockout')[0]).toBe('faceoff');
    expect(mapsForMode('knockout')).not.toContain('faceoff');
    expect(KNOCKOUT_MAPS).not.toContain('faceoff');
    expect(map.teamSpawns).toBeTruthy();
  });

  it('is mirrored left to right: every piece, pad, can and spawn has a twin, with the team paint swapped', () => {
    const same = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]) < 1e-6);
    for (const s of map.solids) {
      const twin = map.solids.find(
        (t) => t.kind === s.kind && t.collapse === s.collapse && same(t.min, [-s.max[0], s.min[1], s.min[2]]) && same(t.max, [-s.min[0], s.max[1], s.max[2]]),
      );
      expect(twin, `${s.kind} ${s.min} ${s.max}`).toBeTruthy();
      const swapped = s.paint === 0 ? 1 : s.paint === 1 ? 0 : s.paint;
      expect(twin!.paint, `${s.kind} ${s.min}`).toBe(swapped);
    }
    for (const p of map.bouncePads) expect(map.bouncePads.some((q) => same([q.x, q.y, q.z, q.pushX ?? 0], [-p.x, p.y, p.z, -(p.pushX ?? 0)]))).toBe(true);
    for (const [x, y, z] of map.pickups) expect(map.pickups.some((q) => same(q, [-x, y, z]))).toBe(true);
    const [red, blue] = map.teamSpawns!;
    expect(red).toHaveLength(blue.length);
    for (const [x, y, z] of red) expect(blue.some((q) => same(q, [-x, y, z]))).toBe(true);
  });

  it('each team spawns on its own side, standing on ground that lasts until the final 30 seconds', () => {
    const world = new World(map);
    const sim = new GameSim({ map, mode: 'teamKnockout', durationSec: 999 });
    sim.eventMult = 0;
    const p = sim.addPlayer('p');
    const d = new Driver(sim, p);
    map.teamSpawns!.forEach((list, team) => {
      for (const [x, y, z] of list) {
        expect(team === 0 ? x < -25 : x > 25, `${x},${z}`).toBe(true);
        const under = world.solids.find((s) => Math.abs(s.maxY - y) < 0.01 && x >= s.minX && x <= s.maxX && z >= s.minZ && z <= s.maxZ);
        expect(under?.collapse, `${x},${z}`).toBeLessThanOrEqual(1);
        place(sim, p.id, x, y, z);
        run(sim, [d], 120);
        expect(p.state.mode, `${x},${z}`).not.toBe(MODE_DEAD);
        expect(p.state.onGround, `${x},${z}`).toBe(1);
      }
    });
  });

  it('both bases reach each other and the center hill on foot (no pads needed)', () => {
    const graph = standGraph(map);
    const red = graph.at(...map.teamSpawns![0][0]);
    const blue = graph.at(...map.teamSpawns![1][0]);
    const hill = graph.at(0, 1.1, 0);
    for (const i of [red, blue, hill]) expect(i).toBeGreaterThanOrEqual(0);
    const fromRed = graph.reach(red);
    const toRed = graph.reach(red, true);
    for (const i of [blue, hill]) {
      expect(fromRed[i]).toBe(1);
      expect(toRed[i]).toBe(1);
    }
  });

  it('shrinks like the knockout maps, and both teams can still come back in at the very end', () => {
    const orders = new Set(map.solids.map((s) => s.collapse).filter((c) => c !== undefined));
    expect([...orders].sort()).toEqual([0, 1, 2, 3]);
    expect(map.solids.filter((s) => s.collapse === 0)).toHaveLength(1);
    const plan = collapsePlan('teamKnockout', map, 240, 240);
    // Half time: only the little islands (the highest order) go.
    expect(plan.find((st) => st.announce)).toMatchObject({ at: 120, sink: [3] });
    const sim = new GameSim({ map, mode: 'teamKnockout', durationSec: 240 });
    sim.eventMult = 0;
    const a = sim.addPlayer('a');
    const b = sim.addPlayer('b');
    a.team = 0;
    b.team = 1;
    sim.world.setCollapse(plan);
    sim.world.setTime(239.9);
    // Every base spawn is gone by now; each team comes back in on its own half of the middle.
    for (const [x, y, z] of [...map.teamSpawns![0], ...map.teamSpawns![1]]) expect(sim.world.groundBelow(x, y + 0.1, z, 0.6)).toBeNull();
    for (const p of [a, b]) {
      const [x, y, z] = (sim as unknown as { pickSpawn(id: number): [number, number, number, number] }).pickSpawn(p.id);
      expect(sim.world.groundBelow(x, y + 0.1, z, 0.6), `${x},${z}`).not.toBeNull();
      expect(p.team === 0 ? x < 0 : x > 0).toBe(true);
    }
  });
});
