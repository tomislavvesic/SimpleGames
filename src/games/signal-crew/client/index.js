import "./styles.css";
import { SignalGame } from "./game.js";

export function createGame({
  document,
  manifest,
  profileStore,
  profileUI,
  isSoundOn,
  onRequestClose,
}) {
  const dialog = document.createElement("dialog");
  dialog.className = "signal-dialog";
  dialog.setAttribute("aria-label", "Signal Crew game");
  document.body.append(dialog);

  let suppressNavigation = false;
  const game = new SignalGame({
    dialog,
    getPlayerName: () => profileStore.nickname,
    savePlayerName: (name) => profileStore.setIdentity({ nickname: name }),
    isSoundOn,
    onResult: ({ won, score }) => {
      profileUI.recordGame(manifest.profileId, {
        outcome: won ? "win" : "loss",
        score,
      });
    },
  });

  profileUI.bindNicknameInput(dialog.querySelector("[data-signal-name]"));
  profileUI.bindNicknameInput(dialog.querySelector("[data-signal-invite-name]"));

  const nativeClose = game.close.bind(game);
  game.close = (...args) => {
    nativeClose(...args);
    if (!suppressNavigation) onRequestClose();
  };

  const nativeCopyText = game.copyText.bind(game);
  game.copyText = () => {
    const code = game.room
      || new URLSearchParams(location.search).get(manifest.legacyQuery);
    const inviteUrl = new URL(manifest.route, location.origin);
    if (code) inviteUrl.searchParams.set(manifest.legacyQuery, code);
    return nativeCopyText(inviteUrl.href);
  };

  return {
    open() {
      game.open();
    },
    close() {
      suppressNavigation = true;
      try {
        game.close();
      } finally {
        suppressNavigation = false;
      }
    },
  };
}
