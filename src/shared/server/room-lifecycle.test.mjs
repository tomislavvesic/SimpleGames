import test from "node:test";
import assert from "node:assert/strict";
import { rematchQuorum } from "./room-lifecycle.js";

const player = (id, { connected = true, rematch = false } = {}) => ({
  id,
  name: id,
  connected,
  rematch,
});

test("unanimous connected players can rematch while the host is present", () => {
  const quorum = rematchQuorum(new Map([
    ["host", player("host", { rematch: true })],
    ["guest", player("guest", { rematch: true })],
  ]), "host");
  assert.equal(quorum.unanimous, true);
  assert.equal(quorum.votes, 2);
  assert.equal(quorum.needed, 2);
  assert.equal(quorum.waitingForHost, false);
});

test("guests cannot launch a rematch while the host is reconnecting", () => {
  const quorum = rematchQuorum([
    player("host", { connected: false, rematch: true }),
    player("guest", { rematch: true }),
  ], "host");
  assert.equal(quorum.unanimous, false);
  assert.equal(quorum.hostConnected, false);
  assert.equal(quorum.waitingForHost, true);
  assert.equal(quorum.votes, 1);
  assert.equal(quorum.needed, 2);
});

test("a departing non-host immediately changes the connected vote quorum", () => {
  const quorum = rematchQuorum([
    player("host", { rematch: true }),
    player("departed", { connected: false }),
  ], "host");
  assert.equal(quorum.unanimous, true);
  assert.equal(quorum.votes, 1);
  assert.equal(quorum.needed, 1);
});

test("an ownerless roster can never start a match", () => {
  const quorum = rematchQuorum([player("guest", { rematch: true })], null);
  assert.equal(quorum.unanimous, false);
  assert.equal(quorum.waitingForHost, false);
});
