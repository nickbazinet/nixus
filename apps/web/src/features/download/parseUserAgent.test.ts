/**
 * Unit tests for the pure UA classifier (Story 2.2).
 *
 * Real UA strings pulled from current desktop and mobile browsers — the
 * goal is to lock in classification of the cases the marketing site is
 * most likely to see in production, plus the well-known traps:
 *   - iOS Safari UAs contain "Mac OS X" (must NOT classify as macos)
 *   - Android UAs contain "Linux" (must NOT classify as linux)
 *   - Empty / garbage UAs must fall through to 'unknown' rather than throw
 */

import { describe, expect, it } from "vitest";
import { parseUserAgent } from "./parseUserAgent";

describe("parseUserAgent", () => {
  it("classifies macOS Safari as macos", () => {
    const ua =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
    expect(parseUserAgent(ua)).toBe("macos");
  });

  it("classifies macOS Chrome as macos", () => {
    const ua =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    expect(parseUserAgent(ua)).toBe("macos");
  });

  it("classifies macOS Firefox as macos", () => {
    const ua =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.0; rv:121.0) Gecko/20100101 Firefox/121.0";
    expect(parseUserAgent(ua)).toBe("macos");
  });

  it("classifies Windows 10 Edge as windows", () => {
    const ua =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0";
    expect(parseUserAgent(ua)).toBe("windows");
  });

  it("classifies Windows 11 Chrome as windows", () => {
    const ua =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    expect(parseUserAgent(ua)).toBe("windows");
  });

  it("classifies Windows Firefox as windows", () => {
    const ua =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0";
    expect(parseUserAgent(ua)).toBe("windows");
  });

  it("classifies Linux Firefox as linux", () => {
    const ua =
      "Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0";
    expect(parseUserAgent(ua)).toBe("linux");
  });

  it("classifies Linux Chrome as linux", () => {
    const ua =
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    expect(parseUserAgent(ua)).toBe("linux");
  });

  it("classifies iOS Safari as mobile (not macos)", () => {
    // Note: contains "Mac OS X" — the canonical macOS-trap UA. If this
    // ever regresses to 'macos', users on iPhone will be offered a .dmg.
    const ua =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
    expect(parseUserAgent(ua)).toBe("mobile");
  });

  it("classifies iPadOS Safari as mobile (not macos)", () => {
    const ua =
      "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
    expect(parseUserAgent(ua)).toBe("mobile");
  });

  it("classifies Android Chrome as mobile (not linux)", () => {
    // Note: contains "Linux" — the canonical linux-trap UA. Android is
    // technically a Linux kernel, but for a desktop-app marketing site
    // it must be classified as mobile.
    const ua =
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
    expect(parseUserAgent(ua)).toBe("mobile");
  });

  it("classifies an empty string as unknown", () => {
    expect(parseUserAgent("")).toBe("unknown");
  });

  it("classifies a garbage string as unknown", () => {
    expect(parseUserAgent("asdfasdf")).toBe("unknown");
  });

  it("is deterministic — repeated calls return the same result", () => {
    const ua =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15";
    expect(parseUserAgent(ua)).toBe(parseUserAgent(ua));
    expect(parseUserAgent(ua)).toBe("macos");
  });
});
