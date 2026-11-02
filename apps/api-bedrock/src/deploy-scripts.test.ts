import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/*
 * The two deploy guards are shell, and what matters about a guard is which inputs it
 * REFUSES. A substring assertion over the script text proves only that a string is
 * present — it cannot show a nonzero exit, and it passes just as happily when a check is
 * present but inverted, unreachable, or swallowed by a missing `set -e`.
 *
 * So these run the real scripts, with a stubbed `aws` that serves fixtures and records
 * every call it receives. `jq` is the real one: it is the thing the scripts depend on for
 * parsing, and stubbing it would test a parser nobody ships.
 *
 * The call log is itself a security assertion: the pre-deploy guard must touch exactly
 * one read-only Bedrock API and nothing else, because the deploy role is granted exactly
 * that one action.
 */

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

const VALIDATE_SCRIPT = "apps/api-bedrock/scripts/validate-inference-profile.sh";
const ASSERT_SCRIPT = "apps/api-bedrock/scripts/assert-deployed-model-grant.sh";

const APPROVED_MODEL_ID = "us.anthropic.claude-sonnet-5-5";
const APPROVED_PATTERN =
  "arn:aws:bedrock:*::foundation-model/anthropic.claude-sonnet-5-5*";
const ACCOUNT = "123456789012";
const VALID_ARN = `arn:aws:bedrock:us-east-1:${ACCOUNT}:inference-profile/${APPROVED_MODEL_ID}`;
const DESTINATION =
  "arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-sonnet-5-5";

/** A healthy `get-inference-profile` response for the approved profile. */
function approvedProfile(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    inferenceProfileArn: VALID_ARN,
    inferenceProfileId: APPROVED_MODEL_ID,
    inferenceProfileName: APPROVED_MODEL_ID,
    status: "ACTIVE",
    type: "SYSTEM_DEFINED",
    models: [{ modelArn: DESTINATION }],
    ...overrides,
  });
}

function deployedParameters(
  profileArn: string,
  pattern: string | undefined
): string {
  const parameters = [
    { ParameterKey: "BedrockModelId", ParameterValue: APPROVED_MODEL_ID },
    { ParameterKey: "BedrockInferenceProfileArn", ParameterValue: profileArn },
  ];
  if (pattern !== undefined) {
    parameters.push({
      ParameterKey: "BedrockFoundationModelArnPattern",
      ParameterValue: pattern,
    });
  }
  return JSON.stringify(parameters);
}

type Outcome = {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly awsCalls: readonly string[];
};

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "nixus-deploy-scripts."));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

/**
 * Installs a stub `aws` that answers only the two calls these scripts are allowed to
 * make, logs every invocation, and exits 64 on anything else — so an added call shows up
 * as a failure rather than as a silent network dependency.
 */
function runScript(
  script: string,
  options: {
    readonly env?: Record<string, string | undefined>;
    readonly profileJson?: string;
    readonly profileError?: string;
    readonly parametersJson?: string;
  } = {}
): Outcome {
  const binDir = join(workDir, "bin");
  const logPath = join(workDir, "aws-calls.log");
  const profilePath = join(workDir, "profile.json");
  const parametersPath = join(workDir, "parameters.json");

  execFileSync("mkdir", ["-p", binDir]);
  writeFileSync(profilePath, options.profileJson ?? approvedProfile());
  writeFileSync(
    parametersPath,
    options.parametersJson ?? deployedParameters(VALID_ARN, APPROVED_PATTERN)
  );

  const stub = [
    "#!/usr/bin/env bash",
    'printf "%s\\n" "$*" >> "${STUB_CALL_LOG}"',
    'case "$1 $2" in',
    '  "bedrock get-inference-profile")',
    '    if [ -n "${STUB_PROFILE_ERROR:-}" ]; then',
    '      printf "%s\\n" "${STUB_PROFILE_ERROR}" >&2',
    "      exit 255",
    "    fi",
    '    cat "${STUB_PROFILE_FILE}"',
    "    ;;",
    '  "cloudformation describe-stacks")',
    '    cat "${STUB_PARAMETERS_FILE}"',
    "    ;;",
    "  *)",
    '    printf "stub refused an unexpected aws call: %s\\n" "$*" >&2',
    "    exit 64",
    "    ;;",
    "esac",
  ].join("\n");

  const stubPath = join(binDir, "aws");
  writeFileSync(stubPath, `${stub}\n`);
  chmodSync(stubPath, 0o755);

  const result = spawnSync("bash", [script], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: {
      PATH: `${binDir}:${process.env.PATH ?? ""}`,
      HOME: workDir,
      TMPDIR: workDir,
      STUB_CALL_LOG: logPath,
      STUB_PROFILE_FILE: profilePath,
      STUB_PARAMETERS_FILE: parametersPath,
      ...(options.profileError === undefined
        ? {}
        : { STUB_PROFILE_ERROR: options.profileError }),
      APPROVED_BEDROCK_MODEL_ID: APPROVED_MODEL_ID,
      APPROVED_BEDROCK_FOUNDATION_MODEL_ARN_PATTERN: APPROVED_PATTERN,
      BEDROCK_INFERENCE_PROFILE_ARN: VALID_ARN,
      ...options.env,
    },
  });

  const awsCalls = spawnSync("cat", [logPath], { encoding: "utf8" })
    .stdout.split("\n")
    .filter((line) => line.length > 0);

  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    awsCalls,
  };
}

describe("the test harness has the tools it claims to exercise", () => {
  it("has a real bash and a real jq on PATH", () => {
    expect(spawnSync("bash", ["--version"]).status).toBe(0);
    expect(spawnSync("jq", ["--version"]).status).toBe(0);
  });
});

describe("validate-inference-profile.sh accepts only the approved profile", () => {
  it("exits zero for the approved, ACTIVE, system-defined profile", () => {
    const outcome = runScript(VALIDATE_SCRIPT);

    expect(outcome.stderr).toBe("");
    expect(outcome.status).toBe(0);
    expect(outcome.stdout).toContain("profile_validated=true");
    expect(outcome.stdout).toContain("destinations=1");
  });

  /* The whole point of resolving the EXACT supplied ARN: the public model id would
   * resolve for a secret naming another account's profile. */
  it("resolves the exact supplied ARN, not the public model id", () => {
    const outcome = runScript(VALIDATE_SCRIPT);

    expect(outcome.awsCalls).toHaveLength(1);
    expect(outcome.awsCalls[0]).toContain(
      `--inference-profile-identifier ${VALID_ARN}`
    );
    expect(outcome.awsCalls[0]).not.toContain(
      `--inference-profile-identifier ${APPROVED_MODEL_ID} `
    );
    expect(outcome.awsCalls[0]).toContain("--region us-east-1");
  });

  /* The deploy role holds exactly one Bedrock action. A second call here would be a
   * permission this pipeline is not supposed to need. */
  it("makes exactly one read-only Bedrock call and nothing else", () => {
    const { awsCalls } = runScript(VALIDATE_SCRIPT);

    expect(awsCalls).toHaveLength(1);
    expect(awsCalls[0]).toMatch(/^bedrock get-inference-profile /);
    for (const forbidden of [
      "invoke",
      "converse",
      "list-inference-profiles",
      "put-",
      "delete-",
      "create-",
      "count-tokens",
    ]) {
      expect(awsCalls.join("\n"), `must not call ${forbidden}`).not.toContain(
        forbidden
      );
    }
  });

  it("exits nonzero when the profile secret is unset or empty", () => {
    for (const value of [undefined, ""]) {
      const outcome = runScript(VALIDATE_SCRIPT, {
        env: { BEDROCK_INFERENCE_PROFILE_ARN: value },
      });

      expect(outcome.status).not.toBe(0);
      expect(outcome.stderr).toContain("BEDROCK_INFERENCE_PROFILE_ARN is not set");
      // Fails before the first AWS call, not on an authorization error.
      expect(outcome.awsCalls).toEqual([]);
    }
  });

  it("exits nonzero for an ARN outside us-east-1", () => {
    const outcome = runScript(VALIDATE_SCRIPT, {
      env: {
        BEDROCK_INFERENCE_PROFILE_ARN: VALID_ARN.replace("us-east-1", "us-west-2"),
      },
    });

    expect(outcome.status).not.toBe(0);
    expect(outcome.stderr).toContain("not a us-east-1 Bedrock inference-profile ARN");
    expect(outcome.awsCalls).toEqual([]);
  });

  /* An application inference profile has an operator-chosen id and can carry any
   * destination set, so it is refused outright rather than validated. */
  it("exits nonzero for an application-inference-profile ARN", () => {
    const outcome = runScript(VALIDATE_SCRIPT, {
      env: {
        BEDROCK_INFERENCE_PROFILE_ARN: `arn:aws:bedrock:us-east-1:${ACCOUNT}:application-inference-profile/${APPROVED_MODEL_ID}`,
      },
    });

    expect(outcome.status).not.toBe(0);
    expect(outcome.stderr).toContain("application inference profile");
    expect(outcome.awsCalls).toEqual([]);
  });

  it("exits nonzero when the ARN does not end in exactly the approved profile id", () => {
    for (const tail of [
      "us.anthropic.claude-sonnet-4-6",
      `${APPROVED_MODEL_ID}-preview`,
      "us.anthropic.claude-opus-5",
    ]) {
      const outcome = runScript(VALIDATE_SCRIPT, {
        env: {
          BEDROCK_INFERENCE_PROFILE_ARN: `arn:aws:bedrock:us-east-1:${ACCOUNT}:inference-profile/${tail}`,
        },
      });

      expect(outcome.status, tail).not.toBe(0);
      expect(outcome.awsCalls, tail).toEqual([]);
    }
  });

  it("exits nonzero and redacts the ARN and account when the lookup fails", () => {
    const outcome = runScript(VALIDATE_SCRIPT, {
      profileError: `ResourceNotFoundException: no profile ${VALID_ARN} in account ${ACCOUNT}`,
    });

    expect(outcome.status).not.toBe(0);
    expect(outcome.stderr).toContain("<redacted-profile-arn>");
    expect(outcome.stderr).not.toContain(VALID_ARN);
    expect(outcome.stderr).not.toContain(ACCOUNT);
  });

  it("exits nonzero when the resolved ARN is not the ARN supplied", () => {
    const outcome = runScript(VALIDATE_SCRIPT, {
      profileJson: approvedProfile({
        inferenceProfileArn: `arn:aws:bedrock:us-east-1:999999999999:inference-profile/${APPROVED_MODEL_ID}`,
      }),
    });

    expect(outcome.status).not.toBe(0);
    expect(outcome.stderr).toContain("not the ARN that was supplied");
  });

  it("exits nonzero when the profile resolves to a different id", () => {
    const outcome = runScript(VALIDATE_SCRIPT, {
      profileJson: approvedProfile({ inferenceProfileId: "us.anthropic.claude-opus-5" }),
    });

    expect(outcome.status).not.toBe(0);
    expect(outcome.stderr).toContain("expected 'us.anthropic.claude-sonnet-5-5'");
  });

  it("exits nonzero for a non-ACTIVE status", () => {
    for (const status of ["INACTIVE", ""]) {
      const outcome = runScript(VALIDATE_SCRIPT, {
        profileJson: approvedProfile({ status }),
      });

      expect(outcome.status, status).not.toBe(0);
      expect(outcome.stderr, status).toContain("expected ACTIVE");
    }
  });

  it("exits nonzero for an APPLICATION profile type in the response", () => {
    const outcome = runScript(VALIDATE_SCRIPT, {
      profileJson: approvedProfile({ type: "APPLICATION" }),
    });

    expect(outcome.status).not.toBe(0);
    expect(outcome.stderr).toContain("expected SYSTEM_DEFINED");
  });

  it("exits nonzero for an empty or absent destination list", () => {
    for (const models of [[], undefined]) {
      const outcome = runScript(VALIDATE_SCRIPT, {
        profileJson:
          models === undefined
            ? JSON.stringify({
                inferenceProfileArn: VALID_ARN,
                inferenceProfileId: APPROVED_MODEL_ID,
                status: "ACTIVE",
                type: "SYSTEM_DEFINED",
              })
            : approvedProfile({ models }),
      });

      expect(outcome.status, String(models)).not.toBe(0);
      expect(outcome.stderr, String(models)).toContain(
        "declares no destination models"
      );
    }
  });

  /* A destination entry with no modelArn is not a harmless gap: it is a route this
   * check cannot see, so it cannot be treated as covered by the grant. */
  it("exits nonzero when any destination entry carries no modelArn", () => {
    const outcome = runScript(VALIDATE_SCRIPT, {
      profileJson: approvedProfile({
        models: [{ modelArn: DESTINATION }, { modelArn: "" }, {}],
      }),
    });

    expect(outcome.status).not.toBe(0);
    expect(outcome.stderr).toContain("carry a modelArn");
  });

  it("exits nonzero when any destination is outside the approved pattern", () => {
    const outcome = runScript(VALIDATE_SCRIPT, {
      profileJson: approvedProfile({
        models: [
          { modelArn: DESTINATION },
          {
            modelArn:
              "arn:aws:bedrock:us-west-2::foundation-model/anthropic.claude-sonnet-4-6",
          },
        ],
      }),
    });

    expect(outcome.status).not.toBe(0);
    expect(outcome.stderr).toContain("outside the approved pattern");
  });

  /* A malformed pattern would derive an empty destination prefix that matches every
   * ARN, turning the strictest check in the script into a no-op. */
  it("exits nonzero for a destination pattern that names no foundation model", () => {
    for (const pattern of ["", "arn:aws:bedrock:*::inference-profile/us.anthropic.*"]) {
      const outcome = runScript(VALIDATE_SCRIPT, {
        env: { APPROVED_BEDROCK_FOUNDATION_MODEL_ARN_PATTERN: pattern },
      });

      expect(outcome.status, pattern).not.toBe(0);
      expect(outcome.awsCalls, pattern).toEqual([]);
    }
  });

  it("never prints the profile ARN or the account id on the success path", () => {
    const outcome = runScript(VALIDATE_SCRIPT);

    for (const stream of [outcome.stdout, outcome.stderr]) {
      expect(stream).not.toContain(VALID_ARN);
      expect(stream).not.toContain(ACCOUNT);
    }
  });

  /* A leftover capture of the CLI's stderr is an account-bearing file on the runner. */
  it("removes its temporary capture directory on both paths", () => {
    for (const options of [{}, { profileError: "boom" }]) {
      runScript(VALIDATE_SCRIPT, options);
      const leftovers = spawnSync(
        "bash",
        ["-c", `ls -d "${workDir}"/nixus-profile-validate.* 2>/dev/null || true`],
        { encoding: "utf8" }
      );
      expect(leftovers.stdout.trim()).toBe("");
    }
  });
});

describe("assert-deployed-model-grant.sh compares deployed parameters to the inputs", () => {
  it("exits zero when both model-bearing parameters match", () => {
    const outcome = runScript(ASSERT_SCRIPT);

    expect(outcome.stderr).toBe("");
    expect(outcome.status).toBe(0);
    expect(outcome.stdout).toContain("iam_grant_matches_approved_model=true");
  });

  it("exits nonzero when the deployed profile ARN is not the validated secret", () => {
    const outcome = runScript(ASSERT_SCRIPT, {
      parametersJson: deployedParameters(
        `arn:aws:bedrock:us-east-1:999999999999:inference-profile/${APPROVED_MODEL_ID}`,
        APPROVED_PATTERN
      ),
    });

    expect(outcome.status).not.toBe(0);
    expect(outcome.stderr).toContain("not the validated secret");
  });

  /* CloudFormation preserving a superseded destination pattern is the exact failure this
   * step exists to catch: the model env would be right and the IAM grant still wrong. */
  it("exits nonzero when the deployed destination pattern is the superseded one", () => {
    const outcome = runScript(ASSERT_SCRIPT, {
      parametersJson: deployedParameters(
        VALID_ARN,
        "arn:aws:bedrock:*::foundation-model/anthropic.claude-sonnet-4-6*"
      ),
    });

    expect(outcome.status).not.toBe(0);
    expect(outcome.stderr).toContain("deployed destination pattern");
  });

  it("exits nonzero when a model-bearing parameter is absent from the stack", () => {
    const outcome = runScript(ASSERT_SCRIPT, {
      parametersJson: deployedParameters(VALID_ARN, undefined),
    });

    expect(outcome.status).not.toBe(0);
    expect(outcome.stderr).toContain("deployed destination pattern");
  });

  it("exits nonzero when the profile secret is unset", () => {
    const outcome = runScript(ASSERT_SCRIPT, {
      env: { BEDROCK_INFERENCE_PROFILE_ARN: undefined },
    });

    expect(outcome.status).not.toBe(0);
    expect(outcome.stderr).toContain("BEDROCK_INFERENCE_PROFILE_ARN is not set");
    expect(outcome.awsCalls).toEqual([]);
  });

  it("never prints the deployed profile ARN or the account id", () => {
    for (const parametersJson of [
      deployedParameters(VALID_ARN, APPROVED_PATTERN),
      deployedParameters(
        `arn:aws:bedrock:us-east-1:${ACCOUNT}:inference-profile/${APPROVED_MODEL_ID}`,
        "arn:aws:bedrock:*::foundation-model/anthropic.claude-sonnet-4-6*"
      ),
    ]) {
      const outcome = runScript(ASSERT_SCRIPT, { parametersJson });
      for (const stream of [outcome.stdout, outcome.stderr]) {
        expect(stream).not.toContain(VALID_ARN);
        expect(stream).not.toContain(ACCOUNT);
      }
    }
  });

  it("reads the stack's deployed parameters and makes no other AWS call", () => {
    const { awsCalls } = runScript(ASSERT_SCRIPT);

    expect(awsCalls).toHaveLength(1);
    expect(awsCalls[0]).toContain("cloudformation describe-stacks");
    expect(awsCalls[0]).toContain("Stacks[0].Parameters");
    // Scoped to the service word, not a substring: the stack is *named* nixus-bedrock-api.
    expect(awsCalls[0]).not.toMatch(/^bedrock /);
  });
});
