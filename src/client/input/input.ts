import { BTN_FIRE, BTN_GRAB, BTN_JUMP, type InputFrame, type PressKey } from '../../shared/input';
import type { Settings } from '../settings';
import { DEFAULT_PAD_BINDINGS, PAD, type PadAction, isPlayStation, padButtonName, shapeStick } from './gamepad';

export type Action =
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'fire'
  | 'jump'
  | 'dash'
  | 'brace'
  | 'grapple'
  | 'grab'
  | 'reload'
  | 'util1'
  | 'util2'
  | 'taunt'
  | 'scoreboard';

export const ACTION_LABELS: Record<Action, string> = {
  forward: 'Move forward',
  back: 'Move back',
  left: 'Move left',
  right: 'Move right',
  fire: 'Fire (hold to charge)',
  jump: 'Jump / double jump',
  dash: 'Dash',
  brace: 'Brace',
  grapple: 'Grapple',
  grab: 'Grab / ledge grab',
  reload: 'Reload',
  util1: 'Utility 1',
  util2: 'Utility 2',
  taunt: 'Taunt',
  scoreboard: 'Scoreboard',
};

/** Defaults never use Command or Control (spec §10). Codes are KeyboardEvent.code or MouseN. */
export const DEFAULT_BINDINGS: Record<Action, string[]> = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  fire: ['Mouse0'],
  jump: ['Space'],
  dash: ['ShiftLeft', 'ShiftRight'],
  brace: ['KeyQ'],
  grapple: ['KeyE'],
  grab: ['KeyF'],
  reload: ['KeyR'],
  util1: ['KeyC'],
  util2: ['KeyV'],
  taunt: ['KeyT'],
  scoreboard: ['Tab'],
};

const PRESS_ACTIONS: Partial<Record<Action, PressKey>> = {
  jump: 'jump',
  dash: 'dash',
  brace: 'brace',
  grapple: 'grapple',
  grab: 'grab',
  reload: 'reload',
  util1: 'util1',
  util2: 'util2',
  taunt: 'taunt',
};

const BLOCKED_CODES = new Set(['MetaLeft', 'MetaRight', 'ControlLeft', 'ControlRight', 'Escape']);

export function codeLabel(code: string): string {
  if (code.startsWith('Mouse')) return ['Left click', 'Middle click', 'Right click', 'Mouse 4', 'Mouse 5'][Number(code.slice(5))] ?? code;
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const names: Record<string, string> = {
    Space: 'Space',
    ShiftLeft: 'Shift',
    ShiftRight: 'R Shift',
    AltLeft: 'Option',
    AltRight: 'R Option',
    Tab: 'Tab',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    CapsLock: 'Caps',
    Backquote: '`',
    Enter: 'Return',
  };
  return names[code] ?? code;
}

/**
 * Keyboard + pointer input. Look input is applied continuously (every mouse event) so the
 * camera feels immediate; everything else is sampled into fixed-step input frames.
 */
export class InputManager {
  yaw = 0;
  pitch = 0;
  /** Look movement since the last frame (for weapon sway). */
  lookDX = 0;
  lookDY = 0;
  readonly held = new Set<string>();
  private counters: Record<PressKey, number> = { jump: 0, dash: 0, brace: 0, grab: 0, grapple: 0, reload: 0, util1: 0, util2: 0, taunt: 0 };
  private fireLatch = false;
  private bindings: Record<Action, string[]> = { ...DEFAULT_BINDINGS };
  private codeToActions = new Map<string, Action[]>();
  enabled = false;
  locked = false;
  private ignoreNextMove = false;
  onScoreboard: ((show: boolean) => void) | null = null;
  onLockChange: ((locked: boolean) => void) | null = null;
  onAnyPress: ((action: Action) => void) | null = null;
  /** When set, the next key/button press is captured for rebinding instead of played. */
  captureNext: ((code: string) => void) | null = null;
  /** When set, the next controller button press is captured for rebinding. */
  capturePad: ((button: number) => void) | null = null;
  /** Which device was used last (for button prompts and aim assist). */
  lastDevice: 'kbm' | 'pad' = 'kbm';
  padConnected = false;
  padIsPlayStation = false;
  private padPrev: boolean[] = [];
  private padBindings: Record<PadAction, number> = { ...DEFAULT_PAD_BINDINGS };
  /** Aim-assist slowdown (0..1) set by the game when the crosshair is on an enemy. */
  assistFriction = 1;
  onMenuButton: (() => void) | null = null;
  /** Any controller button (used to start playing without pointer lock). */
  onPadButton: ((button: number) => void) | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private settings: Settings,
  ) {
    this.applySettings(settings);
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('mousedown', (e) => this.onMouseButton(e, true));
    window.addEventListener('mouseup', (e) => this.onMouseButton(e, false));
    window.addEventListener('mousemove', (e) => this.onMouseMove(e));
    window.addEventListener('contextmenu', (e) => {
      if (this.locked) e.preventDefault();
    });
    window.addEventListener('blur', () => this.releaseAll());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.releaseAll();
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      this.ignoreNextMove = true;
      if (!this.locked) this.releaseAll();
      this.onLockChange?.(this.locked);
    });
  }

  applySettings(s: Settings): void {
    this.settings = s;
    this.padBindings = { ...DEFAULT_PAD_BINDINGS };
    for (const [k, v] of Object.entries(s.padBindings ?? {})) {
      if (k in this.padBindings && Array.isArray(v) && typeof v[0] === 'number') this.padBindings[k as PadAction] = v[0];
    }
    this.bindings = { ...DEFAULT_BINDINGS };
    for (const [k, v] of Object.entries(s.bindings)) {
      if (k in this.bindings && Array.isArray(v)) this.bindings[k as Action] = v.filter((c) => !BLOCKED_CODES.has(c));
    }
    this.codeToActions.clear();
    for (const [action, codes] of Object.entries(this.bindings) as [Action, string[]][]) {
      for (const c of codes) {
        const list = this.codeToActions.get(c) ?? [];
        list.push(action);
        this.codeToActions.set(c, list);
      }
    }
  }

  getBindings(): Record<Action, string[]> {
    return this.bindings;
  }

  requestLock(): void {
    const opts = this.settings.device === 'mouse' ? { unadjustedMovement: true } : undefined;
    try {
      const p = (this.canvas.requestPointerLock as (o?: object) => Promise<void> | void)(opts);
      if (p && typeof (p as Promise<void>).catch === 'function') {
        (p as Promise<void>).catch(() => {
          // unadjustedMovement isn't supported everywhere (e.g. Safari); fall back.
          try {
            const q = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
            q?.catch?.(() => undefined);
          } catch {
            /* ignore */
          }
        });
      }
    } catch {
      try {
        this.canvas.requestPointerLock();
      } catch {
        /* ignore */
      }
    }
  }

  exitLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  private releaseAll(): void {
    this.held.clear();
    this.fireLatch = false;
    this.onScoreboard?.(false);
  }

  private isTyping(e: Event): boolean {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    if (this.captureNext && down) {
      if (e.code === 'Escape') {
        this.captureNext = null;
      } else if (!BLOCKED_CODES.has(e.code)) {
        const cb = this.captureNext;
        this.captureNext = null;
        cb(e.code);
      }
      e.preventDefault();
      return;
    }
    if (this.isTyping(e)) return;
    const actions = this.codeToActions.get(e.code);
    if (this.enabled && (actions || e.code === 'Space' || e.code === 'Tab')) e.preventDefault();
    if (!actions) return;
    if (down) {
      if (e.repeat) return;
      this.press(e.code);
    } else {
      this.release(e.code);
    }
  }

  private onMouseButton(e: MouseEvent, down: boolean): void {
    const code = `Mouse${e.button}`;
    if (this.captureNext && down && this.locked === false && (e.target as HTMLElement)?.dataset?.capture === '1') {
      const cb = this.captureNext;
      this.captureNext = null;
      cb(code);
      return;
    }
    if (!this.locked) {
      if (!down) this.release(code);
      return;
    }
    if (down) this.press(code);
    else this.release(code);
  }

  private press(code: string): void {
    if (this.held.has(code)) return;
    this.held.add(code);
    this.lastDevice = 'kbm';
    if (!this.enabled) return;
    for (const a of this.codeToActions.get(code) ?? []) {
      const pk = PRESS_ACTIONS[a];
      if (pk) this.counters[pk] = (this.counters[pk] + 1) & 255;
      if (a === 'fire') this.fireLatch = true;
      if (a === 'scoreboard') this.onScoreboard?.(true);
      this.onAnyPress?.(a);
    }
  }

  private release(code: string): void {
    this.held.delete(code);
    for (const a of this.codeToActions.get(code) ?? []) {
      if (a === 'scoreboard') this.onScoreboard?.(false);
    }
  }

  private onMouseMove(e: MouseEvent): void {
    if (!this.locked || !this.enabled) return;
    let dx = e.movementX;
    let dy = e.movementY;
    // Browsers sometimes report a huge jump right after locking.
    if (this.ignoreNextMove) {
      this.ignoreNextMove = false;
      if (Math.abs(dx) > 200 || Math.abs(dy) > 200) return;
    }
    if (Math.abs(dx) > 800 || Math.abs(dy) > 800) return;
    this.lastDevice = 'kbm';
    const s = this.settings;
    const base = s.device === 'trackpad' ? 0.0034 * s.sensTrackpad : 0.0021 * s.sensMouse;
    this.applyLook(dx * base, dy * base * (s.invertY ? -1 : 1));
    this.lookDX += dx;
    this.lookDY += dy;
  }

  /** Adds look rotation in radians (used by mouse, trackpad, and controllers). */
  applyLook(dYaw: number, dPitch: number): void {
    this.yaw -= dYaw;
    this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch - dPitch));
    if (this.yaw > Math.PI) this.yaw -= Math.PI * 2;
    if (this.yaw < -Math.PI) this.yaw += Math.PI * 2;
  }

  actionHeld(a: Action): boolean {
    for (const c of this.bindings[a]) if (this.held.has(c)) return true;
    return false;
  }

  /** Extra movement/buttons from other devices (controllers) merged into each frame. */
  external: { moveX: number; moveZ: number; fire: boolean; jump: boolean; grab: boolean } = { moveX: 0, moveZ: 0, fire: false, jump: false, grab: false };

  getPadBindings(): Record<PadAction, number> {
    return this.padBindings;
  }

  padLabel(a: PadAction): string {
    return padButtonName(this.padBindings[a], this.padIsPlayStation);
  }

  /** Reads the first connected controller. Call once per rendered frame. */
  pollGamepad(dt: number): void {
    const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    let pad: Gamepad | null = null;
    for (const p of pads) {
      if (p && p.connected) {
        pad = p;
        break;
      }
    }
    this.padConnected = !!pad;
    if (!pad) {
      this.external.moveX = this.external.moveZ = 0;
      this.external.fire = this.external.jump = this.external.grab = false;
      return;
    }
    this.padIsPlayStation = isPlayStation(pad.id);
    const pressed = (i: number) => {
      const b = pad!.buttons[i];
      return !!b && (b.pressed || b.value > 0.35);
    };
    // Rebinding capture.
    if (this.capturePad) {
      for (let i = 0; i < pad.buttons.length; i++) {
        if (pressed(i) && !this.padPrev[i]) {
          const cb = this.capturePad;
          this.capturePad = null;
          cb(i);
          break;
        }
      }
    }
    const [mx, my] = shapeStick(pad.axes[0] ?? 0, pad.axes[1] ?? 0, 0.18, 1);
    const [lx, ly] = shapeStick(pad.axes[2] ?? 0, pad.axes[3] ?? 0, 0.12, 2);
    let any = mx !== 0 || my !== 0 || lx !== 0 || ly !== 0;
    for (let i = 0; i < pad.buttons.length; i++) {
      const now = pressed(i);
      if (now && !this.padPrev[i]) {
        any = true;
        this.onPadButton?.(i);
        if (i === this.padBindings.menu) this.onMenuButton?.();
        for (const [action, btn] of Object.entries(this.padBindings) as [PadAction, number][]) {
          if (btn !== i || action === 'menu' || action === 'fire') continue;
          if (action === 'scoreboard') this.onScoreboard?.(true);
          else this.pressAction(action);
        }
      } else if (!now && this.padPrev[i] && i === this.padBindings.scoreboard) {
        this.onScoreboard?.(false);
      }
      this.padPrev[i] = now;
    }
    if (any) this.lastDevice = 'pad';
    if (!this.enabled) {
      this.external.moveX = this.external.moveZ = 0;
      this.external.fire = this.external.jump = this.external.grab = false;
      return;
    }
    this.external.moveX = mx;
    this.external.moveZ = -my;
    this.external.fire = pressed(this.padBindings.fire);
    this.external.jump = pressed(this.padBindings.jump);
    this.external.grab = pressed(this.padBindings.grab);
    // Stick aiming: radians per second at full tilt, slowed by aim assist when on target.
    const s = this.settings;
    const speed = 3.4 * s.sensController * this.assistFriction;
    if (lx !== 0 || ly !== 0) this.applyLook(lx * speed * dt, ly * speed * dt * 0.8 * (s.invertY ? -1 : 1));
  }

  /** Adds a press from another device (controller). */
  pressAction(a: Action): void {
    if (!this.enabled) return;
    const pk = PRESS_ACTIONS[a];
    if (pk) this.counters[pk] = (this.counters[pk] + 1) & 255;
    if (a === 'fire') this.fireLatch = true;
    this.onAnyPress?.(a);
  }

  sample(f: InputFrame): void {
    let mx = 0;
    let mz = 0;
    if (this.enabled) {
      if (this.actionHeld('right')) mx += 1;
      if (this.actionHeld('left')) mx -= 1;
      if (this.actionHeld('forward')) mz += 1;
      if (this.actionHeld('back')) mz -= 1;
      mx += this.external.moveX;
      mz += this.external.moveZ;
    }
    const l = Math.hypot(mx, mz);
    if (l > 1) {
      mx /= l;
      mz /= l;
    }
    f.moveX = mx;
    f.moveZ = mz;
    f.yaw = this.yaw;
    f.pitch = this.pitch;
    let buttons = 0;
    if (this.enabled) {
      // A click shorter than one frame still registers as a (weak) tap shot.
      if (this.actionHeld('fire') || this.fireLatch || this.external.fire) buttons |= BTN_FIRE;
      if (this.actionHeld('jump') || this.external.jump) buttons |= BTN_JUMP;
      if (this.actionHeld('grab') || this.external.grab) buttons |= BTN_GRAB;
    }
    this.fireLatch = false;
    f.buttons = buttons;
    f.jump = this.counters.jump;
    f.dash = this.counters.dash;
    f.brace = this.counters.brace;
    f.grab = this.counters.grab;
    f.grapple = this.counters.grapple;
    f.reload = this.counters.reload;
    f.util1 = this.counters.util1;
    f.util2 = this.counters.util2;
    f.taunt = this.counters.taunt;
  }

  /** Resets counters to match a server state (e.g. after joining a new room). */
  syncCounters(c: Record<PressKey, number>): void {
    this.counters = { ...c };
  }
}
