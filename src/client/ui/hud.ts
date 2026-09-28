import * as THREE from 'three';
import { BALANCE } from '../../shared/balance';
import { clear, el, formatTime } from './dom';

const ESCAPE_BAR_SEC = 0.8;

interface WorldPopup {
  el: HTMLElement;
  pos: THREE.Vector3;
  life: number;
  max: number;
  vy: number;
  scale: number;
}

export interface HudState {
  inflation: number;
  grabReady: number;
  grappleReady: number;
  /** Escape-timing bar while held: seconds since the grab, or -1 when not held. */
  heldTime: number;
  escapeUsed: boolean;
  hint: string;
  ammo: number;
  maxAmmo: number;
  reloadFrac: number;
  charge: number;
  dashCharges: number;
  dashRechargeFrac: number;
  braceReady: number;
  timeLeft: number;
  phase: string;
  sub: string;
  alive: boolean;
  weaponName: string;
  stream: boolean;
  u1Ready: number;
  u2Ready: number;
  pin: number;
}

/** Team score strip under the clock (team modes only). */
export interface TeamBar {
  colors: number[];
  names: string[];
  /** Goals, knockouts, or pump fill 0..1 (shown as bars when `bars` is set). */
  scores: [number, number];
  bars: boolean;
  youTeam: number;
  target?: number;
}

export interface Nametag {
  el: HTMLElement;
  pct: HTMLElement;
  name: HTMLElement;
}

/** In-match heads-up display. Per-frame values are written straight to DOM nodes. */
export class Hud {
  readonly root: HTMLElement;
  private readonly crosshair: HTMLElement;
  private readonly chargeArc: SVGCircleElement;
  private readonly hitmarker: HTMLElement;
  private readonly pct: HTMLElement;
  private readonly balloon: HTMLElement;
  private readonly ammoPips: HTMLElement;
  private readonly reloadBar: HTMLElement;
  private readonly reloadFill: HTMLElement;
  private readonly weaponName: HTMLElement;
  private readonly dashPips: HTMLElement;
  private readonly braceWrap: HTMLElement;
  private readonly braceFill: HTMLElement;
  private readonly grabWrap: HTMLElement;
  private readonly grabFill: HTMLElement;
  private readonly grappleWrap: HTMLElement;
  private readonly grappleFill: HTMLElement;
  private readonly hintEl: HTMLElement;
  private readonly escapeBox: HTMLElement;
  private readonly escapeMarker: HTMLElement;
  private readonly escapeLabel: HTMLElement;
  private readonly flashEl: HTMLElement;
  private readonly tank: HTMLElement;
  private readonly tankFill: HTMLElement;
  private readonly utilEls: { box: HTMLElement; cool: HTMLElement; icon: HTMLElement; k: HTMLElement }[] = [];
  /** Key labels next to each ability, so every control is discoverable on screen. */
  private readonly keyChips: Record<string, HTMLElement> = {};
  private readonly tipEl: HTMLElement;
  private readonly pinBadge: HTMLElement;
  private readonly eventBanner: HTMLElement;
  private readonly clock: HTMLElement;
  private readonly teamBar: HTMLElement;
  private readonly teamSides: { box: HTMLElement; score: HTMLElement; fill: HTMLElement; name: HTMLElement }[] = [];
  private readonly sub: HTMLElement;
  private readonly killfeed: HTMLElement;
  readonly nametags: HTMLElement;
  private readonly popups: HTMLElement;
  private readonly calloutBox: HTMLElement;
  private readonly respawnBox: HTMLElement;
  private readonly note: HTMLElement;
  private readonly damage: HTMLElement;
  readonly ping: HTMLElement;
  private readonly chatWheel: HTMLElement;
  private readonly chatSlots: HTMLElement[] = [];
  private readonly chatFeed: HTMLElement;
  private readonly worldPopups: WorldPopup[] = [];
  private calloutTimer = 0;
  private last: Partial<Record<string, string | number>> = {};
  private tmp = new THREE.Vector3();

  constructor() {
    this.root = el('div', { class: 'hud hidden' });
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 64 64');
    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    bg.setAttribute('cx', '32');
    bg.setAttribute('cy', '32');
    bg.setAttribute('r', '20');
    bg.setAttribute('fill', 'none');
    bg.setAttribute('stroke', 'rgba(255,255,255,0.45)');
    bg.setAttribute('stroke-width', '3');
    this.chargeArc = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    this.chargeArc.setAttribute('cx', '32');
    this.chargeArc.setAttribute('cy', '32');
    this.chargeArc.setAttribute('r', '20');
    this.chargeArc.setAttribute('fill', 'none');
    this.chargeArc.setAttribute('stroke', '#ffd60a');
    this.chargeArc.setAttribute('stroke-width', '5');
    this.chargeArc.setAttribute('stroke-linecap', 'round');
    this.chargeArc.setAttribute('transform', 'rotate(-90 32 32)');
    const circ = 2 * Math.PI * 20;
    this.chargeArc.setAttribute('stroke-dasharray', `${circ}`);
    this.chargeArc.setAttribute('stroke-dashoffset', `${circ}`);
    svg.append(bg, this.chargeArc);
    this.crosshair = el('div', { class: 'crosshair' }, el('div', { class: 'dot' }));
    this.crosshair.prepend(svg as unknown as HTMLElement);
    this.hitmarker = el('div', {
      class: 'hitmarker',
      html: '<svg viewBox="0 0 40 40"><g stroke="#fff" stroke-width="4" stroke-linecap="round"><line x1="6" y1="6" x2="14" y2="14"/><line x1="34" y1="6" x2="26" y2="14"/><line x1="6" y1="34" x2="14" y2="26"/><line x1="34" y1="34" x2="26" y2="26"/></g></svg>',
    });

    this.pct = el('div', { class: 'pct', html: '0<small>%</small>' });
    this.balloon = el('div', { class: 'balloon' });
    const inflation = el('div', { class: 'inflation' }, this.balloon, el('div', {}, el('div', { class: 'lbl', text: 'INFLATION' }), this.pct));

    this.ammoPips = el('div', { class: 'pips' });
    this.reloadFill = el('div');
    this.reloadBar = el('div', { class: 'reload-bar hidden' }, this.reloadFill);
    this.weaponName = el('div', { class: 'weapon-name', text: 'AIR CANNON' });
    this.tankFill = el('div');
    this.tank = el('div', { class: 'tank hidden' }, this.tankFill);
    const chip = (id: string) => (this.keyChips[id] = el('span', { class: 'kc' }));
    const keyLine = (id: string, label: string) => {
      const name = el('span', { text: label });
      this.keyChips[`${id}Label`] = name;
      return el('div', {}, chip(id), name);
    };
    const ammoKeys = el('div', { class: 'ammo-keys' }, keyLine('reload', 'RELOAD'), keyLine('camera', '3RD PERSON'));
    const ammo = el('div', { class: 'ammo' }, ammoKeys, this.weaponName, this.ammoPips, this.tank, this.reloadBar);
    const utils = el('div', { class: 'utils' });
    for (const k of ['C', 'G']) {
      const cool = el('div', { class: 'cool' });
      const icon = el('div', { text: '?' });
      const key = el('div', { class: 'k', text: k });
      const box = el('div', { class: 'util' }, key, icon, cool);
      utils.append(box);
      this.utilEls.push({ box, cool, icon, k: key });
    }
    this.pinBadge = el('div', { class: 'pin-badge hidden', text: '📌 PIN' });
    this.eventBanner = el('div', { class: 'event-banner hidden' });

    this.dashPips = el('div', { class: 'pips' });
    const ability = (label: string): [HTMLElement, HTMLElement] => {
      const fill = el('div', { class: 'fill' });
      const wrap = el('div', { class: 'group hidden' }, el('div', { class: 'pips' }, el('div', { class: 'pip' }, fill)), el('div', {}, label, chip(label.toLowerCase())));
      return [wrap, fill];
    };
    [this.braceWrap, this.braceFill] = ability('BRACE');
    [this.grabWrap, this.grabFill] = ability('GRAB');
    [this.grappleWrap, this.grappleFill] = ability('GRAPPLE');
    const movement = el('div', { class: 'movement' }, el('div', { class: 'group' }, this.dashPips, el('div', {}, 'DASH', chip('dash'))), this.braceWrap, this.grabWrap, this.grappleWrap);
    this.tipEl = el('div', { class: 'tip off' });
    this.hintEl = el('div', { class: 'hint hidden' });
    this.escapeMarker = el('div', { class: 'marker' });
    this.escapeLabel = el('div', { class: 'lbl', text: 'DASH TO BREAK FREE!' });
    const zone = el('div', { class: 'zone' });
    const lo = BALANCE.grab.escapeStart / ESCAPE_BAR_SEC;
    const hi = BALANCE.grab.escapeEnd / ESCAPE_BAR_SEC;
    zone.style.left = `${lo * 100}%`;
    zone.style.width = `${(hi - lo) * 100}%`;
    this.escapeBox = el('div', { class: 'escape hidden' }, this.escapeLabel, el('div', { class: 'bar' }, zone, this.escapeMarker));
    this.flashEl = el('div', { class: 'screen-flash' });

    this.clock = el('div', { class: 'clock', text: '4:00' });
    this.sub = el('div', { class: 'sub' });
    this.teamBar = el('div', { class: 'team-bar hidden' });
    for (let t = 0; t < 2; t++) {
      const score = el('div', { class: 'score', text: '0' });
      const fill = el('div', { class: 'fill' });
      const name = el('div', { class: 'name' });
      const box = el('div', { class: `side side${t}` }, name, score, el('div', { class: 'meter' }, fill));
      this.teamSides.push({ box, score, fill, name });
    }
    this.teamBar.append(this.teamSides[0].box, this.teamSides[1].box);
    const timer = el('div', { class: 'timer' }, this.teamBar, this.clock, this.sub, this.eventBanner);

    this.killfeed = el('div', { class: 'killfeed' });
    this.nametags = el('div', { class: 'nametags' });
    this.popups = el('div', { class: 'popups' });
    this.calloutBox = el('div', { class: 'callout' });
    this.respawnBox = el('div', { class: 'respawn hidden' });
    this.note = el('div', { class: 'center-note' });
    this.damage = el('div', { class: 'damage-dir' });
    this.ping = el('div', { class: 'ping' });
    this.chatWheel = el('div', { class: 'chat-wheel hidden' }, el('div', { class: 'hub', text: 'QUICK CHAT' }));
    this.chatFeed = el('div', { class: 'chat-feed' });

    this.root.append(this.flashEl, this.nametags, this.popups, this.damage, this.crosshair, this.hitmarker, inflation, movement, ammo, utils, this.pinBadge, timer, this.killfeed, this.calloutBox, this.respawnBox, this.note, this.hintEl, this.escapeBox, this.ping, this.chatFeed, this.chatWheel, this.tipEl);
  }

  /** Current key (or controller button) for each ability, shown next to it. */
  setKeys(keys: Record<'dash' | 'brace' | 'grab' | 'grapple' | 'reload' | 'camera' | 'util1' | 'util2', string>, thirdPerson: boolean): void {
    this.setIf('keys', `${Object.values(keys).join('|')}|${thirdPerson}`, () => {
      for (const id of ['dash', 'brace', 'grab', 'grapple', 'reload', 'camera'] as const) this.keyChips[id].textContent = keys[id];
      this.keyChips.cameraLabel.textContent = thirdPerson ? '1ST PERSON' : '3RD PERSON';
      this.utilEls[0].k.textContent = keys.util1;
      this.utilEls[1].k.textContent = keys.util2;
    });
  }

  /** First-use tooltip card (null hides it). `done` flashes it green once you've tried it. */
  showTip(tip: { key: string; title: string; text: string } | null, done: boolean): void {
    const key = tip ? `${tip.key}|${tip.title}|${tip.text}|${done}` : '';
    this.setIf('tip', key, () => {
      this.tipEl.classList.toggle('off', !tip);
      this.tipEl.classList.toggle('done', done);
      if (!tip) return;
      clear(this.tipEl);
      this.tipEl.append(
        el('span', { class: 'key', text: tip.key }),
        el('div', {}, el('div', { class: 't', text: done ? `${tip.title} ✓` : tip.title }), el('div', { class: 'd', text: done ? 'Nice!' : tip.text })),
      );
    });
  }

  /** Builds the wheel's labels (slot 0 at the top, clockwise). */
  setChatLabels(labels: readonly string[]): void {
    for (const e of this.chatSlots) e.remove();
    this.chatSlots.length = 0;
    labels.forEach((text, i) => {
      const a = (i / labels.length) * Math.PI * 2;
      const e = el('div', { class: 'slot' }, el('span', { class: 'n', text: String(i + 1) }), text);
      e.style.left = `${50 + Math.sin(a) * 40}%`;
      e.style.top = `${50 - Math.cos(a) * 40}%`;
      this.chatWheel.append(e);
      this.chatSlots.push(e);
    });
  }

  showChatWheel(open: boolean, slot: number): void {
    this.chatWheel.classList.toggle('hidden', !open);
    this.chatSlots.forEach((e, i) => e.classList.toggle('on', i === slot));
  }

  /** A quick-chat line in the feed (bottom left). */
  chatLine(name: string, color: string, text: string): void {
    const line = el('div', { class: 'line' }, el('b', { text: name, style: { color } }), `: ${text}`);
    this.chatFeed.append(line);
    while (this.chatFeed.children.length > 5) this.chatFeed.firstElementChild?.remove();
    window.setTimeout(() => line.remove(), 7000);
  }

  /** Speech bubble over someone's head. */
  bubble(pos: THREE.Vector3, text: string): void {
    const e = el('div', { class: 'popup speech', text });
    this.popups.append(e);
    this.worldPopups.push({ el: e, pos: pos.clone(), life: 2.6, max: 2.6, vy: 0.15, scale: 0.8 });
  }

  show(v: boolean): void {
    this.root.classList.toggle('hidden', !v);
  }

  private setIf(key: string, value: string | number, apply: () => void): void {
    if (this.last[key] === value) return;
    this.last[key] = value;
    apply();
  }

  update(s: HudState, dt: number): void {
    const pct = Math.round(s.inflation * 100);
    // Near max inflation: the number pulses and the screen edges glow red.
    const danger = s.alive ? Math.max(0, Math.min(1, (s.inflation - 0.6) / 0.4)) : 0;
    this.setIf('danger', Math.round(danger * 4), () => {
      this.root.classList.toggle('danger', danger > 0);
      this.root.style.setProperty('--danger', danger.toFixed(2));
    });
    this.setIf('pct', pct, () => {
      this.pct.innerHTML = `${pct}<small>%</small>`;
      const hue = 120 - Math.min(1, s.inflation) * 120;
      this.pct.style.color = pct === 0 ? '#ffffff' : `hsl(${hue}, 95%, ${pct >= 100 ? 60 : 70}%)`;
      this.balloon.style.transform = `scale(${0.8 + s.inflation * 0.7})`;
      this.balloon.style.background = `radial-gradient(circle at 35% 30%, #fff 0 8%, transparent 9%), hsl(${hue}, 90%, 60%)`;
    });
    this.ammoPips.classList.toggle('hidden', s.stream);
    this.tank.classList.toggle('hidden', !s.stream);
    if (s.stream) {
      this.tankFill.style.width = `${Math.round((s.ammo / s.maxAmmo) * 100)}%`;
    } else {
      this.setIf('ammo', `${s.ammo}/${s.maxAmmo}`, () => {
        clear(this.ammoPips);
        for (let i = 0; i < s.maxAmmo; i++) this.ammoPips.append(el('div', { class: `pip${i < s.ammo ? '' : ' empty'}` }));
      });
    }
    this.utilEls[0].cool.style.height = `${Math.round((1 - s.u1Ready) * 100)}%`;
    this.utilEls[1].cool.style.height = `${Math.round((1 - s.u2Ready) * 100)}%`;
    this.pinBadge.classList.toggle('hidden', s.pin <= 0);
    if (s.pin > 0) this.setIf('pin', Math.ceil(s.pin), () => (this.pinBadge.textContent = `📌 PIN ${Math.ceil(s.pin)}s`));
    this.reloadBar.classList.toggle('hidden', s.reloadFrac <= 0);
    if (s.reloadFrac > 0) this.reloadFill.style.width = `${Math.round(s.reloadFrac * 100)}%`;
    this.setIf('weapon', s.weaponName, () => (this.weaponName.textContent = s.weaponName));
    const dashKey = `${s.dashCharges}|${Math.round(s.dashRechargeFrac * 20)}`;
    this.setIf('dash', dashKey, () => {
      clear(this.dashPips);
      for (let i = 0; i < BALANCE.dash.charges; i++) {
        const full = i < s.dashCharges;
        const fill = el('div', { class: 'fill', style: { height: full ? '100%' : i === s.dashCharges ? `${Math.round(s.dashRechargeFrac * 100)}%` : '0%' } });
        this.dashPips.append(el('div', { class: 'pip' }, fill));
      }
    });
    this.braceFill.style.height = `${Math.round(s.braceReady * 100)}%`;
    this.grabFill.style.height = `${Math.round(s.grabReady * 100)}%`;
    this.grappleFill.style.height = `${Math.round(s.grappleReady * 100)}%`;
    this.setIf('hint', s.hint, () => {
      this.hintEl.textContent = s.hint;
      this.hintEl.classList.toggle('hidden', !s.hint);
    });
    this.escapeBox.classList.toggle('hidden', s.heldTime < 0);
    if (s.heldTime >= 0) {
      const f = Math.min(1, s.heldTime / ESCAPE_BAR_SEC);
      this.escapeMarker.style.left = `${f * 100}%`;
      const inZone = s.heldTime >= BALANCE.grab.escapeStart && s.heldTime <= BALANCE.grab.escapeEnd;
      this.escapeBox.classList.toggle('in-zone', inZone && !s.escapeUsed);
      this.escapeLabel.textContent = s.escapeUsed ? 'MISSED IT!' : inZone ? 'NOW! DASH!' : 'DASH IN THE GREEN!';
    }
    const circ = 2 * Math.PI * 20;
    this.chargeArc.setAttribute('stroke-dashoffset', `${circ * (1 - s.charge)}`);
    this.chargeArc.setAttribute('stroke', s.charge >= 1 ? '#ff3b8a' : '#ffd60a');
    this.crosshair.style.transform = `scale(${1 + s.charge * 0.15})`;
    const clockText = s.phase === 'waiting' ? '--:--' : formatTime(s.timeLeft);
    this.setIf('clock', clockText, () => (this.clock.textContent = clockText));
    this.clock.classList.toggle('urgent', s.phase === 'playing' && s.timeLeft <= 30);
    this.setIf('sub', s.sub, () => (this.sub.textContent = s.sub));
    this.crosshair.classList.toggle('hidden', !s.alive);

    if (this.calloutTimer > 0) {
      this.calloutTimer -= dt;
      if (this.calloutTimer <= 0) clear(this.calloutBox);
    }
  }

  /** Shows team scores (or pump fill bars); null hides the strip. */
  setTeamBar(t: TeamBar | null): void {
    this.teamBar.classList.toggle('hidden', !t);
    if (!t) return;
    const key = `${t.colors.join()}|${t.names.join()}|${t.bars ? t.scores.map((x) => Math.round(x * 200)).join() : t.scores.join()}|${t.youTeam}|${t.target ?? ''}`;
    this.setIf('teamBar', key, () => {
      this.teamBar.classList.toggle('bars', t.bars);
      this.teamSides.forEach((side, i) => {
        const c = `#${t.colors[i].toString(16).padStart(6, '0')}`;
        side.box.style.setProperty('--team', c);
        side.box.classList.toggle('you', t.youTeam === i);
        side.name.textContent = t.youTeam === i ? `${t.names[i]} (YOU)` : t.names[i];
        side.score.textContent = t.bars ? `${Math.floor(t.scores[i] * 100)}%` : String(t.scores[i]);
        side.fill.style.width = `${Math.round(Math.min(1, t.bars ? t.scores[i] : t.target ? t.scores[i] / t.target : 0) * 100)}%`;
      });
    });
  }

  setEvent(text: string): void {
    this.setIf('event', text, () => {
      this.eventBanner.textContent = text;
      this.eventBanner.classList.toggle('hidden', !text);
    });
  }

  setUtilities(names: string[]): void {
    const icons: Record<string, string> = { 'Bounce Pad': '🟣', 'Air Grenade': '💥', 'Inflatable Wall': '🧱', 'Vacuum Grenade': '🌀' };
    names.forEach((n, i) => {
      const u = this.utilEls[i];
      if (!u) return;
      u.icon.textContent = icons[n] ?? '?';
      u.box.title = n;
    });
  }

  showAbilities(f: { brace: boolean; grab: boolean; grapple: boolean }): void {
    this.braceWrap.classList.toggle('hidden', !f.brace);
    this.grabWrap.classList.toggle('hidden', !f.grab);
    this.grappleWrap.classList.toggle('hidden', !f.grapple);
  }

  /** Brief full-screen tint (e.g. blue when a brace succeeds). */
  flash(color: string, ms = 250): void {
    this.flashEl.style.boxShadow = `inset 0 0 160px 40px ${color}`;
    this.flashEl.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms, easing: 'ease-out' });
  }

  /** `strength` 0..1: harder hits draw a bigger, hotter marker. */
  hitMarker(strength = 0.5): void {
    this.hitmarker.classList.remove('show');
    void this.hitmarker.offsetWidth;
    this.hitmarker.style.setProperty('--hm', (0.9 + strength * 0.9).toFixed(2));
    this.hitmarker.classList.toggle('big', strength > 0.5);
    this.hitmarker.classList.add('show');
    this.crosshair.classList.add('hit');
    window.setTimeout(() => this.crosshair.classList.remove('hit'), 90);
  }

  addKill(html: string, me: boolean): void {
    const item = el('div', { class: `item${me ? ' me' : ''}`, html });
    this.killfeed.prepend(item);
    while (this.killfeed.children.length > 5) this.killfeed.lastElementChild?.remove();
    window.setTimeout(() => item.remove(), 6000);
  }

  callout(main: string, sub = '', seconds = 2.2, color?: string): void {
    clear(this.calloutBox);
    const m = el('div', { class: 'main', text: main });
    if (color) m.style.color = color;
    this.calloutBox.append(m);
    if (sub) this.calloutBox.append(el('div', { class: 'sub', text: sub }));
    this.calloutTimer = seconds;
  }

  setRespawn(big: string | null, small = ''): void {
    this.respawnBox.classList.toggle('hidden', !big);
    if (big) {
      const key = `${big}|${small}`;
      this.setIf('respawn', key, () => {
        clear(this.respawnBox);
        this.respawnBox.append(el('div', { class: 'big', text: big }), el('div', { class: 'small', text: small }));
      });
    }
  }

  setNote(text: string): void {
    this.setIf('note', text, () => (this.note.textContent = text));
  }

  /** Shows a red arc pointing toward where a hit came from (angle 0 = straight ahead). */
  damageFrom(angle: number): void {
    const arc = el('div', { class: 'arc' });
    this.damage.append(arc);
    this.damage.style.transform = '';
    arc.style.transformOrigin = '50% 130px';
    arc.style.transform = `rotate(${angle}rad)`;
    arc.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 900, easing: 'ease-out' }).onfinish = () => arc.remove();
  }

  toast(text: string, ms = 2500): void {
    const t = el('div', { class: 'toast', text });
    this.root.append(t);
    window.setTimeout(() => t.remove(), ms);
  }

  // --- World-space popups (comic sound-effect text) -----------------------------------------

  popup(pos: THREE.Vector3, text: string, color = '#ffffff', scale = 1, life = 1): void {
    const e = el('div', { class: 'popup', text });
    e.style.color = color;
    this.popups.append(e);
    this.worldPopups.push({ el: e, pos: pos.clone(), life, max: life, vy: 1.4, scale });
    if (this.worldPopups.length > 30) {
      const old = this.worldPopups.shift();
      old?.el.remove();
    }
  }

  updatePopups(camera: THREE.Camera, dt: number): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    for (let i = this.worldPopups.length - 1; i >= 0; i--) {
      const p = this.worldPopups[i];
      p.life -= dt;
      p.pos.y += p.vy * dt;
      if (p.life <= 0) {
        p.el.remove();
        this.worldPopups.splice(i, 1);
        continue;
      }
      const v = this.tmp.copy(p.pos).project(camera);
      if (v.z > 1) {
        p.el.style.opacity = '0';
        continue;
      }
      const t = 1 - p.life / p.max;
      const pop = t < 0.15 ? 0.4 + (t / 0.15) * 0.8 : 1.2 - Math.min(0.2, (t - 0.15) * 0.5);
      const x = (v.x * 0.5 + 0.5) * w;
      const y = (-v.y * 0.5 + 0.5) * h;
      p.el.style.opacity = String(Math.min(1, p.life / (p.max * 0.35)));
      p.el.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px) scale(${pop * p.scale}) rotate(${Math.sin(p.max * 7) * 8}deg)`;
    }
  }

  /** `team` is a CSS color for team modes: allies get a colored name and a marker. */
  createNametag(name: string, bot: boolean, team?: { color: number; ally: boolean }): Nametag {
    const pct = el('div', { class: 'pct', text: '0%' });
    const nm = el('div', { class: 'nm' }, team?.ally ? '▼ ' : '', name, bot ? el('span', { class: 'bot', text: 'BOT' }) : null);
    const tag = el('div', { class: `nametag${team ? (team.ally ? ' ally' : ' enemy') : ''}` }, pct, nm);
    if (team) tag.style.setProperty('--team', `#${team.color.toString(16).padStart(6, '0')}`);
    this.nametags.append(tag);
    return { el: tag, pct, name: nm };
  }
}
