import "./style.css";
import { ArenaGame } from "./arena.js";

const app = document.querySelector("#app");

app.innerHTML = `
  <header class="site-header">
    <a class="brand" href="#" aria-label="Simple Games home">
      <span class="brand-mark"><i></i><i></i><i></i><i></i></span>
      <span>SIMPLE<br>GAMES</span>
    </a>
    <nav aria-label="Main navigation">
      <a href="#games">All games</a>
      <a href="#about">About</a>
    </nav>
    <button class="sound-button" type="button" aria-label="Toggle sound">
      <span class="sound-bars"><i></i><i></i><i></i></span>
      <span class="sound-label">Sound on</span>
    </button>
  </header>

  <main>
    <section class="hero">
      <div class="eyebrow"><span></span> Play solo or together</div>
      <h1>Tiny games.<br><em>Big nights.</em></h1>
      <p>Quick browser games for quiet breaks and loud group chats. Play at your own pace or invite friends with a link.</p>
      <a class="primary-button" href="#games">Choose a game <span>↓</span></a>
      <div class="hero-orbit orbit-a"></div>
      <div class="hero-orbit orbit-b"></div>
      <span class="spark spark-one">✦</span>
      <span class="spark spark-two">✦</span>
      <span class="ball-decoration"></span>
    </section>

    <section class="games-section" id="games">
      <div class="section-heading">
        <div>
          <div class="eyebrow"><span></span> Your game, your company</div>
          <h2>Games on deck</h2>
        </div>
        <p>Every game works either as a focused solo challenge or as something worth sharing with friends.</p>
      </div>

      <div class="game-grid">
        <article class="game-card featured">
          <div class="card-art arena-art" aria-hidden="true">
            <div class="mini-arena">
              <i class="mini-paddle top"></i><i class="mini-paddle right"></i>
              <i class="mini-paddle bottom"></i><i class="mini-paddle left"></i>
              <b class="mini-ball one"></b><b class="mini-ball two"></b>
              <span>4</span>
            </div>
            <div class="art-grid"></div>
          </div>
          <div class="card-body">
            <div class="tags"><span>Multiplayer</span><span>1–4 players</span></div>
            <h3>Four Sides</h3>
            <p>Claim one side, share a room link, and defend your edge against friends or bots.</p>
            <button class="play-button" type="button" data-play>
              Play now <span>↗</span>
            </button>
          </div>
        </article>

        <article class="game-card coming">
          <div class="card-art rhythm-art"><span>♪</span><span>●</span><span>♪</span></div>
          <div class="card-body">
            <div class="tags"><span>Co-op</span><span>2–4 players</span></div>
            <h3>Signal Crew</h3>
            <p>Keep a tiny station alive together. Match the signals before the whole system goes dark.</p>
            <span class="soon-label">Coming soon</span>
          </div>
        </article>

        <article class="game-card coming">
          <div class="card-art maze-art"><div></div><span>◆</span></div>
          <div class="card-body">
            <div class="tags"><span>Solo</span><span>1 player</span></div>
            <h3>One Way Out</h3>
            <p>A tiny maze that changes every time you blink. Find the exit before time does.</p>
            <span class="soon-label">Coming soon</span>
          </div>
        </article>
      </div>
    </section>

    <section class="manifesto" id="about">
      <span class="manifesto-kicker">The simple promise</span>
      <p>No downloads. No 40-minute tutorials.</p>
      <p class="muted">Play alone, invite a friend, or bring the whole crew.</p>
    </section>
  </main>

  <footer>
    <a class="brand footer-brand" href="#"><span class="brand-mark"><i></i><i></i><i></i><i></i></span><span>SIMPLE<br>GAMES</span></a>
    <p>Made for one player or many · 2026</p>
  </footer>

  <dialog class="game-dialog" aria-label="Four Sides game">
    <div class="game-shell">
      <header class="game-header">
        <div>
          <span class="game-kicker">Online multiplayer</span>
          <h2>Four Sides</h2>
        </div>
        <div class="game-stats">
          <span class="room-status">Status <b data-status>Choose a room</b></span>
          <div class="player-scores" data-score></div>
        </div>
        <button class="close-game" type="button" aria-label="Close game">×</button>
      </header>
      <div class="canvas-wrap">
        <canvas id="arena" width="900" height="620"></canvas>
        <div class="game-overlay" data-overlay>
          <div class="multiplayer-home" data-multiplayer-home>
            <span class="overlay-kicker">One side. One player.</span>
            <h3>Enter the arena.</h3>
            <p>Create a room for friends, jump into a public match, or fill empty sides with bots.</p>
            <label class="name-field">
              <span>Your name</span>
              <input type="text" maxlength="18" placeholder="Player name" data-player-name autocomplete="nickname" />
            </label>
            <div class="mode-picker" data-mode-picker>
              <button class="mode-option selected" type="button" data-mode="duel"><b>1 vs 1</b><span>Left & right</span></button>
              <button class="mode-option" type="button" data-mode="teams"><b>2 vs 2</b><span>Team battle</span></button>
              <button class="mode-option" type="button" data-mode="ffa"><b>4-way</b><span>Every side for itself</span></button>
            </div>
            <div class="room-options">
              <label><input type="checkbox" data-public checked /><i></i> Public room</label>
              <label><input type="checkbox" data-bots checked /><i></i> Fill with bots</label>
            </div>
            <div class="join-actions">
              <button class="primary-button" type="button" data-create-room>Create room <span>＋</span></button>
              <button class="secondary-button" type="button" data-quick-play>Quick play <span>→</span></button>
            </div>
            <div class="code-join">
              <span>Have a room code?</span>
              <input type="text" maxlength="6" placeholder="ABC123" data-room-code />
              <button type="button" data-join-code>Join</button>
            </div>
            <div class="public-rooms">
              <div class="public-title"><span>Public lobbies</span><button type="button" data-refresh-rooms>Refresh</button></div>
              <div class="room-list" data-room-list><span class="empty-rooms">Loading rooms…</span></div>
            </div>
          </div>

          <div class="room-lobby hidden" data-room-lobby>
            <span class="overlay-kicker">Lobby <b data-lobby-mode></b></span>
            <div class="lobby-code-row">
              <div><small>Room code</small><strong data-lobby-code>------</strong></div>
              <button class="share-button" type="button" data-copy-link>Copy invite link</button>
            </div>
            <div class="lobby-slots" data-lobby-slots></div>
            <div class="lobby-controls">
              <button class="ready-button" type="button" data-ready>I'm ready</button>
              <button class="primary-button hidden" type="button" data-start-match>Start match <span>→</span></button>
            </div>
            <p class="lobby-note" data-lobby-note>Waiting for the host…</p>
          </div>
        </div>
        <div class="touch-controls" aria-label="Touch controls">
          <button type="button" data-move="-1" aria-label="Move backward">←</button>
          <button type="button" data-move="1" aria-label="Move forward">→</button>
        </div>
      </div>
      <p class="game-hint">Move with arrows or WASD · Your paddle glows brighter · First to 7 wins</p>
    </div>
  </dialog>
`;

const soundButton = document.querySelector(".sound-button");
let soundOn = true;
soundButton.addEventListener("click", () => {
  soundOn = !soundOn;
  soundButton.classList.toggle("muted", !soundOn);
  document.querySelector(".sound-label").textContent = soundOn ? "Sound on" : "Sound off";
});

const dialog = document.querySelector(".game-dialog");
const homeNode = document.querySelector("[data-multiplayer-home]");
const lobbyNode = document.querySelector("[data-room-lobby]");
const nameInput = document.querySelector("[data-player-name]");
const codeInput = document.querySelector("[data-room-code]");
let selectedMode = "duel";
let latestLobby = null;

const game = new ArenaGame({
  canvas: document.querySelector("#arena"),
  scoreNode: document.querySelector("[data-score]"),
  statusNode: document.querySelector("[data-status]"),
  overlay: document.querySelector("[data-overlay]"),
  lobbyNode,
  isSoundOn: () => soundOn,
  onLobby: renderLobby,
});

nameInput.value = game.name;

document.querySelector("[data-play]").addEventListener("click", async () => {
  dialog.showModal();
  game.resize();
  await showRoomHome();
});

document.querySelector(".close-game").addEventListener("click", () => {
  game.disconnect();
  history.replaceState({}, "", location.pathname);
  dialog.close();
});

document.querySelectorAll("[data-mode]").forEach((button) => {
  button.addEventListener("click", () => {
    selectedMode = button.dataset.mode;
    document.querySelectorAll("[data-mode]").forEach((item) => item.classList.toggle("selected", item === button));
  });
});

document.querySelector("[data-create-room]").addEventListener("click", async (event) => {
  await withLoading(event.currentTarget, async () => {
    requireName();
    const room = await game.createRoom({
      mode: selectedMode,
      isPublic: document.querySelector("[data-public]").checked,
      bots: document.querySelector("[data-bots]").checked,
    });
    game.join(room.code, nameInput.value);
  });
});

document.querySelector("[data-quick-play]").addEventListener("click", async (event) => {
  await withLoading(event.currentTarget, async () => {
    requireName();
    const room = await game.quickPlay(selectedMode);
    game.join(room.code, nameInput.value);
  });
});

document.querySelector("[data-join-code]").addEventListener("click", () => {
  try {
    requireName();
    const code = codeInput.value.trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(code)) throw new Error("Enter a 6-character room code");
    game.join(code, nameInput.value);
  } catch (error) {
    showLobbyError(error.message);
  }
});

codeInput.addEventListener("input", () => (codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "")));
document.querySelector("[data-refresh-rooms]").addEventListener("click", loadPublicRooms);
document.querySelector("[data-ready]").addEventListener("click", (event) => {
  const me = latestLobby?.players.find((player) => player.id === game.playerId);
  game.send({ type: "ready", ready: !me?.ready });
  event.currentTarget.classList.toggle("active", !me?.ready);
});
document.querySelector("[data-start-match]").addEventListener("click", () => game.send({ type: "start" }));
document.querySelector("[data-copy-link]").addEventListener("click", async (event) => {
  await navigator.clipboard.writeText(`${location.origin}/?room=${latestLobby.code}`);
  event.currentTarget.textContent = "Link copied!";
  setTimeout(() => (event.currentTarget.textContent = "Copy invite link"), 1600);
});
document.querySelectorAll("[data-move]").forEach((button) => game.bindTouch(button, Number(button.dataset.move)));

dialog.addEventListener("cancel", () => game.disconnect());
window.addEventListener("resize", () => game.resize());

async function showRoomHome() {
  homeNode.classList.remove("hidden");
  lobbyNode.classList.add("hidden");
  document.querySelector("[data-overlay]").classList.remove("hidden");
  const queryRoom = new URLSearchParams(location.search).get("room");
  if (queryRoom && /^[A-Z0-9]{6}$/i.test(queryRoom) && nameInput.value) {
    game.join(queryRoom, nameInput.value);
    return;
  }
  await loadPublicRooms();
}

async function loadPublicRooms() {
  const list = document.querySelector("[data-room-list]");
  list.innerHTML = `<span class="empty-rooms">Finding open rooms…</span>`;
  try {
    const rooms = await game.listRooms();
    if (!rooms.length) {
      list.innerHTML = `<span class="empty-rooms">No open rooms yet. Start the first one.</span>`;
      return;
    }
    list.innerHTML = rooms.map((room) => `
      <button type="button" data-public-room="${room.code}">
        <span><b>${escapeHtml(room.code)}</b><small>${modeLabel(room.mode)}</small></span>
        <i>${room.players}/${room.mode === "duel" ? 2 : 4}</i>
      </button>
    `).join("");
    list.querySelectorAll("[data-public-room]").forEach((button) => button.addEventListener("click", () => {
      try {
        requireName();
        game.join(button.dataset.publicRoom, nameInput.value);
      } catch (error) {
        showLobbyError(error.message);
      }
    }));
  } catch {
    list.innerHTML = `<span class="empty-rooms">Public rooms are temporarily unavailable.</span>`;
  }
}

function renderLobby(lobby, playerId) {
  latestLobby = lobby;
  homeNode.classList.add("hidden");
  lobbyNode.classList.remove("hidden");
  document.querySelector("[data-lobby-code]").textContent = lobby.code;
  document.querySelector("[data-lobby-mode]").textContent = lobby.modeLabel;
  const me = lobby.players.find((player) => player.id === playerId);
  const isHost = lobby.hostId === playerId;
  document.querySelector("[data-lobby-slots]").innerHTML = lobby.players.map((player) => `
    <div class="lobby-slot ${player.bot ? "bot" : ""}" style="--slot-color:${player.color}">
      <i></i>
      <span><b>${escapeHtml(player.name)}${player.id === playerId ? " (you)" : ""}</b><small>${player.side}${player.bot ? " · CPU" : ""}</small></span>
      <em>${player.ready ? "Ready" : player.name === "Open slot" ? "Joinable" : "Not ready"}</em>
    </div>
  `).join("");
  const readyButton = document.querySelector("[data-ready]");
  readyButton.classList.toggle("hidden", isHost);
  readyButton.classList.toggle("active", Boolean(me?.ready));
  readyButton.textContent = me?.ready ? "Ready ✓" : "I'm ready";
  const startButton = document.querySelector("[data-start-match]");
  startButton.classList.toggle("hidden", !isHost);
  const humans = lobby.players.filter((player) => !player.bot && player.name !== "Open slot");
  const canStart = (humans.length >= 2 || lobby.bots) && humans.every((player) => player.id === lobby.hostId || player.ready);
  startButton.disabled = !canStart;
  document.querySelector("[data-lobby-note]").textContent = isHost
    ? canStart ? "Everyone is ready. Start when you are." : "Waiting for players to ready up."
    : `You control the ${me?.side || ""} side. Ready up when set.`;
}

async function withLoading(button, action) {
  const original = button.innerHTML;
  button.disabled = true;
  button.textContent = "Working…";
  try {
    await action();
  } catch (error) {
    showLobbyError(error.message);
  } finally {
    button.disabled = false;
    button.innerHTML = original;
  }
}

function requireName() {
  if (!nameInput.value.trim()) {
    nameInput.focus();
    throw new Error("Add your name first");
  }
}

function showLobbyError(message) {
  const list = document.querySelector("[data-room-list]");
  list.innerHTML = `<span class="empty-rooms error">${escapeHtml(message)}</span>`;
}

function modeLabel(mode) {
  return ({ duel: "1 vs 1", teams: "2 vs 2", ffa: "4-way" })[mode] || mode;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

const sharedRoom = new URLSearchParams(location.search).get("room");
if (sharedRoom) {
  dialog.showModal();
  game.resize();
  showRoomHome();
}
