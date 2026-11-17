import { describe, expect, it } from "vitest";

import {
  actionsOf,
  loadTemplate,
  readRepoFile,
  resourcesOfType,
  statementsOf,
  type IamStatement,
} from "./lib/testing/cfn.ts";

/*
 * Contract for the one-time account bootstrap (AD-14's "separately reviewed
 * bootstrap template"). Three properties matter more than anything else here,
 * and none is visible from the application stack:
 *
 *   1. the trust is an EXACT subject match, because a loose one is account-wide
 *      privilege escalation reachable from any fork or branch;
 *   2. this role deploys the stack AND creates its resources - the hosted-AI
 *      pipeline's two-role split is not available here - so it must be unable to
 *      modify itself; and
 *   3. every grant is bounded to the one stack's own name.
 */

const BOOTSTRAP = loadTemplate("infra/bootstrap/account-oidc-deploy.yaml");
const ROLE = "AccountDeployRole";

/* IAM caps a role's inline policies at 10,240 bytes in aggregate, so part of the
 * grant set lives in customer-managed policies attached to this one role. Every
 * assertion below reads the union, so nothing can hide in either half. */
const MANAGED_POLICIES = resourcesOfType(BOOTSTRAP, "AWS::IAM::ManagedPolicy");
const MANAGED_STATEMENTS: IamStatement[] = MANAGED_POLICIES.flatMap(
  ([, policy]) => policy.Properties.PolicyDocument.Statement as IamStatement[]
);
const STATEMENTS = [...statementsOf(BOOTSTRAP, ROLE), ...MANAGED_STATEMENTS];
const ACTIONS = [
  ...actionsOf(BOOTSTRAP, ROLE),
  ...MANAGED_STATEMENTS.flatMap((entry) =>
    Array.isArray(entry.Action) ? entry.Action : [entry.Action]
  ),
];

function statement(sid: string): IamStatement {
  const found = STATEMENTS.find((entry) => entry.Sid === sid);
  expect(found, `no statement with Sid ${sid}`).toBeDefined();
  return found!;
}

function allowedActions(): string[] {
  return STATEMENTS.filter((entry) => entry.Effect === "Allow").flatMap(
    (entry) => (Array.isArray(entry.Action) ? entry.Action : [entry.Action])
  );
}

function resourcesOf(sid: string): string[] {
  const resource = statement(sid).Resource;
  const list = Array.isArray(resource) ? resource : [resource];
  return list.map((entry) =>
    typeof entry === "string"
      ? entry
      : String((entry as { value: unknown }).value)
  );
}

describe("the bootstrap is a reviewed, hand-applied template", () => {
  it("declares itself one-time and is applied by no workflow", () => {
    expect(BOOTSTRAP.text).toContain("ONE-TIME");
    expect(BOOTSTRAP.text).toContain("docs/runbooks/account-rollout.md");

    // A bootstrap workflow would need a static key, which is the thing AD-14
    // removes. There is none for this service, in any form.
    expect(readRepoFile(".github/workflows/account-ci.yml")).not.toContain(
      "account-oidc-deploy.yaml --stack-name"
    );
  });

  it("creates exactly one role and only policies attached to it", () => {
    expect(resourcesOfType(BOOTSTRAP, "AWS::IAM::Role")).toHaveLength(1);
    expect(Object.keys(BOOTSTRAP.resources).sort()).toEqual(
      [ROLE, ...MANAGED_POLICIES.map(([id]) => id)].sort()
    );
    expect(MANAGED_POLICIES.length).toBeGreaterThan(0);
    for (const [id, policy] of MANAGED_POLICIES) {
      expect(policy.Properties.Roles, id).toEqual([{ __cfn: "Ref", value: ROLE }]);
      expect(policy.Properties.Users, id).toBeUndefined();
      expect(policy.Properties.Groups, id).toBeUndefined();
    }
  });

  /* The limit the split exists for: IAM rejects a role whose inline policies
   * total more than 10,240 non-whitespace bytes, and a managed policy over 6,144. */
  it("keeps every policy under its IAM size limit", () => {
    const compact = (value: unknown) => JSON.stringify(value).length;
    const inline = (
      BOOTSTRAP.resources[ROLE].Properties.Policies as { PolicyDocument: unknown }[]
    ).reduce((total, policy) => total + compact(policy.PolicyDocument), 0);
    expect(inline).toBeLessThan(10_240);
    for (const [id, policy] of MANAGED_POLICIES) {
      expect(compact(policy.Properties.PolicyDocument), id).toBeLessThan(6_144);
    }
  });

  /* An account may hold only one provider per issuer URL; the hosted-AI
   * bootstrap already created this one, retained. Creating a second fails with
   * EntityAlreadyExists, and adopting it by parameter would let a wrong ARN be
   * passed - the ARN is fully determined by account and issuer. */
  it("derives the existing OIDC provider instead of creating a second one", () => {
    expect(resourcesOfType(BOOTSTRAP, "AWS::IAM::OIDCProvider")).toEqual([]);

    const trust =
      BOOTSTRAP.resources[ROLE].Properties.AssumeRolePolicyDocument.Statement[0];
    expect(String(trust.Principal.Federated.value)).toBe(
      "arn:${AWS::Partition}:iam::${AWS::AccountId}:oidc-provider/token.actions.githubusercontent.com"
    );
  });

  /* Asserted from both sides, like the hosted-AI pair: the application stack
   * must not define the role that deploys it. */
  it("keeps the deploy role out of the application template", () => {
    const application = readRepoFile("apps/api-account/template.yaml");
    expect(application).not.toContain("AWS::IAM::OIDCProvider");
    expect(application).not.toContain("AssumeRoleWithWebIdentity");
  });
});

describe("the trust policy is an exact subject match", () => {
  const trust =
    BOOTSTRAP.resources[ROLE].Properties.AssumeRolePolicyDocument.Statement[0];

  it("pins the repository and the environment with StringEquals", () => {
    expect(Object.keys(trust.Condition)).toEqual(["StringEquals"]);
    expect(
      trust.Condition.StringEquals["token.actions.githubusercontent.com:sub"]
    ).toEqual({
      __cfn: "Sub",
      value: "repo:${GitHubOrg}/${GitHubRepo}:environment:${GitHubEnvironment}",
    });
  });

  it("resolves to exactly repo:nickbazinet/nixus:environment:production", () => {
    expect(BOOTSTRAP.parameters.GitHubOrg.Default).toBe("nickbazinet");
    expect(BOOTSTRAP.parameters.GitHubRepo.Default).toBe("nixus");
    expect(BOOTSTRAP.parameters.GitHubEnvironment.Default).toBe("production");
    expect(BOOTSTRAP.outputs.TrustedSubject.Value).toEqual({
      __cfn: "Sub",
      value: "repo:${GitHubOrg}/${GitHubRepo}:environment:${GitHubEnvironment}",
    });
  });

  it("restricts the audience and the action", () => {
    expect(
      trust.Condition.StringEquals["token.actions.githubusercontent.com:aud"]
    ).toBe("sts.amazonaws.com");
    expect(trust.Action).toBe("sts:AssumeRoleWithWebIdentity");
  });

  it("uses no wildcard or prefix match anywhere in the trust policy", () => {
    const serialized = JSON.stringify(trust);
    expect(serialized).not.toContain("StringLike");
    expect(serialized).not.toContain("ForAnyValue");
    expect(serialized).not.toContain("*");
  });
});

describe("the Bedrock stack is readable and nothing more", () => {
  it("grants only describe calls on nixus-bedrock-api", () => {
    expect(statement("ReadTheBedrockStackThatOwnsTheDomain").Action).toEqual([
      "cloudformation:DescribeStacks",
      "cloudformation:DescribeStackResource",
    ]);
    expect(resourcesOf("ReadTheBedrockStackThatOwnsTheDomain")).toEqual([
      "arn:${AWS::Partition}:cloudformation:${AWS::Region}:${AWS::AccountId}:stack/nixus-bedrock-api/*",
    ]);
    const writers = STATEMENTS.filter(
      (entry) =>
        entry.Effect === "Allow" &&
        JSON.stringify(entry.Resource ?? "").includes("nixus-bedrock-api") &&
        entry.Sid !== "ReadTheBedrockStackThatOwnsTheDomain"
    );
    expect(writers).toEqual([]);
  });
});

describe("no administrator access and no wildcard actions", () => {
  it("attaches no managed policy", () => {
    expect(BOOTSTRAP.resources[ROLE].Properties.ManagedPolicyArns).toBeUndefined();
    for (const policy of [
      "AdministratorAccess",
      "PowerUserAccess",
      "IAMFullAccess",
      "AmazonDynamoDBFullAccess",
    ]) {
      expect(BOOTSTRAP.text, policy).not.toContain(policy);
    }
  });

  it("never grants a wildcard action, in an Allow or a Deny", () => {
    for (const action of ACTIONS) {
      expect(action, `grants ${action}`).not.toMatch(/\*/);
      expect(action, `${action} is not service-namespaced`).toMatch(
        /^[a-z0-9-]+:[A-Za-z]+$/
      );
    }
  });

  /* A resource wildcard is only acceptable where the AWS action accepts no ARN
   * at all. Enumerating the exceptions by Sid makes a new one a visible change. */
  it("uses a resource wildcard only where the action has no ARN to scope to", () => {
    const unscoped = STATEMENTS.filter(
      (entry) =>
        entry.Effect === "Allow" &&
        (entry.Resource === "*" ||
          (Array.isArray(entry.Resource) && entry.Resource.includes("*")))
    ).map((entry) => entry.Sid);

    expect(unscoped.sort()).toEqual([
      "AttachTheCertificateToTheAccountDomain",
      "CloudFrontAccountLevelResourcesCannotBeNameScoped",
      "FindExplicitLogGroups",
      "TemplateValidationIsNotStackScoped",
    ]);
  });

  it("scopes every other statement to the one stack's own namespace", () => {
    const exempt = new Set([
      "AttachTheCertificateToTheAccountDomain",
      "CloudFrontAccountLevelResourcesCannotBeNameScoped",
      "FindExplicitLogGroups",
      "TemplateValidationIsNotStackScoped",
    ]);

    for (const entry of STATEMENTS) {
      if (entry.Sid && exempt.has(entry.Sid)) continue;

      const resources = resourcesOf(entry.Sid!);
      expect(resources.length, entry.Sid).toBeGreaterThan(0);

      for (const resource of resources) {
        const scoped =
          resource.includes("${ApplicationStackName}") ||
          resource.includes("${ApiDomainName}") ||
          resource.includes("${CognitoUserPoolId}") ||
          resource.includes("${HostedZoneId}") ||
          resource.includes("nixus-sam-artifacts-") ||
          // Read-only, and pinned by its own test below.
          resource.endsWith(":stack/nixus-bedrock-api/*") ||
          // Budget, CloudFront distribution and Route 53 change ARNs carry no
          // name this stack controls.
          resource.includes("budget/") ||
          resource.includes("distribution/") ||
          resource.includes("change/") ||
          resource.includes("transform/Serverless-2016-10-31") ||
          resource.includes("::/restapis") ||
          // An API Gateway tag ARN embeds the tagged resource's own ARN, so it
          // cannot be prefix-matched by stack name. The verbs stay enumerated and
          // the actions are apigateway-only.
          resource.includes("::/tags/");

        expect(scoped, `${entry.Sid} grants on ${resource}`).toBe(true);
      }
    }
  });
});

describe("the one role cannot escalate itself", () => {
  const deny = statement("NeverModifyThisRole");

  it("denies every mutation of its own role, which no later Allow can override", () => {
    expect(deny.Effect).toBe("Deny");
    for (const action of [
      "iam:PutRolePolicy",
      "iam:DeleteRolePolicy",
      "iam:AttachRolePolicy",
      "iam:UpdateAssumeRolePolicy",
      "iam:DeleteRole",
      "iam:PassRole",
    ]) {
      expect(deny.Action, `must deny ${action}`).toContain(action);
    }
    expect(resourcesOf("NeverModifyThisRole")).toEqual([
      "arn:${AWS::Partition}:iam::${AWS::AccountId}:role/${ApplicationStackName}-github-deploy",
    ]);
  });

  /* The role's own name shares the stack's prefix, so the IAM Allow is scoped to
   * the logical-id prefixes CloudFormation derives for the application's roles
   * instead of to the stack prefix itself. */
  it("grants IAM only on the application's own execution-role names", () => {
    for (const sid of ["ApplicationExecutionRoles", "PassApplicationRolesToLambdaOnly"]) {
      const resources = resourcesOf(sid);
      expect(resources).toEqual([
        "arn:${AWS::Partition}:iam::${AWS::AccountId}:role/${ApplicationStackName}-Profile*",
        "arn:${AWS::Partition}:iam::${AWS::AccountId}:role/${ApplicationStackName}-Account*",
        "arn:${AWS::Partition}:iam::${AWS::AccountId}:role/${ApplicationStackName}-Web*",
      ]);
      for (const resource of resources) {
        expect(resource, sid).not.toContain("github-deploy");
      }
    }
  });

  it("passes roles to Lambda only", () => {
    expect(
      statement("PassApplicationRolesToLambdaOnly").Condition?.StringEquals?.[
        "iam:PassedToService"
      ]
    ).toBe("lambda.amazonaws.com");
  });

  it("holds no IAM action that could widen a role beyond an inline policy", () => {
    const allowed = allowedActions().filter((action) =>
      action.startsWith("iam:")
    );

    for (const forbidden of [
      "iam:AttachRolePolicy",
      "iam:DetachRolePolicy",
      "iam:CreatePolicy",
      "iam:CreatePolicyVersion",
      "iam:CreateUser",
      "iam:CreateAccessKey",
      "iam:UpdateAssumeRolePolicy",
      "iam:CreateOpenIDConnectProvider",
    ]) {
      expect(allowed, `must not hold ${forbidden}`).not.toContain(forbidden);
    }
  });
});

describe("the profile table and the shared domain survive the pipeline", () => {
  it("denies deleting the profile table or its backups", () => {
    const deny = statement("NeverDeleteAProfileTableOrItsBackups");
    expect(deny.Effect).toBe("Deny");
    expect(deny.Action).toContain("dynamodb:DeleteTable");
    expect(resourcesOf("NeverDeleteAProfileTableOrItsBackups")[0]).toContain(
      "table/${ApplicationStackName}-profile"
    );
  });

  it("never grants DeleteTable or a bucket deletion in an Allow either", () => {
    const allowed = allowedActions();
    for (const forbidden of [
      "dynamodb:DeleteTable",
      "dynamodb:DeleteBackup",
      "s3:DeleteBucket",
      "s3:PutBucketAcl",
    ]) {
      expect(allowed, `must not hold ${forbidden}`).not.toContain(forbidden);
    }
  });

  /* The domain belongs to nixus-bedrock-api. Mappings under it are this stack's
   * business; the domain, its certificate binding and its DNS record never are. */
  it("denies every mutation of the shared domain itself", () => {
    const deny = statement("NeverChangeTheSharedDomainItself");
    expect(deny.Effect).toBe("Deny");
    expect(deny.Action).toEqual([
      "apigateway:PUT",
      "apigateway:PATCH",
      "apigateway:DELETE",
    ]);
    expect(resourcesOf("NeverChangeTheSharedDomainItself")).toEqual([
      "arn:${AWS::Partition}:apigateway:${AWS::Region}::/domainnames/${ApiDomainName}",
    ]);
  });

  it("allows the api mappings under that domain, and a read of it", () => {
    const resources = resourcesOf("ApiMappingsOnTheSharedDomain");
    expect(resources).toContain(
      "arn:${AWS::Partition}:apigateway:${AWS::Region}::/domainnames/${ApiDomainName}/apimappings"
    );
    expect(resources).toContain(
      "arn:${AWS::Partition}:apigateway:${AWS::Region}::/domainnames/${ApiDomainName}/apimappings/*"
    );
    expect(statement("ApiMappingsOnTheSharedDomain").Action).toContain(
      "apigateway:GET"
    );
    expect(BOOTSTRAP.parameters.ApiDomainName.Default).toBe("api.nixusapp.com");
  });
});

describe("Cognito is read, and only the account app's own client is written", () => {
  it("reads the resource server on exactly one pool", () => {
    expect(statement("ReadTheResourceServerBeforeDeploying").Action).toEqual([
      "cognito-idp:DescribeResourceServer",
      "cognito-idp:DescribeUserPoolClient",
    ]);
    expect(resourcesOf("ReadTheResourceServerBeforeDeploying")[0]).toContain(
      "userpool/${CognitoUserPoolId}"
    );
    expect(BOOTSTRAP.parameters.CognitoUserPoolId.Default).toBe(
      "us-east-1_7gfGQ0emg"
    );
  });

  /* UpdateResourceServer is a full replace: a pipeline able to call it could
   * submit a scope list without nixus-api/ai.invoke and take hosted AI down for
   * every user. The scope merge stays a human runbook step. */
  it("can never create, update, or delete the pool or its resource server", () => {
    const allowed = allowedActions();
    for (const forbidden of [
      "cognito-idp:UpdateResourceServer",
      "cognito-idp:CreateResourceServer",
      "cognito-idp:DeleteResourceServer",
      "cognito-idp:CreateUserPool",
      "cognito-idp:UpdateUserPool",
      "cognito-idp:DeleteUserPool",
      "cognito-idp:CreateUserPoolDomain",
      "cognito-idp:AdminUserGlobalSignOut",
      "cognito-idp:GlobalSignOut",
    ]) {
      expect(allowed, `must not hold ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("covers Epic F's client and managed-login branding on that pool", () => {
    const actions = statement("EpicFWebClientAndBranding").Action as string[];
    for (const required of [
      "cognito-idp:CreateUserPoolClient",
      "cognito-idp:UpdateUserPoolClient",
      "cognito-idp:DeleteUserPoolClient",
      "cognito-idp:CreateManagedLoginBranding",
      "cognito-idp:UpdateManagedLoginBranding",
      "cognito-idp:DeleteManagedLoginBranding",
      "cognito-idp:DescribeManagedLoginBranding",
      "cognito-idp:DescribeManagedLoginBrandingByClient",
    ]) {
      expect(actions, `missing ${required}`).toContain(required);
    }
    expect(resourcesOf("EpicFWebClientAndBranding")[0]).toContain(
      "userpool/${CognitoUserPoolId}"
    );
  });
});

describe("Epic F resources are covered so the bootstrap is applied once", () => {
  it("scopes web functions to the stack's own web-function namespace", () => {
    const resources = resourcesOf("EpicFWebFunctions");
    expect(resources).toEqual([
      "arn:${AWS::Partition}:lambda:${AWS::Region}:${AWS::AccountId}:web-function/${ApplicationStackName}-*",
    ]);

    const actions = statement("EpicFWebFunctions").Action as string[];
    for (const required of [
      "lambda:CreateWebFunction",
      "lambda:CreateWebFunctionRevision",
      "lambda:DeleteWebFunctionRevision",
      "lambda:CreateWebFunctionEndpoint",
      "lambda:UpdateWebFunctionEndpoint",
      "lambda:DeleteWebFunctionEndpoint",
      "lambda:DeleteWebFunction",
      "lambda:PutResourcePolicy",
      "lambda:GetResourcePolicy",
      "lambda:DeleteResourcePolicy",
    ]) {
      expect(actions, `missing ${required}`).toContain(required);
    }
  });

  /* An action that does not exist is silently inert in a policy, so the record of
   * where the web-function action names were checked is part of the contract. */
  it("records that the web-function action names were checked against the IAM reference", () => {
    expect(BOOTSTRAP.text).toContain("AWS::Lambda::WebFunction");
    expect(BOOTSTRAP.text).toContain("Service\n              # Authorization Reference for AWS Lambda");
    expect(BOOTSTRAP.text).not.toContain("ASSUMED");
  });

  it("reads the web client secret only, under this stack's SSM path", () => {
    expect(statement("ReadTheWebClientSecretAtDeployTime").Action).toEqual([
      "ssm:GetParameter",
    ]);
    expect(resourcesOf("ReadTheWebClientSecretAtDeployTime")[0]).toContain(
      "parameter/${ApplicationStackName}/*"
    );

    const allowed = allowedActions();
    for (const forbidden of [
      "ssm:PutParameter",
      "ssm:DeleteParameter",
      "ssm:GetParametersByPath",
    ]) {
      expect(allowed, `must not hold ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("changes DNS only in the supplied hosted zone, which is not committed", () => {
    expect(resourcesOf("AccountDomainDnsRecord")[0]).toContain(
      "hostedzone/${HostedZoneId}"
    );
    expect(BOOTSTRAP.parameters.HostedZoneId).not.toHaveProperty("Default");
  });

  it("names the account hostname as a parameter rather than a literal", () => {
    expect(BOOTSTRAP.parameters.AccountDomainName.Default).toBe(
      "account.nixusapp.com"
    );
  });
});

describe("outputs an operator can wire up without reading the template", () => {
  it("emits the role ARN, the trusted subject, and the provider it trusts", () => {
    expect(Object.keys(BOOTSTRAP.outputs).sort()).toEqual([
      "AccountAppDomainName",
      "DeployRoleArn",
      "OidcProviderArn",
      "SamArtifactBucketName",
      "TrustedSubject",
    ]);
    expect(BOOTSTRAP.outputs.DeployRoleArn.Value).toEqual({
      __cfn: "GetAtt",
      value: "AccountDeployRole.Arn",
    });
    expect(BOOTSTRAP.outputs.DeployRoleArn.Description).toContain(
      "AWS_ACCOUNT_DEPLOY_ROLE_ARN"
    );
  });
});
