import { INPUT_BYTES, type InputFrame, readInput, writeInput } from './input';
import { type Features, MODE_DEAD, PLAYER_FIELDS, type PlayerState } from './player';
import type { GameEvent } from './game/events';
import type { DynamicSolidInfo, MatchPhase, MatchResult, ModeId, Pickup } from './game/sim';
import type { Loadout } from './loadout';
import type { ChaosEvent } from './game/chaos';
import type { ShrinkStage } from './game/shrink';
import type { Cosmetics, ProgressReport, ReportReason } from './economy';

export const PROTOCOL_VERSION = 6;

// --- Binary message ids -------------------------------------------------------------------
export const MSG_INPUTS = 1;
export const MSG_SNAPSHOT = 2;

// --- JSON messages ------------------------------------------------------------------------

export type JoinRequest =
  | { kind: 'quick'; mode?: ModeId }
  /** Private 1v1 room whose code is shared as a challenge link. */
  | { kind: 'challenge' }
  /** Ranked 1v1 matchmaking (needs an account). */
  | { kind: 'ranked' }
  | { kind: 'create'; settings?: Partial<RoomSettings> }
  | { kind: 'code'; code: string };

export type EventFrequency = 'off' | 'rare' | 'normal' | 'frequent';
export const EVENT_MULT: Record<EventFrequency, number> = { off: 0, rare: 0.5, normal: 1, frequent: 2 };

export interface RoomSettings {
  mode: ModeId;
  mapId: string;
  durationSec: number;
  bots: boolean;
  events: EventFrequency;
}

export type ClientMessage =
  | { type: 'hello'; v: number; name: string; guestId: string; join: JoinRequest; loadout?: Loadout; token?: string }
  /** Quick-chat preset (index into QUICK_CHAT). There is no free text. */
  | { type: 'chat'; id: number }
  | { type: 'report'; target: number; reason: ReportReason }
  | { type: 'loadout'; loadout: Loadout }
  | { type: 'ping'; t: number }
  | { type: 'name'; name: string }
  | { type: 'host'; action: 'kick'; id: number }
  | { type: 'host'; action: 'settings'; settings: Partial<RoomSettings> }
  | { type: 'host'; action: 'restart' }
  /** Only honored when the server runs with BUBBA_DEBUG=1 (for testing events quickly). */
  | { type: 'debug'; action: 'chaos'; kind: string }
  | { type: 'debug'; action: 'endIn'; seconds: number }
  | { type: 'debug'; action: 'bots'; count: number }
  | { type: 'debug'; action: 'streak'; count: number };

export interface RosterEntry {
  id: number;
  name: string;
  color: number;
  bot: boolean;
  /** 0/1 in team modes, -1 otherwise. */
  team: number;
  /** What they look like (color, hat, taunt, ...). */
  cos: Cosmetics;
  /** Player level (0 for bots). */
  level: number;
  /** Ranked rooms only. */
  rating?: number;
  /** Sudden Death: popped out of this match (or joined late), watching until the next one. */
  out?: boolean;
  score: number;
  kos: number;
  deaths: number;
  ping: number;
}

export interface RoomInfo {
  code: string;
  isPrivate: boolean;
  hostId: number;
  mapId: string;
  settings: RoomSettings;
  features: Features;
  /** A private 1v1 made from a challenge link. */
  challenge: boolean;
  ranked: boolean;
}

export type ServerMessage =
  | { type: 'welcome'; v: number; you: number; room: RoomInfo; tick: number; name: string }
  | { type: 'room'; room: RoomInfo }
  | { type: 'roster'; players: RosterEntry[] }
  /** `collapse`: when each part of the map falls away this match, so prediction's world matches the server's. */
  | { type: 'match'; phase: MatchPhase; endsAtTick: number; number: number; result: MatchResult | null; collapse: ShrinkStage[] }
  | { type: 'ev'; list: GameEvent[] }
  | {
      type: 'entities';
      pickups: Pickup[];
      solids: DynamicSolidInfo[];
      pads: { id: number; x: number; y: number; z: number; half: number; strength: number; until: number }[];
      chaos: (ChaosEvent | null)[];
      crownId: number;
    }
  | { type: 'pong'; t: number; tick: number }
  /** Ranked matchmaking status while you wait. */
  | { type: 'queue'; seconds: number; searching: number; rating: number }
  /** XP, coins, unlocks (and rating) earned in the match that just ended. */
  | { type: 'progress'; report: ProgressReport }
  | { type: 'chat'; from: number; id: number }
  /** Your name was changed (e.g. after several players reported it). */
  | { type: 'renamed'; name: string; message: string }
  | { type: 'error'; code: 'full' | 'not_found' | 'version' | 'kicked' | 'bad_name' | 'server' | 'account_required' | 'already' | 'ranked_over'; message: string };

// --- Inputs (client -> server) --------------------------------------------------------------

export function encodeInputs(frames: InputFrame[]): ArrayBuffer {
  const buf = new ArrayBuffer(2 + frames.length * INPUT_BYTES);
  const view = new DataView(buf);
  view.setUint8(0, MSG_INPUTS);
  view.setUint8(1, frames.length);
  let o = 2;
  for (const f of frames) o = writeInput(view, o, f);
  return buf;
}

export function decodeInputs(view: DataView, make: () => InputFrame): InputFrame[] {
  const n = view.getUint8(1);
  if (view.byteLength < 2 + n * INPUT_BYTES) return [];
  const out: InputFrame[] = [];
  let o = 2;
  for (let i = 0; i < n; i++) {
    const f = make();
    o = readInput(view, o, f);
    out.push(f);
  }
  return out;
}

// --- Snapshots (server -> client) -----------------------------------------------------------

export const FLAG_GROUND = 1;
export const FLAG_LAUNCHED = 2;
export const FLAG_BRACING = 4;
export const FLAG_CHARGING = 8;
export const FLAG_DOUBLED = 16;
export const FLAG_PROTECTED = 32;
export const FLAG_DASHING = 64;
export const FLAG_SLIDING = 128;
export const FLAG_RELOADING = 256;
export const FLAG_HOVER = 512;
export const FLAG_ZIP = 1024;
export const FLAG_PIN = 2048;
export const FLAG_STREAM = 4096;
export const FLAG_BLOWN = 8192;
export const FLAG_CROWN = 16384;
/** Has a streak reward active (Turbo Tank or Mega Blast shots left). */
export const FLAG_POWERED = 32768;

/** What every client knows about every player (interpolated for rendering). */
export interface PublicPlayer {
  id: number;
  px: number;
  py: number;
  pz: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  pitch: number;
  inflation: number;
  mode: number;
  flags: number;
  charge: number;
  heldBy: number;
  holding: number;
  dashCharges: number;
  hangAngle: number;
  weapon: number;
}

/** Per-mode state that changes every tick (team scores, the ball, pump fill). */
export interface ModeState {
  teamScores: [number, number] | null;
  ball: { x: number; y: number; z: number; vx: number; vy: number; vz: number; inPlay: boolean } | null;
  pump: { fill: [number, number]; states: number[] } | null;
}

export interface Snapshot {
  tick: number;
  ackSeq: number;
  selfId: number;
  self: PlayerState | null;
  players: PublicPlayer[];
  mode: ModeState | null;
}

const PUBLIC_BYTES = 1 + 12 + 6 + 2 + 2 + 2 + 1 + 2 + 1 + 1 + 1 + 1 + 1 + 1;
const TWO_PI = Math.PI * 2;

export function publicFlags(s: PlayerState): number {
  let f = 0;
  if (s.onGround) f |= FLAG_GROUND;
  if (s.launchTimer > 0) f |= FLAG_LAUNCHED;
  if (s.braceTimer > 0) f |= FLAG_BRACING;
  if (s.charging) f |= FLAG_CHARGING;
  if (s.doubledTimer > 0) f |= FLAG_DOUBLED;
  if (s.spawnProt > 0) f |= FLAG_PROTECTED;
  if (s.dashTimer > 0) f |= FLAG_DASHING;
  if (s.slideTimer > 0) f |= FLAG_SLIDING;
  if (s.reloadTimer > 0) f |= FLAG_RELOADING;
  if (s.hovering) f |= FLAG_HOVER;
  if (s.zipTimer > 0) f |= FLAG_ZIP;
  if (s.pinTimer > 0) f |= FLAG_PIN;
  if (s.blownTimer > 0) f |= FLAG_BLOWN;
  if (s.turboTimer > 0 || s.megaShots > 0) f |= FLAG_POWERED;
  return f;
}

function clampI16(v: number): number {
  return Math.max(-32768, Math.min(32767, Math.round(v)));
}

export function encodeSnapshot(
  tick: number,
  ackSeq: number,
  selfId: number,
  self: PlayerState | null,
  players: { id: number; state: PlayerState; weapon: number; streaming: boolean; crowned: boolean }[],
  mode: ModeState | null = null,
): ArrayBuffer {
  const selfBytes = self ? PLAYER_FIELDS.length * 4 : 0;
  const buf = new ArrayBuffer(1 + 4 + 4 + 1 + 1 + selfBytes + 1 + players.length * PUBLIC_BYTES + modeBytes(mode));
  const v = new DataView(buf);
  let o = 0;
  v.setUint8(o, MSG_SNAPSHOT);
  o += 1;
  v.setUint32(o, tick >>> 0);
  o += 4;
  v.setUint32(o, ackSeq >>> 0);
  o += 4;
  v.setUint8(o, selfId & 255);
  o += 1;
  v.setUint8(o, self ? 1 : 0);
  o += 1;
  if (self) {
    for (const f of PLAYER_FIELDS) {
      v.setFloat32(o, self[f]);
      o += 4;
    }
  }
  v.setUint8(o, players.length);
  o += 1;
  for (const { id, state: s, weapon, streaming, crowned } of players) {
    v.setUint8(o, id);
    o += 1;
    v.setFloat32(o, s.px);
    v.setFloat32(o + 4, s.py);
    v.setFloat32(o + 8, s.pz);
    o += 12;
    v.setInt16(o, clampI16(s.vx * 50));
    v.setInt16(o + 2, clampI16(s.vy * 50));
    v.setInt16(o + 4, clampI16(s.vz * 50));
    o += 6;
    const yaw = ((s.yaw % TWO_PI) + TWO_PI) % TWO_PI;
    v.setUint16(o, Math.round((yaw / TWO_PI) * 65535));
    o += 2;
    v.setInt16(o, clampI16(s.pitch * 20000));
    o += 2;
    v.setUint16(o, Math.round(Math.max(0, Math.min(1, s.inflation)) * 65535));
    o += 2;
    v.setUint8(o, s.mode);
    o += 1;
    v.setUint16(o, publicFlags(s) | (streaming ? FLAG_STREAM : 0) | (crowned ? FLAG_CROWN : 0));
    o += 2;
    v.setUint8(o, Math.round(Math.max(0, Math.min(1, s.charge)) * 255));
    o += 1;
    v.setUint8(o, (s.heldBy + 1) & 255);
    o += 1;
    v.setUint8(o, (s.holding + 1) & 255);
    o += 1;
    v.setUint8(o, s.dashCharges & 255);
    o += 1;
    const ha = Math.atan2(s.hangNx, s.hangNz);
    v.setUint8(o, Math.round((((ha % TWO_PI) + TWO_PI) % TWO_PI) / TWO_PI * 255) & 255);
    o += 1;
    v.setUint8(o, weapon & 255);
    o += 1;
  }
  if (mode) writeMode(v, o, mode);
  return buf;
}

const MS_TEAMS = 1;
const MS_BALL = 2;
const MS_PUMP = 4;

function modeBytes(m: ModeState | null): number {
  if (!m) return 0;
  return 1 + (m.teamScores ? 4 : 0) + (m.ball ? 19 : 0) + (m.pump ? 5 + m.pump.states.length : 0);
}

function writeMode(v: DataView, o: number, m: ModeState): void {
  v.setUint8(o, (m.teamScores ? MS_TEAMS : 0) | (m.ball ? MS_BALL : 0) | (m.pump ? MS_PUMP : 0));
  o += 1;
  if (m.teamScores) {
    v.setUint16(o, Math.max(0, Math.min(65535, m.teamScores[0])));
    v.setUint16(o + 2, Math.max(0, Math.min(65535, m.teamScores[1])));
    o += 4;
  }
  if (m.ball) {
    const b = m.ball;
    v.setFloat32(o, b.x);
    v.setFloat32(o + 4, b.y);
    v.setFloat32(o + 8, b.z);
    v.setInt16(o + 12, clampI16(b.vx * 50));
    v.setInt16(o + 14, clampI16(b.vy * 50));
    v.setInt16(o + 16, clampI16(b.vz * 50));
    v.setUint8(o + 18, b.inPlay ? 1 : 0);
    o += 19;
  }
  if (m.pump) {
    v.setUint16(o, Math.round(Math.max(0, Math.min(1, m.pump.fill[0])) * 65535));
    v.setUint16(o + 2, Math.round(Math.max(0, Math.min(1, m.pump.fill[1])) * 65535));
    v.setUint8(o + 4, m.pump.states.length);
    o += 5;
    for (const st of m.pump.states) v.setUint8(o++, st);
  }
}

function readMode(v: DataView, o: number): ModeState {
  const bits = v.getUint8(o);
  o += 1;
  const m: ModeState = { teamScores: null, ball: null, pump: null };
  if (bits & MS_TEAMS) {
    m.teamScores = [v.getUint16(o), v.getUint16(o + 2)];
    o += 4;
  }
  if (bits & MS_BALL) {
    m.ball = {
      x: v.getFloat32(o),
      y: v.getFloat32(o + 4),
      z: v.getFloat32(o + 8),
      vx: v.getInt16(o + 12) / 50,
      vy: v.getInt16(o + 14) / 50,
      vz: v.getInt16(o + 16) / 50,
      inPlay: v.getUint8(o + 18) === 1,
    };
    o += 19;
  }
  if (bits & MS_PUMP) {
    const fill: [number, number] = [v.getUint16(o) / 65535, v.getUint16(o + 2) / 65535];
    const n = v.getUint8(o + 4);
    o += 5;
    const states: number[] = [];
    for (let i = 0; i < n; i++) states.push(v.getUint8(o++));
    m.pump = { fill, states };
  }
  return m;
}

export function decodeSnapshot(v: DataView): Snapshot {
  let o = 1;
  const tick = v.getUint32(o);
  o += 4;
  const ackSeq = v.getUint32(o);
  o += 4;
  const selfId = v.getUint8(o);
  o += 1;
  const hasSelf = v.getUint8(o) === 1;
  o += 1;
  let self: PlayerState | null = null;
  if (hasSelf) {
    self = {} as PlayerState;
    for (const f of PLAYER_FIELDS) {
      self[f] = v.getFloat32(o);
      o += 4;
    }
  }
  const n = v.getUint8(o);
  o += 1;
  const players: PublicPlayer[] = [];
  for (let i = 0; i < n; i++) {
    const p: PublicPlayer = {
      id: v.getUint8(o),
      px: v.getFloat32(o + 1),
      py: v.getFloat32(o + 5),
      pz: v.getFloat32(o + 9),
      vx: v.getInt16(o + 13) / 50,
      vy: v.getInt16(o + 15) / 50,
      vz: v.getInt16(o + 17) / 50,
      yaw: (v.getUint16(o + 19) / 65535) * TWO_PI,
      pitch: v.getInt16(o + 21) / 20000,
      inflation: v.getUint16(o + 23) / 65535,
      mode: v.getUint8(o + 25),
      flags: v.getUint16(o + 26),
      charge: v.getUint8(o + 28) / 255,
      heldBy: v.getUint8(o + 29) - 1,
      holding: v.getUint8(o + 30) - 1,
      dashCharges: v.getUint8(o + 31),
      hangAngle: (v.getUint8(o + 32) / 255) * TWO_PI,
      weapon: v.getUint8(o + 33),
    };
    o += PUBLIC_BYTES;
    players.push(p);
  }
  const mode = o < v.byteLength ? readMode(v, o) : null;
  return { tick, ackSeq, selfId, self, players, mode };
}

export function isAlive(p: PublicPlayer): boolean {
  return p.mode !== MODE_DEAD;
}
