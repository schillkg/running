import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("manifest is GitHub Pages-safe and installable", async () => {
  const manifest = JSON.parse(await fs.readFile(new URL("manifest.webmanifest", root), "utf8"));
  assert.equal(manifest.start_url.startsWith("./"), true);
  assert.equal(manifest.scope, "./");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.icons.some((icon) => icon.sizes === "192x192"), true);
  assert.equal(manifest.icons.some((icon) => icon.sizes === "512x512"), true);
});

test("every service-worker shell asset exists", async () => {
  const serviceWorker = await fs.readFile(new URL("sw.js", root), "utf8");
  const matches = [...serviceWorker.matchAll(/"\.\/(.*?)"/g)].map((match) => match[1]).filter(Boolean);
  for (const relative of new Set(matches)) {
    await assert.doesNotReject(() => fs.access(new URL(relative, root)), relative);
  }
});

test("public project does not contain the private starter backup", async () => {
  await assert.rejects(() => fs.access(new URL("My_Training_Private_Backup.json", root)));
});

test("public locations omit neighborhood-based drive estimates", async () => {
  const seed = JSON.parse(await fs.readFile(new URL("data/fall-creek-2026.json", root), "utf8"));
  assert.equal(seed.locations.length, 10);
  assert.equal(seed.locations.every((location) => location.drive === "Check map"), true);
  assert.doesNotMatch(JSON.stringify(seed.locations), /preferred drive|best nearby|easiest logistics|— closest/i);
});

test("service worker only cleans up caches owned by this app", async () => {
  const serviceWorker = await fs.readFile(new URL("sw.js", root), "utf8");
  assert.match(serviceWorker, /name\.startsWith\(CACHE_PREFIX\)/);
  assert.doesNotMatch(serviceWorker, /filter\(\(name\) => name !== CACHE_NAME\)/);
});
