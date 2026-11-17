import { describe, expect, it } from "vitest";

import { resolveSession, type AccessDeps, type SessionAccess } from "./current-session.ts";
import { sha256Hex } from "./crypto.ts";
import { SESSION_COOKIE, type SessionDeps } from "./sessions.ts";
import { SESSION_IDLE_TTL_SECONDS, type SessionRecord } from "./store.ts";
import { MemorySessionStore } from "./testing/memory-store.ts";
import { StubIdp } from "./testing/stub-idp.ts";

/*
 * AD-15: expired-but-present sessions, the Origin check on every mutation, and the
 * idle extension that only an Origin-verified non-GET may perform (adversary L3).
 *
 * DynamoDB deletes TTL-expired items "within a few days", so every one of these
 * rows exists in the store while being refused — which is the exact condition the
 * gate is written for.
 */

const PUBLIC_ORIGIN = "https://account.nixusapp.com";
const NOW = 1_800_000_000;
const COOKIE = "session-cookie-value";

function record(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: sha256Hex(COOKIE),
    type: "session",
    sub: "11111111-1111-4111-8111-111111111111",
    email: "person@example.com",
    tokens: { access_token: "live-access", refresh_token: "live-refresh", access_expires_at: NOW + 900 },
    idle_expires_at: NOW + SESSION_IDLE_TTL_SECONDS,
    absolute_expires_at: NOW + 7 * 24 * 60 * 60,
    expires_at: NOW + 7 * 24 * 60 * 60,
    ...overrides,
  };
}

function harness(now = NOW) {
  const store = new MemorySessionStore();
  const oidc = new StubIdp();
  const sessions: SessionDeps = { store, now: () => now };
  const deps: AccessDeps = { sessions, oidc };
  return { store, oidc, deps };
}

function access(overrides: Partial<SessionAccess> = {}): SessionAccess {
  return {
    cookieHeader: `${SESSION_COOKIE}=${COOKIE}`,
    originHeader: PUBLIC_ORIGIN,
    mutating: false,
    publicOrigin: PUBLIC_ORIGIN,
    ...overrides,
  };
}

describe("expired-but-present session", () => {
  it("refuses a row whose idle expiry has passed and deletes it", async () => {
    const context = harness();
    await context.store.putSession(record({ idle_expires_at: NOW - 1 }));

    const outcome = await resolveSession(context.deps, access());

    expect(outcome).toEqual({ status: "expired" });
    expect(context.store.sessions.size).toBe(0);
  });

  it("refuses a row whose absolute expiry has passed even with a fresh idle expiry", async () => {
    const context = harness();
    await context.store.putSession(
      record({ idle_expires_at: NOW + 10_000, absolute_expires_at: NOW - 1 }),
    );

    const outcome = await resolveSession(context.deps, access());

    expect(outcome).toEqual({ status: "expired" });
    expect(context.store.sessions.size).toBe(0);
  });

  it("honours a row inside both expiries", async () => {
    const context = harness();
    await context.store.putSession(record());

    const outcome = await resolveSession(context.deps, access());

    expect(outcome).toMatchObject({ status: "live", accessToken: "live-access" });
  });

  it("reports anonymous, not expired, when no cookie was presented", async () => {
    const context = harness();
    expect(await resolveSession(context.deps, access({ cookieHeader: null }))).toEqual({
      status: "anonymous",
    });
  });
});

describe("Origin verification on mutations", () => {
  it.each([
    ["missing", null, "origin_missing"],
    ["a foreign origin", "https://evil.example", "origin_mismatch"],
    ["a lookalike origin", "https://account.nixusapp.com.evil.example", "origin_mismatch"],
    ["the api origin", "https://api.nixusapp.com", "origin_mismatch"],
    ["an empty header", "", "origin_missing"],
  ])("refuses a mutation with %s", async (_label, originHeader, code) => {
    const context = harness();
    await context.store.putSession(record());

    const outcome = await resolveSession(
      context.deps,
      access({ mutating: true, originHeader }),
    );

    expect(outcome).toEqual({ status: "forbidden", code });
  });

  it("allows a mutation whose origin is exactly the configured public origin", async () => {
    const context = harness();
    await context.store.putSession(record());

    const outcome = await resolveSession(context.deps, access({ mutating: true }));

    expect(outcome).toMatchObject({ status: "live" });
  });

  it("refuses before reading the session, so a bad origin cannot probe for one", async () => {
    const context = harness();

    const outcome = await resolveSession(
      context.deps,
      access({ mutating: true, originHeader: "https://evil.example", cookieHeader: null }),
    );

    expect(outcome).toEqual({ status: "forbidden", code: "origin_mismatch" });
  });
});

describe("idle extension", () => {
  it("extends on an Origin-verified mutation", async () => {
    const context = harness();
    await context.store.putSession(record({ idle_expires_at: NOW + 60 }));

    await resolveSession(context.deps, access({ mutating: true }));

    expect(context.store.sessions.get(sha256Hex(COOKIE))?.idle_expires_at).toBe(
      NOW + SESSION_IDLE_TTL_SECONDS,
    );
  });

  it("never extends on a GET, so an embedded third-party request cannot keep a session alive", async () => {
    const context = harness();
    await context.store.putSession(record({ idle_expires_at: NOW + 60 }));

    await resolveSession(context.deps, access({ mutating: false, originHeader: null }));

    expect(context.store.sessions.get(sha256Hex(COOKIE))?.idle_expires_at).toBe(NOW + 60);
  });

  it("never pushes the idle expiry past the absolute expiry", async () => {
    const context = harness();
    await context.store.putSession(
      record({ idle_expires_at: NOW + 60, absolute_expires_at: NOW + 120, expires_at: NOW + 120 }),
    );

    await resolveSession(context.deps, access({ mutating: true }));

    expect(context.store.sessions.get(sha256Hex(COOKIE))?.idle_expires_at).toBe(NOW + 120);
  });
});

describe("access token refresh", () => {
  it("refreshes an expired access token server-side and stores the result", async () => {
    const context = harness();
    await context.store.putSession(
      record({
        tokens: { access_token: "stale", refresh_token: "r1", access_expires_at: NOW - 1 },
      }),
    );

    const outcome = await resolveSession(context.deps, access());

    expect(outcome).toMatchObject({ status: "live", accessToken: "refreshed-r1" });
    expect(context.oidc.refreshes).toEqual(["r1"]);
    expect(context.store.sessions.get(sha256Hex(COOKIE))?.tokens.access_token).toBe(
      "refreshed-r1",
    );
  });

  it("keeps the refresh token, because a refresh response carries no new one", async () => {
    const context = harness();
    await context.store.putSession(
      record({
        tokens: { access_token: "stale", refresh_token: "r1", access_expires_at: NOW - 1 },
      }),
    );

    await resolveSession(context.deps, access());

    expect(context.store.sessions.get(sha256Hex(COOKIE))?.tokens.refresh_token).toBe("r1");
  });

  it("invalidates the session when the refresh cannot succeed", async () => {
    const store = new MemorySessionStore();
    const deps: AccessDeps = {
      sessions: { store, now: () => NOW },
      oidc: new StubIdp({ refreshFails: true }),
    };
    await store.putSession(
      record({
        tokens: { access_token: "stale", refresh_token: "r1", access_expires_at: NOW - 1 },
      }),
    );

    expect(await resolveSession(deps, access())).toEqual({ status: "expired" });
    expect(store.sessions.size).toBe(0);
  });
});

describe("session-to-subject binding", () => {
  it("returns the subject and token of the presented session only", async () => {
    const context = harness();
    await context.store.putSession(record({ sub: "subject-a" }));
    await context.store.putSession(
      record({
        id: sha256Hex("another-browsers-cookie"),
        sub: "subject-b",
        tokens: { access_token: "b-access", refresh_token: "b-refresh", access_expires_at: NOW + 900 },
      }),
    );

    const outcome = await resolveSession(context.deps, access());

    expect(outcome).toMatchObject({ status: "live", accessToken: "live-access" });
    expect(outcome.status === "live" && outcome.record.sub).toBe("subject-a");
  });
});
