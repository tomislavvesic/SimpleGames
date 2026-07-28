const STATIONS = {
  power: { name: "Power", color: "#ff725e", actions: ["Charge", "Ground", "Reroute"] },
  navigation: { name: "Navigation", color: "#69a7ff", actions: ["Align", "Plot", "Jump"] },
  cooling: { name: "Cooling", color: "#63d6ae", actions: ["Vent", "Flush", "Seal"] },
  comms: { name: "Comms", color: "#ffd45c", actions: ["Decode", "Broadcast", "Jam"] },
};

export class SignalGame {
  constructor({ dialog, getPlayerName, savePlayerName, onResult, isSoundOn }) {
    this.dialog = dialog;
    this.getPlayerName = getPlayerName;
    this.savePlayerName = savePlayerName;
    this.onResult = onResult;
    this.isSoundOn = isSoundOn;
    this.playerId = null;
    this.playerToken = null;
    this.socket = null;
    this.room = null;
    this.station = null;
    this.lobby = null;
    this.snapshot = null;
    this.audio = null;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.resultReported = false;
    this.resuming = false;
    this.lastAnnouncedCommandId = null;
    this.render();
    this.bind();
  }

  render() {
    this.dialog.innerHTML = `
      <div class="signal-shell">
        <header class="signal-header">
          <div><span>Online co-op</span><h2>Signal Crew</h2></div>
          <strong data-signal-status role="status" aria-live="polite">Choose a mission</strong>
          <button type="button" data-signal-close aria-label="Close Signal Crew">×</button>
        </header>

        <section class="signal-view signal-home" data-signal-home>
          <span class="signal-kicker">Keep the station alive</span>
          <h3>Ready the crew.</h3>
          <p>Every player runs one console. Respond to the right command before the station loses stability.</p>
          <label class="signal-name"><span>Your name</span><input data-signal-name maxlength="18" autocomplete="nickname" placeholder="Player name" /></label>
          <div class="signal-options">
            <label><input type="checkbox" data-signal-public checked /> Public mission</label>
            <label><input type="checkbox" data-signal-bots checked /> Fill empty stations</label>
          </div>
          <div class="signal-actions">
            <button class="primary-button" type="button" data-signal-create>Create mission <span>＋</span></button>
            <button class="secondary-button" type="button" data-signal-quick>Quick join</button>
          </div>
          <div class="signal-code-join">
            <input data-signal-code maxlength="6" placeholder="ROOM CODE" />
            <button type="button" data-signal-code-join>Join</button>
          </div>
          <div class="signal-public">
            <div><span>Open missions</span><button type="button" data-signal-refresh>Refresh</button></div>
            <section data-signal-rooms><small>Scanning…</small></section>
          </div>
        </section>

        <section class="signal-view signal-invite hidden" data-signal-invite>
          <span class="signal-kicker">Crew invitation</span>
          <h3>Take a station.</h3>
          <p>Choose a name. Your console will be assigned automatically.</p>
          <label class="signal-name"><span>Your name</span><input data-signal-invite-name maxlength="18" autocomplete="nickname" placeholder="Player name" /></label>
          <button class="primary-button" type="button" data-signal-invite-ready>I am ready <span>→</span></button>
          <small data-signal-invite-code></small>
        </section>

        <section class="signal-view signal-lobby hidden" data-signal-lobby>
          <div class="signal-lobby-top">
            <div><small>Mission code</small><strong data-signal-lobby-code>------</strong></div>
            <button type="button" data-signal-copy>Copy invite link</button>
          </div>
          <div class="signal-slots" data-signal-slots></div>
          <div class="signal-lobby-actions">
            <button class="secondary-button" type="button" data-signal-ready>I'm ready</button>
            <button class="primary-button hidden" type="button" data-signal-start>Launch mission <span>→</span></button>
          </div>
          <p data-signal-lobby-note>Waiting for the crew…</p>
        </section>

        <section class="signal-view signal-mission hidden" data-signal-mission>
          <div class="signal-hud">
            <span>Stability <b data-signal-stability>♥ ♥ ♥ ♥ ♥</b></span>
            <span>Team score <b data-signal-score>0000 / 4000</b></span>
            <span>Streak <b data-signal-streak>×0</b></span>
          </div>
          <div class="signal-progress"><i data-signal-progress></i></div>
          <div class="signal-command" data-signal-command>
            <span data-signal-level>Systems waking up</span>
            <h3 data-signal-command-title>Stand by…</h3>
            <p data-signal-command-action>Awaiting first signal</p>
          </div>
          <p class="signal-sr-status" data-signal-live role="status" aria-live="assertive" aria-atomic="true"></p>
          <div class="signal-console">
            <div class="signal-console-label">
              <span>Your station</span><strong data-signal-station>—</strong>
            </div>
            <div class="signal-buttons" data-signal-buttons></div>
          </div>
          <div class="signal-crew-score" data-signal-crew-score></div>
          <div class="signal-result hidden" data-signal-result role="status" aria-live="polite">
            <span class="signal-kicker" data-signal-result-kicker>Mission complete</span>
            <h3 data-signal-result-title>Station stabilized.</h3>
            <p data-signal-result-copy></p>
            <button class="primary-button" type="button" data-signal-rematch>Vote rematch <span>↻</span></button>
            <small data-signal-rematch-status></small>
          </div>
        </section>
      </div>
    `;
  }

  bind() {
    this.$ = (selector) => this.dialog.querySelector(selector);
    this.$("[data-signal-close]").addEventListener("click", () => this.close());
    this.$("[data-signal-create]").addEventListener("click", (event) => this.loading(event.currentTarget, async () => {
      const name = this.requireName(this.$("[data-signal-name]"));
      const response = await fetch("/api/signal/rooms/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          isPublic: this.$("[data-signal-public]").checked,
          bots: this.$("[data-signal-bots]").checked,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || "Could not create mission");
      }
      const room = await response.json();
      this.join(room.code, name, {
        ownerToken: room.ownerToken,
        ownerPlayerId: room.ownerPlayerId,
        ownerAuthToken: room.ownerAuthToken,
      });
    }));
    this.$("[data-signal-quick]").addEventListener("click", (event) => this.loading(event.currentTarget, async () => {
      const name = this.requireName(this.$("[data-signal-name]"));
      const response = await fetch("/api/signal/rooms/quick", { method: "POST" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || "Could not find a mission");
      }
      const room = await response.json();
      this.join(room.code, name, {
        ownerToken: room.ownerToken || null,
        ownerPlayerId: room.ownerPlayerId || null,
        ownerAuthToken: room.ownerAuthToken || null,
      });
    }));
    this.$("[data-signal-code-join]").addEventListener("click", () => {
      try {
        const name = this.requireName(this.$("[data-signal-name]"));
        const code = this.$("[data-signal-code]").value.toUpperCase();
        if (!/^[A-Z0-9]{6}$/.test(code)) throw new Error("Enter a six-character code");
        this.join(code, name, { autoReady: true });
      } catch (error) {
        this.showError(error.message);
      }
    });
    this.$("[data-signal-code]").addEventListener("input", (event) => {
      event.target.value = event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    });
    this.$("[data-signal-invite-ready]").addEventListener("click", () => {
      try {
        const name = this.requireName(this.$("[data-signal-invite-name]"));
        this.join(new URLSearchParams(location.search).get("signal"), name, { autoReady: true });
      } catch (error) {
        this.showError(error.message);
      }
    });
    this.$("[data-signal-refresh]").addEventListener("click", () => this.loadRooms());
    this.$("[data-signal-ready]").addEventListener("click", () => {
      const me = this.lobby?.players.find((player) => player.id === this.playerId);
      this.send({ type: "ready", ready: !me?.ready });
    });
    this.$("[data-signal-start]").addEventListener("click", () => this.send({ type: "start" }));
    this.$("[data-signal-copy]").addEventListener("click", async (event) => {
      const copied = await this.copyText(`${location.origin}/?signal=${this.room}`);
      event.currentTarget.textContent = copied ? "Link copied" : "Copy failed";
      setTimeout(() => (event.currentTarget.textContent = "Copy invite link"), 1400);
    });
    this.$("[data-signal-rematch]").addEventListener("click", (event) => {
      const active = !event.currentTarget.classList.contains("voted");
      event.currentTarget.classList.toggle("voted", active);
      event.currentTarget.textContent = active ? "Rematch voted ✓" : "Vote rematch ↻";
      this.send({ type: "rematch", vote: active });
    });
    window.addEventListener("keydown", (event) => {
      if (!this.dialog.open || !["Digit1", "Digit2", "Digit3", "Numpad1", "Numpad2", "Numpad3"].includes(event.code)) return;
      if (this.$("[data-signal-mission]").classList.contains("hidden")) return;
      if (event.target.closest?.("input, textarea, select, button, [contenteditable='true']")) return;
      if (event.repeat) return;
      event.preventDefault();
      const action = Number(event.code.at(-1)) - 1;
      this.act(action);
    });
    this.dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      this.close();
    });
  }

  open() {
    if (!this.dialog.open) this.dialog.showModal();
    const name = this.getPlayerName() || "";
    this.$("[data-signal-name]").value = name;
    this.$("[data-signal-invite-name]").value = name;
    const code = new URLSearchParams(location.search).get("signal");
    if (code && /^[A-Z0-9]{6}$/i.test(code)) {
      this.show("invite");
      this.$("[data-signal-invite-code]").textContent = `Mission ${code.toUpperCase()}`;
      setTimeout(() => this.$("[data-signal-invite-name]").focus(), 50);
    } else {
      this.show("home");
      this.loadRooms();
    }
  }

  close() {
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.room = null;
    const socket = this.socket;
    this.socket = null;
    if (socket?.readyState < 2) socket.close(1000, "Left mission");
    history.replaceState({}, "", location.pathname);
    if (this.dialog.open) this.dialog.close();
  }

  roomCredentials(code, suppliedId, suppliedToken) {
    const storageKey = `signal-crew-session:${code}`;
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
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const previousSocket = this.socket;
    this.socket = null;
    if (previousSocket?.readyState < 2) previousSocket.close(1000, "Switching mission");
    this.savePlayerName(name);
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
    this.resuming = reconnect;
    if (!reconnect) this.reconnectAttempts = 0;
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const query = new URLSearchParams({ name });
    const protocols = [
      "simple-games-v1",
      `p.${this.playerId}`,
      `t.${this.playerToken}`,
    ];
    if (this.ownerToken) protocols.push(`o.${this.ownerToken}`);
    const socket = new WebSocket(
      `${protocol}//${location.host}/api/signal/rooms/${this.room}/socket?${query}`,
      protocols,
    );
    this.socket = socket;
    this.$("[data-signal-status]").textContent = "Connecting…";
    socket.addEventListener("message", (event) => {
      if (this.socket !== socket) return;
      try {
        this.message(JSON.parse(event.data));
      } catch {
        this.showError("Invalid server response");
      }
    });
    socket.addEventListener("open", () => {
      if (this.socket === socket) this.reconnectAttempts = 0;
    });
    socket.addEventListener("close", (event) => {
      if (this.socket !== socket) return;
      this.socket = null;
      if (!this.room || event.code === 1000) return;
      if (this.reconnectAttempts >= 4) {
        this.showError("Could not reconnect");
        return;
      }
      this.reconnectAttempts += 1;
      this.$("[data-signal-status]").textContent = `Reconnecting ${this.reconnectAttempts}/4…`;
      const delay = 500 * (2 ** (this.reconnectAttempts - 1)) + Math.random() * 250;
      this.reconnectTimer = setTimeout(() => {
        if (this.room) {
          this.join(this.room, this.getPlayerName() || name, {
            ownerToken: this.ownerToken,
            reconnect: true,
          });
        }
      }, delay);
    });
    socket.addEventListener("error", () => {
      if (this.socket === socket) this.showError("Could not join that mission");
    });
  }

  message(message) {
    if (message.type === "welcome") {
      this.playerId = message.playerId;
      this.station = message.station;
      history.replaceState({}, "", `?signal=${message.code}`);
      this.$("[data-signal-status]").textContent = `Mission ${message.code}`;
      if (this.autoReady) {
        this.send({ type: "ready", ready: true });
        this.autoReady = false;
      }
      this.tone(520, 0.06);
    }
    if (message.type === "lobby") {
      this.lobby = message;
      this.renderLobby();
    }
    if (message.type === "mission-start") {
      this.show("mission");
      this.missionId = message.missionId || this.missionId || null;
      this.resultReported = this.hasProcessedMission(this.missionId);
      this.lastAnnouncedCommandId = null;
      this.$("[data-signal-result]").classList.add("hidden");
      this.$("[data-signal-rematch]").classList.remove("voted");
      this.renderConsole();
      this.tone(660, 0.1);
    }
    if (message.type === "signal-snapshot") {
      this.snapshot = message;
      this.missionId = message.missionId || this.missionId;
      this.renderMission();
      this.resuming = false;
    }
    if (message.type === "rematch-status") {
      const suffix = message.waitingForHost ? " · waiting for Game Master" : "";
      this.$("[data-signal-rematch-status]").textContent =
        `${message.votes} of ${message.needed} crew voted${suffix}`;
    }
    if (message.type === "return-lobby") this.show("lobby");
    if (message.type === "mission-interrupted") {
      this.snapshot = null;
      this.show("lobby");
      this.$("[data-signal-status]").textContent = message.reason || "Mission interrupted";
    }
    if (message.type === "rematch-starting") this.$("[data-signal-result]").classList.add("hidden");
    if (message.type === "notice") this.$("[data-signal-status]").textContent = message.text;
    if (message.type === "room-closed") {
      this.room = null;
      this.show("lobby");
      this.$("[data-signal-lobby-code]").textContent = "------";
      this.$("[data-signal-slots]").innerHTML = `<div class="signal-closed"><span class="signal-kicker">Mission closed</span><h3>Game Master left.</h3><p>${this.escape(message.reason)}</p></div>`;
      this.$(".signal-lobby-actions")?.classList.add("hidden");
      this.$("[data-signal-copy]")?.classList.add("hidden");
      this.$("[data-signal-lobby-note]").textContent = "Close this window to return to the games.";
    }
  }

  renderLobby() {
    this.show("lobby");
    const lobby = this.lobby;
    this.$(".signal-lobby-actions")?.classList.remove("hidden");
    this.$("[data-signal-copy]")?.classList.remove("hidden");
    this.$("[data-signal-lobby-code]").textContent = lobby.code;
    this.$("[data-signal-slots]").innerHTML = lobby.players.map((player) => `
      <div class="signal-slot ${player.bot ? "bot" : ""}" style="--station:${player.color}">
        <i></i><span><b>${this.escape(player.name)}${player.id === this.playerId ? " (you)" : ""}</b><small>${player.stationName}</small></span>
        <em>${player.id === lobby.hostId ? "Game Master" : player.ready ? "Ready" : player.name === "Open station" ? "Open" : "Not ready"}</em>
      </div>
    `).join("");
    const me = lobby.players.find((player) => player.id === this.playerId);
    const host = lobby.hostId === this.playerId;
    const humans = lobby.players.filter((player) => !player.bot && player.name !== "Open station");
    const canStart = lobby.players.every((player) => player.name !== "Open station")
      && humans.every((player) => player.id === lobby.hostId || player.ready);
    this.$("[data-signal-ready]").classList.toggle("hidden", host);
    this.$("[data-signal-ready]").textContent = me?.ready ? "Ready ✓" : "I'm ready";
    this.$("[data-signal-start]").classList.toggle("hidden", !host);
    this.$("[data-signal-start]").disabled = !canStart;
    this.$("[data-signal-lobby-note]").textContent = host
      ? canStart ? "Crew ready. Launch when you are." : "You are the Game Master. Waiting for ready checks."
      : `You operate ${STATIONS[me?.station]?.name || "a station"}.`;
  }

  renderConsole() {
    const station = STATIONS[this.station];
    if (!station) return;
    this.$("[data-signal-station]").textContent = station.name;
    this.$("[data-signal-station]").style.color = station.color;
    this.$("[data-signal-buttons]").innerHTML = station.actions.map((action, index) => `
      <button type="button" data-signal-action="${index}"><kbd>${index + 1}</kbd><span>${action}</span></button>
    `).join("");
    this.dialog.querySelectorAll("[data-signal-action]").forEach((button) => {
      button.addEventListener("click", () => this.act(Number(button.dataset.signalAction)));
    });
  }

  renderMission() {
    const state = this.snapshot;
    this.$("[data-signal-stability]").textContent = `${"♥ ".repeat(state.stability)}${"· ".repeat(5 - state.stability)}`.trim();
    this.$("[data-signal-score]").textContent = `${String(state.score).padStart(4, "0")} / ${state.targetScore}`;
    this.$("[data-signal-streak]").textContent = `×${state.streak}`;
    this.$("[data-signal-progress]").style.width = `${Math.min(100, state.score / state.targetScore * 100)}%`;
    const command = state.command;
    if (command) {
      this.$("[data-signal-level]").textContent = `Level ${command.level} · ${Math.ceil(command.remaining / 1000)}s`;
      this.$("[data-signal-command-title]").textContent = command.stationName;
      this.$("[data-signal-command-title]").style.color = command.color;
      this.$("[data-signal-command-action]").textContent = command.actionName;
      this.$("[data-signal-command]").style.setProperty("--command-progress", `${command.remaining / command.deadline * 100}%`);
      this.$("[data-signal-command]").classList.toggle("your-command", command.station === this.station);
      if (command.id !== this.lastAnnouncedCommandId) {
        this.lastAnnouncedCommandId = command.id;
        this.$("[data-signal-live]").textContent = command.station === this.station
          ? `Your station. ${command.actionName}.`
          : `${command.stationName} station. ${command.actionName}.`;
      }
    } else {
      this.$("[data-signal-level]").textContent = state.countdown ? `Starting in ${state.countdown}` : state.message;
      this.$("[data-signal-command-title]").textContent = "Stand by…";
      this.$("[data-signal-command-title]").style.color = "";
      this.$("[data-signal-command-action]").textContent = "Awaiting next signal";
      this.$("[data-signal-command]").classList.remove("your-command");
    }
    this.dialog.querySelectorAll("[data-signal-action]").forEach((button) => {
      button.disabled = !command || command.station !== this.station || state.over;
    });
    this.$("[data-signal-crew-score]").innerHTML = state.crew.map((member) => `
      <span><i style="background:${STATIONS[member.station].color}"></i>${this.escape(member.name)} <b>${member.contribution}</b></span>
    `).join("");
    if (state.over) {
      this.$("[data-signal-result]").classList.remove("hidden");
      this.$("[data-signal-result-kicker]").textContent = state.victory ? "Mission complete" : "Mission failed";
      this.$("[data-signal-result-title]").textContent = state.victory ? "Station stabilized." : "The signal won.";
      this.$("[data-signal-result-copy]").textContent = `Team score ${state.score}. Best streak ×${state.bestStreak}.`;
      if (!this.resultReported) {
        this.resultReported = true;
        this.markMissionProcessed(state.missionId || this.missionId);
        this.onResult?.({ won: state.victory, score: state.score });
        this.tone(state.victory ? 760 : 130, 0.2);
        this.$("[data-signal-rematch]")?.focus({ preventScroll: true });
      }
    }
  }

  act(action) {
    if (!this.snapshot?.command || this.snapshot.over || this.snapshot.command.station !== this.station) return;
    this.send({ type: "action", action });
    this.tone(300 + action * 90, 0.035);
  }

  async loadRooms() {
    const node = this.$("[data-signal-rooms]");
    node.innerHTML = "<small>Scanning…</small>";
    try {
      const response = await fetch("/api/signal/rooms");
      const rooms = (await response.json()).rooms;
      node.innerHTML = rooms.length ? rooms.map((room) => `
        <button type="button" data-signal-room="${room.code}"><span><b>${room.code}</b><small>${room.players}/4 crew</small></span><i>Join →</i></button>
      `).join("") : "<small>No open missions. Start the first one.</small>";
      node.querySelectorAll("[data-signal-room]").forEach((button) => button.addEventListener("click", () => {
        try {
          this.join(button.dataset.signalRoom, this.requireName(this.$("[data-signal-name]")), { autoReady: true });
        } catch (error) {
          this.showError(error.message);
        }
      }));
    } catch {
      node.innerHTML = "<small>Could not scan public missions.</small>";
    }
  }

  show(view) {
    this.dialog.querySelectorAll(".signal-view").forEach((node) => node.classList.add("hidden"));
    this.$(`[data-signal-${view}]`).classList.remove("hidden");
  }

  requireName(input) {
    const name = input.value.trim().slice(0, 18);
    if (!name) {
      input.focus();
      throw new Error("Add your name first");
    }
    return name;
  }

  send(payload) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(payload));
  }

  async loading(button, action) {
    const original = button.innerHTML;
    button.disabled = true;
    button.textContent = "Working…";
    try {
      await action();
    } catch (error) {
      this.showError(error.message);
    } finally {
      button.disabled = false;
      button.innerHTML = original;
    }
  }

  async copyText(value) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      const input = document.createElement("textarea");
      input.value = value;
      input.setAttribute("readonly", "");
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.append(input);
      input.select();
      let copied = false;
      try {
        copied = document.execCommand("copy");
      } catch {
        copied = false;
      }
      input.remove();
      return copied;
    }
  }

  showError(message) {
    this.$("[data-signal-status]").textContent = message;
  }

  processedMissions() {
    try {
      const value = JSON.parse(localStorage.getItem("signal-crew-processed-results") || "[]");
      return Array.isArray(value) ? value.filter((item) => typeof item === "string").slice(-50) : [];
    } catch {
      return [];
    }
  }

  hasProcessedMission(missionId) {
    return Boolean(missionId && this.processedMissions().includes(missionId));
  }

  markMissionProcessed(missionId) {
    if (!missionId) return;
    const missions = this.processedMissions().filter((item) => item !== missionId);
    missions.push(missionId);
    try { localStorage.setItem("signal-crew-processed-results", JSON.stringify(missions.slice(-50))); } catch {}
  }

  tone(frequency, duration) {
    if (!this.isSoundOn()) return;
    try {
      this.audio ||= new AudioContext();
      const oscillator = this.audio.createOscillator();
      const gain = this.audio.createGain();
      oscillator.type = "triangle";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.04, this.audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.audio.currentTime + duration);
      oscillator.connect(gain).connect(this.audio.destination);
      oscillator.start();
      oscillator.stop(this.audio.currentTime + duration);
    } catch {}
  }

  escape(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  }
}
