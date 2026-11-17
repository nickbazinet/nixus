import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AVATAR_BODY_MAX_BYTES,
  AVATAR_MAX_DECODED_BYTES,
  PROFILE_BODY_MAX_BYTES,
} from "@nixus/shared";

import { dispatch } from "./api.ts";
import {
  FakeDynamo,
  throttlingError,
} from "../lib/testing/fake-dynamo.ts";
import {
  SUB_A,
  SUB_B,
  apiEvent,
  base64Of,
  jpegBytes,
  pngBytes,
} from "../lib/testing/fixtures.ts";
import { setDocumentClientForTesting } from "../lib/table.ts";

/*
 * Route-level contract for the five routes (AD-3/AD-4/AD-13). The DynamoDB
 * boundary is a real in-memory store, so isolation and concurrency are observed
 * properties of the stored items rather than of a mock's expectations.
 */

const NOW = new Date("2026-11-17T12:00:00.000Z");

let dynamo: FakeDynamo;

function emptyProfileBody(expectedVersion: number | null) {
  return {
    first_name: null,
    last_name: null,
    birth_date: null,
    income_bracket: null,
    income_bracket_currency: null,
    country_code: null,
    subdivision_code: null,
    expected_version: expectedVersion,
  };
}

async function call(args: {
  readonly route: string;
  readonly method: string;
  readonly sub?: string;
  readonly body?: unknown;
  readonly rawBody?: string;
}) {
  const response = await dispatch(apiEvent(args), () => NOW);
  return {
    status: response.statusCode,
    headers: response.headers ?? {},
    payload: JSON.parse(response.body as string) as Record<string, unknown>,
    raw: response.body as string,
  };
}

beforeEach(() => {
  process.env.PROFILE_TABLE_NAME = "nixus-account-profile";
  dynamo = new FakeDynamo();
  setDocumentClientForTesting(dynamo.asDocumentClient());
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  setDocumentClientForTesting(undefined);
  vi.restoreAllMocks();
});

describe("identity comes from the authorizer and must look like a sub", () => {
  it("refuses a request with no authorizer claims", async () => {
    const response = await call({ route: "/", method: "GET" });

    expect(response.status).toBe(401);
    expect(response.payload.error).toMatchObject({ code: "unauthorized" });
    expect(dynamo.sent).toEqual([]);
  });

  /* A claim of another shape is not a user this service has storage for, and the
   * check runs before any key exists (AD-3). */
  it.each([
    ["not-a-uuid", "USER#not-a-uuid"],
    ["", "USER#"],
    ["11111111-2222-4333-8444-55555555555", "truncated uuid"],
    ["USER#11111111-2222-4333-8444-555555555555", "a pre-composed key"],
    ["../11111111-2222-4333-8444-555555555555", "a traversal attempt"],
  ])("refuses the non-UUID claim %s (%s)", async (sub) => {
    const response = await call({ route: "/", method: "GET", sub });

    expect(response.status).toBe(401);
    expect(response.payload.error).toMatchObject({ code: "unauthorized" });
    expect(dynamo.sent).toEqual([]);
  });

  /* Regression: the live pool issues subs whose version/variant nibbles are not
   * RFC 4122 (here `7055` and `4c26`). The shape check must accept them. */
  it("accepts a Cognito sub that is UUID-shaped but not RFC 4122 variant-conformant", async () => {
    const response = await call({
      route: "/",
      method: "GET",
      sub: "0123abcd-40e1-7055-4c26-6626acb8e19b",
    });

    expect(response.status).toBe(200);
    expect(response.payload).toBeNull();
  });

  it("never echoes the rejected claim or a composed key", async () => {
    const response = await call({
      route: "/",
      method: "GET",
      sub: "not-a-uuid",
    });

    expect(response.raw).not.toContain("not-a-uuid");
    expect(response.raw).not.toContain("USER#");
  });
});

describe("GET / (profile)", () => {
  it("answers 200 with the JSON literal null when no profile exists", async () => {
    const response = await call({ route: "/", method: "GET", sub: SUB_A });

    expect(response.status).toBe(200);
    expect(response.raw).toBe("null");
    // No avatar read at all when the profile is absent.
    expect(dynamo.gets).toHaveLength(1);
  });

  it("returns the profile with avatar_version and never pk, sk or sub", async () => {
    dynamo.seed({
      pk: `USER#${SUB_A}`,
      sk: "PROFILE",
      first_name: "Ada",
      last_name: null,
      birth_date: "1985-03-14",
      income_bracket: "100k_149k",
      income_bracket_currency: "CAD",
      country_code: "CA",
      subdivision_code: "CA-QC",
      version: 3,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-02-01T00:00:00.000Z",
    });
    dynamo.seed({
      pk: `USER#${SUB_A}`,
      sk: "AVATAR",
      data: pngBytes(64, 64),
      mime_type: "image/png",
      version: 2,
      updated_at: "2026-02-01T00:00:00.000Z",
    });

    const response = await call({ route: "/", method: "GET", sub: SUB_A });

    expect(response.status).toBe(200);
    expect(response.payload).toEqual({
      first_name: "Ada",
      last_name: null,
      birth_date: "1985-03-14",
      income_bracket: "100k_149k",
      income_bracket_currency: "CAD",
      country_code: "CA",
      subdivision_code: "CA-QC",
      version: 3,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-02-01T00:00:00.000Z",
      avatar_version: 2,
    });
    expect(response.raw).not.toContain("pk");
    expect(response.raw).not.toContain(SUB_A);
  });

  /* The avatar item is 64 KiB of bytes; a profile read must never load them. */
  it("projects only the version when reading the avatar item", async () => {
    dynamo.seed({
      pk: `USER#${SUB_A}`,
      sk: "PROFILE",
      version: 1,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    });

    await call({ route: "/", method: "GET", sub: SUB_A });

    const avatarRead = dynamo.gets.find(
      (command) =>
        (command.input.Key as { sk: string }).sk === "AVATAR"
    );
    expect(avatarRead?.input.ProjectionExpression).toBe("#v");
    expect(avatarRead?.input.ExpressionAttributeNames).toEqual({
      "#v": "version",
    });
  });
});

describe("PUT / (profile) concurrency", () => {
  it("creates version 1 with created_at when expected_version is null", async () => {
    const response = await call({
      route: "/",
      method: "PUT",
      sub: SUB_A,
      body: { ...emptyProfileBody(null), first_name: "Ada" },
    });

    expect(response.status).toBe(200);
    expect(response.payload).toMatchObject({
      first_name: "Ada",
      version: 1,
      created_at: NOW.toISOString(),
      updated_at: NOW.toISOString(),
      avatar_version: null,
    });
    expect(dynamo.puts[0]?.input.ConditionExpression).toBe(
      "attribute_not_exists(pk)"
    );
    expect(dynamo.puts[0]?.input.ReturnValuesOnConditionCheckFailure).toBe(
      "ALL_OLD"
    );
  });

  it("refuses a create against an existing profile with the stored version", async () => {
    dynamo.seed({
      pk: `USER#${SUB_A}`,
      sk: "PROFILE",
      version: 7,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      first_name: "Ada",
    });

    const response = await call({
      route: "/",
      method: "PUT",
      sub: SUB_A,
      body: emptyProfileBody(null),
    });

    expect(response.status).toBe(409);
    expect(response.payload.error).toMatchObject({
      code: "version_conflict",
      resource: "profile",
      current_version: 7,
    });
    // Never an overwrite.
    expect(dynamo.stored(`USER#${SUB_A}`, "PROFILE")).toMatchObject({
      first_name: "Ada",
      version: 7,
    });
  });

  it("bumps the version and carries created_at forward on a numbered write", async () => {
    dynamo.seed({
      pk: `USER#${SUB_A}`,
      sk: "PROFILE",
      version: 3,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-02-01T00:00:00.000Z",
      first_name: "Ada",
    });

    const response = await call({
      route: "/",
      method: "PUT",
      sub: SUB_A,
      body: { ...emptyProfileBody(3), first_name: "Grace" },
    });

    expect(response.status).toBe(200);
    expect(response.payload).toMatchObject({
      first_name: "Grace",
      version: 4,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: NOW.toISOString(),
    });
    expect(dynamo.puts[0]?.input.ConditionExpression).toBe("#v = :expected");
  });

  it("reports a stale expected_version as a conflict carrying the current version", async () => {
    dynamo.seed({
      pk: `USER#${SUB_A}`,
      sk: "PROFILE",
      version: 5,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    });

    const response = await call({
      route: "/",
      method: "PUT",
      sub: SUB_A,
      body: emptyProfileBody(4),
    });

    expect(response.status).toBe(409);
    expect(response.payload.error).toMatchObject({
      resource: "profile",
      current_version: 5,
    });
  });

  it("reports a numbered write against an absent profile as a conflict with a null version", async () => {
    const response = await call({
      route: "/",
      method: "PUT",
      sub: SUB_A,
      body: emptyProfileBody(2),
    });

    expect(response.status).toBe(409);
    expect(response.payload.error).toMatchObject({
      code: "version_conflict",
      resource: "profile",
      current_version: null,
    });
    expect(dynamo.puts).toEqual([]);
  });

  it("writes the profile and the avatar in separate operations only", async () => {
    await call({
      route: "/",
      method: "PUT",
      sub: SUB_A,
      body: emptyProfileBody(null),
    });

    for (const command of dynamo.puts) {
      const item = command.input.Item as Record<string, unknown>;
      expect(item.sk).toBe("PROFILE");
      expect(item).not.toHaveProperty("data");
      expect(item).not.toHaveProperty("mime_type");
    }
  });
});

describe("avatar routes", () => {
  const png = pngBytes(256, 128);

  it("returns null when no avatar exists", async () => {
    const response = await call({
      route: "/avatar",
      method: "GET",
      sub: SUB_A,
    });

    expect(response.status).toBe(200);
    expect(response.raw).toBe("null");
  });

  it("round-trips the stored derivative as base64 with its version", async () => {
    await call({
      route: "/avatar",
      method: "PUT",
      sub: SUB_A,
      body: {
        mime_type: "image/png",
        data: base64Of(png),
        expected_version: null,
      },
    });

    const response = await call({
      route: "/avatar",
      method: "GET",
      sub: SUB_A,
    });

    expect(response.payload).toEqual({
      mime_type: "image/png",
      data: base64Of(png),
      version: 1,
      updated_at: NOW.toISOString(),
    });
  });

  it("stores the bytes as binary rather than as base64 text", async () => {
    await call({
      route: "/avatar",
      method: "PUT",
      sub: SUB_A,
      body: {
        mime_type: "image/jpeg",
        data: base64Of(jpegBytes(200, 200)),
        expected_version: null,
      },
    });

    const stored = dynamo.stored(`USER#${SUB_A}`, "AVATAR");
    expect(stored?.data).toBeInstanceOf(Uint8Array);
    expect(stored).not.toHaveProperty("filename");
  });

  it("reports an avatar conflict against the avatar resource", async () => {
    dynamo.seed({
      pk: `USER#${SUB_A}`,
      sk: "AVATAR",
      data: png,
      mime_type: "image/png",
      version: 4,
      updated_at: "2026-01-01T00:00:00.000Z",
    });

    const response = await call({
      route: "/avatar",
      method: "PUT",
      sub: SUB_A,
      body: {
        mime_type: "image/png",
        data: base64Of(png),
        expected_version: 2,
      },
    });

    expect(response.status).toBe(409);
    expect(response.payload.error).toMatchObject({
      resource: "avatar",
      current_version: 4,
    });
  });

  it("never writes the profile item while writing an avatar", async () => {
    await call({
      route: "/avatar",
      method: "PUT",
      sub: SUB_A,
      body: {
        mime_type: "image/png",
        data: base64Of(png),
        expected_version: null,
      },
    });

    expect(dynamo.puts).toHaveLength(1);
    expect(
      (dynamo.puts[0]?.input.Item as Record<string, unknown>).sk
    ).toBe("AVATAR");
  });
});

describe("GET /locations", () => {
  it("serves the bundled catalog with a cacheable response and no storage read", async () => {
    const response = await call({
      route: "/locations",
      method: "GET",
      sub: SUB_A,
    });

    expect(response.status).toBe(200);
    expect(response.headers["Cache-Control"]).toBe(
      "public, max-age=86400, immutable"
    );

    const countries = response.payload.countries as { code: string }[];
    expect(countries.length).toBeGreaterThan(200);
    expect(countries.some((country) => country.code === "CA")).toBe(true);
    expect(dynamo.sent).toEqual([]);
  });

  it("still requires an accepted identity", async () => {
    const response = await call({ route: "/locations", method: "GET" });
    expect(response.status).toBe(401);
  });

  it("serves no dataset provenance members", async () => {
    const response = await call({
      route: "/locations",
      method: "GET",
      sub: SUB_A,
    });

    expect(Object.keys(response.payload)).toEqual(["countries"]);
    expect(response.raw).not.toContain("_source");
  });
});

/*
 * AD-15's API cross-account gate. The key is composed from the claim alone, so a
 * token for A cannot name B's partition even when the body tries to.
 */
describe("cross-account isolation", () => {
  beforeEach(() => {
    dynamo.seed({
      pk: `USER#${SUB_B}`,
      sk: "PROFILE",
      first_name: "Grace",
      version: 9,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    });
    dynamo.seed({
      pk: `USER#${SUB_B}`,
      sk: "AVATAR",
      data: pngBytes(10, 10),
      mime_type: "image/png",
      version: 9,
      updated_at: "2026-01-01T00:00:00.000Z",
    });
  });

  it("cannot read another account's profile or avatar", async () => {
    const profile = await call({ route: "/", method: "GET", sub: SUB_A });
    const avatar = await call({ route: "/avatar", method: "GET", sub: SUB_A });

    expect(profile.raw).toBe("null");
    expect(avatar.raw).toBe("null");
    expect(profile.raw).not.toContain("Grace");
  });

  it("ignores a body-supplied subject rather than honouring it", async () => {
    const response = await call({
      route: "/",
      method: "PUT",
      sub: SUB_A,
      body: { ...emptyProfileBody(null), sub: SUB_B },
    });

    // `sub` is not a member of the contract, so the body is refused outright.
    expect(response.status).toBe(400);
    expect(response.payload.error).toMatchObject({
      code: "validation",
      field: "body",
      reason: "unknown_field",
    });
    expect(dynamo.stored(`USER#${SUB_B}`, "PROFILE")).toMatchObject({
      first_name: "Grace",
      version: 9,
    });
  });

  it("cannot overwrite another account's profile with a valid write of its own", async () => {
    const response = await call({
      route: "/",
      method: "PUT",
      sub: SUB_A,
      body: { ...emptyProfileBody(null), first_name: "Ada" },
    });

    expect(response.status).toBe(200);
    expect(dynamo.stored(`USER#${SUB_A}`, "PROFILE")).toMatchObject({
      first_name: "Ada",
    });
    expect(dynamo.stored(`USER#${SUB_B}`, "PROFILE")).toMatchObject({
      first_name: "Grace",
      version: 9,
    });
  });

  it("cannot overwrite another account's avatar", async () => {
    await call({
      route: "/avatar",
      method: "PUT",
      sub: SUB_A,
      body: {
        mime_type: "image/png",
        data: base64Of(pngBytes(32, 32)),
        expected_version: null,
      },
    });

    expect(dynamo.stored(`USER#${SUB_B}`, "AVATAR")).toMatchObject({
      version: 9,
    });
    expect(dynamo.itemCount).toBe(3);
  });
});

describe("storage failures keep the closed union", () => {
  it("reports DynamoDB throttling as rate_limited", async () => {
    dynamo.queueError(throttlingError());

    const response = await call({ route: "/", method: "GET", sub: SUB_A });

    expect(response.status).toBe(429);
    expect(response.payload.error).toMatchObject({ code: "rate_limited" });
  });

  it("reports any other storage failure as unavailable with no detail", async () => {
    dynamo.queueError(new Error("ECONNRESET to dynamodb.us-east-1"));

    const response = await call({ route: "/", method: "GET", sub: SUB_A });

    expect(response.status).toBe(503);
    expect(response.payload.error).toMatchObject({ code: "unavailable" });
    expect(response.raw).not.toContain("ECONNRESET");
  });

  it("reports a corrupt stored item as unavailable rather than a partial profile", async () => {
    dynamo.seed({ pk: `USER#${SUB_A}`, sk: "PROFILE", first_name: "Ada" });

    const response = await call({ route: "/", method: "GET", sub: SUB_A });

    expect(response.status).toBe(503);
    expect(response.raw).not.toContain("Ada");
  });
});

describe("request ceilings and envelope shape", () => {
  it("refuses an oversize profile body before parsing it", async () => {
    const response = await call({
      route: "/",
      method: "PUT",
      sub: SUB_A,
      rawBody: "x".repeat(PROFILE_BODY_MAX_BYTES + 1),
    });

    expect(response.status).toBe(413);
    expect(response.payload.error).toMatchObject({ code: "payload_too_large" });
  });

  it("refuses an oversize avatar body on the encoded form", async () => {
    const response = await call({
      route: "/avatar",
      method: "PUT",
      sub: SUB_A,
      rawBody: "x".repeat(AVATAR_BODY_MAX_BYTES + 1),
    });

    expect(response.status).toBe(413);
  });

  it("refuses an avatar whose decoded bytes exceed the ceiling", async () => {
    const oversize = new Uint8Array(AVATAR_MAX_DECODED_BYTES + 3);
    oversize.set(pngBytes(16, 16), 0);

    const response = await call({
      route: "/avatar",
      method: "PUT",
      sub: SUB_A,
      body: {
        mime_type: "image/png",
        data: base64Of(oversize),
        expected_version: null,
      },
    });

    expect(response.status).toBe(413);
    expect(response.payload.error).toMatchObject({ code: "payload_too_large" });
  });

  it("answers every request with a JSON content type and the request id", async () => {
    const response = await call({ route: "/", method: "GET", sub: SUB_A });
    expect(response.headers["Content-Type"]).toBe("application/json");

    const failed = await call({ route: "/", method: "PUT", sub: SUB_A });
    expect(failed.payload.error).toMatchObject({ request_id: "req-test" });
  });

  it("answers an undeclared route as a server defect, never as a client error", async () => {
    const response = await call({
      route: "/entitlement",
      method: "GET",
      sub: SUB_A,
    });

    expect(response.status).toBe(503);
    expect(response.payload.error).toMatchObject({ code: "unavailable" });
  });
});
