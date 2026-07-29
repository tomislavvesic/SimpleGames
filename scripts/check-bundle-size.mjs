import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { dirname, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GAME_CATALOG } from "../src/app/game-catalog.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const baseline = JSON.parse(
  await readFile(join(root, "docs", "bundle-baseline.json"), "utf8"),
);
const html = await readFile(join(dist, "index.html"), "utf8");

const assetPattern = /(?:src|href)="([^"]+\.(?:css|js))(?:\?[^"]*)?"/g;
const initialRelativePaths = [...html.matchAll(assetPattern)]
  .map((match) => decodeURIComponent(match[1]).replace(/^\/+/, ""))
  .filter((path, index, paths) => paths.indexOf(path) === index);

assert.ok(initialRelativePaths.length, "dist/index.html must load at least one CSS or JavaScript asset");

async function listAssets(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listAssets(path);
    return /\.(?:css|js)$/.test(entry.name) ? [path] : [];
  }));
  return nested.flat();
}

async function summarize(paths) {
  const uniquePaths = [...new Set(paths.map((path) => resolve(path)))];
  const files = await Promise.all(uniquePaths.map(async (path) => {
    const rel = relative(dist, path);
    assert.ok(rel && !rel.startsWith("..") && !normalize(rel).startsWith(`..${process.platform === "win32" ? "\\" : "/"}`), `Asset escaped dist: ${path}`);
    const bytes = await readFile(path);
    return {
      path: rel.replaceAll("\\", "/"),
      rawBytes: bytes.byteLength,
      gzipBytes: gzipSync(bytes).byteLength,
    };
  }));
  return {
    files,
    rawBytes: files.reduce((sum, file) => sum + file.rawBytes, 0),
    gzipBytes: files.reduce((sum, file) => sum + file.gzipBytes, 0),
  };
}

const initialPaths = initialRelativePaths.map((path) => join(dist, path));
await Promise.all(initialPaths.map((path) => stat(path)));
const initial = await summarize(initialPaths);
const all = await summarize(await listAssets(dist));
const initialSet = new Set(initial.files.map((file) => file.path));
const lazyFiles = all.files.filter((file) => !initialSet.has(file.path));

const percent = (current, previous) => ((current - previous) / previous) * 100;
const formatBytes = (bytes) => `${(bytes / 1024).toFixed(2)} KiB`;
const signedPercent = (value) => `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;

console.log("\nProduction bundle comparison");
console.table([
  {
    scope: "Initial page",
    raw: formatBytes(initial.rawBytes),
    "raw vs baseline": signedPercent(percent(initial.rawBytes, baseline.initial.rawBytes)),
    gzip: formatBytes(initial.gzipBytes),
    "gzip vs baseline": signedPercent(percent(initial.gzipBytes, baseline.initial.gzipBytes)),
  },
  {
    scope: "All JS/CSS",
    raw: formatBytes(all.rawBytes),
    "raw vs baseline": signedPercent(percent(all.rawBytes, baseline.all.rawBytes)),
    gzip: formatBytes(all.gzipBytes),
    "gzip vs baseline": signedPercent(percent(all.gzipBytes, baseline.all.gzipBytes)),
  },
]);
console.log(`Initial assets: ${initial.files.map((file) => file.path).join(", ")}`);
console.log(`Lazy assets: ${lazyFiles.map((file) => file.path).join(", ")}`);

assert.ok(
  lazyFiles.filter((file) => file.path.endsWith(".js")).length >= GAME_CATALOG.length,
  "Every registered game must emit a lazy JavaScript chunk",
);
assert.ok(
  lazyFiles.filter((file) => file.path.endsWith(".css")).length >= GAME_CATALOG.length,
  "Every registered game must emit a lazy CSS chunk",
);
if (baseline.limits.requireInitialReduction) {
  assert.ok(initial.rawBytes < baseline.initial.rawBytes, `Initial raw bundle must be smaller than ${baseline.initial.rawBytes} bytes`);
  assert.ok(initial.gzipBytes < baseline.initial.gzipBytes, `Initial gzip bundle must be smaller than ${baseline.initial.gzipBytes} bytes`);
}
const maxTotalBytes = baseline.all.rawBytes * (1 + baseline.limits.maxTotalGrowthPercent / 100);
assert.ok(
  all.rawBytes <= maxTotalBytes,
  `Total raw JS/CSS grew more than ${baseline.limits.maxTotalGrowthPercent}% (${all.rawBytes} > ${Math.floor(maxTotalBytes)} bytes)`,
);
