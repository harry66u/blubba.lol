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
  - **Air Horn**: close-range cone blast with a HONK and recoil you can use to recover.
  - **Pump Rifle**: long-range, lag-compensated hitscan with a tiny hitbox and extra inflation.
- Mods (up to two, each a trade-off): Wide Nozzle, Big Tank, Charge Valve, Quick Valve, Long
  Barrel. Charge/Quick Valve and Wide Nozzle/Long Barrel are mutually exclusive.
- Utilities (pick two, C and V): Bounce Pad, Air Grenade, Inflatable Wall (becomes a raft under
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
  landing bounces you, trampoline islands outside the gaps), **Beach Blast** (Ball pitch with
  goals, nets, and umbrellas), and **Pump Station** (two bases, a contested middle island, and
  giant tube men on pedestals that grow as their team pumps).
- Public knockout rooms rotate maps between matches. Hosts pick mode, map, length, bots, and
  event frequency; Ball and Pump always use their own arenas.
- Bots play every mode: half of each Ball team plays the ball (gets behind it and shoots toward
  the goal), the rest fight; in Pump most bots hold their own pumps and one contests the enemy's.
- `scripts/mode-soak.ts` plays a bot match of every mode and map and prints how it went;
  `scripts/smoke-modes.mjs` and `scripts/smoke-host.mjs` check the modes, challenge links, and
  host controls in a real browser.

