export type Vec3Tuple = [number, number, number];

/** What a solid looks like. The renderer picks materials from this; the simulation ignores it. */
export type SolidKind =
  | 'lot' // main asphalt deck
  | 'island' // smaller floating slab
  | 'concrete'
  | 'building'
  | 'glass'
  | 'crate'
  | 'platform' // moving platform / flatbed
  | 'bouncy' // soft inflatable surface
  | 'goal' // goal frame in the Ball arena
  | 'pillar'
  | 'hidden'; // collision only, drawn by a decor entry instead

export interface MoverDef {
  /** Offset reached at the far end of the ping-pong path. */
  dx: number;
  dy: number;
  dz: number;
  /** Seconds for a full there-and-back cycle. */
  period: number;
  /** 0..1 phase offset of the cycle. */
  phase?: number;
}

export interface SolidDef {
  min: Vec3Tuple;
  max: Vec3Tuple;
  kind: SolidKind;
  color?: number;
  /** Top edges can be grabbed while falling. Defaults to true for decks and islands. */
  ledge?: boolean;
  mover?: MoverDef;
  /** Order in which the piece falls away during the final 30 seconds (higher = earlier). */
  collapse?: number;
  /** Rubbery surface: landing on it faster than a walk bounces you back up (restitution). */
  bounce?: number;
}

export interface BouncePadDef {
  x: number;
  y: number;
  z: number;
  /** Half-size of the square pad. */
  half: number;
  /** Upward launch speed. */
  strength: number;
  /** Optional horizontal push. */
  pushX?: number;
  pushZ?: number;
}

/** Client-only scenery. */
export interface DecorDef {
  type: 'car' | 'tubeMan' | 'sign' | 'pole' | 'balloons' | 'bunting' | 'cone' | 'tires' | 'lines' | 'flag' | 'palm' | 'net' | 'turret' | 'umbrella' | 'ferrisWheel';
  x: number;
  y: number;
  z: number;
  rotY?: number;
  scale?: number;
  color?: number;
  /** Extra per-type data (e.g. bunting end point, sign text). */
  data?: Record<string, number | string>;
}

export interface BlastZone {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

export interface MapTheme {
  skyTop: number;
  skyHorizon: number;
  skyBottom: number;
  fog: number;
  sun: number;
  ambient: number;
  cloud: number;
}

export interface MapDef {
  id: string;
  name: string;
  solids: SolidDef[];
  bouncePads: BouncePadDef[];
  /** x, y, z, yaw (players always spawn facing the middle of the map; yaw is informational) */
  spawns: [number, number, number, number][];
  blast: BlastZone;
  decor: DecorDef[];
  theme: MapTheme;
  /** How the main deck tops are painted: parking lines (default) or boardwalk planks. */
  deck?: 'parking' | 'planks';
  /** Spots where soda cans (and the rare pin) appear. */
  pickups: [number, number, number][];
  /** Spawn points per team (x, y, z) for team modes; falls back to `spawns`. */
  teamSpawns?: [[number, number, number][], [number, number, number][]];
  /** Ball mode: where the ball starts and each team's goal volume (the ball entering it scores for the other team). */
  ball?: {
    spawn: Vec3Tuple;
    radius: number;
    goals: { team: 0 | 1; min: Vec3Tuple; max: Vec3Tuple }[];
    /** Ball-only glass fence around the pitch (players pass through; goal mouths stay open). */
    fence?: { minX: number; maxX: number; minZ: number; maxZ: number; height: number };
  };
  /** Pump mode: pumps each team stands on, and where their giant tube man stands. */
  pumps?: { team: 0 | 1; x: number; y: number; z: number; r: number }[];
  giants?: { team: 0 | 1; x: number; y: number; z: number }[];
  /** Maps made for a specific mode say so; others work for the knockout modes. */
  modes?: string[];
}
