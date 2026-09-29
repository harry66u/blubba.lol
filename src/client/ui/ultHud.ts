import { add, el } from './dom';

export interface UltHudState {
  alive: boolean;
  /** Meter 0..1. */
  frac: number;
  ready: boolean;
  icon: string;
  name: string;
  /** Photo of the person the ult turns you into (shown in the meter), or null for the icon. */
  face: string | null;
  color: string;
  key: string;
  /** What your ult is doing right now ('' = nothing), and whether it's a warning (being chased). */
  status: string;
  warn: boolean;
  /** Screen tints: standing in a Crop Duster cloud, Robot Mode scanning, being chased. */
  gassed: boolean;
  scanning: boolean;
  chased: boolean;
}

const R = 30;
const CIRC = 2 * Math.PI * R;

/**
 * Ult HUD: the circular meter with your ult's icon (bottom center), its READY pulse, the status
 * line while it runs, and a banner when you pop it.
 */
export class UltHud {
  readonly root: HTMLElement;
  private readonly meter: HTMLElement;
  private readonly arc: SVGCircleElement;
  private readonly icon: HTMLElement;
  private readonly key: HTMLElement;
  private readonly label: HTMLElement;
  private readonly status: HTMLElement;
  private readonly splashEl: HTMLElement;
  private readonly gas: HTMLElement;
  private readonly scan: HTMLElement;
  private readonly chase: HTMLElement;
  private last: Record<string, string | number | boolean> = {};

  constructor() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 80 80');
    const bg = document.createElementNS(ns, 'circle');
    for (const [k, v] of Object.entries({ cx: '40', cy: '40', r: String(R), fill: 'rgba(29,27,58,0.55)', stroke: 'rgba(255,255,255,0.3)', 'stroke-width': '7' })) bg.setAttribute(k, v);
    this.arc = document.createElementNS(ns, 'circle');
    for (const [k, v] of Object.entries({ cx: '40', cy: '40', r: String(R), fill: 'none', stroke: '#ffd60a', 'stroke-width': '7', 'stroke-linecap': 'round', transform: 'rotate(-90 40 40)', 'stroke-dasharray': String(CIRC), 'stroke-dashoffset': String(CIRC) })) {
      this.arc.setAttribute(k, v);
    }
    svg.append(bg, this.arc);
    this.icon = el('div', { class: 'ult-icon' });
    this.key = el('span', { class: 'kc ult-key' });
    this.label = el('div', { class: 'ult-label' });
    this.meter = el('div', { class: 'ult-meter' }, svg as unknown as HTMLElement, this.icon, this.key, this.label);
    this.status = el('div', { class: 'ult-status hidden' });
    this.splashEl = el('div', { class: 'ult-splash hidden' });
    this.gas = el('div', { class: 'ult-gas' });
    this.scan = el('div', { class: 'ult-scan' });
    this.chase = el('div', { class: 'ult-chased' });
    this.root = el('div', { class: 'ult-hud' }, this.gas, this.chase, this.scan, this.splashEl, this.meter, this.status);
  }

  private setIf(key: string, value: string | number | boolean, apply: () => void): void {
    if (this.last[key] === value) return;
    this.last[key] = value;
    apply();
  }

  update(s: UltHudState): void {
    const q = Math.round(s.frac * 100);
    this.setIf('frac', q, () => {
      this.arc.setAttribute('stroke-dashoffset', String(CIRC * (1 - q / 100)));
      this.meter.style.setProperty('--fill', `${q}%`);
    });
    this.setIf('look', `${s.icon}|${s.color}|${s.name}|${s.face}`, () => {
      this.icon.textContent = '';
      // Whose ult it is: their face (their icon as a badge) and their name on top.
      if (s.face) add(this.icon, el('img', { class: 'ult-face', attrs: { src: s.face, alt: '' } }), el('span', { class: 'ult-badge', text: s.icon }));
      else this.icon.textContent = s.icon;
      this.meter.style.setProperty('--ult', s.color);
      this.arc.setAttribute('stroke', s.color);
      this.meter.title = s.name;
    });
    this.setIf('ready', `${s.ready}|${s.alive}|${s.name}|${s.ready ? 100 : q}`, () => {
      this.meter.classList.toggle('ready', s.ready && s.alive);
      // Charging: whose ult and how full; full: READY.
      this.label.textContent = s.ready ? `${s.name.toUpperCase()} READY` : `${s.name.toUpperCase()} ${q}%`;
    });
    this.setIf('key', s.key, () => (this.key.textContent = s.key));
    this.setIf('dead', s.alive, () => this.meter.classList.toggle('dead', !s.alive));
    this.setIf('status', `${s.status}|${s.warn}`, () => {
      this.status.textContent = s.status;
      this.status.classList.toggle('hidden', !s.status);
      this.status.classList.toggle('warn', s.warn);
      this.status.style.setProperty('--ult', s.color);
    });
    this.setIf('gas', s.gassed, () => this.gas.classList.toggle('on', s.gassed));
    this.setIf('scan', s.scanning, () => this.scan.classList.toggle('on', s.scanning));
    this.setIf('chased', s.chased, () => this.chase.classList.toggle('on', s.chased));
  }

  /** Charge you just earned: "+12%" (and why, for knockouts, assists and goals) floats up off the meter. */
  gain(amount: number, why: string): void {
    if (amount <= 0) return;
    const chips = this.meter.querySelectorAll('.ult-gain');
    if (chips.length >= 3) chips[0].remove();
    const chip = el('div', { class: `ult-gain${why ? ' big' : ''}`, text: `+${amount}%${why ? ` ${why}` : ''}` });
    this.meter.append(chip);
    window.setTimeout(() => chip.remove(), 1300);
  }

  /** The meter just filled: it bounces and rings. */
  readyPulse(): void {
    this.meter.classList.remove('pop');
    void this.meter.offsetWidth;
    this.meter.classList.add('pop');
  }

  /** You popped your ult: a banner near the top of the screen for a moment. */
  splash(name: string, icon: string, color: string, tagline: string, by: string, face: string | null = null): void {
    this.splashEl.textContent = '';
    this.splashEl.style.setProperty('--ult', color);
    add(
      this.splashEl,
      el('div', { class: 'rays' }),
      // The person you turn into, when they've lent their face; else the ult's icon.
      face ? el('div', { class: 'who' }, el('img', { attrs: { src: face, alt: '' } }), el('span', { class: 'ico-badge', text: icon })) : el('div', { class: 'ico', text: icon }),
      el('div', { class: 'nm', text: `${name.toUpperCase()}!` }),
      el('div', { class: 'tag', text: tagline }),
      by ? el('div', { class: 'by', text: by }) : null,
    );
    this.splashEl.classList.remove('hidden', 'go');
    void this.splashEl.offsetWidth;
    this.splashEl.classList.add('go');
    window.setTimeout(() => this.splashEl.classList.add('hidden'), 1400);
  }
}
