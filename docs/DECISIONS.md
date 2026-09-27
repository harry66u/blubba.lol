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
- **Grapple** targets players first (with a 0.5 m aim forgiveness for trackpads), then surfaces.

## Sound-off versions of every audio joke

| Sound | Visual |
|---|---|
| Dash fart | Green puff cloud + "PFFT!" popup (a rare extra-long one says "PFFFFFFFRRRT!") |
| Burp | "BUURRP!" popup |
| Groin-shot groan | Target doubles over + "OOF!" popup |
| Deflating-balloon squeal | Spinning, shrinking balloon zipping into the sky + "WHEEEE!" |
| Squeaky hits | Hit popups, hit marker, and inflation % jumps |
| Brace clang | Metallic flash + "BRACED!" popup |
