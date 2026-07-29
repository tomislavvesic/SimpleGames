import test from "node:test";
import assert from "node:assert/strict";

import {
  PROFILE_VERSION,
  ProfileStore,
  createDefaultProfile,
  migrateProfile,
  normalizeGameId,
  normalizeNickname,
  sanitizeProfile,
  updateGameStats,
} from "./profile.js";

class FakeStorage {
  constructor(entries = {}) {
    this.values = new Map(Object.entries(entries));
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }
}

class BrokenStorage {
  getItem() {
    throw new Error("Storage is blocked");
  }

  setItem() {
    throw new Error("Storage is blocked");
  }
}

test("nickname and game identifiers are normalized and bounded", () => {
  assert.equal(normalizeNickname("  Ada\u0000   Lovelace  "), "Ada Lovelace");
  assert.equal(normalizeNickname("Ada\u202e  Player"), "Ada Player");
  assert.equal(normalizeNickname("１２３ Player"), "123 Player");
  assert.equal(normalizeNickname("abcdefghijklmnopqrs"), "abcdefghijklmnopqr");
  assert.equal(normalizeNickname(null), "");
  assert.equal(normalizeGameId("  One Wáy_Out! "), "one-way-out");
  assert.throws(() => normalizeGameId("---"), /game id/i);
});

test("legacy profiles migrate into a validated current schema", () => {
  const migrated = migrateProfile({
    version: 1,
    identity: {
      name: "  Tess  ",
      color: "orange",
      icon: "star",
    },
    gameStats: {
      "Four Sides": {
        gamesPlayed: "2",
        wins: 4,
        losses: -20,
        highScore: "900",
        streak: 3,
        lastPlayed: "2026-07-28T10:00:00Z",
      },
      "!!!": { played: 50 },
    },
    updatedAt: "not a date",
  });

  assert.equal(migrated.version, PROFILE_VERSION);
  assert.equal(migrated.nickname, "Tess");
  assert.equal(migrated.accent, "coral");
  assert.equal(migrated.avatar, "spark");
  assert.deepEqual(Object.keys(migrated.stats), ["four-sides"]);
  assert.equal(migrated.stats["four-sides"].wins, 4);
  assert.equal(migrated.stats["four-sides"].losses, 0);
  assert.equal(migrated.stats["four-sides"].played, 4);
  assert.equal(migrated.stats["four-sides"].bestScore, 900);
  assert.equal(migrated.stats["four-sides"].bestStreak, 3);
  assert.equal(migrated.updatedAt, null);
});

test("invalid profile fields fall back without leaking unknown data", () => {
  const profile = sanitizeProfile({
    nickname: 42,
    accent: "transparent",
    avatar: { glyph: "bad" },
    stats: [],
    admin: true,
  });

  assert.deepEqual(profile, createDefaultProfile());
  assert.equal(Object.hasOwn(profile, "admin"), false);
});

test("stat updates are immutable and track outcomes, score, speed, and streaks", () => {
  const original = sanitizeProfile({ nickname: "Mira" });
  const win = updateGameStats(original, "Four Sides", {
    outcome: "win",
    score: 120,
    durationMs: 15_000,
    playedAt: "2026-07-28T12:00:00.000Z",
  });
  const loss = updateGameStats(win, "four-sides", {
    outcome: "loss",
    score: 45,
    durationMs: 5_000,
    playedAt: "2026-07-28T12:05:00.000Z",
  });

  assert.equal(original.stats["four-sides"], undefined);
  assert.notEqual(win, original);
  assert.equal(loss.stats["four-sides"].played, 2);
  assert.equal(loss.stats["four-sides"].wins, 1);
  assert.equal(loss.stats["four-sides"].losses, 1);
  assert.equal(loss.stats["four-sides"].totalScore, 165);
  assert.equal(loss.stats["four-sides"].bestScore, 120);
  assert.equal(loss.stats["four-sides"].totalPlayTimeMs, 20_000);
  assert.equal(loss.stats["four-sides"].bestTimeMs, 15_000);
  assert.equal(loss.stats["four-sides"].currentStreak, 0);
  assert.equal(loss.stats["four-sides"].bestStreak, 1);
  assert.equal(loss.stats["four-sides"].lastPlayedAt, "2026-07-28T12:05:00.000Z");
});

test("ProfileStore loads legacy nickname and persists one current record", () => {
  const storage = new FakeStorage({ "four-sides-name": "  Nova " });
  const store = new ProfileStore({
    storage,
    storageKey: "profile-test-persist",
    now: () => Date.parse("2026-07-28T13:00:00.000Z"),
    eventTarget: null,
  });
  assert.equal(store.nickname, "Nova");

  let notification;
  store.subscribe((profile, context) => {
    notification = { profile, context };
  });
  store.setIdentity({ nickname: "Nova Prime", accent: "mint", avatar: "orbit" });
  const stats = store.recordGame("one-way-out", {
    outcome: "complete",
    score: 300,
    durationMs: 9_000,
  });

  const stored = JSON.parse(storage.getItem("profile-test-persist"));
  assert.equal(stored.nickname, "Nova Prime");
  assert.equal(stored.accent, "mint");
  assert.equal(stored.stats["one-way-out"].completions, 1);
  assert.equal(stored.updatedAt, "2026-07-28T13:00:00.000Z");
  assert.equal(stats.bestScore, 300);
  assert.equal(notification.context.persistent, true);
  assert.equal(store.persistenceAvailable, true);
  store.destroy();
});

test("malformed JSON and unavailable storage degrade to a working memory store", () => {
  const malformed = new ProfileStore({
    storage: new FakeStorage({ broken: "{ definitely not json" }),
    storageKey: "broken",
    eventTarget: null,
  });
  assert.deepEqual(malformed.getProfile(), createDefaultProfile());

  const memoryKey = `memory-${Date.now()}-${Math.random()}`;
  const first = new ProfileStore({
    storage: new BrokenStorage(),
    storageKey: memoryKey,
    now: () => Date.parse("2026-07-28T14:00:00.000Z"),
    eventTarget: null,
  });
  assert.doesNotThrow(() => first.setIdentity({ nickname: "Offline Ace" }));
  assert.equal(first.persistenceAvailable, false);

  const second = new ProfileStore({
    storage: new BrokenStorage(),
    storageKey: memoryKey,
    eventTarget: null,
  });
  assert.equal(second.nickname, "Offline Ace");
  assert.equal(second.persistenceAvailable, false);
  malformed.destroy();
  first.destroy();
  second.destroy();
});

test("getProfile and getStats cannot mutate store internals", () => {
  const store = new ProfileStore({
    storage: null,
    storageKey: `copies-${Date.now()}-${Math.random()}`,
    eventTarget: null,
  });
  store.setIdentity({ nickname: "Safe" });
  store.recordGame("signal-crew", { outcome: "win", score: 10 });

  const profile = store.getProfile();
  const stats = store.getStats("signal-crew");
  profile.nickname = "Changed";
  profile.stats["signal-crew"].wins = 100;
  stats.wins = 200;

  assert.equal(store.nickname, "Safe");
  assert.equal(store.getStats("signal-crew").wins, 1);
  store.destroy();
});
