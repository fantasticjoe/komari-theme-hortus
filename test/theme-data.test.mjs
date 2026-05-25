import test from "node:test";
import assert from "node:assert/strict";

import {
  THEME_STORAGE_KEY,
  formatBytes,
  formatBytesPerSecond,
  formatRelativeTime,
  getStoredTheme,
  normalizeNode,
  normalizeNodes,
} from "../src/theme-data.mjs";
import { readFile } from "node:fs/promises";

test("normalizes varied Komari node payloads into Hortus node view models", () => {
  const node = normalizeNode({
    uuid: "node-1",
    name: "ZJU Lab",
    group: "Research",
    region: "Hangzhou",
    online: true,
    updated_at: "2026-05-26T02:10:00.000Z",
    cpu: 38.5,
    memory: { used: 3 * 1024 ** 3, total: 8 * 1024 ** 3 },
    disk: { used: 21 * 1024 ** 3, total: 64 * 1024 ** 3 },
    network: { up: 1320, down: 524288 },
    load: [0.12, 0.24, 0.48],
  });

  assert.equal(node.id, "node-1");
  assert.equal(node.name, "ZJU Lab");
  assert.equal(node.group, "Research");
  assert.equal(node.region, "Hangzhou");
  assert.equal(node.online, true);
  assert.equal(node.cpu, 38.5);
  assert.equal(node.memory.used, 3 * 1024 ** 3);
  assert.equal(node.memory.total, 8 * 1024 ** 3);
  assert.equal(node.disk.percent, 32.81);
  assert.equal(node.network.up, 1320);
  assert.deepEqual(node.load, [0.12, 0.24, 0.48]);
});

test("normalizes nodes from object maps and websocket client arrays", () => {
  const nodes = normalizeNodes({
    alpha: { name: "Alpha", cpu: { percent: 12 }, mem_total: 100, mem_used: 25 },
    beta: { alias: "Beta", is_online: false, disk_total: 1000, disk_used: 100 },
  });

  assert.deepEqual(
    nodes.map((node) => [node.id, node.name, node.online, node.cpu]),
    [
      ["alpha", "Alpha", true, 12],
      ["beta", "Beta", false, 0],
    ],
  );
  assert.equal(nodes[0].memory.percent, 25);
  assert.equal(nodes[1].disk.percent, 10);
});

test("unwraps Komari API envelopes before normalizing node arrays", () => {
  const nodes = normalizeNodes({
    status: "success",
    message: "ok",
    data: [
      {
        uuid: "real-vps",
        name: "Tokyo VPS",
        region: "Tokyo",
        cpu: 22,
        memory: { used: 2 * 1024 ** 3, total: 8 * 1024 ** 3 },
      },
    ],
  });

  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].id, "real-vps");
  assert.equal(nodes[0].name, "Tokyo VPS");
  assert.equal(nodes[0].region, "Tokyo");
});

test("unwraps realtime envelopes without treating status or message as nodes", () => {
  const nodes = normalizeNodes({
    status: "success",
    message: "ok",
    data: {
      online: ["node-a"],
      data: {
        "node-a": { name: "Node A", cpu: 41 },
      },
    },
  });

  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].id, "node-a");
  assert.equal(nodes[0].online, true);
  assert.equal(nodes[0].cpu, 41);
});

test("does not turn non-node API metadata into cards", () => {
  const nodes = normalizeNodes({
    status: "success",
    message: "ok",
    data: [],
  });

  assert.deepEqual(nodes, []);
});

test("formats bytes, network rates, and relative times for dashboard display", () => {
  assert.equal(formatBytes(1536), "1.5 KB");
  assert.equal(formatBytes(3 * 1024 ** 3), "3 GB");
  assert.equal(formatBytesPerSecond(524288), "512 KB/s");
  assert.equal(formatRelativeTime("2026-05-26T02:09:15.000Z", new Date("2026-05-26T02:10:00.000Z")), "45s ago");
  assert.equal(formatRelativeTime("2026-05-26T01:05:00.000Z", new Date("2026-05-26T02:10:00.000Z")), "1h ago");
});

test("uses Komari appearance localStorage preference key", () => {
  const storage = new Map([[THEME_STORAGE_KEY, "dark"]]);
  const fakeStorage = {
    getItem: (key) => storage.get(key) ?? null,
  };

  assert.equal(THEME_STORAGE_KEY, "appearance");
  assert.equal(getStoredTheme(fakeStorage), "dark");
});

test("keeps metric and data surfaces on the sans UI font", async () => {
  const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

  for (const selector of [".summary-card strong", ".node-stats strong", ".nodes-table"]) {
    const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const rule = css.match(new RegExp(`${escapedSelector}\\s*\\{([\\s\\S]*?)\\}`));
    assert.ok(rule, `${selector} rule should exist`);
    assert.match(rule[1], /font-family:\s*var\(--font-ui\)/);
    assert.doesNotMatch(rule[1], /font-family:\s*var\(--font-display\)/);
  }
});

test("uses the blog banner image API behind a readability mask", async () => {
  const html = await readFile(new URL("../src/index.html", import.meta.url), "utf8");
  const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  const app = await readFile(new URL("../src/app.mjs", import.meta.url), "utf8");

  assert.match(html, /data-banner-background/);
  assert.match(css, /https:\/\/api\.dujin\.org\/bing\/1920\.php/);
  assert.match(css, /\.banner-background::after/);
  assert.match(css, /z-index:\s*0/);
  assert.match(css, /\.app-shell[\s\S]*z-index:\s*1/);
  assert.match(css, /backdrop-filter:\s*blur/);
  assert.match(app, /socket\.send\("get"\)/);
});
