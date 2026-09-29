import { BALANCE } from '../balance';
import { MODE_DEAD, type ShotSpec, type StepResult, eyeHeight, lookDir, playerHeight, playerRadius } from '../player';
import type { GameSim, Projectile, SimPlayer } from './sim';
import { PROJ_BIG_BLOW, PROJ_ROCKET, chargeUlt, steerToward, ultOf, ultPowerMult } from './ults';

/** A Crop Duster's lingering gas: inflates and slows enemies standing in it. */
export interface GasCloud {
  x: number;
  y: number;
  z: number;
  owner: number;
  until: number;
}

/** Robot Mode in progress: who it locked on to and how many rockets are out. */
interface Barrage {
  targets: number[];
  fired: number;
  start: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * The server side of ults (game/ults.ts): the meter filling from hits and knockouts, activation
 * (lock-ons), the Big Blow shot, Crop Duster's shockwave and cloud, Robot Mode's rockets, and
 * homing. The shared player step handles everything that moves you.
 */
export class UltSystem {
  readonly clouds: GasCloud[] = [];
  private readonly barrages = new Map<number, Barrage>();
  private readonly resniffAt = new Map<number, number>();
  private readonly dir = { x: 0, y: 0, z: 0 };

  constructor(private readonly sim: GameSim) {}

  /** New match: clouds and barrages are gone. */
  reset(): void {
    this.clouds.length = 0;
    this.barrages.clear();
    this.resniffAt.clear();
  }

  /** Called with every player step: did they pop their ult, or did a Crop Duster just go off? */
  afterStep(p: SimPlayer, out: StepResult): void {
    if (out.ult) this.activate(p);
    if (out.fartBlast) this.fartBlast(p);
  }

  private activate(p: SimPlayer): void {
    const s = p.state;
    const kind = ultOf(s);
    let targets: number[] = [];
    if (kind === 'chase') {
      s.chaseTarget = this.sniff(p);
      if (s.chaseTarget >= 0) targets = [s.chaseTarget];
    } else if (kind === 'robot') {
      targets = this.robotTargets(p, BALANCE.ults.robot.maxTargets);
      this.barrages.set(p.id, { targets, fired: 0, start: this.sim.time });
    }
    this.sim.events.push({ t: 'ult', tick: this.sim.tick, id: p.id, kind, x: s.px, y: s.py, z: s.pz, targets });
  }

  // --- Meter ---------------------------------------------------------------------------------

  /** A hit landed: the attacker charges by the inflation they added, the target a little too. */
  onHit(target: SimPlayer, attackerId: number, gain: number, fromUlt: boolean): void {
    const M = BALANCE.ults.meter;
    if (attackerId < 0 || attackerId === target.id) return;
    chargeUlt(target.state, gain * M.perInflationTaken);
    const a = this.sim.players.get(attackerId);
    // Ult hits don't refill the meter that fired them.
    if (a && !fromUlt) chargeUlt(a.state, gain * M.perInflation);
  }

  onKo(killer: SimPlayer): void {
    chargeUlt(killer.state, BALANCE.ults.meter.perKo);
  }

  // --- Per tick ------------------------------------------------------------------------------

  step(): void {
    this.stepChases();
    this.stepBarrages();
    this.stepClouds();
  }

  /** Lost your target (popped or gone)? Sniff out the next one. */
  private stepChases(): void {
    const C = BALANCE.ults.chase;
    for (const p of this.sim.players.values()) {
      const s = p.state;
      if (s.chaseTimer <= 0 || s.mode === MODE_DEAD) continue;
      const t = this.sim.players.get(s.chaseTarget);
      if (t && t.state.mode !== MODE_DEAD) continue;
      if (this.sim.time < (this.resniffAt.get(p.id) ?? 0)) continue;
      this.resniffAt.set(p.id, this.sim.time + C.resniff);
      const next = this.sniff(p);
      s.chaseTarget = next;
      if (next >= 0) this.sim.events.push({ t: 'sniff', tick: this.sim.tick, id: p.id, target: next });
    }
  }

  private stepBarrages(): void {
    const R = BALANCE.ults.robot;
    for (const [id, b] of this.barrages) {
      const p = this.sim.players.get(id);
      if (!p || p.state.mode === MODE_DEAD) {
        this.barrages.delete(id);
        continue;
      }
      const elapsed = this.sim.time - b.start;
      while (b.fired < R.rockets && elapsed >= R.scanTime + (b.fired * R.barrageTime) / R.rockets) {
        this.fireRocket(p, b);
        b.fired++;
      }
      if (b.fired >= R.rockets) this.barrages.delete(id);
    }
  }

  private stepClouds(): void {
    const C = BALANCE.ults.cropDuster;
    const sim = this.sim;
    for (let i = this.clouds.length - 1; i >= 0; i--) {
      const c = this.clouds[i];
      if (sim.time >= c.until) {
        this.clouds.splice(i, 1);
        continue;
      }
      for (const o of sim.players.values()) {
        const t = o.state;
        if (o.id === c.owner || t.mode === MODE_DEAD || t.spawnProt > 0 || !sim.isEnemy(c.owner, o.id)) continue;
        if (Math.hypot(t.px - c.x, t.pz - c.z) > C.cloudRadius + playerRadius(t)) continue;
        if (t.py > c.y + 4 || t.py + playerHeight(t) < c.y - 1) continue;
        // Refreshed every tick while you're inside; the shared step slows you while it lasts.
        t.gasTimer = 0.2;
        t.inflation = Math.min(BALANCE.inflation.max, t.inflation + C.cloudInflation * sim.dt);
        t.sinceHit = 0;
        o.lastAttacker = c.owner;
        o.lastAttackTime = sim.time;
      }
    }
  }

  // --- Big Blow ------------------------------------------------------------------------------

  /** Fires the Big Blow: one giant, slow air ball that blasts twice as wide and hard. */
  fireBigBlow(p: SimPlayer, f: ShotSpec, clientSeq: number): void {
    const B = BALANCE.ults.bigBlow;
    const pr: Projectile = {
      id: this.sim.newProjectileId(),
      owner: p.id,
      weapon: PROJ_BIG_BLOW,
      fuse: 0,
      throwX: 0,
      throwZ: 0,
      x: f.ox,
      y: f.oy,
      z: f.oz,
      vx: f.dx * B.projSpeed,
      vy: f.dy * B.projSpeed,
      vz: f.dz * B.projSpeed,
      radius: B.radius,
      power: 1,
      charge: 1,
      gravity: 0,
      expires: this.sim.time + B.lifetime,
      blastRadius: B.blastRadius,
      inflation: B.inflation,
      knockback: B.knockback,
      ult: true,
    };
    this.sim.projectiles.push(pr);
    p.stats.shots++;
    this.sim.events.push({ t: 'shot', tick: this.sim.tick, id: pr.id, owner: p.id, w: PROJ_BIG_BLOW, x: f.ox, y: f.oy, z: f.oz, vx: pr.vx, vy: pr.vy, vz: pr.vz, r: pr.radius, power: 1, cs: clientSeq });
  }

  // --- The Chase -----------------------------------------------------------------------------

  /** The nose picks the nearest enemy in front of you, or failing that the nearest one anywhere. */
  private sniff(p: SimPlayer): number {
    const C = BALANCE.ults.chase;
    const s = p.state;
    const fx = -Math.sin(s.yaw);
    const fz = -Math.cos(s.yaw);
    let best = -1;
    let bestScore = Infinity;
    for (const o of this.sim.players.values()) {
      if (o === p || !this.sim.isEnemy(p.id, o.id)) continue;
      const t = o.state;
      if (t.mode === MODE_DEAD) continue;
      const dx = t.px - s.px;
      const dz = t.pz - s.pz;
      const d = Math.hypot(dx, t.py - s.py, dz);
      if (d > C.range) continue;
      const h = Math.hypot(dx, dz);
      const inFront = h < 1 || (dx * fx + dz * fz) / h > Math.cos(C.frontCone);
      const score = d + (inFront ? 0 : 1000);
      if (score < bestScore) {
        bestScore = score;
        best = o.id;
      }
    }
    return best;
  }

  /** Shots fired during The Chase home in on the target. */
  homing(p: SimPlayer): { home: number; turn: number } | null {
    const s = p.state;
    if (s.chaseTimer <= 0 || s.chaseTarget < 0) return null;
    return { home: s.chaseTarget, turn: BALANCE.ults.chase.homingTurn };
  }

  /** During The Chase, cone and hitscan shots bend toward the target when you're close to on it. */
  bendAim(p: SimPlayer, f: { dx: number; dy: number; dz: number }): void {
    const s = p.state;
    const C = BALANCE.ults.chase;
    const t = s.chaseTimer > 0 ? this.sim.players.get(s.chaseTarget) : undefined;
    if (!t || t.state.mode === MODE_DEAD) return;
    const ex = s.px;
    const ey = s.py + eyeHeight(s);
    const ez = s.pz;
    const tx = t.state.px - ex;
    const ty = t.state.py + playerHeight(t.state) * 0.5 - ey;
    const tz = t.state.pz - ez;
    const tl = Math.hypot(tx, ty, tz) || 1;
    const ang = Math.acos(clamp((tx * f.dx + ty * f.dy + tz * f.dz) / tl, -1, 1));
    if (ang > C.aimBend * 3) return;
    const v = { vx: f.dx, vy: f.dy, vz: f.dz };
    steerToward(v, 0, 0, 0, tx, ty, tz, C.aimBend);
    f.dx = v.vx;
    f.dy = v.vy;
    f.dz = v.vz;
  }

  /** Throw power multiplier: Juice throws harder, and catching your Chase target is the big one. */
  throwMult(p: SimPlayer, target: SimPlayer): number {
    const s = p.state;
    let m = ultPowerMult(s);
    if (s.chaseTimer > 0 && s.chaseTarget === target.id) {
      m *= BALANCE.ults.chase.throwMult;
      this.sim.events.push({ t: 'gotcha', tick: this.sim.tick, id: p.id, target: target.id });
    }
    return m;
  }

  /** Turns homing projectiles toward their target (rockets, Chase shots). */
  steer(pr: Projectile, dt: number): void {
    if (pr.homing === undefined || !pr.turn) return;
    // Rockets that lost (or never had) a target keep looking for someone ahead of them.
    if (pr.homing < 0 && pr.weapon === PROJ_ROCKET && this.sim.tick % 3 === 0) {
      pr.homing = this.seek(pr);
      if (pr.homing >= 0) this.sim.events.push({ t: 'proj', tick: this.sim.tick, id: pr.id, x: pr.x, y: pr.y, z: pr.z, vx: pr.vx, vy: pr.vy, vz: pr.vz, home: pr.homing });
    }
    if (pr.homing < 0) return;
    const t = this.sim.players.get(pr.homing);
    if (!t || t.state.mode === MODE_DEAD) {
      pr.homing = -1;
      return;
    }
    const s = t.state;
    steerToward(pr, pr.x, pr.y, pr.z, s.px, s.py + playerHeight(s) * 0.5, s.pz, pr.turn * dt);
  }

  /** The nearest enemy of a rocket's owner in a cone ahead of it, or -1. */
  private seek(pr: Projectile): number {
    const sp = Math.hypot(pr.vx, pr.vy, pr.vz) || 1;
    let best = -1;
    let bestD = 30;
    for (const o of this.sim.players.values()) {
      if (o.id === pr.owner || !this.sim.isEnemy(pr.owner, o.id)) continue;
      const t = o.state;
      if (t.mode === MODE_DEAD) continue;
      const dx = t.px - pr.x;
      const dy = t.py + playerHeight(t) * 0.5 - pr.y;
      const dz = t.pz - pr.z;
      const d = Math.hypot(dx, dy, dz);
      if (d >= bestD || d < 1e-3) continue;
      if ((dx * pr.vx + dy * pr.vy + dz * pr.vz) / (d * sp) < Math.cos(0.8)) continue;
      bestD = d;
      best = o.id;
    }
    return best;
  }

  // --- Crop Duster ---------------------------------------------------------------------------

  private fartBlast(p: SimPlayer): void {
    const C = BALANCE.ults.cropDuster;
    const sim = this.sim;
    const s = p.state;
    const x = s.px;
    const y = s.py + 0.5;
    const z = s.pz;
    sim.pushBall(x, y, z, C.radius, BALANCE.modes.ball.splashImpulse * 1.5, p.id);
    for (const o of sim.players.values()) {
      if (o === p || !sim.isEnemy(p.id, o.id)) continue;
      const t = o.state;
      if (t.mode === MODE_DEAD) continue;
      const r = playerRadius(t);
      const h = playerHeight(t);
      const ay = clamp(y, t.py + r, t.py + h - r);
      const d = Math.max(0, Math.hypot(t.px - x, ay - y, t.pz - z) - r);
      if (d > C.radius) continue;
      const falloff = C.edge + (1 - C.edge) * (1 - d / C.radius);
      let dx = t.px - x;
      let dz = t.pz - z;
      const hl = Math.hypot(dx, dz);
      if (hl < 1e-3) {
        dx = Math.sin(s.yaw);
        dz = Math.cos(s.yaw);
      } else {
        dx /= hl;
        dz /= hl;
      }
      sim.applyHit(o, p.id, dx, 0.55, dz, C.knockback * falloff, C.inflation * falloff, { direct: false, low: false, x: t.px - dx * r, y: ay, z: t.pz - dz * r, ult: true });
    }
    // The cloud sits on the ground where it happened (you fly up out of it).
    const ground = sim.world.groundBelow(s.px, s.py + 0.5, s.pz, 6);
    const cy = ground ?? s.py;
    const until = sim.time + C.cloudTime;
    this.clouds.push({ x, y: cy, z, owner: p.id, until });
    sim.events.push({ t: 'fart', tick: sim.tick, id: p.id, x, y: cy, z, r: C.radius, until: Math.round(until / sim.dt) });
  }

  // --- Robot Mode ----------------------------------------------------------------------------

  /** Enemies you can see (in the view cone, in range, nothing in the way), best-aimed first. */
  private robotTargets(p: SimPlayer, max: number): number[] {
    const R = BALANCE.ults.robot;
    const sim = this.sim;
    const s = p.state;
    const d = lookDir(s.yaw, s.pitch, this.dir);
    const ex = s.px;
    const ey = s.py + eyeHeight(s);
    const ez = s.pz;
    const seen: { id: number; ang: number }[] = [];
    for (const o of sim.players.values()) {
      if (o === p || !sim.isEnemy(p.id, o.id)) continue;
      const t = o.state;
      if (t.mode === MODE_DEAD) continue;
      const vx = t.px - ex;
      const vy = t.py + playerHeight(t) * 0.5 - ey;
      const vz = t.pz - ez;
      const dist = Math.hypot(vx, vy, vz);
      if (dist > R.range || dist < 1e-3) continue;
      const ang = Math.acos(clamp((vx * d.x + vy * d.y + vz * d.z) / dist, -1, 1));
      if (ang > R.viewCone) continue;
      if (sim.world.raycast(ex, ey, ez, vx / dist, vy / dist, vz / dist, Math.max(0, dist - playerRadius(t)))) continue;
      seen.push({ id: o.id, ang });
    }
    seen.sort((a, b) => a.ang - b.ang);
    return seen.slice(0, max).map((x) => x.id);
  }

  private fireRocket(p: SimPlayer, b: Barrage): void {
    const R = BALANCE.ults.robot;
    const sim = this.sim;
    const s = p.state;
    let target = b.targets.length ? b.targets[b.fired % b.targets.length] : -1;
    const locked = sim.players.get(target);
    if (!locked || locked.state.mode === MODE_DEAD) target = this.robotTargets(p, 1)[0] ?? -1;
    // Out of alternate shoulders, up and to the side, then they swing in toward their targets.
    const side = b.fired % 2 === 0 ? -1 : 1;
    const d = lookDir(s.yaw, s.pitch, this.dir);
    const rx = Math.cos(s.yaw);
    const rz = -Math.sin(s.yaw);
    const off = playerRadius(s) + 0.3;
    const ox = s.px + rx * side * off;
    const oy = s.py + playerHeight(s) * 0.85;
    const oz = s.pz + rz * side * off;
    // With nobody locked, they fly out ahead instead and look for someone on the way.
    const fwd = target >= 0 ? 0.55 : 0.9;
    let vx = d.x * fwd + rx * side * 0.45;
    let vy = Math.max(0, d.y) * fwd + (target >= 0 ? 0.7 : 0.3);
    let vz = d.z * fwd + rz * side * 0.45;
    const l = Math.hypot(vx, vy, vz) || 1;
    vx = (vx / l) * R.rocketSpeed;
    vy = (vy / l) * R.rocketSpeed;
    vz = (vz / l) * R.rocketSpeed;
    const pr: Projectile = {
      id: sim.newProjectileId(),
      owner: p.id,
      weapon: PROJ_ROCKET,
      fuse: 0,
      throwX: 0,
      throwZ: 0,
      x: ox,
      y: oy,
      z: oz,
      vx,
      vy,
      vz,
      radius: R.rocketRadius,
      power: 1,
      charge: 1,
      gravity: 0,
      expires: sim.time + R.rocketLifetime,
      blastRadius: R.blastRadius,
      inflation: R.inflation,
      knockback: R.knockback,
      homing: target,
      turn: R.rocketTurn,
      ult: true,
    };
    sim.projectiles.push(pr);
    sim.events.push({ t: 'shot', tick: sim.tick, id: pr.id, owner: p.id, w: PROJ_ROCKET, x: ox, y: oy, z: oz, vx, vy, vz, r: pr.radius, power: 1, home: target, turn: R.rocketTurn });
  }
}
