/** Discrete things that happen in a match. Sent to clients as JSON and used for effects. */
export type GameEvent =
  | { t: 'shot'; tick: number; id: number; owner: number; w: number; x: number; y: number; z: number; vx: number; vy: number; vz: number; r: number; power: number; cs?: number; g?: number }
  | { t: 'proj'; tick: number; id: number; x: number; y: number; z: number; vx: number; vy: number; vz: number }
  | { t: 'boom'; tick: number; id: number; x: number; y: number; z: number; r: number; power: number; owner: number; k?: number }
  | { t: 'fizzle'; tick: number; id: number; x: number; y: number; z: number }
  | {
      t: 'hit';
      tick: number;
      target: number;
      attacker: number;
      x: number;
      y: number;
      z: number;
      dx: number;
      dy: number;
      dz: number;
      speed: number;
      direct: boolean;
      low: boolean;
      braced: boolean;
      infl: number;
      /** Hits in the current air combo (1 = not a combo). */
      combo: number;
    }
  | { t: 'shield'; tick: number; target: number; x: number; y: number; z: number }
  | { t: 'blastjump'; tick: number; id: number }
  | { t: 'ko'; tick: number; victim: number; killer: number; x: number; y: number; z: number; vx: number; vy: number; vz: number; points: number; tags: string[] }
  | { t: 'spawn'; tick: number; id: number; x: number; y: number; z: number }
  | { t: 'move'; tick: number; id: number; kind: 'jump' | 'spring' | 'djump' | 'dash' | 'slide' | 'land' | 'pad' | 'ledge' | 'climb' | 'wall' | 'bounce' | 'tech'; x: number; y: number; z: number; v?: number; long?: boolean }
  | { t: 'brace'; tick: number; id: number }
  | { t: 'taunt'; tick: number; id: number; n: number }
  | { t: 'reload'; tick: number; id: number }
  | { t: 'grab'; tick: number; id: number; target: number; drag: boolean }
  | { t: 'throw'; tick: number; id: number; target: number }
  | { t: 'escape'; tick: number; id: number; from: number }
  | { t: 'escapeFail'; tick: number; id: number; early: boolean }
  | { t: 'stomp'; tick: number; id: number; target: number; x: number; y: number; z: number }
  | { t: 'grapple'; tick: number; id: number; target: number; x: number; y: number; z: number; miss: boolean }
  | { t: 'honk'; tick: number; id: number; x: number; y: number; z: number; dx: number; dy: number; dz: number; power: number; range: number; cone: number }
  | { t: 'tracer'; tick: number; id: number; x: number; y: number; z: number; x2: number; y2: number; z2: number; hit: boolean; power: number }
  | { t: 'blow'; tick: number; id: number; target: number }
  | { t: 'pop'; tick: number; id: number; target: number; x: number; y: number; z: number }
  | { t: 'vacuum'; tick: number; id: number; x: number; y: number; z: number; until: number }
  | { t: 'solid'; tick: number; id: number; min: [number, number, number]; max: [number, number, number]; until: number; raft: boolean }
  | { t: 'solidGone'; tick: number; id: number }
  | { t: 'pad'; tick: number; id: number; x: number; y: number; z: number; half: number; strength: number; until: number }
  | { t: 'padGone'; tick: number; id: number }
  | { t: 'chaos'; tick: number; kind: 'fan' | 'lowGravity' | 'ice' | 'maxInflate'; announceTick: number; startTick: number; endTick: number; dirX: number; dirZ: number }
  | { t: 'chain'; tick: number; id: number; target: number; by: number; x: number; y: number; z: number }
  | { t: 'crown'; tick: number; id: number }
  /** Streak reward earned: Turbo Tank, Mega Blast, or both. */
  | { t: 'streak'; tick: number; id: number; kind: 'turbo' | 'mega' | 'both'; n: number }
  | { t: 'final'; tick: number }
  | { t: 'goal'; tick: number; team: 0 | 1; scorer: number; x: number; y: number; z: number }
  | { t: 'ballOut'; tick: number; x: number; y: number; z: number }
  | { t: 'ballReset'; tick: number }
  | { t: 'pumpFull'; tick: number; team: 0 | 1 }
  | { t: 'loadout'; tick: number; id: number; weapon: string; mods: string[]; utils: string[] }
  | { t: 'pickup'; tick: number; id: number; kind: 'soda' | 'pin'; x: number; y: number; z: number; active: boolean; by: number }
  /** A supply crate appeared high above (x, y, z) and sinks at `fall` m/s toward the ground at `groundY`. */
  | { t: 'loot'; tick: number; id: number; x: number; y: number; z: number; groundY: number; fall: number }
  | { t: 'lootLand'; tick: number; id: number; x: number; y: number; z: number }
  | { t: 'lootGrab'; tick: number; id: number; by: number; kind: LootKind; x: number; y: number; z: number }
  | { t: 'lootGone'; tick: number; id: number; x: number; y: number; z: number; why: 'expired' | 'lost' | 'reset' }
  /** An Air Mine stuck to the ground (`proj` is the thrown projectile it came from). It arms at tick `arm`. */
  | { t: 'mine'; tick: number; id: number; proj: number; owner: number; x: number; y: number; z: number; arm: number }
  | { t: 'mineGone'; tick: number; id: number; owner: number; x: number; y: number; z: number; boom: boolean }
  /** A Helium Bomb cloud (radius `r`) that lasts until tick `until`. */
  | { t: 'helium'; tick: number; id: number; owner: number; x: number; y: number; z: number; r: number; until: number }
  /** A player started floating (Helium Bomb) until tick `until`. */
  | { t: 'floaty'; tick: number; id: number; by: number; until: number }
  /** A Tornado started at (x, y, z) heading (dx, dz) at `speed` m/s until tick `until`. */
  | { t: 'tornado'; tick: number; id: number; owner: number; x: number; y: number; z: number; dx: number; dz: number; speed: number; until: number }
  | { t: 'tornadoGone'; tick: number; id: number; x: number; y: number; z: number }
  | { t: 'swept'; tick: number; id: number; target: number; x: number; y: number; z: number };

/** What a supply crate can hold. */
export type LootKind = 'deflate' | 'mega' | 'turbo' | 'gadgets' | 'feather' | 'spring';

export type GameEventType = GameEvent['t'];
