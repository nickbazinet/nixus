import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/*
 * The model identity is spread across a template, a workflow, a bootstrap stack, two
 * deploy scripts, a Rust constant, and four documents an operator or an agent acts on.
 * Each has its own test, and each would still pass if the others were left behind —
 * which is how "we switched the model" becomes a stack streaming one model while the IAM
 * grant, the runbook, and the desktop adapter name another.
 *
 * So this file does two things no per-file test can: it pins the ONE approved identity in
 * every live authority at once, and it scans the live tree for the superseded one with an
 * exemption list that is explicit, counted, and itself verified — a stale exemption fails
 * here rather than quietly widening the scan.
 */

const REPO_ROOT = new URL("../../../", import.meta.url);
const REPO_ROOT_PATH = fileURLToPath(REPO_ROOT);

const APPROVED_MODEL_ID = "us.anthropic.claude-sonnet-4-6";
const APPROVED_FOUNDATION_MODEL = "anthropic.claude-sonnet-4-6";
const APPROVED_DESTINATION_PATTERN =
  "arn:aws:bedrock:*::foundation-model/anthropic.claude-sonnet-4-6*";
const SUPERSEDED_MODEL_FRAGMENT = "claude-sonnet-5-5";

function read(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, REPO_ROOT)), "utf8");
}

/**
 * Files that must name the approved profile. Splitting them by consumer is not
 * cosmetic: the bare-foundation-model scan below applies only to the machine-consumed
 * half, because a prose sentence explaining that the bare id must never be invoked is
 * not itself an invocation.
 */
const MACHINE_AUTHORITIES = [
  "apps/api-bedrock/template.yaml",
  ".github/workflows/api-bedrock-ci.yml",
  "infra/bootstrap/github-oidc-deploy.yaml",
  "apps/api-bedrock/samconfig.toml",
  "apps/desktop/src-tauri/src/ai/backend.rs",
] as const;

/* Machine-consumed, but they derive the identity from the environment rather than naming
 * it — so they are scanned for a bare foundation id and not pinned positively. */
const DEPLOY_SCRIPTS = [
  "apps/api-bedrock/scripts/validate-inference-profile.sh",
  "apps/api-bedrock/scripts/assert-deployed-model-grant.sh",
] as const;

const OPERATOR_AUTHORITIES = [
  "docs/project-context.md",
  "docs/runbooks/hosted-ai-rollout.md",
  "_bmad-output/planning-artifacts/architecture-cloud-bedrock.md",
  "_bmad-output/planning-artifacts/architecture/architecture-nixus-2026-08-25/ARCHITECTURE-SPINE.md",
] as const;

describe("every live authority names the one approved US Sonnet 4.6 profile", () => {
  it("pins the profile id in all nine identity authorities", () => {
    for (const path of [...MACHINE_AUTHORITIES, ...OPERATOR_AUTHORITIES]) {
      expect(read(path), `${path} must name ${APPROVED_MODEL_ID}`).toContain(
        APPROVED_MODEL_ID
      );
    }
    expect(MACHINE_AUTHORITIES.length + OPERATOR_AUTHORITIES.length).toBe(9);
  });

  /* The hosted stack's three model-bearing parameters: the id the code invokes, and the
   * two resources the IAM grant authorizes. All three have to move together. */
  it("pins the hosted template's id, profile ARN shape, and destination pattern", () => {
    const template = read("apps/api-bedrock/template.yaml");

    expect(template).toContain(`Default: ${APPROVED_MODEL_ID}`);
    expect(template).toContain(`- ${APPROVED_MODEL_ID}`);
    expect(template).toContain(APPROVED_DESTINATION_PATTERN);
    expect(template).toContain("bedrock:us-east-1:");
  });

  it("pins the workflow's approved model and destination pattern to 4.6", () => {
    const workflow = read(".github/workflows/api-bedrock-ci.yml");

    expect(workflow).toContain(`APPROVED_BEDROCK_MODEL_ID: ${APPROVED_MODEL_ID}`);
    expect(workflow).toContain(
      `APPROVED_BEDROCK_FOUNDATION_MODEL_ARN_PATTERN: '${APPROVED_DESTINATION_PATTERN}'`
    );
  });

  it("pins the bootstrap read grant's approved model to 4.6", () => {
    const bootstrap = read("infra/bootstrap/github-oidc-deploy.yaml");

    expect(bootstrap).toContain(`Default: ${APPROVED_MODEL_ID}`);
    expect(bootstrap).toContain(`- ${APPROVED_MODEL_ID}`);
    expect(bootstrap).toContain("bedrock:GetInferenceProfile");
    expect(bootstrap).toContain("${ApprovedBedrockModelId}");
  });

  /* BYO Bedrock is a separate code path with its own constant, and a user on BYO is not
   * served by the hosted stack at all — so a hosted-only switch would leave half the
   * product on the superseded model with nothing failing. */
  it("pins the desktop BYO adapter's own constant to the same profile", () => {
    expect(read("apps/desktop/src-tauri/src/ai/backend.rs")).toContain(
      `const BEDROCK_MODEL_ID: &str = "${APPROVED_MODEL_ID}";`
    );
  });

  /* Both architecture authorities are current-state documents an agent reads before
   * changing anything; one left on the old identity is a future regression's source. */
  it("pins both architecture authorities and project context to 4.6", () => {
    for (const path of OPERATOR_AUTHORITIES) {
      const text = read(path);
      expect(text, `${path}`).toContain(APPROVED_MODEL_ID);
      expect(text, `${path} must state the 4.6 IAM destination`).toContain(
        `foundation-model/${APPROVED_FOUNDATION_MODEL}`
      );
    }
  });
});

/*
 * The unprefixed foundation model has no direct in-region on-demand endpoint: it is a
 * destination, never an invocation identity. Rather than exempt lines by vocabulary —
 * which blesses any sentence containing the right word — this permits the bare id only
 * in the two syntactic forms that are legitimately about a destination, judged by the
 * text IMMEDIATELY preceding each occurrence.
 */
const PERMITTED_PREFIXES = [
  "foundation-model/",
  "get-foundation-model --model-identifier ",
] as const;

function undocumentedBareIdLines(text: string): string[] {
  const offenders: string[] = [];

  for (const line of text.split("\n")) {
    let index = line.indexOf(APPROVED_FOUNDATION_MODEL);
    while (index >= 0) {
      const preceding = line.slice(0, index);
      const isProfileId = preceding.endsWith("us.");
      const isPermitted = PERMITTED_PREFIXES.some((prefix) =>
        preceding.endsWith(prefix)
      );
      if (!isProfileId && !isPermitted) offenders.push(line.trim());
      index = line.indexOf(APPROVED_FOUNDATION_MODEL, index + 1);
    }
  }

  return offenders;
}

describe("the bare foundation model is never bound as an invocation identity", () => {
  it("permits it only immediately after a destination ARN or a model-access lookup", () => {
    for (const path of [...MACHINE_AUTHORITIES, ...DEPLOY_SCRIPTS]) {
      expect(undocumentedBareIdLines(read(path)), `${path}`).toEqual([]);
    }
  });

  /* The check has to actually reject the shapes it claims to, or it is a tautology over
   * files that happen to be clean. */
  it("rejects every invocation-shaped binding of the bare id", () => {
    for (const forbidden of [
      `const BEDROCK_MODEL_ID: &str = "${APPROVED_FOUNDATION_MODEL}";`,
      `    Default: ${APPROVED_FOUNDATION_MODEL}`,
      `      - ${APPROVED_FOUNDATION_MODEL}`,
      `APPROVED_BEDROCK_MODEL_ID: ${APPROVED_FOUNDATION_MODEL}`,
      `aws bedrock-runtime converse --model-id ${APPROVED_FOUNDATION_MODEL}`,
      `--inference-profile-identifier ${APPROVED_FOUNDATION_MODEL}`,
      `process.env.BEDROCK_MODEL_ID = "${APPROVED_FOUNDATION_MODEL}"`,
    ]) {
      expect(
        undocumentedBareIdLines(forbidden),
        `must reject: ${forbidden}`
      ).toHaveLength(1);
    }
  });

  it("accepts the two documented destination forms and the profile id itself", () => {
    for (const permitted of [
      `                  - '${APPROVED_DESTINATION_PATTERN}'`,
      `arn:aws:bedrock:us-east-1::foundation-model/${APPROVED_FOUNDATION_MODEL}`,
      `aws bedrock get-foundation-model --model-identifier ${APPROVED_FOUNDATION_MODEL}`,
      `const BEDROCK_MODEL_ID: &str = "${APPROVED_MODEL_ID}";`,
    ]) {
      expect(
        undocumentedBareIdLines(permitted),
        `must accept: ${permitted}`
      ).toEqual([]);
    }
  });
});

/*
 * Bounded live-tree scan over TRACKED files only. `git ls-files` rather than a directory
 * walk is the load-bearing choice: a directory walk also reads whatever untracked scratch
 * work happens to sit under these roots, so the suite's result would depend on the
 * developer's working tree instead of on the commit.
 *
 * The architecture documents, historical specs, review snapshots, memlogs, and story
 * agent metadata are deliberately OUTSIDE the roots, because their 5.5 references are
 * dated records this change is forbidden to rewrite — the 2026-10-28 amendment that
 * adopted 5.5 is history even though 2026-11-02 rolled it back.
 */
const SCAN_ROOTS = ["apps", "packages", "infra", ".github", "docs"] as const;

const SCANNED_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".rs",
  ".yaml",
  ".yml",
  ".toml",
  ".json",
  ".md",
  ".sh",
] as const;

function gitLsFiles(args: readonly string[]): string[] {
  return execFileSync("git", ["ls-files", "-z", ...args], {
    cwd: REPO_ROOT_PATH,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  })
    .split("\0")
    .filter((path) => path.length > 0);
}

/**
 * Files inside the scan roots that may still name the superseded model, each for a
 * reason that is itself the point of the file. Every entry is asserted to still contain
 * the fragment, so an exemption left behind after its reason disappeared fails this
 * suite instead of silently blessing a real regression.
 */
const EXEMPTIONS: Readonly<Record<string, string>> = {
  "docs/runbooks/hosted-ai-rollout.md":
    "records that 5.5 was adopted on 2026-10-28 and rolled back on 2026-11-02 for zero account quota, which is the precondition an operator must clear before re-adopting it",
  "apps/api-bedrock/src/rollout-runbook.test.ts":
    "asserts that the dated 5.5 rollback record and its quota-increase precondition are still in the runbook",
  "apps/api-bedrock/src/template-scaffold.test.ts":
    "asserts the 5.5 model id and destination pattern are unselectable",
  "apps/api-bedrock/src/deploy-scripts.test.ts":
    "drives the deploy guards with a superseded 5.5 profile id and destination pattern to prove both are rejected",
  "apps/api-bedrock/src/model-identity.test.ts":
    "declares the fragment this scan searches for",
};

describe("no live file still resolves to the superseded model", () => {
  const scanned = gitLsFiles(["--", ...SCAN_ROOTS]).filter((path) =>
    SCANNED_EXTENSIONS.some((ext) => path.endsWith(ext))
  );

  /* A scan that found nothing would pass vacuously, which is the failure mode of every
   * path-based guard. Asserted against the committed authorities only: a file added in
   * the same change is legitimately not in the index yet, and demanding otherwise would
   * make the suite unrunnable until after a commit. */
  it("actually reaches the tracked live tree", () => {
    expect(scanned.length).toBeGreaterThan(50);
    for (const path of MACHINE_AUTHORITIES) {
      expect(scanned, `${path} must be tracked and scanned`).toContain(path);
    }
  });

  /* An untracked scratch file under docs/ or apps/ must not be able to fail — or pass —
   * this scan, because the commit is what gets reviewed, not the working tree. */
  it("reads no untracked file", () => {
    const tracked = new Set(gitLsFiles([]));

    for (const path of scanned) {
      expect(tracked.has(path), `${path} is not tracked`).toBe(true);
    }
  });

  it("finds the superseded model only in the explicitly exempt files", () => {
    const offenders = scanned.filter(
      (path) => read(path).includes(SUPERSEDED_MODEL_FRAGMENT) && !(path in EXEMPTIONS)
    );

    expect(offenders).toEqual([]);
  });

  it("counts the exemptions and proves each one is still needed", () => {
    expect(Object.keys(EXEMPTIONS)).toHaveLength(5);

    for (const [path, reason] of Object.entries(EXEMPTIONS)) {
      expect(reason.length, `${path} needs a stated reason`).toBeGreaterThan(20);
      expect(
        read(path),
        `${path} no longer names the superseded model; remove its exemption`
      ).toContain(SUPERSEDED_MODEL_FRAGMENT);
    }
  });
});
