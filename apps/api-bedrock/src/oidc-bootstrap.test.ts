import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

/*
 * Contract for the one-time OIDC bootstrap (AD-12's "separately reviewed bootstrap
 * stack or manual step"). Two properties matter more than anything else here and
 * neither is visible from the application stack:
 *
 *   1. the deploy role's trust is an EXACT subject match, because a loose one is
 *      account-wide privilege escalation reachable from any fork or branch, and
 *   2. the two roles stay separated, because a deploy role that can create IAM
 *      roles can grant itself anything.
 */

const REPO_ROOT = new URL("../../../", import.meta.url);

function readRepoFile(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, REPO_ROOT)), "utf8");
}

const CFN_TAGS = [
  "Ref",
  "Sub",
  "GetAtt",
  "If",
  "Equals",
  "Join",
  "Select",
  "Split",
  "FindInMap",
  "ImportValue",
  "Not",
  "And",
  "Or",
  "Base64",
  "Condition",
] as const;

const customTags = CFN_TAGS.flatMap((name) => [
  {
    tag: `!${name}`,
    resolve: (value: string) => ({ __cfn: name, value }),
  },
  {
    tag: `!${name}`,
    collection: "seq" as const,
    resolve: (seq: { toJSON: () => unknown }) => ({
      __cfn: name,
      value: seq.toJSON(),
    }),
  },
]);

const BOOTSTRAP_TEXT = readRepoFile("infra/bootstrap/github-oidc-deploy.yaml");
const WORKFLOW_TEXT = readRepoFile(
  ".github/workflows/api-bedrock-oidc-bootstrap.yml"
);

/* A CloudFormation template and a workflow are untyped documents; this file is the
 * type boundary for both. */
/* eslint-disable @typescript-eslint/no-explicit-any */
const BOOTSTRAP = parse(BOOTSTRAP_TEXT, { customTags }) as any;
const WORKFLOW = parse(WORKFLOW_TEXT) as any;

const RESOURCES: Record<string, any> = BOOTSTRAP.Resources;

function statementsOf(roleLogicalId: string): any[] {
  const policies = RESOURCES[roleLogicalId].Properties.Policies as any[];
  return policies.flatMap((policy) => policy.PolicyDocument.Statement);
}

function actionsOf(roleLogicalId: string): string[] {
  return statementsOf(roleLogicalId).flatMap((statement) =>
    Array.isArray(statement.Action) ? statement.Action : [statement.Action]
  );
}
/* eslint-enable @typescript-eslint/no-explicit-any */

describe("the bootstrap workflow is dispatch-only and temporary", () => {
  it("has no automatic trigger, so merging it cannot deploy anything", () => {
    const triggers = Object.keys(WORKFLOW.on ?? WORKFLOW[true as never]);

    expect(triggers).toEqual(["workflow_dispatch"]);
    expect(triggers).not.toContain("push");
    expect(triggers).not.toContain("pull_request");
    expect(triggers).not.toContain("schedule");
  });

  it("declares itself temporary and states how to remove it", () => {
    expect(WORKFLOW.name).toContain("TEMPORARY");
    expect(BOOTSTRAP_TEXT).toContain("ONE-TIME");
    expect(WORKFLOW_TEXT).toMatch(/DELETE THIS FILE AFTER IT SUCCEEDS ONCE/);
    expect(WORKFLOW_TEXT).toContain(
      "git rm .github/workflows/api-bedrock-oidc-bootstrap.yml"
    );
  });

  it("requires typed confirmation before using the privileged keys", () => {
    expect(WORKFLOW.on.workflow_dispatch.inputs.confirm.required).toBe(true);

    const gate = WORKFLOW.jobs.bootstrap.steps.find(
      (step: { name?: string }) => step.name === "Require explicit confirmation"
    );
    expect(gate.if).toContain("inputs.confirm != 'BOOTSTRAP'");
    expect(gate.run).toContain("exit 1");
  });

  /* This is the only file permitted to use them, and only because nothing can create
   * an OIDC provider over OIDC. */
  it("uses the legacy static keys here and nowhere else in the hosted-AI pipeline", () => {
    expect(WORKFLOW_TEXT).toContain("secrets.AWS_ACCESS_KEY_ID");
    expect(WORKFLOW_TEXT).toContain("secrets.AWS_SECRET_ACCESS_KEY");

    const appPipeline = readRepoFile(".github/workflows/api-bedrock-ci.yml")
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("#"))
      .join("\n");
    expect(appPipeline).not.toContain("AWS_ACCESS_KEY_ID");
    expect(appPipeline).not.toContain("AWS_SECRET_ACCESS_KEY");
  });

  it("prechecks for an existing provider and reconciles the operator's choice", () => {
    const commands = WORKFLOW.jobs.bootstrap.steps
      .map((step: { run?: string }) => step.run ?? "")
      .join("\n");

    expect(commands).toContain("list-open-id-connect-providers");
    expect(commands).toContain("token.actions.githubusercontent.com");
    // An account holds one provider per issuer, so create-vs-adopt must be checked
    // against reality rather than trusted from the input.
    expect(commands).toMatch(/already exists/i);
    expect(commands).toMatch(/No provider exists to adopt/i);
  });

  it("deploys with named-IAM capability and prints the outputs to copy", () => {
    const commands = WORKFLOW.jobs.bootstrap.steps
      .map((step: { run?: string }) => step.run ?? "")
      .join("\n");

    expect(commands).toContain("CAPABILITY_NAMED_IAM");
    expect(commands).not.toContain("CAPABILITY_AUTO_EXPAND");
    expect(commands).toContain("describe-stacks");
    expect(commands).toContain("AWS_BEDROCK_DEPLOY_ROLE_ARN");
    expect(commands).toContain("AWS_BEDROCK_CFN_EXEC_ROLE_ARN");
    expect(commands).toContain("SAM_ARTIFACT_BUCKET");
  });

  it("is never cancelled mid-bootstrap", () => {
    expect(WORKFLOW.concurrency["cancel-in-progress"]).toBe(false);
  });
});

describe("the deploy role's trust is an exact subject match", () => {
  const trust =
    RESOURCES.GitHubDeployRole.Properties.AssumeRolePolicyDocument.Statement[0];

  /* A loose subject is account-wide escalation reachable from any branch, fork, or
   * pull request. This repository has immutable subject claims disabled, so the plain
   * `repo:owner/name` form is what GitHub emits. */
  it("pins the repository and the environment with StringEquals", () => {
    const condition = trust.Condition;

    expect(Object.keys(condition)).toEqual(["StringEquals"]);
    expect(condition.StringEquals).toHaveProperty(
      "token.actions.githubusercontent.com:sub"
    );
    expect(
      condition.StringEquals["token.actions.githubusercontent.com:sub"]
    ).toEqual({
      __cfn: "Sub",
      value: "repo:${GitHubOrg}/${GitHubRepo}:environment:${GitHubEnvironment}",
    });
  });

  it("resolves to exactly repo:nickbazinet/nixus:environment:production", () => {
    const parameters = BOOTSTRAP.Parameters;

    expect(parameters.GitHubOrg.Default).toBe("nickbazinet");
    expect(parameters.GitHubRepo.Default).toBe("nixus");
    expect(parameters.GitHubEnvironment.Default).toBe("production");
  });

  it("uses no wildcard or prefix match anywhere in the trust policy", () => {
    const serialized = JSON.stringify(trust);

    expect(serialized).not.toContain("StringLike");
    expect(serialized).not.toContain("ForAnyValue");
    expect(serialized).not.toContain("*");
  });

  it("restricts the audience to sts.amazonaws.com", () => {
    expect(
      trust.Condition.StringEquals["token.actions.githubusercontent.com:aud"]
    ).toBe("sts.amazonaws.com");
    expect(trust.Action).toBe("sts:AssumeRoleWithWebIdentity");
  });

  it("federates only to the provider this stack creates or adopts", () => {
    expect(trust.Principal.Federated).toMatchObject({ __cfn: "If" });
  });
});

describe("no administrator access and no wildcard actions", () => {
  const roles = ["GitHubDeployRole", "CloudFormationExecutionRole"];

  it("attaches no managed policy to either role", () => {
    for (const role of roles) {
      expect(
        RESOURCES[role].Properties.ManagedPolicyArns,
        `${role} must carry no managed policy`
      ).toBeUndefined();
    }
    expect(BOOTSTRAP_TEXT).not.toContain("AdministratorAccess");
    expect(BOOTSTRAP_TEXT).not.toContain("PowerUserAccess");
    expect(BOOTSTRAP_TEXT).not.toContain("IAMFullAccess");
  });

  it("never grants a wildcard action, in either role", () => {
    for (const role of roles) {
      for (const action of actionsOf(role)) {
        expect(action, `${role} grants ${action}`).not.toBe("*");
        // Rejects `iam:*` and bare `*` alike; a trailing wildcard is what turns an
        // enumerated grant back into an open one.
        expect(action, `${role} grants ${action}`).not.toMatch(/\*/);
      }
    }
  });

  it("keeps every action namespaced to a service", () => {
    for (const role of roles) {
      for (const action of actionsOf(role)) {
        expect(action, `${role}: ${action}`).toMatch(/^[a-z0-9-]+:[A-Za-z]+$/);
      }
    }
  });

  it("uses a resource wildcard only where the action has no ARN to scope to", () => {
    const unscoped = statementsOf("GitHubDeployRole")
      .concat(statementsOf("CloudFormationExecutionRole"))
      .filter(
        (statement) =>
          statement.Effect === "Allow" &&
          (statement.Resource === "*" ||
            (Array.isArray(statement.Resource) &&
              statement.Resource.includes("*")))
      )
      .map((statement) => statement.Sid);

    // Template validation, and ACM certificate lookup for the custom domain, are the
    // only two AWS calls here that accept no resource ARN.
    expect(unscoped.sort()).toEqual([
      "AttachTheCertificateToTheDomain",
      "TemplateValidationIsNotStackScoped",
    ]);
  });
});

describe("two-role separation", () => {
  it("creates a deploy role and a separate CloudFormation execution role", () => {
    const roles = Object.entries(RESOURCES).filter(
      ([, resource]) => resource.Type === "AWS::IAM::Role"
    );

    expect(roles.map(([name]) => name).sort()).toEqual([
      "CloudFormationExecutionRole",
      "GitHubDeployRole",
    ]);
  });

  it("lets only CloudFormation assume the execution role, never GitHub", () => {
    const trust =
      RESOURCES.CloudFormationExecutionRole.Properties.AssumeRolePolicyDocument
        .Statement[0];

    expect(trust.Principal).toEqual({ Service: "cloudformation.amazonaws.com" });
    expect(JSON.stringify(trust)).not.toContain("Federated");
    expect(trust.Action).toBe("sts:AssumeRole");
    // Confused-deputy guard: only this account's CloudFormation.
    expect(trust.Condition.StringEquals["aws:SourceAccount"]).toEqual({
      __cfn: "Ref",
      value: "AWS::AccountId",
    });
  });

  /* A deploy role that can create or edit an IAM role can grant itself anything, so
   * PassRole to exactly one role is its entire IAM surface. */
  it("gives the deploy role no IAM write beyond PassRole to the one exec role", () => {
    const iamActions = actionsOf("GitHubDeployRole").filter((action) =>
      action.startsWith("iam:")
    );

    expect(iamActions).toEqual(["iam:PassRole"]);

    const passRole = statementsOf("GitHubDeployRole").find(
      (statement) => statement.Sid === "PassExactlyTheCfnExecutionRole"
    );
    expect(passRole.Resource).toEqual([
      { __cfn: "GetAtt", value: "CloudFormationExecutionRole.Arn" },
    ]);
    expect(passRole.Condition.StringEquals["iam:PassedToService"]).toBe(
      "cloudformation.amazonaws.com"
    );
  });

  it("gives the deploy role no permission to create application resources", () => {
    const actions = actionsOf("GitHubDeployRole");

    for (const forbidden of [
      "lambda:CreateFunction",
      "lambda:UpdateFunctionCode",
      "dynamodb:CreateTable",
      "iam:CreateRole",
      "iam:PutRolePolicy",
      "iam:AttachRolePolicy",
      "sns:CreateTopic",
      "cloudwatch:PutMetricAlarm",
    ]) {
      expect(actions, `deploy role must not hold ${forbidden}`).not.toContain(
        forbidden
      );
    }
  });

  it("scopes the deploy role's CloudFormation rights to the one application stack", () => {
    const driveStack = statementsOf("GitHubDeployRole").find(
      (statement) => statement.Sid === "DriveTheApplicationStackOnly"
    );

    expect(driveStack.Resource[0]).toMatchObject({ __cfn: "Sub" });
    expect(String(driveStack.Resource[0].value)).toContain(
      "stack/${ApplicationStackName}/*"
    );
  });

  it("lets the execution role apply only the SAM transform", () => {
    const transform = statementsOf("CloudFormationExecutionRole").find(
      (statement) => statement.Sid === "ApplyTheSamTransform"
    );

    expect(transform.Action).toEqual(["cloudformation:CreateChangeSet"]);
    expect(transform.Resource).toEqual([
      {
        __cfn: "Sub",
        value:
          "arn:${AWS::Partition}:cloudformation:${AWS::Region}:aws:transform/Serverless-2016-10-31",
      },
    ]);
  });

  it("limits the exec role's role management to the application's own role path", () => {
    const roleStatement = statementsOf("CloudFormationExecutionRole").find(
      (statement) => statement.Sid === "TheLambdaExecutionRole"
    );

    // Prefixed by stack name, so it cannot reach the two roles this bootstrap owns
    // (`-github-deploy` and `-cfn-exec`).
    expect(String(roleStatement.Resource[0].value)).toContain(
      "role/${ApplicationStackName}-Hosted"
    );
    expect(roleStatement.Action).not.toContain("iam:CreateUser");
    expect(roleStatement.Action).not.toContain("iam:AttachRolePolicy");
  });

  it("lets CloudFormation tag only the hosted AI budget", () => {
    const budget = statementsOf("CloudFormationExecutionRole").find(
      (statement) => statement.Sid === "BedrockSpendBudget"
    );

    expect(budget.Action).toEqual([
      "budgets:ModifyBudget",
      "budgets:ViewBudget",
      "budgets:TagResource",
      "budgets:UntagResource",
    ]);
    expect(String(budget.Resource[0].value)).toContain(
      "budgets::${AWS::AccountId}:budget/*"
    );
  });
});

describe("the quota table cannot be destroyed by the deploy path", () => {
  /* AD-15: `DeletionPolicy: Retain` stops CloudFormation, and this explicit Deny
   * stops a direct API call. A Deny cannot be overridden by any later Allow. */
  it("explicitly denies DeleteTable on the execution role", () => {
    const deny = statementsOf("CloudFormationExecutionRole").find(
      (statement) => statement.Effect === "Deny"
    );

    expect(deny).toBeDefined();
    expect(deny.Action).toContain("dynamodb:DeleteTable");
    expect(deny.Resource).toBe("*");
  });

  it("never grants DeleteTable to either role", () => {
    for (const role of ["GitHubDeployRole", "CloudFormationExecutionRole"]) {
      const allowed = statementsOf(role)
        .filter((statement) => statement.Effect === "Allow")
        .flatMap((statement) =>
          Array.isArray(statement.Action) ? statement.Action : [statement.Action]
        );
      expect(allowed, role).not.toContain("dynamodb:DeleteTable");
    }
  });

  it("still grants the table operations a deploy genuinely needs", () => {
    const table = statementsOf("CloudFormationExecutionRole").find(
      (statement) => statement.Sid === "QuotaTableWithoutDeletion"
    );

    expect(table.Action).toContain("dynamodb:CreateTable");
    expect(table.Action).toContain("dynamodb:UpdateTable");
    expect(table.Action).toContain("dynamodb:UpdateContinuousBackups");
  });
});

describe("the artifact bucket is private, encrypted, versioned, and retained", () => {
  const bucket = RESOURCES.SamArtifactBucket;

  it("is retained so a rollback can still fetch a previous package", () => {
    expect(bucket.DeletionPolicy).toBe("Retain");
    expect(bucket.UpdateReplacePolicy).toBe("Retain");
  });

  it("blocks all public access", () => {
    expect(bucket.Properties.PublicAccessBlockConfiguration).toEqual({
      BlockPublicAcls: true,
      BlockPublicPolicy: true,
      IgnorePublicAcls: true,
      RestrictPublicBuckets: true,
    });
  });

  it("encrypts at rest and versions objects", () => {
    expect(
      bucket.Properties.BucketEncryption.ServerSideEncryptionConfiguration[0]
        .ServerSideEncryptionByDefault.SSEAlgorithm
    ).toBe("AES256");
    expect(bucket.Properties.VersioningConfiguration.Status).toBe("Enabled");
  });

  it("refuses plaintext transport", () => {
    const statement =
      RESOURCES.SamArtifactBucketPolicy.Properties.PolicyDocument.Statement[0];

    expect(statement.Effect).toBe("Deny");
    expect(statement.Condition.Bool["aws:SecureTransport"]).toBe(false);
  });

  it("gives the deploy role upload rights but not bucket administration", () => {
    const s3Actions = actionsOf("GitHubDeployRole").filter((action) =>
      action.startsWith("s3:")
    );

    expect(s3Actions).toContain("s3:PutObject");
    expect(s3Actions).not.toContain("s3:DeleteBucket");
    expect(s3Actions).not.toContain("s3:PutBucketPolicy");
    expect(s3Actions).not.toContain("s3:DeleteObject");
  });
});

describe("create-or-adopt keeps a second run from failing on the provider", () => {
  it("offers exactly the two boolean choices", () => {
    expect(BOOTSTRAP.Parameters.CreateOidcProvider.AllowedValues).toEqual([
      "true",
      "false",
    ]);
    expect(BOOTSTRAP.Parameters.CreateOidcProvider.Default).toBe("true");
  });

  it("guards the provider resource with the condition", () => {
    expect(RESOURCES.GitHubOidcProvider.Condition).toBe(
      "ShouldCreateOidcProvider"
    );
    expect(BOOTSTRAP.Conditions.ShouldCreateOidcProvider).toBeDefined();
  });

  it("retains the provider so tearing this stack down cannot break another pipeline", () => {
    expect(RESOURCES.GitHubOidcProvider.DeletionPolicy).toBe("Retain");
  });

  it("outputs the trusted subject so a failing run can be diagnosed", () => {
    expect(Object.keys(BOOTSTRAP.Outputs)).toContain("TrustedSubject");
    expect(Object.keys(BOOTSTRAP.Outputs)).toContain("OidcProviderArn");
  });
});

/* AD-12 forbids the application stack from defining the role that deploys it. This
 * bootstrap stack is that requirement's counterpart, so the invariant is asserted
 * from both sides. */
describe("the application stack still defines no OIDC provider", () => {
  it("keeps the provider in the bootstrap stack only", () => {
    const appTemplate = readRepoFile("apps/api-bedrock/template.yaml");

    expect(appTemplate).not.toContain("AWS::IAM::OIDCProvider");
    expect(appTemplate).not.toContain("token.actions.githubusercontent.com");
    expect(BOOTSTRAP_TEXT).toContain("AWS::IAM::OIDCProvider");
  });
});
