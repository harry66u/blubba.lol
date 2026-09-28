# Blubba: the plan to beat Shell Shockers

**Status: built** (see docs/PROGRESS.md, "Beat-Shell-Shockers pass").

Shell Shockers wins schools because it is instant, runs on anything, plays on phones, and gives
players a reason to come back. Blubba already beats it on some of that and has a stronger core
idea (no health bars, knock people off the map). This plan closes the gaps, in build order.

## Where Blubba stands (run-through, September 2026)

**Already ahead**

- 245 KB download for the whole game (Shell Shockers is several megabytes). Menu in about a
  second on a normal laptop.
- One click from the menu to playing, as a guest, with bots filling empty rooms.
- A unique hook: inflation instead of health, launches, chain reactions, random events, crown and
  revenge, callouts, replays of the longest launch.
- School-safe social: quick chat only, reports, name filter. Cosmetics are never pay-to-win.

**Behind**

1. **Phones and tablets can't play.** A match starts, but there are no touch controls and the HUD
   is oversized and overlapping. A large share of students play on phones and iPads.
2. **Nothing brings players back tomorrow.** Levels and coins exist, but no daily goals or streaks.
3. **A hot streak earns nothing personal.** The crown goes to the streak leader, but there is no
   reward for your own 3-pop or 5-pop streak (Shell Shockers' streak rewards are its dopamine).
4. **School Chromebooks.** Auto quality starts at Medium (ambient occlusion, bloom, glossy
   materials). Dynamic resolution helps, but a weak GPU can still stay slow with no automatic
   step down to Low.
5. **Variety.** Three free-for-all maps.

## The plan

### 1. Play anywhere: phones and tablets

- Touch controls appear automatically on touch devices: a move stick (left thumb), drag anywhere
  on the right to aim, a big fire button (hold to charge), jump, dash, and a row for brace, grab,
  grapple, reload, utilities and the camera toggle. Buttons show cooldowns.
- Mobile HUD: smaller, rearranged so nothing overlaps the controls; no keyboard key labels.
- Menus fit on a phone screen.
- Tap to play (no pointer lock on touch).

### 2. Runs on every school laptop

- Detect weak or software GPUs and start them on Low.
- If frames stay slow even at the lowest render resolution, step down a quality level
  automatically (and tell the player once).

### 3. Streak rewards

Pops in one life earn rewards, announced with a callout and a glow:

- **3 pops: Turbo Tank.** Full ammo, and for 12 seconds reloads and fire rate are twice as fast.
- **5 pops: Mega Blast.** Your next 3 shots fire at full charge instantly and blast wider.

Server-authoritative and part of the shared movement step, so prediction stays exact.

### 4. Reasons to come back

- **Daily challenges:** three a day from a pool (pop players, land hits, win, chain reactions,
  goals, charged-shot pops, play matches...), each worth coins and XP, progress shown on the menu
  and on the results screen.
- **Daily streak:** playing on consecutive days adds a growing bonus.

### 5. Variety

- A fourth free-for-all map in the rotation.

### 6. Polish found along the way

- Anything the final playtest turns up.

## Done means

- A phone can join and play a full match with touch controls, and the menus fit.
- Weak GPUs land on Low automatically.
- Streak rewards trigger in normal matches and are visible to everyone.
- Daily challenges appear, progress during matches, pay out, and reset each day.
- A new map rotates in.
- Tests, soak runs and a full browser playtest pass with no errors.
