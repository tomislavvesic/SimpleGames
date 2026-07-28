# Simple Games TODO

## Next step: Modular game architecture

Keep the landing page and games in one repository, while making every game an
independent, lazy-loaded module.

- [ ] Move each game into `src/games/<game-name>/`.
- [ ] Keep each game's client, server, styles, and tests together.
- [ ] Move reusable profiles, audio, UI, physics, and multiplayer code into
      `src/shared/`.
- [ ] Introduce a game manifest/catalog that supplies landing-page metadata and
      launches the correct game.
- [ ] Lazy-load each game's JavaScript and CSS so visitors only download games
      they open.
- [ ] Give every game a stable, shareable URL.
- [ ] Keep existing room links and saved player profiles compatible.
- [ ] Update CI to test every registered game and reject broken manifests.
- [ ] Compare production bundle sizes before and after the migration.
- [ ] Verify all unit, browser, and real-WebSocket tests before deployment.

### Definition of done

- Adding a game requires creating its module and registering one manifest.
- Opening the landing page does not download every game's implementation.
- Four Sides, Signal Crew, and One Way Out behave exactly as they do now.
- The production build, accessibility checks, multiplayer tests, and Cloudflare
  deployment all pass.
