/**
 * Every gameplay tuning value lives in this file (spec §3: "Keep every balance value in one
 * place"). Server simulation, client prediction, bots, and balance tests all read from here.
 *
 * Units: meters, seconds, meters/second. Inflation is a 0..1 fraction shown to players as a
 * percentage.
 */
export const BALANCE = {
  tickRate: 60,
  snapshotRate: 30,

  player: {
    /** Collision half-width at 0% inflation. */
    radius: 0.42,
    /** Collision height at 0% inflation. */
    height: 2.1,
    eyeHeight: 1.85,
    walkSpeed: 8,
    groundAccel: 70,
    /** Quake-style friction coefficient while walking on the ground. */
    groundFriction: 9,
    stopSpeed: 3,
    airAccel: 30,
    /** Air control can only accelerate you up to this speed along your input direction. */
    airMaxSpeed: 8,
    /** Gentle horizontal drag while airborne, per second (keeps momentum mostly intact). */
    airDrag: 0.12,
    gravity: 26,
    maxFallSpeed: 45,
    jumpVelocity: 9.6,
    doubleJumpVelocity: 9.4,
    /** How much of the double jump's horizontal velocity is redirected toward your input. */
    doubleJumpRedirect: 0.6,
    coyoteTime: 0.1,
    stepHeight: 0.5,
    /** Launched players hitting the floor faster than this bounce like rubber. */
    landingBounceMinSpeed: 13,
    landingBounce: 0.38,
    /** Movement penalty while charging a shot. */
    chargingMoveMult: 0.85,
    /** Soft push-apart strength between overlapping players. */
    separationStrength: 12,
  },

  dash: {
    charges: 2,
    /** Seconds to recharge one dash charge (charges refill one at a time). */
    rechargeTime: 2.4,
    minInterval: 0.22,
    speed: 19,
    duration: 0.16,
    /** An air dash sets vertical velocity to at least this, stopping a fall. */
    airUpBoost: 3.5,
    /** A ground dash turns into a slide for this long. */
    slideDuration: 0.55,
    slideFriction: 1.1,
    slideSteerAccel: 10,
    /** Minimum time after being launched before you can dash out of it. */
    launchLockout: 0.18,
    /** Fraction of launch velocity kept when you dash out of a launch. */
    launchKeep: 0.4,
  },

  inflation: {
    max: 1,
    /** Avatar and hitbox scale at 100% inflation. */
    scaleAtMax: 1.75,
    /** Mass multiplier at 100% inflation (lighter = flies farther). */
    massAtMax: 0.5,
    /** Passive deflation per second after `decayDelay` seconds without being hit. 0 = off. */
    decayPerSec: 0,
    decayDelay: 4,
  },

  knockback: {
    /** Launch speed = power * (base + growth * inflation) / mass. */
    base: 6.2,
    growth: 9.2,
    /** Near misses (splash) launch this much weaker than direct hits. */
    splashMult: 0.55,
    /** Splash power at the very edge of the blast radius relative to the center. */
    splashEdge: 0.3,
    /** How much the projectile's travel direction bends the launch (0 = impact point only). */
    travelBias: 0.4,
    /** Every launch has at least this much upward direction so targets leave the ground. */
    minUp: 0.45,
    /** Fraction of the target's previous velocity kept on a new hit. */
    keepVelocity: 0.15,
    hitstunPerSpeed: 0.03,
    hitstunMin: 0.15,
    hitstunMax: 1.0,
    /** Air steering while launched (DI). */
    launchSteerAccel: 10,
    launchDrag: 0.55,
    wallBounce: 0.55,
    wallBounceMinSpeed: 8,
    /** Direct hits on the bottom fraction of the body are groin shots. */
    lowHitFraction: 0.32,
    doubleOverTime: 0.5,
    doubleOverMoveMult: 0.3,
    /** Seconds a hitter keeps credit for a knockout after their last hit. */
    creditWindow: 8,
  },

  blastJump: {
    /** Launch speed from your own blast at point-blank with a full charge. */
    speed: 17,
    /** Blast jumps with an uncharged shot are this fraction of a full one. */
    minPower: 0.55,
  },

  weapons: {
    airCannon: {
      ammo: 5,
      reloadTime: 1.5,
      fireCooldown: 0.28,
      chargeTime: 0.75,
      /** Power of an instant tap relative to a full charge. */
      tapPower: 0.35,
      projSpeed: 36,
      projRadius: 0.55,
      projLifetime: 1.3,
      projGravity: 0,
      blastRadius: 2.6,
      /** Inflation added by a full-power direct hit. */
      inflation: 0.14,
      knockback: 1.0,
    },
  },

  brace: {
    /** How long a brace protects you after pressing it. */
    window: 0.28,
    cooldown: 1.3,
    knockbackMult: 0.4,
    inflationMult: 0.5,
    /** A successful brace refunds this fraction of the cooldown. */
    successRefund: 0.5,
  },

  match: {
    durationSec: 240,
    minDurationSec: 180,
    maxDurationSec: 300,
    resultsSec: 14,
    respawnDelay: 2.4,
    spawnProtection: 2.0,
    maxPlayers: 10,
    /** Public rooms are topped up with bots until this many players are present. */
    publicBotFill: 4,
  },

  scoring: {
    knockout: 1,
  },
};

export type WeaponId = 'airCannon';
