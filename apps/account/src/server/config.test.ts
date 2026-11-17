import { describe, expect, it } from "vitest";

import { OAUTH_SCOPES, deriveEndpoints, readConfig } from "./config.ts";

/*
 * Behind CloudFront with the managed `AllViewerExceptHostHeader` origin-request
 * policy the viewer's `Host` is replaced by the Lambda Web Function endpoint's own
 * domain, so every absolute URL and the `Origin` comparison must come from
 * configuration. These tests pin that the config is the authority and that the
 * scope set is never narrowed (adversary C5).
 */

const ENV = {
  PUBLIC_ORIGIN: "https://account.nixusapp.com",
  COGNITO_DOMAIN: "https://auth.nixusapp.com",
  COGNITO_CLIENT_ID: "1h57kf5a2b3c4d5e6f7g8h9i0j",
  COGNITO_USER_POOL_ID: "us-east-1_7gfGQ0emg",
  AWS_REGION: "us-east-1",
  SESSION_TABLE_NAME: "nixus-account-sessions",
  PROFILE_API_BASE_URL: "https://api.nixusapp.com/v1/profile",
  CLIENT_SECRET_PARAMETER_NAME: "/nixus-account/web-client-secret",
} satisfies NodeJS.ProcessEnv;

describe("readConfig", () => {
  it("reads every value from the environment", () => {
    expect(readConfig(ENV)).toEqual({
      publicOrigin: "https://account.nixusapp.com",
      cognitoDomain: "https://auth.nixusapp.com",
      cognitoClientId: ENV.COGNITO_CLIENT_ID,
      cognitoUserPoolId: ENV.COGNITO_USER_POOL_ID,
      region: "us-east-1",
      sessionTableName: "nixus-account-sessions",
      profileApiBaseUrl: "https://api.nixusapp.com/v1/profile",
      clientSecretParameterName: "/nixus-account/web-client-secret",
      issuerOverride: null,
    });
  });

  it("ignores the local issuer override on the production origin", () => {
    const config = readConfig({
      ...ENV,
      OIDC_ISSUER_FOR_LOCAL_RUN: "https://evil.example/issuer",
    });

    expect(config.issuerOverride).toBeNull();
    expect(deriveEndpoints(config).issuer).toBe(
      "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_7gfGQ0emg",
    );
  });

  it("honours it only when the public origin is loopback", () => {
    const config = readConfig({
      ...ENV,
      PUBLIC_ORIGIN: "http://127.0.0.1:3100",
      COGNITO_DOMAIN: "http://127.0.0.1:3101",
      PROFILE_API_BASE_URL: "http://127.0.0.1:3102/v1/profile",
      OIDC_ISSUER_FOR_LOCAL_RUN: "http://127.0.0.1:3101/issuer",
    });

    expect(deriveEndpoints(config).issuer).toBe("http://127.0.0.1:3101/issuer");
  });

  it("strips a trailing slash so built URLs never double it", () => {
    const config = readConfig({ ...ENV, PUBLIC_ORIGIN: "https://account.nixusapp.com/" });
    expect(config.publicOrigin).toBe("https://account.nixusapp.com");
  });

  it.each(["PUBLIC_ORIGIN", "COGNITO_CLIENT_ID", "SESSION_TABLE_NAME", "AWS_REGION"])(
    "refuses to start without %s",
    (name) => {
      expect(() => readConfig({ ...ENV, [name]: undefined })).toThrow(name);
    },
  );

  it.each([
    "http://account.nixusapp.com",
    "ftp://account.nixusapp.com",
  ])("refuses the insecure origin %s", (origin) => {
    expect(() => readConfig({ ...ENV, PUBLIC_ORIGIN: origin })).toThrow();
  });

  it("carries no client secret member at all", () => {
    expect(Object.keys(readConfig(ENV)).join(" ").toLowerCase()).not.toContain("secretvalue");
    expect(readConfig(ENV)).not.toHaveProperty("clientSecret");
  });
});

describe("deriveEndpoints", () => {
  const endpoints = deriveEndpoints(readConfig(ENV));

  it("derives the pool issuer the id_token must carry", () => {
    expect(endpoints.issuer).toBe(
      "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_7gfGQ0emg",
    );
    expect(endpoints.jwksUri).toBe(`${endpoints.issuer}/.well-known/jwks.json`);
  });

  it("uses the sole registered callback, built from the public origin", () => {
    expect(endpoints.redirectUri).toBe("https://account.nixusapp.com/auth/callback");
  });

  it.each([
    ["authorizeUrl", "https://auth.nixusapp.com/oauth2/authorize"],
    ["tokenUrl", "https://auth.nixusapp.com/oauth2/token"],
    ["revokeUrl", "https://auth.nixusapp.com/oauth2/revoke"],
    ["logoutUrl", "https://auth.nixusapp.com/logout"],
  ])("points %s at managed login", (key, expected) => {
    expect(endpoints[key as keyof typeof endpoints]).toBe(expected);
  });
});

describe("OAUTH_SCOPES", () => {
  it("asks for exactly the four scopes the web client is configured for", () => {
    expect(OAUTH_SCOPES.split(" ").sort()).toEqual([
      "email",
      "nixus-api/profile",
      "openid",
      "profile",
    ]);
  });

  it("never asks for the hosted-AI scope the desktop depends on", () => {
    expect(OAUTH_SCOPES).not.toContain("ai.invoke");
  });
});
