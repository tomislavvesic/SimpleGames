import {
  ARENA_EDGE,
  BALL_RADIUS,
  FOUR_SIDES,
  GOAL_HALF,
  PADDLE_HALF,
  advanceArenaBall,
  clampPaddle,
} from "../shared/physics.js";

const COLORS = {
  bg: "#10151d",
  line: "rgba(230, 238, 232, .09)",
  white: "#f2f0e8",
};

export class ArenaGame {
  constructor({
    canvas,
    scoreNode,
    statusNode,
    overlay,
    lobbyNode,
    resultNode,
    isSoundOn,
    onLobby,
    onResult,
    onConnectionFailure,
  }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.scoreNode = scoreNode;
    this.statusNode = statusNode;
    this.overlay = overlay;
    this.lobbyNode = lobbyNode;
    this.resultNode = resultNode;
    this.canvasWrap = canvas.closest(".canvas-wrap");
    this.touchControls = this.canvasWrap?.querySelector(".touch-controls");
    this.isSoundOn = isSoundOn;
    this.onLobby = onLobby;
    this.onResult = onResult;
    this.onConnectionFailure = onConnectionFailure;
    this.keys = new Set();
    this.snapshot = null;
    this.room = null;
    this.playerId = null;
    this.playerToken = null;
    try {
      this.name = localStorage.getItem("four-sides-name") || "";
    } catch {
      this.name = "";
    }
    this.side = null;
    this.socket = null;
    this.audio = null;
    this.latency = 35;
    this.lastDirection = 0;
    this.particles = [];
    this.lastFrame = performance.now();
    this.resultReported = false;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.pingTimer = null;
    this.frame = null;

    window.addEventListener("keydown", (event) => {
      if (!this.room || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "KeyA", "KeyD", "KeyW", "KeyS"].includes(event.code)) return;
      event.preventDefault();
      this.keys.add(event.code);
      this.sendDirection();
    });
    window.addEventListener("keyup", (event) => {
      this.keys.delete(event.code);
      this.sendDirection();
    });
    window.addEventListener("blur", () => this.releaseInput());
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.releaseInput();
    });
  }

  async listRooms({ signal } = {}) {
    const response = await fetch("/api/rooms", { signal });
    if (!response.ok) throw new Error("Could not load public rooms");
    return (await response.json()).rooms;
  }

  async createRoom(settings, { signal } = {}) {
    const response = await fetch("/api/rooms/create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(settings),
      signal,
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || "Could not create room");
    }
    return response.json();
  }

  async quickPlay(mode, { signal } = {}) {
    const response = await fetch("/api/rooms/quick", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode }),
      signal,
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || "Could not find a room");
    }
    return response.json();
  }

  roomCredentials(code, suppliedId, suppliedToken) {
    const storageKey = `four-sides-session:${code}`;
    if (suppliedId && suppliedToken) {
      const credentials = { playerId: suppliedId, playerToken: suppliedToken };
      try { sessionStorage.setItem(storageKey, JSON.stringify(credentials)); } catch {}
      return credentials;
    }
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) || "null");
      if (saved?.playerId && saved?.playerToken) return saved;
    } catch {}
    const credentials = { playerId: crypto.randomUUID(), playerToken: crypto.randomUUID() };
    try { sessionStorage.setItem(storageKey, JSON.stringify(credentials)); } catch {}
    return credentials;
  }

  join(code, name, {
    autoReady = false,
    ownerToken = null,
    ownerPlayerId = null,
    ownerAuthToken = null,
    reconnect = false,
  } = {}) {
    this.disconnect();
    this.startRendering();
    this.name = (name || "Player").trim().slice(0, 18);
    try { localStorage.setItem("four-sides-name", this.name); } catch {}
    this.room = code.toUpperCase();
    if (!reconnect) {
      const credentials = this.roomCredentials(this.room, ownerPlayerId, ownerAuthToken);
      this.playerId = credentials.playerId;
      this.playerToken = credentials.playerToken;
    }
    if (!this.playerId || !this.playerToken) {
      const credentials = this.roomCredentials(this.room);
      this.playerId = credentials.playerId;
      this.playerToken = credentials.playerToken;
    }
    this.autoReady = autoReady;
    this.ownerToken = reconnect ? this.ownerToken : ownerToken;
    if (!reconnect) this.reconnectAttempts = 0;
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const query = new URLSearchParams({ name: this.name });
    const protocols = [
      "simple-games-v1",
      `p.${this.playerId}`,
      `t.${this.playerToken}`,
    ];
    if (this.ownerToken) protocols.push(`o.${this.ownerToken}`);
    const url = `${protocol}//${location.host}/api/rooms/${this.room}/socket?${query}`;
    this.statusNode.textContent = "Connecting";
    const socket = new WebSocket(url, protocols);
    this.socket = socket;
    socket.addEventListener("message", (event) => {
      if (this.socket !== socket) return;
      try {
        this.handleMessage(JSON.parse(event.data));
      } catch {
        this.statusNode.textContent = "Invalid server response";
      }
    });
    socket.addEventListener("open", () => {
      if (this.socket !== socket) return;
      this.reconnectAttempts = 0;
    });
    socket.addEventListener("close", (event) => {
      if (this.socket !== socket) return;
      this.socket = null;
      if (!this.room || event.code === 1000) return;
      if (this.reconnectAttempts >= 4) {
        this.statusNode.textContent = "Could not reconnect";
        this.onConnectionFailure?.("Could not join or reconnect to that room.");
        return;
      }
      this.reconnectAttempts += 1;
      this.statusNode.textContent = `Reconnecting ${this.reconnectAttempts}/4…`;
      const delay = 500 * (2 ** (this.reconnectAttempts - 1)) + Math.random() * 250;
      this.reconnectTimer = setTimeout(() => {
        const room = this.room;
        if (room) this.join(room, this.name, { ownerToken: this.ownerToken, reconnect: true });
      }, delay);
    });
    socket.addEventListener("error", () => {
      if (this.socket !== socket) return;
      this.statusNode.textContent = "Connection failed";
    });
  }

  disconnect() {
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.socket?.readyState === WebSocket.OPEN && this.lastDirection) {
      this.socket.send(JSON.stringify({ type: "input", direction: 0 }));
    }
    const socket = this.socket;
    this.socket = null;
    this.room = null;
    this.snapshot = null;
    this.previousSnapshot = null;
    this.side = null;
    this.keys.clear();
    this.lastDirection = 0;
    this.resultNode?.classList.add("hidden");
    if (this.resultNode) this.resultNode.inert = true;
    this.canvasWrap?.classList.remove("is-playing");
    if (this.touchControls) this.touchControls.setAttribute("aria-hidden", "true");
    if (socket && socket.readyState < 2) socket.close(1000, "Left room");
    this.stopRendering();
  }

  handleMessage(message) {
    if (message.type === "welcome") {
      this.playerId = message.playerId;
      this.side = message.side;
      history.replaceState(
        {},
        "",
        `/games/four-sides?room=${encodeURIComponent(message.code)}`,
      );
      this.statusNode.textContent = `Room ${message.code}`;
      if (this.autoReady) {
        this.send({ type: "ready", ready: true });
        this.autoReady = false;
      }
      this.ping(480, 0.06);
    }
    if (message.type === "lobby") {
      this.snapshot = null;
      this.previousSnapshot = null;
      this.canvasWrap?.classList.remove("is-playing");
      if (this.touchControls) this.touchControls.setAttribute("aria-hidden", "true");
      this.overlay.classList.remove("hidden");
      this.overlay.inert = false;
      this.lobbyNode.classList.remove("hidden");
      this.onLobby(message, this.playerId);
    }
    if (message.type === "game-start") {
      this.mode = message.mode;
      this.matchId = message.matchId || this.matchId || null;
      this.resultReported = this.hasProcessedMatch(this.matchId);
      this.resultNode?.classList.add("hidden");
      if (this.resultNode) this.resultNode.inert = true;
      const rematch = this.resultNode?.querySelector("[data-four-rematch]");
      rematch?.classList.remove("voted");
      if (rematch) rematch.innerHTML = "Vote rematch <span>↻</span>";
      const rematchStatus = this.resultNode?.querySelector("[data-four-rematch-status]");
      if (rematchStatus) rematchStatus.textContent = "Waiting for votes";
      this.overlay.classList.add("hidden");
      this.overlay.inert = true;
      this.lobbyNode.classList.add("hidden");
      this.canvasWrap?.classList.add("is-playing");
      if (this.touchControls) this.touchControls.setAttribute("aria-hidden", "false");
      this.updateTouchLabels();
      this.statusNode.textContent = `${this.side.toUpperCase()} SIDE`;
      this.ping(620, 0.09);
    }
    if (message.type === "snapshot") {
      this.previousSnapshot = this.snapshot;
      message.receivedAt = performance.now();
      this.processEffects(this.previousSnapshot, message);
      this.snapshot = message;
      this.updateScore(message);
      if (message.roundOver) {
        this.statusNode.textContent = `${message.winner} wins`;
        this.showResult(message);
        this.ping(740, 0.18);
      }
    }
    if (message.type === "rematch-status" && this.resultNode) {
      const suffix = message.waitingForHost ? " · waiting for Game Master" : "";
      this.resultNode.querySelector("[data-four-rematch-status]").textContent =
        `${message.votes} of ${message.needed} players voted${suffix}`;
    }
    if (message.type === "rematch-starting") this.resultNode?.classList.add("hidden");
    if (message.type === "notice") this.statusNode.textContent = message.text;
    if (message.type === "pong") {
      const oneWay = Math.max(0, (performance.now() - message.sentAt) / 2);
      this.latency = this.latency * 0.75 + Math.min(oneWay, 120) * 0.25;
    }
    if (message.type === "return-lobby") {
      this.snapshot = null;
      this.previousSnapshot = null;
      this.overlay.classList.remove("hidden");
      this.overlay.inert = false;
    }
    if (message.type === "match-interrupted") {
      this.snapshot = null;
      this.previousSnapshot = null;
      this.canvasWrap?.classList.remove("is-playing");
      this.overlay.classList.remove("hidden");
      this.overlay.inert = false;
      this.resultNode?.classList.add("hidden");
      if (this.resultNode) this.resultNode.inert = true;
      this.statusNode.textContent = message.reason || "Match interrupted";
    }
    if (message.type === "room-closed") {
      this.room = null;
      this.snapshot = null;
      this.previousSnapshot = null;
      this.canvasWrap?.classList.remove("is-playing");
      if (this.touchControls) this.touchControls.setAttribute("aria-hidden", "true");
      this.resultNode?.classList.add("hidden");
      if (this.resultNode) this.resultNode.inert = true;
      this.overlay.classList.remove("hidden");
      this.overlay.inert = false;
      this.lobbyNode.classList.remove("hidden");
      this.lobbyNode.querySelector("[data-lobby-mode]").textContent = "Room closed";
      this.lobbyNode.querySelector("[data-lobby-code]").textContent = "------";
      this.lobbyNode.querySelector("[data-lobby-slots]").innerHTML = `
        <div class="closed-room">
          <h3>Game Master left.</h3>
          <p>${this.escapeHtml(message.reason || "This game no longer exists.")}</p>
        </div>`;
      this.lobbyNode.querySelector(".lobby-controls")?.classList.add("hidden");
      this.lobbyNode.querySelector("[data-copy-link]")?.classList.add("hidden");
      this.lobbyNode.querySelector("[data-lobby-note]").textContent = "Close this window to return to the games.";
    }
  }

  send(payload) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(payload));
  }

  sendDirection() {
    let direction = 0;
    if (this.keys.has("ArrowLeft") || this.keys.has("ArrowUp") || this.keys.has("KeyA") || this.keys.has("KeyW")) direction -= 1;
    if (this.keys.has("ArrowRight") || this.keys.has("ArrowDown") || this.keys.has("KeyD") || this.keys.has("KeyS")) direction += 1;
    direction = Math.sign(direction);
    if (direction !== this.lastDirection) {
      this.lastDirection = direction;
      this.send({ type: "input", direction });
    }
  }

  releaseInput() {
    this.keys.clear();
    this.lastDirection = 0;
    this.send({ type: "input", direction: 0 });
  }

  bindTouch(button, direction) {
    const start = (event) => {
      event.preventDefault();
      button.setPointerCapture?.(event.pointerId);
      button.classList.add("pressed");
      this.lastDirection = direction;
      this.send({ type: "input", direction });
    };
    const stop = (event) => {
      event.preventDefault();
      button.classList.remove("pressed");
      this.lastDirection = 0;
      this.send({ type: "input", direction: 0 });
    };
    button.addEventListener("pointerdown", start);
    button.addEventListener("pointerup", stop);
    button.addEventListener("pointercancel", stop);
  }

  updateTouchLabels() {
    const vertical = this.side === "left" || this.side === "right";
    const buttons = [...(this.touchControls?.querySelectorAll("[data-move]") || [])];
    if (buttons.length < 2) return;
    buttons[0].textContent = vertical ? "↑" : "←";
    buttons[0].setAttribute("aria-label", vertical ? "Move up" : "Move left");
    buttons[1].textContent = vertical ? "↓" : "→";
    buttons[1].setAttribute("aria-label", vertical ? "Move down" : "Move right");
  }

  startRendering() {
    if (!this.pingTimer) {
      this.pingTimer = setInterval(() => {
      if (this.socket?.readyState === WebSocket.OPEN && this.snapshot && !this.snapshot.roundOver) {
          this.send({ type: "ping", sentAt: performance.now() });
        }
      }, 2000);
    }
    if (this.frame !== null) return;
    this.lastFrame = performance.now();
    this.frame = requestAnimationFrame(() => this.drawLoop());
  }

  stopRendering() {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.width = rect.width;
    this.height = rect.height;
  }

  updateScore(snapshot) {
    this.scoreNode.innerHTML = snapshot.paddles
      .map((p) => `<i class="${p.eliminated ? "eliminated" : ""}" style="--player:${p.color}">${this.escapeHtml(p.name)} <b>♥ ${p.lives}</b></i>`)
      .join("");
  }

  escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  }

  processedMatches() {
    try {
      const value = JSON.parse(localStorage.getItem("four-sides-processed-results") || "[]");
      return Array.isArray(value) ? value.filter((item) => typeof item === "string").slice(-50) : [];
    } catch {
      return [];
    }
  }

  hasProcessedMatch(matchId) {
    return Boolean(matchId && this.processedMatches().includes(matchId));
  }

  markMatchProcessed(matchId) {
    if (!matchId) return;
    const matches = this.processedMatches().filter((item) => item !== matchId);
    matches.push(matchId);
    try { localStorage.setItem("four-sides-processed-results", JSON.stringify(matches.slice(-50))); } catch {}
  }

  drawLoop() {
    const now = performance.now();
    const dt = Math.min((now - this.lastFrame) / 1000, 0.033);
    this.lastFrame = now;
    this.updateParticles(dt);
    this.draw();
    if (this.frame !== null) this.frame = requestAnimationFrame(() => this.drawLoop());
  }

  draw() {
    if (!this.width) this.resize();
    if (!this.width) return;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.strokeStyle = COLORS.line;
    ctx.lineWidth = 1;
    for (let x = 35; x < this.width; x += 35) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, this.height); ctx.stroke();
    }
    for (let y = 35; y < this.height; y += 35) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(this.width, y); ctx.stroke();
    }
    ctx.strokeStyle = "rgba(242,240,232,.12)";
    ctx.beginPath(); ctx.arc(this.width / 2, this.height / 2, Math.min(this.width, this.height) * .13, 0, Math.PI * 2); ctx.stroke();

    if (!this.snapshot) return;
    const rendered = this.projectSnapshot(performance.now());
    const edgeX = ARENA_EDGE * this.width;
    const edgeY = ARENA_EDGE * this.height;
    const active = new Set(rendered.paddles.filter((p) => !p.eliminated).map((p) => p.side));
    const drawWall = (side) => {
      const vertical = side === "left" || side === "right";
      const total = vertical ? this.height : this.width;
      const center = total / 2;
      const opening = active.has(side) ? GOAL_HALF[side] * total : 0;
      const fixed = side === "left"
        ? edgeX
        : side === "right"
          ? this.width - edgeX
          : side === "top"
            ? edgeY
            : this.height - edgeY;
      ctx.strokeStyle = "rgba(224,230,225,.32)";
      ctx.lineWidth = 7;
      ctx.lineCap = "butt";
      const segment = (from, to) => {
        ctx.beginPath();
        if (vertical) { ctx.moveTo(fixed, from); ctx.lineTo(fixed, to); }
        else { ctx.moveTo(from, fixed); ctx.lineTo(to, fixed); }
        ctx.stroke();
      };
      if (!opening) {
        segment(0, total);
      } else {
        segment(0, center - opening);
        segment(center + opening, total);
        ctx.strokeStyle = "rgba(255,255,255,.08)";
        ctx.lineWidth = 2;
        segment(center - opening, center + opening);
      }
    };
    FOUR_SIDES.forEach(drawWall);

    rendered.paddles.forEach((paddle) => {
      if (paddle.eliminated) return;
      ctx.strokeStyle = paddle.color;
      ctx.shadowColor = paddle.color;
      ctx.shadowBlur = paddle.side === this.side ? 24 : 12;
      ctx.lineWidth = paddle.side === this.side ? 12 : 9;
      ctx.lineCap = "round";
      ctx.beginPath();
      if (paddle.side === "left" || paddle.side === "right") {
        const x = paddle.side === "left" ? edgeX : this.width - edgeX;
        const y = paddle.pos * this.height;
        const half = PADDLE_HALF[paddle.side] * this.height;
        ctx.moveTo(x, y - half); ctx.lineTo(x, y + half);
      } else {
        const y = paddle.side === "top" ? edgeY : this.height - edgeY;
        const x = paddle.pos * this.width;
        const half = PADDLE_HALF[paddle.side] * this.width;
        ctx.moveTo(x - half, y); ctx.lineTo(x + half, y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
    });
    rendered.balls.forEach((ball) => {
      ctx.fillStyle = COLORS.white;
      ctx.shadowColor = COLORS.white;
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.ellipse(
        ball.x * this.width,
        ball.y * this.height,
        BALL_RADIUS.x * this.width,
        BALL_RADIUS.y * this.height,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      ctx.shadowBlur = 0;
    });
    this.drawParticles(ctx);
    if (rendered.countdown > 0 && !rendered.roundOver) {
      ctx.fillStyle = "rgba(8,11,15,.4)";
      ctx.fillRect(0, 0, this.width, this.height);
      ctx.fillStyle = COLORS.white;
      ctx.font = "800 72px Manrope";
      ctx.textAlign = "center";
      ctx.fillText(rendered.countdown, this.width / 2, this.height / 2 + 24);
    }
    if (rendered.roundOver) {
      ctx.fillStyle = "rgba(8,11,15,.68)";
      ctx.fillRect(0, 0, this.width, this.height);
      ctx.fillStyle = COLORS.white;
      ctx.font = `800 ${Math.min(54, this.width / 12)}px Manrope`;
      ctx.textAlign = "center";
      ctx.fillText(`${rendered.winner} wins`, this.width / 2, this.height / 2);
    }
  }

  projectSnapshot(now) {
    const snapshot = this.snapshot;
    const elapsed = Math.min(((now - snapshot.receivedAt) + this.latency) / 1000, 0.12);
    const previous = this.previousSnapshot;
    const snapshotDelta = previous?.receivedAt
      ? Math.max((snapshot.receivedAt - previous.receivedAt) / 1000, 0.016)
      : 0.05;

    const simulationPaddles = snapshot.paddles.map((paddle) => {
      if (paddle.eliminated) return paddle;
      const old = previous?.paddles?.find((candidate) => candidate.side === paddle.side);
      let velocity = Number.isFinite(paddle.velocity)
        ? paddle.velocity
        : old ? (paddle.pos - old.pos) / snapshotDelta : 0;
      if (paddle.side === this.side) velocity = this.lastDirection * 0.74;
      velocity = Math.max(-0.78, Math.min(0.78, velocity));
      return { ...paddle, velocity };
    });
    const paddles = simulationPaddles.map((paddle) => paddle.eliminated
      ? paddle
      : { ...paddle, pos: clampPaddle(paddle.side, paddle.pos + paddle.velocity * elapsed) });

    const balls = snapshot.countdown > 0 || snapshot.roundOver
      ? snapshot.balls
      : snapshot.balls.map((ball) => this.predictBall(ball, simulationPaddles, elapsed));
    return { ...snapshot, paddles, balls };
  }

  predictBall(source, paddles, elapsed) {
    const ball = { ...source };
    const steps = Math.max(1, Math.ceil(elapsed / (1 / 120)));
    const dt = elapsed / steps;

    for (let step = 0; step < steps; step += 1) {
      paddles.forEach((paddle) => {
        if (!paddle.eliminated) {
          paddle.pos = clampPaddle(paddle.side, paddle.pos + (paddle.velocity || 0) * dt);
        }
      });
      const result = advanceArenaBall(ball, paddles, dt);
      if (result.goal) break;
    }
    return ball;
  }

  processEffects(previous, current) {
    if (!previous || previous.roundOver) return;
    current.balls.forEach((ball, index) => {
      const old = previous.balls[index];
      if (!old) return;
      const bounced = Math.sign(ball.vx) !== Math.sign(old.vx) || Math.sign(ball.vy) !== Math.sign(old.vy);
      if (bounced) {
        const color = current.paddles.find((paddle) => paddle.side === ball.lastHit)?.color || COLORS.white;
        this.burst(ball.x, ball.y, color, 8);
        this.ping(360 + Math.hypot(ball.vx, ball.vy) * 260, 0.035);
      }
    });
    current.paddles.forEach((paddle) => {
      const old = previous.paddles.find((candidate) => candidate.side === paddle.side);
      if (!old || paddle.lives >= old.lives) return;
      const point = {
        left: [0.05, 0.5], right: [0.95, 0.5], top: [0.5, 0.05], bottom: [0.5, 0.95],
      }[paddle.side];
      this.burst(point[0], point[1], paddle.color, paddle.eliminated ? 34 : 20);
      this.canvas.classList.remove("arena-impact");
      void this.canvas.offsetWidth;
      this.canvas.classList.add("arena-impact");
      this.ping(paddle.eliminated ? 90 : 150, 0.16);
    });
  }

  burst(x, y, color, amount) {
    for (let index = 0; index < amount; index += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.08 + Math.random() * 0.22;
      this.particles.push({
        x, y, color,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.35 + Math.random() * 0.35,
        maxLife: 0.7,
        size: 2 + Math.random() * 3,
      });
    }
  }

  updateParticles(dt) {
    this.particles.forEach((particle) => {
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.vx *= 0.98;
      particle.vy *= 0.98;
      particle.life -= dt;
    });
    this.particles = this.particles.filter((particle) => particle.life > 0).slice(-180);
  }

  drawParticles(ctx) {
    for (const particle of this.particles) {
      ctx.globalAlpha = Math.max(0, particle.life / particle.maxLife);
      ctx.fillStyle = particle.color;
      ctx.beginPath();
      ctx.arc(particle.x * this.width, particle.y * this.height, particle.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  showResult(snapshot) {
    if (!this.resultNode) return;
    this.resultNode.classList.remove("hidden");
    this.resultNode.inert = false;
    this.resultNode.querySelector("[data-four-result-title]").textContent = `${snapshot.winner} wins`;
    const me = snapshot.paddles.find((paddle) => paddle.side === this.side);
    const warm = ["left", "bottom"].includes(this.side);
    const won = this.mode === "teams"
      ? snapshot.winnerTeam === (warm ? "warm" : "cool")
      : snapshot.winnerSide === this.side;
    this.resultNode.querySelector("[data-four-result-copy]").textContent = won
      ? `You held the ${this.side} goal with ${me?.lives || 0} lives remaining.`
      : `Your ${this.side} goal fell. Vote for a rematch and run it back.`;
    if (!this.resultReported) {
      this.resultReported = true;
      this.markMatchProcessed(snapshot.matchId || this.matchId);
      this.onResult?.({ won, lives: me?.lives || 0 });
      this.resultNode.querySelector("[data-four-rematch]")?.focus({ preventScroll: true });
    }
  }

  ping(frequency, duration) {
    if (!this.isSoundOn()) return;
    try {
      this.audio ||= new AudioContext();
      const oscillator = this.audio.createOscillator();
      const gain = this.audio.createGain();
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(.045, this.audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(.001, this.audio.currentTime + duration);
      oscillator.connect(gain).connect(this.audio.destination);
      oscillator.start();
      oscillator.stop(this.audio.currentTime + duration);
    } catch {}
  }
}
