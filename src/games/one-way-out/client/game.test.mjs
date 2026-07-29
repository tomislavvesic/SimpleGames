import assert from "node:assert/strict";
import test from "node:test";

import {
  MAZE_DIRECTIONS,
  calculateLevelScore,
  createSeededRandom,
  findShortestPath,
  generateMaze,
  getMazeDifficulty,
  isMazeSolvable,
  validateMaze,
} from "./game.js";

test("seeded random streams are deterministic and remain in range", () => {
  const first = createSeededRandom("daily-maze");
  const second = createSeededRandom("daily-maze");
  const values = Array.from({ length: 40 }, () => first());
  assert.deepEqual(values, Array.from({ length: 40 }, () => second()));
  assert.ok(values.every((value) => value >= 0 && value < 1));
  assert.ok(new Set(values).size > 35);
});

test("maze generation is deterministic for a seed", () => {
  const first = generateMaze(13, 9, { seed: "same-seed", loopChance: 0.08 });
  const second = generateMaze(13, 9, { seed: "same-seed", loopChance: 0.08 });
  const other = generateMaze(13, 9, { seed: "other-seed", loopChance: 0.08 });
  assert.deepEqual([...first.cells], [...second.cells]);
  assert.notDeepEqual([...first.cells], [...other.cells]);
});

test("generated mazes are valid, connected and solvable over many levels", () => {
  for (let level = 1; level <= 30; level += 1) {
    const difficulty = getMazeDifficulty(level);
    for (let sample = 0; sample < 5; sample += 1) {
      const maze = generateMaze(difficulty.width, difficulty.height, {
        seed: `level-${level}-${sample}`,
        loopChance: difficulty.loopChance,
      });
      const audit = validateMaze(maze);
      assert.equal(audit.valid, true, audit.errors.join("; "));
      assert.equal(audit.connected, true);
      assert.equal(audit.solvable, true);
      assert.equal(audit.reachableCount, maze.width * maze.height);
      assert.equal(isMazeSolvable(maze), true);
    }
  }
});

test("shortest paths contain adjacent cells connected by reciprocal openings", () => {
  const maze = generateMaze(19, 13, { seed: 90210, loopChance: 0.05 });
  const path = findShortestPath(maze);
  assert.deepEqual(path[0], maze.start);
  assert.deepEqual(path.at(-1), maze.exit);
  assert.ok(path.length > 1);

  for (let index = 1; index < path.length; index += 1) {
    const previous = path[index - 1];
    const current = path[index];
    const direction = Object.values(MAZE_DIRECTIONS).find(
      (candidate) => previous.x + candidate.dx === current.x && previous.y + candidate.dy === current.y,
    );
    assert.ok(direction, `Steps ${index - 1} and ${index} must be adjacent`);
    const previousMask = maze.cells[previous.y * maze.width + previous.x];
    const currentMask = maze.cells[current.y * maze.width + current.x];
    assert.ok(previousMask & direction.bit, "Origin cell must open toward the next step");
    assert.ok(currentMask & direction.opposite, "Destination cell must open toward the previous step");
  }
});

test("validation rejects boundary leaks and non-reciprocal openings", () => {
  const boundaryLeak = generateMaze(5, 5, { seed: 1 });
  boundaryLeak.cells[0] |= MAZE_DIRECTIONS.up.bit;
  const leakAudit = validateMaze(boundaryLeak);
  assert.equal(leakAudit.valid, false);
  assert.ok(leakAudit.errors.some((error) => error.includes("outside")));

  const oneWay = generateMaze(5, 5, { seed: 2 });
  oneWay.cells[0] |= MAZE_DIRECTIONS.right.bit;
  oneWay.cells[1] &= ~MAZE_DIRECTIONS.right.opposite;
  const oneWayAudit = validateMaze(oneWay);
  assert.equal(oneWayAudit.valid, false);
  assert.ok(oneWayAudit.errors.some((error) => error.includes("not reciprocal")));
});

test("validation identifies a disconnected and unsolvable maze", () => {
  const maze = {
    width: 3,
    height: 3,
    cells: new Uint8Array(9),
    start: { x: 0, y: 0 },
    exit: { x: 2, y: 2 },
  };
  const audit = validateMaze(maze);
  assert.equal(audit.valid, false);
  assert.equal(audit.connected, false);
  assert.equal(audit.solvable, false);
  assert.deepEqual(findShortestPath(maze), []);
});

test("generation validates dimensions and endpoints", () => {
  assert.throws(() => generateMaze(1, 8), RangeError);
  assert.throws(() => generateMaze(8, 52), RangeError);
  assert.throws(() => generateMaze(8.5, 8), RangeError);
  assert.throws(
    () => generateMaze(5, 5, { start: { x: -1, y: 0 } }),
    /outside/,
  );
  assert.throws(
    () => generateMaze(5, 5, { start: { x: 1, y: 1 }, exit: { x: 1, y: 1 } }),
    /must differ/,
  );
});

test("difficulty grows gradually and remains within production caps", () => {
  let previous = getMazeDifficulty(1);
  for (let level = 2; level <= 100; level += 1) {
    const current = getMazeDifficulty(level);
    assert.ok(current.width >= previous.width);
    assert.ok(current.height >= previous.height);
    assert.ok(current.width <= 21);
    assert.ok(current.height <= 15);
    assert.ok(current.loopChance >= 0.025);
    assert.ok(current.sparkCount >= 3 && current.sparkCount <= 5);
    assert.ok(current.holdInterval >= 62);
    previous = current;
  }
});

test("level scoring rewards time, efficient routes, sparks and streaks", () => {
  const baseline = {
    level: 4,
    remainingTime: 10,
    totalTime: 30,
    sparksCollected: 1,
    moveCount: 70,
    optimalMoves: 50,
    streak: 1,
  };
  const baseScore = calculateLevelScore(baseline);
  assert.ok(baseScore > 0);
  assert.ok(calculateLevelScore({ ...baseline, remainingTime: 20 }) > baseScore);
  assert.ok(calculateLevelScore({ ...baseline, moveCount: 52 }) > baseScore);
  assert.ok(calculateLevelScore({ ...baseline, sparksCollected: 4 }) > baseScore);
  assert.ok(calculateLevelScore({ ...baseline, streak: 6 }) > baseScore);
});
