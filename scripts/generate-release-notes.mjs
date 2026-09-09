#!/usr/bin/env node
/**
 * Generate categorized release notes from conventional-commit-style git log
 * between two refs (typically the previous tag and the new tag/HEAD).
 *
 * Usage:
 *   node scripts/generate-release-notes.mjs <fromRef> <toRef>
 *
 * If <fromRef> is omitted or empty, all history reachable from <toRef> is used
 * (first release). Prints markdown to stdout.
 */
import { execSync } from "node:child_process";

const [fromRef, toRef = "HEAD"] = process.argv.slice(2);

const range = fromRef ? `${fromRef}..${toRef}` : toRef;

const SEP = "\u0001";
const raw = execSync(
  `git log ${range} --no-merges --pretty=format:%s${SEP}%h`,
  { encoding: "utf8" },
).trim();

const lines = raw ? raw.split("\n") : [];

const CATEGORY_ORDER = [
  "feat",
  "fix",
  "perf",
  "refactor",
  "docs",
  "test",
  "build",
  "ci",
  "style",
  "chore",
  "other",
];

const CATEGORY_LABELS = {
  feat: "Features",
  fix: "Bug Fixes",
  perf: "Performance",
  refactor: "Refactors",
  docs: "Documentation",
  test: "Tests",
  build: "Build",
  ci: "CI",
  style: "Style",
  chore: "Chores",
  other: "Other Changes",
};

const COMMIT_RE = /^(\w+)(\(([^)]+)\))?!?:\s*(.+)$/;
const SKIP_RE = /^chore:\s*bump version to/i;

const buckets = new Map();

for (const line of lines) {
  const [subject, hash] = line.split(SEP);
  if (!subject || SKIP_RE.test(subject)) continue;

  const match = subject.match(COMMIT_RE);
  let type = "other";
  let scope = "";
  let desc = subject;

  if (match) {
    const rawType = match[1].toLowerCase();
    type = CATEGORY_ORDER.includes(rawType) ? rawType : "other";
    scope = match[3] || "";
    desc = match[4];
  }

  if (!buckets.has(type)) buckets.set(type, []);
  const scopePrefix = scope ? `**${scope}:** ` : "";
  buckets.get(type).push(`- ${scopePrefix}${desc} (${hash})`);
}

const sections = [];
for (const type of CATEGORY_ORDER) {
  const items = buckets.get(type);
  if (!items || items.length === 0) continue;
  sections.push(`### ${CATEGORY_LABELS[type]}\n\n${items.join("\n")}`);
}

const body =
  sections.length > 0
    ? sections.join("\n\n")
    : "No user-facing changes since the last release.";

process.stdout.write(body + "\n");
