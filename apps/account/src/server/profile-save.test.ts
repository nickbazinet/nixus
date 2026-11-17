import { describe, expect, it } from "vitest";
import type { AccountError, CloudProfile, ProfileFields } from "@nixus/shared";

import type { ProfileApi, ProfileResult } from "./profile-client.ts";
import { saveProfileFields } from "./profile-save.ts";

/*
 * Adversary L1 and H6: a save whose response was never observed must not be
 * reported as a failure, and a `version_conflict` must reload the resource without
 * asserting that another actor changed it.
 */

const FIELDS: ProfileFields = {
  first_name: "Alex",
  last_name: "Tremblay",
  birth_date: "1990-04-02",
  income_bracket: "100k_149k",
  income_bracket_currency: "CAD",
  country_code: "CA",
  subdivision_code: "CA-QC",
};

function profile(overrides: Partial<CloudProfile> = {}): CloudProfile {
  return {
    ...FIELDS,
    version: 3,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-02-01T00:00:00Z",
    avatar_version: null,
    ...overrides,
  };
}

function error(code: AccountError["code"]): AccountError {
  return { code, message: "fixed sentence", request_id: "req-1" } as AccountError;
}

interface Scripted {
  put?: () => Promise<ProfileResult<CloudProfile>>;
  get?: () => Promise<ProfileResult<CloudProfile | null>>;
}

function api(scripted: Scripted): ProfileApi {
  const unused = () => {
    throw new Error("not part of this behaviour");
  };
  return {
    getProfile: scripted.get ?? unused,
    putProfile: scripted.put ?? unused,
    getAvatar: unused,
    putAvatar: unused,
    getLocations: unused,
  } as unknown as ProfileApi;
}

describe("saveProfileFields", () => {
  it("reports the saved profile the server returned", async () => {
    const saved = profile({ version: 4 });
    const outcome = await saveProfileFields(
      api({ put: async () => ({ ok: true, value: saved }) }),
      FIELDS,
      3,
    );

    expect(outcome).toEqual({ kind: "saved", profile: saved });
  });

  it("reloads the resource on a version conflict", async () => {
    const current = profile({ version: 9, first_name: "Someone else's edit" });
    const outcome = await saveProfileFields(
      api({
        put: async () => ({ ok: false, error: error("version_conflict") }),
        get: async () => ({ ok: true, value: current }),
      }),
      FIELDS,
      3,
    );

    expect(outcome).toEqual({ kind: "conflict", current });
  });

  it("reports a conflict with no reloaded value when the reread also fails", async () => {
    const outcome = await saveProfileFields(
      api({
        put: async () => ({ ok: false, error: error("version_conflict") }),
        get: async () => ({ ok: false, error: error("unavailable") }),
      }),
      FIELDS,
      3,
    );

    expect(outcome).toEqual({ kind: "conflict", current: null });
  });

  it("passes a validation refusal through untouched", async () => {
    const refusal = {
      ...error("validation"),
      field: "birth_date",
      reason: "in_future",
    } as AccountError;

    const outcome = await saveProfileFields(
      api({ put: async () => ({ ok: false, error: refusal }) }),
      FIELDS,
      3,
    );

    expect(outcome).toEqual({ kind: "rejected", error: refusal });
  });

  it("treats an unobserved response as saved when the server holds what was sent", async () => {
    const applied = profile({ version: 4 });
    const outcome = await saveProfileFields(
      api({
        put: async () => {
          throw new TypeError("fetch failed");
        },
        get: async () => ({ ok: true, value: applied }),
      }),
      FIELDS,
      3,
    );

    expect(outcome).toEqual({ kind: "saved", profile: applied });
  });

  it("reports indeterminate when the server does not hold what was sent", async () => {
    const outcome = await saveProfileFields(
      api({
        put: async () => {
          throw new TypeError("fetch failed");
        },
        get: async () => ({ ok: true, value: profile({ first_name: "Not what was sent" }) }),
      }),
      FIELDS,
      3,
    );

    expect(outcome).toEqual({ kind: "indeterminate" });
  });

  it("reports indeterminate when the reread cannot be made either", async () => {
    const outcome = await saveProfileFields(
      api({
        put: async () => {
          throw new TypeError("fetch failed");
        },
        get: async () => ({ ok: false, error: error("unavailable") }),
      }),
      FIELDS,
      3,
    );

    expect(outcome).toEqual({ kind: "indeterminate" });
  });
});
