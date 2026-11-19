import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { loadTemplate, readRepoFile, ref, REPO_ROOT, resourcesOfType } from "./lib/testing/cfn.ts";

/*
 * The account app's half of the stack (AD-10, AD-14), as an infrastructure
 * contract.
 *
 * Almost nothing here is reachable from a unit test and every item is a setting
 * whose wrong value is either a silent security hole or a deploy that fails only
 * once it reaches AWS - the Phase 0 spike burned two stacks on two of them. The
 * managed CloudFront policy ids are the clearest case: they are opaque, so a
 * transposed id is invisible in review and shows up as a cached Set-Cookie or a
 * 404 from the origin.
 */

const TEMPLATE = loadTemplate("apps/api-account/template.yaml");

/* eslint-disable @typescript-eslint/no-explicit-any */
function props(logicalId: string): any {
  const resource = TEMPLATE.resources[logicalId];
  expect(resource, `missing resource ${logicalId}`).toBeDefined();
  return resource.Properties;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const MANAGED = {
  cachingDisabled: "4135ea2d-6df8-44a3-9df3-4b5a84be39ad",
  cachingOptimized: "658327ea-f89d-4fab-a63d-7e88639e58f6",
  allViewerExceptHostHeader: "b689b0a8-53d0-40ab-baf2-68738e2966ac",
} as const;

describe("AD-10 the confidential web client", () => {
  const client = props("AccountWebClient");

  it("is confidential and uses the authorization-code flow only", () => {
    expect(client.GenerateSecret).toBe(true);
    expect(client.AllowedOAuthFlowsUserPoolClient).toBe(true);
    expect(client.AllowedOAuthFlows).toEqual(["code"]);
    // An implicit-flow client hands tokens to the browser, which is the whole
    // thing the BFF exists to avoid.
    expect(JSON.stringify(client.AllowedOAuthFlows)).not.toContain("implicit");
  });

  it("asks for exactly the five scopes the app is built for", () => {
    expect([...client.AllowedOAuthScopes].sort()).toEqual([
      "email",
      "nixus-api/billing",
      "nixus-api/profile",
      "openid",
      "profile",
    ]);
    // The desktop's scope must never be granted to a browser session.
    expect(JSON.stringify(client)).not.toContain("ai.invoke");
  });

  it("registers one callback and one logout url, both on the account origin", () => {
    expect(client.CallbackURLs).toEqual([
      { __cfn: "Sub", value: "https://${AccountDomainName}/auth/callback" },
    ]);
    expect(client.LogoutURLs).toEqual([
      { __cfn: "Sub", value: "https://${AccountDomainName}/" },
    ]);
  });

  it("federates with Cognito only, because Google is deferred", () => {
    expect(client.SupportedIdentityProviders).toEqual(["COGNITO"]);
    expect(JSON.stringify(client)).not.toContain("Google");
  });

  /* Revocation is what makes sign-out mean anything, and a 15-minute access token
   * is what bounds the window a captured one stays usable - the authorizer
   * validates JWTs locally and never calls back to Cognito (F8). */
  it("enables token revocation and keeps the access token short-lived", () => {
    expect(client.EnableTokenRevocation).toBe(true);
    expect(client.AccessTokenValidity).toBe(15);
    expect(client.IdTokenValidity).toBe(15);
    expect(client.TokenValidityUnits).toEqual({
      AccessToken: "minutes",
      IdToken: "minutes",
      RefreshToken: "days",
    });
    expect(client.RefreshTokenValidity).toBe(7);
  });

  it("hides whether an address has an account", () => {
    expect(client.PreventUserExistenceErrors).toBe("ENABLED");
  });

  /* An app client created through CloudFormation gets NO branding style, and
   * managed login is unavailable for such a client until a
   * CreateManagedLoginBranding request is made - so without this resource sign-in
   * is dead on the first deploy (F3). */
  it("carries managed-login branding, without which sign-in cannot render", () => {
    const branding = resourcesOfType(TEMPLATE, "AWS::Cognito::ManagedLoginBranding");
    expect(branding.map(([name]) => name)).toEqual(["AccountWebClientBranding"]);
    expect(props("AccountWebClientBranding").ClientId).toEqual(ref("AccountWebClient"));
  });

  /* The account site's sign-in page must be the same Nixus page the desktop shows,
   * not Cognito's default style. The branding is generated from ../branding (a copy
   * of the desktop client's console-managed style), and this pins the template to
   * those files byte for byte so a hand edit or a stale regeneration fails here. */
  it("uses the desktop's branding, generated from the committed branding files", () => {
    const branding = props("AccountWebClientBranding");
    expect(branding.UseCognitoProvidedValues).toBe(false);
    expect(branding.Settings).toEqual(
      JSON.parse(readRepoFile("apps/api-account/branding/managed-login-settings.json")),
    );

    const assets = branding.Assets as {
      Category: string;
      ColorMode: string;
      Extension: string;
      Bytes: string;
    }[];
    const expected = [
      ["PAGE_BACKGROUND", "LIGHT", "WEBP", "page-background-light.webp"],
      ["FAVICON_SVG", "LIGHT", "SVG", "favicon-light.svg"],
    ];
    expect(assets.map((asset) => [asset.Category, asset.ColorMode, asset.Extension])).toEqual(
      expected.map(([category, mode, extension]) => [category, mode, extension]),
    );
    for (const [index, [, , , file]] of expected.entries()) {
      const committed = readFileSync(
        fileURLToPath(new URL(`apps/api-account/branding/${file}`, REPO_ROOT)),
      ).toString("base64");
      expect(assets[index]?.Bytes, file).toBe(committed);
    }
  });
});

describe("AD-10 the session table", () => {
  const session = TEMPLATE.resources.SessionTable;

  it("is keyed by one opaque id, with no range key to enumerate", () => {
    expect(session.Properties.KeySchema).toEqual([
      { AttributeName: "id", KeyType: "HASH" },
    ]);
    expect(session.Properties.BillingMode).toBe("PAY_PER_REQUEST");
    expect(session.Properties.SSESpecification).toEqual({ SSEEnabled: true });
  });

  it("enables TTL on expires_at, which reclaims storage only", () => {
    expect(session.Properties.TimeToLiveSpecification).toEqual({
      AttributeName: "expires_at",
      Enabled: true,
    });
  });

  /* Disposable, unlike the profile table: every row is reconstructible by signing
   * in again, so there is no point-in-time recovery to pay for.
   *
   * Retained all the same, and not as a data claim: the deploy role holds no
   * dynamodb:DeleteTable - asserted in oidc-bootstrap.test.ts - so Retain is the
   * only policy under which a failed CREATE rolls back rather than stalling. The
   * TTL is what makes it safe: every retained row expires within seven days. */
  it("has no point-in-time recovery, and is retained so a rollback can complete", () => {
    expect(session.Properties).not.toHaveProperty("PointInTimeRecoverySpecification");
    expect(session.DeletionPolicy).toBe("Retain");
    expect(session.UpdateReplacePolicy).toBe("Retain");
  });
});

describe("AD-14 the Lambda Web Function", () => {
  const revision = props("AccountWebFunctionRevision");
  const endpoint = props("AccountWebFunctionEndpoint");

  it("runs Node 24 from the pipeline-supplied code key", () => {
    expect(revision.BuildConfig.RuntimeConfig.Runtime).toBe("nodejs24.x");
    expect(revision.BuildConfig.CodeConfig.S3Object).toEqual({
      Bucket: ref("AccountAppCodeBucket"),
      Key: ref("AccountAppCodeKey"),
    });
  });

  /* Lambda Web stores code by REFERENCE and the SERVICE reads the object, so
   * without this policy CreateWebFunctionRevision fails outright - it cost the
   * spike a stack. GetObjectVersion is required because the reference names a
   * specific version, which is also why the bucket must be versioned. */
  it("waits for the code bucket policy that lets Lambda read the object", () => {
    expect(TEMPLATE.resources.AccountWebFunctionRevision.DependsOn).toBe(
      "AccountAppCodeBucketPolicy"
    );

    const statement = props("AccountAppCodeBucketPolicy").PolicyDocument.Statement[0];
    expect(statement.Principal).toEqual({ Service: "lambda.amazonaws.com" });
    expect([...statement.Action].sort()).toEqual([
      "s3:GetObject",
      "s3:GetObjectVersion",
    ]);
    expect(statement.Condition.StringEquals["aws:SourceAccount"]).toEqual(
      ref("AWS::AccountId")
    );
  });

  it("is invokable only through CloudFront, in its home region", () => {
    expect(endpoint.AuthType).toBe("IamAuth");
    expect(endpoint.EndpointType).toBe("HomeRegion");
    expect(endpoint.RevisionWeights).toEqual([
      { RevisionId: { __cfn: "GetAtt", value: "AccountWebFunctionRevision.RevisionId" }, Weight: 100 },
    ]);
  });

  it("carries only non-secret configuration in its environment", () => {
    const environment = revision.ServiceConfig.EnvironmentVariables as Record<
      string,
      unknown
    >;

    expect(Object.keys(environment).sort()).toEqual([
      "BILLING_API_BASE_URL",
      "CLIENT_SECRET_PARAMETER_NAME",
      "COGNITO_CLIENT_ID",
      "COGNITO_DOMAIN",
      "COGNITO_USER_POOL_ID",
      "PROFILE_API_BASE_URL",
      "PUBLIC_ORIGIN",
      "SESSION_TABLE_NAME",
    ]);

    // The PATH of the secret, never the secret. If the value could be here, it
    // would be readable from `describe-web-function-revision` by anyone with read
    // access to Lambda (AD-10).
    expect(environment.CLIENT_SECRET_PARAMETER_NAME).toEqual({
      __cfn: "Sub",
      value: "/${AWS::StackName}/web-client-secret",
    });
    for (const forbidden of ["SECRET_VALUE", "CLIENT_SECRET=", "AWS_SECRET"]) {
      expect(JSON.stringify(environment)).not.toContain(forbidden);
    }
  });

  /* The Origin check and every absolute URL are built from PUBLIC_ORIGIN, because
   * behind AllViewerExceptHostHeader the server's own Host is the endpoint's
   * domain - a Host-derived origin would compare a value the viewer never sent. */
  it("configures the public origin as the account hostname", () => {
    expect(revision.ServiceConfig.EnvironmentVariables.PUBLIC_ORIGIN).toEqual({
      __cfn: "Sub",
      value: "https://${AccountDomainName}",
    });
  });

  /* billing AD-3 / AD-7: the billing API attaches to the same shared domain by
   * an API mapping on `v1/billing`, so this is derived from ApiDomainName rather
   * than imported from the nixus-billing stack - and it is the ONLY billing
   * configuration the account app gets. A Stripe credential here would make the
   * app a second key holder, which is the thing AD-7 forbids. */
  it("points at the billing API through the shared domain, with no Stripe secret", () => {
    const environment = revision.ServiceConfig.EnvironmentVariables as Record<
      string,
      unknown
    >;

    expect(environment.BILLING_API_BASE_URL).toEqual({
      __cfn: "Sub",
      value: "https://${ApiDomainName}/v1/billing",
    });
    for (const forbidden of ["STRIPE", "stripe", "sk_live", "sk_test", "whsec_"]) {
      expect(JSON.stringify(environment), `environment names ${forbidden}`).not.toContain(
        forbidden,
      );
    }
  });

  it("logs to the 14-day group this stack created, not an implicit one", () => {
    expect(revision.ServiceConfig.TelemetryConfig.LoggingConfig.LogGroup).toEqual(
      ref("AccountAppLogGroup")
    );
    expect(props("AccountAppLogGroup").RetentionInDays).toBe(14);
  });

  /* Web Function memory is fixed at 2 GB and there is no Architectures property,
   * so a native binary in the package cannot be matched to the platform. */
  it("sets neither memory nor architecture, which the resource has no property for", () => {
    expect(revision.ServiceConfig).not.toHaveProperty("MemorySize");
    expect(revision).not.toHaveProperty("Architectures");
  });
});

describe("AD-14 the distribution", () => {
  const distribution = props("AccountDistribution").DistributionConfig;
  const behaviour = distribution.DefaultCacheBehavior;

  it("serves the account hostname on the existing certificate at TLS 1.2", () => {
    expect(distribution.Aliases).toEqual([ref("AccountDomainName")]);
    expect(distribution.ViewerCertificate).toEqual({
      AcmCertificateArn: ref("AccountCertificateArn"),
      SslSupportMethod: "sni-only",
      MinimumProtocolVersion: "TLSv1.2_2021",
    });
  });

  it("redirects http to https on every behaviour", () => {
    for (const each of [behaviour, ...distribution.CacheBehaviors]) {
      expect(each.ViewerProtocolPolicy).toBe("redirect-to-https");
    }
  });

  /* CloudFront rejects every other signing behaviour for a Web Function origin.
   * `always-amz-auth` also forwards the viewer's own Authorization header
   * unmodified, which is what lets app-level auth work on an IamAuth endpoint. */
  it("signs the Lambda origin with always-amz-auth over sigv4", () => {
    const oac = props("AccountLambdaOac").OriginAccessControlConfig;
    expect(oac.OriginAccessControlOriginType).toBe("lambda");
    expect(oac.SigningBehavior).toBe("always-amz-auth");
    // sigv4a is for MultiRegion endpoints only.
    expect(oac.SigningProtocol).toBe("sigv4");
  });

  it("caches nothing dynamic and withholds the viewer's Host from the origin", () => {
    expect(behaviour.CachePolicyId).toBe(MANAGED.cachingDisabled);
    // AllViewer here would forward the viewer's Host, which the endpoint answers
    // with 404 because it requires its own domain.
    expect(behaviour.OriginRequestPolicyId).toBe(MANAGED.allViewerExceptHostHeader);
    expect([...behaviour.AllowedMethods].sort()).toEqual([
      "DELETE",
      "GET",
      "HEAD",
      "OPTIONS",
      "PATCH",
      "POST",
      "PUT",
    ]);
    expect([...behaviour.CachedMethods].sort()).toEqual(["GET", "HEAD"]);
  });

  it("serves /assets/* from the S3 origin with the immutable cache policy", () => {
    expect(distribution.CacheBehaviors).toHaveLength(1);
    const assets = distribution.CacheBehaviors[0];
    expect(assets.PathPattern).toBe("/assets/*");
    expect(assets.TargetOriginId).toBe("s3-assets");
    expect(assets.CachePolicyId).toBe(MANAGED.cachingOptimized);
    expect([...assets.AllowedMethods].sort()).toEqual(["GET", "HEAD"]);
  });

  it("points the two origins at the endpoint and the asset bucket", () => {
    const origins = Object.fromEntries(
      (distribution.Origins as { Id: string }[]).map((origin) => [origin.Id, origin])
    );

    expect(Object.keys(origins).sort()).toEqual(["lambda-web", "s3-assets"]);
    expect(origins["lambda-web"]).toMatchObject({
      DomainName: { __cfn: "GetAtt", value: "AccountWebFunctionEndpoint.DomainName" },
      OriginAccessControlId: { __cfn: "GetAtt", value: "AccountLambdaOac.Id" },
      CustomOriginConfig: { OriginProtocolPolicy: "https-only", HTTPSPort: 443 },
    });
    expect(origins["s3-assets"]).toMatchObject({
      DomainName: { __cfn: "GetAtt", value: "AccountAssetsBucket.RegionalDomainName" },
      OriginAccessControlId: { __cfn: "GetAtt", value: "AccountS3Oac.Id" },
    });
  });

  it("attaches the security header policy to every behaviour", () => {
    for (const each of [behaviour, ...distribution.CacheBehaviors]) {
      expect(each.ResponseHeadersPolicyId).toEqual(ref("AccountSecurityHeaders"));
    }

    const headers = props("AccountSecurityHeaders").ResponseHeadersPolicyConfig
      .SecurityHeadersConfig;
    expect(headers.StrictTransportSecurity.AccessControlMaxAgeSec).toBe(31536000);
    // Preload commits every nixusapp.com host, including ones this stack does not
    // own, and is effectively irreversible.
    expect(headers.StrictTransportSecurity.Preload).toBe(false);
    expect(headers.FrameOptions.FrameOption).toBe("DENY");
    expect(headers.ContentTypeOptions.Override).toBe(true);
    expect(headers.ReferrerPolicy.ReferrerPolicy).toBe(
      "strict-origin-when-cross-origin"
    );
  });

  it("uses no Lambda@Edge, which a Lambda Web origin with OAC forbids", () => {
    expect(TEMPLATE.text).not.toContain("LambdaFunctionAssociations");
  });
});

describe("AD-14 the asset bucket", () => {
  /* CloudFormation cannot delete a bucket that still holds objects, and this one
   * always does - so a non-retained asset bucket turns any rollback into a
   * DELETE_FAILED that needs an operator. */
  it("is retained, because a rollback cannot delete a bucket with objects in it", () => {
    expect(TEMPLATE.resources.AccountAssetsBucket.DeletionPolicy).toBe("Retain");
    expect(TEMPLATE.resources.AccountAssetsBucket.UpdateReplacePolicy).toBe("Retain");
  });

  it("blocks all public access and enforces bucket ownership", () => {
    expect(props("AccountAssetsBucket").PublicAccessBlockConfiguration).toEqual({
      BlockPublicAcls: true,
      BlockPublicPolicy: true,
      IgnorePublicAcls: true,
      RestrictPublicBuckets: true,
    });
    expect(props("AccountAssetsBucket").OwnershipControls.Rules).toEqual([
      { ObjectOwnership: "BucketOwnerEnforced" },
    ]);
  });

  it("is readable by this distribution and by nothing else", () => {
    const statement = props("AccountAssetsBucketPolicy").PolicyDocument.Statement[0];
    expect(statement.Principal).toEqual({ Service: "cloudfront.amazonaws.com" });
    expect(statement.Action).toBe("s3:GetObject");
    expect(statement.Condition.StringEquals["AWS:SourceArn"]).toEqual({
      __cfn: "Sub",
      value:
        "arn:${AWS::Partition}:cloudfront::${AWS::AccountId}:distribution/${AccountDistribution}",
    });
  });
});

describe("the resource policy is not a CloudFormation resource", () => {
  /* `lambda:InvokeWebFunctionEndpoint` for the CloudFront principal needs the
   * distribution id, which does not exist until the stack is created - so it is a
   * post-deploy step, and the outputs exist to drive it. There is no AddPermission
   * for Web Functions, and PutResourcePolicy REPLACES the policy wholesale. */
  it("exposes the function arn, endpoint arn and distribution id a deploy needs", () => {
    expect(TEMPLATE.outputs.AccountWebFunctionArn.Value).toEqual({
      __cfn: "GetAtt",
      value: "AccountWebFunction.FunctionArn",
    });
    expect(TEMPLATE.outputs.AccountWebFunctionEndpointArn.Value).toEqual({
      __cfn: "GetAtt",
      value: "AccountWebFunctionEndpoint.EndpointArn",
    });
    expect(TEMPLATE.outputs.AccountAppDistributionId.Value).toEqual(
      ref("AccountDistribution")
    );
  });

  it("declares no resource policy, because the type does not exist", () => {
    expect(TEMPLATE.text).not.toContain("AWS::Lambda::Permission");
    expect(TEMPLATE.text).not.toContain("InvokeWebFunctionEndpoint");
  });
});
