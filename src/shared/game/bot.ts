import { BALANCE } from '../balance';
import { BTN_FIRE, type InputFrame, emptyInput } from '../input';
import { MODE_DEAD, MODE_HANG, MODE_HELD, eyeHeight, playerHeight } from '../player';
import { type WeaponStats, weaponRange } from '../loadout';
import { lobPitch, shotDir } from '../shots';
import type { GameSim, SimPlayer } from './sim';

export const BOT_NAMES = [
  'Floppy Frank',
  'Wiggles',
  'Gusty',
  'Puffy McPuff',
  'Noodle',
  'Sir Flails',
  'Balloonatic',
  'Windy Wendy',
  'Squeaks',
  'Big Blow',
  'Tubeular',
  'Airhead',
  'Wobbles',
  'Captain Gust',
];

interface Objective {
  /** Where to go (null: stay put). */
  move: { x: number; z: number } | null;
  /** Close enough to the move point. */
  arrive: number;
  /** Stand still once there (pumps). */
  hold: boolean;
  /** Aim here instead of at the target. */
  aim: { x: number; y: number; z: number } | null;
  shoot: boolean;
}

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** Where a bot likes to stand for its weapon (r: 0..1 random). */
function preferredDistance(w: WeaponStats, r: number): number {
  if (w.kind === 'cone') return 2.5 + r * 2.5;
  if (w.kind === 'stream') return 4 + r * 3;
  if (w.kind === 'hitscan') return 14 + r * 12;
  if (w.kind === 'spread') return 3 + r * 4;
  if (w.projGravity > 0) return Math.max(w.blastRadius + 4, 10) + r * 8;
  if (w.auto) return 7 + r * 7;
  return 6 + r * 9;
}

const tmpShot = { x: 0, y: 0, z: 0 };

/** Seconds for a shot to cover `dist` meters horizontally. */
function flightTime(w: WeaponStats, dist: number): number {
  if (w.projGravity > 0) {
    const d = shotDir(w, 1, 0.3, 0, tmpShot);
    return dist / Math.max(1, w.projSpeed * d.x);
  }
  return dist / Math.max(1, w.projSpeed);
}

/** Look pitch to hit a point `dy` above the eye and `dist` away (lobbed shots arc). */
function aimPitch(w: WeaponStats, dy: number, dist: number): number {
  if (w.kind === 'projectile' && w.projGravity > 0) {
    const p = lobPitch(w.projSpeed, w.projGravity, w.projLoft, dist, dy);
    if (p !== null) return p;
    return Math.PI / 4 - Math.asin(Math.min(1, w.projLoft * Math.SQRT1_2));
  }
  return Math.atan2(dy, dist);
}

/** How long to charge the next shot (r: 0..1 random). */
function chargeGoalFor(w: WeaponStats, dist: number, skill: number, r: number): number {
  // The shotgun's ring only tightens with charge: tap up close, charge from further out.
  if (w.kind === 'spread') return Math.max(0.05, Math.min(1, (dist - 3) / 6 + (r - 0.5) * 0.3));
  if (w.projGravity > 0) return 0.6 + r * 0.4;
  if (w.kind === 'hitscan') return 0.7 + r * 0.3;
  return 0.3 + skill * 0.3 + r * 0.4;
}

/**
 * Simple bot brain that produces one input frame per tick. Bots fill public rooms so there is
 * always someone to blast, and they drive the automated balance and soak tests.
 */
export class BotBrain {
  private input: InputFrame = emptyInput();
  private seq = 0;
  targetId = -1;
  private retargetAt = 0;
  private desiredDist = 10;
  private strafeSign = 1;
  private strafeUntil = 0;
  private aimYaw = 0;
  private aimPitch = 0;
  private noiseYaw = 0;
  private noisePitch = 0;
  private chargeGoal = 0.8;
  private aimFeet = false;
  /** Bots wait a moment after picking a target and between shots, like a human would. */
  private nextShotAt = 0;
  private rng: () => number;

  constructor(
    readonly skill: number,
    seed = Math.floor(Math.random() * 1e9),
  ) {
    let s = seed >>> 0 || 1;
    this.rng = () => {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      return ((s >>> 0) % 100000) / 100000;
    };
  }

  /** When (in seconds after being grabbed) this bot will try to dash free. */
  private escapeAt = -1;
  /** How long we've been off the stage (bots react late, like people do). */
  private offStageTime = 0;
  /** What this bot will try while recovering, decided once per trip off the stage. */
  private recovery = { grapple: false, wall: false, steer: 1, dash: false };
  private bracedFor = new Set<number>();
  /** Jumping off a piece of the map that's about to fall (kept until we land somewhere safe). */
  private fleeing = false;

  private press(key: 'jump' | 'dash' | 'brace' | 'grab' | 'grapple' | 'util1' | 'util2'): void {
    this.input[key] = (this.input[key] + 1) & 255;
  }

  think(sim: GameSim, me: SimPlayer): InputFrame {
    const f = this.input;
    f.seq = ++this.seq;
    f.tick = sim.tick;
    f.moveX = 0;
    f.moveZ = 0;
    const s = me.state;
    if (s.mode === MODE_DEAD) {
      f.buttons = 0;
      return { ...f };
    }
    const rnd = this.rng;
    const world = sim.world;
    const home = sim.homePoint;

    // --- Recovery: no ground below us means we're about to fall off. ---
    const ground = world.groundBelow(s.px, s.py + 0.2, s.pz, 60);
    const offStage = !s.onGround && (ground === null || ground < s.py - 12);
    if (s.mode === MODE_HELD) {
      f.buttons = 0;
      if (this.escapeAt < 0) {
        // Skilled bots aim for the middle of the window; weak ones are often early or late.
        const G = BALANCE.grab;
        const mid = (G.escapeStart + G.escapeEnd) / 2;
        this.escapeAt = mid + (rnd() - 0.5) * (0.12 + (1 - this.skill) * 0.7);
      }
      if (s.holdTimer >= this.escapeAt && !s.escapeUsed) this.press('dash');
      return { ...f };
    }
    this.escapeAt = -1;
    if (s.holding >= 0) {
      // Throw toward the nearest edge once allowed.
      const e = nearestEdgeDir(sim, s.px, s.pz, s.groundId);
      f.yaw = Math.atan2(-e.x, -e.z);
      f.pitch = 0.3;
      this.aimYaw = f.yaw;
      f.buttons = s.holdTimer >= BALANCE.grab.minHold + 0.05 + (1 - this.skill) * 0.3 ? BTN_FIRE : 0;
      return { ...f };
    }
    if (s.mode === MODE_HANG) {
      f.buttons = 0;
      f.moveZ = 1;
      f.yaw = Math.atan2(s.hangNx, s.hangNz) + Math.PI; // face the wall
      if (rnd() < 0.05) this.press('jump');
      return { ...f };
    }
    // The map is shrinking and we're on a piece about to fall: head for the middle and jump the gap.
    if (s.onGround) this.fleeing = doomedSpot(sim, s.px, s.pz, s.groundId) && (world.solids[s.groundId]?.collapse ?? 0) > 0;
    if (this.fleeing && s.py > home.y - 4) {
      const yaw = Math.atan2(-(home.x - s.px), -(home.z - s.pz));
      f.yaw = yaw;
      f.pitch = 0;
      this.aimYaw = yaw;
      f.moveZ = 1;
      f.buttons = 0;
      if (s.onGround) {
        const edge = world.groundBelow(s.px - Math.sin(yaw) * 1.3, s.py + 0.6, s.pz - Math.cos(yaw) * 1.3, 3) === null;
        if (edge) this.press('jump');
      } else if (s.jumpsUsed === 1 && s.vy < 1.5) this.press('jump');
      else if (s.vy < -3 && s.dashCharges > 0 && rnd() < 0.1) this.press('dash');
      this.offStageTime = 0;
      return { ...f };
    }
    if (offStage && this.offStageTime === 0) {
      // Like people, bots don't always remember every way back: pick a plan once per launch.
      this.recovery = {
        grapple: rnd() < 0.15 + this.skill * 0.5,
        wall: rnd() < 0.2 + this.skill * 0.5,
        steer: 0.35 + this.skill * 0.65,
        dash: rnd() < 0.4 + this.skill * 0.5,
      };
    }
    this.offStageTime = offStage ? this.offStageTime + sim.dt : 0;
    const reaction = 0.7 - this.skill * 0.4;
    if (offStage && this.offStageTime < reaction) {
      // Still flailing in surprise.
      f.buttons = 0;
      return { ...f };
    }
    if (offStage) {
      const dx = home.x - s.px;
      const dz = home.z - s.pz;
      const yawHome = Math.atan2(-dx, -dz);
      this.aimYaw = yawHome;
      f.yaw = yawHome;
      f.pitch = 0;
      f.moveZ = this.recovery.steer;
      f.buttons = 0;
      const recoverSkill = 0.4 + this.skill * 0.6;
      const wallSlot = me.loadout.utils.indexOf('inflatableWall');
      const wallCool = wallSlot === 0 ? s.u1Cool : s.u2Cool;
      if (this.recovery.wall && wallSlot >= 0 && wallCool <= 0 && s.vy < -4 && rnd() < 0.04 * recoverSkill) {
        this.press(wallSlot === 0 ? 'util1' : 'util2');
      } else if (this.recovery.grapple && sim.features.grapple && s.grappleCool <= 0 && rnd() < 0.02 * recoverSkill) {
        // Aim at the near edge of the main deck and zip back.
        const dy = home.y + 0.5 - (s.py + eyeHeight(s));
        f.pitch = Math.atan2(dy, Math.hypot(home.x - s.px, home.z - s.pz));
        this.press('grapple');
      } else if (s.vy < -3 && s.jumpsUsed < 2 && s.launchTimer <= 0 && rnd() < 0.05 * recoverSkill) this.press('jump');
      else if (this.recovery.dash && s.vy < -5 && s.dashCharges > 0 && rnd() < 0.05 * recoverSkill) this.press('dash');
      if (rnd() < 0.08 * this.skill) this.press('grab'); // try to catch a ledge
      return { ...f };
    }

    // --- Pick a target. ---
    if (sim.time >= this.retargetAt || !this.validTarget(sim, this.targetId)) {
      const prev = this.targetId;
      this.targetId = this.pickTarget(sim, me);
      this.retargetAt = sim.time + 1.5 + rnd() * 2;
      if (this.targetId !== prev) this.nextShotAt = Math.max(this.nextShotAt, sim.time + 0.9 - this.skill * 0.6 + rnd() * 0.4);
      this.desiredDist = preferredDistance(me.weapon, rnd());
      // Lobbed splash shots land best at the feet.
      this.aimFeet = me.weapon.projGravity > 0 || rnd() < 0.35;
    }
    const target = sim.players.get(this.targetId);
    const obj = this.objective(sim, me, target) ?? this.lootObjective(sim, me);

    // --- Aim. ---
    const turnRate = (2.5 + this.skill * 6) * sim.dt;
    // Precise weapons: bots steady their aim while they charge, like people lining up a shot.
    const settle = (me.weapon.kind === 'hitscan' || me.weapon.kind === 'spread') && s.charging ? 1 - 0.6 * s.charge : 1;
    const noiseAmp = ((1 - this.skill) * 0.22 + 0.02) * settle;
    this.noiseYaw += (rnd() - 0.5) * 0.04;
    this.noisePitch += (rnd() - 0.5) * 0.03;
    this.noiseYaw = Math.max(-noiseAmp, Math.min(noiseAmp, this.noiseYaw));
    this.noisePitch = Math.max(-noiseAmp, Math.min(noiseAmp, this.noisePitch));
    let dist = 20;
    let wantYaw = this.aimYaw;
    let wantPitch = 0;
    if (obj?.aim) {
      const ey = s.py + eyeHeight(s);
      const dx = obj.aim.x - s.px;
      const dy = obj.aim.y - ey;
      const dz = obj.aim.z - s.pz;
      dist = Math.hypot(dx, dz);
      wantYaw = Math.atan2(-dx, -dz) + this.noiseYaw * 0.5;
      wantPitch = aimPitch(me.weapon, dy, dist) + this.noisePitch * 0.5;
    } else if (target) {
      const t = target.state;
      const ex = s.px;
      const ey = s.py + eyeHeight(s);
      const ez = s.pz;
      dist = Math.hypot(t.px - ex, t.pz - ez);
      const lead = me.weapon.kind === 'projectile' ? flightTime(me.weapon, dist) * (this.skill * this.skill) : 0;
      const tx = t.px + t.vx * lead;
      const tz = t.pz + t.vz * lead;
      const ty = t.py + (this.aimFeet ? 0.15 : playerHeight(t) * 0.5) + Math.min(0, t.vy) * lead * 0.3;
      const dx = tx - ex;
      const dy = ty - ey;
      const dz = tz - ez;
      wantYaw = Math.atan2(-dx, -dz) + this.noiseYaw;
      wantPitch = aimPitch(me.weapon, dy, Math.hypot(dx, dz)) + this.noisePitch;
    }
    const dyaw = wrapAngle(wantYaw - this.aimYaw);
    this.aimYaw = wrapAngle(this.aimYaw + Math.max(-turnRate, Math.min(turnRate, dyaw)));
    this.aimPitch += Math.max(-turnRate, Math.min(turnRate, wantPitch - this.aimPitch));
    f.yaw = this.aimYaw;
    f.pitch = this.aimPitch;
    const aimError = Math.abs(dyaw) + Math.abs(wantPitch - this.aimPitch);

    // --- Move: keep a preferred distance and strafe. ---
    if (sim.time > this.strafeUntil) {
      this.strafeSign = rnd() < 0.5 ? -1 : 1;
      this.strafeUntil = sim.time + 0.6 + rnd() * 1.6;
    }
    if (obj?.move) {
      // Head for the objective (behind the ball, onto a pump), expressed relative to our yaw.
      const hx = obj.move.x - s.px;
      const hz = obj.move.z - s.pz;
      const hl = Math.hypot(hx, hz);
      if (hl > obj.arrive) {
        const k = Math.min(1, hl / 2) / (hl || 1);
        f.moveZ = (hx * -Math.sin(f.yaw) + hz * -Math.cos(f.yaw)) * k;
        f.moveX = (hx * Math.cos(f.yaw) + hz * -Math.sin(f.yaw)) * k;
        if (hl > 12 && s.onGround && s.dashCharges > 0 && rnd() < 0.01 * this.skill) this.press('dash');
      } else if (obj.hold) {
        f.moveX = f.moveZ = 0;
      } else {
        f.moveX = this.strafeSign * 0.5;
      }
    } else if (target) {
      if (dist > this.desiredDist + 3) f.moveZ = 1;
      else if (dist < this.desiredDist - 3) f.moveZ = -1;
      f.moveX = this.strafeSign * 0.8;
      // Short-range weapons close the gap with a dash now and then.
      const k = me.weapon.kind;
      if ((k === 'cone' || k === 'spread' || k === 'stream') && dist > this.desiredDist + 5 && dist < 22 && s.onGround && s.dashCharges > 1 && rnd() < 0.012 * this.skill) {
        f.moveX = 0;
        this.press('dash');
      }
    } else {
      f.moveZ = 0.5;
    }
    // Edge avoidance: probe ahead in the direction we're about to walk.
    const sinY = Math.sin(f.yaw);
    const cosY = Math.cos(f.yaw);
    const wx = cosY * f.moveX - sinY * f.moveZ;
    const wz = -sinY * f.moveX - cosY * f.moveZ;
    const probe = 2.5 + Math.hypot(s.vx, s.vz) * 0.35;
    const g = world.groundBelow(s.px + wx * probe, s.py + 0.6, s.pz + wz * probe, 4);
    // The map is shrinking: get off pieces that are about to fall, and back from deck edges that
    // are about to crumble (bots see the same warning players do).
    const doomed = s.onGround === 1 && doomedSpot(sim, s.px, s.pz, s.groundId);
    if (g === null || doomed) {
      // Walk toward home instead, expressed relative to our current yaw.
      const hx = home.x - s.px;
      const hz = home.z - s.pz;
      const hl = Math.hypot(hx, hz) || 1;
      const fx = -sinY;
      const fz = -cosY;
      const rx = cosY;
      const rz = -sinY;
      f.moveZ = (hx * fx + hz * fz) / hl;
      f.moveX = (hx * rx + hz * rz) / hl;
      this.strafeSign = -this.strafeSign;
    }

    // --- Close range: grab and throw, or stomp hands on a ledge. ---
    if (target && sim.features.grab && s.grabCool <= 0 && s.onGround && dist < 2.2 && rnd() < 0.02 + this.skill * 0.03) {
      this.press('grab');
    }
    if (sim.features.ledge && s.onGround) {
      for (const o of sim.players.values()) {
        if (o.id === me.id || o.state.mode !== MODE_HANG || !sim.isEnemy(me.id, o.id)) continue;
        const hx = o.state.hangX - s.px;
        const hz = o.state.hangZ - s.pz;
        const hd = Math.hypot(hx, hz);
        if (hd < 6 && Math.abs(o.state.hangY - s.py) < 1) {
          // Walk to the hands and stomp.
          const fx = -Math.sin(f.yaw);
          const fz = -Math.cos(f.yaw);
          const rx = Math.cos(f.yaw);
          const rz = -Math.sin(f.yaw);
          f.moveZ = (hx * fx + hz * fz) / (hd || 1);
          f.moveX = (hx * rx + hz * rz) / (hd || 1);
          if (hd < 1.2 && rnd() < 0.3) this.press('grab');
          break;
        }
      }
    }

    // --- Jump and dash to dodge. ---
    if (s.onGround && rnd() < 0.006 + this.skill * 0.006) this.press('jump');
    else if (!s.onGround && s.jumpsUsed === 1 && s.vy < 0 && rnd() < 0.02) this.press('jump');
    if (s.onGround && s.dashCharges === BALANCE.dash.charges && rnd() < 0.003 * this.skill && g !== null) this.press('dash');

    // --- Brace against incoming shots (skilled bots only). ---
    if (this.skill > 0.5 && s.braceCool <= 0) {
      for (const pr of sim.projectiles) {
        if (pr.owner === me.id) continue;
        const dx = s.px - pr.x;
        const dy = s.py + 1 - pr.y;
        const dz = s.pz - pr.z;
        const d = Math.hypot(dx, dy, dz);
        const closing = (dx * pr.vx + dy * pr.vy + dz * pr.vz) / (d || 1);
        if (d < 4 && closing > 20 && !this.bracedFor.has(pr.id)) {
          // One reaction per incoming shot, and only sometimes in time.
          this.bracedFor.add(pr.id);
          if (this.bracedFor.size > 50) this.bracedFor.clear();
          if (rnd() < this.skill * 0.35) this.press('brace');
          break;
        }
      }
    }

    // --- Utilities: lob a grenade at mid range now and then; walls/rafts save us when falling. ---
    const utils = me.loadout.utils;
    for (let slot = 0; slot < 2; slot++) {
      const cool = slot === 0 ? s.u1Cool : s.u2Cool;
      if (cool > 0 || !target) continue;
      const u = utils[slot];
      const want =
        ((u === 'airGrenade' || u === 'vacuumGrenade' || u === 'heliumBomb') && dist > 5 && dist < 14 && rnd() < 0.004 * this.skill) ||
        (u === 'bouncePad' && s.onGround && rnd() < 0.0015) ||
        (u === 'inflatableWall' && dist < 10 && rnd() < 0.0015) ||
        // Mines get lobbed where the target is headed; tornados get sent rolling at them.
        (u === 'airMine' && s.onGround && dist > 3 && dist < 12 && rnd() < 0.001 + 0.003 * this.skill) ||
        (u === 'tornado' && s.onGround && dist > 3 && dist < 14 && aimError < 0.3 && rnd() < 0.001 + 0.003 * this.skill);
      if (want) {
        this.press(slot === 0 ? 'util1' : 'util2');
        break;
      }
    }

    // --- Shoot: hold to charge, release when charged and on target. ---
    const w = me.weapon;
    const range = weaponRange(w);
    // Don't lob a splash shot at someone standing right next to us.
    const tooClose = w.projGravity > 0 && !obj?.aim && dist < w.blastRadius * 0.9;
    const hasTarget = !tooClose && (obj?.aim ? obj.shoot && dist < Math.min(40, range + 1) : !!target && dist < Math.min(40, range + 1));
    if (!hasTarget) {
      f.buttons = 0;
    } else if (w.kind === 'stream') {
      f.buttons = aimError < 0.25 && s.ammo > 0 && s.reloadTimer <= 0 ? BTN_FIRE : 0;
    } else if (w.auto) {
      // Spray while roughly on target, in bursts.
      const onTarget = aimError < 0.12 + (1 - this.skill) * 0.12;
      f.buttons = onTarget && s.ammo >= 1 && s.reloadTimer <= 0 && sim.time >= this.nextShotAt ? BTN_FIRE : 0;
    } else if (s.charging) {
      const onTarget = aimError < (w.kind === 'hitscan' ? 0.03 : w.kind === 'spread' ? 0.06 : 0.08) + (1 - this.skill) * 0.1;
      if (s.charge >= this.chargeGoal && onTarget) {
        f.buttons = 0;
        this.chargeGoal = chargeGoalFor(w, dist, this.skill, rnd());
        this.nextShotAt = sim.time + (1 - this.skill) * 1.1 + rnd() * 0.6;
        if (rnd() < 0.3 && w.projGravity <= 0) this.aimFeet = !this.aimFeet;
      } else {
        f.buttons = BTN_FIRE;
      }
    } else {
      f.buttons = s.ammo > 0 && s.reloadTimer <= 0 && sim.time >= this.nextShotAt ? BTN_FIRE : 0;
    }
    return { ...f };
  }

  /** Supply crates this bot has decided to chase (or ignore), by crate id. */
  private lootPlans = new Map<number, boolean>();

  /** Sometimes run for a nearby supply crate that's on (or nearly on) our level and reachable on foot. */
  private lootObjective(sim: GameSim, me: SimPlayer): Objective | null {
    const s = me.state;
    if (!sim.crates.length) return null;
    let best: { x: number; z: number } | null = null;
    let bestD = Infinity;
    for (const c of sim.crates) {
      const d = Math.hypot(c.x - s.px, c.z - s.pz);
      if (d > 26) continue;
      // Wait for falling crates to get low, and skip ones up on another level.
      if (c.falling ? c.y - s.py > 9 : Math.abs(c.y - s.py) > 1.5) continue;
      let go = this.lootPlans.get(c.id);
      if (go === undefined) {
        go = this.rng() < 0.35 + this.skill * 0.45;
        if (this.lootPlans.size > 40) this.lootPlans.clear();
        this.lootPlans.set(c.id, go);
      }
      if (go && d < bestD) {
        bestD = d;
        best = c;
      }
    }
    if (!best) return null;
    // Only walk there if there's floor all the way.
    for (let k = 1; k <= 5; k++) {
      const f = k / 6;
      if (sim.world.groundBelow(s.px + (best.x - s.px) * f, s.py + 1.5, s.pz + (best.z - s.pz) * f, 4) === null) return null;
    }
    return { move: { x: best.x, z: best.z }, arrive: 0.3, hold: false, aim: null, shoot: true };
  }

  private validTarget(sim: GameSim, id: number): boolean {
    const t = sim.players.get(id);
    return !!t && t.state.mode !== MODE_DEAD && t.state.spawnProt <= 0;
  }

  /**
   * Team-mode goals. Ball: half the team plays the ball (gets behind it and blasts it at the enemy
   * goal), the rest fight. Pump: most bots hold their own pumps and shoot enemies nearby; a few
   * go and stand on enemy pumps to contest them.
   */
  private objective(sim: GameSim, me: SimPlayer, target: SimPlayer | undefined): Objective | null {
    const s = me.state;
    if (me.team < 0) return null;
    // Roles go by rank within the team so every team gets the same mix.
    let rank = 0;
    for (const o of sim.players.values()) if (o.team === me.team && o.id < me.id) rank++;
    const ball = sim.ballGame;
    if (ball) {
      if (rank % 2 === 1 && target) return null; // fighter
      const spawn = sim.map.ball!.spawn;
      // Between goals: wait on our side of the kickoff spot.
      if (!ball.inPlay) return { move: { x: spawn[0] + (me.team === 0 ? -6 : 6), z: spawn[2] }, arrive: 3, hold: false, aim: null, shoot: false };
      const b = ball.ball;
      const goal = sim.map.ball!.goals.find((g) => g.team !== me.team)!;
      const gx = (goal.min[0] + goal.max[0]) / 2;
      const gz = (goal.min[2] + goal.max[2]) / 2;
      let dx = gx - b.x;
      let dz = gz - b.z;
      const dl = Math.hypot(dx, dz) || 1;
      dx /= dl;
      dz /= dl;
      const back = b.r + 2.5 + (me.weapon.kind === 'hitscan' ? 8 : me.weapon.kind === 'projectile' ? 4 : 0);
      const spot = { x: b.x - dx * back, z: b.z - dz * back };
      // Only shoot when we're roughly behind the ball, so it goes the right way.
      const tx = b.x - s.px;
      const tz = b.z - s.pz;
      const tl = Math.hypot(tx, tz) || 1;
      const lined = (tx * dx + tz * dz) / tl > 0.55;
      return { move: spot, arrive: 1.5, hold: false, aim: { x: b.x, y: b.y, z: b.z }, shoot: lined };
    }
    const pumps = sim.map.pumps;
    if (sim.pumpGame && pumps) {
      const contest = rank % 4 === 3;
      const mine = pumps.filter((p) => (contest ? p.team !== me.team : p.team === me.team));
      if (!mine.length) return null;
      const pick = mine[rank % mine.length];
      const on = Math.hypot(s.px - pick.x, s.pz - pick.z) < pick.r * 0.6;
      // Shoot enemies close to our pump; otherwise just stand there.
      const threat = target && Math.hypot(target.state.px - pick.x, target.state.pz - pick.z) < 14;
      return { move: { x: pick.x, z: pick.z }, arrive: pick.r * 0.4, hold: on, aim: null, shoot: !!threat };
    }
    return null;
  }

  private pickTarget(sim: GameSim, me: SimPlayer): number {
    let best = -1;
    let bestScore = Infinity;
    // Spread out: avoid ganging up on whoever other bots are already chasing.
    const chased = new Map<number, number>();
    for (const [id, brain] of sim.bots) {
      if (id !== me.id && brain.targetId >= 0) chased.set(brain.targetId, (chased.get(brain.targetId) ?? 0) + 1);
    }
    for (const o of sim.players.values()) {
      if (o.id === me.id || o.state.mode === MODE_DEAD || !sim.isEnemy(me.id, o.id)) continue;
      const d = Math.hypot(o.state.px - me.state.px, o.state.py - me.state.py, o.state.pz - me.state.pz);
      const score = d * (1 + (chased.get(o.id) ?? 0) * 0.8) + this.rng() * 8;
      if (score < bestScore) {
        bestScore = score;
        best = o.id;
      }
    }
    return best;
  }
}

const lookAhead = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };

/** True when standing here is about to be a bad idea: the piece falls soon or the deck edge crumbles past it. */
function doomedSpot(sim: GameSim, x: number, z: number, groundId: number): boolean {
  const w = sim.world;
  if (groundId < 0 || !w.plan.length) return false;
  const s = w.solids[groundId];
  if (!s || s.collapse < 0) return false;
  const lead = BALANCE.shrink.warning + 1.5;
  if (s.collapse > 0) return w.fallsIn(groundId, sim.time) < lead;
  const b = w.deckBoundsAt(s, sim.time + lead, lookAhead);
  const margin = 2.5;
  return x < b.minX + margin || x > b.maxX - margin || z < b.minZ + margin || z > b.maxZ - margin;
}

/** Unit vector (x, z) toward the closest edge of the deck we're standing on (or the largest one). */
function nearestEdgeDir(sim: GameSim, x: number, z: number, groundId = -1): { x: number; z: number } {
  const area = (so: { minX: number; maxX: number; minZ: number; maxZ: number }) => (so.maxX - so.minX) * (so.maxZ - so.minZ);
  let deck = sim.world.solids[0];
  for (const so of sim.world.solids) if (area(so) > area(deck)) deck = so;
  const under = groundId >= 0 ? sim.world.solids[groundId] : undefined;
  if (under && area(under) > 60) deck = under;
  const d = [
    { x: 1, z: 0, dist: deck.maxX - x },
    { x: -1, z: 0, dist: x - deck.minX },
    { x: 0, z: 1, dist: deck.maxZ - z },
    { x: 0, z: -1, dist: z - deck.minZ },
  ].sort((a, b) => a.dist - b.dist)[0];
  return { x: d.x, z: d.z };
}
