# Decisions

The spec leaves the tech stack and many details open. This file records what was chosen and why.

## Tech stack

| Area | Choice | Why |
|---|---|---|
| Language | TypeScript everywhere | One language for server, client, and the shared simulation. |
| Client rendering | Three.js (WebGL2) | Mature, small enough (~150 KB gzipped), runs well on Apple Silicon in Chrome and Safari. |
| Client build | Vite | Fast builds, hashed assets that the server caches forever. |
| UI | Plain DOM + CSS (no framework) | Menus are simple; per-frame HUD values are written straight to DOM nodes. Keeps the bundle small. |
| Server | Node.js + `ws` | Long-lived WebSockets, simple deployment, shares the simulation code with the client. |
| Physics | Custom axis-aligned box world | Deterministic and identical on server and client, which prediction needs. A general physics engine would be heavier and harder to keep in sync. |
| Audio | Procedural Web Audio synthesis | No audio files to download, so the game starts instantly. |
| Tests | Vitest + a Playwright smoke script | Balance, filter, protocol, and server tests run in about two seconds. |
| Hosting | Any Node host with WebSockets (Dockerfile included) | Serverless platforms without persistent sockets cannot run the game server. |

## Networking

- **Authoritative server at 60 Hz**, snapshots at 30 Hz. The server decides every hit and launch.
- **Inputs are one frame per 1/60 s** with wrapping 8-bit *press counters* for one-shot actions
  (jump, dash, brace, ...). A dropped or merged frame can never lose a press, and holding or
  mashing a key can't generate more than one press per key-down.
- **Client prediction + reconciliation** for your own movement and weapon; **interpolation** (about
  70-120 ms behind, adapted to jitter) for everyone else.
- **Lag tolerance:** if a client's inputs stop arriving, the server keeps simulating with its last
  held input after 6 ticks so nobody can freeze in mid-air by lagging.
- **Your own shots** are drawn immediately from the client and linked to the server's projectile by
  input sequence number; the server's explosion is authoritative.
- Snapshots are binary (about 35 bytes per player); events and roster updates are small JSON
  messages. A full 10-player room uses roughly 15-20 KB/s per client.

## Gameplay interpretations

- **Inflation** is 0-100%. Every clean hit adds 14%. Size grows up to 1.75x and mass drops to
  0.5x at 100%, so launches get much longer as you fill up.
- **"Clean hit"** = a fully charged, direct Air Cannon hit to the body. The balance test pushes a
  fresh player from the middle of the map toward the long and the short edge; both take five clean
  hits to knock out (`tests/balance.test.ts`, `scripts/balance-report.ts`).
- **Launch direction** comes from the impact point through the body's center, bent 40% toward the
  shot's travel direction, with a minimum upward angle so every hit lifts the target. A shot at the
  feet launches mostly upward; a shot to the side launches sideways.
- **Near misses** use the same rule from the blast center with 55% power at point blank falling
  off to 30% at the edge of the radius.
- **Charged shots vs. tapping:** a tap fires at 35% power. Tapping burns ammo three times faster and
  its small pushes are soaked up by ground friction, so charging wins.
- **Blast jumping** uses a fixed launch speed that ignores your inflation, so it's consistent and
  learnable, and never inflates you.
- **Knockout credit** goes to whoever last hit you within 8 seconds. Falling off with no recent hit
  is a self-knockout and scores for nobody.
- **Spawn protection:** 2 seconds of immunity, canceled when you fire. Players spawn facing the
  middle of the map at the spawn point farthest from other players.
- **Groin shots** are direct hits on the bottom third of the body. They play a groan, show an "OOF!"
  popup, and double the target over (slowed, can't shoot) for half a second.
- **Wall and floor bounces:** launched players bounce off walls and floors like rubber, which adds
  chaos without adding randomness to combat.
- **Bots** fill public rooms up to four players so a lone player always has someone to blast. They
  are clearly tagged BOT, spread their attention across targets, pause between shots, and come in
  mixed skill levels. Private room hosts can turn them off.
- **Tube man arms** flail constantly but are visual only; hitboxes are a capsule around the body.
- **Grab escapes** are judged on the held player's own input timeline (the server compares the
  dash press against the grab timer carried in that player's state), so high-ping players see a fair
  window. The grabber can't throw until the escape window has closed, so a skilled defender with a
  dash charge always escapes; the price is the dash they may need to recover later.
- **Take-you-with-me** reuses the grab: a grab started while falling with no ground below keeps
  holding for up to 3 seconds instead of auto-throwing, and the held player can still break free
  with a well-timed dash.
- **Ledges** can be caught by tapping grab up to 0.2 s early or by holding it, so catching a ledge
  is about positioning, not frame-perfect timing.
- **Loadout changes apply on respawn**, so nobody swaps weapons mid-fight.
- **Pump Rifle lag compensation:** each input carries the server tick the player was looking at,
  and the server rewinds other players (up to 40 ticks) to check the shot. It's the only
  hitscan weapon; the others are forgiving blasts where lag compensation isn't needed.
- **Leaf Blower** pushes are continuous acceleration (scaled by the target's inflation and mass)
  and make the target skid instead of gripping the ground; it counts as a hit for knockout credit.
- **The Pin** lasts 20 seconds or one pop. It appears every 70-110 seconds at a pickup spot, and
  everyone is told when it spawns and who grabbed it.
- **Utilities** are thrown with a lob; pads and walls deploy where they land, grenades bounce and
  go off after a fuse or on contact with a player. Walls and rafts are real solids mirrored to
  every client so movement prediction stays exact.
- **Random events are scheduled by the server in ticks** and sent when announced, so the start
  and end line up exactly on every client. Movement effects (gravity, friction, wind) come from
  one shared `envAt()` function used by both the server and client prediction.
- **Max Pressure** restores everyone's previous inflation when it ends, so it's a burst of chaos
  rather than a permanent reset of the match.
- **Chain reactions** trigger when a launched player moving faster than 11 m/s overlaps someone.
  The same pair can't chain again for 0.6 s (no ping-pong), and credit goes to whoever launched
  the first player.
- **Scoring:** 1 point per knockout, x3 for the crown wearer, x2 in the final 30 seconds, +1 for
  revenge. Self-knockouts score nothing.
- **Final collapse** is deterministic from the match end time: islands sink with constant
  acceleration in order, and the main deck shrinks 30% per side over the last 10 seconds.
  Scenery and bounce pads standing on a sinking piece go down with it.
- **Announcer** uses the browser's speech synthesis (no downloads) at the announcer volume; every
  line is also shown as on-screen text.
- **Grapple** targets players first (with a 0.5 m aim forgiveness for trackpads), then surfaces.

## Modes (Phase 7)

- **Team sizes:** public team rooms fill to 8 players (4v4) with bots; a ninth human gets a
  bot partner for an even 5v5. Humans are only moved between teams when bots can't even things
  out, and a moved player respawns on their new side.
- **Team Knockout scoring** uses the same knockout points as Knockout (crown, final-30, revenge
  multipliers included), summed per team.
- **Ball:** knockouts score no points (goals do), but they still matter for space. First to 7
  goals ends the match early; otherwise most goals at the buzzer. Own goals count for the other
  team and give the scorer nothing. The ball resets to the center 3 s after a goal or leaving the
  arena. The ball never pushes players, so it never affects movement prediction.
- **Pump:** fill rate is 0.45%/s per pump with one teammate, +35% per extra teammate on the same
  pump; any enemy on a pump stops it entirely ("contested"). Two pumps each, one at home and one
  on the middle island, so holding the middle is how you win. First to 100% or fullest at the end.
- **1v1:** first to 5 knockouts or best score after 3 minutes. Challenge links are private 1v1
  rooms at `/c/CODE` (normal private rooms stay at `/r/CODE`). The challenger spars with a bot
  until someone opens the link; when the second human arrives the bot leaves and the match
  restarts from 0-0. The 1v1 queue is public 1v1 rooms: the next person to queue joins whoever
  is waiting.
- **Map rotation:** public knockout-style rooms move to the next knockout map when
  the results screen ends. The server keeps its tick counter across the swap so client clocks
  and prediction don't glitch.
- **Colorblind-friendly team colors** swap red/blue for orange/blue (Settings → Graphics); the
  pumps, giants, name tags, score strip and scoreboard all follow the setting.

## Accounts and economy (Phase 8)

- **No personal information.** Most players are under 18, so accounts are a name and a
  password only. No email means no email recovery: sign-up shows a one-time recovery code
  instead (hashed on the server like the password, replaced whenever it's used).
- **Passwords** are hashed with scrypt (salted); sessions are random 256-bit tokens stored only
  as SHA-256 hashes, valid for 90 days, and all of them end when a password is reset. Login and
  sign-up are rate limited per IP and take the same time whether or not the name exists.
- **Guest progress** lives on the server keyed by the browser's random guest id (the id acts as
  the guest's credential). Guest profiles nobody has touched for 120 days are pruned.
- **Storage:** SQLite via `node:sqlite` (built into Node 22.5+), so there's nothing to compile
  and the whole thing is still one process. Profiles are cached in memory and written at match
  end and on purchases.
- **Coins are earned, not bought.** The spec requires a direct-price store with no loot boxes;
  this build prices everything in coins earned by playing. Real-money purchases would need a
  payment provider and parental-consent handling for minors, so they're left out; the store's
  fixed-price design would take a paid currency later without changing anything else.
- **Pacing:** a full 4-minute match is worth roughly 60-170 XP and 10-40 coins. Level 8 (every
  unlock) takes about a dozen matches; items cost 100-450 coins (a few matches each).
- **Anti-farming:** nothing is earned without 45 seconds in the match and some activity (a shot,
  a hit, a goal, or time on a pump); knockout rewards cap at 15 per match.
- **Daily challenges** (`src/shared/daily.ts`): three a day from a pool of 13, each measured from
  a single match's stats and building up over the day. They're picked from a hash of the UTC day
  and the profile key, so reloading never rerolls them; no repeats, and at most one is tied to a
  mode so nobody has to play three playlists in a day. Each pays 25-50 coins plus XP (about one
  or two matches' worth), so a full day's set is roughly 120-150 coins. Only matches that earn
  rewards count, and each challenge pays once.
- **Daily streak:** consecutive UTC days with a counted match. The day's first counted match pays
  10 coins × the streak (capped at 7 days, 70 coins); missing a day starts over at 1. Days roll
  over at midnight UTC for everyone, so a school's players all see the same reset time.
- **Ranked is 1v1** because it's the cleanest measure of skill and needs only two people online.
  Elo with K=40 for the first 10 games and K=24 after; draws don't change ratings; leaving
  mid-match is a loss. Matchmaking starts within ±100 rating and widens by 15 per second, then
  accepts anyone after 45 seconds (school-sized player counts). One match per queue so friends
  can't farm each other with rematches.
- **Quick chat only.** Eight fixed presets; the server only relays a preset number, never text.
  Max one message per 1.2 s and 4 per 10 s.
- **Reports** are one per target per reporter per room (max 5), stored with room and reason.
  Three distinct players reporting a name renames that player immediately; the account (if
  any) is flagged for review.
- **Cosmetics never touch the simulation.** They ride along in the roster and are drawn by the
  client; the server only checks you own what you wear. Bots wear random items so every look
  shows up in public games.

## Sound-off versions of every audio joke

| Sound | Visual |
|---|---|
| Dash fart | Green puff cloud + "PFFT!" popup (a rare extra-long one says "PFFFFFFFRRRT!") |
| Burp | "BUURRP!" popup |
| Groin-shot groan | Target doubles over + "OOF!" popup |
| Deflating-balloon squeal | Spinning, shrinking balloon zipping into the sky + "WHEEEE!" |
| Squeaky hits | Hit popups, hit marker, and inflation % jumps |
| Sound packs (kazoo, duck, trumpet, slide whistle, boing) | "BZZ-BZZ!", "QUACK!", "TA-DAA!", "WHOOEEE!", "BOING!" popups on taunts and knockouts |
| Goal horn and crowd | Big GOAL! callout in the team color plus confetti |
| Brace clang | Metallic flash + "BRACED!" popup |

## Fix pass (BUBBA_FIX_SPEC.md)

- **Knockback curve.** Rather than a bigger flat multiplier (which makes early hits fling people
  too and shortens every life), knockback grows with inflation cubed. That keeps the "about five
  clean hits" target while making high inflation clearly lethal near an edge. The inflation cap
  stays at 100% with 15% per full Air Cannon hit.
- **Hit-stop is in the simulation, not just the renderer.** The target's velocity is stored and
  released after the freeze inside the shared movement step, so the server, the victim's
  prediction and everyone's interpolation agree. The *shooter* is not frozen in the simulation
  (that would steal control of your own character on every hit you land); instead their gun and
  screen get the beat: the weapon holds still for the same time and the camera shakes.
- **Chaos systems were already built.** The fix spec lists random events, chain reactions, crown,
  revenge, callouts, Air Grenade, Bounce Pad and the final-30 collapse as missing; they shipped in
  Phases 3-4. This pass measured them (`scripts/chaos-report.ts`) and made them easier to notice.
- **Sounds are modelled, with a drop-in for recordings.** The build has no licensed sound
  library to pull real recordings from, so each body sound is rendered from a physical model
  (a buzzing lip or glottal pulse train through body resonances, plus air noise) into several
  sample variants when audio starts, then played back at random pitch like a sample bank. Any of
  them can be replaced with real files via `src/client/public/sounds/manifest.json` without code
  changes.
- **Third-person aim.** The reticle stays centered and the character turns to face it. Because
  the camera sits over your shoulder, shots don't leave from the camera: each input frame casts
  the camera's center ray into the world, finds what it hits (map or player), and sends the
  yaw/pitch from your eye to that point, so the server needs no changes and shots land under the
  reticle. Movement stays relative to the camera. Looking up, the camera swings down only 30% as
  much as the view so it doesn't end up on the floor.
- **Key change:** the spec's original layout had Utility 2 on V; the fix spec asks for V as the
  camera toggle, so Utility 2 moved to G (still rebindable). Controllers toggle the camera with
  a right-stick click.
- **Control hints:** always-visible key labels next to each ability (they follow rebinding and
  switch to controller buttons), plus first-use tooltips shown one at a time, each until the
  action is used or it has been shown three times (stored in the browser).
- **Performance:** ambient occlusion and clear coat are on Medium and High only (AO renders at
  half resolution); Low keeps the old cheap path. Auto quality starts at Medium and lowers the
  render resolution when frames run slow; on a machine that still struggles, Low turns all of
  it off. Not yet measured on real laptop GPUs (the build environment only has a software
  renderer).

## Playtest pass

- **"More impact" is mostly feel, plus a knockback bump.** The "about five clean hits" target
  stays (5 from the middle, 4 toward the 20 m short edge). Within it, early hits push further,
  quick taps matter more, and every shot and hit got more feedback. The balance test for the short
  edge now accepts 4-6.
- **Your own hit confirmation skips the interpolation delay.** Other players are drawn about
  70-120 ms in the past, so hit events were waiting for that timeline. The marker, sound, shake
  and gun freeze now play as soon as the server's hit arrives; the burst on the target still
  plays where you see them.
- **View punch doesn't move your aim.** The camera kicks up and springs back in about a fifth of a
  second, but the shot direction comes from your aim, not the kicked camera.
- **1v1 self-falls score for the rival.** With only two players, a fall with no recent attacker
  has an obvious beneficiary; otherwise a duel can run out the clock at 0-0.

## Name

- The game is called **Blubba** (title, logo, menus and messages). Internal names keep "bubba"
  on purpose: browser save keys (`bubba.settings.v1`, the guest id, the login token), the
  `BUBBA_*` environment variables, the default database file, and the npm package name. Renaming
  those would reset everyone's settings and guest progress and break existing deploy configs.

## Beat-Shell-Shockers pass

- **Touch play reuses the controller path:** no pointer lock, input enabled whenever the pause
  menu is closed. Touch input merges into the same input frames as keyboard and controller, so
  the server and prediction need nothing new.
- **Aim by dragging, with the fire button as a second aim pad**, so one thumb can charge and aim
  at once; aim assist (slowdown and a gentle pull) is on for touch as on controllers.
- **Phones start on Low graphics** (heat and battery), as do GPUs matched by a list of weak and
  software renderers. Auto quality also steps down one level when frames stay above ~22 ms at the
  minimum render scale for two checks in a row.
- **Streak rewards are small, visible and temporary.** They reward a hot streak without making the
  streak holder untouchable (the crown already makes them worth triple). They are part of the
  shared player state (so prediction is exact) and clear when you're popped.


## Review pass

- **Tap shots inflate, charged shots launch.** Quick shots now add most of a weapon's inflation
  (`BALANCE.inflation.tapBonus`), so spraying builds damage and charging finishes; knockback
  still scales fully with charge.
- **Dashing out of a launch steers instead of cancelling.** The old dash erased most of a hit's
  momentum 0.18 s after it landed, which made good hits feel wasted. It still saves you from
  flying off if you react, but you keep most of the launch.
- **Instant feedback is client-side and cosmetic.** Your confirmed hit updates the target's
  displayed inflation right away (a short-lived hint that yields to snapshots), and the server's
  hit event carries `gain` so "+X%" is exact.
- **Postgres as a mirror, not a rewrite.** SQLite stays the working copy (synchronous, fast, the
  game code is unchanged); Postgres is loaded at startup and receives every change in ordered
  background batches. This keeps accounts on hosts with wiped disks without making every game
  path async. It assumes one server process per database, which is how Blubba runs.
- **Reconnect rejoins, it doesn't resume.** After a drop you land back in the same private room
  or a room of the same mode with your saved progress; the match state of your old body is not
  restored (the server may have restarted).

## Ult economy

- **You earn it by fighting.** Landing hits is the main source (per inflation you add), a
  knockout is a chunk (25%), an assist (you hit them within 5 s before someone else knocked them
  out) is 12%, taking hits gives a little (so the player getting farmed isn't left behind), and
  a slow trickle (a full meter in 90 s) means nobody is ever stuck. Ball goals (35%) and time on
  your pump count in those modes, so objective players aren't punished for not brawling.
- **Charge helps whoever is behind.** Earned charge (not the trickle) is multiplied by 1.3 for a
  team trailing by 2+ (or 12% of a pump), or a player 3+ knockouts off the lead; a clear leader
  gets 0.75. In the bot soak this keeps ult counts within a couple of each other across an
  8-player free-for-all and gives the trailing team more ults than the leading one.
- **Kept on knockout.** Dying never costs your ult: it's the losing player's way back into a
  fight. A new spawn still deals a new random character. The meter resets only at match start.
- **Readable at a glance.** The meter shows whose ult and how full ("ABAG 64%"), "+N%" floats off
  it as you earn (labelled KO / ASSIST / GOAL for the big ones), it pulses and chimes when full
  (the key to press glows in the ult's color), a one-time tip explains it at 50%, and enemies
  with a ready ult show a ⚡ on their name tag.
- **Inputs.** X on the keyboard (next to WASD), clicking the left stick on a controller (free,
  and your thumb is already there), the ULT button on touch; all remappable.
- **Target pace.** About one ult per player per minute of constant bot fighting (humans shoot
  less, so slower), the first around a minute in; each ult should be worth zero to two
  knockouts. `scripts/ult-soak.ts` prints these numbers per mode for balance passes.

## Screen clutter

A clutter audit (a scripted player fighting 1, 4 and 9 bots, sampling the screen and the sound
engine every second) found the screen busy mostly with things that weren't about you. The rule
since then: **your moments are loud, everyone else's are quiet, and the match's are loudest.**
Nothing was removed; only how and where things show changed.

- **Center callouts are yours.** Big center text is for things happening to you (your knockout,
  being grabbed, chased or locked on) and for what changes the match (final 30 seconds, the map
  shrinking, a goal, a round won). Other people's special knockouts (double pop, crown snatched)
  go to the feed; the announcer still calls the crown and multi-pops. Callouts have a priority
  (`CALLOUT` in `hud.ts`): a lesser one never replaces a bigger one that's still up, and they're
  drawn in three sizes.
- **Random events warn in the strip under the clock,** with a second line saying what to do
  ("Hold on to something!"), instead of a center callout repeating the banner.
- **Comic words about other players are "minor".** By default they only show within 20 m and two
  at a time; the screen holds at most six words (the oldest minor ones go first, your damage
  numbers last), and words shrink with distance. Settings → Graphics → "Comic words over players"
  offers Everyone / Mine + nearby / Only mine. Each ult name shows once (it used to show twice).
- **One flash at a time.** Screen flashes that land within 0.45 s of another are dropped unless
  they're longer (a bigger moment), getting hit makes one flash instead of two, and there's a
  Screen flashes slider (0 = none).
- **Your own shots barely shake the camera** (the gun kick and muzzle carry them); getting hit
  still does. A Screen shake slider scales every camera jolt (shake, kick, roll, FOV punch).
- **A sound budget for crowds.** The more other-player sounds started in the last quarter second,
  the louder a new one must be to play: a 10-player brawl keeps the sounds near you and drops the
  far clatter. Your own sounds always play.
- **Far bursts use fewer bits.** Particles spawned more than 28 m from the camera are thinned
  (down to 35% far away); close ones are unchanged.
- **The feed keeps yours.** Four lines at most; lines about you stay longer and are the last
  pushed out; a crop duster only adds a second line if it caught you.
- **Left alone on purpose:** name tags and inflation percentages (they're how you read a fight),
  your hit marker, damage numbers and hit tally, the ult meter and its "+N%" chips, first-use
  tips (they show once), and every effect's look.

## Team Knockout: Face-Off and the team lobby

- **Its own map.** Team Knockout plays on Face-Off in public rooms (and a private room switches to
  it when the host picks the mode; the host can still choose a knockout map). Two bases face each
  other across a moat, each with three ways out: two lane bridges (safe) and a narrow center
  plank (fast, easy to be knocked off), plus a launch pad over the moat for a quick push. The
  middle has a low hill worth holding, crates either side and hop-over walls in front of each
  base, with open edges north and south. Long flank walkways run along both sides, a jump from
  the middle, with pads out to two little islands. Everything is mirrored left to right (a test
  checks every piece, pad, can and spawn has its twin).
- **Readable sides.** Each base, its bridges and each half of the middle and the flanks are
  washed in the team's color (the renderer's `paint`, which follows the colorblind setting), with
  a white halfway line and center circle, team flags at the base fronts and team-colored tube
  men at the back.
- **Collapse.** The islands sink at half time; in the final 30 seconds the flanks and plank go,
  then the bases (players then come back in at the back of their own half of the middle), then
  the middle crumbles in.
- **The team lobby covers the map** before every Team Knockout match (public and private): both
  teams side by side, JOIN, READY, and for a private host SHUFFLE and LOCK. The match starts
  after a 5-second countdown once both teams have at least 2 players, differ by at most one, and
  every human is ready; anything changing stops the countdown. Bots count as ready. After the
  results everyone comes back to the lobby (PLAY AGAIN counts as ready), and the teams are dealt
  again (evenly, humans spread across both sides) unless the host locked them.
- **No bots unless asked.** Team Knockout quick play has its own Bots switch, off by default, and
  a private room switched to Team Knockout turns bots off until the host turns them on. With bots
  on they fill both teams evenly (only bots get moved to even things up in the lobby).
- **Idle players in public rooms.** A public room can't wait forever on one person: once the teams
  are fine and someone has readied up, everyone counts as ready after 30 seconds (the lobby shows
  the timer). Private rooms wait; the host can kick.

## Sudden Death is the main mode; PLAY is "Any mode"

- **Everyone who just presses PLAY plays together, real players only.** The menu starts on "Any
  mode" (for everyone, once: the remembered mode moved to a new storage key), which sends you to
  the busiest public Sudden Death room with space and no bots, on any map. There's no Bots switch
  for it. Picking a mode yourself still works as before (Sudden Death with Bots off lands in the
  same rooms).
- **Sudden Death** is listed first after Any mode. It already worked as "knocked out means you're
  out" (one life per round, first to 3 rounds); its menu text and callouts no longer say everyone
  starts fully inflated, which stopped being true a while ago.

## Projectiles are lag compensated

Other players are drawn a little in the past (interpolation, about 0.1 s) and your shot reaches
the server a little later still, so a projectile aimed dead on someone could miss by a meter
against where they really were. The Pump Rifle and Bubble Shotgun already checked hits against
where you saw people; projectiles (Air Cannon, Pop Gun, Balloon Mortar) now do too: each shot
remembers how far behind your screen was (up to 0.4 s) and its hit checks use players' positions
from that long ago; a hit lands on the target's body where it is now. Bots' shots aren't rewound.

## Grapple at 100%, and ABAG's hug

- **Full balloons are easier to knock out.** A hit that leaves someone at 100% launches 20% harder
  (`knockback.maxedMult`). The grapple no longer saves them every time: right after a hit you can't
  grapple in the air for `0.3 s + 1.3 s × inflation²` (0.6 s at 50%, 1.6 s at 100%), the rope's
  range and zip speed shrink as you inflate (half the range and 70% of the speed at 100%), and
  the cooldown is 3.5 s (was 3). In a scripted test (one charged Air Cannon hit toward the edge,
  a target that steers back and grapples the deck the moment it can), a player at 100% used to
  survive every hit with the grapple (0/24 knocked out); now 14/24 are knocked out (17/24
  without grappling). The grapple icon greys out while it's locked.
- **ABAG (The Chase) bags someone at random.** He picks a random enemy within 45 m (anyone on the
  map if nobody's close), everyone gets a "WARNING: ABAG IS TRYING TO BAG YOU!" callout (the
  target is told it's them), and touching the target hugs them automatically (a grab they can
  still wriggle out of with a dash in the green). The throw after is 1.7× as hard, as before.

## Burger drops, more billboards, fair ult dealing

- **Supply drops are burgers.** Same loot and timing, drawn as a burger on a ketchup-and-mustard
  parachute with Jo's face floating over it (his photo, used with his permission, drawn after the
  landing beam so it isn't washed out). The drop is announced "🍔 BURGER READY!" (a toast, and a
  word over where it's landing).
- **Two more billboards:** JO'S BURGERS ("BURGER READY.") and a rainbow BÆN IS GAY ("LOVE WINS."),
  with their photos. The ring of boards around each map went from 8 to 10.
- **Ults are dealt fairly.** Every playable ult is equally likely each spawn, and you never get the
  same one twice in a row (the other four stay equally likely, so over time each still comes up a
  fifth of the time).

## Queueing: everyone who picks a mode plays together

An audit of every way into a match found players who wanted to play together ending up apart:
12 players pressing PLAY with realistic menu settings landed in 10 rooms, 6 of them alone, because
quick play kept rooms apart by map pick and by the Bots switch. Team Knockout needed four humans
and had no way to start otherwise. So:

- **One pool per mode.** Quick play joins the busiest public room of the mode with space, whatever
  map or Bots switch you picked (between rooms just as busy, one on your map, then one matching your
  bots, goes first). A new room opens only when every room of the mode is full. Empty leftover
  rooms are never joined.
- **Map picks are votes.** A new room opens on your map; when a public room moves on after the
  results, it goes to the map most players there picked (two maps with a vote each take turns), or
  the next in the rotation when nobody picked one.
- **Bots are a vote.** In a public room bots fill the empty spots only while every player there
  has Bots on (the menu switch, and the same switch in the pause menu and the team lobby's
  "🤖 Fill with bots"). Switching them off never pulls bots out of a fight: they leave when the
  match ends (or right away in a lobby). "Any mode" always votes no. Joining by code or through a
  friend goes along with the room.
- **Quiet rooms merge.** Once a second, a public room with 3 or fewer players that's between
  matches (waiting for players, or the last moment of its results) moves everyone into a busier
  room of the same mode with space for all of them ("Found a match with N players!"). Its code
  keeps working as an invite link for half an hour.
- **Live counts.** `GET /api/counts` says how many people are in a match or waiting, per mode; the
  menu polls it every 8 s and shows a badge on each mode, a line under the picked one ("🟢 3
  playing now · 1 waiting for players"), and "N online" in the pill.
- **Team Knockout starts.** Public lobbies count everyone as ready 30 s after the teams are fine
  (it used to wait for someone to press READY first); a lone player can fill the seats with bots,
  which step aside as people join.
- **Friends.** Every match (public too) has an invite code and link in the pause menu and the team
  lobby. JOIN on the friends list follows a friend into wherever they are when you click (not a
  code from a few seconds ago). **Invite** (in a match) puts a JOIN card on the friend's menu for
  three minutes, and a toast if they're in a match.
- **Dropped connections come back to the same room**, joined the way you first joined; if the
  server restarted, the room opens again under the same code, so a group lands together again.
- **Fixed: a frozen results screen.** When a public room moved to its next map with one player
  left, the fresh match sat waiting without telling anyone, so the last player stayed on "Next
  match in 0" until they left. A rebuilt match now always announces itself.

## Mechanics audit fixes

Measured with scripted matches and bot soaks:

- **ABAG could fly.** On The Chase both dashes refilled every tick, and chaining air dashes kept him
  rising for the whole 6 s (+11.7 m, 88 m across). Dashes now recharge 3× faster instead.
- **Pop Gun corks never filled the ult meter** (or counted toward assists). They do now.
- **Reeling someone in with the grapple knocked you back** (they crashed into you as if launched,
  and got the credit). Pulled players can't chain-hit whoever pulled them.
- **Soda cans and pins hovered over the void** after their island sank, a pin as bait. Pickups go
  away with their floor and only respawn (or become the pin) where there's ground.
- **Grabs (and ABAG's hug) went through walls.** They need a clear line now.
- **A lag spike left a lasting input delay** (+33 to +50 ms until you died). Frames for ticks the
  server already filled in with your held input are dropped when they arrive.
- **A weak hit could rescue someone flying off the map** (a new hit kept only 15% of the old
  speed). A weaker hit on a launched player now adds to the launch; a hit during hit-stop no longer
  wipes the first hit's launch either.
- **Leaf Blower and Air Blaster** (the weakest weapons in duels) are now lag compensated like the
  Pump Rifle, and the Leaf Blower pushes a bit harder (26, was 22). Each blower gust counts as a hit
  (Sudden Death's time-up tiebreak).
- **Sudden Death's longer spawn protection** (3 s) was never used; it is now.

## Player experience audit fixes

- Replays play for about 7 s at most (long flights play faster), so the results screen isn't used
  up watching one launch.
- Sudden Death spectators see when they're back in ("back in next round, 1:12 at most"), "Round
  over! Next round in 3" during the break, and a big ROUND N callout when the next one starts; the
  "players left" pill hides during the break. The one-life banner waits for a round to start.
- Alone in a public room for 20 s: a callout says how to invite friends or vote for bots.
- The main menu scrolls on short windows (at 1366×657 the room-code row was off-screen), and
  buttons turn off kerning (Fredoka tucked the I of "PRIVATE" under the V).
- Controllers: the d-pad moves through menu buttons and A presses; on the results A is PLAY AGAIN
  and B is MENU; A or B skips the replay; "Press Ⓐ to play".
- The first "click to play" asks once whether you aim with a mouse or a trackpad (the default was
  trackpad, which turned 62% faster than mouse users expect).
- On a phone held upright, the pause button stays reachable above "turn your phone sideways".

## Bots and maps audit fixes

About 700 bot-hours of headless soaks per map and mode (deaths, who caused them, stuck time,
engagement ranges, spawn deaths; spawns and aim were fine). Fixes:

- **Bots look before they leap.** The edge probe checks every half meter (not 3 points) and lets
  bots step down up to 7 m (they were stuck on roofs); random hops and dashes check the path they
  will actually take (the final input after edge avoidance, and their momentum), 11 m for a dash
  and its slide; a pad that throws you away from home counts as a hole; a way around a drop is kept
  for 1.5 s (two equal choices made bots freeze at island edges), and with no way home on foot they
  use a pad on their piece that throws them home; walking into a crate, they hop it. Same seeds,
  18 minutes each, voluntary bot deaths before → after: Pump Station 24 → 13, Sugar Rush 23 → 10,
  Face-Off 70 → 61.
- **Face-Off:** the flank pads throw a meter farther (bots landed 0.6 m inside the islands and
  strafed off), the islands have a pad back, and the spawn list is symmetric (lost bots head for the
  middle, not a corner of a base).
- **Pump Station:** pads back from the giants' pedestals (a 5 m gap with no way across).
- **Fair bot teams.** Team modes add bots in twins (same skill and loadout, one per team), and
  shuffles keep twins apart: with random splits, the team with more total bot skill won 19 of 19
  Team Knockout matches.
- **Knockout credit.** A knockout counts for the last attacker within 8 s of the hit, or up to 20 s
  if the victim hasn't landed in control since (Bounce Castle: 30 of 34 uncredited deaths were
  bots still bouncing 8 to 12 s after the hit). Uncredited deaths there: 11 → 5.

## Less glare; no repeat ults

- **Glare.** On Medium and High the bloom pass started at 80% brightness, so every sunlit white
  deck, cloud and pillar (and the sky around the sun) grew a white haze, and highlights washed the
  colors out. Bloom now only picks up what's brighter than white (neon, bulbs, pads, ult effects),
  softer and closer in (threshold 1.25, strength 0.22, radius 0.35; was 0.8, 0.4, 0.55); the sun is
  a little softer (1.8, was 2.1), the sky light 0.9 (was 1.0), exposure 0.9 (was 0.95), reflections
  0.3 (was 0.4), clouds glow less (0.12, was 0.35), and the sky's halo around the sun is smaller.
- **No same ult twice in a row.** Ults were re-dealt each spawn, but a long life refills the meter
  and you'd pop the same one again, and a respawn could hand back the one you'd just used. Now the
  next ult is dealt the moment you pop one, and a respawn deals neither the one you held nor the one
  you last used (the rest stay equally likely).

## Battery: less work for the same picture

Only work nobody can see was cut; nothing changes on screen and nothing gets slower:

- **Tube-man normals** were recomputed every frame with three.js's generic `computeVertexNormals`,
  which reads and writes every vertex through Vector3 accessors: about 4.5 ms of a 10 ms frame of
  game code in a profiled bot match. `FlexTube` now does the same sums in the same order straight
  on the arrays (a test checks the result is bit-for-bit what three.js gives): about 1 ms.
- **Tube men off screen aren't drawn.** They were never frustum culled because their shape changes
  every frame; each tube now keeps a bounding sphere around its rings (a test checks every vertex
  is inside), so players behind you are skipped. The sun's shadow pass culls on its own, so their
  shadows still show.
- **No multisampled canvas.** Medium and High draw the scene into post-processing buffers and only
  a full-screen picture reaches the canvas, so its 4× anti-aliasing buffer changed nothing but cost
  memory bandwidth every frame. Low keeps anti-aliasing when it had it (after starting higher, it
  renders into a multisampled buffer instead).
- **Nothing is drawn under the team lobby** (it covers the screen with a solid background).
- **Menu music pauses in a hidden tab** (and picks up when you come back). In a match or a lobby the
  sound keeps going, so you still hear a match start from another tab.

The menu pill shows both counts now: "3 online · 37 today".
