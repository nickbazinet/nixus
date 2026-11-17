import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  ACCOUNT_ERROR_CODES,
  ACCOUNT_ERROR_HTTP_STATUS,
  ACCOUNT_GATEWAY_RESPONSES,
  AVATAR_BODY_MAX_BYTES,
  AVATAR_MAX_DECODED_BYTES,
  AVATAR_MAX_EDGE_PX,
  AVATAR_MIME_TYPES,
  INCOME_BRACKETS,
  INCOME_BRACKET_CURRENCIES,
  PROFILE_BODY_MAX_BYTES,
  PROFILE_FIELD_NAMES,
  VALIDATION_FIELDS,
  VALIDATION_REASONS,
  VERSIONED_RESOURCES,
  toAccountErrorCode,
  type AccountError,
  type AccountErrorCode,
  type AccountGatewayResponseType,
  type CloudAvatar,
  type CloudProfile,
  type PutAvatarRequest,
  type PutProfileRequest,
} from "./account";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");

/* `Record<keyof T, true>` is the compile-time lock: adding a member to the interface makes the
 * literal miss a key, removing one makes it excess. */
function keysOf<T>(coverage: Record<keyof T, true>): string[] {
  return Object.keys(coverage).sort();
}

const CLOUD_PROFILE_KEYS = keysOf<CloudProfile>({
  first_name: true,
  last_name: true,
  birth_date: true,
  income_bracket: true,
  income_bracket_currency: true,
  country_code: true,
  subdivision_code: true,
  version: true,
  created_at: true,
  updated_at: true,
  avatar_version: true,
});

const PUT_PROFILE_KEYS = keysOf<PutProfileRequest>({
  first_name: true,
  last_name: true,
  birth_date: true,
  income_bracket: true,
  income_bracket_currency: true,
  country_code: true,
  subdivision_code: true,
  expected_version: true,
});

const CLOUD_AVATAR_KEYS = keysOf<CloudAvatar>({
  mime_type: true,
  data: true,
  version: true,
  updated_at: true,
});

const PUT_AVATAR_KEYS = keysOf<PutAvatarRequest>({
  mime_type: true,
  data: true,
  expected_version: true,
});

const ERROR_CODE_COVERAGE: Record<AccountErrorCode, true> = {
  unauthorized: true,
  reauthentication_required: true,
  validation: true,
  version_conflict: true,
  payload_too_large: true,
  unsupported_media: true,
  rate_limited: true,
  unavailable: true,
};

type Fixtures = {
  profile_full: Record<string, unknown>;
  profile_empty: Record<string, unknown>;
  put_profile_create: Record<string, unknown>;
  put_profile_update: Record<string, unknown>;
  avatar: Record<string, unknown>;
  put_avatar: Record<string, unknown>;
  errors: { error: Record<string, unknown> }[];
};

function loadFixtures(): Fixtures {
  return JSON.parse(readFileSync(join(HERE, "account.fixtures.json"), "utf8")) as Fixtures;
}

function assertNever(value: never): never {
  throw new Error(`unhandled error variant: ${JSON.stringify(value)}`);
}

/** Compile-time exhaustiveness over the error union's per-code members. */
function describeError(error: AccountError): string {
  switch (error.code) {
    case "validation":
      return `validation:${error.field}:${error.reason}`;
    case "version_conflict":
      return `version_conflict:${error.resource}:${String(error.current_version)}`;
    case "unauthorized":
    case "reauthentication_required":
    case "payload_too_large":
    case "unsupported_media":
    case "rate_limited":
    case "unavailable":
      return error.code;
    default:
      return assertNever(error);
  }
}

describe("account contract: closed unions", () => {
  it("lists exactly the eight AD-13 error codes", () => {
    expect([...ACCOUNT_ERROR_CODES].sort()).toEqual(Object.keys(ERROR_CODE_COVERAGE).sort());
  });

  it("gives every error code an HTTP status", () => {
    expect(Object.keys(ACCOUNT_ERROR_HTTP_STATUS).sort()).toEqual([...ACCOUNT_ERROR_CODES].sort());
  });

  it("maps an unknown or non-string code to unavailable", () => {
    expect(toAccountErrorCode("quota_exhausted")).toBe("unavailable");
    expect(toAccountErrorCode(undefined)).toBe("unavailable");
    expect(toAccountErrorCode(42)).toBe("unavailable");
    for (const code of ACCOUNT_ERROR_CODES) expect(toAccountErrorCode(code)).toBe(code);
  });

  it("names every profile field as a validation field", () => {
    for (const field of PROFILE_FIELD_NAMES) expect(VALIDATION_FIELDS).toContain(field);
    expect(new Set(VALIDATION_FIELDS).size).toBe(VALIDATION_FIELDS.length);
    expect(new Set(VALIDATION_REASONS).size).toBe(VALIDATION_REASONS.length);
  });

  it("covers every GatewayResponse type AD-13 enumerates, and only those", () => {
    const required: Record<AccountGatewayResponseType, true> = {
      UNAUTHORIZED: true,
      ACCESS_DENIED: true,
      EXPIRED_TOKEN: true,
      MISSING_AUTHENTICATION_TOKEN: true,
      THROTTLED: true,
      REQUEST_TOO_LARGE: true,
      DEFAULT_4XX: true,
      DEFAULT_5XX: true,
    };
    expect(Object.keys(ACCOUNT_GATEWAY_RESPONSES).sort()).toEqual(Object.keys(required).sort());
    expect(ACCOUNT_GATEWAY_RESPONSES.THROTTLED.code).toBe("rate_limited");
    expect(ACCOUNT_GATEWAY_RESPONSES.REQUEST_TOO_LARGE.code).toBe("payload_too_large");
  });
});

describe("account contract: allow-lists and ceilings", () => {
  it("keeps the bracket and currency allow-lists unique and currency codes uppercase ISO 4217", () => {
    expect(new Set(INCOME_BRACKETS).size).toBe(INCOME_BRACKETS.length);
    expect(new Set(INCOME_BRACKET_CURRENCIES).size).toBe(INCOME_BRACKET_CURRENCIES.length);
    for (const code of INCOME_BRACKET_CURRENCIES) expect(code).toMatch(/^[A-Z]{3}$/);
  });

  it("pins the avatar contract the desktop CHECK constraints mirror", () => {
    expect([...AVATAR_MIME_TYPES]).toEqual(["image/png", "image/jpeg"]);
    expect(AVATAR_MAX_EDGE_PX).toBe(256);
    expect(AVATAR_MAX_DECODED_BYTES).toBe(65_536);
    // The body ceiling must admit the base64 of a maximum-size derivative plus framing.
    expect(AVATAR_BODY_MAX_BYTES).toBeGreaterThan(Math.ceil(AVATAR_MAX_DECODED_BYTES / 3) * 4 + 256);
    expect(PROFILE_BODY_MAX_BYTES).toBe(16_384);
  });
});

describe("account contract: shared fixtures (also deserialized by the Rust mirror)", () => {
  const fixtures = loadFixtures();

  it("shapes profile bodies exactly as the interfaces declare", () => {
    expect(Object.keys(fixtures.profile_full).sort()).toEqual(CLOUD_PROFILE_KEYS);
    expect(Object.keys(fixtures.profile_empty).sort()).toEqual(CLOUD_PROFILE_KEYS);
    expect(Object.keys(fixtures.put_profile_create).sort()).toEqual(PUT_PROFILE_KEYS);
    expect(Object.keys(fixtures.put_profile_update).sort()).toEqual(PUT_PROFILE_KEYS);
    expect(fixtures.put_profile_create.expected_version).toBeNull();
  });

  it("shapes avatar bodies exactly as the interfaces declare", () => {
    expect(Object.keys(fixtures.avatar).sort()).toEqual(CLOUD_AVATAR_KEYS);
    expect(Object.keys(fixtures.put_avatar).sort()).toEqual(PUT_AVATAR_KEYS);
  });

  it("carries one error envelope per code, with per-code members", () => {
    const codes = fixtures.errors.map((entry) => entry.error.code);
    expect(new Set(codes)).toEqual(new Set(ACCOUNT_ERROR_CODES));

    for (const { error } of fixtures.errors) {
      expect(typeof error.message).toBe("string");
      expect(typeof error.request_id).toBe("string");
      if (error.code === "validation") {
        expect(VALIDATION_FIELDS).toContain(error.field);
        expect(VALIDATION_REASONS).toContain(error.reason);
      } else if (error.code === "version_conflict") {
        expect(VERSIONED_RESOURCES).toContain(error.resource);
        expect(error.current_version === null || typeof error.current_version === "number").toBe(true);
      } else {
        expect(error).not.toHaveProperty("field");
        expect(error).not.toHaveProperty("resource");
      }
    }
  });

  it("narrows every variant exhaustively", () => {
    const sample: AccountError = {
      code: "validation",
      message: "x",
      request_id: "r",
      field: "birth_date",
      reason: "too_young",
    };
    expect(describeError(sample)).toBe("validation:birth_date:too_young");
  });
});

const SKIPPED_DIRS = new Set([
  "node_modules",
  "target",
  ".git",
  ".aws-sam",
  "dist",
  ".output",
  ".nitro",
  ".tanstack",
  ".vinxi",
  "_bmad-output",
  "test-results",
  "playwright-report",
]);

function walk(dir: string, found: string[]): void {
  for (const name of readdirSync(dir)) {
    if (SKIPPED_DIRS.has(name)) continue;
    const path = join(dir, name);
    const stats = statSync(path);
    if (stats.isDirectory()) walk(path, found);
    else found.push(relative(REPO_ROOT, path).replace(/\\/g, "/"));
  }
}

describe("ISO 3166 reference data (AD-5)", () => {
  const files: string[] = [];
  walk(REPO_ROOT, files);

  it("exists exactly once, at packages/shared/data/iso3166.json", () => {
    const copies = files.filter((path) => /iso.?3166[^/]*\.json$/i.test(path));
    expect(copies).toEqual(["packages/shared/data/iso3166.json"]);
  });

  it("is never imported by a frontend", () => {
    const frontendSources = files.filter((path) =>
      /^apps\/(desktop\/src|web\/src|account\/src)\/.*\.(ts|tsx|js|jsx|mjs)$/.test(path),
    );
    const importers = frontendSources.filter((path) =>
      readFileSync(join(REPO_ROOT, path), "utf8").includes("iso3166"),
    );
    expect(importers).toEqual([]);
  });

  it("parses into countries whose subdivisions belong to them", () => {
    const dataset = JSON.parse(
      readFileSync(join(REPO_ROOT, "packages/shared/data/iso3166.json"), "utf8"),
    ) as { countries: { code: string; name_en: string; subdivisions?: { code: string }[] }[] };

    expect(dataset.countries.length).toBeGreaterThan(200);
    const canada = dataset.countries.find((country) => country.code === "CA");
    expect(canada?.subdivisions?.some((sub) => sub.code === "CA-QC")).toBe(true);
    for (const country of dataset.countries) {
      expect(country.code).toMatch(/^[A-Z]{2}$/);
      for (const sub of country.subdivisions ?? []) {
        expect(sub.code.startsWith(`${country.code}-`)).toBe(true);
      }
    }
  });
});
