import assert from "node:assert/strict";
import test from "node:test";

import {
  GAME_CATALOG,
  getGameById,
  getGameForLocation,
  normalizeRoute,
  validateGameCatalog,
} from "./game-catalog.js";

test("every registered game has a complete, unique manifest", () => {
  assert.equal(validateGameCatalog(GAME_CATALOG), GAME_CATALOG);
  assert.deepEqual(
    GAME_CATALOG.map((game) => game.id),
    ["four-sides", "signal-crew", "one-way-out"],
  );
  assert.equal(new Set(GAME_CATALOG.map((game) => game.route)).size, GAME_CATALOG.length);
  assert.equal(
    new Set(GAME_CATALOG.map((game) => game.profileId)).size,
    GAME_CATALOG.length,
    "profile identifiers must remain unambiguous",
  );
  assert.ok(GAME_CATALOG.every((game) => Object.isFrozen(game)));
});

test("catalog lookups support canonical and legacy share links", () => {
  assert.equal(getGameById("four-sides")?.title, "Four Sides");
  assert.equal(getGameById("missing"), null);
  assert.equal(
    getGameForLocation({ pathname: "/games/signal-crew/", search: "" })?.id,
    "signal-crew",
  );
  assert.equal(
    getGameForLocation({ pathname: "/", search: "?room=AB23CD" })?.id,
    "four-sides",
  );
  assert.equal(
    getGameForLocation({ pathname: "/", search: new URLSearchParams("signal=AB23CD") })?.id,
    "signal-crew",
  );
  assert.equal(getGameForLocation({ pathname: "/", search: "" }), null);
  assert.equal(normalizeRoute("//games///one-way-out///"), "/games/one-way-out");
});

test("catalog validation rejects broken or conflicting manifests", () => {
  const valid = {
    ...GAME_CATALOG[0],
    id: "test-game",
    route: "/games/test-game",
    legacyQuery: "test-room",
    profileId: "test-game",
    launchAttribute: "data-play-test",
    load: async () => ({ createGame() {} }),
  };

  assert.throws(
    () => validateGameCatalog([{ ...valid, title: "" }]),
    /title.*non-empty/i,
  );
  assert.throws(
    () => validateGameCatalog([{ ...valid, route: "/play/test-game" }]),
    /canonical route/i,
  );
  assert.throws(
    () => validateGameCatalog([{ ...valid, load: null }]),
    /lazy load function/i,
  );
  assert.throws(
    () => validateGameCatalog([valid, { ...valid }]),
    /ids and routes must be unique/i,
  );
  assert.throws(
    () => validateGameCatalog([
      valid,
      {
        ...valid,
        id: "other-game",
        route: "/games/other-game",
        profileId: "other-game",
      },
    ]),
    /legacy query key.*registered more than once/i,
  );
  assert.throws(
    () => validateGameCatalog([
      valid,
      {
        ...valid,
        id: "other-game",
        route: "/games/other-game",
        legacyQuery: null,
        launchAttribute: "data-play-other",
      },
    ]),
    /profile id.*registered more than once/i,
  );
  assert.throws(
    () => validateGameCatalog([
      valid,
      {
        ...valid,
        id: "other-game",
        route: "/games/other-game",
        legacyQuery: null,
        profileId: "other-game",
      },
    ]),
    /launch attribute.*registered more than once/i,
  );
});
