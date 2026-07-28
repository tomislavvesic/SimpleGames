import assert from "node:assert/strict";

const baseUrl = process.env.INTEGRATION_BASE_URL || "http://127.0.0.1:8791";
const selectedGame = process.env.SMOKE_GAME || "all";
const wsBase = baseUrl.replace(/^http/, "ws");
const sockets = new Set();

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function requestJson(path, options) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const body = await response.json().catch(() => ({}));
  assert.ok(response.ok, `${options?.method || "GET"} ${path} failed (${response.status}): ${JSON.stringify(body)}`);
  return body;
}

async function poll(check, { timeout = 5000, interval = 100 } = {}) {
  const deadline = Date.now() + timeout;
  let value;
  while (Date.now() < deadline) {
    value = await check();
    if (value) return value;
    await delay(interval);
  }
  throw new Error(`Condition was not met within ${timeout}ms`);
}

class Probe {
  constructor(target) {
    const { path, protocols = [] } = typeof target === "string" ? { path: target } : target;
    this.messages = [];
    this.waiters = [];
    this.socket = new WebSocket(`${wsBase}${path}`, protocols);
    this.opened = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`WebSocket open timed out: ${path}`)), 5000);
      this.socket.addEventListener("open", () => {
        clearTimeout(timeout);
        resolve();
      }, { once: true });
      this.socket.addEventListener("error", () => {
        clearTimeout(timeout);
        reject(new Error(`WebSocket rejected: ${path}`));
      }, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      const waiterIndex = this.waiters.findIndex((waiter) => waiter.predicate(message));
      if (waiterIndex >= 0) {
        const [waiter] = this.waiters.splice(waiterIndex, 1);
        clearTimeout(waiter.timer);
        waiter.resolve(message);
      } else {
        this.messages.push(message);
      }
    });
    sockets.add(this);
  }

  async ready() {
    await this.opened;
    return this;
  }

  send(message) {
    assert.equal(this.socket.readyState, WebSocket.OPEN, "socket must be open before sending");
    this.socket.send(JSON.stringify(message));
  }

  waitFor(predicate, timeout = 5000) {
    const index = this.messages.findIndex(predicate);
    if (index >= 0) return Promise.resolve(this.messages.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve, reject, timer: null };
      waiter.timer = setTimeout(() => {
        const position = this.waiters.indexOf(waiter);
        if (position >= 0) this.waiters.splice(position, 1);
        reject(new Error(`WebSocket message timed out after ${timeout}ms`));
      }, timeout);
      this.waiters.push(waiter);
    });
  }

  type(type, timeout) {
    return this.waitFor((message) => message.type === type, timeout);
  }

  async close(code = 1000, reason = "Smoke test complete") {
    if (this.socket.readyState >= WebSocket.CLOSING) return;
    const closed = new Promise((resolve) => this.socket.addEventListener("close", resolve, { once: true }));
    this.socket.close(code, reason);
    await Promise.race([closed, delay(2000)]);
  }
}

function socketPath(prefix, room, name, player, token, ownerToken) {
  const query = new URLSearchParams({ name });
  const protocols = ["simple-games-v1", `p.${player}`, `t.${token}`];
  if (ownerToken) protocols.push(`o.${ownerToken}`);
  return { path: `${prefix}/${room}/socket?${query}`, protocols };
}

async function expectRejectedSocket(target) {
  const { path, protocols = [] } = typeof target === "string" ? { path: target } : target;
  const socket = new WebSocket(`${wsBase}${path}`, protocols);
  let opened = false;
  socket.addEventListener("open", () => {
    opened = true;
    socket.close();
  });
  await Promise.race([
    new Promise((resolve) => socket.addEventListener("close", resolve, { once: true })),
    new Promise((resolve) => socket.addEventListener("error", resolve, { once: true })),
    delay(4000),
  ]);
  assert.equal(opened, false, "an invalid reconnect token must not open a socket");
}

async function list(path) {
  return (await requestJson(path)).rooms;
}

async function verifyHttpBoundaries() {
  const page = await fetch(baseUrl);
  assert.equal(page.ok, true);
  assert.match(page.headers.get("content-security-policy") || "", /default-src 'self'/);
  assert.equal(page.headers.get("x-content-type-options"), "nosniff");
  assert.equal(page.headers.get("x-frame-options"), "DENY");

  const rejected = await fetch(`${baseUrl}/api/rooms/create`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://attacker.invalid",
    },
    body: JSON.stringify({ mode: "duel" }),
  });
  assert.equal(rejected.status, 403, "cross-origin room creation must be rejected");
  assert.equal(rejected.headers.get("cache-control"), "no-store");

  const oversizedBody = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(`{"padding":"${"x".repeat(5000)}"}`));
      controller.close();
    },
  });
  const oversized = await fetch(`${baseUrl}/api/rooms/create`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: oversizedBody,
    duplex: "half",
  });
  assert.equal(oversized.status, 413, "chunked request bodies must be rejected as soon as they exceed 4 KB");
}

async function runFourSides() {
  process.stdout.write("Four Sides: ownership, discovery, auth, gameplay, lives, rematch, reconnect… ");
  const room = await requestJson("/api/rooms/create", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "duel", isPublic: true, bots: true }),
  });
  assert.match(room.code, /^[A-Z0-9]{6}$/);
  assert.match(room.ownerToken, /^[a-zA-Z0-9-]{16,80}$/);
  assert.ok(!(await list("/api/rooms")).some((entry) => entry.code === room.code), "unclaimed rooms must not be public");

  const guestCredentials = { player: crypto.randomUUID(), token: crypto.randomUUID() };
  const hostCredentials = { player: room.ownerPlayerId, token: room.ownerAuthToken };
  let guest = await new Probe(socketPath(
    "/api/rooms",
    room.code,
    "Guest",
    guestCredentials.player,
    guestCredentials.token,
  )).ready();
  const guestWelcome = await guest.type("welcome");
  const ownerlessLobby = await guest.type("lobby");
  assert.equal(ownerlessLobby.hostId, null);
  assert.ok(!(await list("/api/rooms")).some((entry) => entry.code === room.code), "a guest cannot publish an ownerless room");

  const host = await new Probe(socketPath(
    "/api/rooms",
    room.code,
    "Host",
    hostCredentials.player,
    hostCredentials.token,
    room.ownerToken,
  )).ready();
  const hostWelcome = await host.type("welcome");
  assert.notEqual(hostWelcome.side, guestWelcome.side);
  const claimedLobby = await host.waitFor((message) => message.type === "lobby" && message.hostId === hostCredentials.player);
  assert.equal(claimedLobby.hostId, hostCredentials.player);

  const publicRoom = await poll(async () => (await list("/api/rooms")).find((entry) => entry.code === room.code));
  assert.equal(publicRoom.game, "four-sides");
  assert.equal("ownerToken" in publicRoom, false);
  assert.ok(!(await list("/api/signal/rooms")).some((entry) => entry.code === room.code), "game directories must be isolated");

  await expectRejectedSocket(socketPath(
    "/api/rooms",
    room.code,
    "Impostor",
    guestCredentials.player,
    crypto.randomUUID(),
  ));

  host.send({ type: "start" });
  await assert.rejects(host.type("game-start", 350), /timed out/, "an unready guest must block start");
  guest.send({ type: "ready", ready: true });
  await host.waitFor((message) =>
    message.type === "lobby"
    && message.players.some((player) => player.id === guestCredentials.player && player.ready)
  );
  host.send({ type: "start" });
  await Promise.all([host.type("game-start"), guest.type("game-start")]);

  host.send({ type: "input", direction: 1 });
  guest.send({ type: "input", direction: 1 });
  const moving = await host.waitFor((message) => {
    if (message.type !== "snapshot" || message.countdown > 0) return false;
    const ownPaddle = message.paddles.find((entry) => entry.side === hostWelcome.side);
    return ownPaddle?.pos > 0.52;
  }, 6500);
  assert.ok(moving.balls.every((ball) => ball.x >= 0 && ball.x <= 1 && ball.y >= 0 && ball.y <= 1));

  const result = await host.waitFor((message) => {
    if (message.type !== "snapshot") return false;
    const ball = message.balls[0];
    if (ball && !message.roundOver && message.countdown === 0) {
      const hostPaddle = message.paddles.find((entry) => entry.side === hostWelcome.side);
      const guestPaddle = message.paddles.find((entry) => entry.side === guestWelcome.side);
      host.send({ type: "input", direction: ball.y < hostPaddle.pos ? 1 : -1 });
      guest.send({ type: "input", direction: ball.y < guestPaddle.pos ? 1 : -1 });
    }
    return message.roundOver;
  }, 90000);
  assert.ok(result.paddles.some((entry) => entry.lives === 0));
  assert.ok(result.winner);
  host.send({ type: "rematch", vote: true });
  await guest.close();
  await host.waitFor((message) => message.type === "notice" && message.text.includes("bot took over"), 3000);
  await host.type("game-start", 5000);
  let reconnectedGuest = await new Probe(socketPath(
    "/api/rooms",
    room.code,
    "Guest",
    guestCredentials.player,
    guestCredentials.token,
  )).ready();
  await reconnectedGuest.type("game-start");
  await host.close(4001, "Simulated host network failure");
  await reconnectedGuest.waitFor((message) =>
    message.type === "notice" && message.text.includes("Game Master reconnecting")
  , 3000);
  await reconnectedGuest.close();
  reconnectedGuest = await new Probe(socketPath(
    "/api/rooms",
    room.code,
    "Guest",
    guestCredentials.player,
    guestCredentials.token,
  )).ready();
  await reconnectedGuest.type("game-start");
  const closed = await reconnectedGuest.type("room-closed", 22000);
  assert.match(closed.reason, /Game Master/);
  await expectRejectedSocket(socketPath(
    "/api/rooms",
    room.code,
    "Late joiner",
    crypto.randomUUID(),
    crypto.randomUUID(),
  ));
  await reconnectedGuest.close();
  await poll(async () => !(await list("/api/rooms")).some((entry) => entry.code === room.code));

  const resilienceRoom = await requestJson("/api/rooms/create", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "duel", isPublic: false, bots: false }),
  });
  const replacementGuest = await new Probe(socketPath(
    "/api/rooms",
    resilienceRoom.code,
    "Replacement test",
    crypto.randomUUID(),
    crypto.randomUUID(),
  )).ready();
  await replacementGuest.type("welcome");
  await replacementGuest.type("lobby");
  const resilienceHost = await new Probe(socketPath(
    "/api/rooms",
    resilienceRoom.code,
    "Race host",
    resilienceRoom.ownerPlayerId,
    resilienceRoom.ownerAuthToken,
    resilienceRoom.ownerToken,
  )).ready();
  await resilienceHost.type("welcome");
  await resilienceHost.waitFor((message) => message.type === "lobby" && message.hostId === resilienceRoom.ownerPlayerId);
  await replacementGuest.close();
  await resilienceHost.waitFor((message) =>
    message.type === "lobby" && message.players.some((player) => player.bot)
  );
  await delay(3000);
  resilienceHost.send({ type: "start" });
  await resilienceHost.close();
  await delay(250);
  await expectRejectedSocket(socketPath(
    "/api/rooms",
    resilienceRoom.code,
    "Race late join",
    crypto.randomUUID(),
    crypto.randomUUID(),
  ));
  process.stdout.write("ok\n");
}

async function runSignalCrew() {
  process.stdout.write("Signal Crew: ownership, auth, commands, results, rematch, replacement… ");
  const room = await requestJson("/api/signal/rooms/create", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ isPublic: true, bots: true }),
  });
  const guestCredentials = { player: crypto.randomUUID(), token: crypto.randomUUID() };
  const hostCredentials = { player: room.ownerPlayerId, token: room.ownerAuthToken };
  let guest = await new Probe(socketPath(
    "/api/signal/rooms",
    room.code,
    "Crewmate",
    guestCredentials.player,
    guestCredentials.token,
  )).ready();
  const guestWelcome = await guest.type("welcome");
  await guest.type("lobby");
  assert.ok(!(await list("/api/signal/rooms")).some((entry) => entry.code === room.code));

  const host = await new Probe(socketPath(
    "/api/signal/rooms",
    room.code,
    "Captain",
    hostCredentials.player,
    hostCredentials.token,
    room.ownerToken,
  )).ready();
  const hostWelcome = await host.type("welcome");
  assert.notEqual(hostWelcome.station, guestWelcome.station);
  await host.waitFor((message) => message.type === "lobby" && message.hostId === hostCredentials.player);
  const publicRoom = await poll(async () => (await list("/api/signal/rooms")).find((entry) => entry.code === room.code));
  assert.equal(publicRoom.game, "signal-crew");
  assert.equal("ownerToken" in publicRoom, false);
  assert.ok(!(await list("/api/rooms")).some((entry) => entry.code === room.code));

  await expectRejectedSocket(socketPath(
    "/api/signal/rooms",
    room.code,
    "Impostor",
    guestCredentials.player,
    crypto.randomUUID(),
  ));

  guest.send({ type: "ready", ready: true });
  await host.waitFor((message) =>
    message.type === "lobby"
    && message.players.some((player) => player.id === guestCredentials.player && player.ready)
  );
  host.send({ type: "start" });
  await Promise.all([host.type("mission-start"), guest.type("mission-start")]);

  const handled = new Set();
  let automationScenarios = 0;
  let finalSnapshot = null;
  const deadline = Date.now() + 80000;
  while (Date.now() < deadline) {
    const snapshot = await host.type("signal-snapshot", 5000);
    assert.ok(snapshot.stability >= 0 && snapshot.stability <= 5);
    assert.ok(snapshot.score >= 0 && snapshot.score <= snapshot.targetScore + 500);
    if (snapshot.command && !handled.has(snapshot.command.id)) {
      handled.add(snapshot.command.id);
      if (snapshot.command.station === hostWelcome.station) {
        host.send({ type: "action", action: snapshot.command.action });
      } else if (snapshot.command.station === guestWelcome.station) {
        if (automationScenarios === 0) {
          const commandId = snapshot.command.id;
          const expiresAt = snapshot.command.expiresAt;
          await guest.close();
          await host.waitFor((message) => message.type === "notice" && message.text.includes("automated"), 3000);
          await host.waitFor((message) =>
            message.type === "signal-snapshot"
            && (!message.command || message.command.id !== commandId)
          , 5000);
          assert.ok(Date.now() < expiresAt + 250, "automation should handle an abandoned command before its deadline");
          guest = await new Probe(socketPath(
            "/api/signal/rooms",
            room.code,
            "Crewmate",
            guestCredentials.player,
            guestCredentials.token,
          )).ready();
          await guest.type("welcome");
          await guest.type("mission-start");
          automationScenarios = 1;
        } else if (automationScenarios === 1) {
          const action = snapshot.command.action;
          await guest.close();
          await host.waitFor((message) => message.type === "notice" && message.text.includes("automated"), 3000);
          guest = await new Probe(socketPath(
            "/api/signal/rooms",
            room.code,
            "Crewmate",
            guestCredentials.player,
            guestCredentials.token,
          )).ready();
          await guest.type("welcome");
          await guest.type("mission-start");
          guest.send({ type: "action", action });
          automationScenarios = 2;
        } else {
          guest.send({ type: "action", action: snapshot.command.action });
        }
      }
    }
    if (snapshot.over) {
      finalSnapshot = snapshot;
      break;
    }
  }
  assert.ok(finalSnapshot?.over, "mission should reach a bounded win/loss result");
  assert.ok(finalSnapshot.score > 0, "coordinated play should score");
  assert.equal(automationScenarios, 2, "disconnect and reconnect automation scenarios should both run");
  host.send({ type: "rematch", vote: true });
  guest.send({ type: "rematch", vote: true });
  await Promise.all([host.type("mission-start", 5000), guest.type("mission-start", 5000)]);

  await guest.close();
  await host.waitFor((message) => message.type === "notice" && message.text.includes("automated"), 3000);
  let reconnectedGuest = await new Probe(socketPath(
    "/api/signal/rooms",
    room.code,
    "Crewmate",
    guestCredentials.player,
    guestCredentials.token,
  )).ready();
  await reconnectedGuest.type("mission-start");

  let hostCommand = null;
  const hostCommandDeadline = Date.now() + 16000;
  const closingHandled = new Set();
  while (!hostCommand && Date.now() < hostCommandDeadline) {
    const snapshot = await host.type("signal-snapshot", 5000);
    if (!snapshot.command || closingHandled.has(snapshot.command.id)) continue;
    closingHandled.add(snapshot.command.id);
    if (snapshot.command.station === hostWelcome.station) {
      if (snapshot.command.expiresAt - Date.now() > 900) {
        hostCommand = snapshot.command;
      } else {
        host.send({ type: "action", action: snapshot.command.action });
      }
    } else if (snapshot.command.station === guestWelcome.station) {
      reconnectedGuest.send({ type: "action", action: snapshot.command.action });
    }
  }
  assert.ok(hostCommand, "the station shuffle bag should assign a command to the host");
  reconnectedGuest.messages.length = 0;
  await host.close(4001, "Simulated host network failure");
  await reconnectedGuest.waitFor((message) =>
    message.type === "notice" && message.text.includes("Game Master reconnecting")
  , 3000);
  const automatedHostCommand = await reconnectedGuest.waitFor((message) =>
    message.type === "signal-snapshot"
      && (!message.command || message.command.id !== hostCommand.id)
  , 5000);
  assert.ok(Date.now() < hostCommand.expiresAt + 300, "host automation should resolve its in-flight command promptly");
  assert.notEqual(automatedHostCommand.message, "Signal missed", "host automation must be scheduled before the command expires");

  await reconnectedGuest.close();
  reconnectedGuest = await new Probe(socketPath(
    "/api/signal/rooms",
    room.code,
    "Crewmate",
    guestCredentials.player,
    guestCredentials.token,
  )).ready();
  await reconnectedGuest.type("mission-start");
  await reconnectedGuest.type("room-closed", 22000);
  await expectRejectedSocket(socketPath(
    "/api/signal/rooms",
    room.code,
    "Late joiner",
    crypto.randomUUID(),
    crypto.randomUUID(),
  ));
  await reconnectedGuest.close();
  await poll(async () => !(await list("/api/signal/rooms")).some((entry) => entry.code === room.code));

  const raceRoom = await requestJson("/api/signal/rooms/create", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ isPublic: false, bots: true }),
  });
  const raceHost = await new Probe(socketPath(
    "/api/signal/rooms",
    raceRoom.code,
    "Race captain",
    raceRoom.ownerPlayerId,
    raceRoom.ownerAuthToken,
    raceRoom.ownerToken,
  )).ready();
  await raceHost.type("welcome");
  await raceHost.waitFor((message) => message.type === "lobby" && message.hostId === raceRoom.ownerPlayerId);
  raceHost.send({ type: "start" });
  await raceHost.close();
  await delay(250);
  await expectRejectedSocket(socketPath(
    "/api/signal/rooms",
    raceRoom.code,
    "Race late join",
    crypto.randomUUID(),
    crypto.randomUUID(),
  ));
  process.stdout.write("ok\n");
}

try {
  await poll(async () => {
    try {
      const response = await fetch(baseUrl);
      return response.ok;
    } catch {
      return false;
    }
  }, { timeout: 15000, interval: 200 });
  await verifyHttpBoundaries();
  if (selectedGame === "all" || selectedGame === "four") await runFourSides();
  if (selectedGame === "all" || selectedGame === "signal") await runSignalCrew();
  process.stdout.write("Multiplayer integration smoke passed.\n");
} finally {
  await Promise.allSettled([...sockets].map((probe) => probe.close()));
}
