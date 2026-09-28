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
- **Map rotation:** public knockout-style rooms move to the next of the three knockout maps when
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

