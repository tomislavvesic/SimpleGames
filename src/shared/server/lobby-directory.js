import { DurableObject } from "cloudflare:workers";
import { FOUR_SIDES_MODES } from "../../games/four-sides/server/config.js";
import { json } from "./http.js";

export class LobbyDirectory extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/permit") {
      const scope = (url.searchParams.get("scope") || "").replace(/[^a-z-]/g, "").slice(0, 32);
      const key = (url.searchParams.get("key") || "").replace(/[^a-f0-9]/g, "").slice(0, 24);
      if (!scope || key.length !== 24) return json({ error: "Invalid rate key" }, 400);
      const windowId = Math.floor(Date.now() / 60_000);
      const storageKey = `rate:${scope}:${key}:${windowId}`;
      const current = Number(await this.ctx.storage.get(storageKey) || 0);
      if (current >= 20) return json({ error: "Rate limit exceeded" }, 429);
      await this.ctx.storage.put(storageKey, current + 1);
      return json({ ok: true, remaining: 19 - current });
    }

    if (request.method === "POST" && url.pathname === "/update") {
      const room = await request.json();
      const existing = await this.ctx.storage.get(room.code);
      if (existing && Number(existing.revision || 0) > Number(room.revision || 0)) {
        return json({ ok: true, stale: true });
      }
      await this.ctx.storage.put(room.code, { ...room, updatedAt: Date.now() });
      return json({ ok: true });
    }

    const entries = await this.ctx.storage.list();
    const cutoff = Date.now() - 1000 * 60 * 60 * 24;
    const currentWindow = Math.floor(Date.now() / 60_000);
    const staleKeys = [...entries.entries()]
      .filter(([key, room]) => key.startsWith("rate:")
        ? Number(key.split(":").at(-1)) < currentWindow - 1
        : !room.updatedAt || room.updatedAt <= cutoff)
      .map(([key]) => key);
    for (let index = 0; index < staleKeys.length; index += 128) {
      await this.ctx.storage.delete(staleKeys.slice(index, index + 128));
    }

    const game = url.searchParams.get("game") || "four-sides";
    const rooms = [...entries.values()]
      .filter((room) => room.isPublic && room.status === "lobby" && room.updatedAt > cutoff)
      .filter((room) => (room.game || "four-sides") === game)
      .sort((a, b) => b.createdAt - a.createdAt);

    if (url.pathname === "/match") {
      const mode = url.searchParams.get("mode");
      const match = rooms.find((room) => game === "signal-crew"
        ? room.players < 4
        : room.mode === mode && room.players < FOUR_SIDES_MODES[mode].maxPlayers);
      return json(match || {});
    }
    return json({ rooms: rooms.slice(0, 20) });
  }
}
