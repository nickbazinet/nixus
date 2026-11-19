import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { REPO_ROOT, readRepoFile } from "./lib/testing/cfn.ts";

/*
 * Delivery-pipeline contract (AD-14). A static AWS key, a missing environment
 * gate, or a pre-deploy assertion that silently stopped running is a security or
 * availability regression rather than a bug, and none of it is reachable from a
 * unit test.
 */

const WORKFLOW_TEXT = readRepoFile(".github/workflows/account-ci.yml");
const SAMCONFIG_TEXT = readFileSync(
  fileURLToPath(new URL("../samconfig.toml", import.meta.url)),
  "utf8"
);

/* Comments are stripped before credential scanning: the workflow deliberately
 * NAMES the static-key mechanism it supersedes and the failure modes it guards
 * against, and a raw text scan would match that rationale. */
const WORKFLOW_DIRECTIVES = WORKFLOW_TEXT.split("\n")
  .filter((line) => !line.trimStart().startsWith("#"))
  .join("\n");

/* A GitHub Actions workflow is an untyped document; this test is its boundary. */
/* eslint-disable @typescript-eslint/no-explicit-any */
const WORKFLOW = parse(WORKFLOW_TEXT) as any;
/* eslint-enable @typescript-eslint/no-explicit-any */

const TRIGGERS = WORKFLOW.on ?? WORKFLOW[true as never];
const VERIFY = WORKFLOW.jobs.verify;
const DEPLOY = WORKFLOW.jobs.deploy;

/* eslint-disable @typescript-eslint/no-explicit-any */
function runCommands(job: { steps: { run?: string }[] }): string {
  return job.steps.map((step) => step.run ?? "").join("\n");
}

function matchesStep(entry: any, fragment: string): boolean {
  return `${entry.name ?? ""}\n${entry.uses ?? ""}`.includes(fragment);
}

/** Fails naming the step rather than throwing a bare TypeError on a renamed step. */
function step(job: { steps: any[] }, fragment: string): any {
  const found = job.steps.find((entry) => matchesStep(entry, fragment));
  expect(found, `no step matching "${fragment}"`).toBeDefined();
  return found;
}

function stepIndex(job: { steps: any[] }, fragment: string): number {
  const index = job.steps.findIndex((entry) => matchesStep(entry, fragment));
  expect(index, `no step matching "${fragment}"`).toBeGreaterThan(-1);
  return index;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

describe("AD-14 no long-lived AWS credentials", () => {
  it("never references a static AWS access key pair anywhere", () => {
    for (const forbidden of [
      "AWS_ACCESS_KEY_ID",
      "AWS_SECRET_ACCESS_KEY",
      "AWS_SESSION_TOKEN",
      "aws-access-key-id",
      "aws-secret-access-key",
      "aws configure",
      "AWS_PROFILE",
      "~/.aws",
      "sam deploy --guided",
    ]) {
      expect(
        WORKFLOW_DIRECTIVES.toLowerCase(),
        `${forbidden} must be absent`
      ).not.toContain(forbidden.toLowerCase());
    }

    // The only credential acquisition in the whole workflow.
    expect(WORKFLOW_DIRECTIVES.match(/configure-aws-credentials/g)).toHaveLength(
      1
    );
  });

  it("assumes the account-specific deploy role through OIDC", () => {
    const credentials = step(DEPLOY, "aws-actions/configure-aws-credentials");

    expect(credentials.uses).toBe("aws-actions/configure-aws-credentials@v6");
    expect(credentials.with["role-to-assume"]).toContain(
      "AWS_ACCOUNT_DEPLOY_ROLE_ARN"
    );
    expect(credentials.with["aws-region"]).toBe("us-east-1");

    // Never the Bedrock service's role: its bootstrap scopes every permission to
    // the nixus-bedrock-api stack, so it cannot deploy this one (AD-14).
    expect(WORKFLOW_DIRECTIVES).not.toContain("AWS_BEDROCK_DEPLOY_ROLE_ARN");
  });

  it("requests id-token only for the deploy job and keeps the default read-only", () => {
    expect(WORKFLOW.permissions).toEqual({ contents: "read" });
    expect(DEPLOY.permissions).toEqual({
      "id-token": "write",
      contents: "read",
    });
    expect(VERIFY.permissions).toBeUndefined();
  });

  it("gives the verify job no AWS credentials at all", () => {
    const usesCredentials = VERIFY.steps.some((entry: { uses?: string }) =>
      entry.uses?.startsWith("aws-actions/configure-aws-credentials")
    );
    expect(usesCredentials).toBe(false);
  });
});

describe("AD-14 protected default-branch deployment", () => {
  it("gates deployment behind the protected production environment", () => {
    expect(DEPLOY.environment).toBe("production");
    expect(DEPLOY.needs).toBe("verify");
  });

  it("skips the deploy job entirely unless the repository opts in", () => {
    expect(DEPLOY.if).toContain("vars.ACCOUNT_DEPLOY_ENABLED == 'true'");
  });

  it("permits a default-branch push or a dispatch, and a dispatch only from master", () => {
    expect(Object.keys(TRIGGERS)).toContain("workflow_dispatch");
    expect(TRIGGERS.push.branches).toEqual(["master"]);

    // The branch check sits outside the trigger check, so it constrains BOTH
    // paths - a dispatch from a feature branch is refused like a push would be.
    expect(DEPLOY.if).toContain("github.ref == 'refs/heads/master'");
    expect(DEPLOY.if).toContain("github.event_name == 'push'");
    expect(DEPLOY.if).toContain("github.event_name == 'workflow_dispatch'");
    expect(DEPLOY.if).not.toContain("pull_request");
  });

  /* Cancelling `sam deploy` mid-flight abandons the stack in UPDATE_IN_PROGRESS,
   * which blocks every later deployment until an operator intervenes. */
  it("never cancels an in-flight deployment, while verification stays cancellable", () => {
    expect(WORKFLOW.concurrency["cancel-in-progress"]).toBe(true);
    expect(DEPLOY.concurrency).toEqual({
      group: "account-deploy-production",
      "cancel-in-progress": false,
    });
    expect(DEPLOY.concurrency.group).not.toContain("github.ref");
  });

  it("triggers on this service, the shared contract, and the account app", () => {
    for (const path of [
      "apps/api-account/**",
      "apps/account/**",
      "packages/shared/**",
      ".github/workflows/account-ci.yml",
      "pnpm-lock.yaml",
    ]) {
      expect(TRIGGERS.pull_request.paths, path).toContain(path);
      expect(TRIGGERS.push.paths, path).toContain(path);
    }
  });

  /* Deliberately ASYMMETRIC, and the asymmetry is the control: the bootstrap
   * stack grants the deploy role the permissions the pre-deploy assertions need
   * and is applied by hand, so merging a bootstrap change must not trigger a
   * deploy against a role that does not hold the grant yet. */
  it("verifies the bootstrap template on a PR but never deploys on its merge", () => {
    expect(TRIGGERS.pull_request.paths).toContain(
      "infra/bootstrap/account-oidc-deploy.yaml"
    );
    for (const path of TRIGGERS.push.paths as string[]) {
      expect(path, `${path} must not reach into infra/`).not.toMatch(/^infra\b/);
    }
  });
});

describe("verify job runs every prescribed check", () => {
  it("installs with a frozen lockfile and runs lint, typecheck, test, validate, build", () => {
    const commands = runCommands(VERIFY);

    expect(commands).toContain("pnpm install --frozen-lockfile");
    expect(commands).toContain("pnpm --filter @nixus/api-account lint");
    expect(commands).toContain("pnpm --filter @nixus/api-account typecheck");
    expect(commands).toContain("pnpm --filter @nixus/api-account test");
    expect(commands).toContain("pnpm --filter @nixus/api-account sam:validate");
    expect(commands).toContain("pnpm --filter @nixus/api-account sam:build");
  });

  it("also verifies the shared contract this service consumes", () => {
    const commands = runCommands(VERIFY);
    expect(commands).toContain("pnpm --filter @nixus/shared typecheck");
    expect(commands).toContain("pnpm --filter @nixus/shared test");
  });

  it("lints the bootstrap template, which sam validate never sees", () => {
    expect(runCommands(VERIFY)).toContain(
      "cfn-lint infra/bootstrap/account-oidc-deploy.yaml"
    );
    expect(
      existsSync(
        fileURLToPath(
          new URL("infra/bootstrap/account-oidc-deploy.yaml", REPO_ROOT)
        )
      )
    ).toBe(true);
  });

  it("provisions the SAM CLI and the Node version the Lambda runs", () => {
    expect(
      VERIFY.steps.some((entry: { name?: string }) =>
        entry.name?.includes("Setup AWS SAM CLI")
      )
    ).toBe(true);
    expect(step(VERIFY, "actions/setup-node").with["node-version"]).toBe(24);
    expect(step(DEPLOY, "actions/setup-node").with["node-version"]).toBe(24);
  });
});

describe("pre-deploy assertions all run, in order, before the deploy", () => {
  const ORDERED = [
    "aws-actions/configure-aws-credentials",
    "Assert the shared domain still accepts API mappings",
    "Assert the nixus-api resource server holds every required scope",
    "Assert the Bedrock stack that owns the domain exists",
    "Deploy stack",
  ];

  it("orders them after the credential step and before `sam deploy`", () => {
    const indices = ORDERED.map((fragment) => stepIndex(DEPLOY, fragment));
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
  });

  /* An API mapping is only honoured in an API-mapping routing mode; in
   * ROUTING_RULE_ONLY it is created and silently never matches. */
  it("refuses a routing mode that would ignore the mapping", () => {
    const script = step(DEPLOY, "still accepts API mappings").run as string;

    expect(script).toContain("apigatewayv2 get-domain-name");
    expect(script).toContain("API_MAPPING_ONLY");
    expect(script).toContain("ROUTING_RULE_THEN_API_MAPPING");
    expect(script).toContain("exit 1");
    expect(script).toContain("set -euo pipefail");
  });

  /* UpdateResourceServer is a full replace: a scripted path that submits only
   * `profile` deletes `ai.invoke` AND `billing`, taking hosted AI down for every
   * desktop user and the account app's billing pages with it. The assertion is
   * what makes that visible before this stack goes out. */
  it("asserts ALL THREE resource-server scopes, naming each explicitly", () => {
    const script = step(DEPLOY, "resource server holds every required scope")
      .run as string;

    expect(script).toContain("cognito-idp describe-resource-server");
    expect(script).toContain("--identifier");
    expect(script).toContain("grep -Fxq");
    expect(script).toContain("exit 1");
    // Sorted so the assertion does not depend on the order they were added in.
    expect(String(DEPLOY.env.REQUIRED_COGNITO_SCOPES).split(" ").sort()).toEqual([
      "ai.invoke",
      "billing",
      "profile",
    ]);
    expect(DEPLOY.env.COGNITO_RESOURCE_SERVER_IDENTIFIER).toBe("nixus-api");
    // The pool id is an input, never a committed literal.
    expect(WORKFLOW_DIRECTIVES).not.toContain("us-east-1_");
  });

  /* billing AD-17: the resource server gains `nixus-api/billing` BEFORE any
   * client requests it, and the account app requests the full scope set on every
   * authorization so a stored session is never replaced by a narrower one. If
   * this assertion were dropped, a deploy could ship the app asking for a scope
   * the pool does not publish, and every sign-in would fail with
   * `invalid_scope`. */
  it("asserts the billing scope before the app that depends on it is deployed", () => {
    expect(String(DEPLOY.env.REQUIRED_COGNITO_SCOPES)).toContain("billing");
    expect(
      stepIndex(DEPLOY, "resource server holds every required scope"),
    ).toBeLessThan(stepIndex(DEPLOY, "Deploy stack"));
  });

  it("asserts the stack that owns the domain is deployed and steady", () => {
    const script = step(DEPLOY, "Bedrock stack that owns the domain")
      .run as string;

    expect(script).toContain("cloudformation describe-stacks");
    expect(script).toContain("CREATE_COMPLETE");
    expect(script).toContain("UPDATE_COMPLETE");
    expect(script).toContain("exit 1");
    expect(DEPLOY.env.BEDROCK_STACK_NAME).toBe("nixus-bedrock-api");
  });
});

describe("deploy step", () => {
  it("deploys the one stack from committed config with every parameter explicit", () => {
    const commands = runCommands(DEPLOY);

    expect(commands).toContain("sam deploy");
    expect(commands).toContain("--no-fail-on-empty-changeset");
    expect(commands).toContain("--no-confirm-changeset");
    for (const parameter of [
      "CognitoUserPoolArn=",
      "CognitoUserPoolId=",
      "ApiDomainName=",
      "AlertEmail=",
    ]) {
      expect(commands, `missing override ${parameter}`).toContain(parameter);
    }
    expect(step(DEPLOY, "Deploy stack")["working-directory"]).toBe(
      "apps/api-account"
    );
  });

  it("uploads to the explicit bootstrap-owned bucket under a stable prefix", () => {
    const commands = runCommands(DEPLOY);

    expect(commands).toContain("--s3-bucket");
    expect(commands).toContain('"${SAM_ARTIFACT_BUCKET}"');
    expect(commands).toContain('test -n "${SAM_ARTIFACT_BUCKET}"');
    expect(WORKFLOW_TEXT).toContain("SAM_ARTIFACT_PREFIX: nixus-account");
    expect(SAMCONFIG_TEXT).toContain("resolve_s3 = false");
  });

  /* One stack, one cadence (AD-14): the account app is built and packaged before
   * `sam build`, so one `sam deploy` ships both halves from the same commit. */
  it("builds both artifacts before deploying", () => {
    const deployIndex = stepIndex(DEPLOY, "Deploy stack");
    for (const fragment of [
      "Build account app",
      "Package account app for Lambda",
      "Build SAM application",
    ]) {
      expect(stepIndex(DEPLOY, fragment), fragment).toBeLessThan(deployIndex);
    }
    expect(WORKFLOW_TEXT).toContain("EPIC F SEAM");
    expect(WORKFLOW_TEXT).toContain("@nixus/account build");
  });

  it("names no second stack anywhere in the deploy", () => {
    expect(DEPLOY.env.ACCOUNT_STACK_NAME).toBe("nixus-account");
    expect(SAMCONFIG_TEXT).toContain('stack_name = "nixus-account"');
  });
});

describe("post-deploy gates (AD-15)", () => {
  const AI_GATE = "hosted AI still reaches the Bedrock API";
  const PROFILE_GATE = "profile API answers with the account envelope";

  it("runs both routing gates after the deploy", () => {
    const deployIndex = stepIndex(DEPLOY, "Deploy stack");
    expect(stepIndex(DEPLOY, AI_GATE)).toBeGreaterThan(deployIndex);
    expect(stepIndex(DEPLOY, PROFILE_GATE)).toBeGreaterThan(deployIndex);
  });

  /* Adding a mapping under a domain another stack owns is the one change here
   * that can break a service this stack does not own. */
  it("proves the Bedrock catch-all mapping still points at the Bedrock API", () => {
    const script = step(DEPLOY, AI_GATE).run as string;

    expect(script).toContain("apigatewayv2 get-api-mappings");
    expect(script).toContain("--logical-resource-id HostedAiApi");
    expect(script).toContain('select((.ApiMappingKey // "") == "")');
    expect(script).toContain('test "${catch_all}" = "${bedrock_api_id}"');
    expect(script).toContain("exit 1");
  });

  it("proves the new mapping points at this stack's own API", () => {
    const script = step(DEPLOY, AI_GATE).run as string;

    expect(script).toContain('select(.ApiMappingKey == "v1/profile")');
    expect(script).toContain("ProfileApiId");
    expect(script).toContain('test "${profile_mapped}" = "${profile_api_id}"');
  });

  it("calls the deployed hosted-AI route unauthenticated and expects its envelope", () => {
    const script = step(DEPLOY, AI_GATE).run as string;

    expect(script).toContain("/v1/ai/status");
    expect(script).toContain('test "${code}" = "401"');
    expect(script).toContain('.error.code == "unauthorized"');
    // No token is ever sent by a gate.
    expect(script).not.toContain("Authorization:");
  });

  it("calls the deployed profile route unauthenticated and expects the account envelope", () => {
    const script = step(DEPLOY, PROFILE_GATE).run as string;

    expect(script).toContain("/v1/profile");
    expect(script).toContain('test "${code}" = "401"');
    expect(script).toContain('.error.code == "unauthorized"');
    expect(script).toContain(".error.request_id");
    expect(script).toContain("first_name");
    expect(script).not.toContain("Authorization:");
  });

  it("asserts the retained table keeps point-in-time recovery after every deploy", () => {
    const commands = runCommands(DEPLOY);
    expect(commands).toContain("describe-continuous-backups");
    expect(commands).toContain("ENABLED");
  });

  it("uses unique temp files in every gate that writes one", () => {
    for (const fragment of [AI_GATE, PROFILE_GATE]) {
      const script = step(DEPLOY, fragment).run as string;
      expect(script, fragment).toContain("mktemp -d");
      expect(script, fragment).toContain("trap cleanup EXIT");
      expect(script, fragment).not.toContain("/tmp/");
    }
  });

  it("writes nothing to a run output, summary, or environment file", () => {
    for (const leak of [
      "GITHUB_STEP_SUMMARY",
      "GITHUB_OUTPUT",
      "GITHUB_ENV",
    ]) {
      expect(WORKFLOW_DIRECTIVES, leak).not.toContain(leak);
    }
  });
});

describe("Epic F verification gates", () => {
  it("runs the account app's lint, typecheck, unit and security-gate tests", () => {
    const commands = runCommands(VERIFY);

    for (const script of ["lint", "typecheck", "test", "build", "package"]) {
      expect(commands, script).toContain(`pnpm --filter @nixus/account ${script}`);
    }
  });

  /* The packaged bundle is what the E2E drives, so packaging has to happen first.
   * The E2E is also the only gate that proves the srvx entry wrapper and the
   * AWS_LAMBDA_HTTP_ENDPOINT contract work at all. */
  it("drives the packaged artifact through Playwright, after packaging it", () => {
    expect(stepIndex(VERIFY, "Package account app for Lambda")).toBeLessThan(
      stepIndex(VERIFY, "Account app E2E")
    );
    expect(runCommands(VERIFY)).toContain("pnpm --filter @nixus/account test:e2e");
  });

  /* `ubuntu-latest` moved to Ubuntu 26.04, where `playwright install --with-deps
   * chromium` refuses outright. The pin is what keeps the suite runnable. */
  it("pins the Playwright runner to a release Playwright supports", () => {
    expect(VERIFY["runs-on"]).toBe("ubuntu-24.04");
    expect(runCommands(VERIFY)).toContain("playwright install --with-deps chromium");
  });

  /* The SAM CLI's bundled cfn-lint has no schema for AWS::Lambda::WebFunction* and
   * reports the type as nonexistent, which is why E3006/E3031 are suppressed on
   * those resources. This step is what still validates them. */
  it("lints the application template with the current cfn-lint too", () => {
    expect(runCommands(VERIFY)).toContain(
      "cfn-lint apps/api-account/template.yaml"
    );
  });
});

describe("Epic F deploy sequence", () => {
  const ORDERED = [
    "Deploy stack",
    "Allow CloudFront to invoke the web function endpoint",
    "Publish the account app's static assets",
    "Invalidate the account app's edge cache",
    "Smoke-test the deployed account app",
  ];

  it("runs the post-deploy steps in order, after the deploy", () => {
    const indices = ORDERED.map((fragment) => stepIndex(DEPLOY, fragment));
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
  });

  /* CreateWebFunctionRevision reads the object during stack CREATION, so the
   * bucket and the object both have to exist before `sam deploy` - which is why
   * the bucket cannot be a stack resource. */
  it("creates the versioned code bucket and uploads the package before deploying", () => {
    const deployIndex = stepIndex(DEPLOY, "Deploy stack");
    expect(stepIndex(DEPLOY, "code bucket exists and is versioned")).toBeLessThan(
      deployIndex
    );
    expect(stepIndex(DEPLOY, "Upload the account app package")).toBeLessThan(
      deployIndex
    );
    expect(stepIndex(DEPLOY, "code bucket exists and is versioned")).toBeLessThan(
      stepIndex(DEPLOY, "Upload the account app package")
    );
  });

  /* Lambda Web stores code by REFERENCE and CreateWebFunctionRevision fails
   * outright without bucket versioning. The step asserts the enabled state rather
   * than assuming the call worked. */
  it("proves versioning is enabled rather than only requesting it", () => {
    const script = step(DEPLOY, "code bucket exists and is versioned").run as string;

    expect(script).toContain("put-bucket-versioning");
    expect(script).toContain("get-bucket-versioning");
    expect(script).toContain('test "${versioning}" = "Enabled"');
    expect(script).toContain("set -euo pipefail");
    expect(script).toContain("exit 1");
  });

  /* A revision is fully immutable, so the content hash IS the deploy trigger: an
   * unchanged app re-deploys the same key and CloudFormation makes no change. */
  it("keys the package by content hash and passes that key to the deploy", () => {
    expect(step(DEPLOY, "Upload the account app package").run as string).toContain(
      "app.zip.sha256"
    );

    const commands = runCommands(DEPLOY);
    for (const parameter of [
      "AccountDomainName=",
      "AccountCertificateArn=",
      "HostedZoneId=",
      "AccountAppCodeBucket=",
      "AccountAppCodeKey=",
    ]) {
      expect(commands, `missing override ${parameter}`).toContain(parameter);
    }
  });

  /* Not a CloudFormation resource: it needs the distribution id, which does not
   * exist until the stack is created. There is no AddPermission for Web Functions,
   * and PutResourcePolicy replaces the policy wholesale. */
  it("writes the resource policy with the function arn and the endpoint arn", () => {
    const script = step(DEPLOY, "Allow CloudFront to invoke").run as string;

    expect(script).toContain("AccountWebFunctionArn");
    expect(script).toContain("AccountWebFunctionEndpointArn");
    expect(script).toContain("lambda:InvokeWebFunctionEndpoint");
    expect(script).toContain("cloudfront.amazonaws.com");
    expect(script).toContain("aws:SourceArn");
    expect(script).toContain("put_resource_policy");
    // Read back, so a silently wrong policy fails the deploy rather than the site.
    expect(script).toContain("get_resource_policy");
    expect(script).toContain("boto3");
  });

  it("publishes assets additively and waits for the invalidation", () => {
    const assets = step(DEPLOY, "Publish the account app's static assets")
      .run as string;
    expect(assets).toContain("s3 sync");
    expect(assets).toContain("AccountAssetsBucketName");
    expect(assets).toContain("max-age=31536000, immutable");
    // Nothing is deleted: an HTML document already in flight must keep resolving
    // the assets it references.
    expect(assets).not.toContain("--delete");

    const invalidation = step(DEPLOY, "Invalidate the account app's edge cache")
      .run as string;
    expect(invalidation).toContain("create-invalidation");
    expect(invalidation).toContain("wait invalidation-completed");
  });

  it("smoke-tests the sign-in entry redirect, the login redirect and the Origin refusal", () => {
    const script = step(DEPLOY, "Smoke-test the deployed account app").run as string;

    // No signed-out landing page: an anonymous / must go straight to sign-in.
    expect(script).toContain('test "${code}" = "302"');
    expect(script).toContain("/auth/login\\?next=profile");
    expect(script).not.toContain('test "${code}" = "200"');
    expect(script).toContain("/auth/login");
    expect(script).toContain('test "${login_code}" = "302"');
    expect(script).toContain("auth\\.nixusapp\\.com/oauth2/authorize");
    // A browser silently DROPS a __Host- cookie that is missing Secure, which
    // presents as a sign-in that never completes rather than as an error.
    expect(script).toContain("__Host-nixus_preauth");
    expect(script).toContain("Secure");
    expect(script).toContain('test "${origin_code}" = "403"');
    // No gate ever sends a token.
    expect(script).not.toContain("Authorization:");
  });

  it("names the account hostname and the code bucket as inputs, not literals", () => {
    expect(DEPLOY.env.ACCOUNT_DOMAIN_NAME).toBe("account.nixusapp.com");
    expect(DEPLOY.env.ACCOUNT_CODE_BUCKET).toContain("vars.ACCOUNT_CODE_BUCKET");
    // The certificate and the zone are account topology, so they stay secrets.
    expect(WORKFLOW_TEXT).toContain("secrets.API_CERTIFICATE_ARN");
    expect(WORKFLOW_TEXT).toContain("secrets.HOSTED_ZONE_ID");
    expect(WORKFLOW_DIRECTIVES).not.toMatch(/arn:aws:acm:/);
    expect(WORKFLOW_DIRECTIVES).not.toMatch(/\bZ[0-9A-Z]{10,}\b/);
  });
});
