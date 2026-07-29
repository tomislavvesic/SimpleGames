# Simple Games TODO

## Next step: Modular game architecture

Keep the landing page and games in one repository, while making every game an
independent, lazy-loaded module.

- [x] Move each game into `src/games/<game-name>/`.
- [x] Keep each game's client, server, styles, and tests together.
- [x] Move genuinely cross-game profile and multiplayer infrastructure into
      `src/shared/`; keep game-specific physics and audio with their games.
- [x] Introduce a game manifest/catalog that supplies landing-page metadata and
      launches the correct game.
- [x] Lazy-load each game's JavaScript and CSS so visitors only download games
      they open.
- [x] Give every game a stable, shareable URL.
- [x] Keep existing room links and saved player profiles compatible.
- [x] Update CI to test every registered game and reject broken manifests.
- [x] Compare production bundle sizes before and after the migration (initial
      raw payload: -70.4%; initial gzip payload: -65.4%; total raw payload:
      +6.7%).
- [x] Verify all unit, browser, and real-WebSocket tests before deployment.

### Definition of done

- Adding a game requires creating its module and registering one manifest.
- Opening the landing page does not download every game's implementation.
- Four Sides, Signal Crew, and One Way Out behave exactly as they do now.
- The production build, accessibility checks, multiplayer tests, and Cloudflare
  deployment all pass.
