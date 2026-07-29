import { DurableObject } from "cloudflare:workers";
import {
  advanceArenaBall,
  clampPaddle,
  predictPaddleTarget,
} from "../shared/physics.js";
import {
  cleanName,
  json,
  validClientSecret,
  websocketCredentials,
} from "../../../shared/server/http.js";
import { rematchQuorum } from "../../../shared/server/room-lifecycle.js";
import { FOUR_SIDES_COLORS as COLORS, FOUR_SIDES_MODES as MODES } from "./config.js";

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
    this.accumulator = 0;
    this.lifecycle = 0;
    this.directorySequence = 0;
    this.unclaimedDeadline = null;
    this.hostReconnectDeadline = null;
    this.ctx.blockConcurrencyWhile(async () => {
      const saved = await this.ctx.storage.get([
        "config",
        "status",
        "hostId",
        "game",
        "roster",
        "unclaimedDeadline",
        "hostReconnectDeadline",
      ]);
      this.config = saved.get("config") || null;
      this.status = saved.get("status") || "lobby";
      this.hostId = saved.get("hostId") || null;
      this.game = saved.get("game") || null;
      this.unclaimedDeadline = saved.get("unclaimedDeadline") || null;
      this.hostReconnectDeadline = saved.get("hostReconnectDeadline") || null;
      this.restoreSockets(saved.get("roster") || []);
      if (this.hostId && !this.players.get(this.hostId)?.connected && !this.hostReconnectDeadline) {
        this.hostReconnectDeadline = Date.now() + 18_000;
        await this.ctx.storage.put("hostReconnectDeadline", this.hostReconnectDeadline);
      }
      if (this.status === "playing") {
        this.status = "lobby";
        this.game = null;
        this.hostId = this.players.has(this.hostId) ? this.hostId : null;
        for (const player of this.players.values()) {
          player.ready = false;
          this.saveAttachment(player);
        }
        await Promise.all([
          this.ctx.storage.put("status", "lobby"),
          this.ctx.storage.delete("game"),
          this.persistRoster(),
        ]);
        this.broadcast({ type: "match-interrupted", reason: "The game server restarted. Everyone is back in the lobby." });
        this.broadcastLobby();
        if (this.hostId) await this.updateDirectory("lobby");
      }
      await this.scheduleNextAlarm();
    });
  }

  restoreSockets(roster = []) {
    this.players.clear();
    for (const saved of roster) {
      if (saved?.id) {
        this.players.set(saved.id, {
          ...saved,
          ws: null,
          connected: false,
          input: 0,
        });
      }
    }
    for (const ws of this.ctx.getWebSockets()) {
      const player = ws.deserializeAttachment();
      if (player?.id) {
        const saved = this.players.get(player.id) || {};
        this.players.set(player.id, { ...saved, ...player, ws, connected: true, input: 0 });
      }
    }
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/init" && request.method === "POST") {
      if (this.config || this.status === "closed") return json({ error: "Room code already exists" }, 409);
      this.config = await request.json();
      this.status = "lobby";
      this.unclaimedDeadline = Date.now() + 15 * 60 * 1000;
      await Promise.all([
        this.ctx.storage.put("config", this.config),
        this.ctx.storage.put("status", "lobby"),
        this.ctx.storage.put("unclaimedDeadline", this.unclaimedDeadline),
        this.ctx.storage.setAlarm(this.unclaimedDeadline),
      ]);
      return json(this.config, 201);
    }

    if (this.status === "closed") return json({ error: "Room is closed" }, 410);
    if (!this.config) return json({ error: "Room not found" }, 404);
    if (request.headers.get("Upgrade") !== "websocket") return json({ error: "WebSocket required" }, 426);
    const origin = request.headers.get("Origin");
    if (origin && origin !== url.origin) return json({ error: "Origin not allowed" }, 403);
    const name = cleanName(url.searchParams.get("name"));
    const {
      requestedId,
      authToken,
      ownerToken,
      negotiatedProtocol,
    } = websocketCredentials(request, url);
    if (!validClientSecret(requestedId) || !validClientSecret(authToken)) return json({ error: "Invalid player credentials" }, 400);
    const mode = MODES[this.config.mode];
    const existing = this.players.get(requestedId);
    const hasOwnerReservation = validClientSecret(this.config.ownerPlayerId)
      && validClientSecret(this.config.ownerAuthToken);
    const isReservedOwner = hasOwnerReservation && requestedId === this.config.ownerPlayerId;
    if (isReservedOwner && authToken !== this.config.ownerAuthToken) {
      return json({ error: "Invalid owner credentials" }, 403);
    }
    if (existing && existing.authToken !== authToken) return json({ error: "Invalid reconnect token" }, 403);
    if (existing?.connected) return json({ error: "Player is already connected" }, 409);
    if (["playing", "results"].includes(this.status) && (!existing || existing.connected)) {
      return json({ error: "Match already in progress" }, 409);
    }
    const occupied = new Set([...this.players.values()].filter((p) => p.id !== requestedId).map((p) => p.side));
    if (hasOwnerReservation && !existing && !isReservedOwner) occupied.add(this.config.ownerSide);
    const side = existing?.side
      || (isReservedOwner ? this.config.ownerSide : mode.sides.find((candidate) => !occupied.has(candidate)));
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
      authToken,
      connectionNonce: crypto.randomUUID(),
      joinedAt: existing?.joinedAt || Date.now(),
      replacedByBot: false,
      rematch: existing?.rematch || false,
      ws: server,
    };
    this.saveAttachment(player);
    this.ctx.acceptWebSocket(server, [`player:${player.id}`]);
    this.players.set(player.id, player);

    if (
      !this.hostId
      && ownerToken
      && ownerToken === this.config.ownerToken
      && (!hasOwnerReservation || isReservedOwner)
    ) {
      this.hostId = player.id;
      this.unclaimedDeadline = null;
    }
    if (player.id === this.hostId) this.hostReconnectDeadline = null;
    await Promise.all([
      this.persistRoster(),
      this.hostId ? this.ctx.storage.put("hostId", this.hostId) : Promise.resolve(),
      this.unclaimedDeadline === null ? this.ctx.storage.delete("unclaimedDeadline") : Promise.resolve(),
      this.hostReconnectDeadline === null ? this.ctx.storage.delete("hostReconnectDeadline") : Promise.resolve(),
    ]);
    await this.scheduleNextAlarm();

    server.send(JSON.stringify({ type: "welcome", playerId: player.id, side, code: this.config.code }));
    if (this.status !== "lobby") {
      server.send(JSON.stringify({
        type: "game-start",
        mode: this.config.mode,
        lives: 5,
        matchId: this.game?.matchId || null,
      }));
      if (this.game) server.send(JSON.stringify(this.snapshotPayload()));
      if (this.status === "results") {
        this.broadcastRematch();
        await this.recalculateRematch();
      }
    } else {
      if (this.hostId) await this.updateDirectory();
      this.broadcastLobby();
    }
    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: negotiatedProtocol ? { "sec-websocket-protocol": negotiatedProtocol } : undefined,
    });
  }

  async webSocketMessage(ws, raw) {
    if ((typeof raw === "string" ? raw.length : raw?.byteLength || 0) > 2048) {
      ws.close(1009, "Message too large");
      return;
    }
    let message;
    try {
      message = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
    } catch {
      return;
    }
    const attachment = ws.deserializeAttachment();
    const player = this.players.get(attachment?.id);
    if (!player || player.ws !== ws || player.connectionNonce !== attachment?.connectionNonce) return;
    const now = Date.now();
    if (!player.messageWindowAt || now - player.messageWindowAt >= 1000) {
      player.messageWindowAt = now;
      player.messageCount = 0;
    }
    player.messageCount += 1;
    if (player.messageCount > 90) {
      ws.close(1008, "Message rate exceeded");
      return;
    }

    if (message.type === "ping") {
      if (Number.isFinite(message.sentAt)) ws.send(JSON.stringify({ type: "pong", sentAt: message.sentAt }));
      return;
    }
    if (message.type === "input") {
      player.input = Math.max(-1, Math.min(1, Number(message.direction) || 0));
      return;
    }
    if (message.type === "ready" && this.status === "lobby") {
      player.ready = Boolean(message.ready);
      this.saveAttachment(player);
      await this.persistRoster();
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
      const enough = MODES[this.config.mode].sides.every((side) =>
        humans.some((p) => p.side === side)
        || this.config.bots
        || [...this.players.values()].some((p) => p.side === side && p.replacedByBot));
      if (everyoneReady && enough) await this.startGame();
      return;
    }
    if (message.type === "rematch" && this.game?.roundOver) {
      player.rematch = Boolean(message.vote);
      this.saveAttachment(player);
      await this.persistRoster();
      await this.recalculateRematch();
    }
  }

  async webSocketClose(ws, code = 1006) {
    const attachment = ws.deserializeAttachment();
    const player = this.players.get(attachment?.id);
    if (!player || player.ws !== ws || player.connectionNonce !== attachment?.connectionNonce) return;
    player.connected = false;
    player.ws = null;
    player.input = 0;
    player.replacedByBot = true;
    if (player.id === this.hostId && this.status !== "closed") {
      if (code === 1000) {
        await this.closeRoom("The Game Master left. This room has closed.");
      } else {
        this.broadcastEvent({ type: "notice", text: "Game Master reconnecting…" });
        this.hostReconnectDeadline = Date.now() + 18_000;
        await Promise.all([
          this.persistRoster(),
          this.ctx.storage.put("hostReconnectDeadline", this.hostReconnectDeadline),
          this.ctx.storage.setAlarm(this.hostReconnectDeadline),
        ]);
        if (this.status === "lobby") {
          await this.updateDirectory();
          this.broadcastLobby();
        }
      }
      return;
    }

    await this.persistRoster();
    if (this.status === "lobby") {
      if (this.hostId) await this.updateDirectory();
      this.broadcastLobby();
    } else {
      this.broadcastEvent({ type: "notice", text: `${player.name} disconnected — bot took over.` });
      if (this.status === "results") await this.recalculateRematch();
    }
  }

  async webSocketError(ws) {
    await this.webSocketClose(ws);
  }

  async scheduleNextAlarm() {
    const deadlines = [this.unclaimedDeadline, this.hostReconnectDeadline].filter(Number.isFinite);
    if (deadlines.length) {
      await this.ctx.storage.setAlarm(Math.max(Date.now(), Math.min(...deadlines)));
    } else {
      await this.ctx.storage.deleteAlarm();
    }
  }

  async alarm() {
    const now = Date.now();
    if (this.unclaimedDeadline && now >= this.unclaimedDeadline && !this.hostId) {
      await this.closeRoom("This unclaimed room expired.");
      return;
    }
    if (this.hostReconnectDeadline && now >= this.hostReconnectDeadline) {
      const host = this.players.get(this.hostId);
      if (!host?.connected) {
        await this.closeRoom("The Game Master could not reconnect. This room has closed.");
        return;
      }
      this.hostReconnectDeadline = null;
      await this.ctx.storage.delete("hostReconnectDeadline");
    }
    await this.scheduleNextAlarm();
  }

  async closeRoom(reason) {
    if (this.status === "closed") return;
    const closingConfig = this.config;
    const connectedPlayers = [...this.players.values()].filter((player) => player.connected).length;
    this.lifecycle += 1;
    this.status = "closed";
    if (this.loop) clearInterval(this.loop);
    this.loop = null;
    this.game = null;
    this.broadcast({ type: "room-closed", reason });
    for (const socket of this.ctx.getWebSockets()) {
      try { socket.close(1012, reason); } catch {}
    }
    this.players.clear();
    this.hostId = null;
    this.config = null;
    this.hostReconnectDeadline = null;
    this.unclaimedDeadline = null;
    await Promise.allSettled([
      this.ctx.storage.deleteAlarm(),
      this.publishDirectory(closingConfig, connectedPlayers, "closed"),
      this.ctx.storage.deleteAll(),
    ]);
  }

  saveAttachment(player) {
    player.ws?.serializeAttachment({
      id: player.id,
      name: player.name,
      side: player.side,
      color: player.color,
      ready: player.ready,
      joinedAt: player.joinedAt,
      rematch: player.rematch || false,
      authToken: player.authToken,
      connectionNonce: player.connectionNonce,
    });
  }

  persistRoster() {
    const roster = [...this.players.values()].map((player) => ({
      id: player.id,
      name: player.name,
      side: player.side,
      color: player.color,
      ready: Boolean(player.ready),
      joinedAt: player.joinedAt,
      rematch: Boolean(player.rematch),
      replacedByBot: Boolean(player.replacedByBot),
      authToken: player.authToken,
    }));
    return this.ctx.storage.put("roster", roster);
  }

  lobbyPayload() {
    const mode = MODES[this.config.mode];
    const players = mode.sides.map((side) => {
      const human = [...this.players.values()].find((p) => p.side === side && p.connected);
      const departed = [...this.players.values()].find((p) => p.side === side && p.replacedByBot);
      return human
        ? { id: human.id, name: human.name, side, color: COLORS[side], ready: human.ready, bot: false }
        : this.config.bots || departed
          ? { id: `bot-${side}`, name: departed ? `${departed.name} bot` : "Bot", side, color: COLORS[side], ready: true, bot: true }
          : { id: `open-${side}`, name: "Open slot", side, color: COLORS[side], ready: false, bot: false };
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

  nextDirectoryRevision() {
    this.directorySequence = (this.directorySequence + 1) % 100;
    return Date.now() * 100 + this.directorySequence;
  }

  async publishDirectory(config, players, status) {
    if (!config) return;
    const {
      ownerToken: _ownerToken,
      ownerPlayerId: _ownerPlayerId,
      ownerAuthToken: _ownerAuthToken,
      ownerSide: _ownerSide,
      ...publicConfig
    } = config;
    const revision = this.nextDirectoryRevision();
    try {
      await this.env.LOBBY_DIRECTORY.getByName("global").fetch("https://directory.internal/update", {
        method: "POST",
        body: JSON.stringify({ ...publicConfig, players, status, revision }),
      });
    } catch {
      // Directory discovery is optional; an invite-code game must remain playable.
    }
  }

  async updateDirectory(status = this.status) {
    if (!this.config) return;
    const players = [...this.players.values()].filter((p) => p.connected).length;
    await this.publishDirectory(this.config, players, status);
  }

  async startGame() {
    if (this.status !== "lobby" || !this.config) return;
    const transition = ++this.lifecycle;
    this.status = "playing";
    const mode = MODES[this.config.mode];
    const paddles = {};
    for (const side of mode.sides) {
      const owner = [...this.players.values()].find((p) => p.side === side);
      paddles[side] = {
        side,
        pos: 0.5,
        color: COLORS[side],
        playerId: owner?.id || null,
        name: owner?.name || "Bot",
        bot: !owner,
        velocity: 0,
        lives: 5,
        eliminated: false,
      };
    }
    this.game = {
      paddles,
      balls: [],
      elapsed: 0,
      countdown: 2,
      roundOver: false,
      winner: null,
      matchId: crypto.randomUUID(),
    };
    for (const player of this.players.values()) {
      player.rematch = false;
      this.saveAttachment(player);
    }
    this.spawnBall();
    this.broadcast({ type: "game-start", mode: this.config.mode, lives: 5, matchId: this.game.matchId });
    this.lastTick = Date.now();
    this.lastBroadcast = 0;
    this.accumulator = 0;
    if (this.loop) clearInterval(this.loop);
    this.loop = setInterval(() => this.tick(), 1000 / 60);
    await Promise.all([
      this.ctx.storage.put("status", "playing"),
      this.ctx.storage.delete("game"),
      this.persistRoster(),
    ]);
    if (transition !== this.lifecycle || this.status !== "playing") return;
    await this.updateDirectory("playing");
  }

  spawnBall(servingSide = null) {
    const launchDirections = [Math.PI * 0.25, Math.PI * 0.75, Math.PI * 1.25, Math.PI * 1.75];
    const angle = servingSide
      ? ({ left: 0, right: Math.PI, top: Math.PI / 2, bottom: -Math.PI / 2 })[servingSide] + (Math.random() - 0.5) * 0.9
      : launchDirections[Math.floor(Math.random() * launchDirections.length)] + (Math.random() - 0.5) * 0.44;
    this.game.balls = [{
      x: 0.5,
      y: 0.5,
      vx: Math.cos(angle) * 0.42,
      vy: Math.sin(angle) * 0.42,
      lastHit: null,
    }];
  }

  tick() {
    if (!this.game || this.game.roundOver) return;
    const now = Date.now();
    const frameTime = Math.min(Math.max((now - this.lastTick) / 1000, 0), 0.125);
    this.lastTick = now;
    this.accumulator = Math.min(this.accumulator + frameTime, 0.125);
    const fixedStep = 1 / 120;
    let steps = 0;
    while (this.accumulator >= fixedStep && steps < 15 && !this.game.roundOver) {
      this.stepGame(fixedStep);
      this.accumulator -= fixedStep;
      steps += 1;
    }
    this.maybeBroadcast(now);
  }

  stepGame(dt) {
    this.game.elapsed += dt;

    if (this.game.countdown > 0) {
      this.game.countdown = Math.max(0, this.game.countdown - dt);
      return;
    }

    for (const paddle of Object.values(this.game.paddles)) {
      const player = paddle.playerId ? this.players.get(paddle.playerId) : null;
      const useBot = paddle.bot || !player?.connected;
      if (paddle.eliminated) continue;
      if (useBot) {
        const target = this.botTarget(paddle);
        const error = target - paddle.pos;
        const desiredVelocity = Math.max(-0.56, Math.min(0.56, error * 3.8));
        const maxChange = 2.2 * dt;
        paddle.velocity += Math.max(-maxChange, Math.min(maxChange, desiredVelocity - paddle.velocity));
      } else {
        paddle.velocity = (player?.input || 0) * 0.74;
      }
      const next = clampPaddle(paddle.side, paddle.pos + paddle.velocity * dt);
      if (next === paddle.pos && paddle.velocity) paddle.velocity = 0;
      paddle.pos = next;
    }

    for (const ball of this.game.balls) {
      const { goal: missed } = advanceArenaBall(ball, this.game.paddles, dt);
      if (missed) {
        this.loseLife(missed);
        if (!this.game.roundOver) {
          this.game.countdown = 1.0;
          this.spawnBall(missed);
        }
        break;
      }
    }
  }

  nearestBall(paddle) {
    return this.game.balls.reduce((best, ball) => {
      const distance = paddle.side === "left" || paddle.side === "right"
        ? Math.abs(ball.x - (paddle.side === "left" ? 0 : 1))
        : Math.abs(ball.y - (paddle.side === "top" ? 0 : 1));
      return !best || distance < best.distance ? { ...ball, distance } : best;
    }, null);
  }

  botTarget(paddle) {
    const ball = this.nearestBall(paddle);
    if (!ball) return 0.5;
    return clampPaddle(paddle.side, predictPaddleTarget(ball, paddle.side));
  }

  loseLife(missed) {
    const paddles = this.game.paddles;
    const defender = paddles[missed];
    if (!defender || defender.eliminated) return;
    defender.lives = Math.max(0, defender.lives - 1);
    if (defender.lives === 0) defender.eliminated = true;

    if (this.config.mode === "duel" && defender.eliminated) {
      const winner = Object.values(paddles).find((p) => !p.eliminated);
      this.finishGame(winner?.name || "Opponent", { winnerSide: winner?.side || null });
    } else if (this.config.mode === "teams") {
      const teams = { left: "warm", bottom: "warm", top: "cool", right: "cool" };
      const warmOut = Object.values(paddles).filter((p) => teams[p.side] === "warm").every((p) => p.eliminated);
      const coolOut = Object.values(paddles).filter((p) => teams[p.side] === "cool").every((p) => p.eliminated);
      if (warmOut || coolOut) {
        const winnerTeam = warmOut ? "cool" : "warm";
        this.finishGame(winnerTeam === "cool" ? "Cool team" : "Warm team", { winnerTeam });
      }
    } else if (this.config.mode === "ffa") {
      const alive = Object.values(paddles).filter((p) => !p.eliminated);
      if (alive.length <= 1) this.finishGame(alive[0]?.name || "Nobody", { winnerSide: alive[0]?.side || null });
    }
  }

  finishGame(winner, { winnerSide = null, winnerTeam = null } = {}) {
    this.game.roundOver = true;
    this.game.winner = winner;
    this.game.winnerSide = winnerSide;
    this.game.winnerTeam = winnerTeam;
    this.status = "results";
    clearInterval(this.loop);
    this.loop = null;
    const persistence = Promise.all([
      this.ctx.storage.put("status", "results"),
      this.ctx.storage.put("game", this.game),
    ]).catch(() => {});
    this.ctx.waitUntil?.(persistence);
    this.broadcastSnapshot();
    this.broadcastRematch();
  }

  broadcastRematch() {
    const quorum = rematchQuorum(this.players, this.hostId);
    this.broadcast({
      type: "rematch-status",
      votes: quorum.votes,
      needed: quorum.needed,
      voters: quorum.voterNames,
      waitingForHost: quorum.waitingForHost,
    });
  }

  async recalculateRematch() {
    if (this.status !== "results" || !this.game?.roundOver) return;
    this.broadcastRematch();
    if (rematchQuorum(this.players, this.hostId).unanimous) await this.startRematch();
  }

  async startRematch() {
    if (this.status !== "results") return;
    this.status = "lobby";
    this.game = null;
    for (const player of this.players.values()) {
      player.ready = true;
      player.rematch = false;
      this.saveAttachment(player);
    }
    this.broadcast({ type: "rematch-starting" });
    await this.startGame();
  }

  maybeBroadcast(now) {
    if (now - this.lastBroadcast >= 30) {
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
      matchId: this.game.matchId,
      countdown: Math.ceil(this.game.countdown),
      paddles: Object.values(this.game.paddles).map(({ side, pos, color, name, bot, playerId, velocity, lives, eliminated }) => ({
        side,
        pos,
        color,
        name,
        bot: bot || (playerId ? !this.players.get(playerId)?.connected : true),
        velocity,
        lives,
        eliminated,
      })),
      balls: this.game.balls,
      roundOver: this.game.roundOver,
      winner: this.game.winner,
      winnerSide: this.game.winnerSide,
      winnerTeam: this.game.winnerTeam,
    };
  }
}
