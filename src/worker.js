import { DurableObject } from "cloudflare:workers";

const SIDES = ["left", "top", "right", "bottom"];
const MODES = {
  duel: { label: "1 vs 1", sides: ["left", "right"], maxPlayers: 2, target: 7 },
  teams: { label: "2 vs 2", sides: SIDES, maxPlayers: 4, target: 7 },
  ffa: { label: "Four for all", sides: SIDES, maxPlayers: 4, target: 7 },
};
const COLORS = { left: "#ff725e", top: "#69a7ff", right: "#ffd45c", bottom: "#63d6ae" };

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function roomCode() {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/rooms" && request.method === "GET") {
      return env.LOBBY_DIRECTORY.getByName("global").fetch(request);
    }

    if (url.pathname === "/api/rooms/create" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const mode = MODES[body.mode] ? body.mode : "duel";
      const code = roomCode();
      const config = {
        code,
        mode,
        isPublic: body.isPublic !== false,
        bots: body.bots !== false,
        createdAt: Date.now(),
      };
      const room = env.GAME_ROOMS.getByName(code);
      await room.fetch("https://room.internal/init", {
        method: "POST",
        body: JSON.stringify(config),
      });
      await env.LOBBY_DIRECTORY.getByName("global").fetch("https://directory.internal/update", {
        method: "POST",
        body: JSON.stringify({ ...config, players: 0, status: "lobby" }),
      });
      return json(config, 201);
    }

    if (url.pathname === "/api/rooms/quick" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const mode = MODES[body.mode] ? body.mode : "duel";
      const directory = env.LOBBY_DIRECTORY.getByName("global");
      const match = await directory.fetch(`https://directory.internal/match?mode=${mode}`);
      const found = await match.json();
      if (found.code) return json(found);

      const code = roomCode();
      const config = { code, mode, isPublic: true, bots: true, createdAt: Date.now() };
      await env.GAME_ROOMS.getByName(code).fetch("https://room.internal/init", {
        method: "POST",
        body: JSON.stringify(config),
      });
      await directory.fetch("https://directory.internal/update", {
        method: "POST",
        body: JSON.stringify({ ...config, players: 0, status: "lobby" }),
      });
      return json(config, 201);
    }

    const roomMatch = url.pathname.match(/^\/api\/rooms\/([A-Z0-9]{6})\/socket$/);
    if (roomMatch) {
      return env.GAME_ROOMS.getByName(roomMatch[1]).fetch(request);
    }

    if (url.pathname.startsWith("/api/")) return json({ error: "Not found" }, 404);
    return env.ASSETS.fetch(request);
  },
};

export class LobbyDirectory extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/update") {
      const room = await request.json();
      if (room.status === "closed") {
        await this.ctx.storage.delete(room.code);
      } else {
        await this.ctx.storage.put(room.code, { ...room, updatedAt: Date.now() });
      }
      return json({ ok: true });
    }

    const entries = await this.ctx.storage.list();
    const cutoff = Date.now() - 1000 * 60 * 60 * 3;
    const rooms = [...entries.values()]
      .filter((room) => room.isPublic && room.status === "lobby" && room.updatedAt > cutoff)
      .sort((a, b) => b.createdAt - a.createdAt);

    if (url.pathname === "/match") {
      const mode = url.searchParams.get("mode");
      const match = rooms.find((room) => room.mode === mode && room.players < MODES[mode].maxPlayers);
      return json(match || {});
    }
    return json({ rooms: rooms.slice(0, 20) });
  }
}

export class GameRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
    this.config = null;
    this.status = "lobby";
    this.players = new Map();
    this.hostId = null;
    this.game = null;
    this.loop = null;
    this.lastTick = 0;
    this.lastBroadcast = 0;
    this.ctx.blockConcurrencyWhile(async () => {
      const saved = await this.ctx.storage.get(["config", "status", "hostId"]);
      this.config = saved.get("config") || null;
      this.status = saved.get("status") || "lobby";
      this.hostId = saved.get("hostId") || null;
      this.restoreSockets();
    });
  }

  restoreSockets() {
    this.players.clear();
    for (const ws of this.ctx.getWebSockets()) {
      const player = ws.deserializeAttachment();
      if (player?.id) this.players.set(player.id, { ...player, ws, connected: true, input: 0 });
    }
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/init" && request.method === "POST") {
      if (!this.config) {
        this.config = await request.json();
        await this.ctx.storage.put("config", this.config);
      }
      return json(this.config);
    }

    if (!this.config) return json({ error: "Room not found" }, 404);
    if (request.headers.get("Upgrade") !== "websocket") return json({ error: "WebSocket required" }, 426);
    const name = (url.searchParams.get("name") || "Player").trim().slice(0, 18);
    const requestedId = url.searchParams.get("player") || crypto.randomUUID();
    const mode = MODES[this.config.mode];
    const existing = this.players.get(requestedId);
    if (this.status === "playing" && (!existing || existing.connected)) {
      return json({ error: "Match already in progress" }, 409);
    }
    const occupied = new Set([...this.players.values()].filter((p) => p.connected && p.id !== requestedId).map((p) => p.side));
    const side = existing?.side || mode.sides.find((candidate) => !occupied.has(candidate));
    if (!side) return json({ error: "Room is full" }, 409);

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const player = {
      id: requestedId,
      name,
      side,
      color: COLORS[side],
      ready: existing?.ready || false,
      connected: true,
      input: 0,
      joinedAt: existing?.joinedAt || Date.now(),
    };
    server.serializeAttachment({ id: player.id, name, side, color: player.color, ready: player.ready, joinedAt: player.joinedAt });
    this.ctx.acceptWebSocket(server, [`player:${player.id}`]);
    player.ws = server;
    this.players.set(player.id, player);

    if (!this.hostId || !this.players.get(this.hostId)?.connected) {
      this.hostId = player.id;
      await this.ctx.storage.put("hostId", this.hostId);
    }

    server.send(JSON.stringify({ type: "welcome", playerId: player.id, side, code: this.config.code }));
    if (this.status === "playing") {
      server.send(JSON.stringify({ type: "game-start", mode: this.config.mode, target: mode.target }));
      if (this.game) server.send(JSON.stringify(this.snapshotPayload()));
    } else {
      await this.updateDirectory();
      this.broadcastLobby();
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    let message;
    try {
      message = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
    } catch {
      return;
    }
    const attachment = ws.deserializeAttachment();
    const player = this.players.get(attachment?.id);
    if (!player) return;

    if (message.type === "input") {
      player.input = Math.max(-1, Math.min(1, Number(message.direction) || 0));
      return;
    }
    if (message.type === "ready" && this.status === "lobby") {
      player.ready = Boolean(message.ready);
      this.saveAttachment(player);
      this.broadcastLobby();
      return;
    }
    if (message.type === "settings" && player.id === this.hostId && this.status === "lobby") {
      if (typeof message.bots === "boolean") this.config.bots = message.bots;
      if (typeof message.isPublic === "boolean") this.config.isPublic = message.isPublic;
      await this.ctx.storage.put("config", this.config);
      await this.updateDirectory();
      this.broadcastLobby();
      return;
    }
    if (message.type === "start" && player.id === this.hostId && this.status === "lobby") {
      const humans = [...this.players.values()].filter((p) => p.connected);
      const everyoneReady = humans.every((p) => p.id === this.hostId || p.ready);
      const enough = humans.length >= 2 || this.config.bots;
      if (everyoneReady && enough) await this.startGame();
    }
  }

  async webSocketClose(ws) {
    const attachment = ws.deserializeAttachment();
    const player = this.players.get(attachment?.id);
    if (!player) return;
    player.connected = false;
    player.ws = null;
    player.input = 0;

    if (this.status === "lobby") {
      this.players.delete(player.id);
      if (player.id === this.hostId) {
        this.hostId = [...this.players.values()].find((p) => p.connected)?.id || null;
        await this.ctx.storage.put("hostId", this.hostId);
      }
      await this.updateDirectory();
      this.broadcastLobby();
    } else {
      this.broadcastEvent({ type: "notice", text: `${player.name} disconnected — bot took over.` });
    }
  }

  saveAttachment(player) {
    player.ws?.serializeAttachment({
      id: player.id,
      name: player.name,
      side: player.side,
      color: player.color,
      ready: player.ready,
      joinedAt: player.joinedAt,
    });
  }

  lobbyPayload() {
    const mode = MODES[this.config.mode];
    const players = mode.sides.map((side) => {
      const human = [...this.players.values()].find((p) => p.side === side && p.connected);
      return human
        ? { id: human.id, name: human.name, side, color: COLORS[side], ready: human.ready, bot: false }
        : { id: `bot-${side}`, name: this.config.bots ? "Bot" : "Open slot", side, color: COLORS[side], ready: this.config.bots, bot: this.config.bots };
    });
    return {
      type: "lobby",
      code: this.config.code,
      mode: this.config.mode,
      modeLabel: mode.label,
      hostId: this.hostId,
      bots: this.config.bots,
      isPublic: this.config.isPublic,
      players,
    };
  }

  broadcastLobby() {
    this.broadcast(this.lobbyPayload());
  }

  broadcastEvent(payload) {
    this.broadcast(payload);
  }

  broadcast(payload) {
    const data = JSON.stringify(payload);
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(data); } catch {}
    }
  }

  async updateDirectory(status = this.status) {
    if (!this.config) return;
    const players = [...this.players.values()].filter((p) => p.connected).length;
    await this.env.LOBBY_DIRECTORY.getByName("global").fetch("https://directory.internal/update", {
      method: "POST",
      body: JSON.stringify({ ...this.config, players, status }),
    });
  }

  async startGame() {
    this.status = "playing";
    await this.ctx.storage.put("status", "playing");
    await this.updateDirectory("playing");
    const mode = MODES[this.config.mode];
    const paddles = {};
    for (const side of mode.sides) {
      const human = [...this.players.values()].find((p) => p.side === side && p.connected);
      paddles[side] = {
        side,
        pos: 0.5,
        color: COLORS[side],
        playerId: human?.id || null,
        name: human?.name || "Bot",
        bot: !human,
        score: 0,
      };
    }
    this.game = {
      paddles,
      balls: [],
      elapsed: 0,
      countdown: 3,
      roundOver: false,
      winner: null,
    };
    this.spawnBall();
    this.broadcast({ type: "game-start", mode: this.config.mode, target: mode.target });
    this.lastTick = Date.now();
    this.lastBroadcast = 0;
    this.loop = setInterval(() => this.tick(), 1000 / 60);
  }

  spawnBall(servingSide = null) {
    const angle = servingSide
      ? ({ left: Math.PI, right: 0, top: -Math.PI / 2, bottom: Math.PI / 2 })[servingSide] + (Math.random() - 0.5) * 0.7
      : Math.random() * Math.PI * 2;
    this.game.balls = [{
      x: 0.5,
      y: 0.5,
      vx: Math.cos(angle) * 0.34,
      vy: Math.sin(angle) * 0.34,
      lastHit: null,
    }];
  }

  tick() {
    if (!this.game || this.game.roundOver) return;
    const now = Date.now();
    const dt = Math.min((now - this.lastTick) / 1000, 0.033);
    this.lastTick = now;
    this.game.elapsed += dt;

    if (this.game.countdown > 0) {
      this.game.countdown = Math.max(0, this.game.countdown - dt);
      this.maybeBroadcast(now);
      return;
    }

    for (const paddle of Object.values(this.game.paddles)) {
      const player = paddle.playerId ? this.players.get(paddle.playerId) : null;
      const useBot = paddle.bot || !player?.connected;
      let direction = player?.input || 0;
      if (useBot) {
        const ball = this.nearestBall(paddle);
        const target = paddle.side === "left" || paddle.side === "right" ? ball?.y : ball?.x;
        direction = target == null || Math.abs(target - paddle.pos) < 0.025 ? 0 : Math.sign(target - paddle.pos);
      }
      paddle.pos = Math.max(0.16, Math.min(0.84, paddle.pos + direction * dt * (useBot ? 0.43 : 0.66)));
    }

    for (const ball of this.game.balls) {
      ball.x += ball.vx * dt;
      ball.y += ball.vy * dt;
      this.collide(ball);
      const missed = ball.x < -0.035 ? "left" : ball.x > 1.035 ? "right" : ball.y < -0.05 ? "top" : ball.y > 1.05 ? "bottom" : null;
      if (missed) {
        this.scorePoint(missed, ball.lastHit);
        if (!this.game.roundOver) {
          this.game.countdown = 1.6;
          this.spawnBall(missed);
        }
        break;
      }
    }
    this.maybeBroadcast(now);
  }

  nearestBall(paddle) {
    return this.game.balls.reduce((best, ball) => {
      const distance = paddle.side === "left" || paddle.side === "right"
        ? Math.abs(ball.x - (paddle.side === "left" ? 0 : 1))
        : Math.abs(ball.y - (paddle.side === "top" ? 0 : 1));
      return !best || distance < best.distance ? { ...ball, distance } : best;
    }, null);
  }

  collide(ball) {
    const half = 0.105;
    const edge = 0.035;
    const hit = (side) => {
      const paddle = this.game.paddles[side];
      if (!paddle) return false;
      const along = side === "left" || side === "right" ? ball.y : ball.x;
      if (Math.abs(along - paddle.pos) > half) return false;
      ball.lastHit = side;
      const english = (along - paddle.pos) * 0.34;
      if (side === "left") { ball.x = edge; ball.vx = Math.abs(ball.vx) * 1.025; ball.vy += english; }
      if (side === "right") { ball.x = 1 - edge; ball.vx = -Math.abs(ball.vx) * 1.025; ball.vy += english; }
      if (side === "top") { ball.y = edge; ball.vy = Math.abs(ball.vy) * 1.025; ball.vx += english; }
      if (side === "bottom") { ball.y = 1 - edge; ball.vy = -Math.abs(ball.vy) * 1.025; ball.vx += english; }
      const speed = Math.hypot(ball.vx, ball.vy);
      if (speed > 0.62) { ball.vx *= 0.62 / speed; ball.vy *= 0.62 / speed; }
      return true;
    };
    if (ball.vx < 0 && ball.x <= edge) hit("left");
    if (ball.vx > 0 && ball.x >= 1 - edge) hit("right");
    if (ball.vy < 0 && ball.y <= edge) hit("top");
    if (ball.vy > 0 && ball.y >= 1 - edge) hit("bottom");

    // In duel mode the unused top and bottom edges are solid walls.
    if (this.config.mode === "duel") {
      if (ball.y < edge) { ball.y = edge; ball.vy = Math.abs(ball.vy); }
      if (ball.y > 1 - edge) { ball.y = 1 - edge; ball.vy = -Math.abs(ball.vy); }
    }
  }

  scorePoint(missed, lastHit) {
    const paddles = this.game.paddles;
    if (this.config.mode === "duel") {
      const scorer = missed === "left" ? "right" : "left";
      paddles[scorer].score += 1;
    } else if (this.config.mode === "teams") {
      const teams = { left: "warm", bottom: "warm", top: "cool", right: "cool" };
      const scoringTeam = teams[missed] === "warm" ? "cool" : "warm";
      Object.values(paddles).filter((p) => teams[p.side] === scoringTeam).forEach((p) => (p.score += 1));
    } else if (lastHit && lastHit !== missed) {
      paddles[lastHit].score += 1;
    } else {
      Object.values(paddles).filter((p) => p.side !== missed).forEach((p) => (p.score += 1));
    }

    const winner = Object.values(paddles).find((p) => p.score >= MODES[this.config.mode].target);
    if (winner) this.finishGame(winner);
  }

  finishGame(winner) {
    this.game.roundOver = true;
    this.game.winner = this.config.mode === "teams"
      ? (["left", "bottom"].includes(winner.side) ? "Warm team" : "Cool team")
      : winner.name;
    clearInterval(this.loop);
    this.loop = null;
    this.broadcastSnapshot();
    setTimeout(() => this.returnToLobby(), 4500);
  }

  async returnToLobby() {
    this.status = "lobby";
    this.game = null;
    for (const player of this.players.values()) player.ready = false;
    await this.ctx.storage.put("status", "lobby");
    await this.updateDirectory("lobby");
    this.broadcast({ type: "return-lobby" });
    this.broadcastLobby();
  }

  maybeBroadcast(now) {
    if (now - this.lastBroadcast >= 50) {
      this.lastBroadcast = now;
      this.broadcastSnapshot();
    }
  }

  broadcastSnapshot() {
    if (!this.game) return;
    this.broadcast(this.snapshotPayload());
  }

  snapshotPayload() {
    return {
      type: "snapshot",
      time: Date.now(),
      countdown: Math.ceil(this.game.countdown),
      paddles: Object.values(this.game.paddles).map(({ side, pos, color, name, bot, score }) => ({ side, pos, color, name, bot, score })),
      balls: this.game.balls,
      roundOver: this.game.roundOver,
      winner: this.game.winner,
    };
  }
}
