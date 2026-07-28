/**
 * Calculate rematch votes from the live roster.
 *
 * The Game Master is a room-lifecycle dependency, not merely another voter:
 * guests may keep playing through ordinary disconnects, but they must never
 * launch a fresh round while the owner is inside the reconnect grace period.
 */
export function rematchQuorum(players, hostId) {
  const roster = players instanceof Map ? [...players.values()] : [...(players || [])];
  const connected = roster.filter((player) => player?.connected);
  const hostConnected = Boolean(
    hostId && connected.some((player) => player.id === hostId),
  );
  const waitingForHost = Boolean(hostId && !hostConnected);
  const voters = connected.filter((player) => player.rematch);
  return {
    connected,
    hostConnected,
    waitingForHost,
    votes: voters.length,
    needed: connected.length + (waitingForHost ? 1 : 0),
    voterNames: voters.map((player) => player.name),
    unanimous: hostConnected
      && connected.length > 0
      && connected.every((player) => player.rematch),
  };
}
