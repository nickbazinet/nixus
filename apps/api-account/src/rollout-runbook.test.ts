import { describe, expect, it } from "vitest";

import { readRepoFile } from "./lib/testing/cfn.ts";

/*
 * The runbook is the only place two safety-critical procedures exist, because
 * neither can be automated by this pipeline:
 *
 *   - the Cognito scope merge, where a CLI call that looks right deletes
 *     nixus-api/ai.invoke and takes hosted AI down for every user, and
 *   - applying the bootstrap, which is what makes the OIDC deploy possible at all.
 *
 * So the runbook carries contract weight, and these assertions are what keep an
 * edit from quietly dropping a step.
 */

const RUNBOOK = readRepoFile("docs/runbooks/account-rollout.md");

describe("the runbook names the stack, the role, and the trusted subject", () => {
  it("pins the stack, region, and deploy identity", () => {
    expect(RUNBOOK).toContain("nixus-account");
    expect(RUNBOOK).toContain("us-east-1");
    expect(RUNBOOK).toContain("nixus-account-github-deploy");
    expect(RUNBOOK).toContain(
      "repo:nickbazinet/nixus:environment:production"
    );
  });

  it("states that only the workflow may deploy, with no long-lived key", () => {
    expect(RUNBOOK).toMatch(/no long-lived AWS key/i);
    expect(RUNBOOK).toContain(".github/workflows/account-ci.yml");
  });
});

describe("the bootstrap is applied by hand, with the exact command", () => {
  it("carries the apply command, its capability, and the output read", () => {
    expect(RUNBOOK).toContain("aws cloudformation deploy");
    expect(RUNBOOK).toContain(
      "--template-file infra/bootstrap/account-oidc-deploy.yaml"
    );
    expect(RUNBOOK).toContain("--stack-name nixus-account-github-oidc");
    expect(RUNBOOK).toContain("--capabilities CAPABILITY_NAMED_IAM");
    expect(RUNBOOK).toContain("DeployRoleArn");
  });

  it("sets the deploy role ARN as a production environment secret", () => {
    expect(RUNBOOK).toContain(
      "gh secret set AWS_ACCOUNT_DEPLOY_ROLE_ARN --env production"
    );
  });

  /* The deploy job's `if` is evaluated before the environment resolves, so the
   * opt-in has to be a repository variable - the same shape the hosted-AI
   * pipeline uses. */
  it("sets the deploy opt-in as a repository variable and says why", () => {
    expect(RUNBOOK).toContain("gh variable set ACCOUNT_DEPLOY_ENABLED");
    expect(RUNBOOK).toMatch(/\*\*repository\*\* variable/);
  });
});

describe("the scope merge procedure is read, merge, submit the full list", () => {
  it("warns that UpdateResourceServer is a full replace", () => {
    expect(RUNBOOK).toMatch(/full replace, not a merge/i);
    expect(RUNBOOK).toMatch(/deletes `ai\.invoke`|\*\*deletes `ai\.invoke`\*\*/);
  });

  it("carries the describe, the update with BOTH scopes, and the re-check", () => {
    expect(RUNBOOK).toContain("aws cognito-idp describe-resource-server");
    expect(RUNBOOK).toContain("aws cognito-idp update-resource-server");
    expect(RUNBOOK).toContain("--identifier nixus-api");
    expect(RUNBOOK).toContain("ScopeName=ai.invoke");
    expect(RUNBOOK).toContain("ScopeName=profile");

    // The update must appear only once, and with both scopes in that one call: a
    // second, profile-only example is exactly the mistake this guards.
    expect(RUNBOOK.match(/update-resource-server/g)).toHaveLength(1);
  });

  it("names the pool once, as the console-managed one", () => {
    expect(RUNBOOK).toContain("us-east-1_7gfGQ0emg");
  });
});

describe("the domain and data guarantees are written down", () => {
  it("checks the routing mode before the first deploy", () => {
    expect(RUNBOOK).toContain("aws apigatewayv2 get-domain-name");
    expect(RUNBOOK).toContain("API_MAPPING_ONLY");
    expect(RUNBOOK).toContain("ROUTING_RULE_THEN_API_MAPPING");
  });

  it("gives the mapping-removal rollback for the one shared resource", () => {
    expect(RUNBOOK).toContain("aws apigatewayv2 delete-api-mapping");
    expect(RUNBOOK).toMatch(/Bedrock-only routing/);
  });

  it("states the four guards on the profile table", () => {
    expect(RUNBOOK).toContain("DeletionPolicy: Retain");
    expect(RUNBOOK).toContain("UpdateReplacePolicy: Retain");
    expect(RUNBOOK).toContain("PITR");
    expect(RUNBOOK).toContain("dynamodb:DeleteTable");
  });

  it("gives both post-deploy curl checks", () => {
    expect(RUNBOOK).toContain("https://api.nixusapp.com/v1/profile");
    expect(RUNBOOK).toContain("https://api.nixusapp.com/v1/ai/status");
  });
});

describe("Epic F is covered by the one application of the bootstrap", () => {
  it("names the two steps the pipeline deliberately cannot do", () => {
    expect(RUNBOOK).toContain("aws ssm put-parameter");
    expect(RUNBOOK).toContain("/nixus-account/web-client-secret");
    expect(RUNBOOK).toContain("lambda:PutResourcePolicy");
  });

  it("records where the web-function action names were verified", () => {
    expect(RUNBOOK).toMatch(/checked against the\s+Service Authorization Reference for AWS Lambda/);
    expect(RUNBOOK).toContain("AccessDenied");
  });

  it("explains the asymmetric trigger that orders bootstrap before application", () => {
    expect(RUNBOOK).toMatch(/pull_request/);
    expect(RUNBOOK).toMatch(/not\*\* a `push`/);
  });
});
