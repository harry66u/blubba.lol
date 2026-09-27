import { BTN_FIRE, type InputFrame, emptyInput } from '../src/shared/input';
import type { GameSim, SimPlayer } from '../src/shared/game/sim';

/** Drives a human player in a GameSim by queuing one input per tick. */
export class Driver {
  frame: InputFrame = emptyInput();
  seq = 0;
  constructor(
    readonly sim: GameSim,
    readonly player: SimPlayer,
  ) {}

  queue(mut?: (f: InputFrame) => void): void {
    const f = { ...this.frame, seq: ++this.seq, tick: this.sim.tick + 1 };
    mut?.(f);
    this.frame = { ...f };
    this.sim.queueInput(this.player.id, f);
  }

  press(key: 'jump' | 'dash' | 'brace' | 'grab' | 'grapple' | 'reload' | 'util1' | 'util2' | 'taunt'): void {
    this.frame[key] = (this.frame[key] + 1) & 255;
  }

  aimAt(x: number, y: number, z: number): void {
    const s = this.player.state;
    const ex = s.px;
    const ey = s.py + 1.85 * (1 + 0.75 * s.inflation);
    const ez = s.pz;
    const dx = x - ex;
    const dy = y - ey;
    const dz = z - ez;
    this.frame.yaw = Math.atan2(-dx, -dz);
    this.frame.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  }

  setFire(on: boolean): void {
    this.frame.buttons = on ? this.frame.buttons | BTN_FIRE : this.frame.buttons & ~BTN_FIRE;
  }
}

/** Steps the sim, queuing a neutral frame for every driver each tick. */
export function run(sim: GameSim, drivers: Driver[], ticks: number, each?: (t: number) => void): void {
  for (let t = 0; t < ticks; t++) {
    each?.(t);
    for (const d of drivers) d.queue();
    sim.step();
  }
}
