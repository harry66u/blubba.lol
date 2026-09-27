/**
 * Physically modelled body sounds, rendered into sample buffers once and then played back like
 * recordings (with random pitch). Oscillator-plus-filter synthesis always sounds like a synth;
 * these model the actual mechanism instead:
 *
 * - Fart / raspberry: a flap (the "valve") opening and slapping shut at an irregular rate, each
 *   slap exciting a few body resonances, with turbulent air noise gated by the opening.
 * - Burp and "oof": a creaky vocal pulse train through vowel formants (a tiny source-filter
 *   voice), ending in a "p" pop or an "f" breath.
 * - Deflating balloon: the rubber neck buzzing at a high, wobbling, falling pitch, plus hiss.
 * - Rubber squeak and hit impact.
 *
 * Everything here is pure math (no Web Audio), so it can be unit tested.
 */

export type Rng = () => number;

export function makeRng(seed: number): Rng {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** RBJ biquad. */
class Biquad {
  private z1 = 0;
  private z2 = 0;
  constructor(
    private b0: number,
    private b1: number,
    private b2: number,
    private a1: number,
    private a2: number,
  ) {}

  static bandpass(sr: number, f: number, q: number): Biquad {
    const w = (2 * Math.PI * Math.min(f, sr * 0.45)) / sr;
    const alpha = Math.sin(w) / (2 * q);
    const a0 = 1 + alpha;
    // Constant 0 dB peak gain.
    return new Biquad(alpha / a0, 0, -alpha / a0, (-2 * Math.cos(w)) / a0, (1 - alpha) / a0);
  }

  static lowpass(sr: number, f: number, q = 0.707): Biquad {
    const w = (2 * Math.PI * Math.min(f, sr * 0.45)) / sr;
    const alpha = Math.sin(w) / (2 * q);
    const c = Math.cos(w);
    const a0 = 1 + alpha;
    return new Biquad((1 - c) / 2 / a0, (1 - c) / a0, (1 - c) / 2 / a0, (-2 * c) / a0, (1 - alpha) / a0);
  }

  static highpass(sr: number, f: number, q = 0.707): Biquad {
    const w = (2 * Math.PI * Math.min(f, sr * 0.45)) / sr;
    const alpha = Math.sin(w) / (2 * q);
    const c = Math.cos(w);
    const a0 = 1 + alpha;
    return new Biquad((1 + c) / 2 / a0, -(1 + c) / a0, (1 + c) / 2 / a0, (-2 * c) / a0, (1 - alpha) / a0);
  }

  /** Retune a band-pass in place (for sweeping formants) without resetting its state. */
  setBandpass(sr: number, f: number, q: number): void {
    const w = (2 * Math.PI * Math.min(f, sr * 0.45)) / sr;
    const alpha = Math.sin(w) / (2 * q);
    const a0 = 1 + alpha;
    this.b0 = alpha / a0;
    this.b1 = 0;
    this.b2 = -alpha / a0;
    this.a1 = (-2 * Math.cos(w)) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  run(x: number): number {
    // Transposed direct form II.
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
}

/** Scales to a peak of `peak` and applies a short fade at both ends (no clicks). */
function finish(buf: Float32Array, sr: number, peak = 0.9, fadeIn = 0.004, fadeOut = 0.02): Float32Array {
  let max = 0;
  for (let i = 0; i < buf.length; i++) max = Math.max(max, Math.abs(buf[i]));
  const k = max > 1e-9 ? peak / max : 0;
  const fi = Math.max(1, Math.round(fadeIn * sr));
  const fo = Math.max(1, Math.round(fadeOut * sr));
  for (let i = 0; i < buf.length; i++) {
    let g = k;
    if (i < fi) g *= i / fi;
    if (i > buf.length - fo) g *= Math.max(0, (buf.length - i) / fo);
    buf[i] *= g;
  }
  return buf;
}

/** Flap opening over one cycle: opens smoothly, slaps shut, stays closed. `open` = open fraction. */
function flap(phase: number, open: number): number {
  if (phase >= open) return 0;
  const x = phase / open;
  // Slow opening, fast slap closed (skewed to the right like a real valve).
  return Math.sin(Math.PI * Math.pow(x, 0.7)) ** 2;
}

/** Rosenberg-style glottal flow over one cycle. */
function glottal(phase: number, open = 0.6): number {
  const rise = open * 0.66;
  if (phase < rise) return 0.5 * (1 - Math.cos((Math.PI * phase) / rise));
  if (phase < open) return Math.cos((Math.PI / 2) * ((phase - rise) / (open - rise)));
  return 0;
}

export interface FartOptions {
  long?: boolean;
}

/** A fart: 0.25-0.5 s, or a rare 1.2-2 s epic with sputters and pitch wanders. */
export function renderFart(sr: number, rng: Rng, opts: FartOptions = {}): Float32Array {
  const long = !!opts.long;
  const dur = long ? 1.2 + rng() * 0.8 : 0.24 + rng() * 0.26;
  const n = Math.round(dur * sr);
  const out = new Float32Array(n);
  const f0 = 48 + rng() * 55;
  // Body resonances (low rumble, the "brap" mid, a little rasp) and the turbulent air.
  const r1 = Biquad.bandpass(sr, 110 + rng() * 60, 2.2);
  const r2 = Biquad.bandpass(sr, 280 + rng() * 160, 3.2);
  const r3 = Biquad.bandpass(sr, 750 + rng() * 450, 4.5);
  const air = Biquad.bandpass(sr, 500 + rng() * 700, 0.9);
  const dc = Biquad.highpass(sr, 35);
  const openQ = 0.3 + rng() * 0.2;
  const phi = rng() * Math.PI * 2;
  const wobRate = 1 + rng() * 2.5;
  let phase = 0;
  let cycleJitter = 1;
  let cycleAmp = 1;
  let drift = 0;
  let prev = 0;
  let gapUntil = -1;
  let nextGap = long ? 0.25 + rng() * 0.3 : Infinity;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const u = t / dur;
    // Pitch: starts a touch higher, sags, wanders; long ones rise and fall in phrases.
    let f = f0 * (1.2 - 0.35 * u) * (1 + 0.14 * Math.sin(2 * Math.PI * wobRate * t + phi));
    if (long) f *= 1 + 0.25 * Math.sin(2 * Math.PI * 0.7 * t + phi * 2);
    drift += (rng() - 0.5) * 0.004;
    drift *= 0.998;
    f *= 1 + drift;
    // Sputters: brief closed gaps, like the valve catching.
    if (t >= nextGap) {
      gapUntil = t + 0.02 + rng() * 0.05;
      nextGap = t + 0.2 + rng() * 0.4;
    }
    const gated = t < gapUntil;
    phase += (f * cycleJitter) / sr;
    if (phase >= 1) {
      phase -= 1;
      // Every flap is a little different: irregular timing and strength.
      cycleJitter = 1 + (rng() - 0.5) * 0.22;
      cycleAmp = 0.6 + rng() * 0.7;
    }
    const g = gated ? 0 : flap(phase, openQ) * cycleAmp;
    // Radiated pressure follows the change in airflow, normalized per cycle so pitch doesn't
    // change loudness.
    const slap = (g - prev) * (sr / (2 * Math.PI * f));
    prev = g;
    const noise = (rng() * 2 - 1) * g;
    let y = r1.run(slap) * 1.1 + r2.run(slap) * 0.7 + r3.run(slap) * 0.2 + g * 0.35 + air.run(noise) * 0.12;
    // Envelope: quick onset, uneven sustain, tail-off.
    const env = Math.min(1, t / 0.012) * (u > 0.8 ? Math.max(0, (1 - u) / 0.2) : 1) * (0.8 + 0.2 * Math.sin(2 * Math.PI * 3.1 * t + phi));
    y = Math.tanh(y * 2.4) * env;
    out[i] = dc.run(y);
  }
  return finish(out, sr, 0.92);
}

/** "Buuurrp": creaky voice through sweeping vowel formants, ending with a "p". */
export function renderBurp(sr: number, rng: Rng): Float32Array {
  const dur = 0.5 + rng() * 0.45;
  const n = Math.round(dur * sr);
  const out = new Float32Array(n);
  const f0 = 72 + rng() * 34;
  const F1 = Biquad.bandpass(sr, 500, 5);
  const F2 = Biquad.bandpass(sr, 900, 7);
  const F3 = Biquad.bandpass(sr, 2400, 9);
  const breath = Biquad.bandpass(sr, 1500, 0.7);
  const dc = Biquad.highpass(sr, 50);
  const f1a = 430 + rng() * 80;
  const f1b = 620 + rng() * 80;
  const f2a = 780 + rng() * 120;
  const f2b = 1050 + rng() * 150;
  let phase = 0;
  let prev = 0;
  let period = 1;
  let odd = false;
  const pAt = dur - 0.05;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const u = t / dur;
    if (i % 64 === 0) {
      F1.setBandpass(sr, f1a + (f1b - f1a) * u, 5);
      F2.setBandpass(sr, f2a + (f2b - f2a) * u, 7);
    }
    // Pitch rises then falls; creak alternates long and short cycles (vocal fry).
    const f = f0 * (1 + 0.18 * Math.sin(Math.PI * u)) * (1 - 0.15 * u);
    phase += (f * period) / sr;
    if (phase >= 1) {
      phase -= 1;
      odd = !odd;
      period = (odd ? 1.18 : 0.88) * (1 + (rng() - 0.5) * 0.12);
    }
    const g = glottal(phase, 0.5) * (t < pAt ? 1 : 0);
    const ex = (g - prev) * (sr / (2 * Math.PI * f));
    prev = g;
    let y = F1.run(ex) + F2.run(ex) * 0.6 + F3.run(ex) * 0.15 + g * 0.2 + breath.run((rng() * 2 - 1) * g) * 0.05;
    // The closing "p": a short low pop right after the voice stops.
    if (t >= pAt && t < pAt + 0.02) y += (rng() * 2 - 1) * 0.6 * (1 - (t - pAt) / 0.02) + Math.sin(2 * Math.PI * 90 * (t - pAt)) * 0.8;
    const env = Math.min(1, t / 0.03) * (0.75 + 0.25 * Math.sin(Math.PI * Math.min(1, u * 1.2)));
    out[i] = dc.run(Math.tanh(y * 1.8) * env);
  }
  return finish(out, sr, 0.9, 0.006, 0.01);
}

/** "Oof!": a winded voice on "oo" that breaks into an "f". */
export function renderGroan(sr: number, rng: Rng): Float32Array {
  const dur = 0.36 + rng() * 0.14;
  const n = Math.round(dur * sr);
  const out = new Float32Array(n);
  const f0 = 135 + rng() * 40;
  const F1 = Biquad.bandpass(sr, 330, 6);
  const F2 = Biquad.bandpass(sr, 820, 8);
  const F3 = Biquad.bandpass(sr, 2250, 10);
  const fric = Biquad.bandpass(sr, 4200, 1.2);
  const fricLo = Biquad.highpass(sr, 1500);
  let phase = 0;
  let prev = 0;
  let jit = 1;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const u = t / dur;
    const voiced = Math.max(0, Math.min(1, (0.72 - u) / 0.1));
    const f = f0 * (1.08 - 0.3 * u);
    phase += (f * jit) / sr;
    if (phase >= 1) {
      phase -= 1;
      jit = 1 + (rng() - 0.5) * 0.08;
    }
    const g = glottal(phase, 0.55);
    const ex = (g - prev) * (sr / (2 * Math.PI * f));
    prev = g;
    const vowel = F1.run(ex) + F2.run(ex) * 0.45 + F3.run(ex) * 0.1 + g * 0.15;
    const f2 = fric.run(fricLo.run(rng() * 2 - 1)) * Math.max(0, Math.min(1, (u - 0.6) / 0.12)) * 0.25;
    const env = Math.min(1, t / 0.008) * (1 - Math.max(0, (u - 0.85) / 0.15));
    out[i] = (Math.tanh(vowel * 1.6) * voiced + f2) * env;
  }
  return finish(out, sr, 0.9);
}

/** A balloon let go: the rubber neck buzzing at a high, wobbly, falling pitch, plus hissing air. */
export function renderSqueal(sr: number, rng: Rng): Float32Array {
  const dur = 1.0 + rng() * 0.5;
  const n = Math.round(dur * sr);
  const out = new Float32Array(n);
  const f0 = 650 + rng() * 450;
  const r1 = Biquad.bandpass(sr, 1300 + rng() * 400, 3);
  const r2 = Biquad.bandpass(sr, 2800 + rng() * 600, 4);
  const hiss = Biquad.highpass(sr, 2500);
  const dc = Biquad.highpass(sr, 200);
  let phase = 0;
  let prev = 0;
  let wob = 0;
  let wobT = 0;
  let wobTarget = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const u = t / dur;
    // The neck flaps: the pitch jumps around quickly, trending down as the pressure drops.
    wobT -= 1 / sr;
    if (wobT <= 0) {
      wobT = 0.02 + rng() * 0.05;
      wobTarget = (rng() - 0.5) * 0.35;
    }
    wob += (wobTarget - wob) * 0.004;
    const f = f0 * (1 - 0.55 * u) * (1 + wob) * (1 + 0.04 * Math.sin(2 * Math.PI * 23 * t));
    phase += f / sr;
    if (phase >= 1) phase -= 1;
    const g = flap(phase, 0.45);
    const ex = (g - prev) * (sr / (2 * Math.PI * f));
    prev = g;
    const air = hiss.run(rng() * 2 - 1) * (0.04 + 0.2 * u);
    let y = r1.run(ex) + r2.run(ex) * 0.5 + g * 0.3 + air;
    const env = Math.min(1, t / 0.03) * (u > 0.85 ? (1 - u) / 0.15 : 1);
    y = Math.tanh(y * 2) * env;
    out[i] = dc.run(y);
  }
  return finish(out, sr, 0.8, 0.01, 0.05);
}

/** Short rubbery squeak (vinyl rubbing), used on hits; pitch set by how inflated the target is. */
export function renderSqueak(sr: number, rng: Rng): Float32Array {
  const dur = 0.09 + rng() * 0.08;
  const n = Math.round(dur * sr);
  const out = new Float32Array(n);
  const f0 = 700 + rng() * 500;
  const r = Biquad.bandpass(sr, 1800 + rng() * 800, 5);
  const r2 = Biquad.bandpass(sr, 3600, 6);
  let phase = 0;
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const u = t / dur;
    const f = f0 * (1 + 0.5 * u) * (1 + (rng() - 0.5) * 0.04);
    phase += f / sr;
    if (phase >= 1) phase -= 1;
    const g = flap(phase, 0.5);
    const ex = (g - prev) * (sr / (2 * Math.PI * f));
    prev = g;
    const env = Math.sin(Math.PI * u) ** 0.6;
    out[i] = Math.tanh((r.run(ex) + r2.run(ex) * 0.4) * 2) * env;
  }
  return finish(out, sr, 0.7, 0.002, 0.01);
}

/** A landed hit: a deep thump, a rubbery "bwomp" of the tube man's body, and a slap on contact. */
export function renderImpact(sr: number, rng: Rng): Float32Array {
  const dur = 0.32;
  const n = Math.round(dur * sr);
  const out = new Float32Array(n);
  const body = Biquad.lowpass(sr, 900, 6);
  const slapF = Biquad.highpass(sr, 1800);
  const fb = 170 + rng() * 60;
  let phase = 0;
  let prev = 0;
  let thumpPhase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    // Thump: a falling sine with a fast decay.
    const tf = 110 * Math.exp(-t * 9) + 38;
    thumpPhase += tf / sr;
    const thump = Math.sin(2 * Math.PI * thumpPhase) * Math.exp(-t * 14);
    // Bwomp: the vinyl body flapping at a falling rate.
    const f = fb * (1 - 0.55 * Math.min(1, t / 0.16));
    phase += f / sr;
    if (phase >= 1) phase -= 1;
    const g = flap(phase, 0.45);
    const ex = (g - prev) * (sr / (2 * Math.PI * f));
    prev = g;
    const bwomp = (body.run(ex) * 0.6 + g * 0.3) * Math.exp(-t * 11);
    const slap = slapF.run(rng() * 2 - 1) * Math.exp(-t * 180);
    out[i] = Math.tanh(thump * 1.2 + bwomp * 1.6 + slap * 0.7);
  }
  return finish(out, sr, 0.95, 0.0005, 0.03);
}

/** Crude pitch estimate (autocorrelation) for tests. Returns Hz, or 0 if nothing periodic. */
export function estimatePitch(buf: Float32Array, sr: number, minHz: number, maxHz: number, from = 0.1, to = 0.5): number {
  const a = Math.floor(buf.length * from);
  const b = Math.floor(buf.length * to);
  const minLag = Math.floor(sr / maxHz);
  const maxLag = Math.floor(sr / minHz);
  let best = 0;
  let bestLag = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    let e0 = 0;
    let e1 = 0;
    for (let i = a; i < b - lag; i++) {
      s += buf[i] * buf[i + lag];
      e0 += buf[i] * buf[i];
      e1 += buf[i + lag] * buf[i + lag];
    }
    const c = s / Math.sqrt(e0 * e1 + 1e-12);
    if (c > best) {
      best = c;
      bestLag = lag;
    }
  }
  return best > 0.3 && bestLag ? sr / bestLag : 0;
}
