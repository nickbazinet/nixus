/**
 * Unit tests for the analytics wrapper (Story 4.1).
 *
 * Coverage matrix:
 *   1. SSR-safe: when `window` is undefined, `trackEvent` is a no-op.
 *   2. Browser, no beacon: when `window.cfBeacon` is undefined (the v1
 *      reality, since Cloudflare Web Analytics doesn't expose a custom-
 *      event API), `trackEvent` doesn't throw.
 *   3. Browser, beacon present: when `window.cfBeacon.track` is mocked,
 *      it gets called with the event name + properties.
 *   4. Beacon errors don't propagate: a throwing `track` must NEVER break
 *      user code — analytics is a side-channel.
 *   5. Dev `console.debug`: in DEV (Vitest's default), every call also
 *      logs the typed event for local-devtools verification.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { trackEvent } from "./analytics";

describe("trackEvent", () => {
  let debugSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // We always start each test with a clean `cfBeacon` so cross-test
    // pollution can't masquerade as "the beacon path got called".
    delete (window as { cfBeacon?: unknown }).cfBeacon;
    debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
  });

  afterEach(() => {
    delete (window as { cfBeacon?: unknown }).cfBeacon;
    debugSpy.mockRestore();
  });

  it("is a no-op when window is undefined (SSR/prerender)", () => {
    // jsdom always provides `window`; emulate the SSR path by stashing
    // and removing it for the duration of one call. We restore in a
    // finally so a thrown assertion can't leak the missing global.
    const realWindow = globalThis.window;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).window = undefined;
    try {
      expect(() =>
        trackEvent({
          name: "download.clicked",
          properties: { os: "macos", version: "v0.1.0" },
        }),
      ).not.toThrow();
    } finally {
      globalThis.window = realWindow;
    }
  });

  it("does not throw when window.cfBeacon is undefined", () => {
    expect(() =>
      trackEvent({
        name: "download.clicked",
        properties: { os: "macos", version: "v0.1.0" },
      }),
    ).not.toThrow();
    expect(() =>
      trackEvent({ name: "faq.expanded", properties: { question: "Q1" } }),
    ).not.toThrow();
    expect(() => trackEvent({ name: "os.linux_message_shown" })).not.toThrow();
    expect(() => trackEvent({ name: "os.mobile_message_shown" })).not.toThrow();
  });

  it("forwards events with properties to window.cfBeacon.track", () => {
    const track = vi.fn();
    window.cfBeacon = { track };

    trackEvent({
      name: "download.clicked",
      properties: { os: "macos", version: "v0.1.0" },
    });

    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith("download.clicked", {
      os: "macos",
      version: "v0.1.0",
    });
  });

  it("forwards property-less events to window.cfBeacon.track with undefined props", () => {
    const track = vi.fn();
    window.cfBeacon = { track };

    trackEvent({ name: "os.linux_message_shown" });

    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith("os.linux_message_shown", undefined);
  });

  it("swallows errors thrown by window.cfBeacon.track", () => {
    const track = vi.fn(() => {
      throw new Error("beacon blew up");
    });
    window.cfBeacon = { track };

    expect(() =>
      trackEvent({
        name: "faq.expanded",
        properties: { question: "Why local-first?" },
      }),
    ).not.toThrow();
    expect(track).toHaveBeenCalledTimes(1);
  });

  it("logs to console.debug in DEV", () => {
    // Vitest sets `import.meta.env.DEV` to true by default during unit
    // runs, so the debug log path is exercised on every call.
    trackEvent({ name: "os.mobile_message_shown" });

    expect(debugSpy).toHaveBeenCalledTimes(1);
    expect(debugSpy).toHaveBeenCalledWith("[analytics]", {
      name: "os.mobile_message_shown",
    });
  });
});
