import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Builds the Lambda Web Function deployment package.
 *
 * The runtime closure is taken from a real lockfile-resolved install, never from a
 * hand-written manifest: the spike found `h3-v2@2.0.1-rc.20` in the closure, an RC
 * that is no longer resolvable from the registry, so an `npm install` of a
 * hand-listed dependency set fails outright.
 *
 * It is then pruned to a transitive closure of the packages the built server
 * actually imports. The root set is VERIFIED rather than asserted: every bare
 * specifier in `dist/server` must be a Node builtin or one of the roots below, and
 * a new one fails this script instead of silently shipping a package that is not
 * there — or shipping 275 MB of build tooling, which exceeds Lambda's unzipped
 * size limit.
 */

const APP_ROOT = resolve(fileURLToPath(new URL("../", import.meta.url)));

/** Known at runtime by the built server; `client-ssm` is behind a dynamic import. */
const RUNTIME_ROOTS = [
  "srvx",
  "@aws-sdk/client-dynamodb",
  "@aws-sdk/lib-dynamodb",
  "@aws-sdk/client-ssm",
  "@tanstack/react-router",
  "react",
  "react-dom",
  "react-i18next",
  "i18next",
  "jose",
  // The shell's theme toggle and its icons. Server-rendered, so they are in the
  // SSR closure, not only the browser bundle.
  "next-themes",
  "lucide-react",
];

function run(command: string, args: string[], cwd: string): void {
  execFileSync(command, args, { cwd, stdio: "inherit" });
}

function jsFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) jsFiles(path, found);
    else if (entry.name.endsWith(".js")) found.push(path);
  }
  return found;
}

function packageOf(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? specifier);
}

/**
 * Bare specifiers in the built server.
 *
 * Line-anchored on purpose: a bundle inlines third-party source, and that source
 * contains the words `from "…"` inside strings and comments. Only a line that
 * STARTS with `import`/`export` is a module statement, plus `import("…")` for the
 * one dynamic import (the SSM client).
 */
function importedPackages(serverDir: string): Set<string> {
  const quoted = /["']([^"']+)["']/g;
  const dynamic = /\bimport\(\s*["']([^"']+)["']\s*\)/g;
  const names = new Set<string>();

  const add = (specifier: string | undefined): void => {
    if (specifier === undefined || specifier.startsWith(".") || specifier.startsWith("node:")) return;
    names.add(packageOf(specifier));
  };

  for (const file of jsFiles(serverDir)) {
    const text = readFileSync(file, "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trimStart();
      if (!/^(?:import|export)[\s{"'*]/.test(trimmed)) continue;
      for (const match of trimmed.matchAll(quoted)) add(match[1]);
    }
    for (const match of text.matchAll(dynamic)) add(match[1]);
  }
  return names;
}

function assertRootsCoverImports(serverDir: string): void {
  const unexpected = [...importedPackages(serverDir)].filter(
    (name) => !RUNTIME_ROOTS.includes(name),
  );
  if (unexpected.length > 0) {
    throw new Error(
      `dist/server imports packages missing from RUNTIME_ROOTS: ${unexpected.join(", ")}`,
    );
  }
}

function dependenciesOf(modulesDir: string, name: string): string[] {
  const manifestPath = join(modulesDir, name, "package.json");
  if (!existsSync(manifestPath)) return [];
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    dependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
  };
  return [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
  ];
}

function transitiveClosure(modulesDir: string): string[] {
  const kept = new Set<string>();
  const queue = [...RUNTIME_ROOTS];
  while (queue.length > 0) {
    const name = queue.pop();
    if (name === undefined || kept.has(name)) continue;
    if (!existsSync(join(modulesDir, name))) continue;
    kept.add(name);
    queue.push(...dependenciesOf(modulesDir, name));
  }
  return [...kept].sort();
}

function assertNoNativeBinaries(dir: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (entry.name.endsWith(".node")) {
      throw new Error(`native binary in the deployment package: ${entry.name}`);
    }
  }
}

function main(): void {
  const serverDir = join(APP_ROOT, "dist/server");
  if (!existsSync(serverDir)) throw new Error("run `pnpm build` first: dist/server is absent");
  assertRootsCoverImports(serverDir);

  const work = join(APP_ROOT, ".deploy");
  const stage = join(work, "stage");
  const bundle = join(work, "bundle");
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });

  run(
    "pnpm",
    ["--filter", "@nixus/account", "deploy", "--prod", "--legacy", "--config.node-linker=hoisted", stage],
    resolve(APP_ROOT, "../.."),
  );

  const stagedModules = join(stage, "node_modules");
  const kept = transitiveClosure(stagedModules);

  mkdirSync(join(bundle, "node_modules"), { recursive: true });
  for (const name of kept) {
    cpSync(join(stagedModules, name), join(bundle, "node_modules", name), {
      recursive: true,
      dereference: true,
    });
  }
  cpSync(serverDir, join(bundle, "server"), { recursive: true });
  cpSync(join(APP_ROOT, "lambda-entry.mjs"), join(bundle, "index.js"));
  // The wrapper is ESM, and Lambda loads `index.js` at the package root.
  writeFileSync(join(bundle, "package.json"), '{"type":"module"}\n');

  assertNoNativeBinaries(bundle);

  const zip = join(work, "app.zip");
  run("zip", ["-rq", zip, ".", "-x", "*.map"], bundle);

  const bytes = readFileSync(zip);
  const digest = createHash("sha256").update(bytes).digest("hex");
  writeFileSync(join(work, "app.zip.sha256"), `${digest}\n`);

  console.log(
    JSON.stringify({
      packages: kept.length,
      zip_bytes: statSync(zip).size,
      sha256: digest,
      key: `account-app/${digest}.zip`,
    }),
  );
}

main();
