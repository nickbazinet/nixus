#!/usr/bin/env node
/**
 * Bump the Nixus desktop app version, preview categorized release notes,
 * then commit, tag, and push in one flow.
 *
 * Usage:
 *   node scripts/release.mjs patch      # 0.3.16 -> 0.3.17 (default)
 *   node scripts/release.mjs minor      # 0.3.16 -> 0.4.0
 *   node scripts/release.mjs major      # 0.3.16 -> 1.0.0
 *   node scripts/release.mjs 0.4.5      # explicit version
 *   node scripts/release.mjs patch --dry-run   # preview only, no changes
 *
 * Updates:
 *   - apps/desktop/package.json
 *   - apps/desktop/src-tauri/tauri.conf.json
 *   - apps/desktop/src-tauri/Cargo.toml
 * Then runs `cargo check` (via cargo metadata) so Cargo.lock picks up the
 * new version, commits everything, tags vX.Y.Z, and pushes commit + tag.
 *
 * The actual GitHub release notes are generated in CI (release.yml) from
 * the full commit range since the previous tag - this script only shows a
 * preview so you can sanity-check before pushing.
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const bumpArg = args.find((a) => !a.startsWith("--")) || "patch";

function run(cmd, opts = {}) {
  return execSync(cmd, { cwd: root, encoding: "utf8", ...opts });
}

function readJson(p) {
  return JSON.parse(readFileSync(p, "utf8"));
}

const pkgPath = path.join(root, "apps/desktop/package.json");
const tauriConfPath = path.join(root, "apps/desktop/src-tauri/tauri.conf.json");
const cargoTomlPath = path.join(root, "apps/desktop/src-tauri/Cargo.toml");

const currentVersion = readJson(tauriConfPath).version;
const [maj, min, pat] = currentVersion.split(".").map(Number);

let newVersion;
if (/^\d+\.\d+\.\d+$/.test(bumpArg)) {
  newVersion = bumpArg;
} else if (bumpArg === "major") {
  newVersion = `${maj + 1}.0.0`;
} else if (bumpArg === "minor") {
  newVersion = `${maj}.${min + 1}.0`;
} else if (bumpArg === "patch") {
  newVersion = `${maj}.${min}.${pat + 1}`;
} else {
  console.error(`Unknown bump type "${bumpArg}". Use major, minor, patch, or an explicit X.Y.Z.`);
  process.exit(1);
}

const tag = `v${newVersion}`;

const existingTags = run("git tag --list").split("\n");
if (existingTags.includes(tag)) {
  console.error(`Tag ${tag} already exists.`);
  process.exit(1);
}

const lastTag = run('git describe --tags --abbrev=0 2>/dev/null || true').trim();

console.log(`Current version: ${currentVersion}`);
console.log(`New version:     ${newVersion}`);
console.log(`Previous tag:    ${lastTag || "(none)"}`);
console.log("");
console.log("--- Release notes preview (also generated fresh in CI) ---");
const notesScript = path.join(__dirname, "generate-release-notes.mjs");
const notes = run(`node "${notesScript}" ${lastTag} HEAD`);
console.log(notes);
console.log("------------------------------------------------------------");

if (dryRun) {
  console.log("\nDry run - no files changed, nothing committed or pushed.");
  process.exit(0);
}

// 1. apps/desktop/package.json
const pkg = readJson(pkgPath);
pkg.version = newVersion;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

// 2. apps/desktop/src-tauri/tauri.conf.json
const tauriConf = readJson(tauriConfPath);
tauriConf.version = newVersion;
writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + "\n");

// 3. apps/desktop/src-tauri/Cargo.toml
let cargoToml = readFileSync(cargoTomlPath, "utf8");
cargoToml = cargoToml.replace(
  /^version = "[^"]+"/m,
  `version = "${newVersion}"`,
);
writeFileSync(cargoTomlPath, cargoToml);

console.log(`\nUpdated version to ${newVersion} in package.json, tauri.conf.json, Cargo.toml.`);

// Refresh Cargo.lock (must be committed alongside the bump per project rules)
try {
  run("cargo check --quiet --manifest-path apps/desktop/src-tauri/Cargo.toml");
} catch (e) {
  console.warn("Warning: `cargo check` failed to refresh Cargo.lock automatically. Run it manually before committing if needed.");
}

run(
  `git add apps/desktop/package.json apps/desktop/src-tauri/tauri.conf.json apps/desktop/src-tauri/Cargo.toml apps/desktop/src-tauri/Cargo.lock`,
);
run(`git commit -m "chore: bump version to ${newVersion}"`);
run(`git tag ${tag}`);

console.log(`\nCommitted and tagged ${tag}. Pushing...`);
run("git push");
run("git push --tags");

console.log(`\nDone. CI will build the release and attach categorized notes for ${tag}.`);
