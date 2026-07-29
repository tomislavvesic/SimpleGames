export function createFourSidesDialog(document) {
  const dialog = document.createElement("dialog");
  dialog.className = "game-dialog";
  dialog.setAttribute("aria-label", "Four Sides game");
  dialog.innerHTML = `
    <div class="game-shell">
      <header class="game-header">
        <div>
          <span class="game-kicker">Online multiplayer</span>
          <h2>Four Sides</h2>
        </div>
        <div class="game-stats">
          <span class="room-status">Status <b data-status role="status" aria-live="polite">Choose a room</b></span>
          <div class="player-scores" data-score></div>
        </div>
        <button class="close-game" type="button" aria-label="Close game">×</button>
      </header>
      <div class="canvas-wrap">
        <canvas id="arena" width="900" height="620" role="img" aria-label="Four Sides arena">
          Your browser does not support the Four Sides game canvas.
        </canvas>
        <div class="game-overlay" data-overlay>
          <div class="invite-join hidden" data-invite-join>
            <span class="overlay-kicker">You have been invited</span>
            <h3>Join Four Sides.</h3>
            <p>Choose a name. Your side will be assigned automatically.</p>
            <label class="name-field">
              <span>Your name</span>
              <input type="text" maxlength="18" placeholder="Player name" data-invite-name autocomplete="nickname" />
            </label>
            <button class="primary-button invite-ready-button" type="button" data-invite-ready>
              I am ready <span>→</span>
            </button>
            <small class="invite-room-code" data-invite-code></small>
          </div>

          <div class="multiplayer-home" data-multiplayer-home>
            <span class="overlay-kicker">One side. One player.</span>
            <h3>Enter the arena.</h3>
            <p>Create a room for friends, jump into a public match, or fill empty sides with bots.</p>
            <label class="name-field">
              <span>Your name</span>
              <input type="text" maxlength="18" placeholder="Player name" data-player-name autocomplete="nickname" />
            </label>
            <div class="mode-picker" data-mode-picker>
              <button class="mode-option selected" type="button" data-mode="duel" aria-pressed="true"><b>1 vs 1</b><span>Left &amp; right</span></button>
              <button class="mode-option" type="button" data-mode="teams" aria-pressed="false"><b>2 vs 2</b><span>Team battle</span></button>
              <button class="mode-option" type="button" data-mode="ffa" aria-pressed="false"><b>4-way</b><span>Every side for itself</span></button>
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
              <div class="public-title">
                <span>Public lobbies</span>
                <button type="button" data-refresh-rooms>Refresh</button>
              </div>
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
        <div class="touch-controls" aria-label="Touch controls" aria-hidden="true">
          <button type="button" data-move="-1" aria-label="Move backward">←</button>
          <button type="button" data-move="1" aria-label="Move forward">→</button>
        </div>
        <div class="four-result hidden" data-four-result role="status" aria-live="polite">
          <span class="overlay-kicker">Round complete</span>
          <h3 data-four-result-title>Winner</h3>
          <p data-four-result-copy></p>
          <button class="primary-button" type="button" data-four-rematch>Vote rematch <span>↻</span></button>
          <small data-four-rematch-status></small>
        </div>
      </div>
      <p class="game-hint">Move with arrows or WASD · Defend your goal · Every miss costs one of your five lives</p>
    </div>
  `;
  document.body.append(dialog);
  return dialog;
}
