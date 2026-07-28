export const FOUR_SIDES = ["left", "top", "right", "bottom"];
export const GOAL_HALF = { left: 0.27, right: 0.27, top: 0.185, bottom: 0.185 };
export const PADDLE_HALF = { left: 0.082, right: 0.082, top: 0.056, bottom: 0.056 };
export const ARENA_EDGE = 0.032;
export const BALL_RADIUS = { x: 0.009, y: 0.013 };
export const MIN_BALL_SPEED = 0.42;
export const MAX_BALL_SPEED = 0.92;

export function paddleFor(paddles, side) {
  const paddle = Array.isArray(paddles)
    ? paddles.find((candidate) => candidate.side === side)
    : paddles?.[side];
  return paddle && !paddle.eliminated ? paddle : null;
}

export function paddleBounds(side) {
  return {
    min: 0.5 - GOAL_HALF[side] + PADDLE_HALF[side],
    max: 0.5 + GOAL_HALF[side] - PADDLE_HALF[side],
  };
}

export function clampPaddle(side, position) {
  const { min, max } = paddleBounds(side);
  return Math.max(min, Math.min(max, position));
}

function alongRadius(side) {
  return side === "left" || side === "right" ? BALL_RADIUS.y : BALL_RADIUS.x;
}

function alongPosition(ball, side) {
  return side === "left" || side === "right" ? ball.y : ball.x;
}

function isMovingOutward(ball, side) {
  if (side === "left") return ball.vx < 0;
  if (side === "right") return ball.vx > 0;
  if (side === "top") return ball.vy < 0;
  return ball.vy > 0;
}

function reachedPlane(ball, side) {
  if (side === "left") return ball.x - BALL_RADIUS.x <= ARENA_EDGE;
  if (side === "right") return ball.x + BALL_RADIUS.x >= 1 - ARENA_EDGE;
  if (side === "top") return ball.y - BALL_RADIUS.y <= ARENA_EDGE;
  return ball.y + BALL_RADIUS.y >= 1 - ARENA_EDGE;
}

function fullyEnteredGoal(ball, side) {
  if (side === "left") return ball.x + BALL_RADIUS.x <= ARENA_EDGE;
  if (side === "right") return ball.x - BALL_RADIUS.x >= 1 - ARENA_EDGE;
  if (side === "top") return ball.y + BALL_RADIUS.y <= ARENA_EDGE;
  return ball.y - BALL_RADIUS.y >= 1 - ARENA_EDGE;
}

function insidePhysicalGoal(ball, side) {
  const safeHalf = Math.max(0, GOAL_HALF[side] - alongRadius(side));
  return Math.abs(alongPosition(ball, side) - 0.5) < safeHalf;
}

function placeInsideArena(ball, side) {
  if (side === "left") ball.x = ARENA_EDGE + BALL_RADIUS.x;
  if (side === "right") ball.x = 1 - ARENA_EDGE - BALL_RADIUS.x;
  if (side === "top") ball.y = ARENA_EDGE + BALL_RADIUS.y;
  if (side === "bottom") ball.y = 1 - ARENA_EDGE - BALL_RADIUS.y;
}

function reflectFromWall(ball, side) {
  placeInsideArena(ball, side);
  if (side === "left") ball.vx = Math.abs(ball.vx);
  if (side === "right") ball.vx = -Math.abs(ball.vx);
  if (side === "top") ball.vy = Math.abs(ball.vy);
  if (side === "bottom") ball.vy = -Math.abs(ball.vy);
}

function hitPaddle(ball, paddle, side) {
  const along = alongPosition(ball, side);
  if (Math.abs(along - paddle.pos) > PADDLE_HALF[side] + alongRadius(side)) return false;

  ball.lastHit = side;
  const offset = Math.max(-1, Math.min(1, (along - paddle.pos) / PADDLE_HALF[side]));
  const angle = offset * Math.PI * 0.36;
  const speed = Math.min(
    Math.max(MIN_BALL_SPEED, Math.hypot(ball.vx, ball.vy)) + 0.035 + Math.abs(offset) * 0.012,
    MAX_BALL_SPEED,
  );
  placeInsideArena(ball, side);
  if (side === "left") {
    ball.vx = Math.cos(angle) * speed;
    ball.vy = Math.sin(angle) * speed;
  } else if (side === "right") {
    ball.vx = -Math.cos(angle) * speed;
    ball.vy = Math.sin(angle) * speed;
  } else if (side === "top") {
    ball.vx = Math.sin(angle) * speed;
    ball.vy = Math.cos(angle) * speed;
  } else {
    ball.vx = Math.sin(angle) * speed;
    ball.vy = -Math.cos(angle) * speed;
  }
  return true;
}

/**
 * Resolve every arena boundary after a movement step.
 *
 * The paddle, wall, and goal all share the same contact plane. A miss is
 * registered as soon as the ball reaches that plane, preventing a late-moving
 * paddle from "saving" a ball which has already visibly crossed the goal.
 */
export function resolveArenaCollisions(ball, paddles) {
  const hitSides = [];
  const wallSides = [];
  if (ball.pendingGoal) {
    return {
      goal: fullyEnteredGoal(ball, ball.pendingGoal) ? ball.pendingGoal : null,
      hitSides,
      wallSides,
    };
  }

  for (const side of FOUR_SIDES) {
    if (!isMovingOutward(ball, side) || !reachedPlane(ball, side)) continue;
    const paddle = paddleFor(paddles, side);
    if (paddle && hitPaddle(ball, paddle, side)) hitSides.push(side);
  }

  for (const side of FOUR_SIDES) {
    if (!isMovingOutward(ball, side) || !reachedPlane(ball, side)) continue;
    const goal = paddleFor(paddles, side);
    if (!goal || !insidePhysicalGoal(ball, side)) {
      reflectFromWall(ball, side);
      wallSides.push(side);
    }
  }

  const missed = FOUR_SIDES.find((side) =>
    paddleFor(paddles, side)
    && isMovingOutward(ball, side)
    && reachedPlane(ball, side)
    && insidePhysicalGoal(ball, side)
  ) || null;
  if (missed) ball.pendingGoal = missed;

  return { goal: missed && fullyEnteredGoal(ball, missed) ? missed : null, hitSides, wallSides };
}

export function advanceArenaBall(ball, paddles, dt) {
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;
  return resolveArenaCollisions(ball, paddles);
}

export function reflectedCoordinate(value, min, max) {
  const range = max - min;
  if (!(range > 0)) return min;
  const period = range * 2;
  const offset = ((value - min) % period + period) % period;
  return offset <= range ? min + offset : max - (offset - range);
}

export function predictPaddleTarget(ball, side) {
  const vertical = side === "left" || side === "right";
  const toward = isMovingOutward(ball, side);
  if (!toward) return 0.5 + (alongPosition(ball, side) - 0.5) * 0.18;

  let travelTime = 0;
  if (side === "left") travelTime = (ball.x - ARENA_EDGE - BALL_RADIUS.x) / Math.max(-ball.vx, 0.001);
  if (side === "right") travelTime = (1 - ARENA_EDGE - BALL_RADIUS.x - ball.x) / Math.max(ball.vx, 0.001);
  if (side === "top") travelTime = (ball.y - ARENA_EDGE - BALL_RADIUS.y) / Math.max(-ball.vy, 0.001);
  if (side === "bottom") travelTime = (1 - ARENA_EDGE - BALL_RADIUS.y - ball.y) / Math.max(ball.vy, 0.001);

  const along = alongPosition(ball, side);
  const velocity = vertical ? ball.vy : ball.vx;
  const radius = vertical ? BALL_RADIUS.y : BALL_RADIUS.x;
  return reflectedCoordinate(
    along + velocity * Math.max(0, Math.min(travelTime, 1.5)),
    ARENA_EDGE + radius,
    1 - ARENA_EDGE - radius,
  );
}
