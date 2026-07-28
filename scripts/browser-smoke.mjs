import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";

const baseUrl = process.env.BROWSER_BASE_URL || "http://127.0.0.1:8791";
const edgeCandidates = [
  process.env.BROWSER_EXECUTABLE,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "/usr/bin/microsoft-edge",
  "/usr/bin/chromium",
  "/usr/bin/google-chrome",
  chromium.executablePath(),
].filter(Boolean);
const executablePath = edgeCandidates.find(existsSync);
assert.ok(executablePath, "Set BROWSER_EXECUTABLE to an installed Chromium-family browser");

if (process.env.BROWSER_SCREENSHOT_DIR) {
  mkdirSync(process.env.BROWSER_SCREENSHOT_DIR, { recursive: true });
}

async function verifyPage(browser, name, viewport) {
  const context = await browser.newContext({
    viewport,
    reducedMotion: "reduce",
    colorScheme: "dark",
  });
  const page = await context.newPage();
  const failures = [];
  page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !/fonts\.(googleapis|gstatic)\.com/.test(message.text())) {
      failures.push(`console: ${message.text()}`);
    }
  });

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts?.ready);
  assert.equal(await page.locator(".game-card").count(), 3);
  assert.equal(await page.getByRole("button", { name: /play now/i }).count(), 3);
  assert.equal(await page.locator("body").evaluate((body) => body.scrollWidth <= innerWidth + 1), true, `${name} landing overflows horizontally`);

  await page.locator(".sound-button").click();
  await page.locator(".profile-trigger").click();
  await page.locator(".profile-dialog").waitFor({ state: "visible" });
  assert.equal(await page.locator(".profile-trigger").getAttribute("aria-expanded"), "true");
  await page.locator('.profile-dialog input[name="nickname"]').fill(`${name} Player`);
  await page.locator(".profile-save").click();
  await page.locator(".profile-dialog").waitFor({ state: "hidden" });
  await page.locator(".profile-trigger").click();
  assert.equal(await page.locator('.profile-dialog input[name="nickname"]').inputValue(), `${name} Player`);
  await page.locator(".profile-close").click();

  await page.locator("[data-play]").click();
  const fourDialog = page.locator(".game-dialog");
  await fourDialog.waitFor({ state: "visible" });
  const fourBounds = await fourDialog.boundingBox();
  assert.ok(fourBounds.height <= viewport.height + 1, `${name} Four Sides dialog must fit the viewport`);
  const canvasBounds = await page.locator("#arena").boundingBox();
  assert.ok(canvasBounds.width > 0 && canvasBounds.height > 0);
  assert.ok(Math.abs(canvasBounds.width / canvasBounds.height - 900 / 620) < 0.08, `${name} arena aspect ratio is distorted`);
  await page.locator('[data-mode="teams"]').click();
  assert.equal(await page.locator('[data-mode="teams"]').getAttribute("aria-pressed"), "true");
  assert.equal(await page.locator('[data-mode="duel"]').getAttribute("aria-pressed"), "false");
  await page.locator(".close-game").click();
  await fourDialog.waitFor({ state: "hidden" });

  await page.locator("[data-play-signal]").click();
  const signalDialog = page.locator(".signal-dialog");
  await signalDialog.waitFor({ state: "visible" });
  await page.locator("[data-signal-name]").fill(`${name} Player`);
  await page.locator("[data-signal-code]").click();
  await page.keyboard.type("AB23CD");
  assert.equal(await page.locator("[data-signal-code]").inputValue(), "AB23CD");
  assert.equal(await signalDialog.evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth + 1), true, `${name} Signal Crew overflows`);
  await page.locator("[data-signal-close]").click();
  await signalDialog.waitFor({ state: "hidden" });

  await page.locator("[data-play-maze]").click();
  const mazeDialog = page.locator(".maze-dialog");
  await mazeDialog.waitFor({ state: "visible" });
  await page.waitForFunction(() => document.activeElement?.matches("[data-owo-overlay-primary]"));
  const mazeCanvas = page.locator("[data-owo-canvas]");
  const mazeBounds = await mazeCanvas.boundingBox();
  assert.ok(mazeBounds.width > 100 && mazeBounds.height > 100);
  assert.equal(await mazeDialog.evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth + 1), true, `${name} One Way Out overflows`);
  if (viewport.width <= 760) {
    const touchTargets = await page.locator("[data-owo-direction]").evaluateAll((buttons) =>
      buttons.map((button) => {
        const bounds = button.getBoundingClientRect();
        return { width: bounds.width, height: bounds.height };
      })
    );
    assert.ok(touchTargets.every(({ width, height }) => width >= 44 && height >= 44), `${name} maze touch targets are too small`);
  }
  await page.locator("[data-owo-overlay-primary]").click();
  await page.keyboard.press("ArrowRight");
  const timerBeforeStall = Number(await page.locator("[data-owo-clock]").getAttribute("aria-valuenow"));
  await page.evaluate(() => {
    const end = performance.now() + 1_200;
    while (performance.now() < end) {
      // Deliberately block one visible frame to verify the deadline-based clock.
    }
  });
  await page.waitForTimeout(50);
  const timerAfterStall = Number(await page.locator("[data-owo-clock]").getAttribute("aria-valuenow"));
  assert.ok(timerBeforeStall - timerAfterStall >= 3, `${name} maze timer slowed during a visible frame stall`);
  await page.locator("[data-owo-pause]").click();
  await page.waitForFunction(() => /paused/i.test(document.querySelector("[data-owo-live]")?.textContent || ""));
  assert.match(await page.locator("[data-owo-live]").textContent(), /paused/i);
  await page.locator("[data-owo-restart]").click();
  assert.equal(await page.locator("[data-owo-overlay-title]").textContent(), "Back to level one.");
  await page.locator("[data-owo-overlay-secondary]").click();
  assert.equal(await page.locator("[data-owo-overlay-title]").textContent(), "Catch your breath.");
  await page.locator("[data-owo-overlay-primary]").click();
  await page.locator("[data-owo-close]").click();
  await mazeDialog.waitFor({ state: "hidden" });
  const mazeProfileStats = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("simple-games-profile"))?.stats?.["one-way-out"]
  );
  assert.equal(mazeProfileStats.played, 1);
  assert.equal(mazeProfileStats.bestTimeMs, 0, "an abandoned run cannot become the best completion time");

  if (name === "desktop") {
    await page.locator("[data-play-maze]").click();
    await page.locator("[data-owo-overlay-primary]").click();
    await page.locator("[data-owo-restart]").click();
    await page.locator("[data-owo-overlay-primary]").click();
    assert.equal(await page.locator("[data-owo-overlay-title]").textContent(), "Ready to run?");
    await page.locator("[data-owo-overlay-primary]").click();
    await page.locator("[data-owo-close]").click();
    await page.evaluate(() => document.querySelector("[data-owo-close]").click());
    const repeatedRunStats = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("simple-games-profile")).stats["one-way-out"]
    );
    assert.equal(repeatedRunStats.played, 3, "restart and close must emit one result per run");
  }

  const unnamedButtons = await page.locator("button").evaluateAll((buttons) =>
    buttons.filter((button) => {
      if (button.closest("[inert]") || button.offsetParent === null) return false;
      return !(button.getAttribute("aria-label") || button.textContent.trim());
    }).length
  );
  assert.equal(unnamedButtons, 0, `${name} has a visible button without an accessible name`);
  assert.equal(await page.locator("body").evaluate((body) => body.scrollWidth <= innerWidth + 1), true, `${name} page overflows after dialogs`);

  if (process.env.BROWSER_SCREENSHOT_DIR) {
    await page.screenshot({
      path: join(process.env.BROWSER_SCREENSHOT_DIR, `${name}.png`),
      fullPage: true,
    });
  }
  assert.deepEqual(failures, [], `${name} emitted runtime errors`);
  await context.close();
}

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ["--disable-gpu"],
});

try {
  await verifyPage(browser, "desktop", { width: 1440, height: 1000 });
  await verifyPage(browser, "mobile", { width: 390, height: 844 });
  await verifyPage(browser, "compact", { width: 320, height: 700 });
  process.stdout.write("Browser smoke passed at desktop, mobile, and 320px compact viewports.\n");
} finally {
  await browser.close();
}
