import { fourSidesManifest } from "../games/four-sides/manifest.js";
import { signalCrewManifest } from "../games/signal-crew/manifest.js";
import { oneWayOutManifest } from "../games/one-way-out/manifest.js";

const REQUIRED_TEXT_FIELDS = Object.freeze([
  "id",
  "title",
  "route",
  "category",
  "players",
  "description",
  "profileId",
  "launchAttribute",
]);

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LAUNCH_ATTRIBUTE_PATTERN = /^data-[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function validateGameCatalog(catalog) {
  if (!Array.isArray(catalog) || catalog.length === 0) {
    throw new TypeError("The game catalog must contain at least one manifest.");
  }

  const ids = new Set();
  const routes = new Set();
  const legacyQueries = new Set();
  const profileIds = new Set();
  const launchAttributes = new Set();

  for (const manifest of catalog) {
    if (!manifest || typeof manifest !== "object") {
      throw new TypeError("Every game manifest must be an object.");
    }

    for (const field of REQUIRED_TEXT_FIELDS) {
      if (typeof manifest[field] !== "string" || !manifest[field].trim()) {
        throw new TypeError(`Game manifest field "${field}" must be a non-empty string.`);
      }
    }

    if (!ID_PATTERN.test(manifest.id)) {
      throw new TypeError(`Game id "${manifest.id}" must be lowercase kebab-case.`);
    }
    if (manifest.route !== `/games/${manifest.id}`) {
      throw new TypeError(`Game "${manifest.id}" must use the canonical route "/games/${manifest.id}".`);
    }
    if (!LAUNCH_ATTRIBUTE_PATTERN.test(manifest.launchAttribute)) {
      throw new TypeError(`Game "${manifest.id}" has an invalid launch attribute.`);
    }
    if (manifest.legacyQuery !== null
      && (typeof manifest.legacyQuery !== "string" || !ID_PATTERN.test(manifest.legacyQuery))) {
      throw new TypeError(`Game "${manifest.id}" has an invalid legacy query key.`);
    }
    if (!manifest.art
      || typeof manifest.art.className !== "string"
      || typeof manifest.art.markup !== "string") {
      throw new TypeError(`Game "${manifest.id}" must define card art metadata.`);
    }
    if (typeof manifest.featured !== "boolean") {
      throw new TypeError(`Game "${manifest.id}" must declare whether it is featured.`);
    }
    if (typeof manifest.load !== "function") {
      throw new TypeError(`Game "${manifest.id}" must provide a lazy load function.`);
    }
    if (ids.has(manifest.id) || routes.has(manifest.route)) {
      throw new TypeError(`Game manifest ids and routes must be unique ("${manifest.id}").`);
    }
    if (manifest.legacyQuery && legacyQueries.has(manifest.legacyQuery)) {
      throw new TypeError(`Legacy query key "${manifest.legacyQuery}" is registered more than once.`);
    }
    if (profileIds.has(manifest.profileId)) {
      throw new TypeError(`Profile id "${manifest.profileId}" is registered more than once.`);
    }
    if (launchAttributes.has(manifest.launchAttribute)) {
      throw new TypeError(`Launch attribute "${manifest.launchAttribute}" is registered more than once.`);
    }

    ids.add(manifest.id);
    routes.add(manifest.route);
    profileIds.add(manifest.profileId);
    launchAttributes.add(manifest.launchAttribute);
    if (manifest.legacyQuery) legacyQueries.add(manifest.legacyQuery);
  }

  return catalog;
}

export const GAME_CATALOG = Object.freeze(validateGameCatalog([
  fourSidesManifest,
  signalCrewManifest,
  oneWayOutManifest,
]));

export function normalizeRoute(pathname = "/") {
  if (typeof pathname !== "string") return "/";
  const normalized = pathname.replace(/\/{2,}/g, "/").replace(/\/+$/, "");
  return normalized || "/";
}

export function getGameById(id) {
  return GAME_CATALOG.find((game) => game.id === id) || null;
}

export function getGameForLocation(locationLike = globalThis.location) {
  if (!locationLike) return null;
  const pathname = normalizeRoute(locationLike.pathname);
  const routeMatch = GAME_CATALOG.find((game) => game.route === pathname);
  if (routeMatch) return routeMatch;

  const search = locationLike.search instanceof URLSearchParams
    ? locationLike.search
    : new URLSearchParams(locationLike.search || "");
  return GAME_CATALOG.find((game) => game.legacyQuery && search.has(game.legacyQuery)) || null;
}
