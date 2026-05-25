import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const srcDir = join(root, "src");
const distDir = join(root, "dist");

async function copyTextFile(filename) {
  const content = await readFile(join(srcDir, filename), "utf8");
  await writeFile(join(distDir, filename), content);
}

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });
await copyTextFile("index.html");
await copyTextFile("styles.css");
await copyTextFile("app.mjs");
await copyTextFile("theme-data.mjs");
