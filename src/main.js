import "./app/styles.css";
import "./shared/profile/styles.css";
import { GAME_CATALOG } from "./app/game-catalog.js";
import { GameRouter } from "./app/game-router.js";
import { renderAppShell } from "./app/shell.js";
import { ProfileController, ProfileStore } from "./shared/profile/profile.js";

const app = document.querySelector("#app");
app.innerHTML = renderAppShell(GAME_CATALOG);

let soundOn = true;
const soundButton = document.querySelector(".sound-button");
soundButton.addEventListener("click", () => {
  soundOn = !soundOn;
  soundButton.classList.toggle("muted", !soundOn);
  soundButton.setAttribute("aria-pressed", String(!soundOn));
  document.querySelector(".sound-label").textContent = soundOn ? "Sound on" : "Sound off";
});

const profileStore = new ProfileStore();
const profileUI = new ProfileController({
  store: profileStore,
  gameLabels: Object.fromEntries(GAME_CATALOG.map((game) => [game.profileId, game.title])),
}).mount(document.querySelector(".site-header"));

const router = new GameRouter({
  catalog: GAME_CATALOG,
  context: {
    profileStore,
    profileUI,
    isSoundOn: () => soundOn,
  },
  statusNode: document.querySelector("[data-game-load-status]"),
});

router.start();
