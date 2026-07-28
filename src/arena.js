const COLORS = {
  bg: "#10151d",
  line: "rgba(230, 238, 232, .09)",
  white: "#f2f0e8",
};
const GOAL_HALF = { left: 0.22, right: 0.22, top: 0.15, bottom: 0.15 };
const PADDLE_HALF = { left: 0.082, right: 0.082, top: 0.056, bottom: 0.056 };

export class ArenaGame {
  constructor({ canvas, scoreNode, statusNode, overlay, lobbyNode, isSoundOn, onLobby }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.scoreNode = scoreNode;
    this.statusNode = statusNode;
    this.overlay = overlay;
    this.lobbyNode = lobbyNode;
    this.isSoundOn = isSoundOn;
    this.onLobby = onLobby;
    this.keys = new Set();
    this.snapshot = null;
    this.room = null;
    this.playerId = localStorage.getItem("four-sides-player") || crypto.randomUUID();
    localStorage.setItem("four-sides-player", this.playerId);
    this.name = localStorage.getItem("four-sides-name") || "";
    this.side = null;
    this.socket = null;
    this.audio = null;
    this.latency = 35;
    this.lastDirection = 0;
    this.pingTimer = setInterval(() => {
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.send({ type: "ping", sentAt: performance.now() });
      }
    }, 2000);
    this.frame = requestAnimationFrame(() => this.drawLoop());

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
  }

  async listRooms() {
    const response = await fetch("/api/rooms");
    if (!response.ok) throw new Error("Could not load public rooms");
    return (await response.json()).rooms;
  }

  async createRoom(settings) {
    const response = await fetch("/api/rooms/create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(settings),
    });
    if (!response.ok) throw new Error("Could not create room");
    return response.json();
  }

  async quickPlay(mode) {
    const response = await fetch("/api/rooms/quick", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode }),
    });
    if (!response.ok) throw new Error("Could not find a room");
    return response.json();
  }

  join(code, name, { autoReady = false } = {}) {
    this.disconnect();
    this.name = (name || "Player").trim().slice(0, 18);
    localStorage.setItem("four-sides-name", this.name);
    this.room = code.toUpperCase();
    this.autoReady = autoReady;
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${location.host}/api/rooms/${this.room}/socket?name=${encodeURIComponent(this.name)}&player=${this.playerId}`;
    this.statusNode.textContent = "Connecting";
    this.socket = new WebSocket(url);
    this.socket.addEventListener("message", (event) => this.handleMessage(JSON.parse(event.data)));
    this.socket.addEventListener("close", (event) => {
      if (this.room && event.code !== 1000) {
        this.statusNode.textContent = "Reconnecting…";
        setTimeout(() => this.room && this.join(this.room, this.name), 1200);
      }
    });
    this.socket.addEventListener("error", () => {
      this.statusNode.textContent = "Connection failed";
    });
  }

  disconnect() {
    const socket = this.socket;
    this.socket = null;
    this.room = null;
    this.snapshot = null;
    this.previousSnapshot = null;
    this.side = null;
    if (socket && socket.readyState < 2) socket.close(1000, "Left room");
  }

  handleMessage(message) {
    if (message.type === "welcome") {
      this.playerId = message.playerId;
      this.side = message.side;
      localStorage.setItem("four-sides-player", this.playerId);
      history.replaceState({}, "", `?room=${message.code}`);
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
      this.overlay.classList.remove("hidden");
      this.lobbyNode.classList.remove("hidden");
      this.onLobby(message, this.playerId);
    }
    if (message.type === "game-start") {
      this.mode = message.mode;
      this.overlay.classList.add("hidden");
      this.lobbyNode.classList.add("hidden");
      this.statusNode.textContent = `${this.side.toUpperCase()} SIDE`;
      this.ping(620, 0.09);
    }
    if (message.type === "snapshot") {
      this.previousSnapshot = this.snapshot;
      message.receivedAt = performance.now();
      this.snapshot = message;
      this.updateScore(message);
      if (message.roundOver) {
        this.statusNode.textContent = `${message.winner} wins`;
        this.ping(740, 0.18);
      }
    }
    if (message.type === "pong") {
      const oneWay = Math.max(0, (performance.now() - message.sentAt) / 2);
      this.latency = this.latency * 0.75 + Math.min(oneWay, 120) * 0.25;
    }
    if (message.type === "return-lobby") {
      this.snapshot = null;
      this.previousSnapshot = null;
      this.overlay.classList.remove("hidden");
    }
    if (message.type === "room-closed") {
      this.room = null;
      this.snapshot = null;
      this.previousSnapshot = null;
      this.overlay.classList.remove("hidden");
      this.lobbyNode.classList.remove("hidden");
      this.lobbyNode.innerHTML = `
        <div class="closed-room">
          <span class="overlay-kicker">Room closed</span>
          <h3>Game Master left.</h3>
          <p>${this.escapeHtml(message.reason || "This game no longer exists.")}</p>
          <button class="secondary-button" type="button" data-back-to-games>Back to games</button>
        </div>
      `;
      this.lobbyNode.querySelector("[data-back-to-games]").addEventListener("click", () => location.assign(location.pathname));
    }
  }

  send(payload) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(payload));
  }

  sendDirection() {
    let direction = 0;
    if (this.keys.has("ArrowLeft") || this.keys.has("ArrowUp") || this.keys.has("KeyA") || this.keys.has("KeyW")) direction -= 1;
    if (this.keys.has("ArrowRight") || this.keys.has("ArrowDown") || this.keys.has("KeyD") || this.keys.has("KeyS")) direction += 1;
    if (direction !== this.lastDirection) {
      this.lastDirection = direction;
      this.send({ type: "input", direction });
    }
  }

  bindTouch(button, direction) {
    const start = (event) => {
      event.preventDefault();
      this.lastDirection = direction;
      this.send({ type: "input", direction });
    };
    const stop = (event) => {
      event.preventDefault();
      this.lastDirection = 0;
      this.send({ type: "input", direction: 0 });
    };
    button.addEventListener("pointerdown", start);
    button.addEventListener("pointerup", stop);
    button.addEventListener("pointercancel", stop);
    button.addEventListener("pointerleave", stop);
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

  drawLoop() {
    this.draw();
    this.frame = requestAnimationFrame(() => this.drawLoop());
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
    const margin = 24;
    const active = new Set(rendered.paddles.filter((p) => !p.eliminated).map((p) => p.side));
    const drawWall = (side) => {
      const vertical = side === "left" || side === "right";
      const total = vertical ? this.height : this.width;
      const center = total / 2;
      const opening = active.has(side) ? GOAL_HALF[side] * total : 0;
      const fixed = side === "left" || side === "top" ? margin : (vertical ? this.width - margin : this.height - margin);
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
    ["left", "top", "right", "bottom"].forEach(drawWall);

    rendered.paddles.forEach((paddle) => {
      if (paddle.eliminated) return;
      ctx.strokeStyle = paddle.color;
      ctx.shadowColor = paddle.color;
      ctx.shadowBlur = paddle.side === this.side ? 24 : 12;
      ctx.lineWidth = paddle.side === this.side ? 12 : 9;
      ctx.lineCap = "round";
      ctx.beginPath();
      if (paddle.side === "left" || paddle.side === "right") {
        const x = paddle.side === "left" ? margin : this.width - margin;
        const y = paddle.pos * this.height;
        const half = PADDLE_HALF[paddle.side] * this.height;
        ctx.moveTo(x, y - half); ctx.lineTo(x, y + half);
      } else {
        const y = paddle.side === "top" ? margin : this.height - margin;
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
      ctx.beginPath(); ctx.arc(ball.x * this.width, ball.y * this.height, 8, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    });
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

    const paddles = snapshot.paddles.map((paddle) => {
      if (paddle.eliminated) return paddle;
      const old = previous?.paddles?.find((candidate) => candidate.side === paddle.side);
      let velocity = old ? (paddle.pos - old.pos) / snapshotDelta : 0;
      if (paddle.side === this.side) velocity = this.lastDirection * 0.66;
      velocity = Math.max(-0.7, Math.min(0.7, velocity));
      const min = 0.5 - GOAL_HALF[paddle.side] + PADDLE_HALF[paddle.side];
      const max = 0.5 + GOAL_HALF[paddle.side] - PADDLE_HALF[paddle.side];
      return { ...paddle, pos: Math.max(min, Math.min(max, paddle.pos + velocity * elapsed)) };
    });

    const balls = snapshot.countdown > 0 || snapshot.roundOver
      ? snapshot.balls
      : snapshot.balls.map((ball) => ({
          ...ball,
          x: ball.x + ball.vx * elapsed,
          y: ball.y + ball.vy * elapsed,
        }));
    return { ...snapshot, paddles, balls };
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
