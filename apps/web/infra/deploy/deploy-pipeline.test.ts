/**
 * Deploy-pipeline contract for the marketing site.
 *
 * A single `aws s3 sync --delete` is the mechanism behind a completely unstyled
 * page: the sync uploads the new build and deletes the previous fingerprinted
 * assets in one pass, while CloudFront is still handing out the *previous*
 * `index.html` from cache. That cached HTML references `/assets/main-<oldhash>.css`,
 * which no longer exists, so the browser renders the document with no stylesheet
 * at all — default serif text, blue links, an unbounded logo.
 *
 * Two independent things have to hold, so both are asserted here:
 *   1. Ordering — new assets must exist before any HTML claims them, and nothing
 *      may be deleted while an open tab or browser cache can still reference it.
 *   2. Cache headers — hashed assets immutable, HTML revalidated every time. S3
 *      objects have no Cache-Control unless the upload sets one, which is why
 *      production HTML was served with an ~56000s age and no policy.
 *
 * The workflow is parsed as text rather than YAML: `@nixus/web` does not depend
 * on a YAML parser, and the contract that actually matters is the ordered list of
 * shell commands the job runs.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Vitest roots at apps/web, so the workflow is two levels up from cwd.
const WORKFLOW_PATH = resolve(
  process.cwd(),
  "../../.github/workflows/web-ci.yml",
);

const WORKFLOW = readFileSync(WORKFLOW_PATH, "utf8");

/** Lines of the named job, up to the next job at the same indentation. */
function jobBody(name: string): string {
  const lines = WORKFLOW.split("\n");
  const start = lines.findIndex((line) => line.startsWith(`  ${name}:`));
  if (start === -1) throw new Error(`job "${name}" not found in web-ci.yml`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^ {2}\S/.test(line));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

/**
 * `KEY: value` pairs from the job's `env:` block.
 *
 * The commands reference the cache policies as `"$IMMUTABLE"` etc., so the
 * assertions have to resolve them or they would check the variable name and pass
 * regardless of the policy it holds.
 */
function jobEnv(job: string): Map<string, string> {
  const env = new Map<string, string>();
  const block = job.split(/^ {4}env:$/m)[1];
  if (block === undefined) return env;
  for (const line of block.split("\n")) {
    const match = /^ {6}([A-Z_]+):\s*(.*)$/.exec(line);
    if (match === null) {
      if (line.trim() !== "" && !/^ {6}/.test(line)) break;
      continue;
    }
    env.set(match[1], match[2].trim().replace(/^"(.*)"$/, "$1"));
  }
  return env;
}

/**
 * Effective `aws ...` invocations in the job, in execution order.
 *
 * Shell line continuations are folded first: every command here spans several
 * lines, and reading only the first one would silently drop the very flags under
 * test (`--include`, `--cache-control`, `--delete`).
 */
function awsCommands(job: string): string[] {
  const env = jobEnv(job);
  const folded = job
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => !line.startsWith("#"))
    .join("\n")
    .replace(/\\\n\s*/g, " ");

  return folded
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.includes("aws "))
    .map((line) =>
      line.replace(/"?\$\{?([A-Z_]+)\}?"?/g, (whole, name: string) =>
        env.has(name) ? (env.get(name) ?? whole) : whole,
      ),
    );
}

const DEPLOY = jobBody("deploy");
const COMMANDS = awsCommands(DEPLOY);

/** Index of the first command matching every supplied pattern. */
function indexOf(...patterns: RegExp[]): number {
  return COMMANDS.findIndex((command) =>
    patterns.every((pattern) => pattern.test(command)),
  );
}

/* Matched on `--include`, never on a bare mention: the media upload EXCLUDES
 * "*.html", so a loose /html/ pattern selects that step instead and asserts the
 * wrong command's cache policy. */
const UPLOADS_ASSETS = [/s3 sync/, /--include "assets\/\*"/] as const;
const UPLOADS_HTML = [/s3 sync/, /--include "\*\.html"/] as const;

describe("web deploy pipeline — publish ordering", () => {
  it("uploads fingerprinted assets before any HTML can reference them", () => {
    const assets = indexOf(...UPLOADS_ASSETS);
    const html = indexOf(...UPLOADS_HTML);

    expect(assets).toBeGreaterThanOrEqual(0);
    expect(html).toBeGreaterThanOrEqual(0);
    expect(assets).toBeLessThan(html);
  });

  it("keeps every publish additive so cached documents retain their assets", () => {
    const publishing = COMMANDS.filter(
      (command) => /s3 sync/.test(command) && !/--delete/.test(command),
    );
    const deleting = COMMANDS.filter((command) => /--delete/.test(command));

    expect(publishing.length).toBeGreaterThanOrEqual(2);
    expect(deleting).toEqual([]);
  });
});

describe("web deploy pipeline — cache policy", () => {
  it("marks fingerprinted assets immutable for a year", () => {
    const assets = COMMANDS[indexOf(...UPLOADS_ASSETS)];

    expect(assets).toMatch(/--cache-control/);
    expect(assets).toMatch(/max-age=31536000/);
    expect(assets).toMatch(/immutable/);
  });

  it("forbids caching HTML, so a deploy can never be served stale", () => {
    const html = COMMANDS[indexOf(...UPLOADS_HTML)];

    expect(html).toMatch(/--cache-control/);
    expect(html).toMatch(/no-cache|max-age=0/);
    expect(html).not.toMatch(/max-age=31536000/);
  });

  it("never leaves an upload without an explicit cache policy", () => {
    const uploadsWithoutPolicy = COMMANDS.filter(
      (command) =>
        /s3 sync/.test(command) &&
        !/--delete/.test(command) &&
        !/--cache-control/.test(command),
    );

    expect(uploadsWithoutPolicy).toEqual([]);
  });
});
