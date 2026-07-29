import { DurableObject } from "cloudflare:workers";
import {
  cleanName,
  json as responseJson,
  validClientSecret as validSecret,
  websocketCredentials,
} from "../../../shared/server/http.js";
import { rematchQuorum } from "../../../shared/server/room-lifecycle.js";

const STATIONS = [
  { id: "power", name: "Power", color: "#ff725e", actions: ["Charge", "Ground", "Reroute"] },
  { id: "navigation", name: "Navigation", color: "#69a7ff", actions: ["Align", "Plot", "Jump"] },
  { id: "cooling", name: "Cooling", color: "#63d6ae", actions: ["Vent", "Flush", "Seal"] },
  { id: "comms", name: "Comms", color: "#ffd45c", actions: ["Decode", "Broadcast", "Jam"] },
];
const TARGET_SCORE = 4000;

export class SignalRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
    this.config = null;
    this.status = "lobby";
    this.hostId = null;
    this.players = new Map();
    this.game = null;
    this.loop = null;
    this.botTimer = null;
    this.lastBroadcast = 0;
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
      for (const player of saved.get("roster") || []) {
        if (player?.id) this.players.set(player.id, { ...player, ws: null, connected: false });
      }
      for (const ws of this.ctx.getWebSockets()) {
        const player = ws.deserializeAttachment();
        if (player?.id) {
          const stored = this.players.get(player.id) || {};
          this.players.set(player.id, { ...stored, ...player, ws, connected: true, ready: Boolean(player.ready) });
        }
      }
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
          this.attach(player);
        }
        await Promise.all([
          this.ctx.storage.put("status", "lobby"),
          this.ctx.storage.delete("game"),
          this.persistRoster(),
        ]);
        this.broadcast({ type: "mission-interrupted", reason: "The mission server restarted. Your crew is back in the lobby." });
        this.broadcastLobby();
        if (this.hostId) await this.updateDirectory("lobby");
      }
      await this.scheduleNextAlarm();
    });
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/init" && request.method === "POST") {
      if (this.config || this.status === "closed") return responseJson({ error: "Room code already exists" }, 409);
      this.config = await request.json();
      this.status = "lobby";
      this.unclaimedDeadline = Date.now() + 15 * 60 * 1000;
      await Promise.all([
        this.ctx.storage.put("config", this.config),
        this.ctx.storage.put("status", "lobby"),
        this.ctx.storage.put("unclaimedDeadline", this.unclaimedDeadline),
        this.ctx.storage.setAlarm(this.unclaimedDeadline),
      ]);
      return responseJson(this.config, 201);
    }
    if (this.status === "closed") return responseJson({ error: "Room is closed" }, 410);
    if (!this.config) return responseJson({ error: "Room not found" }, 404);
    if (request.headers.get("Upgrade") !== "websocket") return responseJson({ error: "WebSocket required" }, 426);
    const origin = request.headers.get("Origin");
    if (origin && origin !== url.origin) return responseJson({ error: "Origin not allowed" }, 403);

    const name = cleanName(url.searchParams.get("name"));
    const {
      requestedId,
      authToken,
      ownerToken,
      negotiatedProtocol,
    } = websocketCredentials(request, url);
    if (!validSecret(requestedId) || !validSecret(authToken)) return responseJson({ error: "Invalid player credentials" }, 400);
    const existing = this.players.get(requestedId);
    const hasOwnerReservation = validSecret(this.config.ownerPlayerId)
      && validSecret(this.config.ownerAuthToken);
    const isReservedOwner = hasOwnerReservation && requestedId === this.config.ownerPlayerId;
    if (isReservedOwner && authToken !== this.config.ownerAuthToken) {
      return responseJson({ error: "Invalid owner credentials" }, 403);
    }
    if (existing && existing.authToken !== authToken) return responseJson({ error: "Invalid reconnect token" }, 403);
    if (existing?.connected) return responseJson({ error: "Player is already connected" }, 409);
    if (["playing", "results"].includes(this.status) && (!existing || existing.connected)) {
      return responseJson({ error: "Mission already in progress" }, 409);
    }
    const occupied = new Set([...this.players.values()].filter((p) => p.id !== requestedId).map((p) => p.station));
    if (hasOwnerReservation && !existing && !isReservedOwner) occupied.add(this.config.ownerStation);
    const station = existing?.station
      || (isReservedOwner
        ? this.config.ownerStation
        : STATIONS.find((candidate) => !occupied.has(candidate.id))?.id);
    if (!station) return responseJson({ error: "Room is full" }, 409);

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const stationInfo = STATIONS.find((item) => item.id === station);
    const player = {
      id: requestedId,
      name,
      station,
      color: stationInfo.color,
      ready: existing?.ready || false,
      connected: true,
      joinedAt: existing?.joinedAt || Date.now(),
      contribution: existing?.contribution || 0,
      rematch: existing?.rematch || false,
      replacedByBot: false,
      authToken,
      connectionNonce: crypto.randomUUID(),
      ws: server,
    };
    this.attach(player);
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
    this.cancelAutomationFor(station);
    await Promise.all([
      this.persistRoster(),
      this.hostId ? this.ctx.storage.put("hostId", this.hostId) : Promise.resolve(),
      this.unclaimedDeadline === null ? this.ctx.storage.delete("unclaimedDeadline") : Promise.resolve(),
      this.hostReconnectDeadline === null ? this.ctx.storage.delete("hostReconnectDeadline") : Promise.resolve(),
    ]);
    await this.scheduleNextAlarm();

    server.send(JSON.stringify({ type: "welcome", playerId: player.id, station, code: this.config.code }));
    if (this.status !== "lobby") {
      server.send(JSON.stringify({ type: "mission-start", missionId: this.game?.missionId || null }));
      if (this.game) server.send(JSON.stringify(this.snapshot()));
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
    const player = this.players.get(ws.deserializeAttachment()?.id);
    const attachment = ws.deserializeAttachment();
    if (!player || player.ws !== ws || player.connectionNonce !== attachment?.connectionNonce) return;
    const now = Date.now();
    if (!player.messageWindowAt || now - player.messageWindowAt >= 1000) {
      player.messageWindowAt = now;
      player.messageCount = 0;
    }
    player.messageCount += 1;
    if (player.messageCount > 60) {
      ws.close(1008, "Message rate exceeded");
      return;
    }

    if (message.type === "ping") {
      if (Number.isFinite(message.sentAt)) ws.send(JSON.stringify({ type: "pong", sentAt: message.sentAt }));
      return;
    }
    if (message.type === "ready" && this.status === "lobby") {
      player.ready = Boolean(message.ready);
      this.attach(player);
      await this.persistRoster();
      this.broadcastLobby();
      return;
    }
    if (message.type === "start" && this.status === "lobby" && player.id === this.hostId) {
      const humans = [...this.players.values()].filter((p) => p.connected);
      const ready = humans.every((p) => p.id === this.hostId || p.ready);
      const filled = STATIONS.every((station) => humans.some((p) => p.station === station.id)
        || this.config.bots
        || [...this.players.values()].some((p) => p.station === station.id && p.replacedByBot));
      if (ready && filled) {
        await this.startMission();
      }
      return;
    }
    if (message.type === "action" && this.status === "playing") {
      this.handleAction(player, Number(message.action));
      return;
    }
    if (message.type === "rematch" && this.game?.over) {
      player.rematch = Boolean(message.vote);
      this.attach(player);
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
    player.replacedByBot = true;
    if (this.status === "playing") this.scheduleAutomationForStation(player.station);
    if (player.id === this.hostId && this.status !== "closed") {
      if (code === 1000) {
        await this.closeRoom("The Game Master ended this mission.");
      } else {
        this.broadcast({ type: "notice", text: "Game Master reconnecting…" });
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
      await this.updateDirectory();
      this.broadcastLobby();
    } else {
      this.broadcast({ type: "notice", text: `${player.name}'s station is now automated.` });
      if (this.status === "results") await this.recalculateRematch();
    }
  }

  async webSocketError(ws) {
    await this.webSocketClose(ws);
  }

  attach(player) {
    player.ws?.serializeAttachment({
      id: player.id,
      name: player.name,
      station: player.station,
      color: player.color,
      ready: player.ready,
      joinedAt: player.joinedAt,
      contribution: player.contribution || 0,
      rematch: player.rematch || false,
      authToken: player.authToken,
      connectionNonce: player.connectionNonce,
    });
  }

  persistRoster() {
    const roster = [...this.players.values()].map((player) => ({
      id: player.id,
      name: player.name,
      station: player.station,
      color: player.color,
      ready: Boolean(player.ready),
      joinedAt: player.joinedAt,
      contribution: player.contribution || 0,
      rematch: Boolean(player.rematch),
      replacedByBot: Boolean(player.replacedByBot),
      authToken: player.authToken,
    }));
    return this.ctx.storage.put("roster", roster);
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
      await this.closeRoom("This unclaimed mission expired.");
      return;
    }
    if (this.hostReconnectDeadline && now >= this.hostReconnectDeadline) {
      const host = this.players.get(this.hostId);
      if (!host?.connected) {
        await this.closeRoom("The Game Master could not reconnect. This mission has closed.");
        return;
      }
      this.hostReconnectDeadline = null;
      await this.ctx.storage.delete("hostReconnectDeadline");
    }
    await this.scheduleNextAlarm();
  }

  lobbyState() {
    const players = STATIONS.map((station) => {
      const human = [...this.players.values()].find((p) => p.station === station.id && p.connected);
      const departed = [...this.players.values()].find((p) => p.station === station.id && p.replacedByBot);
      if (human) return { id: human.id, name: human.name, station: station.id, stationName: station.name, color: station.color, ready: human.ready, bot: false };
      if (this.config.bots || departed) {
        return { id: `bot-${station.id}`, name: departed ? `${departed.name} bot` : "Auto Crew", station: station.id, stationName: station.name, color: station.color, ready: true, bot: true };
      }
      return { id: `open-${station.id}`, name: "Open station", station: station.id, stationName: station.name, color: station.color, ready: false, bot: false };
    });
    return { type: "lobby", game: "signal-crew", code: this.config.code, hostId: this.hostId, bots: this.config.bots, isPublic: this.config.isPublic, players };
  }

  broadcastLobby() {
    this.broadcast(this.lobbyState());
  }

  async startMission() {
    if (this.status !== "lobby" || !this.config) return;
    const transition = ++this.lifecycle;
    this.status = "playing";
    const crew = {};
    for (const station of STATIONS) {
      const owner = [...this.players.values()].find((p) => p.station === station.id);
      crew[station.id] = {
        station: station.id,
        name: owner?.name || "Auto Crew",
        playerId: owner?.id || null,
        bot: !owner,
        contribution: 0,
      };
    }
    this.game = {
      crew,
      score: 0,
      stability: 5,
      streak: 0,
      bestStreak: 0,
      successes: 0,
      command: null,
      nextCommandAt: Date.now() + 2000,
      countdown: 2,
      over: false,
      victory: false,
      message: "Systems waking up…",
      missionId: crypto.randomUUID(),
      stationBag: [],
    };
    for (const player of this.players.values()) {
      player.rematch = false;
      player.contribution = 0;
      this.attach(player);
    }
    this.broadcast({ type: "mission-start", missionId: this.game.missionId });
    this.lastBroadcast = 0;
    if (this.loop) clearInterval(this.loop);
    this.loop = setInterval(() => this.tick(), 50);
    await Promise.all([
      this.ctx.storage.put("status", "playing"),
      this.ctx.storage.delete("game"),
      this.persistRoster(),
    ]);
    if (transition !== this.lifecycle || this.status !== "playing") return;
    await this.updateDirectory("playing");
  }

  tick() {
    if (!this.game || this.game.over) return;
    const now = Date.now();
    if (this.game.countdown > 0) this.game.countdown = Math.max(0, (this.game.nextCommandAt - now) / 1000);
    if (this.game.command && now >= this.game.command.expiresAt) this.failCommand("Signal missed");
    if (!this.game.command && now >= this.game.nextCommandAt) this.createCommand();
    if (now - this.lastBroadcast >= 100) {
      this.lastBroadcast = now;
      this.broadcast(this.snapshot());
    }
  }

  createCommand() {
    const level = 1 + Math.floor(this.game.successes / 5);
    const deadline = Math.max(1150, 3000 - (level - 1) * 170);
    if (!this.game.stationBag?.length) {
      this.game.stationBag = STATIONS.map((candidate) => candidate.id);
      for (let index = this.game.stationBag.length - 1; index > 0; index -= 1) {
        const swap = Math.floor(Math.random() * (index + 1));
        [this.game.stationBag[index], this.game.stationBag[swap]] = [
          this.game.stationBag[swap],
          this.game.stationBag[index],
        ];
      }
    }
    const stationId = this.game.stationBag.pop();
    const station = STATIONS.find((candidate) => candidate.id === stationId)
      || STATIONS[Math.floor(Math.random() * STATIONS.length)];
    if (!STATIONS.some((candidate) => candidate.id === stationId)) this.game.stationBag = [];
    const action = Math.floor(Math.random() * station.actions.length);
    this.game.countdown = 0;
    this.game.command = {
      id: crypto.randomUUID(),
      station: station.id,
      stationName: station.name,
      color: station.color,
      action,
      actionName: station.actions[action],
      issuedAt: Date.now(),
      expiresAt: Date.now() + deadline,
      deadline,
      level,
    };
    this.game.botResponse = null;
    if (this.botTimer) clearTimeout(this.botTimer);
    this.botTimer = null;
    this.scheduleAutomationForStation(station.id);
  }

  scheduleBot() {
    const response = this.game?.botResponse;
    if (!response) return;
    if (this.botTimer) clearTimeout(this.botTimer);
    this.botTimer = setTimeout(() => {
      this.botTimer = null;
      if (
        !this.game
        || this.game.over
        || !this.game.command
        || this.game.command.id !== response.commandId
        || this.game.botResponse !== response
      ) return;
      const crew = this.game.crew[response.station];
      const player = crew.playerId ? this.players.get(crew.playerId) : null;
      if (player?.connected) return;
      if (response.correct) this.resolveCommand(this.game.crew[response.station]);
      else this.failCommand("Automation fault");
    }, Math.max(0, response.at - Date.now()));
  }

  scheduleAutomationForStation(station) {
    const command = this.game?.command;
    if (!command || command.station !== station || this.game.over) return;
    const crew = this.game.crew[station];
    const player = crew.playerId ? this.players.get(crew.playerId) : null;
    if (player?.connected) return;
    const remaining = Math.max(120, command.expiresAt - Date.now());
    const accuracy = Math.max(0.72, 0.94 - command.level * 0.018);
    this.game.botResponse = {
      at: Date.now() + remaining * (0.3 + Math.random() * 0.42),
      correct: Math.random() < accuracy,
      station,
      commandId: command.id,
    };
    this.scheduleBot();
  }

  cancelAutomationFor(station) {
    if (this.game?.botResponse?.station !== station) return;
    this.game.botResponse = null;
    if (this.botTimer) clearTimeout(this.botTimer);
    this.botTimer = null;
  }

  handleAction(player, action) {
    const command = this.game?.command;
    if (!command || this.game.over) return;
    if (player.station !== command.station) return;
    if (action !== command.action) {
      this.failCommand("Wrong control");
      return;
    }
    this.resolveCommand(this.game.crew[player.station]);
  }

  resolveCommand(member) {
    if (!this.game?.command) return;
    const remaining = Math.max(0, this.game.command.expiresAt - Date.now());
    const precision = remaining / this.game.command.deadline;
    const gain = Math.round(90 + this.game.streak * 8 + precision * 45);
    this.game.score += gain;
    this.game.streak += 1;
    this.game.bestStreak = Math.max(this.game.bestStreak, this.game.streak);
    this.game.successes += 1;
    member.contribution += gain;
    const human = member.playerId ? this.players.get(member.playerId) : null;
    if (human) human.contribution = member.contribution;
    this.game.message = precision > 0.65 ? "Perfect response" : "Signal handled";
    this.game.command = null;
    this.game.botResponse = null;
    if (this.botTimer) clearTimeout(this.botTimer);
    this.botTimer = null;
    if (this.game.score >= TARGET_SCORE) {
      this.finish(true);
    } else {
      this.game.nextCommandAt = Date.now() + Math.max(260, 650 - this.game.successes * 8);
    }
    this.broadcast(this.snapshot());
  }

  failCommand(reason) {
    if (!this.game?.command) return;
    this.game.stability -= 1;
    this.game.streak = 0;
    this.game.message = reason;
    this.game.command = null;
    this.game.botResponse = null;
    if (this.botTimer) clearTimeout(this.botTimer);
    this.botTimer = null;
    if (this.game.stability <= 0) {
      this.finish(false);
    } else {
      this.game.nextCommandAt = Date.now() + 850;
    }
    this.broadcast(this.snapshot());
  }

  finish(victory) {
    this.game.over = true;
    this.game.victory = victory;
    this.game.message = victory ? "Station stabilized" : "Station lost";
    this.status = "results";
    if (this.loop) clearInterval(this.loop);
    this.loop = null;
    if (this.botTimer) clearTimeout(this.botTimer);
    this.botTimer = null;
    const persistence = Promise.all([
      this.ctx.storage.put("status", "results"),
      this.ctx.storage.put("game", this.game),
    ]).catch(() => {});
    this.ctx.waitUntil?.(persistence);
    this.broadcast(this.snapshot());
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
    if (this.status !== "results" || !this.game?.over) return;
    this.broadcastRematch();
    if (rematchQuorum(this.players, this.hostId).unanimous) await this.startRematch();
  }

  async returnToLobby() {
    this.status = "lobby";
    this.game = null;
    for (const player of this.players.values()) {
      player.ready = false;
      player.rematch = false;
      this.attach(player);
    }
    await Promise.all([
      this.ctx.storage.put("status", "lobby"),
      this.ctx.storage.delete("game"),
      this.persistRoster(),
    ]);
    await this.updateDirectory("lobby");
    this.broadcast({ type: "return-lobby" });
    this.broadcastLobby();
  }

  async startRematch() {
    if (this.status !== "results") return;
    this.status = "lobby";
    this.game = null;
    for (const player of this.players.values()) {
      player.ready = true;
      player.rematch = false;
      this.attach(player);
    }
    this.broadcast({ type: "rematch-starting" });
    await this.startMission();
  }

  snapshot() {
    const command = this.game.command
      ? { ...this.game.command, remaining: Math.max(0, this.game.command.expiresAt - Date.now()) }
      : null;
    return {
      type: "signal-snapshot",
      missionId: this.game.missionId,
      score: this.game.score,
      targetScore: TARGET_SCORE,
      stability: this.game.stability,
      streak: this.game.streak,
      bestStreak: this.game.bestStreak,
      countdown: Math.ceil(this.game.countdown),
      command,
      crew: Object.values(this.game.crew).map((member) => ({
        ...member,
        bot: member.bot || (member.playerId ? !this.players.get(member.playerId)?.connected : true),
      })),
      over: this.game.over,
      victory: this.game.victory,
      message: this.game.message,
    };
  }

  broadcast(payload) {
    const encoded = JSON.stringify(payload);
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(encoded); } catch {}
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
      ownerStation: _ownerStation,
      ...publicConfig
    } = config;
    const revision = this.nextDirectoryRevision();
    try {
      await this.env.LOBBY_DIRECTORY.getByName("global").fetch("https://directory.internal/update", {
        method: "POST",
        body: JSON.stringify({ ...publicConfig, game: "signal-crew", players, status, revision }),
      });
    } catch {
      // Public discovery is best effort; direct invite links keep working.
    }
  }

  async updateDirectory(status = this.status) {
    if (!this.config) return;
    const players = [...this.players.values()].filter((p) => p.connected).length;
    await this.publishDirectory(this.config, players, status);
  }

  async closeRoom(reason) {
    if (this.status === "closed") return;
    const closingConfig = this.config;
    const connectedPlayers = [...this.players.values()].filter((player) => player.connected).length;
    this.lifecycle += 1;
    this.status = "closed";
    if (this.loop) clearInterval(this.loop);
    this.loop = null;
    if (this.botTimer) clearTimeout(this.botTimer);
    this.botTimer = null;
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
}
