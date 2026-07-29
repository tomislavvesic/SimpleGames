import { routeFourSides } from "./games/four-sides/server/routes.js";
import { routeSignalCrew } from "./games/signal-crew/server/routes.js";
import { json, secureAssetResponse } from "./shared/server/http.js";

export { GameRoom } from "./games/four-sides/server/game-room.js";
export { SignalRoom } from "./games/signal-crew/server/signal-room.js";
export { LobbyDirectory } from "./shared/server/lobby-directory.js";

const apiRoutes = [routeFourSides, routeSignalCrew];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/") && request.method === "POST") {
      const origin = request.headers.get("origin");
      if (origin && origin !== url.origin) {
        return json({ error: "Origin not allowed" }, 403);
      }
    }

    for (const route of apiRoutes) {
      const response = await route(request, env, url);
      if (response) return response;
    }

    if (url.pathname.startsWith("/api/")) {
      return json({ error: "Not found" }, 404);
    }
    const asset = await env.ASSETS.fetch(request);
    return secureAssetResponse(asset, url);
  },
};
