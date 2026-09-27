import type { Action } from './input';

/** Standard Gamepad API button indices (Xbox names; PlayStation buttons sit in the same spots). */
export const PAD = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LB: 4,
  RB: 5,
  LT: 6,
  RT: 7,
  VIEW: 8,
  MENU: 9,
  LS: 10,
  RS: 11,
  UP: 12,
  DOWN: 13,
  LEFT: 14,
  RIGHT: 15,
} as const;

export type PadAction = Exclude<Action, 'forward' | 'back' | 'left' | 'right'> | 'menu';

/** Spec §10 controller defaults. */
export const DEFAULT_PAD_BINDINGS: Record<PadAction, number> = {
  fire: PAD.RT,
  grapple: PAD.LT,
  jump: PAD.A,
  dash: PAD.B,
  brace: PAD.RB,
  grab: PAD.LB,
  reload: PAD.X,
  util1: PAD.Y,
  util2: PAD.UP,
  taunt: PAD.DOWN,
  chat: PAD.RIGHT,
  scoreboard: PAD.VIEW,
  menu: PAD.MENU,
};

const XBOX_NAMES = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'L-stick', 'R-stick', 'D-pad ↑', 'D-pad ↓', 'D-pad ←', 'D-pad →', 'Home'];
const PS_NAMES = ['✕', '○', '□', '△', 'L1', 'R1', 'L2', 'R2', 'Create', 'Options', 'L3', 'R3', 'D-pad ↑', 'D-pad ↓', 'D-pad ←', 'D-pad →', 'PS'];

export function isPlayStation(id: string): boolean {
  return /054c|playstation|dualshock|dualsense|wireless controller/i.test(id);
}

export function padButtonName(index: number, playstation: boolean): string {
  return (playstation ? PS_NAMES : XBOX_NAMES)[index] ?? `Button ${index}`;
}

/** Applies a radial deadzone and an exponential response curve to a stick. */
export function shapeStick(x: number, y: number, deadzone = 0.15, expo = 2): [number, number] {
  const m = Math.hypot(x, y);
  if (m < deadzone) return [0, 0];
  const n = Math.min(1, (m - deadzone) / (1 - deadzone));
  const k = Math.pow(n, expo) / m;
  return [x * k, y * k];
}
