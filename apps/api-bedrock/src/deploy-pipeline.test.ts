import { readFileSync } from "node:fs";
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

describe("AD-12 no long-lived AWS credentials", () => {
  it("never references a static AWS access key pair anywhere in the workflow", () => {
    expect(WORKFLOW_DIRECTIVES).not.toContain("AWS_ACCESS_KEY_ID");
    expect(WORKFLOW_DIRECTIVES).not.toContain("AWS_SECRET_ACCESS_KEY");
    expect(WORKFLOW_DIRECTIVES).not.toContain("AWS_SESSION_TOKEN");
    expect(WORKFLOW_DIRECTIVES).not.toContain("aws-access-key-id");
    expect(WORKFLOW_DIRECTIVES).not.toContain("aws-secret-access-key");
  });

  it("acquires credentials only through OIDC role assumption on v6 of the action", () => {
    const credentialStep = DEPLOY.steps.find((step: { uses?: string }) =>
      step.uses?.startsWith("aws-actions/configure-aws-credentials")
    );

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

  /* The bootstrap workflow is the single sanctioned exception, and it exists only
   * because nothing can create an OIDC provider over OIDC. It must never acquire a
   * push or pull_request trigger. */
  it("confines static keys to the dispatch-only bootstrap workflow", () => {
    const bootstrap = readRepoFile(
      ".github/workflows/api-bedrock-oidc-bootstrap.yml"
    );

    expect(bootstrap).toContain("secrets.AWS_ACCESS_KEY_ID");
    expect(bootstrap).toMatch(/^on:\n\s+workflow_dispatch:/m);
    expect(bootstrap).not.toMatch(/^\s+push:/m);
    expect(bootstrap).not.toMatch(/^\s+pull_request:/m);
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
    const node = VERIFY.steps.find((step: { uses?: string }) =>
      step.uses?.startsWith("actions/setup-node")
    );
    expect(node.with["node-version"]).toBe(22);
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

  /* A template that says `!Ref` proves nothing about the value CloudFormation
   * actually applied, and the difference is "cannot invoke Bedrock" versus "can". */
  it("asserts the DEPLOYED reservation is the inert 0, not the template's intent", () => {
    const commands = runCommands(DEPLOY);

    expect(commands).toContain("lambda get-function-concurrency");
    expect(commands).toContain("ReservedConcurrentExecutions");
    expect(commands).toMatch(/reserved.*!=.*"0"|"\$\{reserved\}" != "0"/);
    expect(commands).toContain("exit 1");
  });

  it("passes the reservation in explicitly, defaulting to inert", () => {
    const commands = runCommands(DEPLOY);

    expect(commands).toContain("HostedAiReservedConcurrency=");
    expect(WORKFLOW_TEXT).toContain(
      "HOSTED_AI_RESERVED_CONCURRENCY: ${{ vars.HOSTED_AI_RESERVED_CONCURRENCY || '0' }}"
    );
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
      "BedrockInferenceProfileArn=",
    ]) {
      expect(commands, `missing override ${parameter}`).toContain(parameter);
    }
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
