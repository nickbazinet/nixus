import { describe, expect, it } from "vitest";

import { clearHostCookie, parseCookies, serializeHostCookie } from "./cookies.ts";
import { PREAUTH_COOKIE, SESSION_COOKIE } from "./sessions.ts";

/*
 * The `__Host-` prefix is a browser-enforced contract and the whole reason a
 * sibling host cannot set the session cookie. Every attribute it requires is
 * asserted, because a cookie that merely LOOKS set is the failure mode: a browser
 * silently drops a `__Host-` cookie that omits `Secure`, carries a `Domain`, or
 * uses any `Path` but `/`.
 */

describe("serializeHostCookie", () => {
  const header = serializeHostCookie({
    name: SESSION_COOKIE,
    value: "opaque-value",
    maxAgeSeconds: 604_800,
  });

  it.each(["Path=/", "Secure", "HttpOnly", "SameSite=Lax", "Max-Age=604800"])(
    "sets %s",
    (attribute) => {
      expect(header).toContain(attribute);
    },
  );

  it("never sets a Domain, which would make the __Host- prefix invalid", () => {
    expect(header.toLowerCase()).not.toContain("domain=");
  });

  it("keeps SameSite at Lax so the OAuth return navigation carries the cookie", () => {
    // Strict would withhold the pre-auth cookie on the top-level GET back from
    // auth.nixusapp.com, which breaks every sign-in rather than hardening it.
    expect(header).not.toContain("SameSite=Strict");
  });

  it.each([SESSION_COOKIE, PREAUTH_COOKIE])("names %s with the __Host- prefix", (name) => {
    expect(name.startsWith("__Host-")).toBe(true);
  });
});

describe("clearHostCookie", () => {
  it("expires immediately and carries no value", () => {
    const header = clearHostCookie(SESSION_COOKIE);
    expect(header).toContain("Max-Age=0");
    expect(header.startsWith(`${SESSION_COOKIE}=;`)).toBe(true);
  });
});

describe("parseCookies", () => {
  it("reads a value back out of its own serialization", () => {
    const header = serializeHostCookie({
      name: SESSION_COOKIE,
      value: "abc-123_xyz",
      maxAgeSeconds: 60,
    });
    expect(parseCookies(header)[SESSION_COOKIE]).toBe("abc-123_xyz");
  });

  it("finds the right cookie among several", () => {
    const jar = parseCookies(`other=1; ${SESSION_COOKIE}=wanted; ${PREAUTH_COOKIE}=pre`);
    expect(jar[SESSION_COOKIE]).toBe("wanted");
    expect(jar[PREAUTH_COOKIE]).toBe("pre");
  });

  it.each([null, undefined, "", "garbage", "=novalue", ";;;"])(
    "returns an empty jar for %j",
    (header) => {
      expect(parseCookies(header)).toEqual({});
    },
  );
});
