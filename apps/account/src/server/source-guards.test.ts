import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Source guards for the rules IAM and types cannot express.
 *
 * AD-10: `GlobalSignOut` / `AdminUserGlobalSignOut` would sign the user out of the
 * DESKTOP app from a click on the website (adversary H13), and no amount of review
 * discipline keeps a plausible-looking API call out of a sign-out handler.
 *
 * AD-11: the account app must hold no notion of the profile table. One writer, one
 * validator, enforced here in the direction IAM cannot see — the api-account suite
 * carries the other direction.
 */

const SRC_ROOT = fileURLToPath(new URL("../", import.meta.url));

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(path, found);
    else if (/\.tsx?$/.test(entry.name)) found.push(path);
  }
  return found;
}

/* Comments are stripped first: this app deliberately NAMES the calls it refuses to
 * make, and a raw-text scan would match that rationale. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

const SOURCES = sourceFiles(SRC_ROOT).map((path) => ({
  path: path.slice(SRC_ROOT.length),
  code: stripComments(readFileSync(path, "utf8")),
}));

/* This file names every call and literal it forbids, so it is excluded from its
 * own scans; `RUNTIME` additionally drops the tests and the in-memory fakes. */
const SCANNED = SOURCES.filter((file) => file.path !== "server/source-guards.test.ts");

const RUNTIME = SCANNED.filter(
  (file) => !file.path.endsWith(".test.ts") && !file.path.includes("testing/"),
);

describe("sign-out never reaches past this session (AD-10)", () => {
  it.each(["GlobalSignOut", "AdminUserGlobalSignOut", "AdminDisableUser", "RevokeToken"])(
    "never names %s",
    (forbidden) => {
      for (const file of SCANNED) {
        expect(file.code, `${file.path} names ${forbidden}`).not.toContain(forbidden);
      }
    },
  );

  it("revokes through the OAuth revocation endpoint on the web client", () => {
    const endpoints = RUNTIME.find((file) => file.path === "server/config.ts");
    const oidc = RUNTIME.find((file) => file.path === "server/oidc.ts");
    expect(endpoints?.code).toContain("/oauth2/revoke");
    expect(oidc?.code).toContain("endpoints.revokeUrl");
    expect(oidc?.code).toContain("basicAuth(config.cognitoClientId");
  });

  it("imports no Cognito identity-provider SDK client anywhere", () => {
    for (const file of SCANNED) {
      expect(file.code, file.path).not.toContain("@aws-sdk/client-cognito-identity-provider");
    }
  });
});

describe("the account app never touches profile storage (AD-11)", () => {
  it.each([
    "nixus-account-profile",
    "PROFILE_TABLE",
    "ProfileTable",
    "USER#",
    '"PROFILE"',
    '"AVATAR"',
  ])("never names %s", (forbidden) => {
    for (const file of RUNTIME) {
      expect(file.code, `${file.path} names ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("creates a DynamoDB client in exactly one module, for the session table", () => {
    const creating = RUNTIME.filter((file) => file.code.includes("new DynamoDBClient"));
    expect(creating.map((file) => file.path)).toEqual(["server/dynamo-store.ts"]);
    const store = creating[0];
    expect(store?.code).toContain("SessionStore");
  });

  it("reaches the profile only over https through the configured API base url", () => {
    const client = RUNTIME.find((file) => file.path === "server/profile-client.ts");
    expect(client).toBeDefined();
    expect(client?.code).not.toContain("@aws-sdk/");
    expect(client?.code).toContain("baseUrl");
  });

  it("names the production profile API in configuration only, never in a module", () => {
    for (const file of RUNTIME) {
      expect(file.code, `${file.path} hardcodes the api host`).not.toContain(
        "api.nixusapp.com",
      );
    }
  });
});

describe("the client secret never leaves the server (AD-10)", () => {
  it("reads it in exactly one module", () => {
    const reading = RUNTIME.filter((file) => file.code.includes("WithDecryption"));
    expect(reading.map((file) => file.path)).toEqual(["server/secret.ts"]);
  });

  it("never names an environment variable that would carry it", () => {
    for (const file of SCANNED) {
      for (const forbidden of ["CLIENT_SECRET=", "COGNITO_CLIENT_SECRET", "clientSecretValue"]) {
        expect(file.code, `${file.path} names ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("keeps the SSM client out of every module but the secret reader", () => {
    const importing = SCANNED.filter((file) => file.code.includes("@aws-sdk/client-ssm"));
    expect(importing.map((file) => file.path)).toEqual(["server/secret.ts"]);
  });
});

describe("the public origin is configured, never derived from the request (AD-10)", () => {
  it.each(["getRequestHost", "x-forwarded-host", "getRequestUrl"])(
    "never uses %s, which behind CloudFront is the Lambda endpoint's own domain",
    (forbidden) => {
      for (const file of RUNTIME) {
        expect(file.code, `${file.path} uses ${forbidden}`).not.toContain(forbidden);
      }
    },
  );

  it("compares Origin against the configured value in one module", () => {
    const comparing = RUNTIME.filter((file) => file.code.includes("publicOrigin)"));
    expect(comparing.map((file) => file.path)).toContain("server/origin.ts");
  });
});

describe("logging has one site (AD-12)", () => {
  it("calls console nowhere but the log module", () => {
    const logging = RUNTIME.filter((file) => /\bconsole\./.test(file.code));
    expect(logging.map((file) => file.path)).toEqual(["server/log.ts"]);
  });
});
