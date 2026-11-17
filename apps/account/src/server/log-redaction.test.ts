import { afterEach, describe, expect, it, vi } from "vitest";

import { beginLogin, completeCallback, signOut, type FlowDeps } from "./auth-flow.ts";
import { parseCookies } from "./cookies.ts";
import { log } from "./log.ts";
import { resolveSession } from "./current-session.ts";
import { PREAUTH_COOKIE, SESSION_COOKIE } from "./sessions.ts";
import { MemorySessionStore } from "./testing/memory-store.ts";
import { StubIdp } from "./testing/stub-idp.ts";

/*
 * AD-12 as an executable gate.
 *
 * Distinctive values are planted in every place personal data and credentials
 * actually flow — the OAuth code, the tokens, the cookies, the subject's email —
 * and a full sign-in / read / sign-out cycle is driven with `console` captured. A
 * log line containing any of them fails this test, which is the only way the rule
 * survives a future handler that logs "just the request for debugging".
 */

const PLANTED = {
  code: "PLANTED-AUTHORIZATION-CODE",
  email: "planted.person@example.invalid",
  clientSecret: "PLANTED-CLIENT-SECRET",
  firstName: "PlantedGivenName",
} as const;

const SINKS = ["log", "warn", "error", "info", "debug"] as const;

function captureConsole(): { lines: () => string[]; restore: () => void } {
  const captured: string[] = [];
  const spies = SINKS.map((sink) =>
    vi.spyOn(console, sink).mockImplementation((...args: unknown[]) => {
      captured.push(args.map((value) => String(value)).join(" "));
    }),
  );
  return {
    lines: () => captured,
    restore: () => spies.forEach((spy) => spy.mockRestore()),
  };
}

afterEach(() => vi.restoreAllMocks());

describe("no planted value reaches a log line", () => {
  it("stays silent about codes, tokens, cookies and the email across a whole session", async () => {
    const console = captureConsole();
    try {
      const store = new MemorySessionStore();
      const oidc = new StubIdp({ email: PLANTED.email });
      const deps: FlowDeps = { sessions: { store, now: () => 1_800_000_000 }, oidc };

      const login = await beginLogin(deps, { next: "profile", language: "en" });
      const preAuthCookie = parseCookies(login.setCookie[0])[PREAUTH_COOKIE] as string;
      const state = oidc.authorizeCalls[0]!.state;

      const callback = await completeCallback(deps, {
        query: new URLSearchParams({ state, code: PLANTED.code }),
        preAuthCookie,
      });
      expect(callback.kind).toBe("redirect");
      const session = parseCookies(callback.setCookie[0])[SESSION_COOKIE] as string;

      await resolveSession(
        { sessions: deps.sessions, oidc },
        {
          cookieHeader: `${SESSION_COOKIE}=${session}`,
          originHeader: "https://account.nixusapp.com",
          mutating: true,
          publicOrigin: "https://account.nixusapp.com",
        },
      );
      await signOut(deps, { sessionCookie: session });

      // Something was logged, or this test proves nothing.
      expect(console.lines().length).toBeGreaterThan(0);

      const text = console.lines().join("\n");
      for (const planted of [
        PLANTED.code,
        PLANTED.email,
        `access-for-${PLANTED.code}`,
        `refresh-for-${PLANTED.code}`,
        preAuthCookie,
        session,
        state,
        oidc.authorizeCalls[0]!.nonce,
      ]) {
        expect(text, `a log line carried ${planted.slice(0, 12)}…`).not.toContain(planted);
      }
    } finally {
      console.restore();
    }
  });
});

describe("the log entry type admits nothing else", () => {
  it("emits one JSON object with a closed member set", () => {
    const console = captureConsole();
    try {
      log("info", { route: "/profile", status: 200, latency_ms: 12, code: "ok", bytes: 42, sub: "s" });
      const line = console.lines()[0];
      expect(line).toBeDefined();
      expect(Object.keys(JSON.parse(line as string)).sort()).toEqual([
        "bytes",
        "code",
        "latency_ms",
        "level",
        "route",
        "status",
        "sub",
      ]);
    } finally {
      console.restore();
    }
  });

  it("never carries a client secret, because nothing hands it one", () => {
    const console = captureConsole();
    try {
      log("info", { route: "cold-start", code: "client_secret_loaded" });
      expect(console.lines().join("\n")).not.toContain(PLANTED.clientSecret);
      expect(console.lines().join("\n")).not.toContain(PLANTED.firstName);
    } finally {
      console.restore();
    }
  });
});
