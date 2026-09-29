# Blubba

A browser-based multiplayer PvP shooter where inflatable tube men blast each other off floating
maps with air-powered weapons. No health bar: every hit inflates you (bigger, lighter, easier to
launch) and the only way to lose a life is to leave the map.

The full design lives in [`docs/SPEC.md`](docs/SPEC.md). Decisions the spec left open are recorded
in [`docs/DECISIONS.md`](docs/DECISIONS.md), and build progress per phase in
[`docs/PROGRESS.md`](docs/PROGRESS.md).

## Quick start

```bash
npm install
npm run build        # builds the client (Vite) and the server (esbuild)
npm start            # serves everything on http://localhost:8080
```

Open http://localhost:8080, pick a mode (Knockout, Team Knockout, Ball, Pump, 1v1) and click
**PLAY**. Public rooms are topped up with bots, so you can play alone. To play with friends, click
**Private room**, press **Esc** in the match, and use **Copy invite link** (links look like
`http://host/r/ABCDE`). **1v1 challenge** copies a `http://host/c/ABCDE` link: whoever opens it
plays you one-on-one.

Controls are listed under **How to play** in the menu and every ability shows its key on the
HUD. Press **V** to switch between first and third person (the choice is remembered). Phones and
tablets get on-screen touch controls automatically (hold the phone sideways).

Every day brings three **daily challenges** (on the main menu) and a play streak bonus; knockout
streaks in a match earn **Turbo Tank** (3 pops) and **Mega Blast** (5 pops).

Progress (XP, levels, coins, unlocks, stats) is saved for guests automatically. An optional
account (name + password, no email) keeps it across computers, unlocks **Ranked 1v1**, and lets
you spend coins in the **Locker** (cosmetics only). Accounts and progress live in SQLite; set
`BUBBA_DB` to choose the file (default `data/bubba.db`). Needs Node 22.5 or newer.

### Development

```bash
npm run dev          # game server with auto-reload on :8080 + Vite dev server on :5173
```

Open http://localhost:5173 (Vite proxies the WebSocket to the game server).

### Tests

```bash
npm test             # unit, balance, and server integration tests (Vitest)
npm run typecheck
node scripts/smoke.mjs http://localhost:8080/   # headless browser smoke test with screenshots
npx tsx scripts/bot-soak.ts 3                   # bots vs. an idle player for 3 simulated minutes
npx tsx scripts/balance-report.ts               # hits-to-knockout report for tuning
npx tsx scripts/mode-soak.ts                    # a bot match of every mode and map
node scripts/smoke-modes.mjs                    # every mode + the challenge-link flow in a browser
BUBBA_DEBUG=1 npm start & node scripts/smoke-host.mjs   # host controls and the team results screen
BUBBA_DEBUG=1 npm start & node scripts/smoke-accounts.mjs  # sign-up, store, rewards, chat, ranked
node scripts/smoke-controls.mjs                 # control hints, tooltips, third-person camera
BUBBA_DEBUG=1 npm start & node scripts/playtest.mjs  # autopilot plays a full match, logs everything
node scripts/playtest-touch.mjs                 # plays on an emulated phone with touch input only
npx tsx scripts/knockback-sweep.ts              # launch distance per hit and hits-to-knockout
npx tsx scripts/chaos-report.ts                 # how often events, chains, crown, revenge happen
QUALITY=medium node scripts/lookdev.mjs         # screenshot of the ?lookdev tube man lineup
npx tsx scripts/reports.ts                      # latest player reports (for moderators)
```

## Tuning

Every balance value (knockback, inflation per hit, cooldowns, ammo, timers, event frequency, ...)
is in [`src/shared/balance.ts`](src/shared/balance.ts). Both the server and client prediction read
from it, and `tests/balance.test.ts` checks the spec's target that a fresh player survives about
five clean hits.

## Architecture

```
src/
  shared/            Code that runs on both server and client
    balance.ts       All tuning values
    player.ts        Player state + movement/weapon step (used for server sim AND client prediction)
    world.ts         Axis-aligned collision world, movers, raycasts
    game/sim.ts      Authoritative match simulation: projectiles, hits, knockouts, match flow
    game/bot.ts      Bot AI (fills public rooms, drives soak tests)
    game/modes.ts    Mode list, Ball physics and Pump filling
    game/chaos.ts    Random events and the final-30 collapse
    economy.ts       Levels, unlocks, rewards, store catalog, ranked ratings, quick chat
    protocol.ts      Binary snapshots/inputs + JSON messages
    maps/            Map data
    names.ts         Username rules and profanity filter
  server/            Node HTTP + WebSocket server, lobby, rooms (60 Hz fixed tick),
                     SQLite store, account/store API, rewards, ranked matchmaking
  client/            Three.js renderer, prediction/interpolation, input, audio, UI
```

- **Server authoritative.** The server runs the simulation at 60 Hz and decides every hit and
  launch. Clients send compact input frames (20 bytes, press counters so presses are never lost)
  and receive 30 Hz binary snapshots.
- **Client prediction + reconciliation** for your own movement and weapon, so controls feel instant
  on school Wi-Fi; everyone else is interpolated about 70-120 ms in the past.
- **No asset downloads.** All geometry is procedural and all sounds are generated in the browser
  (body sounds from physical models, rendered once into sample variants), so the whole game is
  one small script. The server precompresses it with Brotli.

## Custom sounds

To use real recordings instead of the generated body sounds, put audio files (OGG, MP3, WAV or
M4A) in `src/client/public/sounds/` with a `manifest.json` listing them per sound, then rebuild:

```json
{ "fart": ["fart1.ogg", "fart2.ogg"], "fartLong": ["fart-long.ogg"], "burp": ["burp.ogg"],
  "groan": ["oof.ogg"], "squeal": ["deflate.ogg"], "squeak": ["squeak.ogg"], "impact": ["hit.ogg"] }
```

Any sound left out keeps its generated version. Each play picks a random file and pitch.

## Deploying

Any host that runs a long-lived Node process with WebSockets works (Fly.io, Render, Railway, a
VPS). Serverless/edge platforms without persistent WebSockets (e.g. Vercel functions) will not work
for the game server. A `Dockerfile` is included:

```bash
docker build -t blubba .
docker run -p 8080:8080 -v blubba-data:/data blubba
```

The `/data` volume holds the SQLite database (accounts, progress, reports). Run a single server
process per database file.

### Keeping accounts

Hosts like Render's free plan wipe the server's disk on every restart and deploy (free servers
also restart after sleeping), which would delete every account. To keep them, give the server a
free Postgres database and set its connection string as `DATABASE_URL`:

1. Create a free Postgres database at [Neon](https://neon.tech) or [Supabase](https://supabase.com).
   Copy its connection string (on Supabase: Connect → **Session pooler**, which works over IPv4).
   It looks like `postgresql://user:password@host:5432/dbname`.
2. In Render: your service → **Environment** → add `DATABASE_URL` with that string → Save
   (Render redeploys).
3. Check `https://<your-site>/api/health`: it says `"storage":"postgres"` when it's working.

The server loads everything from Postgres at startup (tables are created automatically, all named
`blubba_*`), keeps working from its local SQLite copy, and writes every change back to Postgres
within about a second. If a local database already exists and Postgres is empty, it is uploaded
the first time. Run one server per database. Without `DATABASE_URL` on Render, the server logs a
warning at startup.

### Moderation and character faces

Set `BUBBA_ADMIN_TOKEN` (12+ characters) in the server's environment, then open `/admin` and
enter the token. From there you can remove any face scan (or remove it and stop that account
uploading another), restore a face that reports hid, and read recent player reports.

The same page handles **character faces**. Popping an ult turns you into one of the regulars
(Juice: BOR, The Chase: ABAG, Crop Duster: SOL, Robot Mode: KESTY). The real person behind a
character can lend it their face: they save a face scan of themselves on their own account and
pick "Are you the real BOR, ABAG, SOL or KESTY?" in the face scan screen. The claim shows up
under **Character faces** on `/admin`; approve it and everyone who turns into that character
wears that face. Removing the face scan (by them or by you) takes it off the character too.

Put it behind HTTPS in production (the client automatically uses `wss://` on HTTPS pages).
