# Simple Games

A browser arcade for quick solo, versus, and local co-op games.

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
