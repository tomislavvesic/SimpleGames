/**
 * Lightweight, account-free player profiles for Simple Games.
 *
 * The data format is intentionally small and game-agnostic. Keep this module
 * free of browser-only work at import time so validation and stat updates can
 * also run in Workers and node:test.
 */

export const PROFILE_VERSION = 2;
export const PROFILE_STORAGE_KEY = "simple-games-profile";
export const PROFILE_NICKNAME_MAX = 18;

export const PROFILE_ACCENTS = Object.freeze([
  Object.freeze({ id: "coral", label: "Coral", color: "#ff725e" }),
  Object.freeze({ id: "mint", label: "Mint", color: "#66d6ae" }),
  Object.freeze({ id: "blue", label: "Blue", color: "#69a7ff" }),
  Object.freeze({ id: "yellow", label: "Yellow", color: "#ffd45c" }),
  Object.freeze({ id: "violet", label: "Violet", color: "#b79cff" }),
]);

export const PROFILE_AVATARS = Object.freeze([
  Object.freeze({ id: "spark", label: "Spark", glyph: "✦" }),
  Object.freeze({ id: "orbit", label: "Orbit", glyph: "◎" }),
  Object.freeze({ id: "diamond", label: "Diamond", glyph: "◆" }),
  Object.freeze({ id: "bolt", label: "Bolt", glyph: "ϟ" }),
  Object.freeze({ id: "comet", label: "Comet", glyph: "●" }),
]);

const DEFAULT_ACCENT = PROFILE_ACCENTS[0].id;
const DEFAULT_AVATAR = PROFILE_AVATARS[0].id;
const MAX_GAMES = 64;
const MAX_COUNTER = 999_999_999;
const memoryFallback = new Map();

const accentAliases = new Map([
  ["orange", "coral"],
  ["red", "coral"],
  ["#ff725e", "coral"],
  ["green", "mint"],
  ["#66d6ae", "mint"],
  ["#69a7ff", "blue"],
  ["gold", "yellow"],
  ["#ffd45c", "yellow"],
  ["purple", "violet"],
  ["#b79cff", "violet"],
]);

const avatarAliases = new Map([
  ["star", "spark"],
  ["circle", "orbit"],
  ["gem", "diamond"],
  ["lightning", "bolt"],
  ["ball", "comet"],
]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function limitedInteger(value, fallback = 0) {
  const number = typeof value === "string" && value.trim() ? Number(value) : value;
  if (!Number.isFinite(number)) return fallback;
  return Math.min(MAX_COUNTER, Math.max(0, Math.floor(number)));
}

function validIsoDate(value) {
  if (value === null || value === undefined || value === "") return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function normalizeChoice(value, options, aliases, fallback) {
  const candidate = String(value ?? "").trim().toLowerCase();
  const aliased = aliases.get(candidate) || candidate;
  return options.some((option) => option.id === aliased) ? aliased : fallback;
}

function normalizeAccent(value) {
  return normalizeChoice(value, PROFILE_ACCENTS, accentAliases, DEFAULT_ACCENT);
}

function normalizeAvatar(value) {
  return normalizeChoice(value, PROFILE_AVATARS, avatarAliases, DEFAULT_AVATAR);
}

/**
 * Cleans a player-entered nickname without tying it to the DOM.
 * Empty names are allowed in stored profiles so first-time visitors can remain
 * unnamed until a lobby or the profile editor asks for one.
 */
export function normalizeNickname(value) {
  let nickname = typeof value === "string" ? value : "";
  try {
    nickname = nickname.normalize("NFKC");
  } catch {
    // Some older runtimes can reject malformed Unicode. The remaining cleanup
    // still makes the value safe to store.
  }
  nickname = nickname
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return Array.from(nickname).slice(0, PROFILE_NICKNAME_MAX).join("");
}

/**
 * Turns a display/game identifier into a stable stats key.
 */
export function normalizeGameId(value) {
  let id = String(value ?? "").trim().toLowerCase();
  try {
    id = id.normalize("NFKD");
  } catch {
    // Continue with the original string in runtimes with incomplete Unicode.
  }
  id = id
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  if (!id) throw new TypeError("A game id must contain at least one letter or number.");
  return id;
}

export function createDefaultGameStats() {
  return {
    played: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    completions: 0,
    totalScore: 0,
    bestScore: 0,
    totalPlayTimeMs: 0,
    bestTimeMs: 0,
    currentStreak: 0,
    bestStreak: 0,
    lastPlayedAt: null,
  };
}

export function createDefaultProfile() {
  return {
    version: PROFILE_VERSION,
    nickname: "",
    accent: DEFAULT_ACCENT,
    avatar: DEFAULT_AVATAR,
    stats: {},
    updatedAt: null,
  };
}

function sanitizeGameStats(value) {
  const source = isRecord(value) ? value : {};
  const stats = createDefaultGameStats();

  stats.wins = limitedInteger(source.wins);
  stats.losses = limitedInteger(source.losses);
  stats.draws = limitedInteger(source.draws);
  stats.completions = limitedInteger(source.completions ?? source.completed);
  const accountedGames = Math.min(
    MAX_COUNTER,
    stats.wins + stats.losses + stats.draws + stats.completions,
  );
  stats.played = Math.max(limitedInteger(source.played ?? source.gamesPlayed), accountedGames);
  stats.totalScore = limitedInteger(source.totalScore ?? source.scoreTotal);
  stats.bestScore = limitedInteger(source.bestScore ?? source.highScore);
  stats.totalPlayTimeMs = limitedInteger(source.totalPlayTimeMs ?? source.playTimeMs);
  stats.bestTimeMs = limitedInteger(source.bestTimeMs);
  stats.currentStreak = limitedInteger(source.currentStreak ?? source.streak);
  stats.bestStreak = Math.max(
    limitedInteger(source.bestStreak),
    stats.currentStreak,
  );
  stats.lastPlayedAt = validIsoDate(source.lastPlayedAt ?? source.lastPlayed);
  return stats;
}

function sanitizeStats(value) {
  if (!isRecord(value)) return {};
  const stats = {};
  let count = 0;
  for (const [unsafeId, unsafeStats] of Object.entries(value)) {
    if (count >= MAX_GAMES) break;
    let gameId;
    try {
      gameId = normalizeGameId(unsafeId);
    } catch {
      continue;
    }
    if (Object.hasOwn(stats, gameId)) continue;
    stats[gameId] = sanitizeGameStats(unsafeStats);
    count += 1;
  }
  return stats;
}

/**
 * Migrates legacy/untrusted data and returns a fresh current-version profile.
 *
 * Supported legacy names include `name`, `playerName`, `color`, `icon`, and
 * `gameStats`, plus the v1 `{ identity: ... }` shape used in early prototypes.
 */
export function sanitizeProfile(value) {
  if (!isRecord(value)) return createDefaultProfile();

  const wrapped = isRecord(value.profile) ? value.profile : value;
  const identity = isRecord(wrapped.identity) ? wrapped.identity : {};
  const nickname = wrapped.nickname
    ?? wrapped.name
    ?? wrapped.playerName
    ?? identity.nickname
    ?? identity.name;
  const accent = wrapped.accent
    ?? wrapped.color
    ?? identity.accent
    ?? identity.color;
  const avatar = wrapped.avatar
    ?? wrapped.avatarId
    ?? wrapped.icon
    ?? identity.avatar
    ?? identity.icon;
  const stats = wrapped.stats ?? wrapped.gameStats;

  return {
    version: PROFILE_VERSION,
    nickname: normalizeNickname(nickname),
    accent: normalizeAccent(accent),
    avatar: normalizeAvatar(avatar),
    stats: sanitizeStats(stats),
    updatedAt: validIsoDate(wrapped.updatedAt),
  };
}

export const migrateProfile = sanitizeProfile;

function cloneProfile(profile) {
  const clone = {
    version: profile.version,
    nickname: profile.nickname,
    accent: profile.accent,
    avatar: profile.avatar,
    stats: {},
    updatedAt: profile.updatedAt,
  };
  for (const [gameId, stats] of Object.entries(profile.stats)) {
    clone.stats[gameId] = { ...stats };
  }
  return clone;
}

/**
 * Pure, immutable game-result reducer.
 *
 * Outcomes: `win`, `loss`, `draw`, `complete`, or `played`. Score, durationMs,
 * and playedAt are optional. Pass playedAt explicitly when deterministic output
 * is important; ProfileStore supplies its clock automatically.
 */
export function updateGameStats(profile, unsafeGameId, result = {}) {
  const next = sanitizeProfile(profile);
  const gameId = normalizeGameId(unsafeGameId);
  const payload = isRecord(result) ? result : {};
  const allowedOutcomes = new Set(["win", "loss", "draw", "complete", "played"]);
  const outcome = allowedOutcomes.has(payload.outcome) ? payload.outcome : "played";
  const current = next.stats[gameId]
    ? { ...next.stats[gameId] }
    : createDefaultGameStats();

  current.played = limitedInteger(current.played + 1);
  if (outcome === "win") {
    current.wins = limitedInteger(current.wins + 1);
    current.currentStreak = limitedInteger(current.currentStreak + 1);
  } else if (outcome === "loss") {
    current.losses = limitedInteger(current.losses + 1);
    current.currentStreak = 0;
  } else if (outcome === "draw") {
    current.draws = limitedInteger(current.draws + 1);
    current.currentStreak = 0;
  } else if (outcome === "complete") {
    current.completions = limitedInteger(current.completions + 1);
    current.currentStreak = limitedInteger(current.currentStreak + 1);
  }
  current.bestStreak = Math.max(current.bestStreak, current.currentStreak);

  if (Number.isFinite(payload.score)) {
    const score = limitedInteger(payload.score);
    current.totalScore = limitedInteger(current.totalScore + score);
    current.bestScore = Math.max(current.bestScore, score);
  }

  if (Number.isFinite(payload.durationMs) && payload.durationMs > 0) {
    const durationMs = limitedInteger(payload.durationMs);
    current.totalPlayTimeMs = limitedInteger(current.totalPlayTimeMs + durationMs);
    if (outcome === "win" || outcome === "complete") {
      current.bestTimeMs = current.bestTimeMs === 0
        ? durationMs
        : Math.min(current.bestTimeMs, durationMs);
    }
  }

  const playedAt = validIsoDate(payload.playedAt);
  if (playedAt) {
    current.lastPlayedAt = playedAt;
    next.updatedAt = playedAt;
  }
  next.stats[gameId] = current;
  return next;
}

function resolveLocalStorage() {
  try {
    const storage = globalThis.localStorage;
    return storage
      && typeof storage.getItem === "function"
      && typeof storage.setItem === "function"
      ? storage
      : null;
  } catch {
    return null;
  }
}

function isoFromClock(clock) {
  try {
    return validIsoDate(clock()) || new Date(0).toISOString();
  } catch {
    return new Date(0).toISOString();
  }
}

/**
 * Safe persistence facade. Failed reads/writes transparently continue in a
 * shared in-memory cache, so private browsing and disabled storage never block
 * a game.
 */
export class ProfileStore {
  constructor(options = {}) {
    const hasExplicitStorage = Object.hasOwn(options, "storage");
    this.storageKey = options.storageKey || PROFILE_STORAGE_KEY;
    this.legacyNameKey = options.legacyNameKey || "four-sides-name";
    this.storage = hasExplicitStorage ? options.storage : resolveLocalStorage();
    this.eventTarget = options.eventTarget
      ?? (typeof globalThis.window === "object" ? globalThis.window : null);
    this.clock = typeof options.now === "function" ? options.now : () => Date.now();
    this.listeners = new Set();
    this.persistenceAvailable = Boolean(this.storage);
    this._onStorage = (event) => this.#handleStorageEvent(event);
    this.profile = this.#load();

    if (this.eventTarget && typeof this.eventTarget.addEventListener === "function") {
      this.eventTarget.addEventListener("storage", this._onStorage);
    }
  }

  #load() {
    let raw = null;
    if (this.storage) {
      try {
        raw = this.storage.getItem(this.storageKey);
      } catch {
        this.persistenceAvailable = false;
      }
    }
    if (raw === null || raw === undefined) raw = memoryFallback.get(this.storageKey) ?? null;

    let profile;
    if (typeof raw === "string") {
      try {
        profile = sanitizeProfile(JSON.parse(raw));
      } catch {
        profile = createDefaultProfile();
      }
    } else {
      profile = sanitizeProfile(raw);
    }

    if (!profile.nickname && this.storage) {
      try {
        profile.nickname = normalizeNickname(this.storage.getItem(this.legacyNameKey));
      } catch {
        this.persistenceAvailable = false;
      }
    }
    memoryFallback.set(this.storageKey, JSON.stringify(profile));
    return profile;
  }

  #persist(profile) {
    const serialized = JSON.stringify(profile);
    memoryFallback.set(this.storageKey, serialized);
    if (!this.storage) {
      this.persistenceAvailable = false;
      return;
    }
    try {
      this.storage.setItem(this.storageKey, serialized);
      this.persistenceAvailable = true;
    } catch {
      this.persistenceAvailable = false;
    }
  }

  #emit(source = "local") {
    const snapshot = this.getProfile();
    for (const listener of [...this.listeners]) {
      try {
        listener(snapshot, { source, persistent: this.persistenceAvailable });
      } catch {
        // One UI listener must not prevent other consumers from updating.
      }
    }
  }

  #handleStorageEvent(event) {
    if (!event || event.key !== this.storageKey || typeof event.newValue !== "string") return;
    try {
      this.profile = sanitizeProfile(JSON.parse(event.newValue));
      memoryFallback.set(this.storageKey, JSON.stringify(this.profile));
      this.#emit("external");
    } catch {
      // Ignore malformed values written by another tab or an older extension.
    }
  }

  getProfile() {
    return cloneProfile(this.profile);
  }

  get nickname() {
    return this.profile.nickname;
  }

  get displayName() {
    return this.profile.nickname || "Player";
  }

  getStats(gameId) {
    const normalizedId = normalizeGameId(gameId);
    return {
      ...(this.profile.stats[normalizedId] || createDefaultGameStats()),
    };
  }

  save(profile) {
    const next = sanitizeProfile(profile);
    next.updatedAt = isoFromClock(this.clock);
    this.profile = next;
    this.#persist(next);
    this.#emit();
    return this.getProfile();
  }

  setIdentity(identity = {}) {
    const patch = isRecord(identity) ? identity : {};
    return this.save({
      ...this.profile,
      nickname: Object.hasOwn(patch, "nickname") ? patch.nickname : this.profile.nickname,
      accent: Object.hasOwn(patch, "accent") ? patch.accent : this.profile.accent,
      avatar: Object.hasOwn(patch, "avatar") ? patch.avatar : this.profile.avatar,
    });
  }

  update(mutator) {
    const draft = this.getProfile();
    const candidate = typeof mutator === "function"
      ? (mutator(draft) ?? draft)
      : { ...draft, ...(isRecord(mutator) ? mutator : {}) };
    return this.save(candidate);
  }

  recordGame(gameId, result = {}) {
    const payload = isRecord(result) ? { ...result } : {};
    if (!validIsoDate(payload.playedAt)) payload.playedAt = isoFromClock(this.clock);
    const next = updateGameStats(this.profile, gameId, payload);
    this.profile = next;
    this.#persist(next);
    this.#emit();
    return this.getStats(gameId);
  }

  subscribe(listener, options = {}) {
    if (typeof listener !== "function") throw new TypeError("Profile listener must be a function.");
    this.listeners.add(listener);
    if (options.immediate) {
      listener(this.getProfile(), {
        source: "initial",
        persistent: this.persistenceAvailable,
      });
    }
    return () => this.listeners.delete(listener);
  }

  destroy() {
    if (this.eventTarget && typeof this.eventTarget.removeEventListener === "function") {
      this.eventTarget.removeEventListener("storage", this._onStorage);
    }
    this.listeners.clear();
  }
}

function optionMarkup(kind, options) {
  return options.map((option) => `
    <label class="profile-choice">
      <input type="radio" name="${kind}" value="${option.id}">
      <span class="profile-choice-swatch" data-${kind}="${option.id}" aria-hidden="true">${
        kind === "avatar" ? option.glyph : ""
      }</span>
      <span>${option.label}</span>
    </label>
  `).join("");
}

const profileTemplate = `
  <div class="player-profile">
    <button class="profile-trigger" type="button" aria-label="Open player profile" aria-haspopup="dialog" aria-expanded="false">
      <span class="profile-trigger-avatar" data-profile-avatar aria-hidden="true"></span>
      <span class="profile-trigger-copy">
        <small>Player profile</small>
        <b data-profile-trigger-name>Set up player</b>
      </span>
    </button>
    <dialog class="profile-dialog" aria-labelledby="profile-title">
      <form class="profile-form" novalidate>
        <header class="profile-dialog-header">
          <div>
            <span class="profile-kicker">Your local player</span>
            <h2 id="profile-title">Make it yours.</h2>
          </div>
          <button class="profile-close" type="button" aria-label="Close player profile">×</button>
        </header>
        <p class="profile-intro">Your name, look, and game records stay on this device. No account needed.</p>
        <label class="profile-name-field">
          <span>Nickname</span>
          <input name="nickname" type="text" maxlength="${PROFILE_NICKNAME_MAX}" autocomplete="nickname" required placeholder="Player name">
        </label>
        <div class="profile-customize">
          <fieldset>
            <legend>Avatar</legend>
            <div class="profile-choices profile-avatar-choices">
              ${optionMarkup("avatar", PROFILE_AVATARS)}
            </div>
          </fieldset>
          <fieldset>
            <legend>Accent</legend>
            <div class="profile-choices profile-accent-choices">
              ${optionMarkup("accent", PROFILE_ACCENTS)}
            </div>
          </fieldset>
        </div>
        <section class="profile-records" aria-labelledby="profile-records-title">
          <div class="profile-records-heading">
            <h3 id="profile-records-title">Game records</h3>
            <span>On this device</span>
          </div>
          <div class="profile-stats-list" data-profile-stats></div>
        </section>
        <p class="profile-storage-note" data-profile-storage-note role="status" hidden>
          Browser storage is unavailable. Changes will last for this visit only.
        </p>
        <p class="profile-save-status" data-profile-save-status role="status" aria-live="polite"></p>
        <footer class="profile-actions">
          <button class="profile-cancel" type="button">Cancel</button>
          <button class="profile-save" type="submit">Save profile <span aria-hidden="true">→</span></button>
        </footer>
      </form>
    </dialog>
  </div>
`;

/**
 * Drop-in accessible profile UI.
 *
 * Example:
 *   const profiles = new ProfileStore();
 *   const profileUI = new ProfileController({ store: profiles });
 *   profileUI.mount(document.querySelector(".site-header"));
 *   profileUI.bindNicknameInput(document.querySelector("[data-player-name]"));
 */
export class ProfileController {
  constructor(options = {}) {
    this.store = options.store || new ProfileStore();
    this.document = options.documentRef ?? globalThis.document;
    this.gameLabels = isRecord(options.gameLabels) ? options.gameLabels : {};
    this.onChange = typeof options.onChange === "function" ? options.onChange : null;
    this.root = null;
    this.dialog = null;
    this.form = null;
    this.disposers = [];
    this.unsubscribe = this.store.subscribe((profile, context) => {
      this.#render(profile);
      this.onChange?.(profile, context);
    });
  }

  mount(target) {
    if (!this.document) throw new Error("ProfileController.mount requires a document.");
    const container = typeof target === "string"
      ? this.document.querySelector(target)
      : target;
    if (!container || typeof container.append !== "function") {
      throw new TypeError("ProfileController.mount requires a DOM element or matching selector.");
    }
    if (this.root) return this;

    const template = this.document.createElement("template");
    template.innerHTML = profileTemplate.trim();
    this.root = template.content.firstElementChild;
    container.append(this.root);

    this.dialog = this.root.querySelector(".profile-dialog");
    this.form = this.root.querySelector(".profile-form");
    const trigger = this.root.querySelector(".profile-trigger");
    const closeButton = this.root.querySelector(".profile-close");
    const cancelButton = this.root.querySelector(".profile-cancel");

    trigger.addEventListener("click", () => this.open());
    closeButton.addEventListener("click", () => this.close());
    cancelButton.addEventListener("click", () => this.close());
    this.form.addEventListener("submit", (event) => this.#submit(event));
    this.dialog.addEventListener("close", () => trigger.setAttribute("aria-expanded", "false"));
    this.dialog.addEventListener("click", (event) => {
      if (event.target === this.dialog) this.close();
    });
    this.#render(this.store.getProfile(), true);
    return this;
  }

  open() {
    if (!this.dialog) throw new Error("Mount ProfileController before opening it.");
    this.#render(this.store.getProfile(), true);
    this.root.querySelector(".profile-trigger").setAttribute("aria-expanded", "true");
    if (typeof this.dialog.showModal === "function") {
      if (!this.dialog.open) this.dialog.showModal();
    } else {
      this.dialog.setAttribute("open", "");
    }
    this.form.elements.nickname.focus();
  }

  close() {
    if (!this.dialog) return;
    if (typeof this.dialog.close === "function" && this.dialog.open) {
      this.dialog.close();
    } else {
      this.dialog.removeAttribute("open");
      this.root.querySelector(".profile-trigger")?.setAttribute("aria-expanded", "false");
    }
  }

  bindNicknameInput(input, options = {}) {
    if (!input || typeof input.addEventListener !== "function") {
      throw new TypeError("bindNicknameInput requires an input element.");
    }
    const eventName = options.saveOn === "input" ? "input" : "change";
    if (!input.value) input.value = this.store.nickname;
    const save = () => {
      const nickname = normalizeNickname(input.value);
      input.value = nickname;
      if (nickname && nickname !== this.store.nickname) this.store.setIdentity({ nickname });
    };
    const sync = (profile) => {
      if (this.document?.activeElement !== input && input.value !== profile.nickname) {
        input.value = profile.nickname;
      }
    };
    input.addEventListener(eventName, save);
    const unsubscribe = this.store.subscribe(sync);
    const dispose = () => {
      input.removeEventListener(eventName, save);
      unsubscribe();
    };
    this.disposers.push(dispose);
    return dispose;
  }

  recordGame(gameId, result) {
    return this.store.recordGame(gameId, result);
  }

  #submit(event) {
    event.preventDefault();
    const nicknameInput = this.form.elements.nickname;
    const nickname = normalizeNickname(nicknameInput.value);
    nicknameInput.value = nickname;
    nicknameInput.setCustomValidity(nickname ? "" : "Enter a nickname.");
    if (!this.form.reportValidity()) return;

    const formData = new FormData(this.form);
    const profile = this.store.setIdentity({
      nickname,
      avatar: formData.get("avatar"),
      accent: formData.get("accent"),
    });
    const status = this.root.querySelector("[data-profile-save-status]");
    status.textContent = this.store.persistenceAvailable
      ? "Profile saved."
      : "Profile saved for this visit.";
    this.#dispatchChange(profile);
    globalThis.setTimeout?.(() => this.close(), 180);
  }

  #dispatchChange(profile) {
    const CustomEventConstructor = this.document?.defaultView?.CustomEvent;
    if (!CustomEventConstructor || !this.root) return;
    this.root.dispatchEvent(new CustomEventConstructor("simplegames:profilechange", {
      bubbles: true,
      detail: { profile },
    }));
  }

  #render(profile, syncForm = false) {
    if (!this.root) return;
    const accent = PROFILE_ACCENTS.find((option) => option.id === profile.accent)
      || PROFILE_ACCENTS[0];
    const avatar = PROFILE_AVATARS.find((option) => option.id === profile.avatar)
      || PROFILE_AVATARS[0];
    this.root.style.setProperty("--profile-accent", accent.color);
    this.root.querySelector("[data-profile-avatar]").textContent = avatar.glyph;
    this.root.querySelector("[data-profile-trigger-name]").textContent =
      profile.nickname || "Set up player";
    this.root.querySelector("[data-profile-storage-note]").hidden =
      this.store.persistenceAvailable;

    if (this.form && (syncForm || !this.dialog?.open)) {
      this.form.elements.nickname.value = profile.nickname;
      const avatarInput = this.form.querySelector(`[name="avatar"][value="${profile.avatar}"]`);
      const accentInput = this.form.querySelector(`[name="accent"][value="${profile.accent}"]`);
      if (avatarInput) avatarInput.checked = true;
      if (accentInput) accentInput.checked = true;
      this.root.querySelector("[data-profile-save-status]").textContent = "";
    }
    this.#renderStats(profile.stats);
  }

  #renderStats(stats) {
    const list = this.root.querySelector("[data-profile-stats]");
    list.replaceChildren();
    const entries = Object.entries(stats)
      .filter(([, record]) => record.played > 0)
      .sort((left, right) => {
        const leftTime = Date.parse(left[1].lastPlayedAt || 0) || 0;
        const rightTime = Date.parse(right[1].lastPlayedAt || 0) || 0;
        return rightTime - leftTime;
      });

    if (!entries.length) {
      const empty = this.document.createElement("p");
      empty.className = "profile-stats-empty";
      empty.textContent = "Your first result will appear here.";
      list.append(empty);
      return;
    }

    for (const [gameId, record] of entries) {
      const row = this.document.createElement("article");
      row.className = "profile-stat-row";
      const title = this.document.createElement("b");
      title.textContent = this.gameLabels[gameId] || gameId
        .split("-")
        .map((part) => part ? part[0].toUpperCase() + part.slice(1) : "")
        .join(" ");
      const summary = this.document.createElement("span");
      const successCount = record.wins + record.completions;
      summary.textContent = `${record.played} played · ${successCount} won`;
      const best = this.document.createElement("em");
      best.textContent = record.bestScore > 0 ? `Best ${record.bestScore}` : "";
      row.append(title, summary, best);
      list.append(row);
    }
  }

  destroy() {
    this.close();
    this.unsubscribe?.();
    for (const dispose of this.disposers.splice(0)) dispose();
    this.root?.remove();
    this.root = null;
    this.dialog = null;
    this.form = null;
  }
}

export const PlayerProfileController = ProfileController;
