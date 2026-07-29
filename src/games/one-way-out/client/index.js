import "./styles.css";
import { OneWayOutGame } from "./game.js";

export function createGame({
  document,
  manifest,
  profileUI,
  isSoundOn,
  onRequestClose,
}) {
  const dialog = document.createElement("dialog");
  dialog.className = "maze-dialog";
  dialog.setAttribute("aria-label", "One Way Out game");
  const root = document.createElement("div");
  root.dataset.mazeRoot = "";
  dialog.append(root);
  document.body.append(dialog);

  let suppressNavigation = false;
  const game = new OneWayOutGame({
    root,
    isSoundOn,
    onResult: (result) => {
      profileUI.recordGame(manifest.profileId, {
        outcome: result.outcome,
        score: result.score,
        durationMs: result.durationMs,
      });
    },
    onClose: () => {
      if (dialog.open) dialog.close();
      if (!suppressNavigation) onRequestClose();
    },
  });

  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    game.close();
  });

  return {
    open() {
      if (!dialog.open) dialog.showModal();
      game.start({ reset: !game.maze });
    },
    close() {
      suppressNavigation = true;
      try {
        game.close();
        if (dialog.open) dialog.close();
      } finally {
        suppressNavigation = false;
      }
    },
  };
}
