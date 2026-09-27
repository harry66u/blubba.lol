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
