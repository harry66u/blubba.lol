/**
 * Procedural, bouncy background music on the music bus. Nothing to download: a tiny step
 * sequencer plays bass, chords, an arpeggio, and drums from a chord progression.
 */

export type MusicMood = 'off' | 'menu' | 'match' | 'final';

const PROGRESSION = [
  [60, 64, 67], // C
  [55, 59, 62], // G
  [57, 60, 64], // Am
  [53, 57, 60], // F
];
const ARP = [0, 1, 2, 1, 0, 2, 1, 2];

function mtof(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

export class Music {
  private mood: MusicMood = 'off';
  private timer: number | null = null;
  private nextTime = 0;
  private step = 0;
  private noise: AudioBuffer | null = null;

  constructor(
    private readonly getCtx: () => AudioContext | null,
    private readonly getBus: () => GainNode | null,
  ) {}

  setMood(mood: MusicMood): void {
    if (mood === this.mood) return;
    this.mood = mood;
    if (mood === 'off') {
      if (this.timer !== null) window.clearInterval(this.timer);
      this.timer = null;
      return;
    }
    if (this.timer === null) {
      const ctx = this.getCtx();
      if (!ctx) {
        this.mood = 'off';
        return;
      }
      this.nextTime = ctx.currentTime + 0.1;
      this.step = 0;
      this.timer = window.setInterval(() => this.schedule(), 25);
    }
  }

  private tempo(): number {
    return this.mood === 'final' ? 138 : this.mood === 'menu' ? 104 : 120;
  }

  private schedule(): void {
    const ctx = this.getCtx();
    const bus = this.getBus();
    if (!ctx || !bus) return;
    if (!this.noise) {
      const len = ctx.sampleRate;
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    const stepDur = 60 / this.tempo() / 4;
    // If the tab was in the background, don't try to catch up on missed notes.
    if (this.nextTime < ctx.currentTime - 0.2) this.nextTime = ctx.currentTime + 0.05;
    while (this.nextTime < ctx.currentTime + 0.12) {
      this.playStep(ctx, bus, this.step, this.nextTime, stepDur);
      this.nextTime += stepDur;
      this.step = (this.step + 1) % 64;
    }
  }

  private tone(ctx: AudioContext, bus: GainNode, type: OscillatorType, freq: number, t: number, dur: number, vol: number, cutoff = 4000): void {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(f).connect(g).connect(bus);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private drum(ctx: AudioContext, bus: GainNode, kind: 'kick' | 'snare' | 'hat', t: number): void {
    if (kind === 'kick') {
      const osc = ctx.createOscillator();
      osc.frequency.setValueAtTime(140, t);
      osc.frequency.exponentialRampToValueAtTime(45, t + 0.12);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.5, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      osc.connect(g).connect(bus);
      osc.start(t);
      osc.stop(t + 0.2);
      return;
    }
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = kind === 'hat' ? 'highpass' : 'bandpass';
    f.frequency.value = kind === 'hat' ? 7000 : 1800;
    const g = ctx.createGain();
    const dur = kind === 'hat' ? 0.04 : 0.12;
    g.gain.setValueAtTime(kind === 'hat' ? 0.08 : 0.22, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(bus);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  private playStep(ctx: AudioContext, bus: GainNode, step: number, t: number, stepDur: number): void {
    const bar = Math.floor(step / 16) % PROGRESSION.length;
    const s = step % 16;
    const chord = PROGRESSION[bar];
    const menu = this.mood === 'menu';
    const final = this.mood === 'final';
    // Bass: root on the beat, bouncy octave on the off-beat.
    if (s % 4 === 0) this.tone(ctx, bus, 'triangle', mtof(chord[0] - 24), t, stepDur * 1.8, 0.22, 900);
    if (s % 4 === 2) this.tone(ctx, bus, 'triangle', mtof(chord[0] - 12), t, stepDur * 0.9, 0.12, 900);
    // Chord stabs on the off-beats.
    if (!menu && (s === 2 || s === 6 || s === 10 || s === 14)) {
      for (const n of chord) this.tone(ctx, bus, 'square', mtof(n), t, stepDur * 0.8, 0.025, 1800);
    }
    if (menu && s === 0) {
      for (const n of chord) this.tone(ctx, bus, 'sine', mtof(n), t, stepDur * 14, 0.05, 1500);
    }
    // Plucky arpeggio.
    if (s % 2 === 0 || final) {
      const n = chord[ARP[(s >> (final ? 0 : 1)) % ARP.length]] + 12;
      this.tone(ctx, bus, 'sine', mtof(n), t, stepDur * 1.2, menu ? 0.04 : 0.06, 3000);
    }
    if (menu) return;
    // Drums.
    if (s % 4 === 0) this.drum(ctx, bus, 'kick', t);
    if (s === 4 || s === 12) this.drum(ctx, bus, 'snare', t);
    if (s % 2 === 1 || final) this.drum(ctx, bus, 'hat', t);
  }
}
