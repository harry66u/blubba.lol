# Build progress

Phases follow spec §14. Each phase is committed separately and playable on its own.

## Phase 1: Core loop ✅

- Movement: walk, jump, double jump, air dash (two charges on a cooldown), ground dash into a
  slide, momentum carried through dashes, slides, and jumps.
- Air Cannon: hold to charge, tap vs. charged power, 5-shot magazine, reload.
- Inflation and launches: size, lightness, and launch distance grow with inflation; knockouts only
  by leaving the map; deflating-balloon knockout effect; respawn fully deflated.
- Map: Sky Motors, a car lot floating in the sky with islands, bounce pads, a moving flatbed and
  an elevator.
- Knockout mode: free-for-all, timer, scoreboard (Tab), kill feed, end-of-match results.
- Rooms: quick play into public rooms, private rooms with 5-letter codes and share links
  (`/r/CODE`), host kick, host match length and bot toggle.
- Guest play with generated safe names; username filter.
- Keyboard + trackpad/mouse controls with pointer lock; leave-page warning during matches.
- Server-authoritative netcode with client prediction and interpolation.

## Phase 2: Skill layer ✅

- Launch angles from the impact point (feet = up, side = sideways), plus air steering while launched.
- Brace (Q): 0.28 s window, 1.3 s cooldown, cuts knockback to 40% and inflation to 50%; a
  successful brace refunds half the cooldown. Blue flash + clang + "BRACED!".
- Ledge grabs (F, tap or hold while falling), climb (W), ledge jump (Space), let go (S). Landing on
  or pressing F next to a hanging player's hands stomps them off.
- Grabs (F near an enemy): hold, then click to throw. The held player escapes with one dash pressed
  inside a 0.35-0.6 s window (an on-screen timing bar shows it). A mistimed press uses up the only
  attempt, so mashing never helps. Escaping costs a dash charge.
- Take-you-with-me: grabbing someone while falling off the map drags them down; the grabber gets
  the knockout.
- Grapple (E): pulls an enemy toward you (also yanks them off ledges) or zips you to a surface.
- Blast jumping (from Phase 1) and air combos with a combo counter callout for the attacker.
- Bots use braces, grapple recovery, grabs, timed escapes, throws toward edges, and stomps.
- Context hints for new players (falling, hanging, holding, launched, stomp opportunities).

## Phase 3: Loadouts ✅

- Weapons (all charge by holding fire; limited ammo and reloads):
  - **Air Cannon**: medium-range air blobs with splash.
  - **Leaf Blower**: continuous stream that spins up while held and shoves (and slowly inflates)
    everyone in it; its tank drains in seconds. Aim at the ground while airborne to hover.
  - **Air Blaster** (was Air Horn): close-range cone blast with recoil you can use to recover.
  - **Pump Rifle**: long-range, lag-compensated hitscan with a tiny hitbox and extra inflation.
- Mods (up to two, each a trade-off): Wide Nozzle, Big Tank, Charge Valve, Quick Valve, Long
  Barrel. Charge/Quick Valve and Wide Nozzle/Long Barrel are mutually exclusive.
- Utilities (pick two, C and G; V until the fix pass): Bounce Pad, Air Grenade, Inflatable Wall (becomes a raft under
  you when thrown while falling), Vacuum Grenade.
- Pickups: Soda Cans refill dash charges (with a burp); a rare Pin pops anyone at 100% inflation.
- Loadout screen from the main menu and pause menu; changes apply on your next respawn.
- Bots bring random loadouts and use utilities; `scripts/weapon-soak.ts` compares weapons.

## Phase 4: Chaos ✅

- Random events about once a minute (host can set Off/Rare/Normal/Frequent), announced 4 seconds
  ahead with a siren, big text, and the announcer, plus a countdown banner:
  - **Giant Fan**: a huge fan appears at one edge and blows everyone toward the other side.
  - **Low Gravity**: half gravity, with floating sparkles.
  - **Ice Rink**: the decks turn icy and slippery.
  - **Max Pressure**: everyone inflates to 100% for 8 seconds, then deflates back.
  Event effects on movement are shared code, so client prediction stays exact during events.
- Chain reactions: launched players knock back anyone they crash into; the original shooter gets
  credit for every knockout in the chain.
- Crown: the player on the longest streak (2+) wears a crown and glows gold; knocking them off
  is worth 3x.
- Revenge: whoever last knocked you out glows red with a ⚔️ on their tag; knocking them off is
  worth +1.
- Final 30 seconds: islands sink one after another, the main deck crumbles inward, and
  knockouts count double.
- Callouts: FIRST POP, DOUBLE/TRIPLE POP, CHAIN REACTION, CROWN SNATCHED, REVENGE, PINNED, with a
  hype announcer (browser speech synthesis) and kill-feed icons.

## Phase 5: Look and sound ✅

- Fall Guys-style look: glossy candy tube men with a soft rim light, six body patterns, clearcoat
  on High quality, soft shadows, bloom glow, calm map colors, landing circles, fart puff clouds.
- End-of-match slow-motion replay of the longest launch (recorded by the server, letterboxed,
  orbiting camera, skippable), followed by the podium and awards: longest launch, most
  knockouts, most chain knockouts, best air combo, popped the most.
- Procedural music on the music bus: calm menu loop, bouncy match loop, and a faster final-30
  version. No audio files to download.
- Full sound set (all synthesized): shots, blasts, squeaky hits, groin-shot groan, fart dashes
  with random pitch and a rare extra-long one, burps, deflating-balloon squeal, honks, rifle
  cracks, blower roar, grenade and vacuum sounds, soda cans, pin pops, siren, announcer.
- Instant-feeling load: an HTML splash paints before the script runs; the whole client is about
  200 KB gzipped.
- Performance: a full 10-player lobby leaves the main thread ~80% idle in profiling; quality
  presets plus automatic resolution scaling hold frame rate on slower GPUs.

## Phase 6: Controls ✅

- Xbox and PlayStation controllers through the Gamepad API with the spec's default layout
  (RT fire, LT grapple, A jump, B dash, RB brace, LB grab, X reload, Y / D-pad up utilities,
  D-pad down taunt, View scoreboard, Menu pause). PlayStation controllers show ✕ ○ □ △ / L1 R1
  labels in the same positions.
- Stick aiming with deadzones and a response curve; controller sensitivity, invert Y.
- Light aim assist for controllers only (adjustable 0-100%, or off): slows aim over an enemy and
  gently pulls toward them while you're moving. Never applies to mouse or trackpad.
- Play with only a controller: A starts, Menu pauses, B backs out of menus; no pointer lock needed.
- Full remapping: every keyboard/mouse action and every controller button can be rebound in
  Settings → Controls (a key can only do one thing; Command/Control can't be bound).
- On-screen hints switch between key names and controller button names automatically.
- Settings: separate trackpad, mouse, and controller sensitivity; invert Y; aim assist; FOV;
  graphics presets (Auto/High/Medium/Low); volume sliders and mute; colorblind team colors.

## Phase 7: Modes and maps ✅

- **Modes** (pick one on the main menu before PLAY, or as host in a private room):
  - **Knockout**: free-for-all, most knockout points wins.
  - **Team Knockout**: two teams, team knockout points win.
  - **Ball**: blast a giant beach ball into the other team's goal. First to 7 goals, or most
    goals at the end. Every weapon moves the ball: cannon shots and blasts knock it, the Air
    Horn and Pump Rifle smack it, the Leaf Blower dribbles it, grenades bump it, and running into
    it pushes it. A glass fence keeps it on the pitch (players pass through it).
  - **Pump**: stand on your team's two pumps to inflate your giant tube man (more teammates on a
    pump fill faster). Any enemy on a pump stops it; knock them off. First full giant wins, or
    the fuller one at the end.
  - **1v1**: first to 5 knockouts in 3 minutes. From the 1v1 queue on the main menu or a
    challenge link.
- **Teams**: automatic balancing (bots move first), no friendly fire from anything (shots,
  blasts, grabs, stomps, grapples, vacuum), team colors on bodies and name tags (▼ marks
  teammates), red/blue or colorblind-friendly orange/blue, team score strip under the clock,
  scoreboard grouped by team, team result on the podium screen. Public team rooms fill to 4v4
  with bots (5v5 with enough people).
- **1v1 challenge links**: "1v1 CHALLENGE" makes a private 1v1 room and copies a `/c/CODE` link.
  You warm up against a bot until the link is opened; the visitor clicks ACCEPT CHALLENGE, the bot
  leaves, and a fresh 1v1 starts. Rematches start automatically after the results screen.
- **1v1 queue**: quick play in 1v1 joins whoever is waiting (they're sparring with a bot) or
  starts a new wait.
- **Maps**: Sky Motors (dealership), **Top Floor** (rooftop parking garage at sunset with a
  lower deck, ramps, pillars, and a car lift), **Bounce Castle** (a giant inflatable castle: every
  landing bounces you, trampoline islands outside the gaps), **Sky Pier** (a plank boardwalk with
  snack stands and a lifeguard tower, a railless pier out to a ferris wheel that crumbles from its
  far end, a sand island, and two bouncy pool floats, one reached by a ferry raft), **Beach
  Blast** (Ball pitch with goals, nets, and umbrellas), and **Pump Station** (two bases, a
  contested middle island, and giant tube men on pedestals that grow as their team pumps).
- Public knockout rooms rotate maps between matches. Hosts pick mode, map, length, bots, and
  event frequency; Ball and Pump always use their own arenas.
- Bots play every mode: half of each Ball team plays the ball (gets behind it and shoots toward
  the goal), the rest fight; in Pump most bots hold their own pumps and one contests the enemy's.
- `scripts/mode-soak.ts` plays a bot match of every mode and map and prints how it went;
  `scripts/smoke-modes.mjs` and `scripts/smoke-host.mjs` check the modes, challenge links, and
  host controls in a real browser.

## Phase 8: Accounts and economy ✅

- **Guests keep progress.** Every browser gets a random guest id; XP, coins, unlocks and stats
  are saved on the server under it. **Optional accounts** are just a name and a password (no
  email, no personal info). Signing up adopts the guest's progress. Sign-up shows a one-time
  recovery code, which is the only way to reset a password. Guests can't use a registered name.
- **Progression:** XP from playing (a share of a full match, knockouts, goals, time pumping,
  wins) levels you up. **Mods and utilities unlock by level** (Wide Nozzle at 2, Inflatable
  Wall at 3, Quick Valve at 4, Vacuum Grenade at 5, Big Tank at 6, Charge Valve at 7, Long
  Barrel at 8); all weapons are available from the start. The server enforces locks.
- **Coins** come from playing (plus a first-win-of-the-day bonus and level-up bonuses). Idle
  players earn nothing: you need 45 seconds in the match and to have actually played.
- **Locker / store:** colors, patterns, faces, hats, weapon finishes, taunts, knockout effects
  (seen by the whole lobby) and sound packs, all at fixed listed prices. Live 3D preview; taunts
  and sound packs can be tried before buying. Buying needs an account. Nothing sold changes
  gameplay, and there are no random rewards.
- **Everyone sees your look:** cosmetics travel in the roster; bots dress up too. Every sound
  pack has an on-screen version (TA-DAA!, QUACK!, BZZ-BZZ!, ...), so it all works muted.
- **Stats and profile:** lifetime matches, wins, knockouts, times popped, falls, hits, chain
  knockouts, goals, longest launch, best air combo, time played, and wins per mode.
- **Results screen** shows XP and coins earned line by line, level progress, new unlocks, and
  (ranked) the rating change.
- **Ranked 1v1** (accounts only): matchmaking by rating with a window that widens while you
  wait, fixed lineups (no bots, nobody else can join), one match per queue, and leaving counts
  as a loss. Elo ratings with bigger swings for your first 10 games, six named tiers, and a
  top-20 leaderboard on the profile screen.
- **Quick chat** (no free text anywhere): hold Z (or D-pad right) for a wheel of 8 friendly
  presets, pick with the mouse / right stick or 1-8. Shown as a speech bubble and in a small
  feed. Rate limited on the server. Anyone can be muted from the scoreboard, and quick chat can
  be turned off in Settings.
- **Reports:** from the scoreboard (bad name, cheating, being mean, something else). Reports are
  stored for moderators (`npx tsx scripts/reports.ts`). If three different players report the
  same name, it's swapped for a random safe one on the spot (and an account is flagged).
- Persistence is SQLite through Node's built-in driver (no native modules): `BUBBA_DB` sets the
  file (default `data/bubba.db`; the Docker image uses a `/data` volume).
- `scripts/smoke-accounts.mjs` runs the whole flow in a real browser: guest locker, sign-up,
  buying, match rewards, quick chat, and a ranked match that ends in a forfeit.

## Fix pass (BUBBA_FIX_SPEC.md) ✅

Worked through the fix spec's §8 order. Each step is its own commit.

1. **Knockback and inflation (§4).** Launch speed now grows with inflation *cubed*
   (`base 7.6 + growth 16 × inflation³`), so the first hits stay modest and launches ramp up
   sharply past ~60%. From rest, full-charge Air Cannon hits travel about 2.4, 3.0, 4.4, 7.4,
   14, 29 and 67 m. A fresh player at the middle of Sky Motors goes off on about the 5th clean
   hit; near an edge at high inflation one hit sends them off. Near misses hit harder (splash
   0.65), air steering is weaker, and bots no longer recover perfectly. Every knob is in
   `src/shared/balance.ts` (`knockback`, `weapons.*.inflation`, `inflation`);
   `npx tsx scripts/knockback-sweep.ts` prints distances and hits-to-knockout for any setting.
   Above 60% inflation tube men wobble harder, shiver and pulse red faster as they near max; your
   own % pulses and the screen edges glow red; name tags pulse from 75%.
2. **Hit impact (§3).** Hit-stop lives in the shared simulation: the target freezes 45-90 ms
   (harder hits longer) and then the knockback plays out, identically on the server and in
   prediction. The shooter's screen shakes in proportion to the hit and their gun holds still for
   the same beat. Bigger star-burst muzzle flashes for every weapon; an impact burst (flash, ring,
   air puffs, confetti along the launch) on the target, who squashes and flashes white; a
   separate impact sound (thump + rubbery bwomp + slap).
3. **Chaos (§7a-b).** These already existed (Phase 4). `npx tsx scripts/chaos-report.ts` measures
   a normal 6-bot, 4-minute Knockout match at about 3-4 random events, ~13 chain-reaction hits,
   ~5 crown changes, ~4 crown and ~4 revenge knockouts, and the final-30 collapse every match.
   The first event now comes 15-30 s in, and chain hits get their own ring, callout and
   announcer line.
4. **Crown, revenge, callouts (§7c-d).** Already in (Phase 4); verified in the report above.
5. **Look (§1) and sound (§2).** Fixed inside-out tube geometry (it flattened all shading).
   Glossy vinyl material with reflections, clear coat and a rim light; rounder head that swells
   out of the tube, bigger face, shorter arms; more squash and stretch and an idle bounce;
   ambient occlusion (GTAO) on Medium and High; softer, lower-threshold bloom so players,
   balloons and event banners glow. `?lookdev` shows a lineup for judging it. Body sounds (fart,
   rare long fart, burp, groan, deflate squeal, squeak, hit impact) are now rendered from
   physical source-filter models into several sample variants each and played with random pitch;
   real recordings can replace any of them (see README, "Custom sounds").
6. **Third-person camera (§6).** V toggles an over-the-shoulder chase camera (controller:
   right-stick click); Utility 2 moved from V to G. The camera pulls in when walls or the floor
   are in the way, and your shot aims from your eye at whatever is under the reticle. The choice
   is saved in settings (also in Settings → Controls).
7. **Control hints (§5).** Every ability shows its current key or controller button on the HUD
   (dash, brace, grab, grapple, reload, camera, both utilities), and new players get one tooltip
   at a time for the things they haven't tried yet; progress is remembered.
8. **Utilities and final 30 (§7e-f).** Already in (Phases 3-4): Air Grenade, Bounce Pad,
   Inflatable Wall, Vacuum Grenade; the map collapses in the last 30 seconds and knockouts count
   double.

Checks: `npm test` (86 tests, including hit-stop, knockback targets, chase camera collision and
reticle aim, and sound model pitch/length checks), `node scripts/smoke-controls.mjs` (hints,
tooltips, third person, persistence), `node scripts/lookdev.mjs`.

## Playtest pass ✅

`scripts/playtest.mjs` plays a full Knockout match in a real browser: an autopilot drives your
character like a person would (turns at a human rate, leads shots, charges, strafes, avoids edges,
recovers, uses abilities and utilities, switches to third person and back) while every game event
is logged, then it runs out the clock to see the final 30 seconds, results and replay. What it
found, and what changed:

- **Shots were slow.** The Air Cannon shot flew at 36 m/s (0.4 s on average to reach a target,
  up to 1.2 s). It now flies at 75 m/s with the same ~49 m range, and draws as a stretched streak
  with a continuous trail.
- **Hits didn't move people enough.** The autopilot landed 31 hits for 1 knockout. Most real
  shots are partial charges, and launch distance grows with the square of shot power. Quick
  taps now carry 50% power (was 35%), full charge takes 0.6 s (was 0.75 s), and base knockback
  is 9 (was 7.6). Early hits travel about a third further (3.2, 4.1, 5.7, 9.1 m); a full-charge
  fight still takes 5 hits from the middle (4 toward the short edge), and a typical fight (random
  charge, mixed angles) takes about 5.8 landed hits per knockout instead of 7
  (`npx tsx scripts/knockback-sweep.ts` prints both).
- **More impact on every shot.** Firing kicks the view up and punches the field of view, with a
  deeper, sharper shot sound. Your hit confirmation (marker, crunch, shake, gun freeze) now plays
  the moment the server confirms it instead of after the interpolation delay; markers and sounds
  scale with how hard the hit was. Hit-stop is longer (60-120 ms), impact bursts are bigger with
  a colored flash and speed streaks, and getting hit hard flashes your screen.
- **Hit popup showed the wrong number.** It printed the target's total inflation with a "+" (so
  "+99%" on someone at 99%). It now shows their new total, colored green to red.
- **Your own dash cloud covered the screen** in first person. Particles that drift right up to
  the camera now shrink away.
- **1v1s could stall at 0-0.** Falling off on your own gave your rival nothing. In 1v1 it now
  scores for them (kill feed: "X fell off · Y +1").
- **The replay's Skip button couldn't be clicked.** The mouse stayed pointer-locked (hidden, and
  every click went to the game) after a match ended, so Skip and the results screen needed Esc
  first. The match end now releases the mouse; the next match's "click to play" takes it back.
- **Replay camera** hides bystanders that end up right against the lens.
- **Small windows:** the kill feed moves below the clock and the first-use tooltip gets compact
  instead of covering the middle of the screen.
- Second run with everything above: shots reach targets in 0.23 s on average (was 0.42 s),
  accuracy 45% (was 34%), 6.4 landed hits per knockout (was 31), and the autopilot finished
  first with 10 knockouts.
- Checked and fine: random events (Max Pressure, Giant Fan), chain reactions, crown, callouts,
  final 30 seconds, results and replay, third person in a real fight, control hints and tooltips,
  no console errors. The many prediction corrections in the log come from the headless software
  renderer running at 2-7 fps (the client can't simulate 60 steps a second there).

## Beat-Shell-Shockers pass (docs/PLAN.md)

A run-through as a brand-new player (desktop and phone) found the gaps; `docs/PLAN.md` has the
plan. Built so far:

- **The honk is gone.** The Air Horn is now the **Air Blaster**: same weapon, but a deep air
  FWOOMP instead of a horn.
- **Phones and tablets can play.** Touch devices get on-screen controls: a floating move stick
  where the left thumb lands, drag anywhere on the right to aim, a fire button that fills as it
  charges (and aims while held), jump, dash, brace, grab, grapple, reload, both gadgets, camera,
  taunt, quick chat (tap a preset), scoreboard and pause, all with cooldown rings. PLAY goes
  straight into the match (fullscreen and landscape where allowed; a "turn your phone sideways"
  screen in portrait). The HUD moves out from under the thumbs, menus fit phone screens either
  way up, aim assist helps touch aiming, and there's a Touch aim sensitivity setting.
- **Runs on school laptops.** Weak and software GPUs (older Intel chips common in Chromebooks,
  low-end Mali/PowerVR/Adreno) start on Low, and on Auto a machine that stays slow at the lowest
  resolution steps down a quality level by itself.
- **Streak rewards.** 3 pops in one life: **Turbo Tank** (full ammo and dashes, double-speed
  reloads and fire rate for 12 s). 5 pops: **Mega Blast** (next 3 shots at full charge, harder,
  bigger, wider). 8 pops: both. Everyone sees a callout or kill-feed line and a flickering
  orange-gold glow with sparks; a HUD badge shows what's left. In 6-bot matches Turbo Tank
  happens 3-4 times a match and Mega Blast about every other match.
- **Daily challenges and a play streak** (below) and **Sky Pier**, a fourth free-for-all map
  (listed under Phase 7's maps).
- **Fuller rooms:** public free-for-all rooms fill to 6 players with bots (was 4).
- **Less clutter:** other players' flavor popups are skipped when the screen is busy or the same
  word is already showing nearby.
- Tools: `scripts/playtest-touch.mjs` plays a match on an emulated phone using only touch input.

## Daily challenges and streak ✅

- **Three daily challenges** per player, new every UTC day, from a pool of 13: pop players, land
  hits, play matches, win, grab-and-throw, a long launch, an air combo, a chain-reaction pop,
  popping the crown holder, and one-per-day mode challenges (a Ball goal, time on a Pump, a Team
  Knockout win, pops in 1v1). Progress adds up across the day's matches; each pays coins and XP
  once, shown as a "Daily: ... ✓" line on the results screen.
- **Daily streak:** the first counted match each day pays a bonus that grows with the streak
  (10 coins per day, up to 70); miss a day and it starts over.
- **Main menu card** beside the play panel: the three challenges with progress bars and rewards,
  the streak, a nudge to keep it going, and the time until new challenges. On narrow screens it
  sits under the panel, folded to one line. The results screen shows all three challenges'
  progress after every match that counted.
- Saved in the profile (`daily`); older profiles pick it up with empty defaults. A new
  `crownKos` match stat tracks knockouts of the crown wearer.

## Review pass: hit feel, accounts that last, launch hardening

Players asked for more dopamine on hits, more feeling when hit, "cracked" knockouts, stronger
quick shots, a weaker dash, and to see damage the moment it lands. Built:

- **Your hits show +X% on the body you hit**, the target's size and name tag update at once (no
  waiting for the next snapshot), and a running tally under the crosshair stacks every hit in a
  row ("+42% · 3 HITS") with a bell that climbs two semitones per hit. The marker turns red on
  targets near bursting.
- **Getting hit:** the view snaps away from the blow (pitch and roll toward the push), the field
  of view punches out, the screen flashes pink-red, the inflation you took flies off your meter
  as "+X%", and speed lines streak in while you're launched.
- **Knockouts read popped, cracked, deflated, bonked, launched or yeeted** (chain-popped, pinned
  and yeeted when they fit), on the kill feed, callouts and "Cracked by X!" respawn screen. Your
  long-range pops (26 m+) are **CRACKED SHOT!**, air-juggle pops **JUGGLED!**, and every pop of
  yours gets confetti, a gold flash and "CRACKED! +1" under the crosshair.
- **Quick taps inflate more:** a shot adds `power + (1 - power) × 0.5` of its weapon's inflation,
  so an Air Cannon tap adds 75% of a full charge's (was 50%). Charging mostly buys launch power.
  Typical fights take about 6.2 landed hits per knockout.
- **Dash nerf:** 16.5 m/s (was 19), 3.2 s recharge (was 2.4), weaker air lift, and dashing out
  of a launch now steers it (keeps 60% of the launch, 70% dash strength, then 0.9 s before
  another dash) instead of cancelling it.
- **Sky scenery** on every map: hot air balloons, a BLUBBA blimp, flocks of birds, a banner
  plane, and floating islands around and far below the arena (fewer on Low).

Launch hardening, now that real players are showing up:

- **Accounts survive restarts.** Render's free plan wipes the disk on every restart and deploy.
  With `DATABASE_URL` set to a Postgres database, the server loads everything from it at startup
  and copies every change back within about a second (README, "Keeping accounts").
  `/api/health` shows `"storage":"postgres"`. Verified in a browser: sign up, earn coins, wipe
  the server's disk, restart, and the old login still works and a fresh browser logs in to the
  same coins and level. The full account smoke test (guest, sign-up with recovery code, buying,
  rewards, ranked 1v1) passes on Postgres.
- **Auto-reconnect:** a dropped connection or a server update mid-match shows "Blubba is
  updating!" and puts you back into a match (about 11 s after a restart in tests) instead of
  dumping you on the menu.
- **Crash guards:** a bad message or stray exception is logged instead of taking every match
  down; a room that keeps failing is closed and its players reconnect to a fresh one.
- **Browser errors reach the server log** (`[client] ...` lines, rate limited), so problems
  players hit are visible in the host's logs.
- The leaderboard is cached for 30 s instead of reading every account on each request.
