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
      <div class="eyebrow"><span></span> No installs. Just play.</div>
      <h1>Tiny games.<br><em>Big nights.</em></h1>
      <p>Quick browser games made for the same couch. Grab a few friends, pick your keys, and try not to blame each other.</p>
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
          <div class="eyebrow"><span></span> Pick your challenge</div>
          <h2>Games on deck</h2>
        </div>
        <p>Built for quick rounds, questionable teamwork, and immediate rematches.</p>
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
            <div class="tags"><span>Co-op</span><span>2–4 players</span></div>
            <h3>Four Sides</h3>
            <p>One arena. Four paddles. Keep every ball in play or go down together.</p>
            <button class="play-button" type="button" data-play>
              Play now <span>↗</span>
            </button>
          </div>
        </article>

        <article class="game-card coming">
          <div class="card-art rhythm-art"><span>♪</span><span>●</span><span>♪</span></div>
          <div class="card-body">
            <div class="tags"><span>Versus</span><span>2 players</span></div>
            <h3>Beat Split</h3>
            <p>Share the keyboard. Steal the rhythm. Miss the beat and lose your streak.</p>
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
      <span class="manifesto-kicker">The house rules</span>
      <p>No accounts. No downloads. No 40-minute tutorials.</p>
      <p class="muted">Just small games that get everyone playing.</p>
    </section>
  </main>

  <footer>
    <a class="brand footer-brand" href="#"><span class="brand-mark"><i></i><i></i><i></i><i></i></span><span>SIMPLE<br>GAMES</span></a>
    <p>Made for game night · 2026</p>
  </footer>

  <dialog class="game-dialog" aria-label="Four Sides game">
    <div class="game-shell">
      <header class="game-header">
        <div>
          <span class="game-kicker">Local co-op</span>
          <h2>Four Sides</h2>
        </div>
        <div class="game-stats">
          <span>Score <b data-score>0000</b></span>
          <span>Team lives <b data-lives>8</b></span>
        </div>
        <button class="close-game" type="button" aria-label="Close game">×</button>
      </header>
      <div class="canvas-wrap">
        <canvas id="arena" width="900" height="620"></canvas>
        <div class="game-overlay" data-overlay>
          <span class="overlay-kicker">All sides, one team</span>
          <h3>Keep the core alive.</h3>
          <p>Every missed ball costs a shared life. Survive long enough and more balls join the arena.</p>
          <div class="controls-grid">
            <span><i class="dot coral"></i> Left <b>W / S</b></span>
            <span><i class="dot blue"></i> Top <b>A / D</b></span>
            <span><i class="dot yellow"></i> Right <b>↑ / ↓</b></span>
            <span><i class="dot mint"></i> Bottom <b>J / L</b></span>
          </div>
          <button class="start-game primary-button" type="button">Start round <span>→</span></button>
        </div>
      </div>
      <p class="game-hint">P pauses · Defend the glowing gates · Shared keyboard recommended</p>
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
const game = new ArenaGame({
  canvas: document.querySelector("#arena"),
  scoreNode: document.querySelector("[data-score]"),
  livesNode: document.querySelector("[data-lives]"),
  overlay: document.querySelector("[data-overlay]"),
  isSoundOn: () => soundOn,
});

document.querySelector("[data-play]").addEventListener("click", () => {
  dialog.showModal();
  game.resize();
});

document.querySelector(".close-game").addEventListener("click", () => {
  game.stop();
  dialog.close();
});

document.querySelector(".start-game").addEventListener("click", () => game.start());
dialog.addEventListener("cancel", () => game.stop());
window.addEventListener("resize", () => game.resize());

