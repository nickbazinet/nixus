import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

/*
 * Infrastructure contract tests. These supersede Story 1's "no functional
 * resources" scaffold guard: the template is now expected to declare the real
 * protected streaming shell, so the assertions moved from "nothing exists" to
 * "exactly the architecture-mandated shape exists".
 *
 * CloudFormation short-form intrinsics (!Ref, !Sub, !GetAtt, ...) are not valid
 * YAML tags, so they are resolved into plain marker objects before parsing. That
 * keeps these assertions structural instead of regex-over-text.
 */
const CFN_SCALAR_TAGS = [
  "Ref",
  "Sub",
  "GetAtt",
  "ImportValue",
  "Base64",
  "Condition",
] as const;

const CFN_SEQUENCE_TAGS = [
  "Sub",
  "GetAtt",
  "Join",
  "Select",
  "Split",
  "FindInMap",
  "If",
  "Equals",
  "And",
  "Or",
  "Not",
  "Cidr",
  "GetAZs",
] as const;

type CfnMarker = { readonly __cfn: string; readonly value: unknown };

function isCfnMarker(value: unknown): value is CfnMarker {
  return typeof value === "object" && value !== null && "__cfn" in value;
}

function ref(name: string): CfnMarker {
  return { __cfn: "Ref", value: name };
}

const customTags = [
  ...CFN_SCALAR_TAGS.map((name) => ({
    tag: `!${name}`,
    resolve: (value: string): CfnMarker => ({ __cfn: name, value }),
  })),
  ...CFN_SEQUENCE_TAGS.map((name) => ({
    tag: `!${name}`,
    collection: "seq" as const,
    resolve: (seq: { toJSON: () => unknown }): CfnMarker => ({
      __cfn: name,
      value: seq.toJSON(),
    }),
  })),
];

const TEMPLATE_TEXT = readFileSync(
  fileURLToPath(new URL("../template.yaml", import.meta.url)),
  "utf8"
);

/* A CloudFormation template is an untyped document by nature; these tests are
 * the type boundary for it, so `any` is the honest shape here. */
/* eslint-disable @typescript-eslint/no-explicit-any */
const TEMPLATE = parse(TEMPLATE_TEXT, { customTags }) as any;

function props(resource: Record<string, unknown>): any {
  return resource.Properties as any;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const RESOURCES: Record<string, Record<string, unknown>> = TEMPLATE.Resources;
const PARAMETERS: Record<string, Record<string, unknown>> = TEMPLATE.Parameters;

function resourcesOfType(type: string): [string, Record<string, unknown>][] {
  return Object.entries(RESOURCES).filter(
    ([, resource]) => resource.Type === type
  );
}

function singleResourceOfType(type: string): Record<string, unknown> {
  const matches = resourcesOfType(type);
  expect(matches, `expected exactly one ${type}`).toHaveLength(1);
  return matches[0]![1];
}

describe("template metadata and conventions", () => {
  it("is a SAM template with the Node 22 ARM64 function conventions", () => {
    expect(TEMPLATE.Transform).toBe("AWS::Serverless-2016-10-31");
    expect(TEMPLATE.Globals.Function.Runtime).toBe("nodejs22.x");
    expect(TEMPLATE.Globals.Function.Architectures).toEqual(["arm64"]);
    expect(TEMPLATE.Globals.Function.MemorySize).toBe(512);
    expect(TEMPLATE.Globals.Function.Timeout).toBe(300);
  });

  it("no longer declares the Story 1 no-op placeholder", () => {
    expect(resourcesOfType("AWS::CloudFormation::WaitConditionHandle")).toEqual(
      []
    );
  });

  it("takes the existing Cognito pool, domain, zone, and alert email as inputs and never owns the user pool", () => {
    for (const name of [
      "CognitoUserPoolArn",
      "CognitoUserPoolId",
      "CognitoAppClientId",
      "ApiDomainName",
      "ApiCertificateArn",
      "HostedZoneId",
      "AlertEmail",
    ]) {
      expect(PARAMETERS, `missing parameter ${name}`).toHaveProperty(name);
    }

    expect(resourcesOfType("AWS::Cognito::UserPool")).toEqual([]);
    expect(resourcesOfType("AWS::Cognito::UserPoolClient")).toEqual([]);
    expect(resourcesOfType("AWS::Cognito::UserPoolResourceServer")).toEqual([]);
  });

  it("never defines the OIDC deploy role or provider that deploys this stack (AD-12)", () => {
    expect(resourcesOfType("AWS::IAM::OIDCProvider")).toEqual([]);
    expect(TEMPLATE_TEXT).not.toContain("token.actions.githubusercontent.com");
  });
});

describe("AD-2 / AD-3 transport and auth edge", () => {
  const api = singleResourceOfType("AWS::Serverless::Api");

  it("is a Regional REST API with TLS 1.2 and no default execute-api endpoint", () => {
    expect(props(api).EndpointConfiguration).toBe("REGIONAL");
    expect(props(api).DisableExecuteApiEndpoint).toBe(true);
    expect(props(api).Domain.SecurityPolicy).toBe("TLS_1_2");
    expect(props(api).Domain.EndpointConfiguration).toBe("REGIONAL");
  });

  it("wires the custom domain and Route53 record from stack parameters, not as an optional extra", () => {
    expect(props(api).Domain.DomainName).toEqual(ref("ApiDomainName"));
    expect(props(api).Domain.CertificateArn).toEqual(ref("ApiCertificateArn"));
    expect(props(api).Domain.Route53.HostedZoneId).toEqual(ref("HostedZoneId"));
  });

  it("uses a Cognito user-pool authorizer requiring the nixus-api/ai.invoke scope by default", () => {
    const auth = props(api).Auth;
    expect(auth.DefaultAuthorizer).toBe("CognitoAuthorizer");

    const authorizer = auth.Authorizers.CognitoAuthorizer;
    expect(authorizer.UserPoolArn).toEqual(ref("CognitoUserPoolArn"));
    expect(authorizer.AuthorizationScopes).toEqual(["nixus-api/ai.invoke"]);
  });

  it("emits the canonical pre-output error envelope for authorizer rejections", () => {
    const responses = props(api).GatewayResponses;

    for (const key of [
      "UNAUTHORIZED",
      "ACCESS_DENIED",
      "MISSING_AUTHENTICATION_TOKEN",
    ]) {
      const response = responses[key];
      expect(response.StatusCode, `${key} status`).toBe(401);
      const body = response.ResponseTemplates["application/json"];
      expect(JSON.parse(body)).toEqual({
        error: {
          code: "unauthorized",
          message: expect.any(String),
          request_id: "$context.requestId",
        },
      });
    }
  });

  /* Every gateway response must be machine-readable by the desktop, or it falls
   * back to guessing from the raw HTTP status. */
  it("gives every gateway response a canonical envelope with a closed-union code", () => {
    const responses = props(api).GatewayResponses as Record<
      string,
      { StatusCode: number; ResponseTemplates: Record<string, string> }
    >;

    const closedUnion = [
      "validation",
      "unauthorized",
      "reauthentication_required",
      "premium_required",
      "payload_too_large",
      "quota_exhausted",
      "hosted_unavailable",
      "unsupported_encoding",
    ];

    expect(Object.keys(responses).length).toBeGreaterThanOrEqual(10);

    for (const [key, response] of Object.entries(responses)) {
      const parsed = JSON.parse(response.ResponseTemplates["application/json"]!);
      expect(closedUnion, `${key} code`).toContain(parsed.error.code);
      expect(parsed.error.request_id, `${key} request id`).toBe(
        "$context.requestId"
      );
      expect(response.ResponseTemplates["application/json"]).not.toContain(
        "$context.error"
      );
    }
  });

  /* The named regression: API Gateway answers a stage throttle 429, and 429 is what
   * the desktop maps to `quota_exhausted` absent a canonical code — telling a user
   * with quota remaining that their month is spent. */
  it("reports stage throttling as hosted_unavailable, never as monthly quota exhaustion", () => {
    const responses = props(api).GatewayResponses;

    for (const key of ["THROTTLED", "QUOTA_EXCEEDED"]) {
      const response = responses[key];
      const parsed = JSON.parse(response.ResponseTemplates["application/json"]);

      expect(parsed.error.code, `${key} must not blame the user's quota`).toBe(
        "hosted_unavailable"
      );
      expect(parsed.error.code).not.toBe("quota_exhausted");
      // Status and code agree, so the desktop's status-keyed backoff window opens.
      expect(response.StatusCode, `${key} status`).toBe(503);
    }
  });

  it("maps API Gateway's own size, media-type, and body errors onto their no-fallback codes", () => {
    const responses = props(api).GatewayResponses;
    const codeOf = (key: string) =>
      JSON.parse(responses[key].ResponseTemplates["application/json"]).error.code;

    expect(codeOf("REQUEST_TOO_LARGE")).toBe("payload_too_large");
    expect(responses.REQUEST_TOO_LARGE.StatusCode).toBe(413);
    expect(codeOf("UNSUPPORTED_MEDIA_TYPE")).toBe("unsupported_encoding");
    expect(responses.UNSUPPORTED_MEDIA_TYPE.StatusCode).toBe(415);
    expect(codeOf("BAD_REQUEST_BODY")).toBe("validation");
    expect(responses.BAD_REQUEST_BODY.StatusCode).toBe(400);
  });

  it("routes unclassified gateway 5xx to hosted_unavailable so the desktop can fall back", () => {
    const responses = props(api).GatewayResponses;
    for (const key of [
      "DEFAULT_5XX",
      "INTEGRATION_FAILURE",
      "INTEGRATION_TIMEOUT",
      "API_CONFIGURATION_ERROR",
    ]) {
      const parsed = JSON.parse(responses[key].ResponseTemplates["application/json"]);
      expect(parsed.error.code, key).toBe("hosted_unavailable");
      expect(responses[key].StatusCode, key).toBe(503);
    }
  });

  it("throttles the stage at 10 RPS / burst 20 with request data tracing off (AD-15)", () => {
    const settings = props(api).MethodSettings;
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

describe("AD-4 compute topology", () => {
  const fn = singleResourceOfType("AWS::Serverless::Function");

  it("declares exactly one Lambda and no per-route or per-operation siblings", () => {
    expect(resourcesOfType("AWS::Serverless::Function")).toHaveLength(1);
    expect(resourcesOfType("AWS::Lambda::Function")).toEqual([]);
  });

  it("points at the sole functions/api.ts entry point", () => {
    expect(props(fn).Handler).toBe("api.handler");

    const metadata = fn.Metadata as Record<string, unknown>;
    expect(metadata.BuildMethod).toBe("makefile");

    const makefile = readFileSync(
      fileURLToPath(new URL("../Makefile", import.meta.url)),
      "utf8"
    );
    expect(makefile).toContain("build-HostedAiFunction");
    expect(makefile).toContain("ENTRY_POINT := src/functions/api.ts");
    expect(makefile).toContain("$(ARTIFACTS_DIR)/api.js");
    // Pins CJS and proves the bundle exports a handler at build time, so a
    // silently export-less artifact can never reach a deploy.
    expect(makefile).toContain('{"type":"commonjs"}');
    expect(makefile).toContain("exports no handler");

    const entryPoints = [...makefile.matchAll(/src\/functions\/\S+\.ts/g)];
    expect(new Set(entryPoints.map((match) => match[0])).size).toBe(1);
  });

  /* Superseded by the 2026-08-26 capacity decision. AWS refuses any reservation that
   * would drop this account's unreserved concurrency below its 50 floor, and the account
   * quota IS 50 - so the only deployable value was 0, which throttles the function to
   * zero executions and makes it permanently unable to serve a request. The user waived
   * the reservation and accepted the account's shared 50. The property and its parameter
   * must therefore be absent, not present-and-zero. */
  it("declares no function-level concurrency reservation at all", () => {
    expect(props(fn)).not.toHaveProperty("ReservedConcurrentExecutions");
    expect(PARAMETERS).not.toHaveProperty("HostedAiReservedConcurrency");
    expect(TEMPLATE_TEXT).not.toContain("ReservedConcurrentExecutions:");
    expect(TEMPLATE_TEXT).not.toContain("HostedAiReservedConcurrency");
  });

  /* A reservation of 0 is the trap this replaces: it looks like "no limit configured"
   * in a diff and is in fact a hard stop at zero concurrent executions. */
  it("never reintroduces the reservation as a literal, a zero, or a default", () => {
    expect(props(fn).ReservedConcurrentExecutions).toBeUndefined();

    for (const [, resource] of Object.entries(RESOURCES)) {
      const properties = (resource.Properties ?? {}) as Record<string, unknown>;
      expect(properties).not.toHaveProperty("ReservedConcurrentExecutions");
    }
  });

  it("serves both routes from that one function with response streaming enabled", () => {
    const events = props(fn).Events as Record<
      string,
      { Type: string; Properties: Record<string, unknown> }
    >;
    const routes = Object.values(events).map((event) => ({
      method: event.Properties.Method,
      path: event.Properties.Path,
      transfer: event.Properties.ResponseTransferMode,
    }));

    expect(routes).toHaveLength(2);
    expect(routes).toEqual(
      expect.arrayContaining([
        { method: "get", path: "/v1/ai/status", transfer: "RESPONSE_STREAM" },
        { method: "post", path: "/v1/ai/invoke", transfer: "RESPONSE_STREAM" },
      ])
    );

    for (const event of Object.values(events)) {
      expect(event.Type).toBe("Api");
      expect(event.Properties.RestApiId).toEqual(ref("HostedAiApi"));
    }
  });

  /* A REST integration defaults to 29s. Left alone it would sever a long chat
   * completion at the edge, long before the Lambda's 300s budget or its own 10s
   * soft deadline ever applied. */
  it("matches the invoke integration timeout to the streaming Lambda budget", () => {
    const events = props(fn).Events;

    expect(events.Invoke.Properties.TimeoutInMillis).toEqual(
      ref("InvokeIntegrationTimeoutMillis")
    );
    expect(PARAMETERS.InvokeIntegrationTimeoutMillis).toMatchObject({
      Type: "Number",
      Default: 300000,
    });

    // Status does two consistent reads and no model call, so it keeps a short
    // timeout rather than inheriting the streaming budget.
    expect(events.Status.Properties.TimeoutInMillis).toEqual(
      ref("StatusIntegrationTimeoutMillis")
    );
    expect(PARAMETERS.StatusIntegrationTimeoutMillis).toMatchObject({
      Default: 29000,
    });
  });

  it("keeps the invoke integration timeout at or under the function timeout", () => {
    const functionTimeoutMillis = (TEMPLATE.Globals.Function.Timeout as number) * 1000;
    const integrationTimeout = PARAMETERS.InvokeIntegrationTimeoutMillis!
      .Default as number;

    expect(integrationTimeout).toBeLessThanOrEqual(functionTimeoutMillis);
  });

  it("logs to the explicit CloudFormation-created group, never an implicit one", () => {
    expect(props(fn).LoggingConfig.LogGroup).toEqual(ref("HostedAiLogGroup"));

    const logGroup = singleResourceOfType("AWS::Logs::LogGroup");
    expect(props(logGroup).RetentionInDays).toBe(14);
  });

  it("passes the table, model, and Bedrock region through the environment and no secrets", () => {
    const env = props(fn).Environment.Variables as Record<string, unknown>;
    expect(Object.keys(env).sort()).toEqual([
      "BEDROCK_MODEL_ID",
      "BEDROCK_REGION",
      "TABLE_NAME",
    ]);
    expect(env.TABLE_NAME).toEqual(ref("HostedAiTable"));
    expect(env.BEDROCK_MODEL_ID).toEqual(ref("BedrockModelId"));
    // Without this the runtime client inherits us-east-1, where the model does not
    // exist, and every Bedrock call fails as a validation error.
    expect(env.BEDROCK_REGION).toEqual(ref("BedrockRegion"));

    expect(resourcesOfType("AWS::SecretsManager::Secret")).toEqual([]);
    expect(resourcesOfType("AWS::SSM::Parameter")).toEqual([]);
  });
});

/*
 * The replacement for the rejected cross-region inference profile. Every probed
 * `us.anthropic.*` profile answered Runtime CountTokens with "The provided model
 * doesn't support counting tokens", which makes AD-8's pre-reservation gate
 * unimplementable on a profile; this bare model in eu-west-2 returned a count.
 */
describe("Bedrock identity is one direct model in its own region", () => {
  const role = singleResourceOfType("AWS::IAM::Role");

  it("defaults to the bare Claude Sonnet 4.6 model in eu-west-2", () => {
    expect(PARAMETERS.BedrockModelId!.Default).toBe(
      "anthropic.claude-sonnet-4-6"
    );
    expect(PARAMETERS.BedrockRegion!.Default).toBe("eu-west-2");
  });

  /* An AllowedPattern would still admit an unreviewed sibling model - "some Anthropic
   * model" is not what the CountTokens/ConverseStream evidence covers. A one-entry
   * AllowedValues makes CloudFormation itself refuse anything else. */
  it("enumerates exactly one approved model and one approved region, not a pattern", () => {
    expect(PARAMETERS.BedrockModelId!.AllowedValues).toEqual([
      "anthropic.claude-sonnet-4-6",
    ]);
    expect(PARAMETERS.BedrockRegion!.AllowedValues).toEqual(["eu-west-2"]);

    expect(PARAMETERS.BedrockModelId).not.toHaveProperty("AllowedPattern");
    expect(PARAMETERS.BedrockRegion).not.toHaveProperty("AllowedPattern");
  });

  it("makes every unapproved model and region unselectable", () => {
    const models = PARAMETERS.BedrockModelId!.AllowedValues as string[];
    const regions = PARAMETERS.BedrockRegion!.AllowedValues as string[];

    for (const rejected of [
      "us.anthropic.claude-sonnet-4-6",
      "eu.anthropic.claude-sonnet-4-6",
      "apac.anthropic.claude-sonnet-4-6",
      "global.anthropic.claude-sonnet-4-6",
      "anthropic.claude-3-5-sonnet-20241022-v2:0",
      "amazon.nova-pro-v1:0",
      "",
    ]) {
      expect(models, `${rejected} must not be selectable`).not.toContain(rejected);
    }

    for (const rejected of ["us-east-1", "eu-west-1", "eu-west-3", "ca-central-1", ""]) {
      expect(regions, `${rejected} must not be selectable`).not.toContain(rejected);
    }

    expect(models).toHaveLength(1);
    expect(regions).toHaveLength(1);
  });

  /* The default must be inside its own AllowedValues, or every deployment that omits an
   * override fails validation - a trap that only surfaces at deploy time. */
  it("keeps each default inside its own allowed set", () => {
    expect(PARAMETERS.BedrockModelId!.AllowedValues).toContain(
      PARAMETERS.BedrockModelId!.Default
    );
    expect(PARAMETERS.BedrockRegion!.AllowedValues).toContain(
      PARAMETERS.BedrockRegion!.Default
    );
  });

  it("declares no inference-profile parameter or resource anywhere", () => {
    expect(PARAMETERS).not.toHaveProperty("BedrockInferenceProfileArn");
    expect(PARAMETERS).not.toHaveProperty("BedrockFoundationModelArnPattern");
    expect(TEMPLATE_TEXT).not.toContain("us.anthropic");
    expect(resourcesOfType("AWS::Bedrock::ApplicationInferenceProfile")).toEqual([]);

    for (const [, resource] of Object.entries(RESOURCES)) {
      expect(String(resource.Type)).not.toContain("InferenceProfile");
    }
  });

  /* The grant is derived from the same two parameters the Lambda invokes with, so an
   * IAM resource cannot drift from the model or region actually called. */
  it("scopes the Bedrock grant to that one derived foundation-model ARN", () => {
    const bedrock = (
      props(role).Policies as {
        PolicyName: string;
        PolicyDocument: { Statement: { Action: string[]; Resource: unknown }[] };
      }[]
    ).find((policy) => policy.PolicyName === "hosted-ai-bedrock");

    expect(bedrock!.PolicyDocument.Statement).toHaveLength(1);
    const statement = bedrock!.PolicyDocument.Statement[0]!;
    expect(statement.Action).toEqual([
      "bedrock:CountTokens",
      "bedrock:InvokeModelWithResponseStream",
    ]);
    expect(statement.Resource).toEqual({
      __cfn: "Sub",
      value:
        "arn:${AWS::Partition}:bedrock:${BedrockRegion}::foundation-model/${BedrockModelId}",
    });

    // A direct model does not fan out, so the region wildcard the profile needed is
    // now a privilege escalation with no purpose.
    expect(JSON.stringify(statement.Resource)).not.toContain("bedrock:*");
    expect(JSON.stringify(statement.Resource)).not.toContain("inference-profile");
  });

  it("exposes the deployed model and region so live probes use the real identity", () => {
    const outputs = TEMPLATE.Outputs as Record<string, { Value: unknown }>;
    expect(outputs.BedrockModelIdEcho!.Value).toEqual(ref("BedrockModelId"));
    expect(outputs.BedrockRegionEcho!.Value).toEqual(ref("BedrockRegion"));
  });
});

/*
 * Removing the function-level reservation removed ONE of AD-4/AD-14's layered abuse
 * bounds. These assert the remaining layers are all still in place, because the waiver
 * was of the reservation specifically - not of the bounding it contributed to.
 */
describe("the remaining abuse bounds survive the reservation waiver", () => {
  const api = singleResourceOfType("AWS::Serverless::Api");
  const role = singleResourceOfType("AWS::IAM::Role");

  it("keeps the stage throttle at 10 RPS / burst 20", () => {
    const settings = props(api).MethodSettings;

    expect(settings).toHaveLength(1);
    expect(settings[0].ThrottlingRateLimit).toBe(10);
    expect(settings[0].ThrottlingBurstLimit).toBe(20);
    expect(settings[0].HttpMethod).toBe("*");
    expect(settings[0].ResourcePath).toBe("/*");
  });

  it("keeps the Cognito authorizer as the edge bound on non-premium callers", () => {
    expect(props(api).Auth.DefaultAuthorizer).toBe("CognitoAuthorizer");
    expect(
      props(api).Auth.Authorizers.CognitoAuthorizer.AuthorizationScopes
    ).toEqual(["nixus-api/ai.invoke"]);
  });

  /* The per-user and GLOBAL charged_count caps are the hard stop, and they are only
   * enforceable through the transactional grant on the one retained table. */
  it("keeps the transactional grant the atomic user + GLOBAL caps depend on", () => {
    const table = props(role).Policies.find(
      (policy: { PolicyName: string }) => policy.PolicyName === "hosted-ai-table"
    );
    const actions = table.PolicyDocument.Statement.flatMap(
      (statement: { Action: string[] }) => statement.Action
    );

    expect(actions).toEqual(["dynamodb:GetItem", "dynamodb:TransactWriteItems"]);
    // A direct write would let the Lambda bypass the condition check that enforces the
    // caps, so these must stay absent even now that a layer was removed.
    expect(actions).not.toContain("dynamodb:PutItem");
    expect(actions).not.toContain("dynamodb:UpdateItem");
  });

  it("still alarms on throttling, now as the account-pool exposure it became", () => {
    const throttleAlarm = resourcesOfType("AWS::CloudWatch::Alarm").find(
      ([, alarm]) => props(alarm).MetricName === "Throttles"
    );

    expect(throttleAlarm, "the Throttles alarm is missing").toBeDefined();
    expect(props(throttleAlarm![1]).AlarmDescription).toMatch(/ACCOUNT/);
    expect(props(throttleAlarm![1]).Threshold).toBe(1);
  });
});

describe("AD-6 / AD-15 data protection", () => {
  const table = singleResourceOfType("AWS::DynamoDB::Table");

  it("keeps a stable logical ID and pk/sk key schema", () => {
    expect(RESOURCES).toHaveProperty("HostedAiTable");
    expect(props(table).KeySchema).toEqual([
      { AttributeName: "pk", KeyType: "HASH" },
      { AttributeName: "sk", KeyType: "RANGE" },
    ]);
    expect(props(table).AttributeDefinitions).toEqual([
      { AttributeName: "pk", AttributeType: "S" },
      { AttributeName: "sk", AttributeType: "S" },
    ]);
  });

  it("is on-demand, PITR-enabled, and retained against stack deletion or replacement", () => {
    expect(props(table).BillingMode).toBe("PAY_PER_REQUEST");
    expect(props(table).PointInTimeRecoverySpecification).toEqual({
      PointInTimeRecoveryEnabled: true,
    });
    expect(table.DeletionPolicy).toBe("Retain");
    expect(table.UpdateReplacePolicy).toBe("Retain");
  });
});

describe("IAM grants exact actions only", () => {
  const role = singleResourceOfType("AWS::IAM::Role");
  const statements = (
    props(role).Policies as {
      PolicyDocument: { Statement: { Action: string[] }[] };
    }[]
  ).flatMap((policy) => policy.PolicyDocument.Statement);
  const actions = statements.flatMap((statement) => statement.Action).sort();

  it("grants only the six architecture-listed actions", () => {
    expect(actions).toEqual([
      "bedrock:CountTokens",
      "bedrock:InvokeModelWithResponseStream",
      "dynamodb:GetItem",
      "dynamodb:TransactWriteItems",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]);
  });

  it("never grants wildcards, logs:*, or the non-existent ConditionCheckItem action", () => {
    for (const action of actions) {
      expect(action).not.toContain("*");
    }
    expect(actions).not.toContain("dynamodb:ConditionCheckItem");
    expect(actions).not.toContain("dynamodb:PutItem");
    expect(actions).not.toContain("dynamodb:UpdateItem");
    expect(actions).not.toContain("bedrock:InvokeModel");
  });

  it("uses the explicit role rather than a managed basic-execution policy", () => {
    const fn = singleResourceOfType("AWS::Serverless::Function");
    expect(props(fn).Role).toEqual({
      __cfn: "GetAtt",
      value: "HostedAiExecutionRole.Arn",
    });
    expect(props(role).ManagedPolicyArns).toBeUndefined();
  });
});

describe("AD-14 independent cost and error controls", () => {
  it("declares a $50/month Bedrock budget alerting at 80% and 100%", () => {
    const budget = singleResourceOfType("AWS::Budgets::Budget");
    const data = props(budget).Budget;
    expect(data.BudgetType).toBe("COST");
    expect(data.TimeUnit).toBe("MONTHLY");
    expect(data.BudgetLimit).toEqual({ Amount: 50, Unit: "USD" });
    expect(data.CostFilters.Service).toEqual(["Amazon Bedrock"]);

    const thresholds = (
      props(budget).NotificationsWithSubscribers as {
        Notification: { Threshold: number };
      }[]
    )
      .map((entry) => entry.Notification.Threshold)
      .sort((a, b) => a - b);
    expect(thresholds).toEqual([80, 100]);
  });

  it("alarms separately on API Gateway and Lambda error rates", () => {
    const alarms = resourcesOfType("AWS::CloudWatch::Alarm");
    const namespaces = alarms.map(([, alarm]) => props(alarm).Namespace);
    expect(namespaces).toContain("AWS/ApiGateway");
    expect(namespaces).toContain("AWS/Lambda");

    const metrics = alarms.map(([, alarm]) => props(alarm).MetricName).sort();
    expect(metrics).toEqual(["5XXError", "Errors", "Throttles"]);

    for (const [, alarm] of alarms) {
      expect(props(alarm).AlarmActions).toEqual([ref("HostedAiAlertTopic")]);
    }
  });

  it("subscribes the parameterized alert email to the alarm topic", () => {
    const subscription = singleResourceOfType("AWS::SNS::Subscription");
    expect(props(subscription).Protocol).toBe("email");
    expect(props(subscription).Endpoint).toEqual(ref("AlertEmail"));
  });
});

describe("hosted traffic stays off until the manual seed and rollout gates pass", () => {
  it("never seeds GLOBAL config from the stack (no bootstrap/custom resource)", () => {
    expect(TEMPLATE_TEXT).not.toContain("PostConfirmation");

    for (const [, resource] of Object.entries(RESOURCES)) {
      expect(String(resource.Type)).not.toMatch(/^Custom::/);
      expect(String(resource.Type)).not.toBe(
        "AWS::CloudFormation::CustomResource"
      );
    }
  });

  it("exposes the stable custom-domain endpoint as the only API output", () => {
    const outputs = TEMPLATE.Outputs as Record<string, unknown>;
    expect(Object.keys(outputs)).toContain("ApiEndpoint");
    for (const marker of Object.values(outputs)) {
      const value = (marker as { Value: unknown }).Value;
      if (isCfnMarker(value)) {
        expect(JSON.stringify(value)).not.toContain("execute-api");
      }
    }
  });
});
