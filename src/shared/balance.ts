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
    /** Launch speed = power * (base + growth * inflation^growthExp) / mass. */
    base: 9,
    growth: 16,
    /** >1 keeps early hits modest and makes high inflation ramp up sharply (tuned with scripts/knockback-sweep.ts). */
    growthExp: 3,
    /** Near misses (splash) launch this much weaker than direct hits. */
    splashMult: 0.65,
    /** Splash power at the very edge of the blast radius relative to the center. */
    splashEdge: 0.3,
    /** How much the projectile's travel direction bends the launch (0 = impact point only). */
    travelBias: 0.4,
    /** Every launch has at least this much upward direction so targets leave the ground. */
    minUp: 0.45,
    /** Fraction of the target's previous velocity kept on a new hit. */
    keepVelocity: 0.15,
    /** Hit-stop: the target freezes this long on impact (longer for harder hits), then launches. */
    hitStopBase: 0.06,
    hitStopPerSpeed: 0.0012,
    hitStopMax: 0.12,
    hitstunPerSpeed: 0.03,
    hitstunMin: 0.15,
    hitstunMax: 1.0,
    /** Air steering while launched (DI). */
    launchSteerAccel: 7,
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
    /** Balanced, medium range; charges into a heavy shot. */
    airCannon: {
      kind: 'projectile',
      ammo: 5,
      reloadTime: 1.5,
      fireCooldown: 0.28,
      chargeTime: 0.6,
      /** Power of an instant tap relative to a full charge (quick shots still shove). */
      tapPower: 0.5,
      /** Fast enough that shots land about 0.25 s after the click at typical fighting range. */
      projSpeed: 75,
      projRadius: 0.55,
      /** Range = projSpeed × projLifetime (about 49 m). */
      projLifetime: 0.65,
      projGravity: 0,
      blastRadius: 2.6,
      /** Inflation added by a full-power direct hit. */
      inflation: 0.15,
      knockback: 1.0,
      range: 0,
      cone: 0,
      rayRadius: 0,
      recoil: 0,
    },
    /** Continuous stream that pushes; spins up while held. Aim at the ground to hover. */
    leafBlower: {
      kind: 'stream',
      /** Seconds of blowing per tank. */
      ammo: 3.5,
      reloadTime: 2,
      fireCooldown: 0.15,
      /** Spin-up time to full strength. */
      chargeTime: 0.8,
      tapPower: 0.35,
      range: 9,
      /** Half-angle of the stream cone (radians). */
      cone: 0.38,
      /** Push acceleration at full strength on a fresh target (m/s²). */
      knockback: 22,
      /** Inflation per second of full-strength blowing. */
      inflation: 0.07,
      projSpeed: 0,
      projRadius: 0,
      projLifetime: 0,
      projGravity: 0,
      blastRadius: 0,
      rayRadius: 0,
      recoil: 0,
      hoverLift: 2.5,
      hoverTime: 1.2,
    },
    /** Air Blaster: close-range cone blast. */
    airHorn: {
      kind: 'cone',
      ammo: 4,
      reloadTime: 1.8,
      fireCooldown: 0.45,
      chargeTime: 0.6,
      tapPower: 0.4,
      range: 6.5,
      cone: 0.62,
      knockback: 1.45,
      inflation: 0.13,
      /** Push back on the shooter (lets you use it to recover). */
      recoil: 7,
      projSpeed: 0,
      projRadius: 0,
      projLifetime: 0,
      projGravity: 0,
      blastRadius: 0,
      rayRadius: 0,
    },
    /** Long-range precise shots that add extra inflation. Rewards accurate aim. */
    pumpRifle: {
      kind: 'hitscan',
      ammo: 3,
      reloadTime: 2,
      fireCooldown: 0.6,
      chargeTime: 1.0,
      tapPower: 0.3,
      range: 90,
      /** Tiny: this is the one weapon that doesn't forgive sloppy aim. */
      rayRadius: 0.12,
      knockback: 0.7,
      inflation: 0.24,
      projSpeed: 0,
      projRadius: 0,
      projLifetime: 0,
      projGravity: 0,
      blastRadius: 0,
      cone: 0,
      recoil: 0,
    },
  },

  /** Every mod is a trade-off (multipliers on the weapon's stats). */
  mods: {
    wideNozzle: { radius: 1.35, blast: 1.25, cone: 1.35, range: 0.7 },
    bigTank: { ammo: 1.6, reload: 1.4 },
    chargeValve: { knockback: 1.2, inflation: 1.1, fireCooldown: 1.6, chargeTime: 1.2 },
    quickValve: { fireCooldown: 0.6, chargeTime: 0.7, knockback: 0.82, inflation: 0.9 },
    longBarrel: { range: 1.35, radius: 0.75, cone: 0.7, blast: 0.85 },
  },

  utilities: {
    bouncePad: { cooldown: 12, throwSpeed: 14, lifetime: 10, strength: 19, half: 1.1 },
    airGrenade: { cooldown: 10, throwSpeed: 18, fuse: 1.2, radius: 4.5, knockback: 0.95, inflation: 0.06 },
    inflatableWall: { cooldown: 14, throwSpeed: 13, lifetime: 6, width: 4.5, height: 3, thickness: 0.6, raftLifetime: 3.5, raftSize: 3.6 },
    vacuumGrenade: { cooldown: 12, throwSpeed: 18, fuse: 1.0, radius: 7, duration: 1.3, pull: 24 },
    /** Thrown utilities fall with this gravity. */
    gravity: 22,
  },

  pickups: {
    radius: 1.2,
    sodaRespawn: 15,
    /** A pin appears somewhere on the map every this-many seconds (random within the range). */
    pinIntervalMin: 70,
    pinIntervalMax: 110,
    /** How long you keep a pin once you grab it. */
    pinDuration: 20,
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
    resultsSec: 22,
    respawnDelay: 2.4,
    spawnProtection: 2.0,
    maxPlayers: 10,
    /** Public rooms are topped up with bots until this many players are present. */
    publicBotFill: 6,
  },

  scoring: {
    knockout: 1,
  },

  ledge: {
    /** How long a press of grab keeps trying to catch a ledge while falling. */
    buffer: 0.2,
    maxHang: 3.5,
    climbTime: 0.3,
    regrabCooldown: 0.5,
    /** Horizontal reach from a stomping player's feet to the hanging player's hands. */
    stompReach: 0.9,
    stompDropSpeed: 7,
    stompStun: 0.5,
  },

  grab: {
    /** Reach beyond both bodies' radii. */
    range: 1.3,
    /** Half-angle (radians) in front of you that a grab can catch. */
    cone: 1.0,
    cooldown: 3,
    whiffCooldown: 0.6,
    /** The held player escapes only with a dash pressed inside this window (seconds after the grab). */
    escapeStart: 0.35,
    escapeEnd: 0.6,
    /** The grabber can throw once the escape window has closed. */
    minHold: 0.6,
    /** Grounded grabbers throw automatically after this long. */
    maxHold: 1.4,
    /** Airborne grabbers (take-you-with-me) hold on until this long. */
    maxDragHold: 3,
    throwPower: 1.15,
    throwInflation: 0.1,
    /** Minimum upward angle of a throw (radians). */
    throwMinPitch: 0.25,
    escapePush: 9,
    moveMult: 0.6,
  },

  grapple: {
    range: 24,
    cooldown: 5,
    missCooldown: 1.2,
    /** Extra radius around bodies so trackpad players can land grapples. */
    aimForgiveness: 0.5,
    pullSpeed: 15,
    pullUp: 5,
    pullHitstun: 0.35,
    zipSpeed: 26,
    zipMaxTime: 0.8,
  },

  chaos: {
    /** Average seconds between random events (host setting scales this). */
    eventInterval: 55,
    eventJitter: 10,
    /** Early enough that everyone sees one in their first match. */
    firstEventAfter: 22,
    /** Events are announced this long before they start. */
    warning: 4,
    fan: { duration: 10, accel: 12, airMult: 1.3, frictionMult: 0.3 },
    lowGravity: { duration: 12, gravityMult: 0.5 },
    ice: { duration: 12, frictionMult: 0.07, accelMult: 0.35 },
    maxInflate: { duration: 8 },
    /** No new events once the match is this close to ending. */
    quietEnd: 36,
  },

  chain: {
    /** A launched player moving at least this fast knocks back anyone they crash into. */
    minSpeed: 11,
    /** Knockback power per m/s of the crashing player's speed. */
    powerPerSpeed: 0.045,
    inflation: 0.05,
    /** The crashing player keeps this much of their speed. */
    keep: 0.6,
    /** The same pair can't chain-hit each other again for this long. */
    cooldown: 0.6,
  },

  /** Rewards for knockouts in one life (streak), announced to everyone. */
  streaks: {
    /** Turbo Tank: full ammo and dashes, then faster reloads and fire rate for a while. */
    turboAt: 3,
    turboSeconds: 12,
    /** Reloads and fire cooldowns run this many times faster during Turbo Tank. */
    turboRate: 2,
    /** Mega Blast: the next few shots fire at full charge, bigger and harder. */
    megaAt: 5,
    megaShots: 3,
    megaKnockback: 1.2,
    megaBlast: 1.5,
    megaRadius: 1.3,
    /** At this streak you get both again. */
    bothAt: 8,
  },

  crown: {
    /** Knockouts in a row (without being knocked out) needed to wear the crown. */
    minStreak: 2,
    multiplier: 3,
  },

  final: {
    seconds: 30,
    multiplier: 2,
    /** Islands (collapse >= 2) start sinking at these times after the final countdown begins. */
    islandDelay: { 3: 0, 2: 7, 1: 14 } as Record<number, number>,
    sinkAccel: 3,
    /** The main deck crumbles inward by this fraction per side over the last seconds. */
    deckShrink: 0.3,
    deckShrinkStart: 10,
  },

  /**
   * Mid-match shrink (knockout-style modes): at half time the outermost pieces (highest collapse
   * order) sink, after a warning everyone can see. The final 30 seconds finish the job.
   */
  shrink: {
    /** Seconds of warning (countdown, debris, red flashing edges) before pieces start to fall. */
    warning: 5,
    /** Red-edge warning before the later final-30 pieces go (the final callout announces those). */
    finalWarning: 4,
    /** Matches shorter than this skip the mid-match stage (it would run into the final 30). */
    minMatchSec: 100,
  },

  revenge: { bonus: 1 },

  modes: {
    /** Public team rooms are topped up with bots to this many players (4v4). */
    teamFill: 8,
    duel: { target: 5, durationSec: 180 },
    /** One life each, everyone at 100% inflation, last tube man standing wins. */
    suddenDeath: {
      /** Hard cap on a match; if it runs out, survivors are ranked by knockouts, then hits. */
      durationSec: 150,
      /** People who join this soon after the start still play; later ones watch until the next match. */
      joinGrace: 3,
      /** A little longer than usual: everyone spawns one hit from flying. */
      spawnProtection: 3,
      /** Pause after the last pop before the results, so everyone sees the winner. */
      winnerDelay: 2.5,
      /** Rounds are short, so the results screen (replay included) is too. */
      resultsSec: 18,
      /**
       * The map keeps shrinking to force a finish. `at` is seconds into the match; `sink` lists the
       * collapse orders that start sinking; `deck` is how much of the main deck's half-size has
       * crumbled away per side once the stage is done (over `deckTime` seconds).
       */
      stages: [
        { at: 40, sink: [3], deck: 0 },
        { at: 60, sink: [2], deck: 0 },
        { at: 80, sink: [1], deck: 0.15 },
        { at: 100, sink: [], deck: 0.3 },
        { at: 120, sink: [], deck: 0.45 },
      ] as { at: number; sink: number[]; deck: number }[],
      deckTime: 6,
    },
    ball: {
      gravity: 14,
      drag: 0.25,
      bounce: 0.72,
      /** Speed cap so the ball stays readable. */
      maxSpeed: 42,
      /** Impulse (m/s) from a full-power direct shot. */
      shotImpulse: 16,
      splashImpulse: 12,
      streamAccel: 34,
      bodyPush: 4,
      resetDelay: 3,
      goalTarget: 7,
    },
    pump: {
      /** Fill per second for one teammate standing on an uncontested pump. */
      rate: 0.0045,
      /** Each extra teammate on the same pump adds this fraction of the base rate. */
      extraPerPlayer: 0.35,
    },
  },

  multiKo: { window: 4 },

  combo: {
    /** Hits within this long of the previous hit, before the target lands, extend a combo. */
    window: 1.2,
  },
};


