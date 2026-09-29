import type { Action } from '../input/input';

/** One first-use tooltip: shown until you've used the action (or seen it a few times). */
export interface TipDef {
  action: Action;
  title: string;
  text: string;
  /** Only shown when the room has this ability turned on (or, for the ult, once it's half full). */
  needs?: 'brace' | 'grab' | 'grapple' | 'ultHalf';
}

export interface TipView {
  key: string;
  title: string;
  text: string;
}

export const TIPS: TipDef[] = [
  { action: 'dash', title: 'DASH', text: 'A fart-powered burst. Works in mid-air: your best way back from the edge.' },
  { action: 'ult', title: 'ULT', text: 'Your ult fills from hits, knockouts, assists and time. At 100%, press it to turn into the character on the meter!', needs: 'ultHalf' },
  { action: 'camera', title: 'CAMERA', text: 'Switch between first and third person.' },
  { action: 'reload', title: 'RELOAD', text: 'Top up your air before the next fight.' },
  { action: 'brace', title: 'BRACE', text: 'Tense up right before a hit to shrug off most of the knockback.', needs: 'brace' },
  { action: 'grab', title: 'GRAB', text: 'Grab someone up close, then fire to throw them. Hold it while falling to catch a ledge.', needs: 'grab' },
  { action: 'grapple', title: 'GRAPPLE', text: "Zip to whatever you aim at. Saves you when you're flying off the map.", needs: 'grapple' },
  { action: 'util1', title: 'UTILITY', text: 'Throw your first utility.' },
  { action: 'util2', title: 'UTILITY', text: 'Throw your second utility.' },
];

const KEY = 'bubba.tips.v1';
/** Stop nagging about an action after this many showings, even if it was never used. */
const MAX_SHOWS = 3;
const FIRST_DELAY = 4;
const SHOW_TIME = 7;
const GAP = 9;

interface Saved {
  used: Record<string, number>;
  shown: Record<string, number>;
}

function load(): Saved {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as Partial<Saved>;
      return { used: s.used ?? {}, shown: s.shown ?? {} };
    }
  } catch {
    // Storage blocked: tips just start over each visit.
  }
  return { used: {}, shown: {} };
}

export interface TipContext {
  /** Alive and in a match where tips make sense. */
  active: boolean;
  features: { brace: boolean; grab: boolean; grapple: boolean };
  /** The ult meter is at least half full (the ult tip waits for that). */
  ultHalf: boolean;
  keyOf: (a: Action) => string;
  /** Replaces the generic utility text with the utility's name. */
  utilName: (slot: 0 | 1) => string;
}

/**
 * Coaches new players through the less obvious controls: one tooltip at a time, a few seconds
 * each, only for things they haven't used yet. Progress is remembered between visits.
 */
export class TipCoach {
  private readonly saved = load();
  private current: TipDef | null = null;
  private timer = FIRST_DELAY;
  private doneTimer = 0;

  constructor(private readonly show: (tip: TipView | null, done: boolean) => void) {}

  /** Call whenever the player presses an action. */
  used(a: Action): void {
    if (!TIPS.some((t) => t.action === a)) return;
    this.saved.used[a] = (this.saved.used[a] ?? 0) + 1;
    this.save();
    if (this.current?.action === a && this.doneTimer <= 0) {
      this.doneTimer = 1.1;
      this.show(this.view(this.current, null), true);
    }
  }

  update(dt: number, ctx: TipContext): void {
    if (this.doneTimer > 0) {
      this.doneTimer -= dt;
      if (this.doneTimer <= 0) this.hide();
      return;
    }
    if (!ctx.active) {
      if (this.current) this.hide();
      return;
    }
    this.timer -= dt;
    if (this.current) {
      this.show(this.view(this.current, ctx), false);
      if (this.timer <= 0) this.hide();
      return;
    }
    if (this.timer > 0) return;
    const next = TIPS.find((t) => !this.saved.used[t.action] && (this.saved.shown[t.action] ?? 0) < MAX_SHOWS && (!t.needs || (t.needs === 'ultHalf' ? ctx.ultHalf : ctx.features[t.needs])));
    if (!next) {
      this.timer = 30;
      return;
    }
    this.current = next;
    this.timer = SHOW_TIME;
    this.saved.shown[next.action] = (this.saved.shown[next.action] ?? 0) + 1;
    this.save();
    this.show(this.view(next, ctx), false);
  }

  private hide(): void {
    this.current = null;
    this.doneTimer = 0;
    this.timer = GAP;
    this.show(null, false);
  }

  private lastKeys = new Map<Action, TipView>();

  private view(t: TipDef, ctx: TipContext | null): TipView {
    if (!ctx) return this.lastKeys.get(t.action) ?? { key: '', title: t.title, text: t.text };
    let text = t.text;
    if (t.action === 'util1' || t.action === 'util2') text = `Throw your ${ctx.utilName(t.action === 'util1' ? 0 : 1)}.`;
    const v = { key: ctx.keyOf(t.action), title: t.title, text };
    this.lastKeys.set(t.action, v);
    return v;
  }

  private save(): void {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(this.saved));
    } catch {
      // ignore
    }
  }
}
