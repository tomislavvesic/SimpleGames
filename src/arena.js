const COLORS = {
  bg: "#10151d",
  line: "rgba(230, 238, 232, .09)",
  coral: "#ff725e",
  blue: "#69a7ff",
  yellow: "#ffd45c",
  mint: "#63d6ae",
  white: "#f2f0e8",
};

export class ArenaGame {
  constructor({ canvas, scoreNode, livesNode, overlay, isSoundOn }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.scoreNode = scoreNode;
    this.livesNode = livesNode;
    this.overlay = overlay;
    this.isSoundOn = isSoundOn;
    this.keys = new Set();
    this.running = false;
    this.paused = false;
    this.lastTime = 0;
    this.audio = null;

    this.paddles = [
      { side: "left", color: COLORS.coral, keys: ["KeyW", "KeyS"], pos: 0.5 },
      { side: "top", color: COLORS.blue, keys: ["KeyA", "KeyD"], pos: 0.5 },
      { side: "right", color: COLORS.yellow, keys: ["ArrowUp", "ArrowDown"], pos: 0.5 },
      { side: "bottom", color: COLORS.mint, keys: ["KeyJ", "KeyL"], pos: 0.5 },
    ];

    window.addEventListener("keydown", (event) => {
      if (this.controlCodes.includes(event.code)) event.preventDefault();
      if (event.code === "KeyP" && this.running) this.paused = !this.paused;
      this.keys.add(event.code);
    });
    window.addEventListener("keyup", (event) => this.keys.delete(event.code));
    this.drawIdle();
  }

  get controlCodes() {
    return this.paddles.flatMap((p) => p.keys);
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.width = rect.width;
    this.height = rect.height;
    if (!this.running) this.drawIdle();
  }

  start() {
    this.resize();
    this.score = 0;
    this.lives = 8;
    this.elapsed = 0;
    this.spawnAt = 12;
    this.balls = [];
    this.paddles.forEach((p) => (p.pos = 0.5));
    this.spawnBall();
    this.overlay.classList.add("hidden");
    this.running = true;
    this.paused = false;
    this.lastTime = performance.now();
    this.scoreNode.textContent = "0000";
    this.livesNode.textContent = this.lives;
    requestAnimationFrame((time) => this.loop(time));
  }

  stop() {
    this.running = false;
    this.paused = false;
    this.overlay.classList.remove("hidden", "game-over");
    this.overlay.querySelector("h3").textContent = "Keep the core alive.";
    this.overlay.querySelector("p").textContent =
      "Every missed ball costs a shared life. Survive long enough and more balls join the arena.";
    this.overlay.querySelector(".start-game").innerHTML = "Start round <span>→</span>";
  }

  spawnBall() {
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.min(235 + this.elapsed * 2.3, 390);
    this.balls.push({
      x: this.width / 2,
      y: this.height / 2,
      vx: Math.cos(angle) * speed || speed,
      vy: Math.sin(angle) * speed || speed * 0.6,
      r: 8,
      trail: [],
    });
    this.ping(520, 0.07);
  }

  loop(time) {
    if (!this.running) return;
    const dt = Math.min((time - this.lastTime) / 1000, 0.025);
    this.lastTime = time;
    if (!this.paused) this.update(dt);
    this.draw();
    requestAnimationFrame((next) => this.loop(next));
  }

  update(dt) {
    this.elapsed += dt;
    if (this.elapsed >= this.spawnAt && this.balls.length < 4) {
      this.spawnBall();
      this.spawnAt += 15;
    }

    const paddleSpeed = 0.82;
    this.paddles.forEach((paddle) => {
      if (this.keys.has(paddle.keys[0])) paddle.pos -= paddleSpeed * dt;
      if (this.keys.has(paddle.keys[1])) paddle.pos += paddleSpeed * dt;
      paddle.pos = Math.max(0.16, Math.min(0.84, paddle.pos));
    });

    const margin = 23;
    const horizontalLength = Math.min(132, this.width * 0.24);
    const verticalLength = Math.min(132, this.height * 0.24);

    [...this.balls].forEach((ball) => {
      ball.trail.unshift({ x: ball.x, y: ball.y });
      ball.trail = ball.trail.slice(0, 9);
      ball.x += ball.vx * dt;
      ball.y += ball.vy * dt;

      const left = this.paddles[0];
      const top = this.paddles[1];
      const right = this.paddles[2];
      const bottom = this.paddles[3];

      if (ball.vx < 0 && ball.x - ball.r <= margin && Math.abs(ball.y - left.pos * this.height) < verticalLength / 2) {
        ball.x = margin + ball.r;
        ball.vx = Math.abs(ball.vx) * 1.025;
        this.hit(ball, left);
      }
      if (ball.vx > 0 && ball.x + ball.r >= this.width - margin && Math.abs(ball.y - right.pos * this.height) < verticalLength / 2) {
        ball.x = this.width - margin - ball.r;
        ball.vx = -Math.abs(ball.vx) * 1.025;
        this.hit(ball, right);
      }
      if (ball.vy < 0 && ball.y - ball.r <= margin && Math.abs(ball.x - top.pos * this.width) < horizontalLength / 2) {
        ball.y = margin + ball.r;
        ball.vy = Math.abs(ball.vy) * 1.025;
        this.hit(ball, top);
      }
      if (ball.vy > 0 && ball.y + ball.r >= this.height - margin && Math.abs(ball.x - bottom.pos * this.width) < horizontalLength / 2) {
        ball.y = this.height - margin - ball.r;
        ball.vy = -Math.abs(ball.vy) * 1.025;
        this.hit(ball, bottom);
      }

      if (ball.x < -20 || ball.x > this.width + 20 || ball.y < -20 || ball.y > this.height + 20) {
        this.balls.splice(this.balls.indexOf(ball), 1);
        this.lives -= 1;
        this.livesNode.textContent = this.lives;
        this.ping(110, 0.18);
        if (this.lives <= 0) this.endGame();
        else setTimeout(() => this.running && this.spawnBall(), 380);
      }
    });
  }

  hit(ball, paddle) {
    this.score += 25;
    this.scoreNode.textContent = String(this.score).padStart(4, "0");
    if (paddle.side === "left" || paddle.side === "right") {
      ball.vy += (ball.y / this.height - paddle.pos) * 115;
    } else {
      ball.vx += (ball.x / this.width - paddle.pos) * 115;
    }
    this.ping(340 + Math.min(this.score, 1000) / 5, 0.045);
  }

  endGame() {
    this.running = false;
    this.overlay.classList.remove("hidden");
    this.overlay.classList.add("game-over");
    this.overlay.querySelector(".overlay-kicker").textContent = "Round over";
    this.overlay.querySelector("h3").textContent = `${this.score} points.`;
    this.overlay.querySelector("p").textContent =
      this.score > 700 ? "Excellent save work. The arena wants a rematch." : "The corners are cruel. Tighten the formation and try again.";
    this.overlay.querySelector(".start-game").innerHTML = "Play again <span>↻</span>";
  }

  ping(frequency, duration) {
    if (!this.isSoundOn()) return;
    try {
      this.audio ||= new AudioContext();
      const oscillator = this.audio.createOscillator();
      const gain = this.audio.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.055, this.audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.audio.currentTime + duration);
      oscillator.connect(gain).connect(this.audio.destination);
      oscillator.start();
      oscillator.stop(this.audio.currentTime + duration);
    } catch {
      // Audio is an enhancement; gameplay should never depend on it.
    }
  }

  drawIdle() {
    if (!this.width) {
      const rect = this.canvas.getBoundingClientRect();
      this.width = rect.width || 900;
      this.height = rect.height || 620;
    }
    this.draw();
  }

  draw() {
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

    ctx.save();
    ctx.translate(this.width / 2, this.height / 2);
    ctx.strokeStyle = "rgba(242,240,232,.12)";
    ctx.beginPath(); ctx.arc(0, 0, Math.min(this.width, this.height) * 0.13, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, Math.min(this.width, this.height) * 0.06, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();

    const margin = 23;
    const hLength = Math.min(132, this.width * 0.24);
    const vLength = Math.min(132, this.height * 0.24);
    this.paddles.forEach((paddle) => {
      ctx.strokeStyle = paddle.color;
      ctx.shadowColor = paddle.color;
      ctx.shadowBlur = 18;
      ctx.lineWidth = 10;
      ctx.lineCap = "round";
      ctx.beginPath();
      if (paddle.side === "left" || paddle.side === "right") {
        const x = paddle.side === "left" ? margin : this.width - margin;
        const y = paddle.pos * this.height;
        ctx.moveTo(x, y - vLength / 2);
        ctx.lineTo(x, y + vLength / 2);
      } else {
        const y = paddle.side === "top" ? margin : this.height - margin;
        const x = paddle.pos * this.width;
        ctx.moveTo(x - hLength / 2, y);
        ctx.lineTo(x + hLength / 2, y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
    });

    (this.balls || []).forEach((ball) => {
      ball.trail.forEach((point, index) => {
        ctx.globalAlpha = (1 - index / ball.trail.length) * 0.18;
        ctx.fillStyle = COLORS.white;
        ctx.beginPath();
        ctx.arc(point.x, point.y, ball.r * (1 - index / 14), 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;
      ctx.fillStyle = COLORS.white;
      ctx.shadowColor = COLORS.white;
      ctx.shadowBlur = 14;
      ctx.beginPath(); ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    });

    if (this.paused) {
      ctx.fillStyle = "rgba(8,11,15,.72)";
      ctx.fillRect(0, 0, this.width, this.height);
      ctx.fillStyle = COLORS.white;
      ctx.font = "700 22px Manrope";
      ctx.textAlign = "center";
      ctx.fillText("PAUSED", this.width / 2, this.height / 2);
    }
  }
}

