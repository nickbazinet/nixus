import { describe, expect, it } from "vitest";

import {
  DESTINATIONS,
  DEFAULT_DESTINATION,
  destinationPath,
  isDestinationKey,
  resolveDestinationKey,
} from "./destinations.ts";

/*
 * Adversary H11: the post-authentication destination is a KEY, so the only thing
 * to prove is that an unknown key resolves to the default and that no declared
 * destination is anything but a same-origin path.
 */

describe("the destination map", () => {
  it.each(Object.entries(DESTINATIONS))("maps %s to the absolute path %s", (_key, path) => {
    expect(path.startsWith("/")).toBe(true);
    // A protocol-relative or backslash-escaped path is a different ORIGIN to a
    // browser, which is exactly what makes `//evil.example` an open redirect.
    expect(path.startsWith("//")).toBe(false);
    expect(path).not.toContain("\\");
    expect(path).not.toContain(":");
    expect(path).not.toContain("..");
  });
});

describe("resolveDestinationKey", () => {
  it.each([
    "//evil.example",
    "/\\evil.example",
    "https://evil.example",
    "http://evil.example",
    "https://account.nixusapp.com.evil.example",
    "javascript:alert(1)",
    "/profile",
    "/fr/profile",
    "PROFILE",
    "profile\n",
    "",
    "   ",
  ])("falls back to the default for %j", (value) => {
    expect(resolveDestinationKey(value)).toBe(DEFAULT_DESTINATION);
  });

  it.each([null, undefined, 0, {}, [], true])("falls back to the default for %j", (value) => {
    expect(resolveDestinationKey(value)).toBe(DEFAULT_DESTINATION);
  });

  it("honours the declared fallback rather than the English default", () => {
    expect(resolveDestinationKey("nonsense", "profile-fr")).toBe("profile-fr");
  });

  it.each(Object.keys(DESTINATIONS))("accepts the declared key %s", (key) => {
    expect(resolveDestinationKey(key)).toBe(key);
    expect(isDestinationKey(key)).toBe(true);
  });

  it("refuses an inherited Object member as a key", () => {
    expect(isDestinationKey("toString")).toBe(false);
    expect(isDestinationKey("constructor")).toBe(false);
    expect(resolveDestinationKey("__proto__")).toBe(DEFAULT_DESTINATION);
  });
});

describe("destinationPath", () => {
  it("only ever returns a declared path", () => {
    for (const key of Object.keys(DESTINATIONS)) {
      expect(Object.values(DESTINATIONS)).toContain(
        destinationPath(key as keyof typeof DESTINATIONS),
      );
    }
  });
});
