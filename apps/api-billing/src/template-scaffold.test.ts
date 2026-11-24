import { describe, expect, it } from "vitest";

import {
  BILLING_GATEWAY_RESPONSES,
  type BillingGatewayResponseType,
} from "@nixus/shared";

import { UNAUTHENTICATED_ROUTE_KEYS } from "./functions/api.ts";
import { BILLING_METRIC_NAMES } from "./lib/metrics.ts";
import {
  getAtt,
  loadTemplate,
  readRepoFile,
  ref,
  resourcesOfType,
} from "./lib/testing/cfn.ts";

/*
 * Infrastructure-as-tested-contract for the nixus-billing stack. Everything the
 * spine fixes about the edge, the two route classes, the table, the signing key,
 * the IAM grant and the operating envelope is asserted structurally here, because
 * none of it is reachable from a unit test and all of it is a one-line change
 * away from being wrong.
 */

const TEMPLATE = loadTemplate("apps/api-billing/template.yaml");
const MAKEFILE = readRepoFile("apps/api-billing/Makefile");
const SAMCONFIG = readRepoFile("apps/api-billing/samconfig.toml");

const METRIC_NAMESPACE = "Nixus/Billing";

/* eslint-disable @typescript-eslint/no-explicit-any */
function props(logicalId: string): any {
  return TEMPLATE.resources[logicalId].Properties;
}

interface ApiEvent {
  readonly Type: string;
  readonly Properties: {
    readonly Path: string;
    readonly Method: string;
    readonly RestApiId: unknown;
    readonly Auth?: { readonly Authorizer?: string };
  };
}

function events(): Record<string, ApiEvent> {
  return props("BillingFunction").Events as Record<string, ApiEvent>;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/* Structural, not textual, and resources only: the template's comments
 * deliberately NAME what this stack refuses to declare - the Bedrock stack, the
 * other two scopes, the managed execution policy, api-bedrock's absent
 * reservation - so a raw-text scan would match that prose. This is what every
 * absence assertion searches instead. */
const DECLARED = JSON.stringify({
  Resources: TEMPLATE.resources,
  Outputs: TEMPLATE.outputs,
});

describe("template conventions", () => {
  it("is a SAM template on the Node 24 ARM64 conventions (AD-15)", () => {
    expect(TEMPLATE.doc.Transform).toBe("AWS::Serverless-2016-10-31");
    expect(TEMPLATE.doc.Globals.Function.Runtime).toBe("nodejs24.x");
    expect(TEMPLATE.doc.Globals.Function.Architectures).toEqual(["arm64"]);
  });

  it("declares every parameter the spine requires, with a description", () => {
    const required = [
      "AccountAppOrigin",
      "AlertEmail",
      "ApiDomainName",
      "BillingFunctionReservedConcurrency",
      "CatalogCacheTtlSeconds",
      "CatalogLookupKeys",
      "CognitoUserPoolArn",
      "CognitoUserPoolId",
      "DeploymentRevision",
      "MinimumClientVersion",
      "StripeMode",
      "StripeSecretKeyParameterName",
      "StripeWebhookSecretParameterName",
    ];

    for (const name of required) {
      expect(TEMPLATE.parameters, `missing parameter ${name}`).toHaveProperty(
        name,
      );
      expect(
        typeof TEMPLATE.parameters[name].Description,
        `${name} has no description`,
      ).toBe("string");
    }

    expect(TEMPLATE.parameters.ApiDomainName.Default).toBe("api.nixusapp.com");
    // No committed address: the operator supplies it from the production
    // environment, exactly as the other two services do.
    expect(TEMPLATE.parameters.AlertEmail).not.toHaveProperty("Default");
  });

  /* AD-15: test mode is the DEFAULT for every non-production path, so promoting a
   * stack to live mode has to be an explicit override and never an omission. */
  it("defaults Stripe to test mode and allows nothing but the two modes", () => {
    expect(TEMPLATE.parameters.StripeMode.AllowedValues).toEqual([
      "test",
      "live",
    ]);
    expect(TEMPLATE.parameters.StripeMode.Default).toBe("test");
  });

  it("carries the spine's configured defaults for the cache bound and the floor", () => {
    expect(TEMPLATE.parameters.CatalogCacheTtlSeconds.Default).toBe(300);
    // AD-6's published set, as CONFIGURATION: adding a tier whose capabilities
    // already exist is a change to this value, not a deploy of new code.
    expect(TEMPLATE.parameters.CatalogLookupKeys.Default).toBe(
      "classic_monthly_cad,advance_monthly_cad,classic_yearly_cad,advance_yearly_cad,advance_trial",
    );
    expect(TEMPLATE.parameters.AccountAppOrigin.Default).toBe(
      "https://account.nixusapp.com",
    );
    // 0.0.0 refuses nothing at launch; AD-9's revocation floor is raised later
    // by a parameter change rather than a release.
    expect(TEMPLATE.parameters.MinimumClientVersion.Default).toBe("0.0.0");
    expect(TEMPLATE.parameters.BillingFunctionReservedConcurrency.Default).toBe(
      10,
    );
  });

  /* A 40-hex git sha, like api-bedrock's, so a Lambda whose configuration drifted
   * is reconciled by a deploy of the same commit. */
  it("takes the deployed revision as a 40-hex sha", () => {
    expect(TEMPLATE.parameters.DeploymentRevision.AllowedPattern).toBe(
      "^[0-9a-f]{40}$",
    );
    expect(TEMPLATE.parameters.DeploymentRevision).not.toHaveProperty("Default");
  });

  it("takes the existing pool as an input and owns neither it nor a client", () => {
    expect(resourcesOfType(TEMPLATE, "AWS::Cognito::UserPool")).toEqual([]);
    expect(
      resourcesOfType(TEMPLATE, "AWS::Cognito::UserPoolResourceServer"),
    ).toEqual([]);
    expect(resourcesOfType(TEMPLATE, "AWS::Cognito::UserPoolClient")).toEqual(
      [],
    );
  });

  /* The domain, its certificate and its DNS record belong to nixus-bedrock-api.
   * Owning any of them here is how a billing deploy takes hosted AI and the
   * profile API down at once. */
  it("never declares, imports, exports, or re-certifies the shared domain (AD-3)", () => {
    expect(resourcesOfType(TEMPLATE, "AWS::ApiGateway::DomainName")).toEqual([]);
    expect(resourcesOfType(TEMPLATE, "AWS::ApiGatewayV2::DomainName")).toEqual(
      [],
    );
    expect(
      resourcesOfType(TEMPLATE, "AWS::CertificateManager::Certificate"),
    ).toEqual([]);
    expect(resourcesOfType(TEMPLATE, "AWS::Route53::RecordSet")).toEqual([]);
    expect(props("BillingApi")).not.toHaveProperty("Domain");
    // By name, never by export/import: an import would couple the two stacks.
    expect(DECLARED).not.toContain("ImportValue");
  });

  /* AD-4 and AD-17 both name a DEPLOY-TIME PARAMETER as how nixus-bedrock-api
   * learns this table. An export would make the two stacks' lifecycles mutually
   * blocking - the billing stack could not be replaced while the Bedrock stack
   * imported from it. */
  it("creates no CloudFormation export on any output", () => {
    for (const [name, output] of Object.entries(TEMPLATE.outputs)) {
      expect(output, `${name} must not be exported`).not.toHaveProperty(
        "Export",
      );
    }
    expect(DECLARED).not.toContain("Export");
  });

  it("never defines the OIDC deploy role or provider that deploys this stack", () => {
    expect(resourcesOfType(TEMPLATE, "AWS::IAM::OIDCProvider")).toEqual([]);
    expect(DECLARED).not.toContain("token.actions.githubusercontent.com");
  });
});

describe("AD-3 edge and authorizer", () => {
  it("is a Regional REST API with no reachable default endpoint", () => {
    expect(props("BillingApi").EndpointConfiguration).toBe("REGIONAL");
    expect(props("BillingApi").DisableExecuteApiEndpoint).toBe(true);
    expect(props("BillingApi").MinimumCompressionSize).toBe(1024);
  });

  it("requires the nixus-api/billing scope and never another service's", () => {
    const auth = props("BillingApi").Auth;
    expect(auth.DefaultAuthorizer).toBe("CognitoAuthorizer");
    expect(auth.Authorizers.CognitoAuthorizer.UserPoolArn).toEqual(
      ref("CognitoUserPoolArn"),
    );
    expect(auth.Authorizers.CognitoAuthorizer.AuthorizationScopes).toEqual([
      "nixus-api/billing",
    ]);

    // The reverse half of AD-16's scope gate: ai.invoke authorizes the Bedrock
    // API and profile the account API; neither may appear here, in any form.
    expect(DECLARED).not.toContain("ai.invoke");
    expect(DECLARED).not.toContain("nixus-api/profile");
  });

  it("serves exactly the six routes, from one Lambda, with the base path stripped", () => {
    const routes = Object.values(events()).map((event) => ({
      path: event.Properties.Path,
      method: event.Properties.Method,
    }));

    expect(routes).toHaveLength(6);
    expect(routes).toEqual(
      expect.arrayContaining([
        { path: "/checkout", method: "post" },
        { path: "/portal", method: "post" },
        { path: "/entitlement", method: "get" },
        { path: "/admin/override", method: "post" },
        { path: "/webhook", method: "post" },
        { path: "/plans", method: "get" },
      ]),
    );

    // The mapping strips `v1/billing`, so a resource that repeats it would be
    // reachable only at /v1/billing/v1/billing.
    for (const route of routes) {
      expect(route.path).not.toContain("v1");
      expect(route.path).not.toContain("billing");
    }

    for (const [name, event] of Object.entries(events())) {
      expect(event.Type, name).toBe("Api");
      expect(event.Properties.RestApiId, name).toEqual(ref("BillingApi"));
    }

    expect(resourcesOfType(TEMPLATE, "AWS::Serverless::Function")).toHaveLength(
      1,
    );
    expect(resourcesOfType(TEMPLATE, "AWS::Lambda::Function")).toEqual([]);
    expect(resourcesOfType(TEMPLATE, "AWS::Lambda::Url")).toEqual([]);
    expect(resourcesOfType(TEMPLATE, "AWS::Serverless::Api")).toHaveLength(1);
  });

  /* THE assertion of AD-3's closed set. Exactly two routes opt out of the
   * authorizer, and every other route inherits it: one extra
   * `Auth: {Authorizer: NONE}` would publish an unauthenticated billing route
   * under the shared domain. */
  it("leaves EXACTLY POST /webhook and GET /plans unauthenticated (AD-3)", () => {
    const unauthenticated = Object.values(events())
      .filter((event) => event.Properties.Auth?.Authorizer === "NONE")
      .map(
        (event) =>
          `${event.Properties.Method.toUpperCase()} ${event.Properties.Path}`,
      )
      .sort();

    expect(unauthenticated).toEqual(["GET /plans", "POST /webhook"]);

    // Every other event carries no Auth override at all, rather than an override
    // that happens to name the default authorizer.
    for (const [name, event] of Object.entries(events())) {
      const key = `${event.Properties.Method.toUpperCase()} ${event.Properties.Path}`;
      if (unauthenticated.includes(key)) continue;
      expect(event.Properties, name).not.toHaveProperty("Auth");
    }

    expect(props("BillingApi").Auth).not.toHaveProperty("ApiKeyRequired");
  });

  /* The dispatcher keeps the same closed set as its own one-place list, and the
   * two must agree: a route unauthenticated at the edge but identity-requiring in
   * code answers Stripe with a 401 forever, and the reverse publishes an
   * unauthenticated route the code treats as trusted. */
  it("agrees with the dispatcher's own closed list", () => {
    const fromTemplate = Object.values(events())
      .filter((event) => event.Properties.Auth?.Authorizer === "NONE")
      .map(
        (event) =>
          `${event.Properties.Method.toUpperCase()} ${event.Properties.Path}`,
      )
      .sort();

    expect(fromTemplate).toEqual([...UNAUTHENTICATED_ROUTE_KEYS].sort());
  });
});

describe("AD-15 method-level throttles on the unauthenticated routes", () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const settings = props("BillingApi").MethodSettings as any[];
  /* eslint-enable @typescript-eslint/no-explicit-any */

  it("keeps a stage-wide entry with data tracing off and metrics on", () => {
    const wildcard = settings.find(
      (entry) => entry.HttpMethod === "*" && entry.ResourcePath === "/*",
    );

    expect(wildcard).toBeDefined();
    expect(wildcard.DataTraceEnabled).toBe(false);
    expect(wildcard.MetricsEnabled).toBe(true);
    expect(typeof wildcard.ThrottlingRateLimit).toBe("number");
  });

  /* Without these the two unauthenticated routes share the stage allowance, so
   * signature-rejection traffic throttles POST /checkout and GET /entitlement for
   * paying users. */
  it("throttles /webhook and /plans below the stage allowance", () => {
    const wildcard = settings.find((entry) => entry.ResourcePath === "/*");

    for (const [path, method] of [
      ["/webhook", "POST"],
      ["/plans", "GET"],
    ]) {
      const entry = settings.find(
        (candidate) =>
          candidate.ResourcePath === path && candidate.HttpMethod === method,
      );

      expect(entry, `no throttle on ${method} ${path}`).toBeDefined();
      expect(entry.ThrottlingRateLimit, path).toBeLessThan(
        wildcard.ThrottlingRateLimit,
      );
      expect(entry.ThrottlingBurstLimit, path).toBeLessThan(
        wildcard.ThrottlingBurstLimit,
      );
      expect(entry.DataTraceEnabled, path).toBe(false);
    }
  });

  it("throttles nothing else at method level", () => {
    const scoped = settings
      .filter((entry) => entry.ResourcePath !== "/*")
      .map((entry) => `${entry.HttpMethod} ${entry.ResourcePath}`)
      .sort();

    expect(scoped).toEqual(["GET /plans", "POST /webhook"]);
  });

  /* Access logging and execution logging both need an account-level API Gateway
   * CloudWatch role this stack does not own; enabling either would make every
   * deploy fail on a missing account setting. */
  it("configures no API Gateway access or execution logging", () => {
    expect(props("BillingApi")).not.toHaveProperty("AccessLogSetting");
    for (const entry of settings) {
      expect(entry).not.toHaveProperty("LoggingLevel");
    }
  });
});

describe("AD-5 raw-body integrity", () => {
  /* The decision of record: the proxy integration passes the body through
   * without re-serialising it, so the handler's Buffer.from(...) derivation is
   * correct either way - which is what makes the switch flippable with no code
   * change if AD-16's live signature test ever fails. */
  it("sets no BinaryMediaTypes, and records the remedy if that proves wrong", () => {
    expect(props("BillingApi")).not.toHaveProperty("BinaryMediaTypes");
    expect(TEMPLATE.text).toContain("BinaryMediaTypes is deliberately NOT set");
    expect(TEMPLATE.text).toContain("isBase64Encoded");
    expect(TEMPLATE.text).toContain("DEPLOYED stack");
  });
});

describe("AD-3 API mapping onto the shared domain", () => {
  const mapping = TEMPLATE.resources.BillingApiMapping;

  it("attaches by an ApiGatewayV2 mapping on the key v1/billing", () => {
    expect(mapping.Type).toBe("AWS::ApiGatewayV2::ApiMapping");
    expect(mapping.Properties.ApiMappingKey).toBe("v1/billing");
    expect(mapping.Properties.ApiId).toEqual(ref("BillingApi"));
    expect(mapping.Properties.DomainName).toEqual(ref("ApiDomainName"));
  });

  /* `Stage` takes a stage NAME. A Ref to the stage resource would resolve to a
   * logical id, and the mapping would fail to find a stage by that name. */
  it("names the stage as a literal string matching the API's own stage", () => {
    expect(mapping.Properties.Stage).toBe("v1");
    expect(typeof mapping.Properties.Stage).toBe("string");
    expect(props("BillingApi").StageName).toBe("v1");
  });

  /* The mapping is created in the same change set as the stage, so without this
   * the first deploy races the stage into existence. The referenced logical id is
   * the one the SAM transform generates: <ApiLogicalId><StageName>Stage. */
  it("waits for the SAM-generated stage resource", () => {
    expect(mapping.DependsOn).toBe("BillingApiv1Stage");
    expect(mapping.DependsOn).toBe(
      `BillingApi${props("BillingApi").StageName}Stage`,
    );
  });

  it("declares exactly one mapping, so no other stack's key is touched", () => {
    expect(
      resourcesOfType(TEMPLATE, "AWS::ApiGatewayV2::ApiMapping"),
    ).toHaveLength(1);
  });
});

describe("AD-13 gateway responses match the shared contract exactly", () => {
  const responses = props("BillingApi").GatewayResponses as Record<
    string,
    {
      StatusCode?: number;
      ResponseTemplates: Record<string, string>;
    }
  >;

  it("declares every enumerated type and no others", () => {
    expect(Object.keys(responses).sort()).toEqual(
      Object.keys(BILLING_GATEWAY_RESPONSES).sort(),
    );
  });

  it("emits the contract's status and code for each one", () => {
    for (const [type, expected] of Object.entries(BILLING_GATEWAY_RESPONSES)) {
      const response = responses[type as BillingGatewayResponseType]!;
      const body = JSON.parse(response.ResponseTemplates["application/json"]!);

      expect(body.error.code, `${type} code`).toBe(expected.code);
      expect(body.error.request_id, `${type} request id`).toBe(
        "$context.requestId",
      );
      expect(typeof body.error.message, `${type} message`).toBe("string");
      // A gateway response cannot know which field was refused, which capability
      // is missing, or what the minimum client version is, so it carries none of
      // the per-code members.
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
        type,
      ).not.toContain("$context.error");
    }
  });
});

describe("AD-4 billing storage", () => {
  const table = TEMPLATE.resources.BillingTable;

  it("keeps a pk/sk schema on the one on-demand billing table", () => {
    expect(table.Type).toBe("AWS::DynamoDB::Table");
    expect(table.Properties.BillingMode).toBe("PAY_PER_REQUEST");
    expect(table.Properties.KeySchema).toEqual([
      { AttributeName: "pk", KeyType: "HASH" },
      { AttributeName: "sk", KeyType: "RANGE" },
    ]);
    expect(resourcesOfType(TEMPLATE, "AWS::DynamoDB::Table")).toHaveLength(1);
  });

  it("is PITR-enabled, encrypted, and retained against deletion or replacement", () => {
    expect(table.Properties.PointInTimeRecoverySpecification).toEqual({
      PointInTimeRecoveryEnabled: true,
    });
    expect(table.Properties.SSESpecification).toEqual({ SSEEnabled: true });
    expect(table.DeletionPolicy).toBe("Retain");
    expect(table.UpdateReplacePolicy).toBe("Retain");
  });

  /* The EVENT# dedupe markers are the only items that carry it, and TTL reclaims
   * storage rather than defining the dedupe window - DynamoDB deletes expired
   * items "within a few days". */
  it("reclaims the EVENT# markers by TTL on expires_at", () => {
    expect(table.Properties.TimeToLiveSpecification).toEqual({
      AttributeName: "expires_at",
      Enabled: true,
    });
  });

  /* A webhook arrives keyed by Stripe customer and never by `sub`, so this index
   * is the only way back to an account. KEYS_ONLY because that lookup needs
   * nothing else, and a richer projection would be a second, eventually
   * consistent copy of payment state. */
  it("resolves a Stripe customer through a KEYS_ONLY GSI", () => {
    expect(table.Properties.GlobalSecondaryIndexes).toEqual([
      {
        IndexName: "stripe-customer-index",
        KeySchema: [{ AttributeName: "stripe_customer_id", KeyType: "HASH" }],
        Projection: { ProjectionType: "KEYS_ONLY" },
      },
    ]);
    expect(table.Properties.AttributeDefinitions).toEqual([
      { AttributeName: "pk", AttributeType: "S" },
      { AttributeName: "sk", AttributeType: "S" },
      { AttributeName: "stripe_customer_id", AttributeType: "S" },
    ]);
  });
});

describe("AD-9 the statement signing key", () => {
  const key = TEMPLATE.resources.StatementSigningKey;

  it("is an asymmetric ECC_NIST_P256 sign/verify key, retained", () => {
    expect(key.Type).toBe("AWS::KMS::Key");
    expect(key.Properties.KeySpec).toBe("ECC_NIST_P256");
    expect(key.Properties.KeyUsage).toBe("SIGN_VERIFY");
    expect(key.Properties.Enabled).toBe(true);
    expect(key.DeletionPolicy).toBe("Retain");
    expect(key.UpdateReplacePolicy).toBe("Retain");
    expect(resourcesOfType(TEMPLATE, "AWS::KMS::Key")).toHaveLength(1);
  });

  it("carries the alias an operator exports the public half through", () => {
    expect(props("StatementSigningKeyAlias").AliasName).toBe(
      "alias/nixus-billing-statement",
    );
    expect(props("StatementSigningKeyAlias").TargetKeyId).toEqual(
      ref("StatementSigningKey"),
    );
  });

  /* The key policy grants the ACCOUNT ROOT full control and nothing else. That
   * one statement is also the ONLY wildcard action in the whole template: a KMS
   * key policy without a root-admin statement cannot be repaired afterwards, and
   * this key is Retain with no recovery path, so an enumerated admin list that
   * turned out to be incomplete would permanently orphan every signed
   * statement. */
  it("grants the account root admin and nobody else", () => {
    const statements = key.Properties.KeyPolicy.Statement as {
      Sid: string;
      Effect: string;
      Principal: { AWS: unknown };
      Action: string;
    }[];

    expect(statements).toHaveLength(1);
    expect(statements[0]!.Effect).toBe("Allow");
    expect(statements[0]!.Action).toBe("kms:*");
    expect(statements[0]!.Principal.AWS).toEqual({
      __cfn: "Sub",
      value: "arn:${AWS::Partition}:iam::${AWS::AccountId}:root",
    });
  });

  it("is the only place in the template a wildcard action appears", () => {
    const wildcards = [...DECLARED.matchAll(/"[a-z0-9-]+:\*"/g)].map(
      (match) => match[0],
    );
    expect(wildcards).toEqual(['"kms:*"']);
  });

  it("publishes both the key id and the key ARN (AD-9)", () => {
    expect(TEMPLATE.outputs.StatementSigningKeyId.Value).toEqual(
      ref("StatementSigningKey"),
    );
    expect(TEMPLATE.outputs.StatementSigningKeyArn.Value).toEqual(
      getAtt("StatementSigningKey.Arn"),
    );
  });
});

describe("AD-7 / AD-15 the Lambda", () => {
  it("builds the one entry point through the makefile builder", () => {
    expect(TEMPLATE.resources.BillingFunction.Metadata.BuildMethod).toBe(
      "makefile",
    );
    expect(props("BillingFunction").Handler).toBe("api.handler");
    expect(props("BillingFunction").CodeUri).toBe("./");
    expect(props("BillingFunction").Role).toEqual(
      getAtt("BillingExecutionRole.Arn"),
    );

    expect(MAKEFILE).toContain("build-BillingFunction");
    expect(MAKEFILE).toContain("ENTRY_POINT := src/functions/api.ts");
    expect(MAKEFILE).toContain("--target=node24");
    expect(MAKEFILE).toContain('{"type":"commonjs"}');
    expect(MAKEFILE).toContain("exports no handler");

    const entryPoints = [...MAKEFILE.matchAll(/src\/functions\/\S+\.ts/g)];
    expect(new Set(entryPoints.map((match) => match[0])).size).toBe(1);
  });

  /* AD-15 REQUIRES a reservation here, and api-bedrock deliberately has NONE:
   * concurrency is an account-wide pool, and this stack publishes two
   * unauthenticated routes that could otherwise starve hosted AI and the profile
   * API. MinValue 1 is what keeps the parameter from being set to 0, which would
   * make the function inert rather than bounded. */
  it("reserves function-level concurrency, unlike api-bedrock and api-account", () => {
    expect(props("BillingFunction").ReservedConcurrentExecutions).toEqual(
      ref("BillingFunctionReservedConcurrency"),
    );
    expect(TEMPLATE.parameters.BillingFunctionReservedConcurrency.MinValue).toBe(
      1,
    );

    const bedrock = readRepoFile("apps/api-bedrock/template.yaml");
    const account = readRepoFile("apps/api-account/template.yaml");
    expect(bedrock).not.toMatch(/^\s+ReservedConcurrentExecutions:/m);
    expect(account).not.toMatch(/^\s+ReservedConcurrentExecutions:/m);
  });

  it("logs to a CloudFormation-created group with 14-day retention", () => {
    expect(props("BillingFunction").LoggingConfig.LogGroup).toEqual(
      ref("BillingLogGroup"),
    );
    expect(props("BillingLogGroup").RetentionInDays).toBe(14);
    expect(props("BillingLogGroup").LogGroupName).toEqual({
      __cfn: "Sub",
      value: "/aws/lambda/${AWS::StackName}-api",
    });
  });

  it("passes exactly the thirteen configured values as environment variables", () => {
    const env = props("BillingFunction").Environment.Variables as Record<
      string,
      unknown
    >;

    expect(Object.keys(env).sort()).toEqual([
      "ACCOUNT_APP_ORIGIN",
      "BILLING_TABLE_CUSTOMER_INDEX_NAME",
      "BILLING_TABLE_NAME",
      "CATALOG_CACHE_TTL_SECONDS",
      "CATALOG_LOOKUP_KEYS",
      "DEPLOYMENT_REVISION",
      "METRIC_NAMESPACE",
      "MINIMUM_CLIENT_VERSION",
      "STATEMENT_SIGNING_KEY_ARN",
      "STATEMENT_SIGNING_KEY_ID",
      "STRIPE_MODE",
      "STRIPE_SECRET_KEY_PARAMETER_NAME",
      "STRIPE_WEBHOOK_SECRET_PARAMETER_NAME",
    ]);

    expect(env.BILLING_TABLE_NAME).toEqual(ref("BillingTable"));
    expect(env.BILLING_TABLE_CUSTOMER_INDEX_NAME).toBe("stripe-customer-index");
    expect(env.STATEMENT_SIGNING_KEY_ID).toEqual(ref("StatementSigningKey"));
    expect(env.STATEMENT_SIGNING_KEY_ARN).toEqual(
      getAtt("StatementSigningKey.Arn"),
    );
    expect(env.METRIC_NAMESPACE).toBe(METRIC_NAMESPACE);
    expect(env.CATALOG_LOOKUP_KEYS).toEqual(ref("CatalogLookupKeys"));
    expect(env.ACCOUNT_APP_ORIGIN).toEqual(ref("AccountAppOrigin"));
  });

  /* AD-7: a Stripe secret may never be an environment variable, a template value
   * or a log line. Only the parameter NAMES cross this boundary, and nothing in
   * the stack creates or holds a secret of its own. */
  it("carries only the two parameter NAMES, never a key or a secret", () => {
    const env = props("BillingFunction").Environment.Variables as Record<
      string,
      unknown
    >;

    expect(env.STRIPE_SECRET_KEY_PARAMETER_NAME).toEqual(
      ref("StripeSecretKeyParameterName"),
    );
    expect(env.STRIPE_WEBHOOK_SECRET_PARAMETER_NAME).toEqual(
      ref("StripeWebhookSecretParameterName"),
    );

    // No value anywhere in the declared template looks like Stripe key material.
    for (const forbidden of [
      "sk_test_",
      "sk_live_",
      "rk_test_",
      "rk_live_",
      "whsec_",
      "pk_live_",
    ]) {
      expect(DECLARED, `the template names ${forbidden}`).not.toContain(
        forbidden,
      );
    }

    // And the stack creates neither a secret store nor a parameter of its own:
    // both SecureStrings are made by hand, out of band.
    expect(resourcesOfType(TEMPLATE, "AWS::SecretsManager::Secret")).toEqual([]);
    expect(resourcesOfType(TEMPLATE, "AWS::SSM::Parameter")).toEqual([]);

    // Every env NAME that mentions a secret mentions it as a parameter name.
    for (const [name, value] of Object.entries(env)) {
      if (!/SECRET|KEY/.test(name)) continue;
      if (name.endsWith("_PARAMETER_NAME")) continue;
      expect(
        JSON.stringify(value),
        `${name} must be a reference, not a literal`,
      ).toMatch(/__cfn/);
    }
  });
});

describe("AD-15 cost and error controls", () => {
  it("declares all six alarms on one topic, none breaching on missing data", () => {
    const alarms = resourcesOfType(TEMPLATE, "AWS::CloudWatch::Alarm");

    expect(
      alarms.map(([, alarm]) => alarm.Properties.MetricName).sort(),
    ).toEqual([
      "5XXError",
      "CatalogMetadataMalformed",
      "DuplicateSubscription",
      "Errors",
      "Throttles",
      "WebhookFailure",
    ]);

    for (const [name, alarm] of alarms) {
      expect(alarm.Properties.TreatMissingData, name).toBe("notBreaching");
      expect(alarm.Properties.AlarmActions, name).toEqual([
        ref("BillingAlertTopic"),
      ]);
    }
  });

  /* Both are DEDICATED alarms rather than a share of the Lambda error rate: a
   * webhook that never converged and a Product whose metadata silently granted
   * nothing are each invisible in a 5xx count, and the second is exactly how a
   * metadata typo revokes a paying customer's capability. */
  it("alarms on the two custom metrics in this stack's own namespace", () => {
    const custom = resourcesOfType(TEMPLATE, "AWS::CloudWatch::Alarm").filter(
      ([, alarm]) => alarm.Properties.Namespace === METRIC_NAMESPACE,
    );

    expect(
      custom.map(([, alarm]) => alarm.Properties.MetricName).sort(),
    ).toEqual([...BILLING_METRIC_NAMES].sort());

    for (const [name, alarm] of custom) {
      expect(alarm.Properties.Threshold, name).toBe(1);
      expect(alarm.Properties.ComparisonOperator, name).toBe(
        "GreaterThanOrEqualToThreshold",
      );
    }
  });

  it("subscribes the parameterized alert email to the alarm topic", () => {
    expect(props("BillingAlertSubscription").Protocol).toBe("email");
    expect(props("BillingAlertSubscription").Endpoint).toEqual(
      ref("AlertEmail"),
    );
    expect(resourcesOfType(TEMPLATE, "AWS::SNS::Topic")).toHaveLength(1);
  });

  it("declares a $10/month budget alerting at 80% and 100% on actual spend", () => {
    const budget = props("BillingMonthlyBudget").Budget;
    expect(budget.BudgetType).toBe("COST");
    expect(budget.TimeUnit).toBe("MONTHLY");
    expect(budget.BudgetLimit).toEqual({ Amount: 10, Unit: "USD" });

    // The four services this stack actually uses.
    expect(budget.CostFilters.Service.sort()).toEqual([
      "AWS Key Management Service",
      "AWS Lambda",
      "Amazon API Gateway",
      "Amazon DynamoDB",
    ]);

    const notifications = props("BillingMonthlyBudget")
      .NotificationsWithSubscribers as {
      Notification: { Threshold: number; NotificationType: string };
    }[];
    expect(
      notifications
        .map((entry) => entry.Notification.Threshold)
        .sort((a, b) => a - b),
    ).toEqual([80, 100]);
    for (const entry of notifications) {
      expect(entry.Notification.NotificationType).toBe("ACTUAL");
    }
  });
});

describe("outputs and committed config", () => {
  it("exposes the shared-domain base URL and the values a deploy asserts on", () => {
    expect(Object.keys(TEMPLATE.outputs).sort()).toEqual([
      "AccountAppOriginEcho",
      "AlertTopicArn",
      "ApiEndpoint",
      "BillingApiId",
      "BillingTableArn",
      "BillingTableCustomerIndexName",
      "BillingTableName",
      "CatalogCacheTtlSecondsEcho",
      "CatalogLookupKeysEcho",
      "CognitoUserPoolIdEcho",
      "FunctionName",
      "StatementSigningKeyArn",
      "StatementSigningKeyId",
      "StripeModeEcho",
    ]);

    expect(TEMPLATE.outputs.ApiEndpoint.Value).toEqual({
      __cfn: "Sub",
      value: "https://${ApiDomainName}/v1/billing",
    });
    expect(JSON.stringify(TEMPLATE.outputs)).not.toContain("execute-api");
  });

  it("pins the one production stack, region, and capability set", () => {
    expect(SAMCONFIG).toContain('stack_name = "nixus-billing"');
    expect(SAMCONFIG).toContain('region = "us-east-1"');
    expect(SAMCONFIG).toContain("lint = true");
    expect(SAMCONFIG).toContain('capabilities = "CAPABILITY_IAM"');
    expect(SAMCONFIG).not.toContain("CAPABILITY_NAMED_IAM");
    expect(SAMCONFIG).toContain("confirm_changeset = false");
    expect(SAMCONFIG).toContain("resolve_s3 = false");
    expect(SAMCONFIG).toContain(
      'tags = "app=nixus service=billing managed-by=sam"',
    );
  });

  it("commits no account-specific parameter override", () => {
    expect(SAMCONFIG).not.toMatch(/^parameter_overrides\s*=/m);
    expect(SAMCONFIG).not.toContain("arn:aws");
    expect(SAMCONFIG).not.toContain("us-east-1_");
  });
});
