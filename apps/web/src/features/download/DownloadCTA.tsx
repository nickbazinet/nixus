/**
 * Download CTA (Stories 2.3 + 2.4).
 *
 * The marketing site's primary call-to-action. This module owns only the
 * variant routing and the one-time-per-session "message shown" analytics; each
 * variant lives in its own file and the shared click / URL / container
 * contracts live in `ctaShell.tsx`.
 *
 * SSR / hydration model:
 *   - The prerender pass and the very first client render both see
 *     `useOSDetection() => { os: 'unknown', isLoading: true }`. To avoid a
 *     hydration mismatch, the rendered HTML must be identical in both phases
 *     until React's `useEffect` runs. We achieve this by rendering the
 *     "Choose your platform" variant whenever `isLoading` is true, which is
 *     exactly the same shape the `linux | unknown` branch produces
 *     post-hydration. No layout shift, no flash.
 *   - After hydration, `macos` / `windows` upgrade in place to the single-OS
 *     variant, `linux` gains a note, and `mobile` swaps to the
 *     send-to-computer affordance.
 */

import { useEffect } from "react";

import { trackEvent } from "@/lib/analytics";

import { ChoosePlatformVariant } from "./ChoosePlatformVariant";
import { MobileVariant } from "./MobileVariant";
import { SingleOSVariant } from "./SingleOSVariant";
import { useOSDetection } from "./useOSDetection";
import type { OS } from "./os.types";
import type { DownloadCTAProps } from "./ctaShell";

export type { DownloadCTAProps } from "./ctaShell";

/**
 * Module-level dedupe for "shown" analytics events.
 *
 * `<DownloadCTA />` renders in multiple slots on a single page (header + hero
 * + beta page sections). A `useRef`-based dedupe would let each instance fire
 * once, over-counting by 2-3x. A module-level Set survives across all
 * instances within the SPA session and resets on full reload, which is the
 * right granularity for "per session".
 */
const sessionShownEvents = new Set<string>();

/**
 * Clear the in-memory "shown events" dedup set.
 *
 * Exposed solely for tests so they can verify the dedupe behavior without
 * juggling `vi.resetModules()` for every assertion. App code should never call
 * this — the natural session boundary is a page reload.
 */
export function _resetSessionShownEventsForTests(): void {
  sessionShownEvents.clear();
}

type ShownEvent = "os.mobile_message_shown" | "os.linux_message_shown";

function shownEventFor(os: OS): ShownEvent | null {
  if (os === "mobile") return "os.mobile_message_shown";
  if (os === "linux") return "os.linux_message_shown";
  return null;
}

function useShownEvent(os: OS, isLoading: boolean): void {
  useEffect(() => {
    if (isLoading) return;
    const eventName = shownEventFor(os);
    if (!eventName) return;
    if (sessionShownEvents.has(eventName)) return;
    sessionShownEvents.add(eventName);
    trackEvent({ name: eventName });
  }, [os, isLoading]);
}

export function DownloadCTA({
  size = "default",
  showAltOS = false,
  className,
}: DownloadCTAProps) {
  const { os, isLoading } = useOSDetection();
  useShownEvent(os, isLoading);

  if (isLoading || os === "unknown") {
    return <ChoosePlatformVariant size={size} className={className} />;
  }

  if (os === "linux") {
    return (
      <ChoosePlatformVariant size={size} showLinuxNote className={className} />
    );
  }

  if (os === "mobile") {
    return <MobileVariant className={className} />;
  }

  return (
    <SingleOSVariant
      os={os}
      size={size}
      showAltOS={showAltOS}
      className={className}
    />
  );
}
