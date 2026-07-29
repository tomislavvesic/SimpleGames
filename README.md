# Simple Games

A small browser arcade built for quick solo runs and easy-to-share online
sessions. It is a Vite application hosted on Cloudflare Workers, with
server-authoritative multiplayer rooms powered by Durable Objects and
hibernatable WebSockets.

## Games

- **Four Sides** — competitive 1 vs 1, 2 vs 2, or four-player free-for-all.
  Each player defends one equal-sized goal with five lives. Empty or
  disconnected seats can be controlled by predictive bots.
- **Signal Crew** — a 2–4 player reaction co-op game. Each player operates one
  station while the crew races increasingly fast commands and protects shared
  stability.
- **One Way Out** — a solo, endlessly changing maze with fair path-derived
  timers, time sparks, score multipliers, and local best records.

Both online games support public matchmaking, private six-character rooms,
shareable invite links, server-issued reconnect credentials, bot takeover,
rematches, and Game Master-owned room lifecycles. Player names, appearance, and
per-game records are stored locally without requiring an account.

## Local development

Install dependencies and run the landing page:

```bash
npm install
npm run dev
```

Run the complete Worker, including Durable Objects and WebSockets:

```bash
npx wrangler dev --local --port 8791
```

## Architecture and adding games

The landing page, shared services, and games remain in one repository. Each
game lives under `src/games/<game-id>/`, supplies a small catalog manifest, and
is downloaded only when launched. Shared profile and server utilities live
under `src/shared/`; the application shell and router live under `src/app/`.

See [docs/ADDING_A_GAME.md](docs/ADDING_A_GAME.md) for the module contract,
manifest schema, colocated testing convention, and release checklist.

## Verification

Fast deterministic tests are part of the production build, so a failing test
also blocks Cloudflare's configured deployment:

```bash
npm test
npm run build
npm run check:bundle
npm run check:deploy
```

With the local Worker running on port `8791`, run the real multiplayer and
browser smoke suites:

```bash
npm run test:integration
npm run test:browser
```

Override their targets with `INTEGRATION_BASE_URL`, `BROWSER_BASE_URL`, or
`BROWSER_EXECUTABLE` when needed. The browser suite uses an installed
Chromium-family browser. GitHub Actions runs all of these checks on pushes and
pull requests.

The standards every new game must satisfy are in
[docs/GAME_QUALITY.md](docs/GAME_QUALITY.md). Production bundle sizes are
compared with the pre-modular baseline during every build.

## Cloudflare deployment

Cloudflare Workers Builds should use:

- Build command: `npm run build`
- Deploy command: `npm run deploy`
- Node.js version: `22`

`wrangler.jsonc` serves `dist` as SPA assets and defines the Durable Object
bindings and migrations. A push to the connected `main` branch triggers the
existing Cloudflare build; its build step first runs the deterministic test
suite.
