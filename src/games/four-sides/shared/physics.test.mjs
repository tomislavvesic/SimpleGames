import test from "node:test";
import assert from "node:assert/strict";
import {
  ARENA_EDGE,
  BALL_RADIUS,
  GOAL_HALF,
  MAX_BALL_SPEED,
  PADDLE_HALF,
  advanceArenaBall,
  clampPaddle,
  paddleBounds,
  predictPaddleTarget,
  reflectedCoordinate,
} from "./physics.js";

const paddle = (side, pos = 0.5) => ({ side, pos, eliminated: false });

test("paddles remain fully inside their equal-sized goal", () => {
  for (const side of ["left", "top", "right", "bottom"]) {
    const bounds = paddleBounds(side);
    assert.equal(clampPaddle(side, -10), bounds.min);
    assert.equal(clampPaddle(side, 10), bounds.max);
    assert.ok(bounds.min < bounds.max);
  }
});

test("solid wall contacts clamp and reflect without visual tunnelling", () => {
  const ball = { x: ARENA_EDGE + BALL_RADIUS.x + 0.001, y: 0.08, vx: -0.8, vy: 0, lastHit: null };
  const result = advanceArenaBall(ball, { left: paddle("left") }, 1 / 60);
  assert.equal(result.goal, null);
  assert.deepEqual(result.wallSides, ["left"]);
  assert.equal(ball.x, ARENA_EDGE + BALL_RADIUS.x);
  assert.ok(ball.vx > 0);
});

test("a paddle contact changes angle and increases speed", () => {
  const ball = { x: ARENA_EDGE + BALL_RADIUS.x + 0.001, y: 0.54, vx: -0.42, vy: 0, lastHit: null };
  const before = Math.hypot(ball.vx, ball.vy);
  const result = advanceArenaBall(ball, { left: paddle("left") }, 1 / 60);
  assert.deepEqual(result.hitSides, ["left"]);
  assert.equal(result.goal, null);
  assert.equal(ball.lastHit, "left");
  assert.ok(ball.vx > 0);
  assert.ok(ball.vy > 0);
  assert.ok(Math.hypot(ball.vx, ball.vy) > before);
  assert.ok(Math.hypot(ball.vx, ball.vy) <= MAX_BALL_SPEED);
});

test("a clean miss is locked at contact and scores after entering the opening", () => {
  const ball = { x: ARENA_EDGE + BALL_RADIUS.x + 0.001, y: 0.5, vx: -0.6, vy: 0, lastHit: null };
  const paddles = { left: paddle("left", 0.7) };
  const contact = advanceArenaBall(ball, paddles, 1 / 60);
  assert.equal(contact.goal, null);
  assert.equal(ball.pendingGoal, "left");
  paddles.left.pos = 0.5;
  let result = contact;
  for (let index = 0; index < 10 && !result.goal; index += 1) {
    result = advanceArenaBall(ball, paddles, 1 / 120);
  }
  assert.equal(result.goal, "left");
});

test("eliminated goals become solid walls", () => {
  const ball = { x: ARENA_EDGE + BALL_RADIUS.x + 0.001, y: 0.5, vx: -0.6, vy: 0, lastHit: null };
  const result = advanceArenaBall(ball, { left: { ...paddle("left", 0.7), eliminated: true } }, 1 / 60);
  assert.equal(result.goal, null);
  assert.deepEqual(result.wallSides, ["left"]);
  assert.ok(ball.vx > 0);
});

test("reflected bot predictions stay on the arena after multiple bounces", () => {
  assert.ok(Math.abs(reflectedCoordinate(1.2, 0, 1) - 0.8) < 1e-9);
  assert.ok(Math.abs(reflectedCoordinate(-0.2, 0, 1) - 0.2) < 1e-9);
  const target = predictPaddleTarget({ x: 0.8, y: 0.9, vx: -0.2, vy: 0.9 }, "left");
  assert.ok(target >= 0 && target <= 1);
});

test("goal and paddle geometry is physically equal on every side", () => {
  const arenaWidth = 900;
  const arenaHeight = 620;
  const goalPixels = [
    GOAL_HALF.left * 2 * arenaHeight,
    GOAL_HALF.right * 2 * arenaHeight,
    GOAL_HALF.top * 2 * arenaWidth,
    GOAL_HALF.bottom * 2 * arenaWidth,
  ];
  const paddlePixels = [
    PADDLE_HALF.left * 2 * arenaHeight,
    PADDLE_HALF.right * 2 * arenaHeight,
    PADDLE_HALF.top * 2 * arenaWidth,
    PADDLE_HALF.bottom * 2 * arenaWidth,
  ];
  const spread = (values) => Math.max(...values) - Math.min(...values);
  assert.ok(spread(goalPixels) < 2, `goal sizes differ by ${spread(goalPixels)}px`);
  assert.ok(spread(paddlePixels) < 2, `paddle sizes differ by ${spread(paddlePixels)}px`);
});

test("every solid boundary reflects inward and clamps the complete ball", () => {
  const cases = [
    {
      side: "left",
      ball: { x: ARENA_EDGE + BALL_RADIUS.x + 0.001, y: 0.08, vx: -0.92, vy: 0 },
      inward: (ball) => ball.vx > 0 && ball.x === ARENA_EDGE + BALL_RADIUS.x,
    },
    {
      side: "right",
      ball: { x: 1 - ARENA_EDGE - BALL_RADIUS.x - 0.001, y: 0.08, vx: 0.92, vy: 0 },
      inward: (ball) => ball.vx < 0 && ball.x === 1 - ARENA_EDGE - BALL_RADIUS.x,
    },
    {
      side: "top",
      ball: { x: 0.08, y: ARENA_EDGE + BALL_RADIUS.y + 0.001, vx: 0, vy: -0.92 },
      inward: (ball) => ball.vy > 0 && ball.y === ARENA_EDGE + BALL_RADIUS.y,
    },
    {
      side: "bottom",
      ball: { x: 0.08, y: 1 - ARENA_EDGE - BALL_RADIUS.y - 0.001, vx: 0, vy: 0.92 },
      inward: (ball) => ball.vy < 0 && ball.y === 1 - ARENA_EDGE - BALL_RADIUS.y,
    },
  ];

  for (const entry of cases) {
    const ball = { ...entry.ball, lastHit: null };
    const result = advanceArenaBall(ball, { [entry.side]: paddle(entry.side) }, 1 / 120);
    assert.equal(result.goal, null, `${entry.side} wall must not score`);
    assert.deepEqual(result.wallSides, [entry.side]);
    assert.ok(entry.inward(ball), `${entry.side} wall must clamp and reflect inward`);
  }
});

test("long fixed-step simulations stay finite and bounded until a goal", () => {
  let seed = 0x51a7cafe;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  const paddles = Object.fromEntries(["left", "top", "right", "bottom"].map((side) => [
    side,
    paddle(side, 0.5),
  ]));

  for (let run = 0; run < 80; run += 1) {
    const angle = random() * Math.PI * 2;
    const speed = 0.42 + random() * (MAX_BALL_SPEED - 0.42);
    const ball = {
      x: 0.2 + random() * 0.6,
      y: 0.2 + random() * 0.6,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      lastHit: null,
    };
    for (let step = 0; step < 2400; step += 1) {
      const result = advanceArenaBall(ball, paddles, 1 / 120);
      assert.ok([ball.x, ball.y, ball.vx, ball.vy].every(Number.isFinite));
      assert.ok(Math.hypot(ball.vx, ball.vy) <= MAX_BALL_SPEED + 1e-9);
      if (result.goal) break;
      assert.ok(ball.x >= ARENA_EDGE - BALL_RADIUS.x - 1e-9);
      assert.ok(ball.x <= 1 - ARENA_EDGE + BALL_RADIUS.x + 1e-9);
      assert.ok(ball.y >= ARENA_EDGE - BALL_RADIUS.y - 1e-9);
      assert.ok(ball.y <= 1 - ARENA_EDGE + BALL_RADIUS.y + 1e-9);
    }
  }
});
