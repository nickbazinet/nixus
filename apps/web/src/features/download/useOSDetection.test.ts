/**
 * Unit tests for the `useOSDetection` hook (Story 2.2).
 *
 * These tests verify two things the hook contract promises:
 *   1. Initial render is `{ os: 'unknown', isLoading: true }` — the SSR-safe
 *      default that the prerendered HTML must match.
 *   2. After the post-mount effect runs, `os` reflects the parsed UA and
 *      `isLoading` is `false`.
 *
 * The jsdom environment ships its own `navigator.userAgent` (some Mozilla/jsdom
 * UA), which would route to 'unknown' in our parser. We override `navigator`
 * per test so each case exercises a deterministic UA. `Object.defineProperty`
 * is used (rather than direct assignment) because the global `navigator` is
 * a non-writable accessor property in jsdom by default.
 */

import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as parseUserAgentModule from "./parseUserAgent";
import type { OSDetectionResult } from "./os.types";
import { useOSDetection } from "./useOSDetection";

/**
 * Stash the original navigator descriptor so we can restore it between
 * tests — leaving a mocked navigator in place would leak into other test
 * files (vitest shares the jsdom global per worker).
 */
const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  "navigator",
);

function setNavigator(userAgent: string | undefined) {
  Object.defineProperty(globalThis, "navigator", {
    value: userAgent === undefined ? undefined : { userAgent },
    writable: true,
    configurable: true,
  });
}

afterEach(() => {
  // Restore the jsdom-provided navigator after each test so we don't
  // pollute siblings.
  if (originalNavigatorDescriptor) {
    Object.defineProperty(
      globalThis,
      "navigator",
      originalNavigatorDescriptor,
    );
  }
  vi.restoreAllMocks();
});

describe("useOSDetection", () => {
  describe("hydrated state — macOS UA", () => {
    beforeEach(() => {
      setNavigator(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
      );
    });

    it("returns macos and isLoading=false after the effect runs", () => {
      const { result } = renderHook(() => useOSDetection());
      // renderHook flushes effects synchronously on its initial pass,
      // so `result.current` already reflects the post-effect state.
      expect(result.current).toEqual({ os: "macos", isLoading: false });
    });
  });

  describe("hydrated state — Linux UA", () => {
    beforeEach(() => {
      setNavigator(
        "Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0",
      );
    });

    it("classifies a Linux UA correctly post-hydration", () => {
      const { result } = renderHook(() => useOSDetection());
      expect(result.current).toEqual({ os: "linux", isLoading: false });
    });
  });

  describe("hydrated state — Windows UA", () => {
    beforeEach(() => {
      setNavigator(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      );
    });

    it("classifies a Windows UA correctly post-hydration", () => {
      const { result } = renderHook(() => useOSDetection());
      expect(result.current).toEqual({ os: "windows", isLoading: false });
    });
  });

  describe("prerender state — no navigator", () => {
    beforeEach(() => {
      setNavigator(undefined);
    });

    it("falls back to 'unknown' when navigator is undefined", () => {
      const { result } = renderHook(() => useOSDetection());
      // Even without `navigator`, the effect still runs and flips
      // isLoading to false — consumers shouldn't spin forever.
      expect(result.current).toEqual({ os: "unknown", isLoading: false });
    });
  });

  describe("parseUserAgent invocation", () => {
    beforeEach(() => {
      setNavigator(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15",
      );
    });

    it("invokes parseUserAgent exactly once per mount and not on re-render", () => {
      // We can't spy on the imported binding directly because ES modules
      // are read-only, but we can spy on the namespace import. The hook
      // imports `parseUserAgent` by name so the spy tracks its calls
      // through the same module instance.
      const spy = vi.spyOn(parseUserAgentModule, "parseUserAgent");

      const { rerender } = renderHook(() => useOSDetection());

      // Effect runs once on mount → exactly one call.
      expect(spy).toHaveBeenCalledTimes(1);

      // Re-render should NOT re-run the effect (empty deps).
      act(() => {
        rerender();
      });
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  describe("SSR-safe default state", () => {
    beforeEach(() => {
      setNavigator(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15",
      );
    });

    it("renders the 'unknown' / isLoading=true default before effects run", () => {
      // Capture every render the hook produces. The first observation
      // is the *pre-effect* commit — this is the snapshot the SSR
      // pipeline serializes into HTML, so it must be the neutral
      // default. The final observation is the hydrated state.
      const observed: OSDetectionResult[] = [];

      // We use a wrapper that snapshots state on every render. We
      // can't rely on renderHook's `result.current` for this because
      // it only exposes the *latest* value, not the render history.
      // A useState in the wrapper forces React to keep tracking
      // commits without affecting the hook under test.
      renderHook(() => {
        const value = useOSDetection();
        // Side-effecting in render is normally a smell, but in a
        // controlled test context it's the simplest way to capture
        // every commit. The observed array becomes the render log.
        observed.push(value);
        // Touching another piece of state here is unnecessary — but
        // we keep useState imported for readers who might extend
        // this test with additional renders.
        useState(0);
        return value;
      });

      // First render must be the SSR-safe default — this is the
      // contract the prerendered HTML depends on.
      expect(observed[0]).toEqual({ os: "unknown", isLoading: true });
      // Final render must be the hydrated state.
      expect(observed[observed.length - 1]).toEqual({
        os: "macos",
        isLoading: false,
      });
    });
  });
});
