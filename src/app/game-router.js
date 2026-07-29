import { getGameById, getGameForLocation } from "./game-catalog.js";

const HOME_URL = "/#games";

export class GameRouter {
  constructor({
    catalog,
    context,
    document = globalThis.document,
    window = globalThis.window,
    statusNode = null,
  }) {
    this.catalog = catalog;
    this.context = context;
    this.document = document;
    this.window = window;
    this.statusNode = statusNode;
    this.controllers = new Map();
    this.activeGame = null;
    this.navigationId = 0;
    this.started = false;

    this.handleClick = this.handleClick.bind(this);
    this.handlePopState = this.handlePopState.bind(this);
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.document.addEventListener("click", this.handleClick);
    this.window.addEventListener("popstate", this.handlePopState);

    const initialGame = getGameForLocation(this.window.location);
    if (initialGame) {
      void this.open(initialGame, { historyMode: "preserve" });
    }
  }

  async open(gameOrId, { historyMode = "push" } = {}) {
    const manifest = typeof gameOrId === "string" ? getGameById(gameOrId) : gameOrId;
    if (!manifest) return;

    if (this.activeGame?.id !== manifest.id) {
      this.closeActive({ navigate: false });
    }
    const navigationId = ++this.navigationId;

    if (historyMode !== "preserve") {
      this.window.history[historyMode === "replace" ? "replaceState" : "pushState"](
        { simpleGames: manifest.id },
        "",
        manifest.route,
      );
    }

    this.setLoading(manifest, true);
    try {
      let controller = this.controllers.get(manifest.id);
      if (!controller) {
        const gameModule = await manifest.load();
        if (navigationId !== this.navigationId) return;
        if (typeof gameModule.createGame !== "function") {
          throw new TypeError(`Game module "${manifest.id}" does not export createGame().`);
        }
        controller = gameModule.createGame({
          ...this.context,
          document: this.document,
          manifest,
          onRequestClose: () => this.handleGameClosed(manifest),
        });
        if (!controller
          || typeof controller.open !== "function"
          || typeof controller.close !== "function") {
          throw new TypeError(`Game module "${manifest.id}" returned an invalid controller.`);
        }
        this.controllers.set(manifest.id, controller);
      }

      if (navigationId !== this.navigationId) return;
      this.activeGame = manifest;
      await controller.open();
      this.announce("");
    } catch (error) {
      if (navigationId !== this.navigationId) return;
      console.error(`Could not open ${manifest.title}.`, error);
      this.activeGame = null;
      this.window.history.replaceState({}, "", HOME_URL);
      this.announce(`${manifest.title} could not be opened. Please try again.`);
    } finally {
      this.setLoading(manifest, false);
    }
  }

  closeActive({ navigate = true } = {}) {
    this.navigationId += 1;
    const manifest = this.activeGame;
    this.activeGame = null;
    if (manifest) {
      this.controllers.get(manifest.id)?.close({ navigate: false });
    }
    if (navigate && getGameForLocation(this.window.location)) {
      this.window.history.replaceState({}, "", HOME_URL);
    }
  }

  handleGameClosed(manifest) {
    if (this.activeGame?.id !== manifest.id) return;
    this.activeGame = null;
    this.navigationId += 1;
    if (getGameForLocation(this.window.location)) {
      this.window.history.replaceState({}, "", HOME_URL);
    }
  }

  handleClick(event) {
    const launchButton = event.target.closest?.("[data-game-id]");
    if (launchButton) {
      const manifest = getGameById(launchButton.dataset.gameId);
      if (!manifest) return;
      event.preventDefault();
      void this.open(manifest);
      return;
    }

    const homeLink = event.target.closest?.("[data-app-home]");
    if (homeLink) {
      event.preventDefault();
      this.closeActive({ navigate: false });
      const destination = homeLink.getAttribute("href") || "/";
      this.window.history.pushState({}, "", destination);
      const hash = new URL(destination, this.window.location.origin).hash;
      if (hash) {
        this.document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView();
      } else {
        this.window.scrollTo({ top: 0 });
      }
    }
  }

  handlePopState() {
    const manifest = getGameForLocation(this.window.location);
    if (manifest) {
      void this.open(manifest, { historyMode: "preserve" });
    } else {
      this.closeActive({ navigate: false });
    }
  }

  setLoading(manifest, isLoading) {
    this.document.querySelectorAll(`[data-game-id="${manifest.id}"]`).forEach((button) => {
      button.toggleAttribute("disabled", isLoading);
      button.setAttribute("aria-busy", String(isLoading));
    });
    if (isLoading) this.announce(`Loading ${manifest.title}…`);
  }

  announce(message) {
    if (this.statusNode) this.statusNode.textContent = message;
  }
}
