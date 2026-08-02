// Copies non-TypeScript assets into dist after `tsc`, since tsc only emits JS.
// Currently just the versioned pricing table the loader reads at runtime.
import { mkdirSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const assets = [["src/pricing/pricing.json", "dist/pricing/pricing.json"]];

for (const [from, to] of assets) {
  const dest = join(root, to);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(join(root, from), dest);
  console.log(`copied ${from} -> ${to}`);
}
