import { describe, expect, it } from "vitest";

import {
  ACCOUNT_GATEWAY_RESPONSES,
  type AccountGatewayResponseType,
} from "@nixus/shared";

import {
  actionsOf,
  getAtt,
  loadTemplate,
  readRepoFile,
  ref,
  resourcesOfType,
  statementsOf,
} from "./lib/testing/cfn.ts";

/*
 * Infrastructure-as-tested-contract for the nixus-account stack. Everything the
 * spine fixes about the edge, the table, the IAM grant and the operating envelope
 * is asserted structurally here, because none of it is reachable from a unit test
 * and all of it is a one-line change away from being wrong.
 */

const TEMPLATE = loadTemplate("apps/api-account/template.yaml");
const MAKEFILE = readRepoFile("apps/api-account/Makefile");
const SAMCONFIG = readRepoFile("apps/api-account/samconfig.toml");

/* eslint-disable @typescript-eslint/no-explicit-any */
function props(logicalId: string): any {
  return TEMPLATE.resources[logicalId].Properties;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/* Structural, not textual, and resources only: the template's comments and the
 * ApiDomainName parameter's own description deliberately NAME what this stack
 * refuses to declare - the Bedrock stack, the Bedrock scope, the managed
 * execution policy - so a raw-text scan would match that prose. This is what
 * every absence assertion searches instead. */
const DECLARED = JSON.stringify({
  Resources: TEMPLATE.resources,
  Outputs: TEMPLATE.outputs,
});

describe("template conventions", () => {
  it("is a SAM template on the Node 24 ARM64 conventions (AD-14)", () => {
    expect(TEMPLATE.doc.Transform).toBe("AWS::Serverless-2016-10-31");
    expect(TEMPLATE.doc.Globals.Function.Runtime).toBe("nodejs24.x");
    expect(TEMPLATE.doc.Globals.Function.Architectures).toEqual(["arm64"]);
  });

  it("takes the existing pool and the shared domain as inputs and owns neither", () => {
    for (const name of [
      "CognitoUserPoolArn",
      "CognitoUserPoolId",
      "ApiDomainName",
      "AlertEmail",
    ]) {
      expect(TEMPLATE.parameters, `missing parameter ${name}`).toHaveProperty(
        name
      );
    }
    expect(TEMPLATE.parameters.ApiDomainName.Default).toBe("api.nixusapp.com");

    expect(resourcesOfType(TEMPLATE, "AWS::Cognito::UserPool")).toEqual([]);
    expect(resourcesOfType(TEMPLATE, "AWS::Cognito::UserPoolClient")).toEqual(
      []
    );
    expect(
      resourcesOfType(TEMPLATE, "AWS::Cognito::UserPoolResourceServer")
    ).toEqual([]);
  });

  /* The domain, its certificate and its DNS record belong to nixus-bedrock-api.
   * Owning any of them here is how a profile deploy takes hosted AI down. */
  it("never declares, imports, or re-certifies the shared domain (AD-3)", () => {
    expect(resourcesOfType(TEMPLATE, "AWS::ApiGateway::DomainName")).toEqual([]);
    expect(resourcesOfType(TEMPLATE, "AWS::ApiGatewayV2::DomainName")).toEqual(
      []
    );
    expect(resourcesOfType(TEMPLATE, "AWS::Route53::RecordSet")).toEqual([]);
    expect(resourcesOfType(TEMPLATE, "AWS::CertificateManager::Certificate")).toEqual(
      []
    );
    expect(props("ProfileApi")).not.toHaveProperty("Domain");
    expect(TEMPLATE.parameters).not.toHaveProperty("ApiCertificateArn");
    expect(TEMPLATE.parameters).not.toHaveProperty("HostedZoneId");
    // By name, never by export/import: an import would couple the two stacks.
    expect(DECLARED).not.toContain("ImportValue");
    expect(DECLARED).not.toContain("nixus-bedrock-api");
  });

  it("never defines the OIDC deploy role or provider that deploys this stack (AD-14)", () => {
    expect(resourcesOfType(TEMPLATE, "AWS::IAM::OIDCProvider")).toEqual([]);
    expect(DECLARED).not.toContain("token.actions.githubusercontent.com");
  });
});

describe("AD-3 edge and authorizer", () => {
  it("is a Regional REST API with no reachable default endpoint", () => {
    expect(props("ProfileApi").EndpointConfiguration).toBe("REGIONAL");
    expect(props("ProfileApi").DisableExecuteApiEndpoint).toBe(true);
  });

  it("requires the nixus-api/profile scope and never the Bedrock scope", () => {
    const auth = props("ProfileApi").Auth;
    expect(auth.DefaultAuthorizer).toBe("CognitoAuthorizer");
    expect(auth.Authorizers.CognitoAuthorizer.UserPoolArn).toEqual(
      ref("CognitoUserPoolArn")
    );
    expect(auth.Authorizers.CognitoAuthorizer.AuthorizationScopes).toEqual([
      "nixus-api/profile",
    ]);

    // The reverse half of AD-15's scope gate: ai.invoke authorizes the Bedrock
    // API and must never appear here, in any form.
    expect(DECLARED).not.toContain("ai.invoke");
  });

  /* Every method inherits the default authorizer, and none may opt out: a single
   * `Auth: {Authorizer: NONE}` on one event would publish an unauthenticated
   * route under the shared domain. */
  it("leaves no route able to opt out of the authorizer", () => {
    const events = props("ProfileFunction").Events as Record<
      string,
      { Type: string; Properties: Record<string, unknown> }
    >;

    for (const [name, event] of Object.entries(events)) {
      expect(event.Type, name).toBe("Api");
      expect(event.Properties, name).not.toHaveProperty("Auth");
      expect(event.Properties.RestApiId, name).toEqual(ref("ProfileApi"));
    }
    expect(props("ProfileApi").Auth).not.toHaveProperty("ApiKeyRequired");
  });

  it("serves exactly the five routes, from one Lambda, with the base path stripped", () => {
    const events = props("ProfileFunction").Events as Record<
      string,
      { Properties: { Path: string; Method: string } }
    >;
    const routes = Object.values(events).map((event) => ({
      path: event.Properties.Path,
      method: event.Properties.Method,
    }));

    expect(routes).toHaveLength(5);
    expect(routes).toEqual(
      expect.arrayContaining([
        { path: "/", method: "get" },
        { path: "/", method: "put" },
        { path: "/avatar", method: "get" },
        { path: "/avatar", method: "put" },
        { path: "/locations", method: "get" },
      ])
    );

    // The mapping strips `v1/profile`, so a resource that repeats it would be
    // reachable only at /v1/profile/v1/profile.
    for (const route of routes) {
      expect(route.path).not.toContain("v1");
      expect(route.path).not.toContain("profile");
    }

    expect(resourcesOfType(TEMPLATE, "AWS::Serverless::Function")).toHaveLength(
      1
    );
    expect(resourcesOfType(TEMPLATE, "AWS::Lambda::Function")).toEqual([]);
  });

  it("gzips the 570 KB locations catalog", () => {
    expect(props("ProfileApi").MinimumCompressionSize).toBe(1024);
  });

  it("throttles the stage at 10 RPS / burst 20 with request data tracing off", () => {
    const settings = props("ProfileApi").MethodSettings;
    expect(settings).toHaveLength(1);
    expect(settings[0]).toMatchObject({
      HttpMethod: "*",
      ResourcePath: "/*",
      ThrottlingRateLimit: 10,
      ThrottlingBurstLimit: 20,
      DataTraceEnabled: false,
    });
  });
});

describe("AD-3 API mapping onto the shared domain", () => {
  const mapping = TEMPLATE.resources.ProfileApiMapping;

  it("attaches by an ApiGatewayV2 mapping on the key v1/profile", () => {
    expect(mapping.Type).toBe("AWS::ApiGatewayV2::ApiMapping");
    expect(mapping.Properties.ApiMappingKey).toBe("v1/profile");
    expect(mapping.Properties.ApiId).toEqual(ref("ProfileApi"));
    expect(mapping.Properties.DomainName).toEqual(ref("ApiDomainName"));
  });

  /* `Stage` takes a stage NAME. A Ref to the stage resource would resolve to a
   * logical id, and the mapping would fail to find a stage by that name. */
  it("names the stage as a literal string matching the API's own stage", () => {
    expect(mapping.Properties.Stage).toBe("v1");
    expect(typeof mapping.Properties.Stage).toBe("string");
    expect(props("ProfileApi").StageName).toBe("v1");
  });

  /* The mapping is created in the same change set as the stage, so without this
   * the first deploy races the stage into existence. The referenced logical id is
   * the one the SAM transform generates: <ApiLogicalId><StageName>Stage. */
  it("waits for the SAM-generated stage resource", () => {
    expect(mapping.DependsOn).toBe("ProfileApiv1Stage");
    expect(mapping.DependsOn).toBe(
      `ProfileApi${props("ProfileApi").StageName}Stage`
    );
  });
});

describe("AD-13 gateway responses match the shared contract exactly", () => {
  const responses = props("ProfileApi").GatewayResponses as Record<
    string,
    {
      StatusCode?: number;
      ResponseTemplates: Record<string, string>;
    }
  >;

  it("declares every enumerated type and no others", () => {
    expect(Object.keys(responses).sort()).toEqual(
      Object.keys(ACCOUNT_GATEWAY_RESPONSES).sort()
    );
  });

  it("emits the contract's status and code for each one", () => {
    for (const [type, expected] of Object.entries(ACCOUNT_GATEWAY_RESPONSES)) {
      const response = responses[type as AccountGatewayResponseType]!;
      const body = JSON.parse(response.ResponseTemplates["application/json"]!);

      expect(body.error.code, `${type} code`).toBe(expected.code);
      expect(body.error.request_id, `${type} request id`).toBe(
        "$context.requestId"
      );
      expect(typeof body.error.message, `${type} message`).toBe("string");
      // A gateway response cannot know which field was refused, so it carries
      // none of the per-code members.
      expect(Object.keys(body.error).sort(), `${type} members`).toEqual([
        "code",
        "message",
        "request_id",
      ]);

      if (expected.status === null) {
        // Keeps the gateway's own status, which is the one thing it does know.
        expect(response, `${type} status`).not.toHaveProperty("StatusCode");
      } else {
        expect(response.StatusCode, `${type} status`).toBe(expected.status);
      }
    }
  });

  it("never leaks API Gateway's own error text into the envelope", () => {
    for (const [type, response] of Object.entries(responses)) {
      expect(
        response.ResponseTemplates["application/json"],
        type
      ).not.toContain("$context.error");
    }
  });
});

describe("AD-4 / AD-14 data protection", () => {
  const table = TEMPLATE.resources.ProfileTable;

  it("keeps a pk/sk schema on one on-demand table", () => {
    expect(table.Type).toBe("AWS::DynamoDB::Table");
    expect(resourcesOfType(TEMPLATE, "AWS::DynamoDB::Table")).toHaveLength(1);
    expect(table.Properties.BillingMode).toBe("PAY_PER_REQUEST");
    expect(table.Properties.KeySchema).toEqual([
      { AttributeName: "pk", KeyType: "HASH" },
      { AttributeName: "sk", KeyType: "RANGE" },
    ]);
    expect(table.Properties.AttributeDefinitions).toEqual([
      { AttributeName: "pk", AttributeType: "S" },
      { AttributeName: "sk", AttributeType: "S" },
    ]);
  });

  it("is PITR-enabled and retained against deletion or replacement", () => {
    expect(table.Properties.PointInTimeRecoverySpecification).toEqual({
      PointInTimeRecoveryEnabled: true,
    });
    expect(table.DeletionPolicy).toBe("Retain");
    expect(table.UpdateReplacePolicy).toBe("Retain");
  });

  it("passes the table to the function through one environment variable", () => {
    const env = props("ProfileFunction").Environment.Variables as Record<
      string,
      unknown
    >;
    expect(Object.keys(env)).toEqual(["PROFILE_TABLE_NAME"]);
    expect(env.PROFILE_TABLE_NAME).toEqual(ref("ProfileTable"));

    expect(resourcesOfType(TEMPLATE, "AWS::SecretsManager::Secret")).toEqual([]);
    expect(resourcesOfType(TEMPLATE, "AWS::SSM::Parameter")).toEqual([]);
  });
});

describe("AD-12 logging envelope", () => {
  it("logs to a CloudFormation-created group with 14-day retention", () => {
    expect(props("ProfileFunction").LoggingConfig.LogGroup).toEqual(
      ref("ProfileLogGroup")
    );
    expect(props("ProfileLogGroup").RetentionInDays).toBe(14);
    expect(props("ProfileLogGroup").LogGroupName).toEqual({
      __cfn: "Sub",
      value: "/aws/lambda/${AWS::StackName}-api",
    });
  });

  /* Access logging and execution logging both need an account-level API Gateway
   * CloudWatch role this stack does not own; enabling either would make every
   * deploy fail on a missing account setting. */
  it("configures no API Gateway access or execution logging", () => {
    expect(props("ProfileApi")).not.toHaveProperty("AccessLogSetting");
    expect(props("ProfileApi").MethodSettings[0]).not.toHaveProperty(
      "LoggingLevel"
    );
  });
});

describe("IAM grants exact actions only", () => {
  const actions = actionsOf(TEMPLATE, "ProfileExecutionRole").sort();

  it("grants only the four actions the service makes", () => {
    expect(actions).toEqual([
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]);
  });

  it("never grants a wildcard, a scan, a delete, or a transaction", () => {
    for (const action of actions) {
      expect(action).not.toContain("*");
    }
    for (const forbidden of [
      "dynamodb:Scan",
      "dynamodb:Query",
      "dynamodb:DeleteItem",
      "dynamodb:UpdateItem",
      "dynamodb:TransactWriteItems",
      "dynamodb:BatchWriteItem",
      "dynamodb:DeleteTable",
      "logs:CreateLogGroup",
      "logs:PutRetentionPolicy",
    ]) {
      expect(actions, `must not grant ${forbidden}`).not.toContain(forbidden);
    }
  });

  /* The table grant is bounded to this service's own partition namespace.
   * DynamoDB has no condition key for the SORT key, so PROFILE/AVATAR is
   * enforced in code and by src/iam-isolation.test.ts - this asserts the half
   * IAM can express. */
  it("bounds the table grant to USER# partitions on that one table", () => {
    const statement = statementsOf(TEMPLATE, "ProfileExecutionRole").find(
      (entry) => String(entry.Action).includes("dynamodb")
    )!;

    expect(statement.Resource).toEqual(getAtt("ProfileTable.Arn"));
    expect(statement.Condition).toEqual({
      "ForAllValues:StringLike": {
        "dynamodb:LeadingKeys": ["USER#*"],
      },
    });
  });

  it("uses the explicit role rather than a managed basic-execution policy", () => {
    expect(props("ProfileFunction").Role).toEqual(
      getAtt("ProfileExecutionRole.Arn")
    );
    expect(props("ProfileExecutionRole").ManagedPolicyArns).toBeUndefined();
    expect(DECLARED).not.toContain("AWSLambdaBasicExecutionRole");
  });
});

describe("AD-14 cost and error controls", () => {
  it("declares a $10/month budget alerting at 80% and 100%", () => {
    const budget = props("AccountMonthlyBudget").Budget;
    expect(budget.BudgetType).toBe("COST");
    expect(budget.TimeUnit).toBe("MONTHLY");
    expect(budget.BudgetLimit).toEqual({ Amount: 10, Unit: "USD" });

    const thresholds = (
      props("AccountMonthlyBudget").NotificationsWithSubscribers as {
        Notification: { Threshold: number };
      }[]
    )
      .map((entry) => entry.Notification.Threshold)
      .sort((a, b) => a - b);
    expect(thresholds).toEqual([80, 100]);
  });

  it("alarms on gateway 5xx, function errors, and throttles", () => {
    const alarms = resourcesOfType(TEMPLATE, "AWS::CloudWatch::Alarm");
    const metrics = alarms
      .map(([, alarm]) => alarm.Properties.MetricName)
      .sort();
    expect(metrics).toEqual(["5XXError", "Errors", "Throttles"]);

    for (const [name, alarm] of alarms) {
      expect(alarm.Properties.AlarmActions, name).toEqual([
        ref("AccountAlertTopic"),
      ]);
    }
  });

  it("subscribes the parameterized alert email to the alarm topic", () => {
    expect(props("AccountAlertSubscription").Protocol).toBe("email");
    expect(props("AccountAlertSubscription").Endpoint).toEqual(
      ref("AlertEmail")
    );
    // No committed address: the operator supplies it from the production
    // environment, exactly as api-bedrock does.
    expect(TEMPLATE.parameters.AlertEmail).not.toHaveProperty("Default");
  });

  it("reserves no function-level concurrency", () => {
    expect(props("ProfileFunction")).not.toHaveProperty(
      "ReservedConcurrentExecutions"
    );
    expect(DECLARED).not.toContain("ReservedConcurrentExecutions");
  });
});

describe("build wiring", () => {
  it("builds the one entry point through the makefile builder", () => {
    expect(TEMPLATE.resources.ProfileFunction.Metadata.BuildMethod).toBe(
      "makefile"
    );
    expect(props("ProfileFunction").Handler).toBe("api.handler");

    expect(MAKEFILE).toContain("build-ProfileFunction");
    expect(MAKEFILE).toContain("ENTRY_POINT := src/functions/api.ts");
    expect(MAKEFILE).toContain("--target=node24");
    expect(MAKEFILE).toContain('{"type":"commonjs"}');
    expect(MAKEFILE).toContain("exports no handler");

    const entryPoints = [...MAKEFILE.matchAll(/src\/functions\/\S+\.ts/g)];
    expect(new Set(entryPoints.map((match) => match[0])).size).toBe(1);
  });

  /* The catalog is inlined by the bundler, so an artifact that lost it would
   * answer /locations with an empty country list and fail nothing else. */
  it("proves the built artifact still carries the ISO catalog", () => {
    expect(MAKEFILE).toContain("bundledCountryCount");
    expect(MAKEFILE).toContain("carries no ISO 3166 catalog");
  });

  it("pins the one production stack, region, and capability set", () => {
    expect(SAMCONFIG).toContain('stack_name = "nixus-account"');
    expect(SAMCONFIG).toContain('region = "us-east-1"');
    expect(SAMCONFIG).toContain("lint = true");
    expect(SAMCONFIG).toContain('capabilities = "CAPABILITY_IAM"');
    expect(SAMCONFIG).not.toContain("CAPABILITY_NAMED_IAM");
    expect(SAMCONFIG).toContain("resolve_s3 = false");
    // The bundle reaches out to packages/shared/data, which SAM's scratch-copy
    // build cannot see.
    expect(SAMCONFIG).toContain("build_in_source = true");
  });

  it("commits no account-specific parameter override", () => {
    expect(SAMCONFIG).not.toMatch(/^parameter_overrides\s*=/m);
    expect(SAMCONFIG).not.toContain("arn:aws");
  });

  it("exposes the shared-domain base URL and the ids a deploy asserts on", () => {
    expect(Object.keys(TEMPLATE.outputs).sort()).toEqual([
      "AlertTopicArn",
      "CognitoUserPoolIdEcho",
      "ProfileApiBaseUrl",
      "ProfileApiId",
      "ProfileFunctionName",
      "ProfileTableName",
    ]);
    expect(TEMPLATE.outputs.ProfileApiBaseUrl.Value).toEqual({
      __cfn: "Sub",
      value: "https://${ApiDomainName}/v1/profile",
    });
    expect(JSON.stringify(TEMPLATE.outputs)).not.toContain("execute-api");
  });
});
