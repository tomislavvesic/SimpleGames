import {
  allowRoomMutation,
  initializeRoom,
  json,
  readJson,
} from "../../../shared/server/http.js";

function roomConfig(code, options = {}) {
  return {
    code,
    game: "signal-crew",
    ownerToken: crypto.randomUUID(),
    ownerPlayerId: crypto.randomUUID(),
    ownerAuthToken: crypto.randomUUID(),
    ownerStation: "power",
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

export async function routeSignalCrew(request, env, url) {
  if (url.pathname === "/api/signal/rooms" && request.method === "GET") {
    return env.LOBBY_DIRECTORY.getByName("global").fetch(
      "https://directory.internal/?game=signal-crew",
    );
  }

  if (url.pathname === "/api/signal/rooms/create" && request.method === "POST") {
    if (!await allowRoomMutation(request, env, "signal-create")) {
      return json({ error: "Too many room requests. Try again in a minute." }, 429);
    }
    const parsed = await requestBody(request);
    if (parsed.response) return parsed.response;
    const config = await initializeRoom(
      env.SIGNAL_ROOMS,
      (code) => roomConfig(code, {
        isPublic: parsed.body.isPublic !== false,
        bots: parsed.body.bots !== false,
      }),
    );
    return json(config, 201);
  }

  if (url.pathname === "/api/signal/rooms/quick" && request.method === "POST") {
    if (!await allowRoomMutation(request, env, "signal-quick")) {
      return json({ error: "Too many matchmaking requests. Try again in a minute." }, 429);
    }
    const directory = env.LOBBY_DIRECTORY.getByName("global");
    const match = await directory.fetch("https://directory.internal/match?game=signal-crew");
    const found = await match.json();
    if (found.code) return json(found);
    const config = await initializeRoom(
      env.SIGNAL_ROOMS,
      (code) => roomConfig(code, { isPublic: true, bots: true }),
    );
    return json(config, 201);
  }

  const roomMatch = url.pathname.match(
    /^\/api\/signal\/rooms\/([A-Z0-9]{6})\/socket$/,
  );
  if (roomMatch) return env.SIGNAL_ROOMS.getByName(roomMatch[1]).fetch(request);

  return null;
}
