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

/*
 * The account app holds no Stripe credential and no Stripe client (billing AD-7,
 * AD-8). It calls the billing API over https with the user's own access token,
 * receives a URL, and redirects out — full stop.
 *
 * This is the direction neither IAM nor the type system can see: nothing stops a
 * reviewer-plausible `import Stripe from "stripe"` or a publishable key pasted
 * into a component, and a card field in a component is a PCI-scope change that
 * looks like an ordinary form in a diff.
 *
 * Two of the forbidden tokens the brief listed are deliberately scoped rather
 * than banned outright, and the reason is recorded here:
 *
 *  - A bare `stripe` / `Stripe` substring cannot be banned, because
 *    `EntitlementSource` legitimately includes the literal `"stripe"` and the
 *    hosted-payment disclosure names the processor. What IS banned is every form
 *    in which the SDK or a credential could enter: the import, the constructor,
 *    the API host, and every key prefix.
 *  - `@aws-sdk/client-dynamodb` cannot be banned outright either, because
 *    `server/dynamo-store.ts` legitimately uses it for the SESSION table. What
 *    is banned is any OTHER module importing it, which is the thing that would
 *    let billing state be read or written locally.
 */
describe("the account app holds no Stripe credential (billing AD-7)", () => {
  it.each([
    'from "stripe"',
    "from 'stripe'",
    'require("stripe")',
    "new Stripe(",
    "api.stripe.com",
    "js.stripe.com",
    "StripeElements",
    "loadStripe",
    "@stripe/stripe-js",
    "@stripe/react-stripe-js",
  ])("never names %s", (forbidden) => {
    for (const file of SCANNED) {
      expect(file.code, `${file.path} names ${forbidden}`).not.toContain(forbidden);
    }
  });

  it.each([
    "publishable",
    "pk_live",
    "pk_test",
    "sk_test",
    "sk_live",
    "whsec_",
    "card_number",
    "STRIPE_SECRET",
    "STRIPE_API_KEY",
    "STRIPE_WEBHOOK",
  ])("never names the credential or card token %s", (forbidden) => {
    for (const file of SCANNED) {
      expect(file.code, `${file.path} names ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("declares no Stripe package in its own manifest", () => {
    const manifest = JSON.parse(
      readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8"),
    ) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };

    for (const name of Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })) {
      expect(name, `${name} is a Stripe package`).not.toMatch(/stripe/i);
    }
  });
});

describe("the account app never touches billing storage (billing AD-4, AD-7)", () => {
  it.each([
    "nixus-billing",
    "BILLING_TABLE",
    "BillingTable",
    '"ENTITLEMENT"',
    '"BILLING_CUSTOMER"',
    "stripe_customer_id",
    "stripe_subscription_id",
    "checkout_lock",
    "event_watermark",
  ])("never names %s", (forbidden) => {
    for (const file of RUNTIME) {
      expect(file.code, `${file.path} names ${forbidden}`).not.toContain(forbidden);
    }
  });

  /* The session store is the ONE legitimate DynamoDB user in this app. Any other
   * module importing the client is how billing state would start being read
   * locally instead of over the API. */
  it("imports the DynamoDB client in exactly one module, for the session table", () => {
    const importing = RUNTIME.filter((file) => file.code.includes("@aws-sdk/client-dynamodb"));
    expect(importing.map((file) => file.path)).toEqual(["server/dynamo-store.ts"]);
  });

  it("reaches billing only over https through the configured API base url", () => {
    const client = RUNTIME.find((file) => file.path === "server/billing-client.ts");
    expect(client).toBeDefined();
    expect(client?.code).not.toContain("@aws-sdk/");
    expect(client?.code).toContain("baseUrl");
    expect(client?.code).toContain("Bearer ");
  });

  /* AD-3: the Stripe customer is resolved from the caller's own record, so there
   * is no customer or subject parameter to send. A client that grew one would be
   * a cross-account read waiting to happen. */
  it("sends no subject or customer parameter on any billing route", () => {
    const client = RUNTIME.find((file) => file.path === "server/billing-client.ts");
    for (const forbidden of ["customerId", "customer_id", "sub:", '"sub"', "subject"]) {
      expect(client?.code, `billing-client names ${forbidden}`).not.toContain(forbidden);
    }
  });
});

describe("no surface renders a payment component (billing AD-8)", () => {
  it.each([
    "CardElement",
    "PaymentElement",
    "CardNumberElement",
    "CardCvcElement",
    "CardExpiryElement",
    "embeddedCheckout",
    "EmbeddedCheckout",
    'autoComplete="cc-number"',
    'autocomplete="cc-number"',
    "cc-csc",
    "cc-exp",
  ])("never names %s", (forbidden) => {
    for (const file of SCANNED) {
      expect(file.code, `${file.path} names ${forbidden}`).not.toContain(forbidden);
    }
  });

  /* Every paid action leaves this origin. `assign` is the only navigation the
   * billing surfaces perform, and it is handed a url the SERVER produced. */
  it("opens a commerce url by navigating out, never by rendering it inline", () => {
    const panel = RUNTIME.find((file) => file.path === "components/BillingPanel.tsx");
    expect(panel?.code).toContain("window.location.assign");
    expect(panel?.code).not.toContain("<iframe");
    expect(panel?.code).not.toContain("dangerouslySetInnerHTML");
  });
});

describe("no billing value is logged (billing AD-14)", () => {
  /* The log type is a closed record, so the enforcement is structural. This
   * pins the one thing a caller could still get wrong: passing a url, a code or
   * a statement into the `code` member, which IS a free string. */
  it("logs only stable codes from the billing actions", () => {
    const actions = RUNTIME.find((file) => file.path === "actions/billing.ts");
    expect(actions).toBeDefined();
    for (const forbidden of [
      "promotion_code:",
      "promotionCode,",
      "url,",
      "url:",
      "statement",
      "accessToken,",
    ]) {
      expect(actions?.code, `actions/billing.ts logs ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("never sends the signed statement to the browser", () => {
    for (const file of RUNTIME) {
      // The statement is a device-consumer artefact (AD-4); a server-side
      // consumer reads the record, so nothing here should mention it at all.
      expect(file.code, `${file.path} names the statement`).not.toContain("statement_exp");
    }
  });
});
