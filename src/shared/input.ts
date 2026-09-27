/**
 * One fixed-step (1/60 s) worth of player input.
 *
 * One-shot actions are sent as wrapping 8-bit press counters instead of edge bits so a press
 * is never lost, even if the server has to skip or merge input frames.
 */
export interface InputFrame {
  seq: number;
  /** Server tick the client expects this input to run on (used for moving platforms). */
  tick: number;
  /** Server tick of the world the player was looking at (for lag-compensated hitscan). */
  viewTick: number;
  /** Strafe: -1 (left) .. 1 (right). */
  moveX: number;
  /** Forward: -1 (back) .. 1 (forward). */
  moveZ: number;
  yaw: number;
  pitch: number;
  /** Held-button bits (see BTN_*). */
  buttons: number;
  jump: number;
  dash: number;
  brace: number;
  grab: number;
  grapple: number;
  reload: number;
  util1: number;
  util2: number;
  taunt: number;
}

export const BTN_FIRE = 1;
export const BTN_JUMP = 2;
export const BTN_GRAB = 4;

export const PRESS_KEYS = ['jump', 'dash', 'brace', 'grab', 'grapple', 'reload', 'util1', 'util2', 'taunt'] as const;
export type PressKey = (typeof PRESS_KEYS)[number];

export function emptyInput(): InputFrame {
  return {
    seq: 0,
    tick: 0,
    viewTick: 0,
    moveX: 0,
    moveZ: 0,
    yaw: 0,
    pitch: 0,
    buttons: 0,
    jump: 0,
    dash: 0,
    brace: 0,
    grab: 0,
    grapple: 0,
    reload: 0,
    util1: 0,
    util2: 0,
    taunt: 0,
  };
}

/** Number of new presses between two wrapping 8-bit counters. */
export function pressesSince(now: number, before: number): number {
  return (now - before + 256) & 255;
}

export const INPUT_BYTES = 4 + 4 + 4 + 1 + 1 + 2 + 2 + 1 + PRESS_KEYS.length;

const TWO_PI = Math.PI * 2;

export function writeInput(view: DataView, o: number, f: InputFrame): number {
  view.setUint32(o, f.seq >>> 0);
  view.setUint32(o + 4, f.tick >>> 0);
  view.setUint32(o + 8, Math.max(0, Math.round(f.viewTick)) >>> 0);
  o += 4;
  view.setInt8(o + 8, Math.round(Math.max(-1, Math.min(1, f.moveX)) * 127));
  view.setInt8(o + 9, Math.round(Math.max(-1, Math.min(1, f.moveZ)) * 127));
  const yaw = ((f.yaw % TWO_PI) + TWO_PI) % TWO_PI;
  view.setUint16(o + 10, Math.round((yaw / TWO_PI) * 65535));
  view.setInt16(o + 12, Math.round(Math.max(-1.6, Math.min(1.6, f.pitch)) * 20000));
  view.setUint8(o + 14, f.buttons & 255);
  let p = o + 15;
  for (const k of PRESS_KEYS) view.setUint8(p++, f[k] & 255);
  return p;
}

export function readInput(view: DataView, o: number, f: InputFrame): number {
  f.seq = view.getUint32(o);
  f.tick = view.getUint32(o + 4);
  f.viewTick = view.getUint32(o + 8);
  o += 4;
  f.moveX = view.getInt8(o + 8) / 127;
  f.moveZ = view.getInt8(o + 9) / 127;
  f.yaw = (view.getUint16(o + 10) / 65535) * TWO_PI;
  f.pitch = view.getInt16(o + 12) / 20000;
  f.buttons = view.getUint8(o + 14);
  let p = o + 15;
  for (const k of PRESS_KEYS) f[k] = view.getUint8(p++);
  return p;
}

/** Quantize a frame exactly as the network would, so client prediction matches the server. */
export function quantizeInput(f: InputFrame): void {
  f.moveX = Math.round(Math.max(-1, Math.min(1, f.moveX)) * 127) / 127;
  f.moveZ = Math.round(Math.max(-1, Math.min(1, f.moveZ)) * 127) / 127;
  const yaw = ((f.yaw % TWO_PI) + TWO_PI) % TWO_PI;
  f.yaw = (Math.round((yaw / TWO_PI) * 65535) / 65535) * TWO_PI;
  f.pitch = Math.round(Math.max(-1.6, Math.min(1.6, f.pitch)) * 20000) / 20000;
}
