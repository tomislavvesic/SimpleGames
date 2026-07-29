import "./styles.css";
import { copyText, escapeHtml } from "../../../shared/ui.js";
import { ArenaGame } from "./game.js";
import { createFourSidesDialog } from "./view.js";

const ROOM_CODE_PATTERN = /^[A-Z0-9]{6}$/;

export function createGame({
  document,
  manifest,
  profileStore,
  profileUI,
  isSoundOn,
  onRequestClose,
}) {
  const dialog = createFourSidesDialog(document);
  const query = (selector) => dialog.querySelector(selector);
  const homeNode = query("[data-multiplayer-home]");
  const inviteNode = query("[data-invite-join]");
  const lobbyNode = query("[data-room-lobby]");
  const nameInput = query("[data-player-name]");
  const inviteNameInput = query("[data-invite-name]");
  const codeInput = query("[data-room-code]");
  let selectedMode = "duel";
  let latestLobby = null;
  let isOpen = false;
  let openEpoch = 0;
  const pendingRequests = new Set();

  const game = new ArenaGame({
    canvas: query("#arena"),
    scoreNode: query("[data-score]"),
    statusNode: query("[data-status]"),
    overlay: query("[data-overlay]"),
    lobbyNode,
    resultNode: query("[data-four-result]"),
    isSoundOn,
    onLobby: renderLobby,
    onResult: ({ won, lives }) => {
      profileUI.recordGame(manifest.profileId, {
        outcome: won ? "win" : "loss",
        score: lives,
      });
    },
    onConnectionFailure: (message) => {
      const inviteButton = query("[data-invite-ready]");
      inviteButton.disabled = false;
      inviteButton.innerHTML = "I am ready <span>→</span>";
      query("[data-invite-code]").textContent = message;
    },
  });

  nameInput.value = profileStore.nickname || game.name;
  inviteNameInput.value = profileStore.nickname || game.name;
  profileUI.bindNicknameInput(nameInput);
  profileUI.bindNicknameInput(inviteNameInput);

  queryAll("[data-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedMode = button.dataset.mode;
      queryAll("[data-mode]").forEach((item) => {
        const selected = item === button;
        item.classList.toggle("selected", selected);
        item.setAttribute("aria-pressed", String(selected));
      });
    });
  });

  query("[data-create-room]").addEventListener("click", async (event) => {
    await withLoading(event.currentTarget, async () => {
      requireName();
      const room = await requestWhileOpen((signal) => game.createRoom(
        {
          mode: selectedMode,
          isPublic: query("[data-public]").checked,
          bots: query("[data-bots]").checked,
        },
        { signal },
      ));
      if (!room) return;
      game.join(room.code, nameInput.value, {
        ownerToken: room.ownerToken,
        ownerPlayerId: room.ownerPlayerId,
        ownerAuthToken: room.ownerAuthToken,
      });
    });
  });

  query("[data-quick-play]").addEventListener("click", async (event) => {
    await withLoading(event.currentTarget, async () => {
      requireName();
      const room = await requestWhileOpen(
        (signal) => game.quickPlay(selectedMode, { signal }),
      );
      if (!room) return;
      game.join(room.code, nameInput.value, {
        ownerToken: room.ownerToken || null,
        ownerPlayerId: room.ownerPlayerId || null,
        ownerAuthToken: room.ownerAuthToken || null,
      });
    });
  });

  query("[data-join-code]").addEventListener("click", () => {
    try {
      requireName();
      const code = codeInput.value.trim().toUpperCase();
      if (!ROOM_CODE_PATTERN.test(code)) throw new Error("Enter a 6-character room code");
      game.join(code, nameInput.value);
    } catch (error) {
      showLobbyError(error.message);
    }
  });

  query("[data-invite-ready]").addEventListener("click", (event) => {
    const code = new URLSearchParams(location.search).get(manifest.legacyQuery);
    const name = inviteNameInput.value.trim();
    if (!name) {
      inviteNameInput.focus();
      return;
    }
    if (!ROOM_CODE_PATTERN.test(code?.toUpperCase() || "")) {
      query("[data-invite-code]").textContent = "That room link is invalid.";
      return;
    }
    event.currentTarget.disabled = true;
    event.currentTarget.textContent = "Joining…";
    game.join(code, name, { autoReady: true });
  });

  codeInput.addEventListener("input", () => {
    codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  });
  query("[data-refresh-rooms]").addEventListener("click", loadPublicRooms);
  query("[data-ready]").addEventListener("click", (event) => {
    const me = latestLobby?.players.find((player) => player.id === game.playerId);
    game.send({ type: "ready", ready: !me?.ready });
    event.currentTarget.classList.toggle("active", !me?.ready);
  });
  query("[data-start-match]").addEventListener("click", () => game.send({ type: "start" }));
  query("[data-copy-link]").addEventListener("click", async (event) => {
    if (!latestLobby?.code) return;
    const inviteUrl = new URL(manifest.route, location.origin);
    inviteUrl.searchParams.set(manifest.legacyQuery, latestLobby.code);
    const copied = await copyText(inviteUrl.href, { document });
    event.currentTarget.textContent = copied ? "Link copied!" : "Copy failed";
    setTimeout(() => {
      event.currentTarget.textContent = "Copy invite link";
    }, 1600);
  });
  queryAll("[data-move]").forEach((button) => {
    game.bindTouch(button, Number(button.dataset.move));
  });
  query("[data-four-rematch]").addEventListener("click", (event) => {
    const active = !event.currentTarget.classList.contains("voted");
    event.currentTarget.classList.toggle("voted", active);
    event.currentTarget.innerHTML = active
      ? "Rematch voted <span>✓</span>"
      : "Vote rematch <span>↻</span>";
    game.send({ type: "rematch", vote: active });
  });

  query(".close-game").addEventListener("click", () => closeGame({ notify: true }));
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeGame({ notify: true });
  });
  window.addEventListener("resize", () => {
    if (dialog.open) game.resize();
  });

  function queryAll(selector) {
    return [...dialog.querySelectorAll(selector)];
  }

  async function showRoomHome() {
    homeNode.classList.remove("hidden");
    inviteNode.classList.add("hidden");
    lobbyNode.classList.add("hidden");
    query("[data-overlay]").classList.remove("hidden");
    const queryRoom = new URLSearchParams(location.search).get(manifest.legacyQuery);
    if (queryRoom && ROOM_CODE_PATTERN.test(queryRoom.toUpperCase())) {
      homeNode.classList.add("hidden");
      inviteNode.classList.remove("hidden");
      query("[data-invite-code]").textContent = `Room ${queryRoom.toUpperCase()}`;
      setTimeout(() => inviteNameInput.focus(), 50);
      return;
    }
    await loadPublicRooms();
  }

  async function loadPublicRooms() {
    const list = query("[data-room-list]");
    list.innerHTML = '<span class="empty-rooms">Finding open rooms…</span>';
    try {
      const rooms = await requestWhileOpen((signal) => game.listRooms({ signal }));
      if (!rooms) return;
      if (!rooms.length) {
        list.innerHTML = '<span class="empty-rooms">No open rooms yet. Start the first one.</span>';
        return;
      }
      list.innerHTML = rooms.map((room) => `
        <button type="button" data-public-room="${room.code}">
          <span><b>${escapeHtml(room.code)}</b><small>${modeLabel(room.mode)}</small></span>
          <i>${room.players}/${room.mode === "duel" ? 2 : 4}</i>
        </button>
      `).join("");
      list.querySelectorAll("[data-public-room]").forEach((button) => {
        button.addEventListener("click", () => {
          try {
            requireName();
            game.join(button.dataset.publicRoom, nameInput.value);
          } catch (error) {
            showLobbyError(error.message);
          }
        });
      });
    } catch {
      if (isOpen) {
        list.innerHTML = '<span class="empty-rooms">Public rooms are temporarily unavailable.</span>';
      }
    }
  }

  async function requestWhileOpen(action) {
    if (!isOpen) return null;
    const requestEpoch = openEpoch;
    const controller = new AbortController();
    pendingRequests.add(controller);
    try {
      const result = await action(controller.signal);
      return isOpen && requestEpoch === openEpoch ? result : null;
    } catch (error) {
      if (error.name === "AbortError" || !isOpen || requestEpoch !== openEpoch) {
        return null;
      }
      throw error;
    } finally {
      pendingRequests.delete(controller);
    }
  }

  function abortPendingRequests() {
    pendingRequests.forEach((controller) => controller.abort());
    pendingRequests.clear();
  }

  function renderLobby(lobby, playerId) {
    latestLobby = lobby;
    homeNode.classList.add("hidden");
    inviteNode.classList.add("hidden");
    lobbyNode.classList.remove("hidden");
    lobbyNode.querySelector(".lobby-controls")?.classList.remove("hidden");
    lobbyNode.querySelector("[data-copy-link]")?.classList.remove("hidden");
    query("[data-lobby-code]").textContent = lobby.code;
    query("[data-lobby-mode]").textContent = lobby.modeLabel;
    const me = lobby.players.find((player) => player.id === playerId);
    const isHost = lobby.hostId === playerId;
    query("[data-lobby-slots]").innerHTML = lobby.players.map((player) => `
      <div class="lobby-slot ${player.bot ? "bot" : ""}" style="--slot-color:${player.color}">
        <i></i>
        <span>
          <b>${escapeHtml(player.name)}${player.id === playerId ? " (you)" : ""}</b>
          <small>${player.side}${player.bot ? " · CPU" : ""}</small>
        </span>
        <em>${player.id === lobby.hostId
          ? "Game Master"
          : player.ready
            ? "Ready"
            : player.name === "Open slot" ? "Joinable" : "Not ready"}</em>
      </div>
    `).join("");
    const readyButton = query("[data-ready]");
    readyButton.classList.toggle("hidden", isHost);
    readyButton.classList.toggle("active", Boolean(me?.ready));
    readyButton.textContent = me?.ready ? "Ready ✓" : "I'm ready";
    const startButton = query("[data-start-match]");
    startButton.classList.toggle("hidden", !isHost);
    const humans = lobby.players.filter((player) => !player.bot && player.name !== "Open slot");
    const canStart = lobby.players.every((player) => player.name !== "Open slot")
      && humans.every((player) => player.id === lobby.hostId || player.ready);
    startButton.disabled = !canStart;
    query("[data-lobby-note]").textContent = isHost
      ? canStart
        ? "Everyone is ready. Start when you are."
        : "You are the Game Master. Waiting for players to ready up."
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
    profileStore.setIdentity({ nickname: nameInput.value.trim() });
  }

  function showLobbyError(message) {
    query("[data-room-list]").innerHTML =
      `<span class="empty-rooms error">${escapeHtml(message)}</span>`;
  }

  function closeGame({ notify }) {
    isOpen = false;
    openEpoch += 1;
    abortPendingRequests();
    game.disconnect();
    if (dialog.open) dialog.close();
    if (notify) onRequestClose();
  }

  return {
    async open() {
      abortPendingRequests();
      isOpen = true;
      openEpoch += 1;
      if (!dialog.open) dialog.showModal();
      game.startRendering();
      game.resize();
      await showRoomHome();
    },
    close() {
      closeGame({ notify: false });
    },
  };
}

function modeLabel(mode) {
  return ({ duel: "1 vs 1", teams: "2 vs 2", ffa: "4-way" })[mode] || mode;
}
