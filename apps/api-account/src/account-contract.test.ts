import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ACCOUNT_ERROR_CODES } from "@nixus/shared";

import { dispatch } from "./functions/api.ts";
import { validateAvatarRequest } from "./lib/avatar.ts";
import { AccountFailureError, errorBodyFor } from "./lib/errors.ts";
import { FakeDynamo } from "./lib/testing/fake-dynamo.ts";
import { SUB_A, apiEvent } from "./lib/testing/fixtures.ts";
import { setDocumentClientForTesting } from "./lib/table.ts";

/*
 * Contract tests against the shared fixtures (AD-13/AD-15). The same file is
 * deserialized by `@nixus/shared`'s own spec and by the Rust mirror, so matching
 * it here is what proves all three sides speak one wire shape.
 */

const FIXTURES = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL(
        "../../../packages/shared/src/types/account.fixtures.json",
        import.meta.url
      )
    ),
    "utf8"
  )
) as {
  profile_full: Record<string, unknown>;
  profile_empty: Record<string, unknown>;
  put_profile_create: Record<string, unknown>;
  put_profile_update: Record<string, unknown>;
  avatar: Record<string, unknown>;
  put_avatar: Record<string, unknown>;
  errors: { error: Record<string, unknown> }[];
};

const NOW = new Date("2026-11-17T13:30:00.000Z");

let dynamo: FakeDynamo;

async function call(args: {
  readonly route: string;
  readonly method: string;
  readonly body?: unknown;
}) {
  const response = await dispatch(
    apiEvent({ ...args, sub: SUB_A, requestId: "req-1" }),
    () => NOW
  );
  return {
    status: response.statusCode,
    payload: JSON.parse(response.body as string) as Record<string, unknown>,
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

describe("profile bodies", () => {
  it("accepts the create fixture and answers with the CloudProfile member set", async () => {
    const response = await call({
      route: "/",
      method: "PUT",
      body: FIXTURES.put_profile_create,
    });

    expect(response.status).toBe(200);
    expect(Object.keys(response.payload).sort()).toEqual(
      Object.keys(FIXTURES.profile_full).sort()
    );
    expect(response.payload.version).toBe(1);
    expect(response.payload.avatar_version).toBeNull();
    expect(response.payload.income_bracket_currency).toBe(
      FIXTURES.put_profile_create.income_bracket_currency
    );
  });

  it("accepts the update fixture against the version it names", async () => {
    dynamo.seed({
      pk: `USER#${SUB_A}`,
      sk: "PROFILE",
      version: FIXTURES.put_profile_update.expected_version as number,
      created_at: FIXTURES.profile_full.created_at as string,
      updated_at: FIXTURES.profile_full.updated_at as string,
    });

    const response = await call({
      route: "/",
      method: "PUT",
      body: FIXTURES.put_profile_update,
    });

    expect(response.status).toBe(200);
    expect(response.payload).toMatchObject({
      first_name: FIXTURES.put_profile_update.first_name,
      birth_date: FIXTURES.put_profile_update.birth_date,
      income_bracket: FIXTURES.put_profile_update.income_bracket,
      country_code: FIXTURES.put_profile_update.country_code,
      subdivision_code: FIXTURES.put_profile_update.subdivision_code,
      version: 4,
    });
  });

  it("answers a stored profile with exactly the full fixture's members", async () => {
    dynamo.seed({
      pk: `USER#${SUB_A}`,
      sk: "PROFILE",
      ...FIXTURES.profile_full,
      avatar_version: undefined,
    });
    dynamo.seed({
      pk: `USER#${SUB_A}`,
      sk: "AVATAR",
      version: FIXTURES.profile_full.avatar_version as number,
    });

    const response = await call({ route: "/", method: "GET" });

    expect(response.payload).toEqual(FIXTURES.profile_full);
  });

  it("answers an empty profile with the empty fixture's exact nulls", async () => {
    dynamo.seed({
      pk: `USER#${SUB_A}`,
      sk: "PROFILE",
      ...FIXTURES.profile_empty,
      avatar_version: undefined,
    });

    const response = await call({ route: "/", method: "GET" });

    expect(response.payload).toEqual(FIXTURES.profile_empty);
  });
});

describe("avatar bodies", () => {
  it("answers a stored avatar with the CloudAvatar member set", async () => {
    dynamo.seed({
      pk: `USER#${SUB_A}`,
      sk: "AVATAR",
      data: new Uint8Array(Buffer.from(FIXTURES.avatar.data as string, "base64")),
      mime_type: FIXTURES.avatar.mime_type,
      version: FIXTURES.avatar.version,
      updated_at: FIXTURES.avatar.updated_at,
    });

    const response = await call({ route: "/avatar", method: "GET" });

    expect(response.payload).toEqual(FIXTURES.avatar);
  });

  /* The fixture is a header fragment, not a whole image, so the contract check
   * that matters is that every member is READ as this contract declares it - the
   * refusal is the dimension read failing closed, nothing to do with the shape. */
  it("reads every member of the put_avatar fixture and fails only on the bytes", () => {
    let failure: unknown;
    try {
      validateAvatarRequest(JSON.stringify(FIXTURES.put_avatar));
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(AccountFailureError);
    expect((failure as AccountFailureError).failure).toEqual({
      code: "validation",
      field: "data",
      reason: "invalid_format",
    });
  });
});

describe("error envelopes", () => {
  it("carries one fixture per code, and the Lambda builds the same members", () => {
    const byCode = new Map(
      FIXTURES.errors.map((entry) => [entry.error.code as string, entry.error])
    );
    expect([...byCode.keys()].sort()).toEqual([...ACCOUNT_ERROR_CODES].sort());

    for (const [code, fixture] of byCode) {
      const built =
        code === "validation"
          ? errorBodyFor(
              {
                code: "validation",
                field: fixture.field as "income_bracket_currency",
                reason: fixture.reason as "required",
              },
              fixture.request_id as string
            )
          : code === "version_conflict"
            ? errorBodyFor(
                {
                  code: "version_conflict",
                  resource: fixture.resource as "profile",
                  current_version: fixture.current_version as number | null,
                },
                fixture.request_id as string
              )
            : errorBodyFor(
                { code: code as "unauthorized" },
                fixture.request_id as string
              );

      expect(Object.keys(built.error).sort(), code).toEqual(
        Object.keys(fixture).sort()
      );
      expect(built.error.request_id).toBe(fixture.request_id);
    }
  });

  it("returns the conflict fixture's members from a real conflicting write", async () => {
    dynamo.seed({
      pk: `USER#${SUB_A}`,
      sk: "PROFILE",
      version: 4,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    });

    const response = await call({
      route: "/",
      method: "PUT",
      body: { ...FIXTURES.put_profile_create, expected_version: 3 },
    });

    expect(response.status).toBe(409);
    expect(Object.keys(response.payload.error as object).sort()).toEqual(
      Object.keys(
        FIXTURES.errors.find(
          (entry) =>
            entry.error.code === "version_conflict" &&
            entry.error.current_version !== null
        )!.error
      ).sort()
    );
  });
});
