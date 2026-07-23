// Builds dist/koha-plugin-olorin-vX.Y.Z.kpz — a zip of the Koha/ tree, which
// is exactly what Koha's plugin upload expects. Refuses to build when a
// --tag argument disagrees with $VERSION in Olorin.pm (single source of
// truth).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const pm = fs.readFileSync(path.join(root, "Koha/Plugin/Com/OlorinAutoPrinter/Olorin.pm"), "utf8");

const versionMatch = pm.match(/our \$VERSION = "([^"]+)"/);
if (!versionMatch) {
  console.error("Could not find $VERSION in Olorin.pm");
  process.exit(1);
}
const version = versionMatch[1];

const tagIndex = process.argv.indexOf("--tag");
if (tagIndex !== -1) {
  const tag = process.argv[tagIndex + 1];
  if (tag !== `v${version}`) {
    console.error(`Tag ${tag} does not match the Olorin.pm VERSION ${version}`);
    process.exit(1);
  }
}

const distDir = path.join(root, "dist");
fs.rmSync(distDir, { recursive: true, force: true });
fs.mkdirSync(distDir);

const kpz = path.join(distDir, `koha-plugin-olorin-v${version}.kpz`);
execFileSync("zip", ["-r", "-q", kpz, "Koha"], { cwd: root });

console.log(`Built ${path.relative(root, kpz)}`);
