import { INPUT_BYTES, type InputFrame, readInput, writeInput } from './input';
import { type Features, MODE_DEAD, PLAYER_FIELDS, type PlayerState } from './player';
import type { GameEvent } from './game/events';
import type { DynamicSolidInfo, MatchPhase, MatchResult, ModeId, Pickup } from './game/sim';
import type { Loadout } from './loadout';
import type { ChaosEvent } from './game/chaos';

export const PROTOCOL_VERSION = 2;

// --- Binary message ids -------------------------------------------------------------------
export const MSG_INPUTS = 1;
export const MSG_SNAPSHOT = 2;

// --- JSON messages ------------------------------------------------------------------------

export type JoinRequest =
  | { kind: 'quick' }
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
  | { type: 'hello'; v: number; name: string; guestId: string; join: JoinRequest; loadout?: Loadout }
  | { type: 'loadout'; loadout: Loadout }
  | { type: 'ping'; t: number }
  | { type: 'name'; name: string }
  | { type: 'host'; action: 'kick'; id: number }
  | { type: 'host'; action: 'settings'; settings: Partial<RoomSettings> }
  | { type: 'host'; action: 'restart' };

export interface RosterEntry {
  id: number;
  name: string;
  color: number;
  bot: boolean;
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
}

export type ServerMessage =
  | { type: 'welcome'; v: number; you: number; room: RoomInfo; tick: number; name: string }
  | { type: 'room'; room: RoomInfo }
  | { type: 'roster'; players: RosterEntry[] }
  | { type: 'match'; phase: MatchPhase; endsAtTick: number; number: number; result: MatchResult | null }
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
  | { type: 'error'; code: 'full' | 'not_found' | 'version' | 'kicked' | 'bad_name' | 'server'; message: string };

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

export interface Snapshot {
  tick: number;
  ackSeq: number;
  selfId: number;
  self: PlayerState | null;
  players: PublicPlayer[];
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
): ArrayBuffer {
  const selfBytes = self ? PLAYER_FIELDS.length * 4 : 0;
  const buf = new ArrayBuffer(1 + 4 + 4 + 1 + 1 + selfBytes + 1 + players.length * PUBLIC_BYTES);
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
  return buf;
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
  return { tick, ackSeq, selfId, self, players };
}

export function isAlive(p: PublicPlayer): boolean {
  return p.mode !== MODE_DEAD;
}
