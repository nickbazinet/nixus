import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dispatch } from "./functions/api.ts";
import { FakeDynamo } from "./lib/testing/fake-dynamo.ts";
import {
  SUB_A,
  apiEvent,
  base64Of,
  pngBytes,
} from "./lib/testing/fixtures.ts";
import { setDocumentClientForTesting } from "./lib/table.ts";

/*
 * AD-12's gate: no validation response and no log line may contain a submitted
 * value. Every string below is distinctive enough that a substring search over
 * the captured console output and the response bodies is conclusive.
 */

const NOW = new Date("2026-11-17T12:00:00.000Z");

const DISTINCTIVE = {
  firstName: "Zyxwvut",
  lastName: "Qqwerpy",
  birthDate: "1911-07-23",
  country: "ZQ",
  subdivision: "ZQ-99",
  bracket: "squillionaire",
  currency: "XQZ",
} as const;

const AVATAR_BASE64 = base64Of(pngBytes(4096, 4096));

let dynamo: FakeDynamo;
let captured: string[];

function fullBody(overrides: Record<string, unknown> = {}) {
  return {
    first_name: DISTINCTIVE.firstName,
    last_name: DISTINCTIVE.lastName,
    birth_date: DISTINCTIVE.birthDate,
    income_bracket: DISTINCTIVE.bracket,
    income_bracket_currency: DISTINCTIVE.currency,
    country_code: DISTINCTIVE.country,
    subdivision_code: DISTINCTIVE.subdivision,
    expected_version: null,
    ...overrides,
  };
}

async function run(args: {
  readonly route: string;
  readonly method: string;
  readonly body?: unknown;
  readonly sub?: string;
}): Promise<string> {
  const response = await dispatch(
    apiEvent({ ...args, sub: args.sub ?? SUB_A }),
    () => NOW
  );
  return response.body as string;
}

beforeEach(() => {
  process.env.PROFILE_TABLE_NAME = "nixus-account-profile";
  dynamo = new FakeDynamo();
  setDocumentClientForTesting(dynamo.asDocumentClient());

  captured = [];
  const capture = (...args: unknown[]) => {
    captured.push(args.map((arg) => String(arg)).join(" "));
  };
  vi.spyOn(console, "log").mockImplementation(capture);
  vi.spyOn(console, "error").mockImplementation(capture);
});

afterEach(() => {
  setDocumentClientForTesting(undefined);
  vi.restoreAllMocks();
});

function assertNoSubmittedValue(bodies: string[]): void {
  const haystack = [...bodies, ...captured].join("\n");

  for (const [name, value] of Object.entries(DISTINCTIVE)) {
    expect(haystack, `${name} leaked`).not.toContain(value);
  }
  expect(haystack).not.toContain(AVATAR_BASE64.slice(0, 32));
}

describe("a refused request echoes nothing it was given", () => {
  it("refuses an unknown country without naming it, in the body or a log", async () => {
    const body = await run({
      route: "/",
      method: "PUT",
      body: fullBody({ income_bracket: null, income_bracket_currency: null }),
    });

    expect(JSON.parse(body).error).toMatchObject({
      code: "validation",
      field: "country_code",
      reason: "not_allowed",
    });
    assertNoSubmittedValue([body]);
  });

  it("refuses an unknown bracket and currency without naming either", async () => {
    const body = await run({
      route: "/",
      method: "PUT",
      body: fullBody({ birth_date: null, country_code: null, subdivision_code: null }),
    });

    expect(JSON.parse(body).error).toMatchObject({ field: "income_bracket" });
    assertNoSubmittedValue([body]);
  });

  it("refuses an oversize avatar without echoing its base64", async () => {
    const body = await run({
      route: "/avatar",
      method: "PUT",
      body: {
        mime_type: "image/png",
        data: AVATAR_BASE64,
        expected_version: null,
      },
    });

    expect(JSON.parse(body).error).toMatchObject({
      reason: "dimensions_exceeded",
    });
    assertNoSubmittedValue([body]);
  });
});

describe("an accepted request logs no value either", () => {
  it("logs only the allow-listed fields on a successful write", async () => {
    const body = await run({
      route: "/",
      method: "PUT",
      body: {
        first_name: DISTINCTIVE.firstName,
        last_name: DISTINCTIVE.lastName,
        birth_date: "1985-03-14",
        income_bracket: "100k_149k",
        income_bracket_currency: "CAD",
        country_code: "CA",
        subdivision_code: "CA-QC",
        expected_version: null,
      },
    });

    // The response legitimately carries the stored profile back, so only the
    // logs are searched here.
    expect(JSON.parse(body).first_name).toBe(DISTINCTIVE.firstName);
    assertNoSubmittedValue([]);

    expect(captured).toHaveLength(1);
    const line = JSON.parse(captured[0] as string) as Record<string, unknown>;
    expect(Object.keys(line).sort()).toEqual([
      "code",
      "event",
      "latency_ms",
      "method",
      "request_bytes",
      "request_id",
      "response_bytes",
      "route",
      "status",
      "sub",
    ]);
    expect(line.sub).toBe(SUB_A);
    expect(line.route).toBe("/");
    expect(line.status).toBe(200);
    expect(line.request_bytes).toBeGreaterThan(0);
  });

  it("logs a stored avatar as byte sizes only", async () => {
    await run({
      route: "/avatar",
      method: "PUT",
      body: {
        mime_type: "image/png",
        data: base64Of(pngBytes(256, 256)),
        expected_version: null,
      },
    });

    const line = JSON.parse(captured[0] as string) as Record<string, unknown>;
    expect(line.route).toBe("/avatar");
    expect(typeof line.request_bytes).toBe("number");
    expect(JSON.stringify(line)).not.toContain("iVBOR");
    expect(JSON.stringify(line)).not.toContain("image/png");
  });

  it("logs no subject at all for a rejected identity", async () => {
    await run({ route: "/", method: "GET", sub: "not-a-uuid" });

    const line = JSON.parse(captured[0] as string) as Record<string, unknown>;
    expect(line.sub).toBeNull();
    expect(line.status).toBe(401);
    expect(JSON.stringify(line)).not.toContain("not-a-uuid");
  });

  it("logs an unhandled storage failure as a class name, never a message", async () => {
    dynamo.queueError(new Error(`cannot read USER#${SUB_A}/PROFILE`));

    const body = await run({ route: "/", method: "GET" });

    const haystack = `${body}\n${captured.join("\n")}`;
    expect(haystack).not.toContain("cannot read");
    expect(haystack).toContain("account_unhandled_error");
  });
});
