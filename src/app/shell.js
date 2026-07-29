import { escapeHtml } from "../shared/ui.js";

function renderGameCard(game) {
  const featured = game.featured ? " featured" : "";
  return `
    <article class="game-card${featured}">
      <div class="card-art ${escapeHtml(game.art.className)}" aria-hidden="true">
        ${game.art.markup}
      </div>
      <div class="card-body">
        <div class="tags">
          <span>${escapeHtml(game.category)}</span>
          <span>${escapeHtml(game.players)}</span>
        </div>
        <h3>${escapeHtml(game.title)}</h3>
        <p>${escapeHtml(game.description)}</p>
        <button
          class="play-button"
          type="button"
          data-game-id="${escapeHtml(game.id)}"
          ${game.launchAttribute}
          aria-busy="false"
        >
          Play now <span aria-hidden="true">↗</span>
        </button>
      </div>
    </article>
  `;
}

export function renderAppShell(catalog) {
  return `
    <header class="site-header">
      <a class="brand" href="/" data-app-home aria-label="Simple Games home">
        <span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
        <span>SIMPLE<br>GAMES</span>
      </a>
      <nav aria-label="Main navigation">
        <a href="/#games" data-app-home>All games</a>
        <a href="/#about" data-app-home>About</a>
      </nav>
      <button class="sound-button" type="button" aria-label="Toggle sound" aria-pressed="false">
        <span class="sound-bars" aria-hidden="true"><i></i><i></i><i></i></span>
        <span class="sound-label">Sound on</span>
      </button>
    </header>

    <main>
      <section class="hero">
        <div class="eyebrow"><span></span> Play solo or together</div>
        <h1>Tiny games.<br><em>Big nights.</em></h1>
        <p>Quick browser games for quiet breaks and loud group chats. Play at your own pace or invite friends with a link.</p>
        <a class="primary-button" href="#games">Choose a game <span aria-hidden="true">↓</span></a>
        <div class="hero-orbit orbit-a"></div>
        <div class="hero-orbit orbit-b"></div>
        <span class="spark spark-one" aria-hidden="true">✦</span>
        <span class="spark spark-two" aria-hidden="true">✦</span>
        <span class="ball-decoration" aria-hidden="true"></span>
      </section>

      <section class="games-section" id="games">
        <div class="section-heading">
          <div>
            <div class="eyebrow"><span></span> Your game, your company</div>
            <h2>Games on deck</h2>
          </div>
          <p>Every game works either as a focused solo challenge or as something worth sharing with friends.</p>
        </div>
        <div class="game-grid">${catalog.map(renderGameCard).join("")}</div>
        <p class="game-load-status" data-game-load-status role="status" aria-live="polite"></p>
      </section>

      <section class="manifesto" id="about">
        <span class="manifesto-kicker">The simple promise</span>
        <p>No downloads. No 40-minute tutorials.</p>
        <p class="muted">Play alone, invite a friend, or bring the whole crew.</p>
      </section>
    </main>

    <footer>
      <a class="brand footer-brand" href="/" data-app-home>
        <span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
        <span>SIMPLE<br>GAMES</span>
      </a>
      <p>Made for one player or many · 2026</p>
    </footer>
  `;
}
