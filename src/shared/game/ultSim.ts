import { BALANCE } from '../balance';
import { MODE_DEAD, MODE_HANG, MODE_NORMAL, type ShotSpec, type StepResult, eyeHeight, lookDir, playerHeight, playerRadius } from '../player';
import type { GameSim, Projectile, SimPlayer } from './sim';
import { PROJ_BIG_BLOW, PROJ_ROCKET, ULT_CHARACTER, chargeUlt, randomUlt, steerToward, ultIndex, ultOf, ultPowerMult } from './ults';

/** A Crop Duster's lingering gas: inflates and slows enemies standing in it. */
export interface GasCloud {
  x: number;
  y: number;
  z: number;
  owner: number;
  until: number;
}

/** A piece of a Pride Parade's rainbow road: bounces enemies who step on it until `until`. */
export interface RoadPiece {
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
  readonly road: RoadPiece[] = [];
  /** When each parade last laid road (by player id). */
  private readonly roadAt = new Map<number, number>();
  /** `${owner}:${victim}` -> when that road may bounce that victim again. */
  private readonly bounceAt = new Map<string, number>();
  private readonly barrages = new Map<number, Barrage>();
  private readonly resniffAt = new Map<number, number>();
  /** ABAG: when he can try to hug his target again (after they wriggle free). */
  private readonly hugAt = new Map<number, number>();
  private readonly dir = { x: 0, y: 0, z: 0 };

  constructor(private readonly sim: GameSim) {}

  /** New match: clouds and barrages are gone. */
  reset(): void {
    this.clouds.length = 0;
    this.road.length = 0;
    this.roadAt.clear();
    this.bounceAt.clear();
    this.barrages.clear();
    this.resniffAt.clear();
    this.hugAt.clear();
  }

  /** Called with every player step: did they pop their ult, or did a Crop Duster just go off? */
  afterStep(p: SimPlayer, out: StepResult): void {
    if (out.ult) this.activate(p);
    if (out.fartBlast) this.fartBlast(p);
  }

  private activate(p: SimPlayer): void {
    const s = p.state;
    const kind = ultOf(s);
    // You turn into the character (a bigger body, so a bigger hitbox) for as long as it shows.
    const character = ULT_CHARACTER[kind];
    if (character) p.bigUntil = this.sim.time + character.seconds;
    let targets: number[] = [];
    if (kind === 'chase') {
      s.chaseTarget = this.sniff(p);
      if (s.chaseTarget >= 0) targets = [s.chaseTarget];
    } else if (kind === 'robot') {
      targets = this.robotTargets(p, BALANCE.ults.robot.maxTargets);
      this.barrages.set(p.id, { targets, fired: 0, start: this.sim.time });
    } else if (kind === 'pride') {
      this.prideBurst(p);
    }
    this.sim.events.push({ t: 'ult', tick: this.sim.tick, id: p.id, kind, x: s.px, y: s.py, z: s.pz, targets });
    // The next ult is dealt right away (a long life fills the meter again): never the same one.
    p.lastUsedUlt = kind;
    s.ultKind = ultIndex(randomUlt(kind));
  }

  // --- Meter ---------------------------------------------------------------------------------

  /** A hit landed: the attacker charges by the inflation they added, the target a little too. */
  onHit(target: SimPlayer, attackerId: number, gain: number, fromUlt: boolean): void {
    const M = BALANCE.ults.meter;
    if (attackerId < 0 || attackerId === target.id) return;
    this.charge(target, gain * M.perInflationTaken);
    const a = this.sim.players.get(attackerId);
    if (!a) return;
    // Who's been hitting whom, for assists.
    target.hitBy.set(attackerId, this.sim.time);
    // Ult hits don't refill the meter that fired them.
    if (!fromUlt) this.charge(a, gain * M.perInflation);
  }

  /** A knockout: a chunk for the killer, a smaller one for everyone else who hit the victim lately. */
  onKo(killer: SimPlayer, victim: SimPlayer): void {
    const M = BALANCE.ults.meter;
    this.charge(killer, M.perKo, 'ko');
    for (const [id, at] of victim.hitBy) {
      if (id === killer.id || this.sim.time - at > M.assistWindow) continue;
      const helper = this.sim.players.get(id);
      if (helper && this.sim.isEnemy(id, victim.id)) this.charge(helper, M.perAssist, 'assist');
    }
    victim.hitBy.clear();
  }

  /** Ball: a goal (own goals don't count). */
  onGoal(scorer: SimPlayer): void {
    this.charge(scorer, BALANCE.ults.meter.perGoal, 'goal');
  }

  /** Pump: standing on your pump fills it too. */
  onPump(p: SimPlayer, dt: number): void {
    this.charge(p, BALANCE.ults.meter.perPumpSecond * dt);
  }

  /**
   * Earned charge, scaled by how the player (or their team) is doing: behind charges faster, a
   * clear leader a little slower. Big chunks are announced to the player who earned them.
   */
  charge(p: SimPlayer, amount: number, why?: 'ko' | 'assist' | 'goal'): void {
    if (amount <= 0) return;
    const before = p.state.ult;
    const mode = this.sim.mode === 'duel' ? BALANCE.ults.meter.duelMult : 1;
    chargeUlt(p.state, amount * this.catchUp(p) * mode);
    const got = p.state.ult - before;
    if (why && got > 0.005) this.sim.events.push({ t: 'charge', tick: this.sim.tick, id: p.id, why, amount: Math.round(got * 100) });
  }

  /** The catch-up multiplier for a player right now (1 when things are close). */
  catchUp(p: SimPlayer): number {
    const C = BALANCE.ults.meter.catchUp;
    const sim = this.sim;
    if (sim.phase !== 'playing') return 1;
    if (p.team >= 0 && (sim.mode === 'teamKnockout' || sim.mode === 'ball' || sim.mode === 'pump')) {
      const mine = sim.teamScoreOf(p.team);
      const theirs = sim.teamScoreOf(1 - p.team);
      const gap = sim.mode === 'pump' ? C.pumpGap : C.teamGap;
      if (theirs - mine >= gap) return C.behind;
      if (mine - theirs >= gap) return C.ahead;
      return 1;
    }
    // Free-for-all (and 1v1, and Sudden Death by rounds won): compared with the leader.
    const score = (q: SimPlayer) => (sim.suddenDeath ? q.roundWins : q.score);
    let best = -Infinity;
    let second = -Infinity;
    for (const q of sim.players.values()) {
      const v = score(q);
      if (v > best) {
        second = best;
        best = v;
      } else if (v > second) second = v;
    }
    const mine = score(p);
    const gap = sim.suddenDeath || sim.mode === 'duel' ? 2 : C.soloGap;
    if (mine === best && best - second >= gap) return C.ahead;
    if (best - mine >= gap) return C.behind;
    return 1;
  }

  // --- Per tick ------------------------------------------------------------------------------

  step(): void {
    this.stepChases();
    this.stepBarrages();
    this.stepClouds();
    this.stepRoad();
  }

  /**
   * ABAG hunting: touch your target and you hug them (an automatic grab; they can still wriggle
   * free with a dash in the green). Lost your target (popped or gone)? Sniff out the next one.
   */
  private stepChases(): void {
    const C = BALANCE.ults.chase;
    for (const p of this.sim.players.values()) {
      const s = p.state;
      if (s.chaseTimer <= 0 || s.mode === MODE_DEAD) continue;
      const t = this.sim.players.get(s.chaseTarget);
      if (t && t.state.mode !== MODE_DEAD) {
        this.tryHug(p, t);
        continue;
      }
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

  // --- The Chase (ABAG) -----------------------------------------------------------------------

  /** ABAG picks who to bag at random: anyone within range, or anyone on the map if nobody's close. */
  private sniff(p: SimPlayer): number {
    const C = BALANCE.ults.chase;
    const s = p.state;
    const near: number[] = [];
    const all: number[] = [];
    for (const o of this.sim.players.values()) {
      if (o === p || !this.sim.isEnemy(p.id, o.id)) continue;
      const t = o.state;
      if (t.mode === MODE_DEAD) continue;
      all.push(o.id);
      if (Math.hypot(t.px - s.px, t.py - s.py, t.pz - s.pz) <= C.range) near.push(o.id);
    }
    const pool = near.length ? near : all;
    return pool.length ? pool[Math.floor(Math.random() * pool.length)] : -1;
  }

  /** Close enough to your chase target? Hug them. */
  private tryHug(p: SimPlayer, target: SimPlayer): void {
    const C = BALANCE.ults.chase;
    const s = p.state;
    const t = target.state;
    if (s.mode !== MODE_NORMAL || s.holding >= 0 || s.doubledTimer > 0 || !this.sim.features.grab) return;
    if (t.mode !== MODE_NORMAL && t.mode !== MODE_HANG) return;
    if (t.spawnProt > 0 || t.heldBy >= 0 || this.sim.time < (this.hugAt.get(p.id) ?? 0)) return;
    const horiz = Math.hypot(t.px - s.px, t.pz - s.pz);
    if (horiz > playerRadius(s) + playerRadius(t) + BALANCE.grab.range + C.hugReach) return;
    const dy = t.py + playerHeight(t) * 0.5 - (s.py + playerHeight(s) * 0.5);
    if (Math.abs(dy) > playerHeight(s) * 0.8 + 0.5 || !this.sim.clearBetween(s, t)) return;
    this.hugAt.set(p.id, this.sim.time + C.hugRetry);
    this.sim.hug(p, target);
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

  // --- Bæn Is Gay (Pride Parade) ---------------------------------------------------------------

  /** The rainbow burst when the parade starts: everyone close gets launched up and away. */
  private prideBurst(p: SimPlayer): void {
    const P = BALANCE.ults.pride;
    const sim = this.sim;
    const s = p.state;
    const x = s.px;
    const y = s.py + 1;
    const z = s.pz;
    sim.pushBall(x, y, z, P.burstRadius, BALANCE.modes.ball.splashImpulse, p.id);
    for (const o of sim.players.values()) {
      if (o === p || !sim.isEnemy(p.id, o.id)) continue;
      const t = o.state;
      if (t.mode === MODE_DEAD) continue;
      const r = playerRadius(t);
      const d = Math.max(0, Math.hypot(t.px - x, t.py + 1 - y, t.pz - z) - r);
      if (d > P.burstRadius) continue;
      const falloff = 0.45 + 0.55 * (1 - d / P.burstRadius);
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
      sim.applyHit(o, p.id, dx, 0.9, dz, P.burstKnockback * falloff, P.burstInflation * falloff, { direct: false, low: true, x: t.px - dx * r, y: t.py + 1, z: t.pz - dz * r, ult: true });
    }
  }

  /** Parades lay road at their feet; enemies who step on it get bounced into the air. */
  private stepRoad(): void {
    const P = BALANCE.ults.pride;
    const sim = this.sim;
    for (const p of sim.players.values()) {
      const s = p.state;
      if (s.prideTimer <= 0 || s.mode === MODE_DEAD) continue;
      if (sim.time - (this.roadAt.get(p.id) ?? -1) < P.roadEvery) continue;
      // Only on (or just above) the floor: the road is painted on the ground.
      const ground = sim.world.groundBelow(s.px, s.py + 0.3, s.pz, 1.5);
      if (ground === null) continue;
      this.roadAt.set(p.id, sim.time);
      this.road.push({ x: s.px, y: ground, z: s.pz, owner: p.id, until: sim.time + P.roadLife });
    }
    if (this.road.length > 600) this.road.splice(0, this.road.length - 600);
    for (let i = this.road.length - 1; i >= 0; i--) {
      const piece = this.road[i];
      if (sim.time >= piece.until) {
        this.road.splice(i, 1);
        continue;
      }
      const owner = sim.players.get(piece.owner);
      for (const o of sim.players.values()) {
        const t = o.state;
        if (o.id === piece.owner || t.mode === MODE_DEAD || t.spawnProt > 0 || !sim.isEnemy(piece.owner, o.id)) continue;
        if (t.py > piece.y + 1 || t.py < piece.y - 0.6) continue;
        const dx = t.px - piece.x;
        const dz = t.pz - piece.z;
        const hd = Math.hypot(dx, dz);
        if (hd > P.roadRadius + playerRadius(t)) continue;
        const key = `${piece.owner}:${o.id}`;
        if (sim.time < (this.bounceAt.get(key) ?? 0)) continue;
        this.bounceAt.set(key, sim.time + P.bounceCool);
        // Mostly straight up, nudged off the road.
        const ux = hd > 1e-3 ? dx / hd : Math.sin(owner?.state.yaw ?? 0);
        const uz = hd > 1e-3 ? dz / hd : Math.cos(owner?.state.yaw ?? 0);
        sim.applyHit(o, piece.owner, ux * 0.35, 1, uz * 0.35, P.bounce, P.bounceInflation, { direct: false, low: true, x: t.px, y: piece.y, z: t.pz, ult: true });
      }
    }
    if (this.bounceAt.size > 2000) this.bounceAt.clear();
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
