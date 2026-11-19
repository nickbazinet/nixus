import { describe, expect, it } from "vitest";

import {
  actionsOf,
  loadTemplate,
  readRepoFile,
  resourcesOfType,
  statementsOf,
  type CfnTemplate,
  type IamStatement,
} from "./lib/testing/cfn.ts";

/*
 * Contract for the one-time OIDC bootstrap (billing AD-15's "separately reviewed
 * OIDC bootstrap template, applied once by the owner from a workstation with no
 * static keys"). Modelled on apps/api-bedrock/src/oidc-bootstrap.test.ts.
 *
 * Three properties matter more than anything else here and none is visible from
 * the application stack:
 *
 *   1. the deploy role's trust is an EXACT subject match, because a loose one is
 *      account-wide privilege escalation reachable from any fork or branch;
 *   2. the pipeline cannot destroy the billing table or the statement signing
 *      key, because neither is reconstructible - the table holds every admin
 *      override, and the key's public half is embedded in released binaries; and
 *   3. the pipeline cannot READ the Stripe secrets, which AD-15 requires and
 *      which is the difference between a CI step that could print key material
 *      and one that cannot.
 */

const BOOTSTRAP = loadTemplate("infra/bootstrap/billing-oidc-deploy.yaml");

const DEPLOY_ROLE = "BillingDeployRole";
const MANAGED_POLICIES = [
  "BillingDeployObservabilityPolicy",
  "BillingDeployCryptoAndArtifactsPolicy",
] as const;

function managedStatements(logicalId: string): IamStatement[] {
  return BOOTSTRAP.resources[logicalId].Properties.PolicyDocument
    .Statement as IamStatement[];
}

function actionsIn(statement: IamStatement): string[] {
  return Array.isArray(statement.Action) ? statement.Action : [statement.Action];
}

/** Every statement the deploy role holds, inline and attached. */
function allStatements(): IamStatement[] {
  return [
    ...statementsOf(BOOTSTRAP, DEPLOY_ROLE),
    ...MANAGED_POLICIES.flatMap(managedStatements),
  ];
}

function allActions(): string[] {
  return allStatements().flatMap(actionsIn);
}

function statementWith(sid: string): IamStatement {
  const found = allStatements().find((statement) => statement.Sid === sid);
  expect(found, `no statement with Sid ${sid}`).toBeDefined();
  return found!;
}

function denies(): IamStatement[] {
  return allStatements().filter((statement) => statement.Effect === "Deny");
}

describe("the bootstrap is the out-of-band step, applied by hand", () => {
  it("declares itself one-time and is applied by no workflow", () => {
    expect(BOOTSTRAP.text).toContain("ONE-TIME");

    const workflow = readRepoFile(".github/workflows/billing-ci.yml");
    expect(workflow).not.toContain("billing-oidc-deploy.yaml\"\n        run");
    // The workflow may LINT the bootstrap; it may never deploy it.
    expect(workflow).not.toMatch(
      /sam deploy[\s\S]{0,400}billing-oidc-deploy/,
    );
    expect(workflow).not.toMatch(
      /cloudformation (deploy|create-stack|update-stack)/,
    );
  });
});

describe("the deploy role's trust is an exact subject match", () => {
  const trust =
    BOOTSTRAP.resources[DEPLOY_ROLE].Properties.AssumeRolePolicyDocument
      .Statement[0];

  /* A loose subject is account-wide escalation reachable from any branch, fork,
   * or pull request. This repository has immutable subject claims disabled, so
   * the plain `repo:owner/name` form is what GitHub emits. */
  it("pins the repository and the environment with StringEquals", () => {
    expect(Object.keys(trust.Condition)).toEqual(["StringEquals"]);
    expect(
      trust.Condition.StringEquals["token.actions.githubusercontent.com:sub"],
    ).toEqual({
      __cfn: "Sub",
      value: "repo:${GitHubOrg}/${GitHubRepo}:environment:${GitHubEnvironment}",
    });
  });

  it("resolves to exactly repo:nickbazinet/nixus:environment:production", () => {
    expect(BOOTSTRAP.parameters.GitHubOrg.Default).toBe("nickbazinet");
    expect(BOOTSTRAP.parameters.GitHubRepo.Default).toBe("nixus");
    expect(BOOTSTRAP.parameters.GitHubEnvironment.Default).toBe("production");
  });

  it("uses no wildcard or prefix match anywhere in the trust policy", () => {
    const serialized = JSON.stringify(trust);

    expect(serialized).not.toContain("StringLike");
    expect(serialized).not.toContain("ForAnyValue");
    expect(serialized).not.toContain("*");
  });

  it("restricts the audience to sts.amazonaws.com", () => {
    expect(
      trust.Condition.StringEquals["token.actions.githubusercontent.com:aud"],
    ).toBe("sts.amazonaws.com");
    expect(trust.Action).toBe("sts:AssumeRoleWithWebIdentity");
  });

  /* Derived, not created: an account holds one provider per issuer URL and this
   * one already exists, retained, from the hosted-AI bootstrap. The same choice
   * account-oidc-deploy.yaml makes, and for the same reason. */
  it("derives the provider ARN rather than creating a second provider", () => {
    expect(trust.Principal.Federated).toEqual({
      __cfn: "Sub",
      value:
        "arn:${AWS::Partition}:iam::${AWS::AccountId}:oidc-provider/token.actions.githubusercontent.com",
    });
    expect(resourcesOfType(BOOTSTRAP, "AWS::IAM::OIDCProvider")).toEqual([]);
    expect(Object.keys(BOOTSTRAP.outputs)).toContain("OidcProviderArn");
    expect(Object.keys(BOOTSTRAP.outputs)).toContain("TrustedSubject");
  });

  it("caps the session at an hour", () => {
    expect(BOOTSTRAP.resources[DEPLOY_ROLE].Properties.MaxSessionDuration).toBe(
      3600,
    );
  });
});

describe("no administrator access and no wildcard actions", () => {
  it("attaches no AWS-managed policy to the role", () => {
    expect(
      BOOTSTRAP.resources[DEPLOY_ROLE].Properties.ManagedPolicyArns,
    ).toBeUndefined();

    for (const forbidden of [
      "AdministratorAccess",
      "PowerUserAccess",
      "IAMFullAccess",
      "AmazonDynamoDBFullAccess",
      "AWSKeyManagementServicePowerUser",
    ]) {
      expect(BOOTSTRAP.text, forbidden).not.toContain(forbidden);
    }
  });

  /* Every action is enumerated, with no `*` of any kind - not a bare one, and not
   * a trailing one, which is what turns an enumerated grant back into an open
   * one. The bucket POLICY's own `s3:*` Deny is excluded on purpose: a Deny that
   * refuses plaintext transport for every action is the one place a wildcard makes
   * the grant narrower rather than wider. */
  it("never grants a wildcard action, inline or attached", () => {
    for (const action of allActions()) {
      expect(action, `grants ${action}`).not.toMatch(/\*/);
      expect(action, action).toMatch(/^[a-z0-9-]+:[A-Za-z]+$/);
    }
  });

  it("keeps the only wildcard action in the bucket's TLS Deny", () => {
    const statement =
      BOOTSTRAP.resources.SamArtifactBucketPolicy.Properties.PolicyDocument
        .Statement[0];

    expect(statement.Action).toBe("s3:*");
    expect(statement.Effect).toBe("Deny");
  });

  /* A resource wildcard is permitted ONLY where the AWS call accepts no ARN at
   * all. Asserted as an exhaustive list, so a new unscoped statement is a
   * deliberate edit to this test. */
  it("uses a resource wildcard only where the action has no ARN to scope to", () => {
    const unscoped = allStatements()
      .filter(
        (statement) =>
          statement.Effect === "Allow" &&
          (statement.Resource === "*" ||
            (Array.isArray(statement.Resource) &&
              statement.Resource.includes("*"))),
      )
      .map((statement) => statement.Sid)
      .sort();

    expect(unscoped).toEqual([
      "CreateTheStatementSigningKey",
      "FindExplicitLogGroups",
      "ProveTheStripeSecretsExist",
      "TemplateValidationIsNotStackScoped",
    ]);
  });

  it("gives every statement a Sid", () => {
    for (const statement of allStatements()) {
      expect(statement.Sid, JSON.stringify(statement.Action)).toBeDefined();
    }
  });
});

describe("the role cannot escalate itself", () => {
  /* This role's name starts with the same prefix the application's own role
   * does, so without the Deny it could rewrite its own policies or trust policy
   * and grant itself anything. A Deny cannot be overridden by any later Allow. */
  it("denies every IAM write against its own ARN", () => {
    const deny = statementWith("NeverModifyThisRole");

    expect(deny.Effect).toBe("Deny");
    for (const action of [
      "iam:CreateRole",
      "iam:DeleteRole",
      "iam:UpdateAssumeRolePolicy",
      "iam:PutRolePolicy",
      "iam:AttachRolePolicy",
      "iam:PassRole",
    ]) {
      expect(actionsIn(deny), action).toContain(action);
    }
    expect(JSON.stringify(deny.Resource)).toContain(
      "role/${ApplicationStackName}-github-deploy",
    );
  });

  /* The application's execution role only, by prefix. iam:AttachRolePolicy,
   * iam:CreatePolicy and every user/group action are absent: an inline policy on
   * a stack-owned role is the only IAM shape the application template
   * declares. */
  it("manages only the application's own execution role, by prefix", () => {
    const statement = statementWith("ApplicationExecutionRole");

    expect(statement.Resource).toEqual([
      {
        __cfn: "Sub",
        value:
          "arn:${AWS::Partition}:iam::${AWS::AccountId}:role/${ApplicationStackName}-Billing*",
      },
    ]);

    // Allowed actions only: iam:AttachRolePolicy is legitimately NAMED by the
    // NeverModifyThisRole Deny, and a scan over every statement would match it
    // there.
    const allowed = allStatements()
      .filter((statement) => statement.Effect === "Allow")
      .flatMap(actionsIn);

    for (const forbidden of [
      "iam:AttachRolePolicy",
      "iam:CreatePolicy",
      "iam:CreateUser",
      "iam:CreateAccessKey",
      "iam:AddUserToGroup",
      "iam:CreateOpenIDConnectProvider",
    ]) {
      expect(allowed, `must not grant ${forbidden}`).not.toContain(forbidden);
    }
  });

  /* PassRole without a PassedToService condition is how a deploy role hands its
   * own permissions to a service of the caller's choosing. Every PassRole here is
   * scoped to the one application role prefix AND conditioned on a single
   * service. */
  it("scopes and conditions every iam:PassRole", () => {
    const passRoles = allStatements().filter(
      (statement) =>
        statement.Effect === "Allow" &&
        actionsIn(statement).includes("iam:PassRole"),
    );

    expect(passRoles).toHaveLength(2);

    const services = passRoles.map(
      (statement) => statement.Condition?.StringEquals?.["iam:PassedToService"],
    );
    expect(services.sort()).toEqual([
      "cloudformation.amazonaws.com",
      "lambda.amazonaws.com",
    ]);

    for (const statement of passRoles) {
      expect(actionsIn(statement), statement.Sid).toEqual(["iam:PassRole"]);
      expect(JSON.stringify(statement.Resource), statement.Sid).toContain(
        "role/${ApplicationStackName}-Billing*",
      );
    }
  });

  it("scopes its CloudFormation rights to the one application stack", () => {
    const statement = statementWith("DriveTheApplicationStackOnly");

    expect(String(JSON.stringify(statement.Resource))).toContain(
      "stack/${ApplicationStackName}/*",
    );
  });

  /* The two stacks that already share the domain are read-only: the post-deploy
   * routing assertions need their ids, and nothing else. */
  it("reads the two stacks sharing the domain and can change neither", () => {
    const statement = statementWith("ReadTheStacksThatShareTheDomain");

    expect(actionsIn(statement).sort()).toEqual([
      "cloudformation:DescribeStackResource",
      "cloudformation:DescribeStacks",
    ]);
    const serialized = JSON.stringify(statement.Resource);
    expect(serialized).toContain("stack/nixus-bedrock-api/*");
    expect(serialized).toContain("stack/nixus-account/*");
  });
});

describe("the table and the signing key cannot be destroyed by the pipeline", () => {
  /* `DeletionPolicy: Retain` stops CloudFormation; these explicit Denies stop a
   * direct API call. A Deny cannot be overridden by any later Allow. */
  it("denies the four destructive actions outright", () => {
    const denied = denies().flatMap(actionsIn);

    for (const action of [
      "dynamodb:DeleteTable",
      "dynamodb:DeleteBackup",
      "kms:ScheduleKeyDeletion",
      "kms:DisableKey",
    ]) {
      expect(denied, `must deny ${action}`).toContain(action);
    }
  });

  it("scopes the table Deny to this stack's tables and the key Deny to its keys", () => {
    const tableDeny = statementWith("NeverDeleteTheBillingTableOrItsBackups");
    expect(JSON.stringify(tableDeny.Resource)).toContain(
      "table/${ApplicationStackName}-*",
    );

    const keyDeny = statementWith("NeverDestroyTheStatementSigningKey");
    expect(JSON.stringify(keyDeny.Resource)).toContain("kms:${AWS::Region}");
    expect(JSON.stringify(keyDeny.Resource)).toContain("key/*");
  });

  it("never ALLOWS any of the four, in any statement", () => {
    const allowed = allStatements()
      .filter((statement) => statement.Effect === "Allow")
      .flatMap(actionsIn);

    for (const action of [
      "dynamodb:DeleteTable",
      "dynamodb:DeleteBackup",
      "kms:ScheduleKeyDeletion",
      "kms:DisableKey",
    ]) {
      expect(allowed, `must not allow ${action}`).not.toContain(action);
    }
  });

  it("still grants the table and key operations a deploy genuinely needs", () => {
    const table = statementWith("TheBillingTableWithoutDeletion");
    expect(actionsIn(table)).toContain("dynamodb:CreateTable");
    expect(actionsIn(table)).toContain("dynamodb:UpdateTable");
    expect(actionsIn(table)).toContain("dynamodb:UpdateContinuousBackups");
    expect(actionsIn(table)).toContain("dynamodb:UpdateTimeToLive");
    // The GSI lives under the table ARN's own index path.
    expect(JSON.stringify(table.Resource)).toContain("/index/*");

    expect(actionsIn(statementWith("CreateTheStatementSigningKey"))).toEqual([
      "kms:CreateKey",
    ]);
    const manage = statementWith("ManageTheStatementSigningKey");
    expect(actionsIn(manage)).toContain("kms:PutKeyPolicy");
    expect(actionsIn(manage)).toContain("kms:DescribeKey");
    expect(actionsIn(statementWith("ManageTheStatementSigningKeyAlias"))).toContain(
      "kms:CreateAlias",
    );
  });

  /* AD-15 requires the reservation, and it is a separate API from the function
   * configuration: without these the function deploys with NO reservation and
   * nothing fails, which is the silent outcome the reservation exists to
   * prevent. */
  it("grants the concurrency API the reservation needs", () => {
    const statement = statementWith("TheBillingFunction");

    for (const action of [
      "lambda:PutFunctionConcurrency",
      "lambda:GetFunctionConcurrency",
      "lambda:DeleteFunctionConcurrency",
    ]) {
      expect(actionsIn(statement), action).toContain(action);
    }
  });
});

describe("AD-15 the pipeline cannot read Stripe key material", () => {
  /* `DescribeParameters` returns metadata - name, type, last-modified - and has
   * no way to return a value. `GetParameter` would hand a workflow run the live
   * Stripe secret key, so it is not granted at any path. Only the Lambda's own
   * execution role may read the values, and only at cold start (AD-7). */
  it("grants a metadata listing and no value read", () => {
    const ssmActions = allActions().filter((action) =>
      action.startsWith("ssm:"),
    );

    expect(ssmActions).toEqual(["ssm:DescribeParameters"]);

    for (const forbidden of [
      "ssm:GetParameter",
      "ssm:GetParameters",
      "ssm:GetParametersByPath",
      "ssm:PutParameter",
      "ssm:DeleteParameter",
    ]) {
      expect(ssmActions, `must not grant ${forbidden}`).not.toContain(forbidden);
    }
  });

  /* The action takes no resource ARN - it is an account-level listing filtered by
   * the caller - so `*` is the only form IAM accepts, and the bound is the
   * action's own inability to return a value. The rationale is recorded in the
   * template so a later reviewer does not "tighten" it into a GetParameter. */
  it("records why the listing is unscoped and a value read is refused", () => {
    expect(statementWith("ProveTheStripeSecretsExist").Resource).toBe("*");
    expect(BOOTSTRAP.text).toContain("metadata only");
    expect(BOOTSTRAP.text).toContain("ssm:GetParameter");
  });

  it("grants the role no decrypt of the Parameter Store key either", () => {
    expect(allActions()).not.toContain("kms:Decrypt");
  });

  it("commits no Stripe key material in any form", () => {
    for (const forbidden of ["sk_test_", "sk_live_", "whsec_", "rk_live_"]) {
      expect(BOOTSTRAP.text, forbidden).not.toContain(forbidden);
    }
  });
});

describe("the shared domain is read, never changed", () => {
  /* The domain belongs to nixus-bedrock-api. Mappings under it are this stack's
   * business; the domain itself never is. */
  it("denies every mutating verb on the bare domain resource", () => {
    const deny = statementWith("NeverChangeTheSharedDomainItself");

    expect(deny.Effect).toBe("Deny");
    expect(actionsIn(deny).sort()).toEqual([
      "apigateway:DELETE",
      "apigateway:PATCH",
      "apigateway:PUT",
    ]);
    expect(deny.Resource).toEqual([
      {
        __cfn: "Sub",
        value:
          "arn:${AWS::Partition}:apigateway:${AWS::Region}::/domainnames/${ApiDomainName}",
      },
    ]);
  });

  it("manages mappings under the domain and reads the domain itself", () => {
    const statement = statementWith("ApiMappingsOnTheSharedDomain");
    const serialized = JSON.stringify(statement.Resource);

    expect(serialized).toContain("/domainnames/${ApiDomainName}/apimappings");
    expect(serialized).toContain("/domainnames/${ApiDomainName}/apimappings/*");
    expect(actionsIn(statement)).toContain("apigateway:GET");
    expect(actionsIn(statement)).toContain("apigateway:POST");
  });

  /* The residual exposure is real and is bounded by the post-deploy assertion
   * rather than by IAM, because API Gateway offers no way to scope a mapping
   * grant to one KEY. The template has to say so, or the next reviewer reads the
   * prefix grant as intentional breadth. */
  it("records that another stack's mapping is bounded by the post-deploy gate", () => {
    expect(BOOTSTRAP.text).toContain("RESIDUAL EXPOSURE");
    expect(BOOTSTRAP.text).toContain("v1/profile");
  });

  it("writes nothing to Cognito, only reading the resource server", () => {
    const cognito = allActions().filter((action) =>
      action.startsWith("cognito-idp:"),
    );

    expect(cognito).toEqual(["cognito-idp:DescribeResourceServer"]);
    // UpdateResourceServer is a FULL REPLACE, so a pipeline that could call it
    // could delete nixus-api/ai.invoke and take hosted AI down.
    expect(BOOTSTRAP.text).not.toContain("cognito-idp:UpdateResourceServer");
  });
});

describe("the artifact bucket is private, encrypted, versioned, and retained", () => {
  const bucket = BOOTSTRAP.resources.SamArtifactBucket;

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
    expect(bucket.Properties.OwnershipControls.Rules).toEqual([
      { ObjectOwnership: "BucketOwnerEnforced" },
    ]);
  });

  it("encrypts at rest and versions objects", () => {
    expect(
      bucket.Properties.BucketEncryption.ServerSideEncryptionConfiguration[0]
        .ServerSideEncryptionByDefault.SSEAlgorithm,
    ).toBe("AES256");
    expect(bucket.Properties.VersioningConfiguration.Status).toBe("Enabled");
  });

  it("refuses plaintext transport", () => {
    const statement =
      BOOTSTRAP.resources.SamArtifactBucketPolicy.Properties.PolicyDocument
        .Statement[0];

    expect(statement.Effect).toBe("Deny");
    expect(statement.Condition.Bool["aws:SecureTransport"]).toBe(false);
  });

  it("gives the role upload rights but no bucket administration", () => {
    const s3Actions = allActions().filter((action) => action.startsWith("s3:"));

    expect(s3Actions).toContain("s3:PutObject");
    expect(s3Actions).not.toContain("s3:DeleteBucket");
    expect(s3Actions).not.toContain("s3:PutBucketPolicy");
    expect(s3Actions).not.toContain("s3:PutBucketVersioning");
    expect(s3Actions).not.toContain("s3:DeleteObject");
  });

  it("publishes the role ARN and the bucket name a rollout needs", () => {
    expect(Object.keys(BOOTSTRAP.outputs).sort()).toEqual([
      "DeployRoleArn",
      "OidcProviderArn",
      "SamArtifactBucketName",
      "StripeSecretParameterPaths",
      "TrustedSubject",
    ]);
  });
});

/* AD-15 forbids the application stack from defining the role that deploys it.
 * This bootstrap stack is that requirement's counterpart, so the invariant is
 * asserted from both sides. */
describe("the application stack defines no OIDC provider", () => {
  const application: CfnTemplate = loadTemplate("apps/api-billing/template.yaml");

  it("keeps the provider and the deploy role in the bootstrap stack only", () => {
    expect(application.text).not.toContain("AWS::IAM::OIDCProvider");
    expect(application.text).not.toContain("token.actions.githubusercontent.com");
    expect(application.text).not.toContain("AssumeRoleWithWebIdentity");
    expect(BOOTSTRAP.text).toContain("oidc-provider/token.actions.githubusercontent.com");
  });

  it("creates exactly one role in the bootstrap, and it is not an exec pair", () => {
    expect(
      resourcesOfType(BOOTSTRAP, "AWS::IAM::Role").map(([name]) => name),
    ).toEqual([DEPLOY_ROLE]);
    expect(
      resourcesOfType(BOOTSTRAP, "AWS::IAM::ManagedPolicy")
        .map(([name]) => name)
        .sort(),
    ).toEqual([...MANAGED_POLICIES].sort());
  });

  /* Inline policies are capped at 10,240 bytes in aggregate per role, which the
   * full grant set exceeds - hence the two customer-managed policies. They are
   * attached only to this role, which holds no IAM permission on managed
   * policies, so it cannot change them either. */
  it("attaches the managed policies to the deploy role alone", () => {
    for (const policy of MANAGED_POLICIES) {
      expect(BOOTSTRAP.resources[policy].Properties.Roles).toEqual([
        { __cfn: "Ref", value: DEPLOY_ROLE },
      ]);
    }
    expect(actionsOf(BOOTSTRAP, DEPLOY_ROLE)).not.toContain(
      "iam:CreatePolicyVersion",
    );
  });
});
