import { BALANCE } from '../balance';
import { BTN_FIRE, type InputFrame, emptyInput } from '../input';
import { MODE_DEAD, MODE_HANG, MODE_HELD, eyeHeight, playerHeight } from '../player';
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

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
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
  private bracedFor = new Set<number>();

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
      const e = nearestEdgeDir(sim, s.px, s.pz);
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
    this.offStageTime = offStage ? this.offStageTime + sim.dt : 0;
    const reaction = 0.55 - this.skill * 0.35;
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
      f.moveZ = 1;
      f.buttons = 0;
      const recoverSkill = 0.4 + this.skill * 0.6;
      const wallSlot = me.loadout.utils.indexOf('inflatableWall');
      const wallCool = wallSlot === 0 ? s.u1Cool : s.u2Cool;
      if (wallSlot >= 0 && wallCool <= 0 && s.vy < -4 && rnd() < 0.04 * recoverSkill) {
        this.press(wallSlot === 0 ? 'util1' : 'util2');
      } else if (sim.features.grapple && s.grappleCool <= 0 && rnd() < 0.02 * recoverSkill) {
        // Aim at the near edge of the main deck and zip back.
        const dy = home.y + 0.5 - (s.py + eyeHeight(s));
        f.pitch = Math.atan2(dy, Math.hypot(home.x - s.px, home.z - s.pz));
        this.press('grapple');
      } else if (s.vy < -3 && s.jumpsUsed < 2 && s.launchTimer <= 0 && rnd() < 0.12 * recoverSkill) this.press('jump');
      else if (s.vy < -5 && s.dashCharges > 0 && rnd() < 0.08 * recoverSkill) this.press('dash');
      if (rnd() < 0.08 * this.skill) this.press('grab'); // try to catch a ledge
      return { ...f };
    }

    // --- Pick a target. ---
    if (sim.time >= this.retargetAt || !this.validTarget(sim, this.targetId)) {
      const prev = this.targetId;
      this.targetId = this.pickTarget(sim, me);
      this.retargetAt = sim.time + 1.5 + rnd() * 2;
      if (this.targetId !== prev) this.nextShotAt = Math.max(this.nextShotAt, sim.time + 0.9 - this.skill * 0.6 + rnd() * 0.4);
      const kind = me.weapon.kind;
      this.desiredDist =
        kind === 'cone' ? 2.5 + rnd() * 2.5 : kind === 'stream' ? 4 + rnd() * 3 : kind === 'hitscan' ? 14 + rnd() * 12 : 6 + rnd() * 9;
      this.aimFeet = rnd() < 0.35;
    }
    const target = sim.players.get(this.targetId);

    // --- Aim. ---
    const turnRate = (2.5 + this.skill * 6) * sim.dt;
    const noiseAmp = (1 - this.skill) * 0.22 + 0.02;
    this.noiseYaw += (rnd() - 0.5) * 0.04;
    this.noisePitch += (rnd() - 0.5) * 0.03;
    this.noiseYaw = Math.max(-noiseAmp, Math.min(noiseAmp, this.noiseYaw));
    this.noisePitch = Math.max(-noiseAmp, Math.min(noiseAmp, this.noisePitch));
    let dist = 20;
    let wantYaw = this.aimYaw;
    let wantPitch = 0;
    if (target) {
      const t = target.state;
      const ex = s.px;
      const ey = s.py + eyeHeight(s);
      const ez = s.pz;
      dist = Math.hypot(t.px - ex, t.pz - ez);
      const lead = me.weapon.kind === 'projectile' ? (dist / me.weapon.projSpeed) * (this.skill * this.skill) : 0;
      const tx = t.px + t.vx * lead;
      const tz = t.pz + t.vz * lead;
      const ty = t.py + (this.aimFeet ? 0.15 : playerHeight(t) * 0.5) + Math.min(0, t.vy) * lead * 0.3;
      const dx = tx - ex;
      const dy = ty - ey;
      const dz = tz - ez;
      wantYaw = Math.atan2(-dx, -dz) + this.noiseYaw;
      wantPitch = Math.atan2(dy, Math.hypot(dx, dz)) + this.noisePitch;
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
    if (target) {
      if (dist > this.desiredDist + 3) f.moveZ = 1;
      else if (dist < this.desiredDist - 3) f.moveZ = -1;
      f.moveX = this.strafeSign * 0.8;
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
    if (g === null) {
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
        if (o.id === me.id || o.state.mode !== MODE_HANG) continue;
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
        ((u === 'airGrenade' || u === 'vacuumGrenade') && dist > 5 && dist < 14 && rnd() < 0.004 * this.skill) ||
        (u === 'bouncePad' && s.onGround && rnd() < 0.0015) ||
        (u === 'inflatableWall' && dist < 10 && rnd() < 0.0015);
      if (want) {
        this.press(slot === 0 ? 'util1' : 'util2');
        break;
      }
    }

    // --- Shoot: hold to charge, release when charged and on target. ---
    const range = me.weapon.kind === 'projectile' ? me.weapon.projSpeed * me.weapon.projLifetime : me.weapon.range;
    const hasTarget = !!target && dist < Math.min(40, range + 1);
    if (!hasTarget) {
      f.buttons = 0;
    } else if (me.weapon.kind === 'stream') {
      f.buttons = aimError < 0.25 && s.ammo > 0 && s.reloadTimer <= 0 ? BTN_FIRE : 0;
    } else if (s.charging) {
      const onTarget = aimError < (me.weapon.kind === 'hitscan' ? 0.03 : 0.08) + (1 - this.skill) * 0.1;
      if (s.charge >= this.chargeGoal && onTarget) {
        f.buttons = 0;
        this.chargeGoal = 0.3 + this.skill * 0.3 + rnd() * 0.4;
        this.nextShotAt = sim.time + (1 - this.skill) * 1.1 + rnd() * 0.6;
        if (rnd() < 0.3) this.aimFeet = !this.aimFeet;
      } else {
        f.buttons = BTN_FIRE;
      }
    } else {
      f.buttons = s.ammo > 0 && s.reloadTimer <= 0 && sim.time >= this.nextShotAt ? BTN_FIRE : 0;
    }
    return { ...f };
  }

  private validTarget(sim: GameSim, id: number): boolean {
    const t = sim.players.get(id);
    return !!t && t.state.mode !== MODE_DEAD && t.state.spawnProt <= 0;
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
      if (o.id === me.id || o.state.mode === MODE_DEAD) continue;
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

/** Unit vector (x, z) from a point toward the closest edge of the main deck (the largest solid). */
function nearestEdgeDir(sim: GameSim, x: number, z: number): { x: number; z: number } {
  let deck = sim.world.solids[0];
  for (const so of sim.world.solids) {
    if ((so.maxX - so.minX) * (so.maxZ - so.minZ) > (deck.maxX - deck.minX) * (deck.maxZ - deck.minZ)) deck = so;
  }
  const d = [
    { x: 1, z: 0, dist: deck.maxX - x },
    { x: -1, z: 0, dist: x - deck.minX },
    { x: 0, z: 1, dist: deck.maxZ - z },
    { x: 0, z: -1, dist: z - deck.minZ },
  ].sort((a, b) => a.dist - b.dist)[0];
  return { x: d.x, z: d.z };
}
