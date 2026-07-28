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
Cloudflare Pages use:

- Build command: `npm run build`
- Build output directory: `dist`
- Root directory: `/`
- Node.js version: `22`
