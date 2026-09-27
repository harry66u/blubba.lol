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
  | { t: 'move'; tick: number; id: number; kind: 'jump' | 'djump' | 'dash' | 'slide' | 'land' | 'pad' | 'ledge' | 'climb' | 'wall' | 'bounce' | 'tech'; x: number; y: number; z: number; v?: number; long?: boolean }
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
  | { t: 'final'; tick: number }
  | { t: 'goal'; tick: number; team: 0 | 1; scorer: number; x: number; y: number; z: number }
  | { t: 'ballOut'; tick: number; x: number; y: number; z: number }
  | { t: 'ballReset'; tick: number }
  | { t: 'pumpFull'; tick: number; team: 0 | 1 }
  | { t: 'loadout'; tick: number; id: number; weapon: string; mods: string[]; utils: string[] }
  | { t: 'pickup'; tick: number; id: number; kind: 'soda' | 'pin'; x: number; y: number; z: number; active: boolean; by: number };

export type GameEventType = GameEvent['t'];
