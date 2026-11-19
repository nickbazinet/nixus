import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { REPO_ROOT, readRepoFile } from "./lib/testing/cfn.ts";

/*
 * Delivery-pipeline contract (billing AD-15). A static AWS key, a missing
 * environment gate, a pre-deploy assertion that silently stopped running, or a
 * step that prints Stripe key material is a security or availability regression
 * rather than a bug, and none of it is reachable from a unit test.
 */

const WORKFLOW_TEXT = readRepoFile(".github/workflows/billing-ci.yml");
const SAMCONFIG_TEXT = readFileSync(
  fileURLToPath(new URL("../samconfig.toml", import.meta.url)),
  "utf8",
);

/* Comments are stripped before credential scanning: the workflow deliberately
 * NAMES the calls it refuses to make - `get-parameter`, `--with-decryption` -
 * and a raw text scan would match that rationale. */
const WORKFLOW_DIRECTIVES = WORKFLOW_TEXT.split("\n")
  .filter((line) => !line.trimStart().startsWith("#"))
  .join("\n");

/* A GitHub Actions workflow is an untyped document; this test is its boundary. */
/* eslint-disable @typescript-eslint/no-explicit-any */
const WORKFLOW = parse(WORKFLOW_TEXT) as any;

const TRIGGERS = WORKFLOW.on ?? WORKFLOW[true as never];
const VERIFY = WORKFLOW.jobs.verify;
const DEPLOY = WORKFLOW.jobs.deploy;

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

describe("AD-15 no long-lived AWS credentials", () => {
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
        `${forbidden} must be absent`,
      ).not.toContain(forbidden.toLowerCase());
    }

    // The only credential acquisition in the whole workflow.
    expect(
      WORKFLOW_DIRECTIVES.match(/configure-aws-credentials/g),
    ).toHaveLength(1);
  });

  it("assumes the billing-specific deploy role through OIDC", () => {
    const credentials = step(DEPLOY, "aws-actions/configure-aws-credentials");

    expect(credentials.uses).toBe("aws-actions/configure-aws-credentials@v6");
    expect(credentials.with["role-to-assume"]).toContain(
      "AWS_BILLING_DEPLOY_ROLE_ARN",
    );
    expect(credentials.with["aws-region"]).toBe("us-east-1");

    // Never another service's role: each bootstrap scopes every permission to
    // its own stack, so neither can deploy this one.
    expect(WORKFLOW_DIRECTIVES).not.toContain("AWS_BEDROCK_DEPLOY_ROLE_ARN");
    expect(WORKFLOW_DIRECTIVES).not.toContain("AWS_ACCOUNT_DEPLOY_ROLE_ARN");
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
      entry.uses?.startsWith("aws-actions/configure-aws-credentials"),
    );
    expect(usesCredentials).toBe(false);
  });

  it("commits no account-specific literal", () => {
    expect(WORKFLOW_DIRECTIVES).not.toContain("us-east-1_");
    expect(WORKFLOW_DIRECTIVES).not.toMatch(/\barn:aws:/);
    expect(WORKFLOW_DIRECTIVES).not.toMatch(/\b\d{12}\b/);
  });
});

describe("AD-15 protected default-branch deployment", () => {
  it("gates deployment behind the protected production environment", () => {
    expect(DEPLOY.environment).toBe("production");
    expect(DEPLOY.needs).toBe("verify");
  });

  it("skips the deploy job entirely unless the repository opts in", () => {
    expect(DEPLOY.if).toContain("vars.BILLING_DEPLOY_ENABLED == 'true'");
  });

  it("permits a default-branch push or a dispatch, and never a pull request", () => {
    expect(Object.keys(TRIGGERS)).toContain("workflow_dispatch");
    expect(TRIGGERS.push.branches).toEqual(["master", "main"]);

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
      group: "billing-deploy-production",
      "cancel-in-progress": false,
    });
    expect(DEPLOY.concurrency.group).not.toContain("github.ref");
  });

  it("triggers on this service, the shared contract, and the lockfile", () => {
    for (const path of [
      "apps/api-billing/**",
      "packages/shared/**",
      ".github/workflows/billing-ci.yml",
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
      "infra/bootstrap/billing-oidc-deploy.yaml",
    );
    for (const path of TRIGGERS.push.paths as string[]) {
      expect(path, `${path} must not reach into infra/`).not.toMatch(/^infra\b/);
    }
    // The comment api-bedrock-ci.yml carries, because the asymmetry reads as an
    // oversight without it.
    expect(WORKFLOW_TEXT).toContain("Deliberately NOT symmetric");
    expect(WORKFLOW_TEXT).toContain("failing closed on authorization");
  });
});

describe("verify job runs every prescribed check", () => {
  it("installs with a frozen lockfile and runs lint, typecheck, test, validate, build", () => {
    const commands = runCommands(VERIFY);

    expect(commands).toContain("pnpm install --frozen-lockfile");
    expect(commands).toContain("pnpm --filter @nixus/api-billing lint");
    expect(commands).toContain("pnpm --filter @nixus/api-billing typecheck");
    expect(commands).toContain("pnpm --filter @nixus/api-billing test");
    expect(commands).toContain("pnpm --filter @nixus/api-billing sam:validate");
    expect(commands).toContain("pnpm --filter @nixus/api-billing sam:build");
  });

  it("also verifies the shared contract this service consumes", () => {
    const commands = runCommands(VERIFY);
    expect(commands).toContain("pnpm --filter @nixus/shared typecheck");
    expect(commands).toContain("pnpm --filter @nixus/shared test");
  });

  it("lints the bootstrap template, which sam validate never sees", () => {
    expect(runCommands(VERIFY)).toContain(
      "cfn-lint infra/bootstrap/billing-oidc-deploy.yaml",
    );
    expect(
      existsSync(
        fileURLToPath(
          new URL("infra/bootstrap/billing-oidc-deploy.yaml", REPO_ROOT),
        ),
      ),
    ).toBe(true);
  });

  it("provisions the SAM CLI and the Node version the Lambda runs", () => {
    expect(
      VERIFY.steps.some((entry: { name?: string }) =>
        entry.name?.includes("Setup AWS SAM CLI"),
      ),
    ).toBe(true);
    expect(step(VERIFY, "actions/setup-node").with["node-version"]).toBe(24);
    expect(step(DEPLOY, "actions/setup-node").with["node-version"]).toBe(24);
  });
});

describe("pre-deploy assertions all run, in order, before the deploy", () => {
  const ORDERED = [
    "aws-actions/configure-aws-credentials",
    "Assert the shared domain still accepts API mappings",
    "Assert the nixus-api resource server holds all three scopes",
    "Assert both Stripe SecureStrings exist",
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

  /* AD-17: the `billing` scope must exist before any client requests it, and
   * UpdateResourceServer is a FULL REPLACE - so a list submitted without
   * `ai.invoke` takes hosted AI down and one without `profile` takes the profile
   * API down. All three are asserted together. */
  it("asserts all THREE resource-server scopes", () => {
    const script = step(DEPLOY, "holds all three scopes").run as string;

    expect(script).toContain("cognito-idp describe-resource-server");
    expect(script).toContain("--identifier");
    expect(script).toContain("grep -Fxq");
    expect(script).toContain("exit 1");

    expect(DEPLOY.env.REQUIRED_COGNITO_SCOPES).toBe("ai.invoke billing profile");
    expect(DEPLOY.env.COGNITO_RESOURCE_SERVER_IDENTIFIER).toBe("nixus-api");
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

describe("AD-15 no step prints or compares Stripe key material", () => {
  /* The load-bearing assertion of this file. `describe-parameters` returns
   * metadata and has no way to return a value; `get-parameter` would put the live
   * Stripe secret key into a workflow run's reach, and `--with-decryption` is the
   * flag that makes it plaintext. Neither may appear anywhere. */
  it("uses describe-parameters only, and never a value read", () => {
    expect(WORKFLOW_DIRECTIVES).toContain("ssm describe-parameters");

    for (const forbidden of [
      "get-parameter",
      "get-parameters",
      "--with-decryption",
      "WithDecryption",
      "secretsmanager",
      "get-secret-value",
    ]) {
      expect(
        WORKFLOW_DIRECTIVES,
        `${forbidden} must be absent from every step`,
      ).not.toContain(forbidden);
    }
  });

  it("asserts the parameter NAME and TYPE, and compares nothing else", () => {
    const script = step(DEPLOY, "Assert both Stripe SecureStrings exist")
      .run as string;

    expect(script).toContain("Key=Name,Option=Equals");
    // A parameter created as a plain `String` holds the key unencrypted and the
    // Lambda's WithDecryption read would still succeed, so the TYPE is what makes
    // that misconfiguration visible.
    expect(script).toContain("Parameters[0].Type");
    expect(script).toContain('test "${type}" = "SecureString"');
    expect(script).toContain("exit 1");
    // `Values=` is the filter's own syntax; a `.Value` PROJECTION is what would
    // put the secret into the run log, and there is none.
    expect(script).not.toContain("Parameters[0].Value");
    expect(script).not.toContain("Parameter.Value");
  });

  it("never names a Stripe secret value, only the two parameter paths", () => {
    for (const forbidden of [
      "sk_test_",
      "sk_live_",
      "whsec_",
      "STRIPE_SECRET_KEY:",
      "STRIPE_WEBHOOK_SECRET:",
    ]) {
      expect(WORKFLOW_DIRECTIVES, forbidden).not.toContain(forbidden);
    }

    expect(DEPLOY.env.STRIPE_SECRET_KEY_PARAMETER_NAME).toBe(
      "/nixus-billing/stripe-secret-key",
    );
    expect(DEPLOY.env.STRIPE_WEBHOOK_SECRET_PARAMETER_NAME).toBe(
      "/nixus-billing/stripe-webhook-secret",
    );
  });

  it("writes nothing to a run output, summary, or environment file", () => {
    for (const leak of ["GITHUB_STEP_SUMMARY", "GITHUB_OUTPUT", "GITHUB_ENV"]) {
      expect(WORKFLOW_DIRECTIVES, leak).not.toContain(leak);
    }
  });
});

describe("deploy step", () => {
  /* CloudFormation PRESERVES a previous value for any parameter a deploy omits,
   * which is how a superseded value survives a deploy and nobody notices - so
   * every parameter the template declares has to be passed explicitly. */
  it("passes EVERY template parameter in --parameter-overrides", () => {
    const commands = runCommands(DEPLOY);

    expect(commands).toContain("sam deploy");
    expect(commands).toContain("--no-fail-on-empty-changeset");
    expect(commands).toContain("--no-confirm-changeset");

    for (const parameter of [
      "CognitoUserPoolArn=",
      "CognitoUserPoolId=",
      "ApiDomainName=",
      "AlertEmail=",
      "StripeMode=",
      "StripeSecretKeyParameterName=",
      "StripeWebhookSecretParameterName=",
      "CatalogCacheTtlSeconds=",
      "CatalogLookupKeys=",
      "AccountAppOrigin=",
      "MinimumClientVersion=",
      "BillingFunctionReservedConcurrency=",
      "DeploymentRevision=",
    ]) {
      expect(commands, `missing override ${parameter}`).toContain(parameter);
    }

    expect(step(DEPLOY, "Deploy stack")["working-directory"]).toBe(
      "apps/api-billing",
    );
  });

  it("uploads to the explicit bootstrap-owned bucket under a stable prefix", () => {
    const commands = runCommands(DEPLOY);

    expect(commands).toContain("--s3-bucket");
    expect(commands).toContain('"${SAM_ARTIFACT_BUCKET}"');
    expect(commands).toContain('test -n "${SAM_ARTIFACT_BUCKET}"');
    expect(WORKFLOW_TEXT).toContain("SAM_ARTIFACT_PREFIX: nixus-billing");
    expect(SAMCONFIG_TEXT).toContain("resolve_s3 = false");
  });

  it("builds the artifact before deploying it", () => {
    expect(stepIndex(DEPLOY, "Build SAM application")).toBeLessThan(
      stepIndex(DEPLOY, "Deploy stack"),
    );
  });

  it("names no second stack anywhere in the deploy", () => {
    expect(DEPLOY.env.BILLING_STACK_NAME).toBe("nixus-billing");
    expect(SAMCONFIG_TEXT).toContain('stack_name = "nixus-billing"');
    expect(SAMCONFIG_TEXT).toContain('region = "us-east-1"');
  });

  /* samconfig invariants. CAPABILITY_NAMED_IAM would let the stack create a
   * named IAM resource, which the application template never does and which the
   * bootstrap's prefix grants could not bound. */
  it("pins the capability set to CAPABILITY_IAM and never named-IAM", () => {
    expect(SAMCONFIG_TEXT).toContain('capabilities = "CAPABILITY_IAM"');
    expect(SAMCONFIG_TEXT).not.toContain("CAPABILITY_NAMED_IAM");
    expect(SAMCONFIG_TEXT).toContain("confirm_changeset = false");
    expect(SAMCONFIG_TEXT).toContain("lint = true");
    expect(SAMCONFIG_TEXT).not.toMatch(/^parameter_overrides\s*=/m);
  });
});

describe("post-deploy gates (AD-16)", () => {
  const MAPPING_GATE = "existing mappings on the shared domain are unchanged";
  const ROUTING_GATE = "profile and hosted-AI routes still reach their own stacks";

  it("runs every gate after the deploy", () => {
    const deployIndex = stepIndex(DEPLOY, "Deploy stack");

    for (const fragment of [
      MAPPING_GATE,
      ROUTING_GATE,
      "billing table is still PITR-enabled",
      "reserved concurrency is in force",
      "Smoke-test the public plan catalog",
    ]) {
      expect(stepIndex(DEPLOY, fragment), fragment).toBeGreaterThan(
        deployIndex,
      );
    }
  });

  /* Adding a mapping under a domain two other stacks already share is the one
   * change in this deploy that can break services it does not own. */
  it("proves the Bedrock catch-all and the v1/profile mapping are unchanged", () => {
    const script = step(DEPLOY, MAPPING_GATE).run as string;

    expect(script).toContain("apigatewayv2 get-api-mappings");
    expect(script).toContain("--logical-resource-id HostedAiApi");
    expect(script).toContain('select((.ApiMappingKey // "") == "")');
    expect(script).toContain('select(.ApiMappingKey == "v1/profile")');
    expect(script).toContain('test "${catch_all}" = "${bedrock_api_id}"');
    expect(script).toContain('test "${profile_mapped}" = "${profile_api_id}"');
    expect(script).toContain("exit 1");
  });

  it("proves the new v1/billing mapping points at this stack's API on stage v1", () => {
    const script = step(DEPLOY, MAPPING_GATE).run as string;

    expect(script).toContain('select(.ApiMappingKey == "v1/billing")');
    expect(script).toContain("BillingApiId");
    expect(script).toContain('test "${billing_mapped}" = "${billing_api_id}"');
    expect(script).toContain('test "${billing_stage}" = "v1"');
  });

  /* AD-16's "existing routing still works" gate. The mapping assertions prove the
   * CONFIGURATION; this proves the deployed reality, which is the half that
   * catches a longest-prefix surprise. A 403 or 404 means the request reached the
   * wrong API. */
  it("calls /v1/profile and /v1/ai/status and expects their own 401", () => {
    const script = step(DEPLOY, ROUTING_GATE).run as string;

    expect(script).toContain("v1/profile");
    expect(script).toContain("v1/ai/status");
    expect(script).toContain('test "${code}" = "401"');
    expect(script).toContain('.error.code == "unauthorized"');
    expect(script).toContain("exit 1");
    // No gate ever sends a token.
    expect(script).not.toContain("Authorization:");
  });

  it("asserts the retained table keeps point-in-time recovery after every deploy", () => {
    const script = step(DEPLOY, "billing table is still PITR-enabled")
      .run as string;

    expect(script).toContain("describe-continuous-backups");
    expect(script).toContain("BillingTableName");
    expect(script).toContain('test "${pitr}" = "ENABLED"');
  });

  /* AD-15's bound, asserted against the deployed function. `0` is distinguished
   * from the configured value on purpose: a reservation of zero makes the
   * function INERT - every invocation throttled - and it is the one value that
   * would look like a successful reservation in a template diff. */
  it("distinguishes a real reservation from None and from 0", () => {
    const script = step(DEPLOY, "reserved concurrency is in force").run as string;

    expect(script).toContain("lambda get-function-concurrency");
    expect(script).toContain('test "${reserved}" != "None"');
    expect(script).toContain('test "${reserved}" != "0"');
    expect(script).toContain(
      'test "${reserved}" = "${BILLING_FUNCTION_RESERVED_CONCURRENCY}"',
    );
    expect(DEPLOY.env.BILLING_FUNCTION_RESERVED_CONCURRENCY).toBe("10");
  });

  /* The only smoke test this pipeline can make: `GET /plans` is AD-3's public
   * route, so it needs no credential. There is deliberately NO authenticated
   * smoke test - no user token exists in CI, and minting one would mean a
   * long-lived credential this workflow exists to avoid. */
  it("smoke-tests the public catalog and nothing authenticated", () => {
    const script = step(DEPLOY, "Smoke-test the public plan catalog")
      .run as string;

    expect(script).toContain("/v1/billing/plans");
    expect(script).toContain('test "${code}" = "200"');
    expect(script).toContain("cache_ttl_seconds");
    expect(script).toContain("price_id");
    expect(script).not.toContain("Authorization:");
    expect(script).not.toContain("/v1/billing/entitlement");
    expect(script).not.toContain("/v1/billing/checkout");
  });

  it("uses unique temp files in every gate that writes one", () => {
    for (const fragment of [
      MAPPING_GATE,
      ROUTING_GATE,
      "Smoke-test the public plan catalog",
    ]) {
      const script = step(DEPLOY, fragment).run as string;
      expect(script, fragment).toContain("mktemp -d");
      expect(script, fragment).toContain("trap cleanup EXIT");
      expect(script, fragment).not.toContain("/tmp/");
    }
  });
});
