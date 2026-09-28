import type { Action, InputManager } from './input';

/** True on phones and tablets (a touch screen with no fine pointer like a mouse). */
export function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const fine = window.matchMedia?.('(any-pointer: fine)').matches ?? false;
  return (coarse && !fine) || (navigator.maxTouchPoints > 0 && !fine);
}

/** Readiness of each button's action (0..1, 1 = ready) plus what the utility slots hold. */
export interface TouchState {
  charge: number;
  dash: number;
  brace: number;
  grab: number;
  grapple: number;
  u1: number;
  u2: number;
  reloading: boolean;
  features: { brace: boolean; grab: boolean; grapple: boolean };
  utilIcons: [string, string];
}

interface ButtonDef {
  act: Action | 'pause' | 'score' | 'talk';
  label: string;
  cls: string;
}

const BUTTONS: ButtonDef[] = [
  { act: 'fire', label: 'FIRE', cls: 'fire big' },
  { act: 'jump', label: 'JUMP', cls: 'jump mid' },
  { act: 'dash', label: '💨', cls: 'dash mid' },
  { act: 'grapple', label: '🪝', cls: 'grapple small' },
  { act: 'brace', label: '🛡️', cls: 'brace small' },
  { act: 'grab', label: '✊', cls: 'grab small' },
  { act: 'reload', label: '↻', cls: 'reload small' },
  { act: 'util1', label: '?', cls: 'util1 small' },
  { act: 'util2', label: '?', cls: 'util2 small' },
  { act: 'camera', label: '🎥', cls: 'camera tiny' },
  { act: 'taunt', label: '😜', cls: 'taunt tiny' },
  { act: 'score', label: '🏆', cls: 'score tiny' },
  { act: 'talk', label: '💬', cls: 'talk tiny' },
  { act: 'pause', label: '❚❚', cls: 'pause tiny' },
];

/** Radius (px) the move stick can travel from where your thumb landed. */
const STICK_R = 56;

/**
 * On-screen controls for phones and tablets: a floating move stick on the left, drag anywhere on
 * the right to aim, a big fire button (hold to charge; drag it to aim while you charge), and
 * buttons for jumping, dashing and every ability, each showing its cooldown.
 */
export class TouchControls {
  readonly root: HTMLElement;
  private readonly buttons = new Map<string, { el: HTMLElement; fill: HTMLElement }>();
  private readonly stickBase: HTMLElement;
  private readonly stickKnob: HTMLElement;
  private stick: { id: number; ox: number; oy: number } | null = null;
  /** Touches that aim: id -> last position. */
  private readonly lookers = new Map<number, { x: number; y: number }>();
  /** Touches holding a button: id -> action. */
  private readonly holding = new Map<number, string>();
  private visible = false;
  sensitivity = 1;
  onPause: (() => void) | null = null;
  /** Quick chat: tap a preset (the same eight as the keyboard wheel). */
  onChat: ((slot: number) => void) | null = null;
  private readonly chatPanel: HTMLElement;
  onScoreboard: ((show: boolean) => void) | null = null;

  constructor(private readonly input: InputManager) {
    this.root = document.createElement('div');
    this.root.className = 'touch-controls hidden';
    this.stickBase = document.createElement('div');
    this.stickBase.className = 'stick-base';
    this.stickKnob = document.createElement('div');
    this.stickKnob.className = 'stick-knob';
    this.stickBase.append(this.stickKnob);
    const rotate = document.createElement('div');
    rotate.className = 'rotate-hint';
    rotate.textContent = 'Turn your phone sideways to play 📱↻';
    this.root.append(this.stickBase, rotate);
    for (const b of BUTTONS) {
      const el = document.createElement('div');
      el.className = `tbtn ${b.cls}`;
      el.dataset.act = b.act;
      const fill = document.createElement('div');
      fill.className = 'cd';
      const label = document.createElement('span');
      label.textContent = b.label;
      el.append(fill, label);
      this.root.append(el);
      this.buttons.set(b.act, { el, fill });
    }
    this.chatPanel = document.createElement('div');
    this.chatPanel.className = 'touch-chat hidden';
    this.root.append(this.chatPanel);
    const opts = { passive: false } as AddEventListenerOptions;
    this.root.addEventListener('touchstart', (e) => this.onStart(e), opts);
    this.root.addEventListener('touchmove', (e) => this.onMove(e), opts);
    this.root.addEventListener('touchend', (e) => this.onEnd(e), opts);
    this.root.addEventListener('touchcancel', (e) => this.onEnd(e), opts);
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  setChatLabels(labels: readonly string[]): void {
    this.chatPanel.textContent = '';
    labels.forEach((text, i) => {
      const b = document.createElement('div');
      b.className = 'chat-pick';
      b.dataset.slot = String(i);
      b.textContent = text;
      this.chatPanel.append(b);
    });
  }

  show(v: boolean): void {
    if (v === this.visible) return;
    this.visible = v;
    this.root.classList.toggle('hidden', !v);
    if (!v) this.releaseAll();
  }

  private releaseAll(): void {
    this.stick = null;
    this.lookers.clear();
    for (const act of this.holding.values()) this.setHeld(act, false);
    this.holding.clear();
    const t = this.input.touch;
    t.moveX = t.moveZ = 0;
    this.stickBase.classList.remove('on');
  }

  private setHeld(act: string, on: boolean): void {
    const t = this.input.touch;
    if (act === 'fire') t.fire = on;
    else if (act === 'jump') t.jump = on;
    else if (act === 'grab') t.grab = on;
    else if (act === 'score') this.onScoreboard?.(on);
    this.buttons.get(act)?.el.classList.toggle('down', on);
  }

  private onStart(e: TouchEvent): void {
    e.preventDefault();
    this.input.lastDevice = 'touch';
    for (const t of Array.from(e.changedTouches)) {
      const pick = (t.target as HTMLElement | null)?.closest?.('.chat-pick') as HTMLElement | null;
      if (pick) {
        this.onChat?.(Number(pick.dataset.slot));
        this.chatPanel.classList.add('hidden');
        continue;
      }
      const btn = (t.target as HTMLElement | null)?.closest?.('.tbtn') as HTMLElement | null;
      if (btn) {
        const act = btn.dataset.act!;
        this.holding.set(t.identifier, act);
        this.setHeld(act, true);
        if (act === 'pause') this.onPause?.();
        else if (act === 'talk') this.chatPanel.classList.toggle('hidden');
        // A press also latches, so a tap shorter than one frame still fires or jumps.
        else if (act !== 'score') this.input.pressAction(act as Action);
        if (act !== 'talk') this.chatPanel.classList.add('hidden');
        // The fire button doubles as an aim pad, so you can charge and aim with one thumb.
        if (act === 'fire') this.lookers.set(t.identifier, { x: t.clientX, y: t.clientY });
        continue;
      }
      if (t.clientX < window.innerWidth * 0.42 && !this.stick) {
        // Floating stick: it appears wherever your left thumb lands.
        this.stick = { id: t.identifier, ox: t.clientX, oy: t.clientY };
        this.stickBase.style.left = `${t.clientX}px`;
        this.stickBase.style.top = `${t.clientY}px`;
        this.stickBase.classList.add('on');
        this.moveStick(t.clientX, t.clientY);
      } else {
        this.lookers.set(t.identifier, { x: t.clientX, y: t.clientY });
      }
    }
  }

  private onMove(e: TouchEvent): void {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      if (this.stick && t.identifier === this.stick.id) {
        this.moveStick(t.clientX, t.clientY);
        continue;
      }
      const last = this.lookers.get(t.identifier);
      if (last) {
        const dx = t.clientX - last.x;
        const dy = t.clientY - last.y;
        last.x = t.clientX;
        last.y = t.clientY;
        if (!this.input.enabled) continue;
        // Radians per pixel; aim assist slows it down over enemies, like on a controller.
        const k = 0.0062 * this.sensitivity * this.input.assistFriction;
        this.input.applyLook(dx * k, dy * k * 0.85);
        this.input.lookDX += dx * 0.6;
        this.input.lookDY += dy * 0.6;
      }
    }
  }

  private onEnd(e: TouchEvent): void {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      if (this.stick && t.identifier === this.stick.id) {
        this.stick = null;
        this.input.touch.moveX = this.input.touch.moveZ = 0;
        this.stickBase.classList.remove('on');
      }
      this.lookers.delete(t.identifier);
      const act = this.holding.get(t.identifier);
      if (act) {
        this.holding.delete(t.identifier);
        // Another finger may still be on the same button.
        if (![...this.holding.values()].includes(act)) this.setHeld(act, false);
      }
    }
  }

  private moveStick(x: number, y: number): void {
    const s = this.stick!;
    let dx = x - s.ox;
    let dy = y - s.oy;
    const l = Math.hypot(dx, dy);
    if (l > STICK_R) {
      // Drag past the edge and the stick follows your thumb.
      s.ox += (dx / l) * (l - STICK_R);
      s.oy += (dy / l) * (l - STICK_R);
      this.stickBase.style.left = `${s.ox}px`;
      this.stickBase.style.top = `${s.oy}px`;
      dx = x - s.ox;
      dy = y - s.oy;
    }
    this.stickKnob.style.transform = `translate(${dx}px, ${dy}px)`;
    const nx = dx / STICK_R;
    const ny = dy / STICK_R;
    const m = Math.hypot(nx, ny);
    // Small deadzone so resting a thumb doesn't drift.
    const k = m < 0.15 ? 0 : Math.min(1, (m - 0.15) / 0.85) / (m || 1);
    this.input.touch.moveX = nx * k;
    this.input.touch.moveZ = -ny * k;
  }

  /** Per-frame cooldown rings and which buttons exist in this room. */
  update(s: TouchState): void {
    if (!this.visible) return;
    const ring = (act: string, ready: number) => {
      const b = this.buttons.get(act);
      if (!b) return;
      const v = Math.max(0, Math.min(1, ready));
      b.fill.style.height = `${Math.round((1 - v) * 100)}%`;
      b.el.classList.toggle('ready', v >= 1);
    };
    ring('dash', s.dash);
    ring('brace', s.brace);
    ring('grab', s.grab);
    ring('grapple', s.grapple);
    ring('util1', s.u1);
    ring('util2', s.u2);
    const fire = this.buttons.get('fire')!;
    fire.el.style.setProperty('--charge', s.charge.toFixed(2));
    this.buttons.get('reload')!.el.classList.toggle('busy', s.reloading);
    this.buttons.get('brace')!.el.classList.toggle('hidden', !s.features.brace);
    this.buttons.get('grab')!.el.classList.toggle('hidden', !s.features.grab);
    this.buttons.get('grapple')!.el.classList.toggle('hidden', !s.features.grapple);
    const u1 = this.buttons.get('util1')!.el.lastElementChild!;
    const u2 = this.buttons.get('util2')!.el.lastElementChild!;
    if (u1.textContent !== s.utilIcons[0]) u1.textContent = s.utilIcons[0];
    if (u2.textContent !== s.utilIcons[1]) u2.textContent = s.utilIcons[1];
  }
}

/** Button names shown in hints when playing by touch. */
export const TOUCH_LABELS: Partial<Record<Action, string>> = {
  fire: 'FIRE',
  jump: 'JUMP',
  dash: '💨',
  brace: '🛡️',
  grab: '✊',
  grapple: '🪝',
  reload: '↻',
  util1: 'left gadget',
  util2: 'right gadget',
  camera: '🎥',
  forward: 'stick',
  back: 'stick',
  left: 'stick',
  right: 'stick',
};
