import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

/* Delivery-pipeline contract (AD-12) and deploy-config contract (AD-15). These
 * assert the two files no unit test would otherwise cover, because a static AWS
 * key or a missing environment gate is a security regression, not a bug. */

const REPO_ROOT = new URL("../../../", import.meta.url);

function readRepoFile(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, REPO_ROOT)), "utf8");
}

const WORKFLOW_TEXT = readRepoFile(".github/workflows/api-bedrock-ci.yml");
const SAMCONFIG_TEXT = readFileSync(
  fileURLToPath(new URL("../samconfig.toml", import.meta.url)),
  "utf8"
);

/* Comments are stripped before credential scanning: the workflow deliberately
 * *names* the static-key mechanism it supersedes, and a raw text scan would
 * match that rationale. */
const WORKFLOW_DIRECTIVES = WORKFLOW_TEXT.split("\n")
  .filter((line) => !line.trimStart().startsWith("#"))
  .join("\n");

/* A GitHub Actions workflow is an untyped document; this test is its boundary. */
/* eslint-disable @typescript-eslint/no-explicit-any */
const WORKFLOW = parse(WORKFLOW_TEXT) as any;
/* eslint-enable @typescript-eslint/no-explicit-any */

const VERIFY = WORKFLOW.jobs.verify;
const DEPLOY = WORKFLOW.jobs.deploy;

function stepNames(job: { steps: { name?: string; uses?: string }[] }): string[] {
  return job.steps.map((step) => step.name ?? step.uses ?? "");
}

function runCommands(job: { steps: { run?: string }[] }): string {
  return job.steps
    .map((step) => step.run ?? "")
    .join("\n");
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function matchesStep(entry: any, fragment: string): boolean {
  return `${entry.name ?? ""}\n${entry.uses ?? ""}`.includes(fragment);
}

/** Fails naming the step rather than throwing a bare TypeError on a renamed step. */
function step(job: { steps: any[] }, fragment: string): any {
  const found = job.steps.find((entry) => matchesStep(entry, fragment));
  expect(found, `no step matching "${fragment}"`).toBeDefined();
  return found;
}

/** Index of a step, for ordering assertions. */
function stepIndex(job: { steps: any[] }, fragment: string): number {
  const index = job.steps.findIndex((entry) => matchesStep(entry, fragment));
  expect(index, `no step matching "${fragment}"`).toBeGreaterThan(-1);
  return index;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

describe("AD-12 no long-lived AWS credentials", () => {
  it("never references a static AWS access key pair anywhere in the workflow", () => {
    expect(WORKFLOW_DIRECTIVES).not.toContain("AWS_ACCESS_KEY_ID");
    expect(WORKFLOW_DIRECTIVES).not.toContain("AWS_SECRET_ACCESS_KEY");
    expect(WORKFLOW_DIRECTIVES).not.toContain("AWS_SESSION_TOKEN");
    expect(WORKFLOW_DIRECTIVES).not.toContain("aws-access-key-id");
    expect(WORKFLOW_DIRECTIVES).not.toContain("aws-secret-access-key");
  });

  it("acquires credentials only through OIDC role assumption on v6 of the action", () => {
    const credentialStep = step(DEPLOY, "aws-actions/configure-aws-credentials");

    expect(credentialStep.uses).toBe("aws-actions/configure-aws-credentials@v6");
    expect(credentialStep.with["role-to-assume"]).toContain(
      "AWS_BEDROCK_DEPLOY_ROLE_ARN"
    );
    expect(credentialStep.with["aws-region"]).toBe("us-east-1");
  });

  it("requests id-token only for the deploy job and keeps the default read-only", () => {
    expect(WORKFLOW.permissions).toEqual({ contents: "read" });
    expect(DEPLOY.permissions).toEqual({
      "id-token": "write",
      contents: "read",
    });
    expect(VERIFY.permissions).toBeUndefined();
  });

  /* Local deployment is prohibited: GitHub Actions with OIDC is the only path that
   * may mutate the stack. */
  it("carries no local deploy path or static credential anywhere in the pipeline", () => {
    for (const forbidden of [
      "aws configure",
      "AWS_PROFILE",
      "credentials file",
      "~/.aws",
      "sam deploy --guided",
      "aws_access_key",
      "aws_secret_access_key",
    ]) {
      expect(WORKFLOW_DIRECTIVES.toLowerCase()).not.toContain(
        forbidden.toLowerCase()
      );
    }

    // The only credential acquisition is the OIDC role assumption.
    expect(
      WORKFLOW_DIRECTIVES.match(/configure-aws-credentials/g)
    ).toHaveLength(1);
  });

  it("removes the one-time static-key bootstrap workflow after success", () => {
    expect(
      existsSync(
        fileURLToPath(
          new URL(
            ".github/workflows/api-bedrock-oidc-bootstrap.yml",
            REPO_ROOT
          )
        )
      )
    ).toBe(false);
  });

  it("gives the verify job no AWS credentials at all", () => {
    const usesCredentials = VERIFY.steps.some((step: { uses?: string }) =>
      step.uses?.startsWith("aws-actions/configure-aws-credentials")
    );
    expect(usesCredentials).toBe(false);
  });
});

describe("AD-12 protected default-branch deployment", () => {
  it("gates deployment behind the protected production environment", () => {
    expect(DEPLOY.environment).toBe("production");
    expect(DEPLOY.needs).toBe("verify");
  });

  /* Cancelling `sam deploy` mid-flight abandons the stack in UPDATE_IN_PROGRESS,
   * which blocks every later deployment until an operator intervenes. */
  it("never cancels an in-flight deployment, while verification stays cancellable", () => {
    expect(WORKFLOW.concurrency["cancel-in-progress"]).toBe(true);
    expect(VERIFY.concurrency).toBeUndefined();

    expect(DEPLOY.concurrency).toEqual({
      group: "api-bedrock-deploy-production",
      "cancel-in-progress": false,
    });
    expect(DEPLOY.concurrency.group).not.toContain("github.ref");
  });

  it("uses unique temp files and resolves the API without the get-rest-apis pagination hazard", () => {
    const smoke = readRepoFile("apps/api-bedrock/scripts/smoke-test.sh");
    // Comments stripped: the script deliberately *names* the paginated call it
    // avoids, and a raw scan would match that rationale.
    const commands = smoke
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("#"))
      .join("\n");

    expect(commands).toContain("mktemp -d");
    expect(commands).toContain("trap cleanup EXIT");
    expect(commands).not.toContain("/tmp/smoke-body.json");

    // The paginated list call pages at 25; a name filter over page one would pass
    // vacuously on an account with more APIs than that.
    expect(commands).not.toContain("get-rest-apis");
    expect(commands).toContain("describe-stack-resource");
    expect(commands).toContain("--logical-resource-id HostedAiApi");

    // Failures stay explicit rather than being swallowed by an unset variable.
    expect(commands).toContain("set -euo pipefail");
    expect(commands).toContain("smoke test FAILED");
  });

  /* Deployment must be opt-in: merging deploy-capable source cannot deploy anything
   * until someone sets the variable. */
  it("skips the deploy job entirely unless the repository opts in", () => {
    expect(DEPLOY.if).toContain("vars.API_BEDROCK_DEPLOY_ENABLED == 'true'");
  });

  it("permits a default-branch push or a dispatch, and a dispatch only from master", () => {
    const triggers = WORKFLOW.on ?? WORKFLOW[true as never];
    expect(Object.keys(triggers)).toContain("workflow_dispatch");

    // The branch check sits outside the trigger check, so it constrains BOTH paths -
    // a dispatch from a feature branch is refused just like a push would be.
    expect(DEPLOY.if).toContain("github.event_name == 'workflow_dispatch'");
    expect(DEPLOY.if).toContain("refs/heads/master");
    expect(DEPLOY.if).toMatch(
      /\(github\.ref == 'refs\/heads\/master' \|\| github\.ref == 'refs\/heads\/main'\) &&/
    );
  });

  /* Two-role separation: the OIDC role drives CloudFormation, the execution role
   * creates the resources. Without --role-arn, CloudFormation would act with the
   * deploy role's own permissions, which deliberately cannot create anything. */
  it("hands CloudFormation the separate execution role", () => {
    const commands = runCommands(DEPLOY);

    expect(commands).toContain("--role-arn");
    expect(commands).toContain('"${CFN_EXEC_ROLE_ARN}"');
    expect(WORKFLOW_TEXT).toContain(
      "CFN_EXEC_ROLE_ARN: ${{ secrets.AWS_BEDROCK_CFN_EXEC_ROLE_ARN }}"
    );
  });

  it("uploads to the explicit bootstrap-owned bucket under a stable prefix", () => {
    const commands = runCommands(DEPLOY);

    expect(commands).toContain("--s3-bucket");
    expect(commands).toContain('"${SAM_ARTIFACT_BUCKET}"');
    expect(commands).toContain("--s3-prefix");
    expect(WORKFLOW_TEXT).toContain(
      "SAM_ARTIFACT_BUCKET: ${{ vars.SAM_ARTIFACT_BUCKET }}"
    );
    expect(WORKFLOW_TEXT).toContain("SAM_ARTIFACT_PREFIX: nixus-bedrock-api");
  });

  it("fails loudly rather than deploying with an unset role or bucket", () => {
    const commands = runCommands(DEPLOY);

    expect(commands).toContain('test -n "${CFN_EXEC_ROLE_ARN}"');
    expect(commands).toContain('test -n "${SAM_ARTIFACT_BUCKET}"');
  });

  /* SAM's managed bucket would be created outside the bootstrap stack, so it would
   * fall outside the deploy role's S3 policy and the bucket's own encryption,
   * versioning, and retention guarantees. */
  it("disables SAM's managed artifact bucket in samconfig", () => {
    expect(SAMCONFIG_TEXT).toContain("resolve_s3 = false");
    expect(SAMCONFIG_TEXT).not.toContain("resolve_s3 = true");
  });

  it("restricts deployment to default-branch pushes at both the trigger and the job", () => {
    expect(WORKFLOW.on.push.branches).toEqual(["master", "main"]);
    expect(WORKFLOW.on.pull_request.branches).toBeUndefined();
    expect(DEPLOY.if).toContain("github.event_name == 'push'");
    expect(DEPLOY.if).toContain("refs/heads/master");
    expect(DEPLOY.if).toContain("refs/heads/main");
  });

  it("never deploys on a pull request", () => {
    expect(WORKFLOW.on.pull_request.paths).toContain("apps/api-bedrock/**");
    expect(DEPLOY.if).not.toContain("pull_request");
  });
});

describe("verify job runs every prescribed check", () => {
  it("installs with a frozen lockfile and runs lint, typecheck, test, validate, build", () => {
    const commands = runCommands(VERIFY);

    expect(commands).toContain("pnpm install --frozen-lockfile");
    expect(commands).toContain("pnpm --filter @nixus/api-bedrock lint");
    expect(commands).toContain("pnpm --filter @nixus/api-bedrock typecheck");
    expect(commands).toContain("pnpm --filter @nixus/api-bedrock test");
    expect(commands).toContain("pnpm --filter @nixus/api-bedrock sam:validate");
    expect(commands).toContain("pnpm --filter @nixus/api-bedrock sam:build");
  });

  it("also verifies the shared contract both sides depend on", () => {
    const commands = runCommands(VERIFY);
    expect(commands).toContain("pnpm --filter @nixus/shared typecheck");
    expect(commands).toContain("pnpm --filter @nixus/shared test");
  });

  it("provisions the SAM CLI and Node 22 the service targets", () => {
    expect(stepNames(VERIFY)).toContain("Setup AWS SAM CLI");
    expect(step(VERIFY, "actions/setup-node").with["node-version"]).toBe(22);
  });
});

describe("deploy job proves deployed guarantees", () => {
  /* A first CREATE that fails lands in ROLLBACK_COMPLETE, which CloudFormation
   * cannot update - delete-and-recreate is the only path. It is safe for that state
   * alone, because such a stack has no successfully created resources to lose. */
  it("removes a failed initial stack only when it is exactly ROLLBACK_COMPLETE", () => {
    const commands = runCommands(DEPLOY);

    expect(commands).toContain("ROLLBACK_COMPLETE");
    expect(commands).toContain("cloudformation delete-stack");
    expect(commands).toContain("wait stack-delete-complete");

    // The delete must be reachable only through an exact equality test on that one
    // status - never a substring or pattern match that could catch a live stack.
    expect(commands).toMatch(/\[ "\$\{status\}" \] = "ROLLBACK_COMPLETE" \]|= "ROLLBACK_COMPLETE" \]/);
  });

  it("never deletes a stack in any other state, including other rollback states", () => {
    const commands = runCommands(DEPLOY);

    for (const untouchable of [
      "UPDATE_ROLLBACK_COMPLETE",
      "CREATE_COMPLETE",
      "UPDATE_COMPLETE",
      "ROLLBACK_FAILED",
      "DELETE_FAILED",
      "UPDATE_ROLLBACK_FAILED",
      "CREATE_IN_PROGRESS",
      "UPDATE_IN_PROGRESS",
    ]) {
      expect(commands, `${untouchable} must not be a delete trigger`).not.toContain(
        `"${untouchable}"`
      );
    }

    // Exactly one delete-stack call, and no force/recursive variants.
    expect(commands.match(/delete-stack/g)).toHaveLength(1);
    expect(commands).not.toContain("--retain-resources");
    expect(commands).not.toContain("delete-table");
  });

  it("treats an absent stack as nothing to remove rather than an error", () => {
    const commands = runCommands(DEPLOY);

    expect(commands).toContain("DOES_NOT_EXIST");
    expect(commands).toContain("|| echo");
  });

  /* A reservation of 0 and no reservation at all are opposite states that read almost
   * identically in a console: 0 throttles the function to zero concurrent executions,
   * while no reservation lets it use the account's shared pool. `--query` on a missing
   * field prints "None", so only an explicit key-absence check distinguishes them. */
  it("asserts the deployed function carries no reserved concurrency at all", () => {
    const script = step(DEPLOY, "no reserved concurrency").run as string;

    expect(script).toContain("lambda get-function-concurrency");
    expect(script).toContain('jq -e \'has("ReservedConcurrentExecutions")\'');
    expect(script).toContain("exit 1");

    // Querying the field directly is the mistake this replaces.
    expect(script).not.toContain("--query 'ReservedConcurrentExecutions'");

    expect(stepIndex(DEPLOY, "Deploy stack")).toBeLessThan(
      stepIndex(DEPLOY, "no reserved concurrency")
    );
  });

  /* The whole activation apparatus is gone, not merely defaulted off: a leftover
   * variable or a Service Quotas preflight would imply the quota increase is still a
   * rollout dependency, which the user waived. */
  it("carries no reservation parameter, variable, or quota preflight anywhere", () => {
    for (const removed of [
      "HOSTED_AI_RESERVED_CONCURRENCY",
      "HostedAiReservedConcurrency",
      "service-quotas",
      "L-B99A9384",
      "UNRESERVED_FLOOR",
      "get-account-settings",
    ]) {
      expect(WORKFLOW_TEXT, `${removed} must be gone`).not.toContain(removed);
    }

    expect(DEPLOY.env).not.toHaveProperty("HOSTED_AI_RESERVED_CONCURRENCY");
    expect(runCommands(DEPLOY)).not.toContain("HostedAiReservedConcurrency=");
  });

  /* The AD-8 token gate was proved against one model in one region; an active function
   * pointed anywhere else voids that evidence. Both the resolved outputs and the
   * function's own environment are checked, because a console edit moves only the latter. */
  it("asserts the deployed model and region on both the stack outputs and the Lambda env", () => {
    const script = step(DEPLOY, "Assert the deployed model and region").run as string;

    expect(script).toContain("BedrockModelIdEcho");
    expect(script).toContain("BedrockRegionEcho");
    expect(script).toContain("lambda get-function-configuration");
    expect(script).toContain(".BEDROCK_MODEL_ID");
    expect(script).toContain(".BEDROCK_REGION");

    for (const compared of [
      "stack output model",
      "lambda env model",
      "stack output region",
      "lambda env region",
    ]) {
      expect(script, `${compared} must be compared`).toContain(compared);
    }

    expect(script).toContain("${APPROVED_BEDROCK_MODEL_ID}");
    expect(script).toContain("${APPROVED_BEDROCK_REGION}");
    expect(script).toContain("check_equal");
    expect(script).not.toContain("for pair in");
    expect(script).not.toContain('actual="${rest%%:*}"');
    expect(script).toContain("exit 1");

    expect(stepIndex(DEPLOY, "Deploy stack")).toBeLessThan(
      stepIndex(DEPLOY, "Assert the deployed model and region")
    );
  });

  /* Two step-level copies of the same expression are how a deploy override and an
   * assertion end up disagreeing. One job-level definition makes that impossible. */
  it("pins the approved model and region once, at job level, as the assertion source", () => {
    const perStepCopies = (DEPLOY.steps as { env?: Record<string, unknown> }[]).filter(
      (entry) =>
        entry.env?.APPROVED_BEDROCK_MODEL_ID !== undefined ||
        entry.env?.APPROVED_BEDROCK_REGION !== undefined
    );
    expect(perStepCopies).toEqual([]);

    expect(DEPLOY.env.APPROVED_BEDROCK_MODEL_ID).toBe(
      "anthropic.claude-3-7-sonnet-20250219-v1:0"
    );
    expect(DEPLOY.env.APPROVED_BEDROCK_REGION).toBe("eu-west-2");
  });

  it("keeps the deployment non-cancelling while it mutates the stack", () => {
    expect(DEPLOY.concurrency["cancel-in-progress"]).toBe(false);
  });

  it("asserts the retained table keeps point-in-time recovery after every deploy", () => {
    const commands = runCommands(DEPLOY);
    expect(commands).toContain("describe-continuous-backups");
    expect(commands).toContain("ENABLED");
  });

  it("runs the deployed API smoke test", () => {
    const commands = runCommands(DEPLOY);
    expect(commands).toContain("scripts/smoke-test.sh");
  });

  it("passes every account-specific parameter in rather than committing it", () => {
    const commands = runCommands(DEPLOY);
    for (const parameter of [
      "CognitoUserPoolArn=",
      "CognitoUserPoolId=",
      "CognitoAppClientId=",
      "ApiDomainName=",
      "ApiCertificateArn=",
      "HostedZoneId=",
      "AlertEmail=",
    ]) {
      expect(commands, `missing override ${parameter}`).toContain(parameter);
    }
  });

  /* The direct foundation-model ARN is derived inside the template from the model id
   * and region, and a foundation-model ARN carries no account id - so there is nothing
   * account-specific left to pass, and the old profile secret must be gone rather than
   * lingering as an unused, misleading input. */
  it("passes no inference-profile parameter or secret any more", () => {
    for (const obsolete of [
      "BedrockInferenceProfileArn",
      "BedrockFoundationModelArnPattern",
      "BEDROCK_INFERENCE_PROFILE_ARN",
      "BEDROCK_FOUNDATION_MODEL_ARN_PATTERN",
      "inference-profile",
      "us.anthropic",
    ]) {
      expect(WORKFLOW_TEXT, `${obsolete} must be gone`).not.toContain(obsolete);
    }
  });

  /* CloudFormation preserves previous parameter values on UPDATE, so relying on a new
   * template default leaves the old inference profile in place. The only legal
   * overrides are the same job-level constants used by post-deploy assertions. */
  it("migrates and pins the Bedrock model and region to the approved pair", () => {
    const commands = runCommands(DEPLOY);

    expect(commands).toContain(
      '"BedrockModelId=${APPROVED_BEDROCK_MODEL_ID}"'
    );
    expect(commands).toContain('"BedrockRegion=${APPROVED_BEDROCK_REGION}"');
    expect(DEPLOY.env.APPROVED_BEDROCK_MODEL_ID).toBe(
      "anthropic.claude-3-7-sonnet-20250219-v1:0"
    );
    expect(DEPLOY.env.APPROVED_BEDROCK_REGION).toBe("eu-west-2");
  });
});

describe("AD-15 deploy configuration", () => {
  it("pins the single production stack name and region", () => {
    expect(SAMCONFIG_TEXT).toContain('stack_name = "nixus-bedrock-api"');
    expect(SAMCONFIG_TEXT).toContain('region = "us-east-1"');
  });

  it("keeps lint on for validate and never escalates to named IAM capabilities", () => {
    expect(SAMCONFIG_TEXT).toContain("lint = true");
    expect(SAMCONFIG_TEXT).toContain('capabilities = "CAPABILITY_IAM"');
    expect(SAMCONFIG_TEXT).not.toContain("CAPABILITY_NAMED_IAM");
    expect(SAMCONFIG_TEXT).not.toContain("CAPABILITY_AUTO_EXPAND");
  });

  it("declares no staging or second stack profile", () => {
    const profiles = [...SAMCONFIG_TEXT.matchAll(/^\[([^.\]]+)\./gm)].map(
      (match) => match[1]
    );
    expect([...new Set(profiles)]).toEqual(["default"]);
  });

  it("commits no account-specific parameter overrides", () => {
    expect(SAMCONFIG_TEXT).not.toMatch(/^parameter_overrides\s*=/m);
    expect(SAMCONFIG_TEXT).not.toContain("arn:aws");
  });
});
