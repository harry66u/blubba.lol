import { BALANCE } from '../../shared/balance';

/**
 * Estimates the server's tick from snapshot arrivals. The least-delayed recent snapshot gives
 * the tightest bound, so we track the maximum (tick - localTicks) offset over a sliding window.
 */
export class ServerClock {
  private samples: { offset: number; at: number }[] = [];
  private offset: number | null = null;
  /** Spread of recent offsets (network jitter), in ticks. */
  jitter = 0;

  reset(): void {
    this.samples.length = 0;
    this.offset = null;
    this.jitter = 0;
  }

  get ready(): boolean {
    return this.offset !== null;
  }

  observe(tick: number, nowMs: number): void {
    const local = (nowMs / 1000) * BALANCE.tickRate;
    const sample = tick - local;
    this.samples.push({ offset: sample, at: nowMs });
    while (this.samples.length && nowMs - this.samples[0].at > 3000) this.samples.shift();
    let max = -Infinity;
    let min = Infinity;
    for (const s of this.samples) {
      if (s.offset > max) max = s.offset;
      if (s.offset < min) min = s.offset;
    }
    if (this.offset === null || Math.abs(max - this.offset) > 30) this.offset = max;
    else this.offset += (max - this.offset) * 0.1;
    this.jitter = this.jitter * 0.9 + (max - min) * 0.1;
  }

  /** Server tick of the freshest data we could have right now. */
  tickAt(nowMs: number): number {
    return (nowMs / 1000) * BALANCE.tickRate + (this.offset ?? 0);
  }

  /** How far behind "now" remote players are drawn, in ticks. */
  interpDelay(): number {
    const snapInterval = BALANCE.tickRate / BALANCE.snapshotRate;
    return Math.max(snapInterval * 1.5, Math.min(12, snapInterval + this.jitter * 1.2 + 1));
  }
}
