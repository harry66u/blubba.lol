/** Discrete things that happen in a match. Sent to clients as JSON and used for effects. */
export type GameEvent =
  | { t: 'shot'; tick: number; id: number; owner: number; w: number; x: number; y: number; z: number; vx: number; vy: number; vz: number; r: number; power: number; cs?: number }
  | { t: 'boom'; tick: number; id: number; x: number; y: number; z: number; r: number; power: number; owner: number }
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
  | { t: 'grapple'; tick: number; id: number; target: number; x: number; y: number; z: number; miss: boolean };

export type GameEventType = GameEvent['t'];
