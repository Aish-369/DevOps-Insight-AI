import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isPatchedViteVersion } from "./viteVersionPolicy.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const lockPath = path.resolve(here, "../package-lock.json");
const lock = JSON.parse(await readFile(lockPath, "utf8"));
const version = lock.packages?.["node_modules/vite"]?.version;

if (!version) {
  console.error("Security check failed: Vite was not found in frontend/package-lock.json.");
  process.exitCode = 1;
} else if (!isPatchedViteVersion(version)) {
  console.error(`Security check failed: locked Vite ${version} is below the stable patched floor 8.3.7 for GHSA-p4f5-76q4-ffq7. Prereleases do not pass this gate.`);
  process.exitCode = 1;
} else {
  console.log(`Security check passed: stable Vite ${version} is at or above 8.3.7.`);
}
