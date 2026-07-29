import {
  allowRoomMutation,
  initializeRoom,
  json,
  readJson,
} from "../../../shared/server/http.js";
import { FOUR_SIDES_MODES } from "./config.js";

function roomConfig(code, mode, options = {}) {
  return {
    code,
    game: "four-sides",
    ownerToken: crypto.randomUUID(),
    ownerPlayerId: crypto.randomUUID(),
    ownerAuthToken: crypto.randomUUID(),
    ownerSide: FOUR_SIDES_MODES[mode].sides[0],
    mode,
    isPublic: options.isPublic,
    bots: options.bots,
    createdAt: Date.now(),
  };
}

async function requestBody(request) {
  try {
    return { body: await readJson(request) };
  } catch (error) {
    return {
      response: json(
        { error: error.message },
        error.message === "Request too large" ? 413 : 400,
      ),
    };
  }
}

export async function routeFourSides(request, env, url) {
  if (url.pathname === "/api/rooms" && request.method === "GET") {
    return env.LOBBY_DIRECTORY.getByName("global").fetch(
      "https://directory.internal/?game=four-sides",
    );
  }

  if (url.pathname === "/api/rooms/create" && request.method === "POST") {
    if (!await allowRoomMutation(request, env, "four-create")) {
      return json({ error: "Too many room requests. Try again in a minute." }, 429);
    }
    const parsed = await requestBody(request);
    if (parsed.response) return parsed.response;
    const mode = FOUR_SIDES_MODES[parsed.body.mode] ? parsed.body.mode : "duel";
    const config = await initializeRoom(
      env.GAME_ROOMS,
      (code) => roomConfig(code, mode, {
        isPublic: parsed.body.isPublic !== false,
        bots: parsed.body.bots !== false,
      }),
    );
    return json(config, 201);
  }

  if (url.pathname === "/api/rooms/quick" && request.method === "POST") {
    if (!await allowRoomMutation(request, env, "four-quick")) {
      return json({ error: "Too many matchmaking requests. Try again in a minute." }, 429);
    }
    const parsed = await requestBody(request);
    if (parsed.response) return parsed.response;
    const mode = FOUR_SIDES_MODES[parsed.body.mode] ? parsed.body.mode : "duel";
    const directory = env.LOBBY_DIRECTORY.getByName("global");
    const match = await directory.fetch(`https://directory.internal/match?mode=${mode}`);
    const found = await match.json();
    if (found.code) return json(found);

    const config = await initializeRoom(
      env.GAME_ROOMS,
      (code) => roomConfig(code, mode, { isPublic: true, bots: true }),
    );
    return json(config, 201);
  }

  const roomMatch = url.pathname.match(/^\/api\/rooms\/([A-Z0-9]{6})\/socket$/);
  if (roomMatch) return env.GAME_ROOMS.getByName(roomMatch[1]).fetch(request);

  return null;
}
