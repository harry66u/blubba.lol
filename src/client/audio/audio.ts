/**
 * Procedural sound effects with Web Audio: no audio files to download, so the game loads
 * instantly. Every sound here has a matching visual elsewhere (spec §2: fully playable muted).
 */

export interface VolumeSettings {
  master: number;
  effects: number;
  announcer: number;
  music: number;
  muted: boolean;
}

type Bus = 'effects' | 'announcer' | 'music';

export class Audio {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private buses!: Record<Bus, GainNode>;
  private noiseBuf!: AudioBuffer;
  private volumes: VolumeSettings;
  /** Listener position/orientation for simple stereo panning and distance falloff. */
  private lx = 0;
  private ly = 0;
  private lz = 0;
  private rightX = 1;
  private rightZ = 0;
  private chargeOsc: OscillatorNode | null = null;
  private chargeGain: GainNode | null = null;
  private lastPlay = new Map<string, number>();

  constructor(volumes: VolumeSettings) {
    this.volumes = { ...volumes };
  }

  /** Must be called from a user gesture (browsers block audio until then). */
  unlock(): void {
    if (!this.ctx) {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx({ latencyHint: 'interactive' });
      this.master = this.ctx.createGain();
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -12;
      comp.ratio.value = 4;
      this.master.connect(comp).connect(this.ctx.destination);
      this.buses = {
        effects: this.ctx.createGain(),
        announcer: this.ctx.createGain(),
        music: this.ctx.createGain(),
      };
      for (const b of Object.values(this.buses)) b.connect(this.master);
      const len = this.ctx.sampleRate * 2;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.applyVolumes();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setVolumes(v: VolumeSettings): void {
    this.volumes = { ...v };
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    const v = this.volumes;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(v.muted ? 0 : v.master, t, 0.02);
    this.buses.effects.gain.setTargetAtTime(v.effects, t, 0.02);
    this.buses.announcer.gain.setTargetAtTime(v.announcer, t, 0.02);
    this.buses.music.gain.setTargetAtTime(v.music, t, 0.02);
  }

  get musicBus(): GainNode | null {
    return this.ctx ? this.buses.music : null;
  }

  setListener(x: number, y: number, z: number, yaw: number): void {
    this.lx = x;
    this.ly = y;
    this.lz = z;
    this.rightX = Math.cos(yaw);
    this.rightZ = -Math.sin(yaw);
  }

  /** Output node for a sound at a world position (null = non-positional, e.g. your own sounds). */
  private out(pos: [number, number, number] | null, gain: number, bus: Bus = 'effects'): GainNode | null {
    if (!this.ctx) return null;
    const g = this.ctx.createGain();
    let vol = gain;
    let node: AudioNode = g;
    if (pos) {
      const dx = pos[0] - this.lx;
      const dy = pos[1] - this.ly;
      const dz = pos[2] - this.lz;
      const d = Math.hypot(dx, dy, dz);
      vol *= 1 / (1 + d / 14);
      if (vol < 0.02) return null;
      const pan = this.ctx.createStereoPanner();
      pan.pan.value = d > 0.5 ? Math.max(-0.85, Math.min(0.85, (dx * this.rightX + dz * this.rightZ) / d)) : 0;
      g.connect(pan);
      node = pan;
    }
    g.gain.value = vol;
    node.connect(this.buses[bus]);
    return g;
  }

  private throttle(key: string, ms: number): boolean {
    const now = performance.now();
    const last = this.lastPlay.get(key) ?? 0;
    if (now - last < ms) return false;
    this.lastPlay.set(key, now);
    return true;
  }

  private noise(dest: AudioNode, t0: number, dur: number): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.connect(dest);
    src.start(t0, Math.random());
    src.stop(t0 + dur + 0.05);
    return src;
  }

  private env(g: GainNode, t0: number, attack: number, peak: number, decay: number): void {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  }

  // --- Sounds ---------------------------------------------------------------------------

  /** Air Cannon shot: a thumpy "pomf". */
  shoot(power: number, pos: [number, number, number] | null = null): void {
    const out = this.out(pos, 0.7);
    if (!out) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(180 + power * 60, t);
    osc.frequency.exponentialRampToValueAtTime(50, t + 0.18);
    const og = ctx.createGain();
    this.env(og, t, 0.005, 0.8, 0.2);
    osc.connect(og).connect(out);
    osc.start(t);
    osc.stop(t + 0.3);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(2500 + power * 2000, t);
    f.frequency.exponentialRampToValueAtTime(300, t + 0.25);
    const ng = ctx.createGain();
    this.env(ng, t, 0.005, 0.5 + power * 0.3, 0.25);
    f.connect(ng).connect(out);
    this.noise(f, t, 0.3);
  }

  /** Air blast impact: whoosh. */
  whoosh(power: number, pos: [number, number, number] | null): void {
    if (!this.throttle('whoosh', 30)) return;
    const out = this.out(pos, 0.55 + power * 0.3);
    if (!out) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 0.8;
    f.frequency.setValueAtTime(1800, t);
    f.frequency.exponentialRampToValueAtTime(250, t + 0.35);
    const g = ctx.createGain();
    this.env(g, t, 0.01, 0.9, 0.35);
    f.connect(g).connect(out);
    this.noise(f, t, 0.4);
  }

  /** Squeaky rubber hit. Higher pitch the more inflated the target is. */
  squeak(inflation: number, pos: [number, number, number] | null): void {
    if (!this.throttle('squeak', 40)) return;
    const out = this.out(pos, 0.45);
    if (!out) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const base = 520 + inflation * 700 + Math.random() * 120;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(base, t);
    osc.frequency.exponentialRampToValueAtTime(base * 1.9, t + 0.06);
    osc.frequency.exponentialRampToValueAtTime(base * 1.1, t + 0.16);
    const vib = ctx.createOscillator();
    vib.frequency.value = 38;
    const vg = ctx.createGain();
    vg.gain.value = base * 0.06;
    vib.connect(vg).connect(osc.frequency);
    const g = ctx.createGain();
    this.env(g, t, 0.005, 0.7, 0.17);
    osc.connect(g).connect(out);
    osc.start(t);
    vib.start(t);
    osc.stop(t + 0.25);
    vib.stop(t + 0.25);
  }

  /** Groin-shot groan: a descending, formant-filtered "ooof". */
  groan(pos: [number, number, number] | null): void {
    const out = this.out(pos, 0.8);
    if (!out) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    const f0 = 150 + Math.random() * 30;
    osc.frequency.setValueAtTime(f0 * 1.25, t);
    osc.frequency.linearRampToValueAtTime(f0, t + 0.12);
    osc.frequency.exponentialRampToValueAtTime(f0 * 0.6, t + 0.6);
    const g = ctx.createGain();
    this.env(g, t, 0.03, 0.6, 0.6);
    for (const [freq, q, amp] of [
      [600, 8, 1],
      [1000, 10, 0.5],
      [2400, 12, 0.2],
    ]) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(freq, t);
      bp.frequency.linearRampToValueAtTime(freq * 0.7, t + 0.6);
      bp.Q.value = q;
      const a = ctx.createGain();
      a.gain.value = amp * 3;
      osc.connect(bp).connect(a).connect(g);
    }
    g.connect(out);
    osc.start(t);
    osc.stop(t + 0.7);
  }

  /** Dash fart with a randomized pitch; `long` is the rare extra-long one. */
  fart(pos: [number, number, number] | null, long = false): void {
    const out = this.out(pos, 0.75);
    if (!out) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const dur = long ? 1.4 + Math.random() * 0.4 : 0.22 + Math.random() * 0.14;
    const f0 = 65 + Math.random() * 55;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(f0 * 1.3, t);
    if (long) {
      osc.frequency.linearRampToValueAtTime(f0 * 0.9, t + dur * 0.3);
      osc.frequency.linearRampToValueAtTime(f0 * 1.25, t + dur * 0.55);
      osc.frequency.linearRampToValueAtTime(f0 * 0.7, t + dur);
    } else {
      osc.frequency.exponentialRampToValueAtTime(f0 * 0.75, t + dur);
    }
    // Flutter: amplitude modulation gives the rubbery "brrrt".
    const flutter = ctx.createOscillator();
    flutter.type = 'square';
    flutter.frequency.setValueAtTime(24 + Math.random() * 14, t);
    const fg = ctx.createGain();
    fg.gain.value = 0.45;
    const am = ctx.createGain();
    am.gain.value = 0.55;
    flutter.connect(fg).connect(am.gain);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 520 + Math.random() * 300;
    lp.Q.value = 4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.9, t + 0.02);
    g.gain.setValueAtTime(0.9, t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(am).connect(lp).connect(g).connect(out);
    const nf = ctx.createBiquadFilter();
    nf.type = 'lowpass';
    nf.frequency.value = 400;
    const ng = ctx.createGain();
    ng.gain.value = 0.25;
    nf.connect(ng).connect(g);
    this.noise(nf, t, dur);
    osc.start(t);
    flutter.start(t);
    osc.stop(t + dur + 0.05);
    flutter.stop(t + dur + 0.05);
  }

  /** Burp for taunts and soda cans. */
  burp(pos: [number, number, number] | null): void {
    const out = this.out(pos, 0.8);
    if (!out) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const dur = 0.45 + Math.random() * 0.3;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    const f0 = 85 + Math.random() * 30;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.linearRampToValueAtTime(f0 * 1.15, t + dur * 0.4);
    osc.frequency.linearRampToValueAtTime(f0 * 0.8, t + dur);
    const flutter = ctx.createOscillator();
    flutter.frequency.value = 17;
    const fg = ctx.createGain();
    fg.gain.value = 0.35;
    const am = ctx.createGain();
    am.gain.value = 0.65;
    flutter.connect(fg).connect(am.gain);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(420, t);
    bp.frequency.linearRampToValueAtTime(650, t + dur);
    bp.Q.value = 3;
    const g = ctx.createGain();
    this.env(g, t, 0.03, 1.2, dur);
    osc.connect(am).connect(bp).connect(g).connect(out);
    osc.start(t);
    flutter.start(t);
    osc.stop(t + dur + 0.1);
    flutter.stop(t + dur + 0.1);
  }

  /** Deflating-balloon squeal when a player is knocked off the map. */
  squeal(pos: [number, number, number] | null): void {
    const out = this.out(pos, 0.6);
    if (!out) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const dur = 1.3;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    const f0 = 900 + Math.random() * 300;
    osc.frequency.setValueAtTime(f0, t);
    for (let i = 1; i <= 10; i++) {
      osc.frequency.linearRampToValueAtTime(f0 * (1 - i * 0.05) * (1 + (Math.random() - 0.5) * 0.25), t + (i / 10) * dur);
    }
    const vib = ctx.createOscillator();
    vib.frequency.value = 22;
    const vg = ctx.createGain();
    vg.gain.value = 60;
    vib.connect(vg).connect(osc.frequency);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1400;
    bp.Q.value = 1.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.04);
    g.gain.setValueAtTime(0.5, t + dur * 0.75);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(bp).connect(g).connect(out);
    osc.start(t);
    vib.start(t);
    osc.stop(t + dur + 0.05);
    vib.stop(t + dur + 0.05);
  }

  /** Springy boing for jumps and bounce pads. */
  boing(pos: [number, number, number] | null, big = false): void {
    if (!this.throttle(`boing${big}`, 50)) return;
    const out = this.out(pos, big ? 0.6 : 0.22);
    if (!out) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    const f = big ? 180 : 320 + Math.random() * 60;
    osc.frequency.setValueAtTime(f, t);
    osc.frequency.exponentialRampToValueAtTime(f * (big ? 3 : 1.8), t + (big ? 0.3 : 0.12));
    const vib = ctx.createOscillator();
    vib.frequency.value = big ? 18 : 30;
    const vg = ctx.createGain();
    vg.gain.value = f * 0.12;
    vib.connect(vg).connect(osc.frequency);
    const g = ctx.createGain();
    this.env(g, t, 0.005, 0.7, big ? 0.45 : 0.15);
    osc.connect(g).connect(out);
    osc.start(t);
    vib.start(t);
    osc.stop(t + 0.6);
    vib.stop(t + 0.6);
  }

  thud(pos: [number, number, number] | null, strength: number): void {
    if (!this.throttle('thud', 60)) return;
    const out = this.out(pos, Math.min(0.7, 0.2 + strength * 0.03));
    if (!out) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(110, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    const g = ctx.createGain();
    this.env(g, t, 0.003, 0.9, 0.14);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + 0.2);
  }

  /** Satisfying pop when your shot connects. */
  hitConfirm(): void {
    const out = this.out(null, 0.35);
    if (!out) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(900, t);
    osc.frequency.exponentialRampToValueAtTime(1600, t + 0.05);
    const g = ctx.createGain();
    this.env(g, t, 0.002, 0.8, 0.09);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + 0.12);
  }

  /** Little fanfare when you knock someone out. */
  koConfirm(): void {
    const out = this.out(null, 0.35);
    if (!out) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    [523, 659, 784, 1047].forEach((f, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = f;
      const g = ctx.createGain();
      const t0 = t + i * 0.07;
      this.env(g, t0, 0.005, 0.35, 0.18);
      const lp = ctx.createBiquadFilter();
      lp.frequency.value = 3000;
      osc.connect(lp).connect(g).connect(out);
      osc.start(t0);
      osc.stop(t0 + 0.25);
    });
  }

  /** Metallic clang for a successful brace. */
  clang(pos: [number, number, number] | null): void {
    const out = this.out(pos, 0.5);
    if (!out) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    for (const [f, a] of [
      [523, 1],
      [1330, 0.6],
      [2210, 0.4],
      [3150, 0.25],
    ]) {
      const osc = ctx.createOscillator();
      osc.frequency.value = f;
      const g = ctx.createGain();
      this.env(g, t, 0.002, a * 0.5, 0.5);
      osc.connect(g).connect(out);
      osc.start(t);
      osc.stop(t + 0.6);
    }
  }

  reload(): void {
    const out = this.out(null, 0.35);
    if (!out) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 1500;
    const g = ctx.createGain();
    this.env(g, t, 0.02, 0.5, 0.35);
    f.connect(g).connect(out);
    this.noise(f, t, 0.4);
    const click = ctx.createOscillator();
    click.type = 'square';
    click.frequency.value = 1800;
    const cg = ctx.createGain();
    this.env(cg, t + 0.4, 0.001, 0.4, 0.03);
    click.connect(cg).connect(out);
    click.start(t + 0.4);
    click.stop(t + 0.45);
  }

  emptyClick(): void {
    if (!this.throttle('empty', 150)) return;
    const out = this.out(null, 0.3);
    if (!out) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = 2400;
    const g = ctx.createGain();
    this.env(g, t, 0.001, 0.3, 0.02);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + 0.05);
  }

  pop(pos: [number, number, number] | null): void {
    const out = this.out(pos, 0.5);
    if (!out) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 2000;
    const g = ctx.createGain();
    this.env(g, t, 0.001, 1, 0.08);
    f.connect(g).connect(out);
    this.noise(f, t, 0.1);
  }

  uiClick(): void {
    const out = this.out(null, 0.2);
    if (!out) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(600, t);
    osc.frequency.exponentialRampToValueAtTime(900, t + 0.04);
    const g = ctx.createGain();
    this.env(g, t, 0.002, 0.5, 0.06);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + 0.1);
  }

  /** Grapple line shooting out. */
  thwip(pos: [number, number, number] | null): void {
    const out = this.out(pos, 0.45);
    if (!out) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 6;
    f.frequency.setValueAtTime(600, t);
    f.frequency.exponentialRampToValueAtTime(4000, t + 0.12);
    const g = ctx.createGain();
    this.env(g, t, 0.005, 1, 0.14);
    f.connect(g).connect(out);
    this.noise(f, t, 0.16);
  }

  /** Rubbery stretch when grabbing someone. */
  stretch(pos: [number, number, number] | null): void {
    const out = this.out(pos, 0.5);
    if (!out) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(140, t);
    osc.frequency.exponentialRampToValueAtTime(420, t + 0.25);
    const lp = ctx.createBiquadFilter();
    lp.frequency.value = 900;
    lp.Q.value = 8;
    const g = ctx.createGain();
    this.env(g, t, 0.01, 0.6, 0.28);
    osc.connect(lp).connect(g).connect(out);
    osc.start(t);
    osc.stop(t + 0.35);
  }

  /** Air Horn: a big two-tone honk. Louder with more charge. */
  honk(power: number, pos: [number, number, number] | null): void {
    const out = this.out(pos, 0.5 + power * 0.4);
    if (!out) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const dur = 0.35 + power * 0.35;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.7, t + 0.02);
    g.gain.setValueAtTime(0.7, t + dur * 0.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const lp = ctx.createBiquadFilter();
    lp.frequency.value = 2400;
    for (const f of [233, 311, 466]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(f * (0.97 + power * 0.03), t);
      osc.connect(lp);
      osc.start(t);
      osc.stop(t + dur + 0.05);
    }
    lp.connect(g).connect(out);
  }

  /** Pump Rifle crack. */
  pew(power: number, pos: [number, number, number] | null): void {
    const out = this.out(pos, 0.6);
    if (!out) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(1800 + power * 800, t);
    osc.frequency.exponentialRampToValueAtTime(220, t + 0.14);
    const g = ctx.createGain();
    this.env(g, t, 0.002, 0.45, 0.16);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 300;
    osc.connect(hp).connect(g).connect(out);
    osc.start(t);
    osc.stop(t + 0.2);
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 2500;
    const ng = ctx.createGain();
    this.env(ng, t, 0.001, 0.5, 0.08);
    f.connect(ng).connect(out);
    this.noise(f, t, 0.1);
  }

  private blowerNodes: { src: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode } | null = null;

  /** Continuous leaf-blower roar for your own blower (0 = off). */
  setBlower(strength: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (strength > 0 && !this.blowerNodes) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = 0.9;
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      src.connect(filter).connect(gain).connect(this.buses.effects);
      src.start();
      this.blowerNodes = { src, gain, filter };
    }
    if (!this.blowerNodes) return;
    if (strength <= 0) {
      this.blowerNodes.gain.gain.setTargetAtTime(0, t, 0.05);
      const n = this.blowerNodes;
      setTimeout(() => n.src.stop(), 300);
      this.blowerNodes = null;
      return;
    }
    this.blowerNodes.filter.frequency.setTargetAtTime(400 + strength * 900, t, 0.05);
    this.blowerNodes.gain.gain.setTargetAtTime(0.18 + strength * 0.25, t, 0.05);
  }

  /** Short whoosh for other players' leaf blowers hitting someone. */
  gust(pos: [number, number, number] | null): void {
    if (!this.throttle('gust', 120)) return;
    const out = this.out(pos, 0.3);
    if (!out) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(700, t);
    f.frequency.linearRampToValueAtTime(1200, t + 0.3);
    const g = ctx.createGain();
    this.env(g, t, 0.05, 0.6, 0.3);
    f.connect(g).connect(out);
    this.noise(f, t, 0.4);
  }

  /** Grenade tick and vacuum suck. */
  beep(pos: [number, number, number] | null): void {
    const out = this.out(pos, 0.25);
    if (!out) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.frequency.value = 1500;
    const g = ctx.createGain();
    this.env(g, t, 0.002, 0.5, 0.05);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + 0.08);
  }

  suck(pos: [number, number, number] | null): void {
    const out = this.out(pos, 0.6);
    if (!out) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 3;
    f.frequency.setValueAtTime(2500, t);
    f.frequency.exponentialRampToValueAtTime(200, t + 1.2);
    const g = ctx.createGain();
    this.env(g, t, 0.1, 0.9, 1.1);
    f.connect(g).connect(out);
    this.noise(f, t, 1.3);
  }

  /** Soda can crack. */
  canOpen(pos: [number, number, number] | null): void {
    const out = this.out(pos, 0.5);
    if (!out) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 3000;
    const g = ctx.createGain();
    this.env(g, t, 0.001, 0.8, 0.25);
    f.connect(g).connect(out);
    this.noise(f, t, 0.3);
  }

  /** Big balloon pop (a pin popping someone). */
  bigPop(pos: [number, number, number] | null): void {
    const out = this.out(pos, 1);
    if (!out) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(6000, t);
    f.frequency.exponentialRampToValueAtTime(300, t + 0.2);
    const g = ctx.createGain();
    this.env(g, t, 0.001, 1.2, 0.25);
    f.connect(g).connect(out);
    this.noise(f, t, 0.3);
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(120, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.2);
    const og = ctx.createGain();
    this.env(og, t, 0.001, 0.9, 0.2);
    osc.connect(og).connect(out);
    osc.start(t);
    osc.stop(t + 0.25);
  }

  /** A short melody on a synth voice. `notes` are [semitones above base, start, length] in seconds. */
  private melody(pos: [number, number, number] | null, gain: number, voice: 'kazoo' | 'trumpet' | 'duck', base: number, notes: [number, number, number][]): void {
    const out = this.out(pos, gain);
    if (!out) return;
    const ctx = this.ctx!;
    const t0 = ctx.currentTime;
    for (const [semi, at, len] of notes) {
      const t = t0 + at;
      const f = base * 2 ** (semi / 12);
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      const filt = ctx.createBiquadFilter();
      if (voice === 'kazoo') {
        // Buzzy sawtooth through a nasal band-pass, with wobbly vibrato.
        osc.type = 'sawtooth';
        filt.type = 'bandpass';
        filt.frequency.value = 1400;
        filt.Q.value = 3;
        const vib = ctx.createOscillator();
        vib.frequency.value = 7;
        const vg = ctx.createGain();
        vg.gain.value = f * 0.03;
        vib.connect(vg).connect(osc.frequency);
        vib.start(t);
        vib.stop(t + len + 0.05);
      } else if (voice === 'trumpet') {
        osc.type = 'sawtooth';
        filt.type = 'lowpass';
        filt.frequency.setValueAtTime(900, t);
        filt.frequency.linearRampToValueAtTime(2600, t + 0.06);
      } else {
        // Rubber duck: a squeaky square wave that bends down.
        osc.type = 'square';
        filt.type = 'bandpass';
        filt.frequency.value = 1800;
        filt.Q.value = 2;
        osc.frequency.setValueAtTime(f * 1.25, t);
        osc.frequency.exponentialRampToValueAtTime(f * 0.8, t + len);
      }
      if (voice !== 'duck') osc.frequency.setValueAtTime(f, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.6, t + 0.02);
      g.gain.setValueAtTime(0.6, t + Math.max(0.03, len - 0.05));
      g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      osc.connect(filt).connect(g).connect(out);
      osc.start(t);
      osc.stop(t + len + 0.05);
    }
  }

  /** Slide whistle: up, or up-and-down. */
  slideWhistle(pos: [number, number, number] | null, down = false): void {
    const out = this.out(pos, 0.35);
    if (!out) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(down ? 1800 : 500, t);
    osc.frequency.exponentialRampToValueAtTime(down ? 400 : 1900, t + 0.55);
    if (!down) osc.frequency.exponentialRampToValueAtTime(700, t + 0.8);
    const g = ctx.createGain();
    this.env(g, t, 0.02, 0.6, 0.85);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + 0.9);
  }

  /** Knockout sound from the knocker's sound pack. Classic is the normal pop and squeal. */
  koSound(pack: string, pos: [number, number, number] | null): void {
    switch (pack) {
      case 'boing':
        this.boing(pos, true);
        break;
      case 'kazoo':
        this.melody(pos, 0.3, 'kazoo', 392, [[0, 0, 0.14], [4, 0.15, 0.14], [7, 0.3, 0.35]]);
        break;
      case 'duck':
        this.melody(pos, 0.3, 'duck', 700, [[0, 0, 0.12], [0, 0.16, 0.18]]);
        break;
      case 'slide':
        this.slideWhistle(pos, true);
        break;
      case 'trumpet':
        this.melody(pos, 0.3, 'trumpet', 262, [[0, 0, 0.12], [4, 0.13, 0.12], [7, 0.26, 0.12], [12, 0.39, 0.5]]);
        break;
      default:
        break;
    }
  }

  /** Taunt sound from the sound pack (classic = the big burp). */
  tauntSound(pack: string, pos: [number, number, number] | null): void {
    switch (pack) {
      case 'boing':
        this.boing(pos, true);
        break;
      case 'kazoo':
        this.melody(pos, 0.3, 'kazoo', 330, [[0, 0, 0.12], [2, 0.13, 0.12], [4, 0.26, 0.12], [0, 0.39, 0.3]]);
        break;
      case 'duck':
        this.melody(pos, 0.3, 'duck', 650, [[0, 0, 0.1], [2, 0.12, 0.1], [0, 0.24, 0.16]]);
        break;
      case 'slide':
        this.slideWhistle(pos);
        break;
      case 'trumpet':
        this.melody(pos, 0.3, 'trumpet', 233, [[0, 0, 0.1], [0, 0.12, 0.1], [0, 0.24, 0.1], [5, 0.36, 0.45]]);
        break;
      default:
        this.burp(pos);
    }
  }

  /** Stadium horn plus a crowd roar (noise swell) for goals and giant tube men filling up. */
  goalHorn(): void {
    const out = this.out(null, 0.35);
    if (!out) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const lp = ctx.createBiquadFilter();
    lp.frequency.value = 1800;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.6, t + 0.04);
    g.gain.setValueAtTime(0.6, t + 1.1);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
    for (const f of [175, 220, 262]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(f, t);
      osc.frequency.setValueAtTime(f * 1.12, t + 0.55);
      osc.connect(lp);
      osc.start(t);
      osc.stop(t + 1.55);
    }
    lp.connect(g).connect(out);
    // Crowd: band-passed noise that swells and fades.
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900;
    bp.Q.value = 0.6;
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(0.0001, t);
    cg.gain.exponentialRampToValueAtTime(0.35, t + 0.4);
    cg.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
    this.noise(bp, t, 2.5);
    bp.connect(cg).connect(out);
  }

  /** Two-tone alert for random events and the final countdown. */
  siren(): void {
    const out = this.out(null, 0.25);
    if (!out) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    for (let i = 0; i < 4; i++) {
      osc.frequency.setValueAtTime(i % 2 ? 660 : 880, t + i * 0.18);
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.02);
    g.gain.setValueAtTime(0.5, t + 0.65);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.75);
    const lp = ctx.createBiquadFilter();
    lp.frequency.value = 2200;
    osc.connect(lp).connect(g).connect(out);
    osc.start(t);
    osc.stop(t + 0.8);
  }

  /** Rising whine while charging a shot (only for your own weapon). */
  setCharge(charge: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (charge > 0 && !this.chargeOsc) {
      this.chargeOsc = this.ctx.createOscillator();
      this.chargeOsc.type = 'triangle';
      this.chargeGain = this.ctx.createGain();
      this.chargeGain.gain.value = 0;
      this.chargeOsc.connect(this.chargeGain).connect(this.buses.effects);
      this.chargeOsc.start();
    }
    if (this.chargeOsc && this.chargeGain) {
      if (charge <= 0) {
        this.chargeGain.gain.setTargetAtTime(0, t, 0.02);
        const osc = this.chargeOsc;
        setTimeout(() => osc.stop(), 150);
        this.chargeOsc = null;
        this.chargeGain = null;
        return;
      }
      this.chargeOsc.frequency.setTargetAtTime(220 + charge * 520 + (charge >= 1 ? Math.sin(t * 60) * 20 : 0), t, 0.03);
      this.chargeGain.gain.setTargetAtTime(0.05 + charge * 0.07, t, 0.03);
    }
  }
}
