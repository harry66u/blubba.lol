import { BALANCE } from '../balance';
import { type InputFrame, emptyInput } from '../input';
import type { MapDef } from '../maps/types';
import {
  MODE_CLIMB,
  MODE_DEAD,
  MODE_HANG,
  MODE_NORMAL,
  type PlayerState,
  StepResult,
  type StepContext,
  type WeaponStats,
  createPlayerState,
  depenetrate,
  inflationMass,
  playerHeight,
  playerRadius,
  releaseLedge,
  stepPlayer,
} from '../player';
import { World } from '../world';
import { BOT_NAMES, BotBrain } from './bot';
import type { GameEvent } from './events';

export type ModeId = 'knockout';
export type MatchPhase = 'waiting' | 'playing' | 'results';

export interface MatchStats {
  kos: number;
  deaths: number;
  falls: number;
  hits: number;
  shots: number;
  longestLaunch: number;
  chainKos: number;
  timesPopped: number;
}

export interface SimPlayer {
  id: number;
  name: string;
  color: number;
  isBot: boolean;
  state: PlayerState;
  lastInput: InputFrame;
  queue: InputFrame[];
  lastSeq: number;
  /** Ticks of simulation this player is owed (input processing budget). */
  owed: number;
  score: number;
  stats: MatchStats;
  lastAttacker: number;
  lastAttackTime: number;
  respawnAt: number;
  /** Where the current launch started, for "longest launch" stats. */
  launchFromX: number;
  launchFromZ: number;
  launchBy: number;
  joinedAt: number;
}

export interface Projectile {
  id: number;
  owner: number;
  weapon: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  radius: number;
  power: number;
  charge: number;
  gravity: number;
  expires: number;
  blastRadius: number;
  inflation: number;
  knockback: number;
}

export interface SimOptions {
  map: MapDef;
  mode?: ModeId;
  durationSec?: number;
  features?: Partial<StepContext['features']>;
}

export interface MatchResult {
  winnerId: number;
  standings: { id: number; name: string; score: number; stats: MatchStats; isBot: boolean }[];
  longestLaunch: { id: number; distance: number } | null;
}

function newStats(): MatchStats {
  return { kos: 0, deaths: 0, falls: 0, hits: 0, shots: 0, longestLaunch: 0, chainKos: 0, timesPopped: 0 };
}

const MAX_QUEUE = 12;
const MAX_BEHIND = 6;
const MAX_AHEAD = 2;

/**
 * The authoritative game simulation. Owns the world, players, projectiles, and match rules. The
 * server wraps it with networking; tests drive it directly.
 */
export class GameSim {
  readonly map: MapDef;
  readonly world: World;
  readonly players = new Map<number, SimPlayer>();
  readonly projectiles: Projectile[] = [];
  events: GameEvent[] = [];
  tick = 0;
  time = 0;
  readonly dt = 1 / BALANCE.tickRate;
  mode: ModeId;
  durationSec: number;
  phase: MatchPhase = 'waiting';
  phaseEndsAt = 0;
  matchNumber = 0;
  lastResult: MatchResult | null = null;
  features: StepContext['features'];
  private nextProjectileId = 1;
  private readonly stepOut = new StepResult();
  private readonly ctx: StepContext;
  /** Called whenever the match phase changes (the server uses it to broadcast). */
  onPhaseChange: (() => void) | null = null;
  readonly bots = new Map<number, BotBrain>();
  /** Center of the main play area; bots recover toward it. */
  readonly homePoint: { x: number; y: number; z: number };

  constructor(opts: SimOptions) {
    this.map = opts.map;
    this.world = new World(opts.map);
    this.mode = opts.mode ?? 'knockout';
    this.durationSec = opts.durationSec ?? BALANCE.match.durationSec;
    this.features = { brace: true, ledge: true, ...opts.features };
    this.ctx = { world: this.world, dt: this.dt, weapon: this.weaponStats(), features: this.features };
    const n = this.map.spawns.length;
    this.homePoint = {
      x: this.map.spawns.reduce((a, s) => a + s[0], 0) / n,
      y: this.map.spawns.reduce((a, s) => a + s[1], 0) / n,
      z: this.map.spawns.reduce((a, s) => a + s[2], 0) / n,
    };
  }

  weaponStats(): WeaponStats {
    const w = BALANCE.weapons.airCannon;
    return { ammo: w.ammo, reloadTime: w.reloadTime, fireCooldown: w.fireCooldown, chargeTime: w.chargeTime, tapPower: w.tapPower };
  }

  // --- Players -----------------------------------------------------------------------------

  addPlayer(name: string, opts: { isBot?: boolean; color?: number; id?: number } = {}): SimPlayer {
    const id = opts.id ?? this.freeId();
    const state = createPlayerState();
    state.mode = MODE_DEAD;
    const p: SimPlayer = {
      id,
      name,
      color: opts.color ?? this.freeColor(),
      isBot: !!opts.isBot,
      state,
      lastInput: emptyInput(),
      queue: [],
      lastSeq: 0,
      owed: 0,
      score: 0,
      stats: newStats(),
      lastAttacker: -1,
      lastAttackTime: -999,
      respawnAt: this.time,
      launchFromX: 0,
      launchFromZ: 0,
      launchBy: -1,
      joinedAt: this.time,
    };
    this.players.set(id, p);
    this.respawn(p);
    this.updatePhase();
    return p;
  }

  addBot(skill = 0.5): SimPlayer {
    const used = new Set([...this.players.values()].map((p) => p.name));
    const name = BOT_NAMES.find((n) => !used.has(n)) ?? `Bot ${this.players.size + 1}`;
    const p = this.addPlayer(name, { isBot: true });
    this.bots.set(p.id, new BotBrain(skill, p.id * 7919 + this.tick));
    return p;
  }

  removePlayer(id: number): void {
    const p = this.players.get(id);
    if (!p) return;
    this.players.delete(id);
    this.bots.delete(id);
    for (const other of this.players.values()) {
      if (other.lastAttacker === id) other.lastAttacker = -1;
    }
    this.updatePhase();
  }

  private freeId(): number {
    for (let i = 0; i < 255; i++) if (!this.players.has(i)) return i;
    throw new Error('room full');
  }

  private freeColor(): number {
    const used = new Set([...this.players.values()].map((p) => p.color));
    for (let i = 0; i < 10; i++) if (!used.has(i)) return i;
    return Math.floor(Math.random() * 10);
  }

  humanCount(): number {
    let n = 0;
    for (const p of this.players.values()) if (!p.isBot) n++;
    return n;
  }

  queueInput(id: number, frame: InputFrame): void {
    const p = this.players.get(id);
    if (!p) return;
    // Drop stale or duplicate frames.
    if (frame.seq <= p.lastSeq && p.lastSeq !== 0) return;
    const last = p.queue[p.queue.length - 1];
    if (last && frame.seq <= last.seq) return;
    p.queue.push(frame);
    while (p.queue.length > MAX_QUEUE) p.queue.shift();
  }

  // --- Main loop ---------------------------------------------------------------------------

  /** Advances the whole game by one fixed tick. */
  step(): void {
    this.tick++;
    this.time = this.tick * this.dt;
    this.world.setTime(this.time);

    this.stepMatch();

    for (const [id, brain] of this.bots) {
      const p = this.players.get(id);
      if (p) p.queue.push(brain.think(this, p));
    }

    for (const p of this.players.values()) {
      if (p.state.mode === MODE_DEAD) {
        // Keep consuming input so counters stay in sync while waiting to respawn.
        this.drainInputs(p);
        if (this.phase !== 'results' && this.time >= p.respawnAt) this.respawn(p);
        continue;
      }
      this.processInputs(p);
    }
    this.world.setTime(this.time);

    this.separatePlayers();
    this.stepProjectiles();
    this.checkBlastZones();
  }

  private drainInputs(p: SimPlayer): void {
    p.owed = 0;
    let last: InputFrame | undefined;
    while (p.queue.length) last = p.queue.shift();
    if (last) {
      p.lastSeq = last.seq;
      // Counters must follow the client even while dead so no phantom presses appear later.
      stepPlayer(p.state, last, this.ctx, this.stepOut);
      p.lastInput = last;
    }
  }

  private processInputs(p: SimPlayer): void {
    if (p.isBot) {
      // Bots produce exactly one frame per tick.
      const f = p.queue.shift() ?? p.lastInput;
      this.applyInput(p, f);
      return;
    }
    p.owed += 1;
    const n = Math.min(p.queue.length, Math.max(0, p.owed + MAX_AHEAD), 4);
    for (let i = 0; i < n; i++) {
      const f = p.queue.shift()!;
      // Stagger world time so moving platforms carry correctly when catching up.
      this.world.setTime(this.time - (n - 1 - i) * this.dt);
      this.applyInput(p, f);
      p.owed -= 1;
    }
    if (p.owed > MAX_BEHIND) {
      // The client is starving us (lag spike). Keep simulating with its last held input so it
      // cannot freeze in mid-air.
      this.world.setTime(this.time);
      while (p.owed > MAX_BEHIND) {
        this.applyInput(p, p.lastInput, true);
        p.owed -= 1;
      }
    }
  }

  private applyInput(p: SimPlayer, f: InputFrame, synthetic = false): void {
    const s = p.state;
    if (!synthetic) {
      p.lastSeq = f.seq;
      p.lastInput = f;
    }
    const out = this.stepOut;
    stepPlayer(s, f, this.ctx, out);
    this.handleStepResult(p, out);
  }

  private handleStepResult(p: SimPlayer, out: StepResult): void {
    const s = p.state;
    const tick = this.tick;
    if (out.fired) {
      this.spawnShot(p, out.fired.ox, out.fired.oy, out.fired.oz, out.fired.dx, out.fired.dy, out.fired.dz, out.fired.power, out.fired.charge, p.lastInput.seq);
    }
    if (out.jumped) this.events.push({ t: 'move', tick, id: p.id, kind: 'jump', x: s.px, y: s.py, z: s.pz });
    if (out.doubleJumped) this.events.push({ t: 'move', tick, id: p.id, kind: 'djump', x: s.px, y: s.py, z: s.pz });
    if (out.dashed) {
      this.events.push({
        t: 'move',
        tick,
        id: p.id,
        kind: out.slid ? 'slide' : 'dash',
        x: s.px,
        y: s.py,
        z: s.pz,
        // Deterministic "rare extra-long" fart so every client hears the same one.
        long: (tick * 7 + p.id * 13) % 23 === 0,
      });
    }
    if (out.techEscape) this.events.push({ t: 'move', tick, id: p.id, kind: 'tech', x: s.px, y: s.py, z: s.pz });
    if (out.landed > 6) this.events.push({ t: 'move', tick, id: p.id, kind: 'land', x: s.px, y: s.py, z: s.pz, v: out.landed });
    if (out.bounced) this.events.push({ t: 'move', tick, id: p.id, kind: 'bounce', x: s.px, y: s.py, z: s.pz });
    if (out.wallBounce) this.events.push({ t: 'move', tick, id: p.id, kind: 'wall', x: s.px, y: s.py, z: s.pz });
    if (out.padBounce >= 0) this.events.push({ t: 'move', tick, id: p.id, kind: 'pad', x: s.px, y: s.py, z: s.pz });
    if (out.ledgeGrab) this.events.push({ t: 'move', tick, id: p.id, kind: 'ledge', x: s.px, y: s.py, z: s.pz });
    if (out.climbed) this.events.push({ t: 'move', tick, id: p.id, kind: 'climb', x: s.px, y: s.py, z: s.pz });
    if (out.braced) this.events.push({ t: 'brace', tick, id: p.id });
    if (out.reloadStart) this.events.push({ t: 'reload', tick, id: p.id });
    if (out.taunt) this.events.push({ t: 'taunt', tick, id: p.id, n: (tick + p.id) % 4 });
    if (s.launchTimer <= 0 && p.launchBy >= 0 && s.onGround) {
      this.finishLaunch(p);
    }
  }

  // --- Projectiles -------------------------------------------------------------------------

  private spawnShot(p: SimPlayer, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, power: number, charge: number, clientSeq: number): void {
    const w = BALANCE.weapons.airCannon;
    const id = this.nextProjectileId;
    this.nextProjectileId = (this.nextProjectileId % 65535) + 1;
    const proj: Projectile = {
      id,
      owner: p.id,
      weapon: 0,
      x: ox,
      y: oy,
      z: oz,
      vx: dx * w.projSpeed,
      vy: dy * w.projSpeed,
      vz: dz * w.projSpeed,
      radius: w.projRadius * (0.75 + 0.25 * power),
      power,
      charge,
      gravity: w.projGravity,
      expires: this.time + w.projLifetime,
      blastRadius: w.blastRadius * (0.8 + 0.2 * power),
      inflation: w.inflation,
      knockback: w.knockback,
    };
    this.projectiles.push(proj);
    p.stats.shots++;
    this.events.push({
      t: 'shot',
      tick: this.tick,
      id: proj.id,
      owner: p.id,
      w: 0,
      x: ox,
      y: oy,
      z: oz,
      vx: proj.vx,
      vy: proj.vy,
      vz: proj.vz,
      r: proj.radius,
      power,
      cs: clientSeq,
    });
  }

  private stepProjectiles(): void {
    const dt = this.dt;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      const speed = Math.hypot(pr.vx, pr.vy, pr.vz);
      const steps = Math.max(1, Math.ceil((speed * dt) / (pr.radius * 0.8)));
      const sdt = dt / steps;
      let done = false;
      for (let k = 0; k < steps && !done; k++) {
        pr.vy -= pr.gravity * sdt;
        pr.x += pr.vx * sdt;
        pr.y += pr.vy * sdt;
        pr.z += pr.vz * sdt;
        // Direct hits on players.
        for (const p of this.players.values()) {
          if (p.id === pr.owner || p.state.mode === MODE_DEAD) continue;
          const hit = capsuleSphere(p.state, pr.x, pr.y, pr.z, pr.radius);
          if (hit) {
            this.directHit(pr, p, hit);
            done = true;
            break;
          }
        }
        if (done) break;
        // World: use a smaller core radius so big air blobs can skim floors.
        if (this.world.sphereHit(pr.x, pr.y, pr.z, pr.radius * 0.45) >= 0) {
          this.explode(pr, pr.x, pr.y, pr.z, -1);
          done = true;
        }
      }
      if (!done && this.time >= pr.expires) {
        this.events.push({ t: 'fizzle', tick: this.tick, id: pr.id, x: pr.x, y: pr.y, z: pr.z });
        done = true;
      }
      if (done) this.projectiles.splice(i, 1);
    }
  }

  private directHit(pr: Projectile, target: SimPlayer, hit: CapsuleHit): void {
    const K = BALANCE.knockback;
    const s = target.state;
    const h = playerHeight(s);
    const cy = s.py + h * 0.5;
    // Direction from the impact point through the body's center, bent by the shot's travel.
    let dx = s.px - hit.x;
    let dy = cy - hit.y;
    let dz = s.pz - hit.z;
    const l = Math.hypot(dx, dy, dz) || 1;
    const sp = Math.hypot(pr.vx, pr.vy, pr.vz) || 1;
    const b = K.travelBias;
    dx = (dx / l) * (1 - b) + (pr.vx / sp) * b;
    dy = (dy / l) * (1 - b) + (pr.vy / sp) * b;
    dz = (dz / l) * (1 - b) + (pr.vz / sp) * b;
    const low = hit.y < s.py + h * K.lowHitFraction;
    const power = pr.power * pr.knockback;
    this.applyHit(target, pr.owner, dx, dy, dz, power, pr.inflation * pr.power, { direct: true, low, x: hit.x, y: hit.y, z: hit.z });
    this.explode(pr, hit.x, hit.y, hit.z, target.id);
  }

  private explode(pr: Projectile, x: number, y: number, z: number, skipId: number): void {
    const K = BALANCE.knockback;
    const R = pr.blastRadius;
    this.events.push({ t: 'boom', tick: this.tick, id: pr.id, x, y, z, r: R, power: pr.power, owner: pr.owner });
    for (const p of this.players.values()) {
      if (p.id === skipId || p.state.mode === MODE_DEAD) continue;
      const s = p.state;
      const r = playerRadius(s);
      const h = playerHeight(s);
      // Distance from blast center to the body's axis segment.
      const ay = Math.max(s.py + r, Math.min(s.py + h - r, y));
      const d = Math.max(0, Math.hypot(x - s.px, y - ay, z - s.pz) - r);
      if (d > R) continue;
      const f = 1 - d / R;
      const falloff = K.splashEdge + (1 - K.splashEdge) * f;
      let dx = s.px - x;
      let dy = s.py + h * 0.5 - y;
      let dz = s.pz - z;
      const l = Math.hypot(dx, dy, dz) || 1;
      dx /= l;
      dy /= l;
      dz /= l;
      if (p.id === pr.owner) {
        this.blastJump(p, dx, dy, dz, falloff, pr.charge);
      } else {
        const power = pr.power * pr.knockback * K.splashMult * falloff;
        this.applyHit(p, pr.owner, dx, dy, dz, power, pr.inflation * pr.power * K.splashMult * falloff, {
          direct: false,
          low: false,
          x,
          y,
          z,
        });
      }
    }
  }

  /** Your own blast launches you but never inflates you. */
  private blastJump(p: SimPlayer, dx: number, dy: number, dz: number, falloff: number, charge: number): void {
    const s = p.state;
    if (s.mode !== MODE_NORMAL) return;
    const BJ = BALANCE.blastJump;
    const speed = BJ.speed * (BJ.minPower + (1 - BJ.minPower) * charge) * falloff;
    if (s.vy < 0) s.vy = 0;
    s.vx += dx * speed;
    s.vy += Math.max(dy, 0.35) * speed;
    s.vz += dz * speed;
    s.onGround = 0;
    s.slideTimer = 0;
    this.events.push({ t: 'blastjump', tick: this.tick, id: p.id });
  }

  applyHit(
    target: SimPlayer,
    attackerId: number,
    dx: number,
    dy: number,
    dz: number,
    power: number,
    inflationAdd: number,
    info: { direct: boolean; low: boolean; x: number; y: number; z: number },
  ): void {
    const K = BALANCE.knockback;
    const s = target.state;
    if (s.mode === MODE_DEAD) return;
    if (s.spawnProt > 0) {
      this.events.push({ t: 'shield', tick: this.tick, target: target.id, x: info.x, y: info.y, z: info.z });
      return;
    }
    const braced = s.braceTimer > 0;
    const Br = BALANCE.brace;
    s.inflation = Math.min(BALANCE.inflation.max, s.inflation + inflationAdd * (braced ? Br.inflationMult : 1));
    const mass = inflationMass(s.inflation);
    const speed = (power * (K.base + K.growth * s.inflation)) / mass * (braced ? Br.knockbackMult : 1);

    // Normalize and guarantee some lift so targets leave the ground.
    let l = Math.hypot(dx, dy, dz) || 1;
    dx /= l;
    dy /= l;
    dz /= l;
    if (dy < K.minUp) {
      const hl = Math.hypot(dx, dz);
      const hs = Math.sqrt(1 - K.minUp * K.minUp);
      if (hl > 1e-4) {
        dx = (dx / hl) * hs;
        dz = (dz / hl) * hs;
      } else {
        dx = 0;
        dz = 0;
      }
      dy = K.minUp;
      l = 1;
    }

    if (s.mode === MODE_HANG || s.mode === MODE_CLIMB) releaseLedge(s, 0);
    s.vx = s.vx * K.keepVelocity + dx * speed;
    s.vy = Math.max(0, s.vy) * K.keepVelocity + dy * speed;
    s.vz = s.vz * K.keepVelocity + dz * speed;
    s.onGround = 0;
    s.groundId = -1;
    s.slideTimer = 0;
    s.dashTimer = 0;
    s.launchTimer = Math.min(K.hitstunMax, Math.max(K.hitstunMin, speed * K.hitstunPerSpeed));
    s.launchElapsed = 0;
    s.sinceHit = 0;
    if (info.low) {
      s.doubledTimer = K.doubleOverTime;
      s.charging = 0;
      s.charge = 0;
    }
    if (braced) {
      s.braceCool *= 1 - Br.successRefund;
    }
    // Growing can push the hitbox into walls; nudge back out.
    depenetrate(s, this.world);

    if (attackerId >= 0 && attackerId !== target.id) {
      target.lastAttacker = attackerId;
      target.lastAttackTime = this.time;
      const a = this.players.get(attackerId);
      if (a) a.stats.hits++;
    }
    target.launchFromX = s.px;
    target.launchFromZ = s.pz;
    target.launchBy = attackerId;

    this.events.push({
      t: 'hit',
      tick: this.tick,
      target: target.id,
      attacker: attackerId,
      x: info.x,
      y: info.y,
      z: info.z,
      dx,
      dy,
      dz,
      speed,
      direct: info.direct,
      low: info.low,
      braced,
      infl: s.inflation,
    });
  }

  private finishLaunch(p: SimPlayer, dead = false): void {
    const s = p.state;
    const dist = Math.hypot(s.px - p.launchFromX, s.pz - p.launchFromZ);
    const attacker = this.players.get(p.launchBy);
    if (attacker && attacker.id !== p.id && dist > attacker.stats.longestLaunch) {
      attacker.stats.longestLaunch = dist;
    }
    if (!dead) p.launchBy = -1;
  }

  // --- Player interactions -----------------------------------------------------------------

  private separatePlayers(): void {
    const list = [...this.players.values()].filter((p) => p.state.mode === MODE_NORMAL);
    const k = Math.min(1, BALANCE.player.separationStrength * this.dt);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i].state;
        const b = list[j].state;
        const ra = playerRadius(a);
        const rb = playerRadius(b);
        const dx = b.px - a.px;
        const dz = b.pz - a.pz;
        const d = Math.hypot(dx, dz);
        const minD = ra + rb;
        if (d >= minD) continue;
        if (a.py + playerHeight(a) <= b.py || b.py + playerHeight(b) <= a.py) continue;
        const nx = d > 1e-4 ? dx / d : 1;
        const nz = d > 1e-4 ? dz / d : 0;
        const push = (minD - d) * 0.5 * k;
        a.px -= nx * push;
        a.pz -= nz * push;
        b.px += nx * push;
        b.pz += nz * push;
        depenetrate(a, this.world);
        depenetrate(b, this.world);
      }
    }
  }

  // --- Knockouts and respawns --------------------------------------------------------------

  private checkBlastZones(): void {
    const B = this.map.blast;
    for (const p of this.players.values()) {
      const s = p.state;
      if (s.mode === MODE_DEAD) continue;
      if (s.px < B.minX || s.px > B.maxX || s.py < B.minY || s.py > B.maxY || s.pz < B.minZ || s.pz > B.maxZ) {
        this.knockout(p);
      }
    }
  }

  knockout(p: SimPlayer): void {
    const s = p.state;
    const credit = p.lastAttacker >= 0 && this.time - p.lastAttackTime <= BALANCE.knockback.creditWindow;
    const killer = credit ? this.players.get(p.lastAttacker) : undefined;
    let points = 0;
    const tags: string[] = [];
    if (killer && this.phase === 'playing') {
      points = BALANCE.scoring.knockout;
      killer.score += points;
      killer.stats.kos++;
    }
    if (killer) {
      if (p.launchBy === killer.id) this.finishLaunch(p, true);
    }
    p.stats.deaths++;
    if (!killer) p.stats.falls++;
    this.events.push({
      t: 'ko',
      tick: this.tick,
      victim: p.id,
      killer: killer ? killer.id : -1,
      x: s.px,
      y: s.py,
      z: s.pz,
      vx: s.vx,
      vy: s.vy,
      vz: s.vz,
      points,
      tags,
    });
    s.mode = MODE_DEAD;
    s.vx = s.vy = s.vz = 0;
    s.charging = 0;
    s.charge = 0;
    p.respawnAt = this.time + BALANCE.match.respawnDelay;
    p.lastAttacker = -1;
    p.launchBy = -1;
  }

  respawn(p: SimPlayer): void {
    const s = p.state;
    const keep = { cJump: s.cJump, cDash: s.cDash, cBrace: s.cBrace, cGrab: s.cGrab, cGrapple: s.cGrapple, cReload: s.cReload, cU1: s.cU1, cU2: s.cU2, cTaunt: s.cTaunt, yaw: s.yaw };
    const fresh = createPlayerState();
    Object.assign(s, fresh, keep);
    const sp = this.pickSpawn(p.id);
    s.px = sp[0];
    s.py = sp[1] + 0.01;
    s.pz = sp[2];
    // Face the middle of the map so nobody spawns staring at a drop.
    s.yaw = Math.atan2(-(this.homePoint.x - sp[0]), -(this.homePoint.z - sp[2]));
    s.mode = MODE_NORMAL;
    s.onGround = 1;
    s.spawnProt = BALANCE.match.spawnProtection;
    s.ammo = this.ctx.weapon.ammo;
    p.lastAttacker = -1;
    p.launchBy = -1;
    this.events.push({ t: 'spawn', tick: this.tick, id: p.id, x: s.px, y: s.py, z: s.pz });
  }

  private pickSpawn(forId: number): [number, number, number, number] {
    let best = this.map.spawns[0];
    let bestScore = -Infinity;
    for (const sp of this.map.spawns) {
      let minD = 1e9;
      for (const o of this.players.values()) {
        if (o.id === forId || o.state.mode === MODE_DEAD) continue;
        minD = Math.min(minD, Math.hypot(o.state.px - sp[0], o.state.py - sp[1], o.state.pz - sp[2]));
      }
      // Slight randomness so players don't always spawn in the same spot.
      const score = minD + Math.random() * 4;
      if (score > bestScore) {
        bestScore = score;
        best = sp;
      }
    }
    return best;
  }

  // --- Match flow --------------------------------------------------------------------------

  private updatePhase(): void {
    if (this.phase === 'waiting' && this.players.size >= 2) this.startMatch();
    else if (this.phase === 'playing' && this.players.size < 2) {
      this.phase = 'waiting';
      this.onPhaseChange?.();
    }
  }

  startMatch(): void {
    this.phase = 'playing';
    this.matchNumber++;
    this.phaseEndsAt = this.time + this.durationSec;
    for (const p of this.players.values()) {
      p.score = 0;
      p.stats = newStats();
      this.respawn(p);
    }
    this.projectiles.length = 0;
    this.onPhaseChange?.();
  }

  private stepMatch(): void {
    if (this.phase === 'playing' && this.time >= this.phaseEndsAt) {
      this.endMatch();
    } else if (this.phase === 'results' && this.time >= this.phaseEndsAt) {
      if (this.players.size >= 2) this.startMatch();
      else {
        this.phase = 'waiting';
        this.onPhaseChange?.();
      }
    }
  }

  endMatch(): void {
    const standings = [...this.players.values()]
      .map((p) => ({ id: p.id, name: p.name, score: p.score, stats: { ...p.stats }, isBot: p.isBot }))
      .sort((a, b) => b.score - a.score || b.stats.kos - a.stats.kos || a.stats.deaths - b.stats.deaths);
    let longest: MatchResult['longestLaunch'] = null;
    for (const s of standings) {
      if (s.stats.longestLaunch > 0 && (!longest || s.stats.longestLaunch > longest.distance)) longest = { id: s.id, distance: s.stats.longestLaunch };
    }
    this.lastResult = { winnerId: standings[0]?.id ?? -1, standings, longestLaunch: longest };
    this.phase = 'results';
    this.phaseEndsAt = this.time + BALANCE.match.resultsSec;
    this.onPhaseChange?.();
  }

  timeLeft(): number {
    if (this.phase === 'waiting') return this.durationSec;
    return Math.max(0, this.phaseEndsAt - this.time);
  }

  drainEvents(): GameEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }
}

// --- Geometry helpers ------------------------------------------------------------------------

export interface CapsuleHit {
  x: number;
  y: number;
  z: number;
}

/** Sphere vs. the player's vertical capsule. Returns the impact point on the body surface. */
export function capsuleSphere(s: PlayerState, x: number, y: number, z: number, r: number): CapsuleHit | null {
  const pr = playerRadius(s);
  const h = playerHeight(s);
  const ay = Math.max(s.py + pr, Math.min(s.py + h - pr, y));
  const dx = x - s.px;
  const dy = y - ay;
  const dz = z - s.pz;
  const d = Math.hypot(dx, dy, dz);
  if (d > pr + r) return null;
  if (d < 1e-5) return { x: s.px, y: ay, z: s.pz };
  return { x: s.px + (dx / d) * pr, y: ay + (dy / d) * pr, z: s.pz + (dz / d) * pr };
}
