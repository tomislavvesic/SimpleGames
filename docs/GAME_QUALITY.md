# Game quality contract

Every Simple Games release should feel understandable within seconds, fair
enough to retry, and safe to leave or reconnect. This checklist is the minimum
definition of done for a new game or a material gameplay change.

## Game design

- Explain the objective and controls in one short screen.
- Reach the first meaningful action within ten seconds.
- Start forgiving, increase pressure gradually, and cap difficulty before
  inputs become unreadable or physically impossible.
- Reward mastery through score, streak, precision, routing, or team
  coordination instead of random punishment.
- Keep retries and rematches one action away.
- Seed or isolate randomness so fairness can be tested deterministically.

## Runtime and lifecycle

- Separate deterministic game rules from rendering and network code.
- Pause timers and release held input when the page loses focus.
- Stop animation frames, intervals, audio, observers, and reconnect timers when
  a game closes.
- Survive unavailable local storage, audio, vibration, clipboard, and reduced
  network connectivity.
- Make repeated open, close, restart, reconnect, and rematch actions idempotent.
- Never trust client-supplied score, ownership, identity, timing, or physics in
  an online game.

## Multiplayer

- Give each room server-issued, room-scoped credentials and reserve the Game
  Master's seat before publishing the room.
- Authenticate reconnects, reject duplicate sockets, bound messages, enforce
  origin checks, and rate-limit mutations.
- Persist the lobby roster and any result needed after Durable Object
  hibernation.
- Use an explicit durable grace period for an unclean Game Master disconnect;
  an intentional Game Master exit closes the room.
- Replace other disconnected players with fair bots and let authenticated
  players reclaim their seat.
- Treat room start, shutdown, result, and rematch as lifecycle transitions that
  cannot resume after closure.
- Keep public-directory data free of owner and reconnect secrets.

## Input, layout, and accessibility

- Support keyboard plus touch/pointer controls where the game needs them.
- Do not intercept shortcuts while a user is typing in a form control.
- Use one physics/rendering coordinate system and preserve the intended aspect
  ratio at desktop and mobile sizes.
- Provide accessible names for controls, visible focus states, status
  announcements, and reduced-motion behavior.
- Prevent horizontal overflow at the supported minimum width of 320 px.

## Required evidence

- Register a complete, unique manifest and preserve its canonical route and
  profile identifier after release.
- Keep the implementation behind the manifest's dynamic `load()` boundary;
  opening the landing page must not fetch every game's JavaScript.
- Keep deterministic tests beside the game or shared module they exercise.
- Unit tests cover deterministic rules, bounds, scoring, difficulty, and
  generated-content validity.
- Generated levels are checked in bulk for solvability and fair timing.
- Browser smoke tests cover desktop and mobile layouts, every launch/close
  lifecycle, input conflicts, persistence, and runtime console errors.
- Online games have real-WebSocket integration tests for create/join, security,
  ready/start, bot takeover, reconnect, completion, rematch, host closure, and
  warm closed-room rejection.
- `npm run build`, including catalog and bundle-budget validation, and
  `npm run check:deploy` pass before merge.
- The deployed Worker is checked after release for asset delivery, security
  headers, API health, and a live WebSocket room.

Tests reduce regressions; they do not make a literal guarantee that software
has no defects. Any production issue becomes a reproducible test before its fix
is released.
