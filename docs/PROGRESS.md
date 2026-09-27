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
