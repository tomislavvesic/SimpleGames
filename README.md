# Simple Games

A browser arcade for quick solo, versus, and local co-op games.

Four Sides is an online multiplayer game backed by Cloudflare Durable
Objects and WebSockets. It supports:

- Shareable six-character private or public rooms
- 1 vs 1, 2 vs 2, and four-player free-for-all
- Optional bots for empty or disconnected sides
- Public lobby discovery and quick play
- Server-authoritative physics and scoring

## Local development

```bash
npm install
npm run dev
```

## Production build

```bash
npm run build
```

The generated `dist` directory can be deployed as a static site. For
Cloudflare Workers Builds use:

- Build command: `npm run build`
- Deploy command: `npm run deploy`
- Node.js version: `22`

`wrangler.jsonc` configures the contents of `dist` as static assets and
enables single-page application fallback routing.
