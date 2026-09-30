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
    rechargeTime: 3.2,
    minInterval: 0.22,
    speed: 16.5,
    duration: 0.16,
    /** An air dash sets vertical velocity to at least this, slowing a fall. */
    airUpBoost: 2.4,
    /** A ground dash turns into a slide for this long. */
    slideDuration: 0.55,
    slideFriction: 1.1,
    slideSteerAccel: 10,
    /** Minimum time after being launched before you can dash out of it. */
    launchLockout: 0.3,
    /** Fraction of launch velocity kept when you dash out of a launch (it steers, not cancels). */
    launchKeep: 0.6,
    /** A dash out of a launch is this fraction of a normal dash. */
    launchDashMult: 0.7,
    /** After dashing out of a launch, your next dash waits at least this long. */
    launchDashCool: 0.9,
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
    /**
     * Quick shots inflate more than they launch: a shot adds power + (1 - power) × tapBonus of its
     * weapon's inflation (an Air Cannon tap adds 75%, a full charge 100%).
     */
    tapBonus: 0.5,
  },

  knockback: {
    /** Launch speed = power * (base + growth * inflation^growthExp) / mass. */
    base: 9,
    growth: 16,
    /** >1 keeps early hits modest and makes high inflation ramp up sharply (tuned with scripts/knockback-sweep.ts). */
    growthExp: 3,
    /** Hits that leave someone at 100% inflation launch this much harder (maxed out means in danger). */
    maxedMult: 1.2,
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
      blastRadius: 2.4,
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
      knockback: 26,
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
      range: 7,
      cone: 0.62,
      knockback: 1.5,
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
    /**
     * Bubble Shotgun: a fixed pattern of bubble pellets (one in the middle, the rest in a ring).
     * Every pellet that connects adds its share of the shot; charging tightens the ring so it
     * reaches further. Brutal up close, a tickle at range.
     */
    bubbleShotgun: {
      kind: 'spread',
      ammo: 4,
      reloadTime: 1.9,
      fireCooldown: 0.5,
      chargeTime: 0.55,
      tapPower: 0.55,
      /** Pellets fly (instantly, lag compensated) this far. */
      range: 20,
      /** Pellet radius: forgiving, but the ring still misses at range. */
      rayRadius: 0.17,
      pellets: 7,
      /** Half-angle of the pellet ring on a tap (radians). */
      spread: 0.15,
      /** The ring shrinks to this fraction at full charge. */
      spreadCharged: 0.45,
      /** Pellets lose this fraction of their punch between `falloffStart` and max range. */
      falloff: 0.65,
      falloffStart: 3.5,
      /** Knockback and inflation when every pellet lands. */
      knockback: 1.05,
      inflation: 0.15,
      recoil: 2.5,
      projSpeed: 0,
      projRadius: 0,
      projLifetime: 0,
      projGravity: 0,
      blastRadius: 0,
      cone: 0,
    },
    /** Balloon Mortar: lobs a heavy water balloon on an arc; a huge splash knocks groups over. */
    balloonMortar: {
      kind: 'projectile',
      ammo: 2,
      reloadTime: 2.3,
      fireCooldown: 0.85,
      chargeTime: 0.8,
      tapPower: 0.55,
      /** Slow and lofted: a level shot flies up about 37 degrees and lands ~22 m out. */
      projSpeed: 21,
      projRadius: 0.75,
      projLifetime: 3.5,
      projGravity: 20,
      /** Added to the aim's vertical direction so a level shot still arcs high. */
      projLoft: 0.75,
      blastRadius: 4.6,
      inflation: 0.18,
      knockback: 1.4,
      range: 0,
      cone: 0,
      rayRadius: 0,
      recoil: 1.5,
    },
    /**
     * Pop Gun: hold to spray small fast corks. Each one pushes a little and inflates a little
     * (no launch, no hit-stop), so the pressure builds the longer you stay on target.
     */
    popGun: {
      kind: 'projectile',
      /** Fires while held instead of on release. */
      auto: 1,
      /** Hits push instead of launching. */
      light: 1,
      ammo: 24,
      reloadTime: 1.4,
      fireCooldown: 0.085,
      /** Spin-up: the first shots come at up to 2.5x the cooldown. */
      chargeTime: 0.3,
      tapPower: 1,
      projSpeed: 85,
      projRadius: 0.3,
      projLifetime: 0.4,
      projGravity: 0,
      blastRadius: 0,
      /** Push per cork (scaled like knockback: more on inflated targets). */
      knockback: 0.14,
      inflation: 0.021,
      /** A Mega Blast lasts 1 / megaCost corks per "shot". */
      megaCost: 0.125,
      range: 0,
      cone: 0,
      rayRadius: 0,
      recoil: 0,
    },
  },

  /**
   * Weapon parts (the builder). Every slot applies to every weapon, and every option is a
   * trade-off (multipliers on the weapon's stats; see computeWeaponStats). "range" stretches how
   * far shots go, "width" is aim forgiveness (shot size, cone, spread, hitbox), "blast" is the
   * splash radius, "move" is walking speed.
   */
  parts: {
    // Barrel: reach vs. forgiveness.
    longBarrel: { range: 1.35, speed: 1.15, width: 0.78, blast: 0.85 },
    stubbyBarrel: { range: 0.72, width: 1.28, blast: 1.18 },
    // Tank: ammo vs. reload and weight.
    bigTank: { ammo: 1.6, reload: 1.4, move: 0.95 },
    miniTank: { ammo: 0.6, reload: 0.55, move: 1.05 },
    // Valve: charge speed vs. power.
    chargeValve: { knockback: 1.2, inflation: 1.1, fireCooldown: 1.5, chargeTime: 1.25 },
    quickValve: { knockback: 0.82, inflation: 0.9, fireCooldown: 0.65, chargeTime: 0.7 },
    /** Quick taps hit almost as hard as charged shots, but charged shots hit a bit softer. */
    hairTrigger: { tapPower: 0.3, knockback: 0.88, inflation: 0.92, spinUp: 0.4 },
    // Nozzle: splash vs. focus.
    wideNozzle: { width: 1.3, blast: 1.3, knockback: 0.88 },
    jetNozzle: { width: 0.75, blast: 0.7, knockback: 1.15 },
    pumpNozzle: { inflation: 1.25, knockback: 0.85 },
    // Grip: handling.
    sprintGrip: { move: 1.1, chargeMove: 1, knockback: 0.9 },
    anchorStock: { recoil: 0.3, knockback: 1.08, move: 0.9 },
    kickStock: { recoilMult: 1.4, recoilAdd: 3, blastJump: 1.4, knockback: 0.92 },
    /** Auto weapons feel valve fire-rate changes at this strength (full strength would melt). */
    autoRateScale: 0.5,
    /** Auto weapons get this share of the kick stock's extra recoil per shot. */
    autoRecoilScale: 0.15,
  },

  utilities: {
    bouncePad: { cooldown: 12, throwSpeed: 14, lifetime: 10, strength: 19, half: 1.1 },
    airGrenade: { cooldown: 10, throwSpeed: 18, fuse: 1.2, radius: 4.5, knockback: 0.95, inflation: 0.06 },
    inflatableWall: { cooldown: 14, throwSpeed: 13, lifetime: 6, width: 4.5, height: 3, thickness: 0.6, raftLifetime: 3.5, raftSize: 3.6 },
    vacuumGrenade: { cooldown: 12, throwSpeed: 18, fuse: 1.0, radius: 7, duration: 1.3, pull: 24 },
    /**
     * Air Mine: a small trap that sticks where it lands, arms after `armTime`, and blasts the first
     * enemy within `trigger` meters up and out (everyone within `radius` gets caught). One per player.
     */
    airMine: { cooldown: 11, throwSpeed: 12, armTime: 1, trigger: 1.8, radius: 3.4, knockback: 1.0, inflation: 0.08, lift: 0.8, lifetime: 30 },
    /**
     * Helium Bomb: bursts into a helium cloud; enemies caught in it float up at `rise` m/s instead of
     * falling for `float` seconds and take `knockbackMult` times the knockback while floating.
     */
    heliumBomb: { cooldown: 12, throwSpeed: 18, fuse: 1.0, radius: 5, cloudTime: 1.2, float: 3, rise: 2.4, buoyancy: 2.2, airControl: 0.4, knockbackMult: 1.25, popUp: 5 },
    /**
     * Tornado: a spinning wind column that travels forward at `speed` for `duration` seconds.
     * Enemies within `radius` get whirled around it at `spin` m/s (more when inflated) and lifted
     * (up to `lift` m/s) for at most `holdMax` seconds, then flung out. A dash breaks free.
     */
    tornado: { cooldown: 15, speed: 5.5, duration: 4, radius: 3.2, height: 7, spin: 9, spinInflation: 0.6, grip: 6, holdMax: 1.6, lift: 7, liftAccel: 44, inflation: 0.03 },
    /** Thrown utilities fall with this gravity. */
    gravity: 22,
  },

  /**
   * Floor loot: supply crates that drift down under a balloon at random walkable spots. Touching
   * one grabs it for a random instant effect (weights below; some are skipped when useless).
   */
  loot: {
    firstDrop: 20,
    intervalMin: 15,
    intervalMax: 25,
    maxCrates: 3,
    /** Crates start this high above where they'll land and sink at `fallSpeed` m/s. */
    dropHeight: 22,
    fallSpeed: 3.4,
    /** Seconds a crate waits on the ground before it floats away. */
    lifetime: 25,
    /** Grab reach (added to the player's radius). */
    radius: 0.9,
    /** Crates never land closer than this to each other. */
    spacing: 7,
    weights: { deflate: 20, mega: 16, turbo: 16, gadgets: 16, feather: 16, spring: 16 },
    /** Deflate: inflation drops by this much (0.4 = 40 points). */
    deflate: 0.4,
    megaShots: 2,
    turboSeconds: 8,
    /** Feather: low gravity and a slow, floaty fall for you alone. */
    featherSeconds: 6,
    featherGravity: 0.38,
    featherMaxFall: 7,
    /** Spring Shoes: your next few ground jumps launch you much higher. */
    springJumps: 3,
    springJumpMult: 1.65,
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
    range: 34,
    cooldown: 3.5,
    /**
     * No grappling in the air right after a hit: `hitLock` seconds, plus `hitLockPerInflation`
     * times inflation squared (0.6 s at 50%, 1.6 s at 100%): a full balloon hit hard can't zip
     * straight back.
     */
    hitLock: 0.3,
    hitLockPerInflation: 1.3,
    /** A full balloon is heavy on the rope: range and zip speed at 100% inflation, as fractions. */
    rangeAtMax: 0.5,
    zipAtMax: 0.7,
    missCooldown: 0.7,
    /** Extra radius around bodies so trackpad players can land grapples. */
    aimForgiveness: 0.7,
    pullSpeed: 19,
    pullUp: 5.5,
    pullHitstun: 0.45,
    zipSpeed: 33,
    zipMaxTime: 0.9,
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

  /**
   * Ultimate abilities (see game/ults.ts): a meter that fills as you play, then one big move picked
   * in the loadout. Each should be worth about 0-2 knockouts in a busy fight, never an instant win.
   */
  ults: {
    /**
     * The meter (0..1). Fighting fills it: landing hits is the main source, knockouts and assists
     * are big chunks, taking hits helps a little, and it trickles in over time so nobody is ever
     * stuck. Ball goals and pumping count in those modes. It's kept when you're knocked out, and
     * earned charge is scaled by `catchUp` so it helps whoever is behind rather than snowballing.
     */
    meter: {
      /** Fill per second while alive (a full meter in a minute and a half on its own). */
      perSecond: 1 / 90,
      /** Fill per 100% of inflation you pump into enemies (shots, streams, throws, chains). */
      perInflation: 0.45,
      /** A knockout. */
      perKo: 0.25,
      /** You hit someone in the last `assistWindow` seconds and a teammate (or anyone) knocked them out. */
      perAssist: 0.12,
      assistWindow: 5,
      /** Fill per 100% of inflation you take: a little help when you're the one getting blasted. */
      perInflationTaken: 0.18,
      /** Ball: scoring a goal. Pump: per second standing on your pump. */
      perGoal: 0.35,
      perPumpSecond: 1 / 60,
      /**
       * Catch-up on earned charge (not the trickle): behind (a team trailing by `teamGap`, or a
       * player well off the lead) charges faster; a clear leader charges slower.
       */
      catchUp: { behind: 1.3, ahead: 0.75, teamGap: 2, pumpGap: 0.12, soloGap: 3 },
      /** A 1v1 has one target to hit, so fighting charges faster there. */
      duelMult: 1.4,
    },
    /** Big Blow: the next trigger pull fires one giant air blast at full power, with any weapon. */
    bigBlow: { projSpeed: 58, radius: 1.35, lifetime: 0.95, blastRadius: 5.4, knockback: 1.9, inflation: 0.24, fireCooldown: 0.5 },
    /** Juice: jacked for a while. Faster, harder-hitting shots and throws (you take normal knockback). */
    juice: { duration: 14, massMult: 1, powerMult: 1.3, speedMult: 1.15 },
    /**
     * While you're turned into the character your hitbox grows with the bigger body (radius and
     * height multipliers). Hits on you still do exactly what they'd do without the ult.
     */
    transformHitbox: { radius: 1.45, height: 1.7 },
    /**
     * The Chase: lock on to the nearest enemy (in front if anyone is) and hunt them. Faster, dashes
     * recharge 3x faster, shots curve toward the target and grabbing them throws extra hard.
     */
    chase: {
      duration: 6,
      speedMult: 1.4,
      /** Picks someone at random within this range (anyone on the map if nobody's this close). */
      range: 45,
      /** Touching the target hugs them (a grab) automatically: extra reach beyond a normal grab. */
      hugReach: 0.6,
      /** Seconds before he can hug again after they wriggle free. */
      hugRetry: 1.2,
      /** Half-angle (radians) counted as "in front" when picking who to sniff out. */
      frontCone: 0.8,
      /** How fast shots turn toward the target (radians per second). */
      homingTurn: 2.6,
      /** Cone and hitscan shots bend toward the target by up to this much (radians). */
      aimBend: 0.2,
      throwMult: 1.7,
      /** Dashes recharge this many times faster on the hunt. */
      dashRecharge: 3,
      /** Seconds between tries to sniff out a new target after losing one. */
      resniff: 0.5,
    },
    /** Crop Duster: bend over, then a huge fart: a green shockwave plus a cloud that inflates and slows. */
    cropDuster: {
      /** Seconds bent over before it lets rip, and how long the pose lasts in all. */
      windup: 0.25,
      poseTime: 0.9,
      radius: 9,
      knockback: 1.6,
      inflation: 0.16,
      /** Strength at the edge of the shockwave relative to point-blank. */
      edge: 0.4,
      /** The fart jump: upward speed it gives you. */
      selfLaunch: 12,
      cloudTime: 5,
      cloudRadius: 6,
      /** Inflation per second while you stand in the cloud. */
      cloudInflation: 0.05,
      cloudSlow: 0.6,
    },
    /** Robot Mode: scan and lock on to up to 3 enemies in view, then a barrage of homing mini-rockets. */
    robot: {
      scanTime: 0.6,
      barrageTime: 1.5,
      rockets: 6,
      maxTargets: 3,
      range: 45,
      /** Half-angle (radians) of "in view" when locking on. */
      viewCone: 0.75,
      rocketSpeed: 30,
      rocketTurn: 5,
      rocketLifetime: 3,
      rocketRadius: 0.35,
      blastRadius: 2.2,
      knockback: 0.75,
      inflation: 0.08,
    },
    /**
     * Bæn Is Gay (Pride Parade): a rainbow burst launches everyone around you up and out, then for
     * `duration` you strut faster, leaving a rainbow road; enemies who step on it get bounced up.
     */
    pride: {
      duration: 8,
      speedMult: 1.25,
      burstRadius: 7.5,
      burstKnockback: 1.15,
      burstInflation: 0.1,
      /** How often a piece of road is laid, and how long each piece lasts. */
      roadEvery: 0.1,
      roadLife: 3,
      /** Reach of a piece of road (plus the victim's radius), and how hard it bounces them. */
      roadRadius: 1.1,
      bounce: 0.8,
      bounceInflation: 0.04,
      /** The same enemy can't be bounced by your road again sooner than this. */
      bounceCool: 1.1,
    },
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
    /** Knockout: first to this many knockouts wins (or the most when time runs out). */
    knockout: { target: 10 },
    /** Team Knockout: first team to this many knockouts wins. */
    teamKnockout: {
      target: 20,
      /** The team lobby (before each match): fewest players a side needs, and the countdown once everyone's ready. */
      minPerSide: 2,
      countdown: 5,
      /** Public rooms: once teams are valid and someone is ready, everyone counts as ready after this long (AFK guard). */
      autoReady: 30,
    },
    /** One life each, everyone at 100% inflation, last tube man standing wins. */
    suddenDeath: {
      /** Rounds: last one standing wins a round; the first to this many round wins takes the match. */
      roundsToWin: 3,
      /** Hard cap on a round; if it runs out, the survivors are ranked by knockouts that round, then hits. */
      durationSec: 100,
      /** People who join this soon after a round starts still play it; later ones watch until the next. */
      joinGrace: 3,
      spawnProtection: 3,
      /** Pause after a round is decided (the score shows) before the next one starts. */
      roundBreak: 4.5,
      /** Pause after the last round before the results, so everyone sees the winner. */
      winnerDelay: 3,
      /** Rounds are short, so the results screen (replay included) is too. */
      resultsSec: 18,
      /**
       * The map keeps shrinking to force a finish. `at` is seconds into the match; `sink` lists the
       * collapse orders that start sinking; `deck` is how much of the main deck's half-size has
       * crumbled away per side once the stage is done (over `deckTime` seconds).
       */
      stages: [
        { at: 25, sink: [3], deck: 0 },
        { at: 40, sink: [2], deck: 0 },
        { at: 55, sink: [1], deck: 0.15 },
        { at: 70, sink: [], deck: 0.3 },
        { at: 85, sink: [], deck: 0.45 },
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


