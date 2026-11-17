import { describe, expect, it } from "vitest";

import { beginLogin, completeCallback, signOut, type FlowDeps } from "./auth-flow.ts";
import { parseCookies } from "./cookies.ts";
import { sha256Hex } from "./crypto.ts";
import { PREAUTH_COOKIE, SESSION_COOKIE } from "./sessions.ts";
import { MemorySessionStore } from "./testing/memory-store.ts";
import { StubIdp, type StubIdpOptions } from "./testing/stub-idp.ts";

/*
 * AD-15's account-app release gates: login CSRF, session fixation, pre-auth replay,
 * nonce mismatch and open redirect. Every one runs the production flow functions
 * against a real in-memory store and a stub IdP, so a regression in the LOGIC
 * fails them.
 */

const NOW = 1_800_000_000;

function harness(options?: StubIdpOptions & { now?: number }) {
  const store = new MemorySessionStore();
  const oidc = new StubIdp(options);
  const deps: FlowDeps = {
    sessions: { store, now: () => options?.now ?? NOW },
    oidc,
  };
  return { store, oidc, deps };
}

function cookieValue(setCookie: readonly string[], name: string): string | undefined {
  const header = setCookie.find((cookie) => cookie.startsWith(`${name}=`));
  return header === undefined ? undefined : parseCookies(header)[name];
}

async function signedInBrowser(options?: StubIdpOptions) {
  const context = harness(options);
  const login = await beginLogin(context.deps, { next: "profile", language: "en" });
  const preAuthCookie = cookieValue(login.setCookie, PREAUTH_COOKIE);
  expect(preAuthCookie).toBeDefined();

  const attempt = context.oidc.authorizeCalls[0];
  expect(attempt).toBeDefined();
  return { ...context, preAuthCookie: preAuthCookie as string, attempt: attempt! };
}

function callbackQuery(state: string, code = "authorization-code"): URLSearchParams {
  return new URLSearchParams({ state, code });
}

describe("login CSRF", () => {
  it("refuses a callback carrying a foreign code with no pre-auth cookie, without exchanging it", async () => {
    const { deps, oidc } = harness();

    const outcome = await completeCallback(deps, {
      query: callbackQuery("attacker-state", "attackers-code"),
      preAuthCookie: undefined,
    });

    expect(outcome).toMatchObject({ kind: "failure", status: 403, code: "preauth_missing" });
    expect(oidc.exchanges).toEqual([]);
  });

  it("refuses a callback whose state does not match the pre-auth record, without exchanging it", async () => {
    const context = await signedInBrowser();

    const outcome = await completeCallback(context.deps, {
      query: callbackQuery("attacker-state", "attackers-code"),
      preAuthCookie: context.preAuthCookie,
    });

    expect(outcome).toMatchObject({ kind: "failure", status: 403, code: "state_mismatch" });
    expect(context.oidc.exchanges).toEqual([]);
  });

  it("refuses a callback with a pre-auth cookie the server never issued", async () => {
    const context = await signedInBrowser();

    const outcome = await completeCallback(context.deps, {
      query: callbackQuery(context.attempt.state),
      preAuthCookie: "a-value-the-attacker-chose",
    });

    expect(outcome).toMatchObject({ kind: "failure", code: "preauth_missing" });
    expect(context.oidc.exchanges).toEqual([]);
  });

  it("clears the pre-auth cookie on every refusal", async () => {
    const { deps } = harness();
    const outcome = await completeCallback(deps, {
      query: callbackQuery("x"),
      preAuthCookie: undefined,
    });

    expect(outcome.setCookie).toContain(`${PREAUTH_COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`);
  });
});

describe("pre-auth records are single use", () => {
  it("refuses a replayed callback even when both state and code are correct", async () => {
    const context = await signedInBrowser();
    const query = callbackQuery(context.attempt.state);

    const first = await completeCallback(context.deps, {
      query,
      preAuthCookie: context.preAuthCookie,
    });
    const replay = await completeCallback(context.deps, {
      query,
      preAuthCookie: context.preAuthCookie,
    });

    expect(first.kind).toBe("redirect");
    expect(replay).toMatchObject({ kind: "failure", code: "preauth_missing" });
    expect(context.oidc.exchanges).toHaveLength(1);
  });

  it("refuses a pre-auth record whose ten minutes have passed", async () => {
    const context = await signedInBrowser();
    const expired: FlowDeps = {
      ...context.deps,
      sessions: { ...context.deps.sessions, now: () => NOW + 601 },
    };

    const outcome = await completeCallback(expired, {
      query: callbackQuery(context.attempt.state),
      preAuthCookie: context.preAuthCookie,
    });

    expect(outcome).toMatchObject({ kind: "failure", code: "preauth_missing" });
    expect(context.oidc.exchanges).toEqual([]);
  });
});

describe("nonce", () => {
  it("refuses an id_token whose nonce is not the one this attempt asked for", async () => {
    const context = await signedInBrowser({ nonce: "some-other-nonce" });

    const outcome = await completeCallback(context.deps, {
      query: callbackQuery(context.attempt.state),
      preAuthCookie: context.preAuthCookie,
    });

    expect(outcome).toMatchObject({ kind: "failure", status: 403, code: "identity_unverified" });
    expect(context.store.sessions.size).toBe(0);
  });

  it("asks for a nonce that is not the state and not the pkce challenge", async () => {
    const context = await signedInBrowser();
    const { state, nonce, codeChallenge } = context.attempt;

    expect(new Set([state, nonce, codeChallenge]).size).toBe(3);
  });
});

describe("session fixation", () => {
  it("mints a session cookie that is neither the pre-auth value nor anything the client presented", async () => {
    const context = await signedInBrowser();

    const outcome = await completeCallback(context.deps, {
      query: callbackQuery(context.attempt.state),
      preAuthCookie: context.preAuthCookie,
    });

    expect(outcome.kind).toBe("redirect");
    const session = cookieValue(outcome.setCookie, SESSION_COOKIE);
    expect(session).toBeDefined();
    expect(session).not.toBe(context.preAuthCookie);
    expect(session).not.toBe(context.attempt.state);
    expect(context.store.sessions.has(sha256Hex(session as string))).toBe(true);
  });

  it("does not upgrade a session cookie the client already held", async () => {
    const context = await signedInBrowser();
    const attackerChosen = "attacker-planted-session-value";
    await context.store.putSession({
      id: sha256Hex(attackerChosen),
      type: "session",
      sub: "attacker",
      email: null,
      tokens: { access_token: "a", refresh_token: "r", access_expires_at: NOW + 900 },
      idle_expires_at: NOW + 1000,
      absolute_expires_at: NOW + 2000,
      expires_at: NOW + 2000,
    });

    const outcome = await completeCallback(context.deps, {
      query: callbackQuery(context.attempt.state),
      preAuthCookie: context.preAuthCookie,
    });

    const minted = cookieValue(outcome.setCookie, SESSION_COOKIE);
    expect(minted).not.toBe(attackerChosen);
    // The planted row is untouched: nothing in the flow writes to a row it did
    // not create, so a value the client chose can never become authenticated.
    expect(context.store.sessions.get(sha256Hex(attackerChosen))?.sub).toBe("attacker");
  });

  it("stores only the hash of the cookie, never the cookie", async () => {
    const context = await signedInBrowser();
    const outcome = await completeCallback(context.deps, {
      query: callbackQuery(context.attempt.state),
      preAuthCookie: context.preAuthCookie,
    });
    const session = cookieValue(outcome.setCookie, SESSION_COOKIE) as string;

    expect(JSON.stringify([...context.store.sessions.entries()])).not.toContain(session);
  });
});

describe("open redirect", () => {
  const HOSTILE = [
    "//evil.example",
    "/\\evil.example",
    "https://evil.example",
    "https://account.nixusapp.com.evil.example",
    "javascript:alert(1)",
    "/profile/../../evil",
    "profile ",
    "HOME",
  ];

  it.each(HOSTILE)("lands on the default destination for %s and never echoes it", async (next) => {
    const context = await signedInBrowser();
    const login = await beginLogin(context.deps, { next, language: "en" });
    const preAuthCookie = cookieValue(login.setCookie, PREAUTH_COOKIE) as string;
    const attempt = context.oidc.authorizeCalls.at(-1)!;

    const outcome = await completeCallback(context.deps, {
      query: callbackQuery(attempt.state),
      preAuthCookie,
    });

    expect(outcome.kind).toBe("redirect");
    expect(outcome).toMatchObject({ location: "/profile" });
    expect(JSON.stringify(outcome)).not.toContain("evil.example");
    expect(JSON.stringify(outcome)).not.toContain("javascript:");
  });

  it("keeps a French sign-in in French without accepting a path", async () => {
    const context = harness();
    const login = await beginLogin(context.deps, { next: null, language: "fr" });
    const preAuthCookie = cookieValue(login.setCookie, PREAUTH_COOKIE) as string;

    const outcome = await completeCallback(context.deps, {
      query: callbackQuery(context.oidc.authorizeCalls[0]!.state),
      preAuthCookie,
    });

    expect(outcome).toMatchObject({ kind: "redirect", location: "/fr/profile" });
  });
});

describe("sign-out", () => {
  it("revokes only this session's refresh token and deletes only its row", async () => {
    const context = await signedInBrowser();
    const outcome = await completeCallback(context.deps, {
      query: callbackQuery(context.attempt.state),
      preAuthCookie: context.preAuthCookie,
    });
    const session = cookieValue(outcome.setCookie, SESSION_COOKIE) as string;

    await signOut(context.deps, { sessionCookie: session });

    expect(context.oidc.revoked).toEqual(["refresh-for-authorization-code"]);
    expect(context.store.sessions.size).toBe(0);
  });

  it("clears the cookie and hands the browser to managed login even with no session", async () => {
    const context = harness();

    const outcome = await signOut(context.deps, { sessionCookie: undefined });

    expect(outcome.location).toContain("/logout");
    expect(outcome.setCookie.join(" ")).toContain(`${SESSION_COOKIE}=;`);
    expect(context.oidc.revoked).toEqual([]);
  });
});
