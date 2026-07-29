# Adding a game

Simple Games uses one catalog and lazy client modules. Registering a manifest
adds its card to the landing page and gives it a stable route; the landing page
must never import a game's implementation eagerly.

## 1. Create the game module

Use this layout, omitting the server folders for a solo game:

```text
src/games/my-game/
  manifest.js
  client/
    index.js
    game.js
    styles.css
    game.test.mjs
  server/
    routes.js
    room.js
  shared/
    rules.js
    rules.test.mjs
```

Keep game-specific rules, UI, styles, server code, and deterministic tests in
this directory. Put code genuinely reused by multiple games under
`src/shared/`.

The lazy entry imports its own styles and exports the standard factory:

```js
// src/games/my-game/client/index.js
import "./styles.css";
export { createGame } from "./game.js";
```

`createGame(context)` receives:

- `document`
- `profileStore` and `profileUI`
- `isSoundOn`
- `manifest`
- `onRequestClose`

It returns a controller with `open()` and `close({ navigate })`. The router
caches that controller, so both methods must be safe across repeated launches.
`close()` must release animation frames, timers, listeners, sockets, audio, and
held input.

## 2. Define and register the manifest

Create a lightweight manifest. Do not import `client/index.js` at the top
level; the dynamic `load()` is the code-splitting boundary.

```js
export const myGameManifest = Object.freeze({
  id: "my-game",
  title: "My Game",
  route: "/games/my-game",
  legacyQuery: null,
  category: "Solo",
  players: "1 player",
  description: "A short explanation of the objective.",
  featured: false,
  profileId: "my-game",
  launchAttribute: "data-play-my-game",
  art: Object.freeze({
    className: "my-game-art",
    markup: "<span>MG</span>",
  }),
  load: () => import("./client/index.js"),
});
```

Then import the manifest in `src/app/game-catalog.js` and add it to
`GAME_CATALOG`. Catalog validation rejects missing metadata, non-canonical
routes, eager or missing loaders, and duplicate identifiers, routes, profile
keys, legacy query keys, or launch attributes.

Treat `id`, `route`, and `profileId` as permanent once released. Set
`legacyQuery` only when preserving an older invite format such as `?room=`.
Manifest art is trusted repository markup and must never include user content.

## 3. Add tests

Node discovers `*.test.mjs` recursively, including tests beside the module they
exercise. Cover deterministic rules, difficulty bounds, generated content,
scoring, and lifecycle behavior there.

The browser suite launches every registered catalog entry, confirms that it
downloads a new JavaScript chunk on demand, and checks its canonical route.
Add game-specific interactions to `scripts/browser-smoke.mjs` for controls,
layout, accessibility, persistence, and cleanup. For an online game, extend
`scripts/multiplayer-smoke.mjs` with its authenticated room lifecycle,
reconnect, host closure, bot takeover, and rematch behavior.

Follow [GAME_QUALITY.md](GAME_QUALITY.md) for the complete acceptance contract.

## 4. Add a server only when needed

Keep game routes and Durable Object implementation inside the game's `server`
directory. Reuse bounded HTTP parsing, lobby lifecycle, and shared server
helpers from `src/shared/server/`.

Expose the route and Durable Object class through `src/worker.js`. A new Durable
Object also requires an explicit binding and migration in `wrangler.jsonc`.
Never place room credentials in the public directory or in a manifest.

## 5. Verify the release

Run:

```bash
npm run test:unit
npm run build
npm run check:deploy
```

`npm run build` validates the catalog and compares the generated initial and
total JavaScript/CSS payloads with `docs/bundle-baseline.json`. It fails if game
code is no longer lazy, the initial payload regresses past the pre-modular
build, or total code grows beyond the documented allowance.

With the local Worker running, also run:

```bash
npm run test:browser
npm run test:integration
```

Do not update the baseline simply to make a regression pass. Change it only
after a deliberate review explains why a larger initial or total payload is
worth shipping.
