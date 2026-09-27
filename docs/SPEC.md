# Bubba: Build Spec

Working title: Bubba

This file describes everything we want the game to be. It does not prescribe a tech stack. Choose the languages, frameworks, libraries, hosting, and architecture yourself. When something is not specified, choose whatever best serves the design goals below and note the decision.

## 1. Concept

Bubba is a browser-based, multiplayer, PvP first-person shooter. Players are inflatable tube men (the kind that flail outside car dealerships) who blast each other off floating maps with air-powered weapons.

There is no health bar. Every hit inflates you, and the only way to lose a life is to get knocked off the map.

**Audience:** high school students, mostly teenage boys, playing on MacBooks at school during class, free periods, and lunch. The game competes with Shell Shockers, which spreads in schools because it runs in a browser, needs no install, and lets friends join the same match instantly.

**Design goals, in order:**

1. Chaotic and funny. The game should create moments that make people yell.
2. Deep skill. Good players should clearly beat new players, and the skill ceiling should be high.
3. Fair. Knockouts should be neither too easy nor too hard, nothing should reward button mashing, and nothing purchasable affects gameplay.
4. Instant. Open a link and be playing within seconds.

**Guiding rule:** chaos comes from the maps, events, and physics. The combat rules stay consistent and predictable. No random critical hits or random damage.

## 2. Platform and Access

- Runs in a browser tab on macOS in Chrome and Safari. No download or install.
- Target hardware is Apple Silicon MacBooks. Hold a steady 60 fps on a base M1 MacBook Air with a full lobby. Rendering can drop below full Retina resolution to hold frame rate.
- A new player can open the link and be in a match within about 10 seconds on school Wi-Fi.
- Guests play immediately with no login. An optional account saves progress, unlocks, purchases, stats, and rank. Creating an account keeps a guest's existing progress.
- Private rooms with a short join code and a share link.
- One-click 1v1 challenge links: opening the link puts both players straight into a 1v1.
- Players can join or leave casual matches at any time. Ranked matches have fixed lineups.
- During a match, show a leave-page warning if the player tries to close the tab. Command sits next to the space bar on a MacBook, and Command+W closes the tab.
- Fully playable with sound off. Every audio joke needs a visual version.
- Plays smoothly on typical school Wi-Fi, including moderate lag.
- The server decides every hit and launch so all players see the same result and cheating is difficult.

## 3. Core Mechanics

### Inflation

- Every hit pumps air into the target. More air makes the avatar bigger and lighter, so they are easier to hit and fly farther on the next hit.
- Inflation shows on the avatar's size so everyone can see how close a player is to going out. Also show it as a percentage: your own on the HUD, and enemies' above their heads.
- Inflation has a maximum.
- Balance target: a fresh player survives about five clean hits. After that, one well-placed hit near an edge can knock them off.
- A player is eliminated only by leaving the map, either by falling off or by being launched past the boundaries. On elimination, the avatar spins away like a released balloon with a deflating-balloon squeal, then respawns fully deflated.
- Keep every balance value (knockback, inflation per hit, cooldowns, ammo, timers, event frequency) in one place so the game can be tuned quickly.

### Hits and Launches

- Where a shot lands sets the launch direction. A shot at the feet sends the target up, and a shot to the side sends them sideways. Good players angle their hits toward the nearest edge.
- Direct hits launch harder than near misses.
- Launched players can steer slightly by holding a direction, so a skilled player can survive a hit that would finish a new one.
- Hits to the lower body play a groin-shot groan and make the target double over for half a second.

### Movement

- Walk, jump, and double jump.
- Air dash with two charges on a cooldown. A player who wastes both has no way to recover.
- Dashing on the ground ends in a short slide. Momentum carries from dashes into jumps and slides, so skilled players cross the map much faster than new ones.
- Blast jumping: firing at the ground near yourself launches you. It costs ammo and does not add to your own inflation. Players use it to recover, chase, and surprise opponents.

### Defense and Close Range

- **Brace:** pressing brace right before a hit cuts its knockback. It has a short window and a cooldown so it cannot be spammed. It rewards predicting when the opponent will fire.
- **Ledge grab:** press grab near a ledge while falling to catch it, then climb back up. Enemies can stomp the hands of a player hanging from a ledge to knock them off.
- **Grab:** at close range, grab an enemy to hold them briefly and throw them. The grabbed player breaks free with one well-timed dash, never by mashing. Grabs have a cooldown.
- **Take-you-with-me:** a player falling off the map can grab someone on the way down and drag them off too. The falling player gets credit for the knockout.
- **Grapple:** pulls an enemy toward you or off a ledge, or pulls you to a surface to save yourself. It has a cooldown.

### Air Combos

- Hitting someone upward lets you follow up before they land. Combos should be possible, but a skilled defender can escape with steering, brace, and dash.

## 4. Weapons, Mods, and Utilities

A loadout is one weapon with its mods, plus two utilities.

### Weapons

All weapons are air-powered and have limited ammo and a reload. Holding fire charges a shot, and charged shots hit much harder than rapid taps, so timing beats clicking fast.

- **Air Cannon:** medium range, balanced, charges into a heavy shot.
- **Leaf Blower:** a continuous stream that pushes enemies. Aimed at the ground, it lets you hover briefly.
- **Air Horn:** a close-range cone blast with a loud honk.
- **Pump Rifle:** long-range precise shots that add extra inflation. Rewards accurate aim.

Most players will aim with a MacBook trackpad, so every weapon except the Pump Rifle should be forgiving: wide blasts and large projectiles.

### Mods

Every mod is a trade-off, never a straight upgrade.

- **Wide Nozzle:** wider blast, shorter range.
- **Big Tank:** more ammo, slower reload.
- **Charge Valve:** harder hits, slower fire rate.
- **Quick Valve:** faster fire rate, weaker hits.
- **Long Barrel:** longer range, narrower blast.

### Utilities

- **Bounce Pad:** throw it down to launch yourself or catch enemies off guard.
- **Air Grenade:** blasts everyone nearby outward.
- **Inflatable Wall:** blocks shots or catches you at an edge.
- **Vacuum Grenade:** pulls nearby players toward it, setting up a teammate's charged blast.

### Pickups

- **Soda Can:** refills dash charges. The player burps.
- **Pin (rare):** instantly pops any player at maximum inflation.

Mods and utilities unlock by playing, never by paying.

## 5. Chaos Systems

- **Random events:** about once a minute, announced on screen a few seconds before they start:
  - A giant fan blows everyone toward one edge.
  - Gravity is cut in half.
  - The floor turns to ice.
  - Everyone inflates to maximum at once.
- **Chain reactions:** a launched player knocks back anyone they crash into. The original shooter gets credit for the whole chain.
- **Crown:** the player on the longest streak wears a crown and glows. Knocking them off is worth triple.
- **Revenge:** whoever last knocked you off glows on your screen. Knocking them off earns bonus points.
- **Final 30 seconds:** the map starts collapsing and every knockout counts double.
- **Callouts:** a hype announcer and large on-screen text for multi-knockouts, chain reactions, crown knockouts, and revenge.

## 6. Game Modes

- **Knockout:** free-for-all. Most knockouts when time runs out wins.
- **Team Knockout:** the same, by team.
- **Ball:** teams blast a giant beach ball into the other team's goal. Positioning and shot angles matter as much as knockouts.
- **Pump:** teams stand on air pumps to inflate their giant tube man. The first team to fill theirs wins. Knocking enemies off the pump slows their team.
- **1v1:** from challenge links or a 1v1 queue.
- **Ranked:** visible skill rating and skill-based matchmaking. Requires an account.

Match rules:

- Matches last 3 to 5 minutes.
- Up to 10 players per room. Team modes are 4v4 or 5v5 with automatic team balancing.
- Private room hosts choose the mode, map, time limit, and event frequency, and can kick players.

## 7. Maps

- Every map is a fictional floating arena with drops on every side, ledges to grab, bounce pads, and moving pieces.
- Starter maps: a car dealership lot floating in the sky, a rooftop parking garage, and a giant bounce house, plus dedicated arenas for Ball and Pump.
- Nothing is modeled on a real school or real building.

## 8. Avatars and Visual Style

- Tube men with arms that flail constantly. The flailing is visual only: hitboxes follow the body, not the arms.
- Fall Guys-style visuals: bright candy colors, glossy rubbery materials, soft lighting, real shadows, and a soft glow on bright colors.
- A dark landing circle directly under each player so everyone can judge where they will land.
- Bright player colors against calmer map colors so players are easy to spot and launches are easy to follow.
- The air dash leaves a visible puff cloud.
- A colorblind-friendly team color option.

## 9. Audio

- The air dash is a fart, with randomized pitch and a rare extra-long version.
- Burps on taunts and soda can pickups.
- A groin-shot groan on lower-body hits.
- A deflating-balloon squeal when a player is knocked off the map.
- Squeaky rubber sounds on hits.
- Hype announcer lines for big moments.
- Volume sliders for master, effects, announcer, and music, plus a mute toggle.

## 10. Controls

Defaults stay simple. Every key and button can be remapped.

### Keyboard with Trackpad or Mouse

| Action | Default |
|---|---|
| Move | WASD |
| Aim | Trackpad or mouse |
| Fire (hold to charge) | Left click |
| Jump and double jump | Space |
| Dash | Shift |
| Brace | Q |
| Grapple | E |
| Grab and ledge grab | F |
| Reload | R |
| Utility 1 | C |
| Utility 2 | V |
| Taunt | T |
| Scoreboard | Tab |
| Menu | Esc |

Never use Command or Control in default bindings.

### Controller

Xbox and PlayStation controllers, with PlayStation buttons in the same positions.

| Action | Default |
|---|---|
| Move | Left stick |
| Aim | Right stick |
| Fire (hold to charge) | Right trigger |
| Grapple | Left trigger |
| Jump | A |
| Dash | B |
| Brace | Right bumper |
| Grab and ledge grab | Left bumper |
| Reload | X |
| Utility 1 | Y |
| Utility 2 | D-pad up |
| Taunt | D-pad down |
| Scoreboard | View |
| Menu | Menu |

### Settings

- Separate sensitivity for trackpad, mouse, and controller.
- Invert Y.
- Light aim assist for controllers only, with adjustable strength or off.
- Graphics quality presets.

## 11. Customization, Progression, and Store

- Players customize their tube man's color, pattern, face, and hat, plus weapon finishes, taunts, knockout effects (like confetti or fireworks the whole lobby sees), and sound packs for knockouts and taunts.
- Players earn coins by playing.
- The store sells cosmetics only. Nothing purchased changes stats.
- Items are sold directly at a listed price. No loot boxes or random paid rewards.
- Purchases require an account.

## 12. Stats and Replays

- At the end of each match, show a slow-motion replay of the longest launch and stats like longest launch, most chain knockouts, total knockouts, and times popped.
- Account profiles track lifetime stats and rank.

## 13. Social and Safety

Most players are under 18.

- No free text chat. Players communicate with quick-chat presets and taunts.
- Usernames are filtered for slurs, profanity, and sexual terms.
- Players can report others. Room hosts can kick players.
- No blood or gore.
- Nothing sexual in sounds, skins, taunts, or names.
- Nothing modeled on real schools or real people.

## 14. Build Order

Build and playtest in this order. Each phase should be fully playable before the next one starts.

1. **Core loop:** movement, the Air Cannon, inflation and launches, one map, Knockout mode, private rooms with join codes, guest play, and keyboard and trackpad controls.
2. **Skill layer:** launch angles, steering, brace, ledge grabs, grabs, grapple, blast jumping, and air combos.
3. **Loadouts:** the remaining weapons, mods, utilities, and pickups.
4. **Chaos:** random events, chain reactions, crown, revenge, the final 30 seconds, and callouts.
5. **Look and sound:** the full visual style, landing circles, puff clouds, full audio, and match replays.
6. **Controls:** controller support, full remapping, and all settings.
7. **Modes and maps:** Team Knockout, Ball, Pump, 1v1 challenge links, and the remaining maps.
8. **Accounts and economy:** accounts, progression, coins, store, stats, and ranked.

## 15. Done Means

- A new player opens a link and is in a match within 10 seconds, with no login.
- A steady 60 fps on an M1 MacBook Air with a full lobby.
- A fresh player survives about five clean hits.
- No action in the game is won by button mashing.
- Every joke still works with sound off.
- Nothing in the store affects gameplay.
