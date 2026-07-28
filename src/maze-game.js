const NORTH = 1;
const EAST = 2;
const SOUTH = 4;
const WEST = 8;

export const MAZE_DIRECTIONS = Object.freeze({
  up: Object.freeze({ name: "up", bit: NORTH, opposite: SOUTH, dx: 0, dy: -1 }),
  right: Object.freeze({ name: "right", bit: EAST, opposite: WEST, dx: 1, dy: 0 }),
  down: Object.freeze({ name: "down", bit: SOUTH, opposite: NORTH, dx: 0, dy: 1 }),
  left: Object.freeze({ name: "left", bit: WEST, opposite: EAST, dx: -1, dy: 0 }),
});

const DIRECTION_LIST = Object.freeze([
  MAZE_DIRECTIONS.up,
  MAZE_DIRECTIONS.right,
  MAZE_DIRECTIONS.down,
  MAZE_DIRECTIONS.left,
]);

const KEY_DIRECTIONS = Object.freeze({
  ArrowUp: MAZE_DIRECTIONS.up,
  KeyW: MAZE_DIRECTIONS.up,
  ArrowRight: MAZE_DIRECTIONS.right,
  KeyD: MAZE_DIRECTIONS.right,
  ArrowDown: MAZE_DIRECTIONS.down,
  KeyS: MAZE_DIRECTIONS.down,
  ArrowLeft: MAZE_DIRECTIONS.left,
  KeyA: MAZE_DIRECTIONS.left,
});

const COLORS = Object.freeze({
  background: "#0f151a",
  backgroundDeep: "#090d12",
  wall: "#9eb8ae",
  wallGlow: "rgba(102, 214, 174, .14)",
  player: "#ffd45c",
  playerCore: "#fff8d6",
  exit: "#ff725e",
  spark: "#69a7ff",
  grid: "rgba(233, 233, 223, .045)",
});

const DEFAULT_STORAGE_KEY = "simple-games-one-way-out-best-v1";
const MAX_DIMENSION = 51;
const MIN_DIMENSION = 2;

function hashSeed(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value >>> 0;
  const text = String(value ?? "");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Returns a deterministic pseudo-random number generator.
 * The returned function produces values in the [0, 1) interval.
 */
export function createSeededRandom(seed) {
  let state = hashSeed(seed) || 0x6d2b79f5;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function assertDimension(value, label) {
  if (!Number.isInteger(value) || value < MIN_DIMENSION || value > MAX_DIMENSION) {
    throw new RangeError(`${label} must be an integer between ${MIN_DIMENSION} and ${MAX_DIMENSION}`);
  }
}

function pointIsInside(point, width, height) {
  return Boolean(
    point
      && Number.isInteger(point.x)
      && Number.isInteger(point.y)
      && point.x >= 0
      && point.y >= 0
      && point.x < width
      && point.y < height,
  );
}

function cellIndex(width, x, y) {
  return y * width + x;
}

/**
 * Builds a fully connected maze with reciprocal openings.
 *
 * Cells are bit masks using NORTH=1, EAST=2, SOUTH=4 and WEST=8. The maze is
 * deterministic for a given seed. `loopChance` adds a small number of optional
 * alternate routes after the spanning maze has been carved.
 */
export function generateMaze(width, height, {
  seed = Math.floor(Math.random() * 0xffffffff),
  loopChance = 0.06,
  start = { x: 0, y: 0 },
  exit = { x: width - 1, y: height - 1 },
} = {}) {
  assertDimension(width, "Maze width");
  assertDimension(height, "Maze height");
  if (!pointIsInside(start, width, height)) throw new RangeError("Maze start is outside the grid");
  if (!pointIsInside(exit, width, height)) throw new RangeError("Maze exit is outside the grid");
  if (start.x === exit.x && start.y === exit.y) throw new RangeError("Maze start and exit must differ");

  const random = createSeededRandom(seed);
  const cells = new Uint8Array(width * height);
  const visited = new Uint8Array(cells.length);
  const stack = [{ x: start.x, y: start.y }];
  visited[cellIndex(width, start.x, start.y)] = 1;

  while (stack.length) {
    const current = stack[stack.length - 1];
    const available = DIRECTION_LIST.filter((direction) => {
      const x = current.x + direction.dx;
      const y = current.y + direction.dy;
      return pointIsInside({ x, y }, width, height) && !visited[cellIndex(width, x, y)];
    });

    if (!available.length) {
      stack.pop();
      continue;
    }

    const direction = available[Math.floor(random() * available.length)];
    const next = { x: current.x + direction.dx, y: current.y + direction.dy };
    const currentIndex = cellIndex(width, current.x, current.y);
    const nextIndex = cellIndex(width, next.x, next.y);
    cells[currentIndex] |= direction.bit;
    cells[nextIndex] |= direction.opposite;
    visited[nextIndex] = 1;
    stack.push(next);
  }

  const chance = Math.max(0, Math.min(Number(loopChance) || 0, 0.45));
  if (chance > 0) {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = cellIndex(width, x, y);
        if (x < width - 1 && !(cells[index] & EAST) && random() < chance) {
          cells[index] |= EAST;
          cells[index + 1] |= WEST;
        }
        if (y < height - 1 && !(cells[index] & SOUTH) && random() < chance) {
          cells[index] |= SOUTH;
          cells[index + width] |= NORTH;
        }
      }
    }
  }

  return {
    width,
    height,
    cells,
    start: { x: start.x, y: start.y },
    exit: { x: exit.x, y: exit.y },
    seed: hashSeed(seed),
  };
}

function mazeShapeIsUsable(maze) {
  return Boolean(
    maze
      && Number.isInteger(maze.width)
      && Number.isInteger(maze.height)
      && maze.width >= MIN_DIMENSION
      && maze.height >= MIN_DIMENSION
      && maze.width <= MAX_DIMENSION
      && maze.height <= MAX_DIMENSION
      && maze.cells
      && typeof maze.cells.length === "number"
      && maze.cells.length === maze.width * maze.height,
  );
}

function neighborFor(maze, point, direction) {
  const x = point.x + direction.dx;
  const y = point.y + direction.dy;
  if (!pointIsInside({ x, y }, maze.width, maze.height)) return null;
  const from = maze.cells[cellIndex(maze.width, point.x, point.y)];
  const to = maze.cells[cellIndex(maze.width, x, y)];
  if (!(from & direction.bit) || !(to & direction.opposite)) return null;
  return { x, y };
}

/**
 * Finds the shortest valid route between two cells. Returns [] when none exists.
 */
export function findShortestPath(maze, start = maze?.start, exit = maze?.exit) {
  if (!mazeShapeIsUsable(maze)) return [];
  if (!pointIsInside(start, maze.width, maze.height) || !pointIsInside(exit, maze.width, maze.height)) return [];

  const startIndex = cellIndex(maze.width, start.x, start.y);
  const exitIndex = cellIndex(maze.width, exit.x, exit.y);
  const previous = new Int32Array(maze.cells.length);
  previous.fill(-1);
  const queue = new Int32Array(maze.cells.length);
  let head = 0;
  let tail = 0;
  queue[tail++] = startIndex;
  previous[startIndex] = startIndex;

  while (head < tail) {
    const currentIndex = queue[head++];
    if (currentIndex === exitIndex) break;
    const point = { x: currentIndex % maze.width, y: Math.floor(currentIndex / maze.width) };
    for (const direction of DIRECTION_LIST) {
      const next = neighborFor(maze, point, direction);
      if (!next) continue;
      const nextIndex = cellIndex(maze.width, next.x, next.y);
      if (previous[nextIndex] !== -1) continue;
      previous[nextIndex] = currentIndex;
      queue[tail++] = nextIndex;
    }
  }

  if (previous[exitIndex] === -1) return [];
  const path = [];
  let cursor = exitIndex;
  while (cursor !== startIndex) {
    path.push({ x: cursor % maze.width, y: Math.floor(cursor / maze.width) });
    cursor = previous[cursor];
  }
  path.push({ x: start.x, y: start.y });
  return path.reverse();
}

export function isMazeSolvable(maze, start = maze?.start, exit = maze?.exit) {
  return findShortestPath(maze, start, exit).length > 0;
}

/**
 * Audits a maze's dimensions, boundaries, reciprocal passages and connectivity.
 */
export function validateMaze(maze) {
  const errors = [];
  if (!mazeShapeIsUsable(maze)) {
    return {
      valid: false,
      solvable: false,
      connected: false,
      reachableCount: 0,
      errors: ["Maze dimensions or cell data are invalid"],
    };
  }
  if (!pointIsInside(maze.start, maze.width, maze.height)) errors.push("Maze start is outside the grid");
  if (!pointIsInside(maze.exit, maze.width, maze.height)) errors.push("Maze exit is outside the grid");

  for (let y = 0; y < maze.height; y += 1) {
    for (let x = 0; x < maze.width; x += 1) {
      const mask = maze.cells[cellIndex(maze.width, x, y)];
      if (!Number.isInteger(mask) || mask < 0 || mask > 15) {
        errors.push(`Cell ${x},${y} has an invalid opening mask`);
        continue;
      }
      for (const direction of DIRECTION_LIST) {
        if (!(mask & direction.bit)) continue;
        const next = { x: x + direction.dx, y: y + direction.dy };
        if (!pointIsInside(next, maze.width, maze.height)) {
          errors.push(`Cell ${x},${y} opens outside the maze`);
          continue;
        }
        const neighborMask = maze.cells[cellIndex(maze.width, next.x, next.y)];
        if (!(neighborMask & direction.opposite)) {
          errors.push(`Opening between ${x},${y} and ${next.x},${next.y} is not reciprocal`);
        }
      }
    }
  }

  let reachableCount = 0;
  if (pointIsInside(maze.start, maze.width, maze.height)) {
    const seen = new Uint8Array(maze.cells.length);
    const queue = [maze.start];
    seen[cellIndex(maze.width, maze.start.x, maze.start.y)] = 1;
    while (queue.length) {
      const point = queue.shift();
      reachableCount += 1;
      for (const direction of DIRECTION_LIST) {
        const next = neighborFor(maze, point, direction);
        if (!next) continue;
        const index = cellIndex(maze.width, next.x, next.y);
        if (seen[index]) continue;
        seen[index] = 1;
        queue.push(next);
      }
    }
  }

  const connected = reachableCount === maze.cells.length;
  if (!connected) errors.push(`Only ${reachableCount} of ${maze.cells.length} cells are reachable`);
  const solvable = isMazeSolvable(maze);
  if (!solvable) errors.push("Maze exit cannot be reached from its start");
  return { valid: errors.length === 0, solvable, connected, reachableCount, errors };
}

export function getMazeDifficulty(level) {
  const safeLevel = Math.max(1, Math.floor(Number(level) || 1));
  const width = Math.min(21, 9 + Math.floor((safeLevel - 1) / 2) * 2);
  const height = Math.min(15, 7 + Math.floor((safeLevel - 1) / 3) * 2);
  return {
    level: safeLevel,
    width,
    height,
    loopChance: Math.max(0.025, 0.1 - safeLevel * 0.0045),
    sparkCount: Math.min(5, 3 + Math.floor((safeLevel - 1) / 4)),
    holdInterval: Math.max(62, 94 - safeLevel),
  };
}

export function calculateLevelScore({
  level,
  remainingTime,
  totalTime,
  sparksCollected,
  moveCount,
  optimalMoves,
  streak,
}) {
  const safeTotal = Math.max(0.001, Number(totalTime) || 0.001);
  const timeRatio = Math.max(0, Math.min(1.25, (Number(remainingTime) || 0) / safeTotal));
  const efficiency = Math.max(0.2, Math.min(1, (Number(optimalMoves) || 1) / Math.max(1, Number(moveCount) || 1)));
  const base = 550 + Math.max(1, Number(level) || 1) * 90;
  const timeBonus = timeRatio * 650;
  const routeBonus = efficiency * 450;
  const sparkBonus = Math.max(0, Number(sparksCollected) || 0) * 160;
  const multiplier = 1 + Math.min(10, Math.max(0, Number(streak) || 0)) * 0.07;
  return Math.max(0, Math.round((base + timeBonus + routeBonus + sparkBonus) * multiplier));
}

function randomRunSeed() {
  if (globalThis.crypto?.getRandomValues) {
    const values = new Uint32Array(1);
    globalThis.crypto.getRandomValues(values);
    return values[0];
  }
  return Math.floor(Math.random() * 0xffffffff);
}

function randomRunId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const entropy = `${Date.now()}:${Math.random()}:${randomRunSeed()}`;
  return `owo-${hashSeed(entropy).toString(36)}-${Date.now().toString(36)}`;
}

function formatNumber(value) {
  try {
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
  } catch {
    return String(Math.round(value));
  }
}

function easeOutCubic(value) {
  return 1 - ((1 - value) ** 3);
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function safeNow() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function gameMarkup() {
  return `
    <section class="owo-shell" data-owo-shell aria-label="One Way Out">
      <header class="owo-header">
        <div class="owo-title">
          <span class="owo-kicker">Solo time trial</span>
          <h2>One Way Out</h2>
        </div>
        <dl class="owo-stats" aria-label="Current run">
          <div><dt>Level</dt><dd data-owo-level>1</dd></div>
          <div><dt>Score</dt><dd data-owo-score>0</dd></div>
          <div><dt>Streak</dt><dd data-owo-streak>×0</dd></div>
          <div><dt>Best</dt><dd data-owo-best>0</dd></div>
        </dl>
        <button class="owo-icon-button owo-close" type="button" data-owo-close aria-label="Close One Way Out">×</button>
      </header>

      <div class="owo-stage">
        <canvas data-owo-canvas tabindex="0" role="application"
          aria-label="Maze. Use arrow keys or W A S D to move toward the coral exit."></canvas>
        <div class="owo-clock" data-owo-clock role="progressbar" aria-label="Time remaining"
          aria-valuemin="0" aria-valuemax="100" aria-valuenow="100">
          <div data-owo-clock-fill></div>
          <span data-owo-time>--</span>
        </div>
        <div class="owo-overlay" data-owo-overlay>
          <div class="owo-overlay-card">
            <span class="owo-overlay-kicker" data-owo-overlay-kicker>Find the coral portal</span>
            <h3 data-owo-overlay-title>Ready to run?</h3>
            <p data-owo-overlay-copy>Every maze is new. Blue sparks buy time; clean routes build bigger scores.</p>
            <div class="owo-overlay-actions">
              <button class="owo-primary-button" type="button" data-owo-overlay-primary>Enter maze <span>→</span></button>
              <button class="owo-secondary-button" type="button" data-owo-overlay-secondary hidden>New run</button>
            </div>
          </div>
        </div>
        <div class="owo-live-region" data-owo-live aria-live="polite" aria-atomic="true"></div>
      </div>

      <div class="owo-controls">
        <div class="owo-dpad" aria-label="Maze movement controls">
          <button type="button" data-owo-direction="up" aria-label="Move up">↑</button>
          <button type="button" data-owo-direction="left" aria-label="Move left">←</button>
          <span aria-hidden="true">◆</span>
          <button type="button" data-owo-direction="right" aria-label="Move right">→</button>
          <button type="button" data-owo-direction="down" aria-label="Move down">↓</button>
        </div>
        <p><b>Reach the coral portal.</b><span>Collect blue sparks for bonus time and points.</span></p>
        <div class="owo-run-actions">
          <button type="button" data-owo-pause aria-label="Pause game">Pause <kbd>P</kbd></button>
          <button type="button" data-owo-restart aria-label="Restart run">Restart <kbd>R</kbd></button>
        </div>
      </div>
    </section>
  `;
}

/**
 * Canvas game controller.
 *
 * The easiest integration is:
 *   const game = new OneWayOutGame({ root, isSoundOn, onResult, onClose });
 *   game.start({ reset: true });
 *
 * `onResult` fires exactly once for each run, before that run is replaced or
 * abandoned. Closing the game finalizes the current run; reopening starts a
 * fresh one.
 *
 * Supplying `canvas` and optional data-owo DOM nodes also works when the host
 * application wants to own the surrounding markup.
 */
export class OneWayOutGame {
  constructor({
    root,
    canvas,
    isSoundOn = () => true,
    onClose = () => {},
    onScore = () => {},
    onResult = () => {},
    storage,
    storageKey = DEFAULT_STORAGE_KEY,
    seed,
    runIdFactory = randomRunId,
    autoStart = false,
  } = {}) {
    if (!root && !canvas) throw new TypeError("OneWayOutGame requires a root element or canvas");
    this.root = root || canvas.closest?.("[data-owo-root]") || canvas.parentElement;
    if (!this.root) throw new TypeError("The maze canvas must belong to a root element");
    this.ownsMarkup = !canvas;
    if (!canvas) this.root.innerHTML = gameMarkup();

    this.canvas = canvas || this.root.querySelector("[data-owo-canvas]");
    if (!this.canvas?.getContext) throw new TypeError("OneWayOutGame requires a canvas element");
    this.ctx = this.canvas.getContext("2d");
    if (!this.ctx) throw new Error("Canvas 2D rendering is unavailable");

    this.isSoundOn = isSoundOn;
    this.onClose = onClose;
    this.onScore = onScore;
    this.onResult = onResult;
    this.runIdFactory = typeof runIdFactory === "function" ? runIdFactory : randomRunId;
    this.storage = storage;
    if (storage === undefined) {
      try {
        this.storage = globalThis.localStorage;
      } catch {
        this.storage = null;
      }
    }
    this.storageKey = storageKey;
    this.fixedSeed = seed;
    this.state = "new";
    this.active = false;
    this.destroyed = false;
    this.level = 1;
    this.score = 0;
    this.streak = 0;
    this.completedLevels = 0;
    this.runBestStreak = 0;
    this.runId = null;
    this.runSequence = 0;
    this.runEngaged = false;
    this.runResultEmitted = false;
    this.runDurationMs = 0;
    this.lastResult = null;
    this.maze = null;
    this.path = [];
    this.player = { x: 0, y: 0 };
    this.playerAnimation = null;
    this.sparks = new Set();
    this.particles = [];
    this.trail = [];
    this.heldDirections = new Set();
    this.movementQueue = [];
    this.nextHeldMove = 0;
    this.lastFrame = safeNow();
    this.deadlineAt = 0;
    this.timerUpdatedAt = 0;
    this.raf = 0;
    this.audio = null;
    this.shakeUntil = 0;
    this.lastAnnouncedSecond = null;
    this.pointerStart = null;
    this.overlayAction = null;
    this.overlaySecondaryAction = null;
    this.listeners = [];
    this.best = this.readBest();
    this.motionPreference = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)") || null;
    this.reducedMotion = Boolean(this.motionPreference?.matches);

    this.nodes = {
      level: this.root.querySelector("[data-owo-level]"),
      score: this.root.querySelector("[data-owo-score]"),
      streak: this.root.querySelector("[data-owo-streak]"),
      best: this.root.querySelector("[data-owo-best]"),
      clock: this.root.querySelector("[data-owo-clock]"),
      clockFill: this.root.querySelector("[data-owo-clock-fill]"),
      time: this.root.querySelector("[data-owo-time]"),
      overlay: this.root.querySelector("[data-owo-overlay]"),
      overlayKicker: this.root.querySelector("[data-owo-overlay-kicker]"),
      overlayTitle: this.root.querySelector("[data-owo-overlay-title]"),
      overlayCopy: this.root.querySelector("[data-owo-overlay-copy]"),
      overlayPrimary: this.root.querySelector("[data-owo-overlay-primary]"),
      overlaySecondary: this.root.querySelector("[data-owo-overlay-secondary]"),
      pause: this.root.querySelector("[data-owo-pause]"),
      restart: this.root.querySelector("[data-owo-restart]"),
      close: this.root.querySelector("[data-owo-close]"),
      live: this.root.querySelector("[data-owo-live]"),
    };

    this.bindEvents();
    this.resizeObserver = globalThis.ResizeObserver
      ? new ResizeObserver(() => this.resize())
      : null;
    this.resizeObserver?.observe(this.canvas);
    this.updateHud();
    if (autoStart) this.start({ reset: true });
  }

  static mount(root, options = {}) {
    return new OneWayOutGame({ ...options, root });
  }

  listen(target, type, handler, options) {
    if (!target?.addEventListener) return;
    target.addEventListener(type, handler, options);
    this.listeners.push(() => target.removeEventListener(type, handler, options));
  }

  bindEvents() {
    this.listen(this.root, "keydown", (event) => this.handleKeyDown(event));
    this.listen(globalThis.window, "keyup", (event) => this.handleKeyUp(event));
    this.listen(globalThis.window, "blur", () => this.releaseControls());
    this.listen(this.motionPreference, "change", (event) => {
      this.reducedMotion = Boolean(event.matches);
      if (this.reducedMotion) {
        this.playerAnimation = null;
        this.particles = [];
        this.trail = [];
        this.shakeUntil = 0;
      }
    });
    this.listen(globalThis.document, "visibilitychange", () => {
      if (globalThis.document.hidden && this.state === "playing") this.pause("visibility");
    });
    this.listen(this.nodes.overlayPrimary, "click", () => this.overlayAction?.());
    this.listen(this.nodes.overlaySecondary, "click", () => this.overlaySecondaryAction?.());
    this.listen(this.nodes.pause, "click", () => this.togglePause());
    this.listen(this.nodes.restart, "click", () => this.requestRestart());
    this.listen(this.nodes.close, "click", () => this.close());
    this.listen(this.canvas, "pointerdown", (event) => this.handleCanvasPointerDown(event));
    this.listen(this.canvas, "pointerup", (event) => this.handleCanvasPointerUp(event));
    this.listen(this.canvas, "pointercancel", () => {
      this.pointerStart = null;
    });
    this.listen(this.canvas, "contextmenu", (event) => event.preventDefault());

    this.root.querySelectorAll("[data-owo-direction]").forEach((button) => {
      const direction = MAZE_DIRECTIONS[button.dataset.owoDirection];
      if (!direction) return;
      this.listen(button, "pointerdown", (event) => {
        event.preventDefault();
        button.setPointerCapture?.(event.pointerId);
        this.pressDirection(direction);
      });
      const release = (event) => {
        event.preventDefault();
        this.releaseDirection(direction);
      };
      this.listen(button, "pointerup", release);
      this.listen(button, "pointercancel", release);
      this.listen(button, "lostpointercapture", () => this.releaseDirection(direction));
      this.listen(button, "click", (event) => {
        if (event.detail !== 0) return;
        this.startFromInput();
        this.attemptMove(direction);
      });
    });
  }

  start({ reset = !this.maze } = {}) {
    if (this.destroyed) throw new Error("Cannot start a destroyed OneWayOutGame");
    this.active = true;
    if (reset || !this.maze || this.state === "closed" || this.runResultEmitted) {
      this.restart({ reason: this.state === "closed" ? "reopen" : "restart" });
    }
    this.ensureFrame();
    this.resize();
    globalThis.requestAnimationFrame(() => this.resize());
    return this;
  }

  open(options) {
    return this.start(options);
  }

  resume() {
    if (this.state === "paused") this.beginLevel();
    return this;
  }

  restart({ seed = this.fixedSeed ?? randomRunSeed(), reason = "restart" } = {}) {
    if (this.destroyed) return;
    this.finalizeRun(reason);
    this.runSeed = hashSeed(seed);
    this.runSequence += 1;
    let runId;
    try {
      runId = String(this.runIdFactory() || "");
    } catch {
      runId = "";
    }
    this.runId = runId || `owo-${this.runSeed.toString(36)}-${this.runSequence.toString(36)}`;
    this.level = 1;
    this.score = 0;
    this.streak = 0;
    this.completedLevels = 0;
    this.runBestStreak = 0;
    this.runEngaged = false;
    this.runResultEmitted = false;
    this.runDurationMs = 0;
    this.lastResult = null;
    this.active = true;
    this.prepareLevel();
    this.ensureFrame();
    this.announce("New run. Level 1 ready.");
  }

  finalizeRun(reason = "abandon") {
    if (!this.runId || this.runResultEmitted) return this.lastResult;
    if (this.state === "playing") {
      this.syncCountdown();
      if (this.remainingTime <= 0 && reason !== "game-over") {
        this.failLevel();
        return this.lastResult;
      }
    }
    this.runResultEmitted = true;

    const result = Object.freeze({
      runId: this.runId,
      seed: this.runSeed,
      reason,
      outcome: this.completedLevels > 0
        ? "complete"
        : reason === "game-over" ? "loss" : "played",
      score: Math.max(0, Math.round(this.score)),
      completedLevels: this.completedLevels,
      levelReached: this.level,
      streak: this.runBestStreak,
      durationMs: Math.max(0, Math.round(this.runDurationMs)),
      engaged: this.runEngaged,
    });
    this.lastResult = result;
    try {
      this.onResult(result);
    } catch {}
    return result;
  }

  syncCountdown(now = safeNow()) {
    if (this.state !== "playing" || !this.deadlineAt) return this.remainingTime;
    if (this.timerUpdatedAt) {
      this.runDurationMs += Math.max(0, now - this.timerUpdatedAt);
    }
    this.timerUpdatedAt = now;
    this.remainingTime = Math.max(0, (this.deadlineAt - now) / 1000);
    return this.remainingTime;
  }

  prepareLevel() {
    const difficulty = getMazeDifficulty(this.level);
    const targetLength = difficulty.width * difficulty.height * 0.44;
    let selected = null;
    let selectedPath = [];
    let selectedDistance = Infinity;

    for (let candidate = 0; candidate < 4; candidate += 1) {
      const seed = hashSeed(`${this.runSeed}:${this.level}:${candidate}`);
      const maze = generateMaze(difficulty.width, difficulty.height, {
        seed,
        loopChance: difficulty.loopChance,
      });
      const path = findShortestPath(maze);
      const distance = Math.abs(path.length - targetLength);
      if (!selected || distance < selectedDistance) {
        selected = maze;
        selectedPath = path;
        selectedDistance = distance;
      }
    }

    this.difficulty = difficulty;
    this.maze = selected;
    this.path = selectedPath;
    this.player = { ...selected.start };
    this.playerAnimation = null;
    this.moveCount = 0;
    this.sparksCollected = 0;
    this.sparks = this.placeSparks(selectedPath, difficulty.sparkCount);
    this.totalTime = clamp(Math.round(((selectedPath.length - 1) * 0.52 + 11) * 10) / 10, 19, 70);
    this.remainingTime = this.totalTime;
    this.deadlineAt = 0;
    this.timerUpdatedAt = 0;
    this.lastAnnouncedSecond = null;
    this.trail = [];
    this.particles = [];
    this.movementQueue = [];
    this.state = "ready";
    this.releaseControls();
    this.updateCanvasLabel();
    this.updateHud();
    this.showOverlay({
      kicker: `Level ${this.level} · ${difficulty.width} × ${difficulty.height}`,
      title: this.level === 1 ? "Ready to run?" : "The maze gets deeper.",
      copy: `${Math.ceil(this.totalTime)} seconds. Find the coral portal; blue sparks add time.`,
      primary: "Enter maze",
      onPrimary: () => this.beginLevel(),
    });
    this.draw(safeNow());
  }

  placeSparks(path, count) {
    const sparks = new Set();
    if (path.length < 4) return sparks;
    for (let index = 1; index <= count; index += 1) {
      const fraction = index / (count + 1);
      const pathIndex = clamp(Math.round(fraction * (path.length - 1)), 1, path.length - 2);
      const point = path[pathIndex];
      sparks.add(cellIndex(this.maze.width, point.x, point.y));
    }
    return sparks;
  }

  beginLevel() {
    if (!["ready", "paused"].includes(this.state)) return;
    const now = safeNow();
    this.state = "playing";
    this.runEngaged = true;
    this.deadlineAt = now + this.remainingTime * 1000;
    this.timerUpdatedAt = now;
    this.lastFrame = now;
    this.hideOverlay();
    this.nodes.pause && (this.nodes.pause.firstChild.textContent = "Pause ");
    this.canvas.focus({ preventScroll: true });
    this.announce(`Level ${this.level} started. ${Math.ceil(this.remainingTime)} seconds.`);
    this.ping(440, 0.055, "sine");
  }

  pause(reason = "manual") {
    if (this.state !== "playing") return;
    this.syncCountdown();
    if (this.remainingTime <= 0) {
      this.failLevel();
      return;
    }
    this.state = "paused";
    this.deadlineAt = 0;
    this.timerUpdatedAt = 0;
    this.releaseControls();
    this.showPauseOverlay(reason);
    this.announce("Game paused.");
  }

  showPauseOverlay(reason = "manual") {
    this.showOverlay({
      kicker: reason === "visibility" ? "Paused while you were away" : "Run paused",
      title: "Catch your breath.",
      copy: `${Math.ceil(this.remainingTime)} seconds remain on level ${this.level}.`,
      primary: "Resume",
      onPrimary: () => this.beginLevel(),
      secondary: "New run",
      onSecondary: () => this.restart(),
    });
  }

  togglePause() {
    if (this.state === "playing") {
      this.pause();
    } else if (this.state === "paused") {
      this.beginLevel();
    }
  }

  requestRestart() {
    if (["new", "closed"].includes(this.state)) return;
    if (this.state === "ready" && this.level === 1 && this.score === 0) {
      this.restart({ reason: "restart" });
      return;
    }
    const previousOverlay = this.captureOverlay();
    const resumeState = this.state;
    if (this.state === "playing") {
      this.syncCountdown();
      if (this.remainingTime <= 0) {
        this.failLevel();
        return;
      }
      this.state = "paused";
      this.deadlineAt = 0;
      this.timerUpdatedAt = 0;
    }
    this.releaseControls();
    this.showOverlay({
      kicker: "Restart run?",
      title: "Back to level one.",
      copy: "Your current score and streak will be cleared.",
      primary: "Restart",
      onPrimary: () => this.restart({ reason: "restart" }),
      secondary: resumeState === "playing" ? "Keep playing" : "Go back",
      onSecondary: () => {
        if (resumeState === "playing") {
          this.state = "paused";
          this.beginLevel();
        } else {
          this.state = resumeState;
          this.restoreOverlay(previousOverlay);
        }
      },
    });
  }

  close({ notify = true, reason = "close" } = {}) {
    if (this.destroyed || this.state === "closed") return;
    if (this.state === "playing") this.syncCountdown();
    this.finalizeRun(reason);
    this.state = "closed";
    this.deadlineAt = 0;
    this.timerUpdatedAt = 0;
    this.active = false;
    this.releaseControls();
    if (this.raf) globalThis.cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (notify) {
      try {
        this.onClose(this.getStats());
      } catch {}
    }
  }

  destroy() {
    if (this.destroyed) return;
    this.close({ notify: false, reason: "destroy" });
    this.destroyed = true;
    this.resizeObserver?.disconnect();
    this.listeners.splice(0).forEach((remove) => remove());
    try {
      this.audio?.close();
    } catch {}
    this.audio = null;
    if (this.ownsMarkup) this.root.replaceChildren();
  }

  getStats() {
    return {
      level: this.level,
      score: this.score,
      streak: this.streak,
      completedLevels: this.completedLevels,
      best: { ...this.best },
      state: this.state,
      seed: this.runSeed,
      runId: this.runId,
      resultEmitted: this.runResultEmitted,
      durationMs: Math.max(0, Math.round(this.runDurationMs)),
    };
  }

  handleKeyDown(event) {
    if (!this.active || this.state === "closed") return;
    const tag = event.target?.tagName?.toLowerCase();
    if (["input", "textarea", "select"].includes(tag)) return;
    const direction = KEY_DIRECTIONS[event.code];
    if (direction) {
      event.preventDefault();
      if (this.heldDirections.has(direction.name)) return;
      this.pressDirection(direction);
      return;
    }
    if (event.code === "KeyP" || event.code === "Space") {
      if (event.code === "Space" && event.target?.tagName === "BUTTON") return;
      event.preventDefault();
      if (["playing", "paused"].includes(this.state)) this.togglePause();
    }
    if (event.code === "KeyR") {
      event.preventDefault();
      this.requestRestart();
    }
    if (event.code === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      this.close();
    }
  }

  handleKeyUp(event) {
    const direction = KEY_DIRECTIONS[event.code];
    if (direction) this.releaseDirection(direction);
  }

  startFromInput() {
    if (this.state === "ready" || this.state === "paused") this.beginLevel();
  }

  pressDirection(direction) {
    this.startFromInput();
    if (this.state !== "playing") return;
    this.heldDirections.delete(direction.name);
    this.heldDirections.add(direction.name);
    this.attemptMove(direction);
    this.nextHeldMove = safeNow() + 180;
  }

  releaseDirection(direction) {
    this.heldDirections.delete(direction.name);
  }

  releaseControls() {
    this.heldDirections.clear();
    this.movementQueue = [];
    this.nextHeldMove = 0;
  }

  handleCanvasPointerDown(event) {
    if (!this.active) return;
    this.canvas.focus({ preventScroll: true });
    this.pointerStart = { x: event.clientX, y: event.clientY, id: event.pointerId };
    this.canvas.setPointerCapture?.(event.pointerId);
  }

  handleCanvasPointerUp(event) {
    if (!this.pointerStart || this.pointerStart.id !== event.pointerId) return;
    const dx = event.clientX - this.pointerStart.x;
    const dy = event.clientY - this.pointerStart.y;
    this.pointerStart = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 22) return;
    event.preventDefault();
    const direction = Math.abs(dx) > Math.abs(dy)
      ? dx > 0 ? MAZE_DIRECTIONS.right : MAZE_DIRECTIONS.left
      : dy > 0 ? MAZE_DIRECTIONS.down : MAZE_DIRECTIONS.up;
    this.startFromInput();
    this.attemptMove(direction);
  }

  attemptMove(direction) {
    if (this.state !== "playing" || !this.maze) return false;
    const now = safeNow();
    this.syncCountdown(now);
    if (this.remainingTime <= 0) {
      this.failLevel();
      return false;
    }
    if (this.playerAnimation && now < this.playerAnimation.startedAt + this.playerAnimation.duration) {
      if (this.movementQueue.length < 3) this.movementQueue.push(direction);
      return true;
    }
    this.playerAnimation = null;
    const mask = this.maze.cells[cellIndex(this.maze.width, this.player.x, this.player.y)];
    if (!(mask & direction.bit)) {
      this.bump(direction);
      return false;
    }

    const from = this.renderedPlayer(now);
    const next = {
      x: this.player.x + direction.dx,
      y: this.player.y + direction.dy,
    };
    this.player = next;
    this.playerAnimation = {
      from,
      to: { ...next },
      startedAt: now,
      duration: this.reducedMotion ? 0 : 105,
    };
    this.moveCount += 1;
    if (!this.reducedMotion) {
      this.trail.push({ x: from.x, y: from.y, bornAt: now });
      if (this.trail.length > 16) this.trail.shift();
    }

    const index = cellIndex(this.maze.width, next.x, next.y);
    if (this.sparks.delete(index)) this.collectSpark(next);
    this.updateCanvasLabel();
    if (next.x === this.maze.exit.x && next.y === this.maze.exit.y) this.completeLevel();
    else this.ping(230 + (this.moveCount % 4) * 18, 0.018, "sine", 0.012);
    return true;
  }

  bump(direction) {
    const now = safeNow();
    this.shakeUntil = this.reducedMotion ? 0 : now + 90;
    this.spawnParticles(this.player, COLORS.wall, 3, direction);
    this.ping(105, 0.04, "square", 0.017);
    if (!this.reducedMotion && globalThis.navigator?.vibrate) globalThis.navigator.vibrate(8);
  }

  collectSpark(point) {
    const now = safeNow();
    this.syncCountdown(now);
    this.sparksCollected += 1;
    this.remainingTime = Math.min(this.totalTime + 5, this.remainingTime + 1.8);
    this.deadlineAt = now + this.remainingTime * 1000;
    this.timerUpdatedAt = now;
    const bonus = 80 + this.level * 10;
    this.score += bonus;
    this.spawnParticles(point, COLORS.spark, 14);
    this.ping(720 + this.sparksCollected * 70, 0.085, "sine", 0.035);
    this.announce(`Time spark collected. Plus 1.8 seconds and ${bonus} points.`);
    this.updateBest();
    this.updateHud();
  }

  completeLevel() {
    if (this.state !== "playing") return;
    this.syncCountdown();
    this.state = "level-complete";
    this.deadlineAt = 0;
    this.timerUpdatedAt = 0;
    this.releaseControls();
    this.streak += 1;
    this.completedLevels += 1;
    this.runBestStreak = Math.max(this.runBestStreak, this.streak);
    const award = calculateLevelScore({
      level: this.level,
      remainingTime: this.remainingTime,
      totalTime: this.totalTime,
      sparksCollected: this.sparksCollected,
      moveCount: this.moveCount,
      optimalMoves: this.path.length - 1,
      streak: this.streak,
    });
    this.score += award;
    this.spawnParticles(this.maze.exit, COLORS.exit, 42);
    this.ping(520, 0.09, "triangle", 0.04);
    setTimeout(() => this.state === "level-complete" && this.ping(780, 0.14, "sine", 0.04), 100);
    this.updateBest();
    this.updateHud();
    try {
      this.onScore(this.getStats());
    } catch {}
    const efficiency = Math.round(
      Math.min(1, (this.path.length - 1) / Math.max(1, this.moveCount)) * 100,
    );
    this.showOverlay({
      kicker: `Level ${this.level} escaped · ${efficiency}% route`,
      title: `+${formatNumber(award)} points`,
      copy: `${Math.ceil(this.remainingTime)} seconds left. Streak ×${this.streak} raises the next clear bonus.`,
      primary: "Next maze",
      onPrimary: () => {
        this.level += 1;
        this.prepareLevel();
      },
      secondary: "Close",
      onSecondary: () => this.close(),
    });
    this.announce(`Level ${this.level} cleared. ${award} points. Streak ${this.streak}.`);
  }

  failLevel() {
    if (this.state !== "playing") return;
    this.syncCountdown();
    this.remainingTime = 0;
    this.state = "game-over";
    this.deadlineAt = 0;
    this.timerUpdatedAt = 0;
    this.releaseControls();
    const endedStreak = this.streak;
    this.streak = 0;
    this.updateBest();
    this.updateHud();
    try {
      this.onScore(this.getStats());
    } catch {}
    this.finalizeRun("game-over");
    this.ping(150, 0.28, "sawtooth", 0.035);
    this.showOverlay({
      kicker: `Run over · Reached level ${this.level}`,
      title: "Time found you.",
      copy: `${formatNumber(this.score)} points${endedStreak ? ` · Best streak ×${endedStreak}` : ""}. The next maze run starts fresh.`,
      primary: "Run again",
      onPrimary: () => this.restart({ reason: "retry" }),
      secondary: "Close",
      onSecondary: () => this.close(),
    });
    this.announce(`Time expired. Final score ${this.score}.`);
  }

  captureOverlay() {
    if (!this.nodes.overlay) return null;
    const primaryTextNode = this.nodes.overlayPrimary?.firstChild;
    return {
      kicker: this.nodes.overlayKicker?.textContent || "",
      title: this.nodes.overlayTitle?.textContent || "",
      copy: this.nodes.overlayCopy?.textContent || "",
      primary: primaryTextNode?.nodeType === 3
        ? primaryTextNode.textContent.trim()
        : this.nodes.overlayPrimary?.textContent?.trim() || "Continue",
      onPrimary: this.overlayAction,
      secondary: this.nodes.overlaySecondary && !this.nodes.overlaySecondary.hidden
        ? this.nodes.overlaySecondary.textContent
        : undefined,
      onSecondary: this.overlaySecondaryAction,
    };
  }

  restoreOverlay(snapshot) {
    if (snapshot) this.showOverlay(snapshot);
  }

  showOverlay({
    kicker,
    title,
    copy,
    primary,
    onPrimary,
    secondary,
    onSecondary,
  }) {
    if (!this.nodes.overlay) return;
    if (this.nodes.overlayKicker) this.nodes.overlayKicker.textContent = kicker;
    if (this.nodes.overlayTitle) this.nodes.overlayTitle.textContent = title;
    if (this.nodes.overlayCopy) this.nodes.overlayCopy.textContent = copy;
    if (this.nodes.overlayPrimary) {
      const label = this.nodes.overlayPrimary.firstChild;
      if (label?.nodeType === 3) label.textContent = `${primary} `;
      else this.nodes.overlayPrimary.textContent = primary;
    }
    this.overlayAction = onPrimary;
    if (this.nodes.overlaySecondary) {
      this.nodes.overlaySecondary.hidden = !secondary;
      this.nodes.overlaySecondary.textContent = secondary || "";
    }
    this.overlaySecondaryAction = onSecondary || null;
    this.nodes.overlay.hidden = false;
    if (this.active && !globalThis.document?.hidden) {
      try {
        this.nodes.overlayPrimary?.focus({ preventScroll: true });
      } catch {}
    }
  }

  hideOverlay() {
    if (this.nodes.overlay) this.nodes.overlay.hidden = true;
    this.overlayAction = null;
    this.overlaySecondaryAction = null;
  }

  announce(message) {
    if (!this.nodes.live) return;
    this.nodes.live.textContent = "";
    setTimeout(() => {
      if (!this.destroyed && this.nodes.live) this.nodes.live.textContent = message;
    }, 20);
  }

  updateCanvasLabel() {
    if (!this.maze) return;
    this.canvas.setAttribute(
      "aria-label",
      `Maze level ${this.level}. You are at column ${this.player.x + 1}, row ${this.player.y + 1}. `
        + `The exit is at column ${this.maze.exit.x + 1}, row ${this.maze.exit.y + 1}. `
        + "Use arrow keys or W A S D to move.",
    );
  }

  readBest() {
    const fallback = { score: 0, level: 1, streak: 0 };
    try {
      const parsed = JSON.parse(this.storage?.getItem(this.storageKey) || "null");
      if (!parsed || typeof parsed !== "object") return fallback;
      return {
        score: Math.max(0, Math.floor(Number(parsed.score) || 0)),
        level: Math.max(1, Math.floor(Number(parsed.level) || 1)),
        streak: Math.max(0, Math.floor(Number(parsed.streak) || 0)),
      };
    } catch {
      return fallback;
    }
  }

  updateBest() {
    const next = {
      score: Math.max(this.best.score, this.score),
      level: Math.max(this.best.level, this.level),
      streak: Math.max(this.best.streak, this.streak),
    };
    const changed = next.score !== this.best.score
      || next.level !== this.best.level
      || next.streak !== this.best.streak;
    this.best = next;
    if (changed) {
      try {
        this.storage?.setItem(this.storageKey, JSON.stringify(next));
      } catch {}
    }
  }

  updateHud() {
    if (this.nodes.level) this.nodes.level.textContent = String(this.level);
    if (this.nodes.score) this.nodes.score.textContent = formatNumber(this.score);
    if (this.nodes.streak) this.nodes.streak.textContent = `×${this.streak}`;
    if (this.nodes.best) this.nodes.best.textContent = formatNumber(this.best.score);
    if (this.nodes.time) this.nodes.time.textContent = `${Math.max(0, Math.ceil(this.remainingTime || 0))}s`;
    const ratio = clamp((this.remainingTime || 0) / Math.max(0.001, this.totalTime || 1), 0, 1);
    if (this.nodes.clockFill) this.nodes.clockFill.style.transform = `scaleX(${ratio})`;
    if (this.nodes.clock) {
      this.nodes.clock.setAttribute("aria-valuenow", String(Math.round(ratio * 100)));
      this.nodes.clock.classList.toggle("urgent", ratio < 0.22);
    }
  }

  ensureFrame() {
    if (!this.active || this.raf || this.destroyed) return;
    this.lastFrame = safeNow();
    this.raf = globalThis.requestAnimationFrame((now) => this.loop(now));
  }

  loop(now) {
    this.raf = 0;
    if (!this.active || this.destroyed) return;
    const elapsed = Math.min(0.1, Math.max(0, (now - this.lastFrame) / 1000));
    this.lastFrame = now;

    if (this.state === "playing") {
      this.syncCountdown(now);
      if (
        this.playerAnimation
        && now >= this.playerAnimation.startedAt + this.playerAnimation.duration
      ) {
        this.playerAnimation = null;
      }
      if (!this.playerAnimation && this.movementQueue.length) {
        this.attemptMove(this.movementQueue.shift());
      }
      if (this.heldDirections.size && now >= this.nextHeldMove) {
        const name = [...this.heldDirections].at(-1);
        this.attemptMove(MAZE_DIRECTIONS[name]);
        this.nextHeldMove = now + this.difficulty.holdInterval;
      }
      const seconds = Math.ceil(this.remainingTime);
      if (seconds <= 5 && seconds !== this.lastAnnouncedSecond) {
        this.lastAnnouncedSecond = seconds;
        if (seconds > 0) {
          this.announce(`${seconds} seconds remaining.`);
          this.ping(350 + (5 - seconds) * 25, 0.035, "square", 0.018);
        }
      }
      if (this.remainingTime <= 0) this.failLevel();
      this.updateHud();
    }

    this.updateParticles(elapsed);
    this.draw(now);
    this.ensureFrame();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
    const width = Math.round(rect.width * dpr);
    const height = Math.round(rect.height * dpr);
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.width = rect.width;
    this.height = rect.height;
    this.draw(safeNow());
  }

  boardMetrics() {
    const padding = clamp(Math.min(this.width, this.height) * 0.075, 22, 46);
    const cellSize = Math.min(
      (this.width - padding * 2) / this.maze.width,
      (this.height - padding * 2) / this.maze.height,
    );
    const boardWidth = cellSize * this.maze.width;
    const boardHeight = cellSize * this.maze.height;
    return {
      cellSize,
      x: (this.width - boardWidth) / 2,
      y: (this.height - boardHeight) / 2,
      width: boardWidth,
      height: boardHeight,
    };
  }

  renderedPlayer(now) {
    const animation = this.playerAnimation;
    if (!animation) return { ...this.player };
    if (this.reducedMotion || animation.duration <= 0) {
      this.playerAnimation = null;
      return { ...animation.to };
    }
    const progress = clamp((now - animation.startedAt) / animation.duration, 0, 1);
    if (progress >= 1) {
      this.playerAnimation = null;
      return { ...animation.to };
    }
    const eased = easeOutCubic(progress);
    return {
      x: animation.from.x + (animation.to.x - animation.from.x) * eased,
      y: animation.from.y + (animation.to.y - animation.from.y) * eased,
    };
  }

  spawnParticles(point, color, count, direction) {
    if (this.reducedMotion) return;
    const random = createSeededRandom(`${safeNow()}:${this.moveCount}:${count}`);
    for (let index = 0; index < count; index += 1) {
      const angle = direction
        ? Math.atan2(-direction.dy, -direction.dx) + (random() - 0.5) * 1.5
        : random() * Math.PI * 2;
      const speed = 0.7 + random() * 1.8;
      this.particles.push({
        x: point.x,
        y: point.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        color,
        life: 0.35 + random() * 0.45,
        age: 0,
        size: 1.5 + random() * 2.8,
      });
    }
    if (this.particles.length > 100) this.particles.splice(0, this.particles.length - 100);
  }

  updateParticles(elapsed) {
    this.particles.forEach((particle) => {
      particle.age += elapsed;
      particle.x += particle.vx * elapsed;
      particle.y += particle.vy * elapsed;
      particle.vx *= 0.97;
      particle.vy *= 0.97;
    });
    this.particles = this.particles.filter((particle) => particle.age < particle.life);
    const now = safeNow();
    this.trail = this.trail.filter((point) => now - point.bornAt < 600);
  }

  draw(now = safeNow()) {
    if (!this.width || !this.height || !this.maze) return;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);
    const background = ctx.createRadialGradient(
      this.width * 0.5,
      this.height * 0.45,
      0,
      this.width * 0.5,
      this.height * 0.45,
      Math.max(this.width, this.height) * 0.72,
    );
    background.addColorStop(0, COLORS.background);
    background.addColorStop(1, COLORS.backgroundDeep);
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, this.width, this.height);

    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    for (let x = 18; x < this.width; x += 34) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, this.height);
      ctx.stroke();
    }
    for (let y = 18; y < this.height; y += 34) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(this.width, y);
      ctx.stroke();
    }

    const board = this.boardMetrics();
    const center = (point) => ({
      x: board.x + (point.x + 0.5) * board.cellSize,
      y: board.y + (point.y + 0.5) * board.cellSize,
    });
    ctx.save();
    if (!this.reducedMotion && now < this.shakeUntil) {
      const strength = ((this.shakeUntil - now) / 90) * 2.4;
      ctx.translate(Math.sin(now * 0.45) * strength, Math.cos(now * 0.37) * strength);
    }

    ctx.fillStyle = "rgba(102, 214, 174, .022)";
    ctx.fillRect(board.x, board.y, board.width, board.height);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = clamp(board.cellSize * 0.07, 1.8, 4.4);
    ctx.strokeStyle = COLORS.wall;
    ctx.shadowColor = COLORS.wallGlow;
    ctx.shadowBlur = 7;

    const line = (x1, y1, x2, y2) => {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    };
    for (let y = 0; y < this.maze.height; y += 1) {
      for (let x = 0; x < this.maze.width; x += 1) {
        const mask = this.maze.cells[cellIndex(this.maze.width, x, y)];
        const left = board.x + x * board.cellSize;
        const top = board.y + y * board.cellSize;
        const right = left + board.cellSize;
        const bottom = top + board.cellSize;
        if (!(mask & NORTH)) line(left, top, right, top);
        if (!(mask & WEST)) line(left, top, left, bottom);
        if (x === this.maze.width - 1 && !(mask & EAST)) line(right, top, right, bottom);
        if (y === this.maze.height - 1 && !(mask & SOUTH)) line(left, bottom, right, bottom);
      }
    }
    ctx.shadowBlur = 0;

    const exit = center(this.maze.exit);
    const portalPulse = this.reducedMotion ? 1 : 0.88 + Math.sin(now / 180) * 0.12;
    ctx.save();
    ctx.translate(exit.x, exit.y);
    ctx.rotate(this.reducedMotion ? 0 : now / 1900);
    ctx.strokeStyle = COLORS.exit;
    ctx.fillStyle = "rgba(255, 114, 94, .13)";
    ctx.lineWidth = clamp(board.cellSize * 0.09, 2, 5);
    ctx.shadowColor = COLORS.exit;
    ctx.shadowBlur = 17;
    ctx.beginPath();
    for (let side = 0; side < 6; side += 1) {
      const angle = Math.PI / 3 * side - Math.PI / 2;
      const radius = board.cellSize * 0.24 * portalPulse;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      if (!side) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    this.sparks.forEach((index) => {
      const point = { x: index % this.maze.width, y: Math.floor(index / this.maze.width) };
      const position = center(point);
      const size = board.cellSize * (
        this.reducedMotion ? 0.1 : 0.1 + Math.sin(now / 170 + index) * 0.018
      );
      ctx.save();
      ctx.translate(position.x, position.y);
      ctx.rotate(Math.PI / 4 + (this.reducedMotion ? 0 : now / 2400));
      ctx.fillStyle = COLORS.spark;
      ctx.shadowColor = COLORS.spark;
      ctx.shadowBlur = 12;
      ctx.fillRect(-size, -size, size * 2, size * 2);
      ctx.restore();
    });

    this.trail.forEach((point) => {
      const age = clamp((now - point.bornAt) / 600, 0, 1);
      const position = center(point);
      ctx.fillStyle = `rgba(255, 212, 92, ${0.18 * (1 - age)})`;
      ctx.beginPath();
      ctx.arc(position.x, position.y, board.cellSize * 0.13 * (1 - age * 0.5), 0, Math.PI * 2);
      ctx.fill();
    });

    this.particles.forEach((particle) => {
      const alpha = 1 - particle.age / particle.life;
      const position = center(particle);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = particle.color;
      ctx.fillRect(position.x - particle.size / 2, position.y - particle.size / 2, particle.size, particle.size);
    });
    ctx.globalAlpha = 1;

    const rendered = this.renderedPlayer(now);
    const player = center(rendered);
    const playerSize = clamp(board.cellSize * 0.18, 5, 11);
    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = COLORS.player;
    ctx.strokeStyle = COLORS.playerCore;
    ctx.lineWidth = 1.5;
    ctx.shadowColor = COLORS.player;
    ctx.shadowBlur = 18;
    ctx.fillRect(-playerSize, -playerSize, playerSize * 2, playerSize * 2);
    ctx.strokeRect(-playerSize, -playerSize, playerSize * 2, playerSize * 2);
    ctx.restore();
    ctx.restore();
  }

  ping(frequency, duration, type = "sine", volume = 0.025) {
    if (!this.isSoundOn()) return;
    try {
      const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AudioContextClass) return;
      this.audio ||= new AudioContextClass();
      if (this.audio.state === "suspended") this.audio.resume();
      const oscillator = this.audio.createOscillator();
      const gain = this.audio.createGain();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, this.audio.currentTime);
      gain.gain.setValueAtTime(volume, this.audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, this.audio.currentTime + duration);
      oscillator.connect(gain).connect(this.audio.destination);
      oscillator.start();
      oscillator.stop(this.audio.currentTime + duration);
    } catch {}
  }
}
