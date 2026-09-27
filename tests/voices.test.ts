import { describe, expect, it } from 'vitest';
import { estimatePitch, makeRng, renderBurp, renderFart, renderGroan, renderImpact, renderSqueak, renderSqueal } from '../src/client/audio/voices';

const SR = 48000;

function stats(buf: Float32Array) {
  let peak = 0;
  let sum = 0;
  let nan = false;
  for (const x of buf) {
    if (!Number.isFinite(x)) nan = true;
    peak = Math.max(peak, Math.abs(x));
    sum += x * x;
  }
  return { peak, rms: Math.sqrt(sum / buf.length), nan, seconds: buf.length / SR };
}

/** Spectral centroid (Hz, up to ~4.7 kHz) of a window 30% in: roughly how bright it sounds. */
function centroid(buf: Float32Array): number {
  const N = 4096;
  const off = Math.floor(buf.length * 0.3);
  let num = 0;
  let den = 0;
  for (let k = 1; k < 400; k++) {
    let re = 0;
    let im = 0;
    for (let i = 0; i < N && off + i < buf.length; i++) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
      re += buf[off + i] * w * Math.cos((2 * Math.PI * k * i) / N);
      im -= buf[off + i] * w * Math.sin((2 * Math.PI * k * i) / N);
    }
    const m = Math.hypot(re, im);
    num += ((k * SR) / N) * m;
    den += m;
  }
  return num / den;
}

/** How periodic the middle of a sound is (1 = a perfect steady tone). */
function periodicity(buf: Float32Array, lagHz: number): number {
  const lag = Math.round(SR / lagHz);
  const a = Math.floor(buf.length * 0.2);
  const b = Math.floor(buf.length * 0.6);
  let s = 0;
  let e0 = 0;
  let e1 = 0;
  for (let i = a; i < b; i++) {
    s += buf[i] * buf[i + lag];
    e0 += buf[i] ** 2;
    e1 += buf[i + lag] ** 2;
  }
  return s / Math.sqrt(e0 * e1);
}

describe('modelled body sounds', () => {
  it('farts are low, irregular, and come in short and rare long versions', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const short = renderFart(SR, makeRng(seed));
      const st = stats(short);
      expect(st.nan).toBe(false);
      expect(st.seconds).toBeGreaterThan(0.2);
      expect(st.seconds).toBeLessThan(0.55);
      expect(st.peak).toBeLessThanOrEqual(0.93);
      expect(st.rms).toBeGreaterThan(0.08);
      const f = estimatePitch(short, SR, 30, 200);
      expect(f).toBeGreaterThan(30);
      expect(f).toBeLessThan(170);
      // Not a steady buzz: consecutive flaps differ.
      expect(periodicity(short, f)).toBeLessThan(0.97);
    }
    const long = renderFart(SR, makeRng(9), { long: true });
    expect(stats(long).seconds).toBeGreaterThan(1.15);
  });

  it('burps and oofs are voice-pitched', () => {
    for (let seed = 1; seed <= 4; seed++) {
      const burp = renderBurp(SR, makeRng(seed));
      expect(stats(burp).nan).toBe(false);
      const bf = estimatePitch(burp, SR, 50, 160, 0.2, 0.7);
      expect(bf).toBeGreaterThan(60);
      expect(bf).toBeLessThan(140);
      const oof = renderGroan(SR, makeRng(seed));
      const of = estimatePitch(oof, SR, 80, 220, 0.05, 0.45);
      expect(of).toBeGreaterThan(100);
      expect(of).toBeLessThan(200);
      // Voices sit in the vowel range, not bright like a squeal.
      expect(centroid(burp)).toBeLessThan(1400);
    }
  });

  it('balloon squeals are high; farts are low; squeaks and impacts are short', () => {
    const sq = renderSqueal(SR, makeRng(5));
    expect(stats(sq).seconds).toBeGreaterThan(0.95);
    expect(centroid(sq)).toBeGreaterThan(1000);
    expect(centroid(renderFart(SR, makeRng(5)))).toBeLessThan(650);
    expect(stats(renderSqueak(SR, makeRng(6))).seconds).toBeLessThan(0.2);
    const imp = stats(renderImpact(SR, makeRng(7)));
    expect(imp.nan).toBe(false);
    expect(imp.seconds).toBeLessThan(0.4);
  });

  it('every render is a little different', () => {
    const a = renderFart(SR, makeRng(11));
    const b = renderFart(SR, makeRng(12));
    expect(a.length === b.length && a.every((x, i) => x === b[i])).toBe(false);
  });
});
