/**
 * React hook providing the single source of truth for OS detection
 * (Story 2.2).
 *
 * Architecture rule: any component that needs to branch on visitor OS
 * consumes this hook, never `navigator.userAgent` directly. Centralizing
 * detection here means we only have one place to fix UA quirks and one
 * place to reason about SSR/hydration behavior.
 *
 * SSR / hydration model:
 *   - Initial render (server *and* first client render) returns
 *     `{ os: 'unknown', isLoading: true }` so the prerendered HTML is
 *     OS-neutral. This guarantees the server output and the first client
 *     paint match — no React hydration mismatch warning, no flash of
 *     wrong content.
 *   - After hydration, the `useEffect` runs once, parses the real UA,
 *     and flips state to `{ os: <detected>, isLoading: false }`.
 *   - Components can either gate their visible UI on `!isLoading` (no
 *     flash, but a brief blank), or render the `'unknown'` neutral
 *     variant during loading and let it upgrade in place once detection
 *     completes (preferred for the Hero CTA — see Story 2.3).
 */

import { useEffect, useState } from "react";
import { parseUserAgent } from "./parseUserAgent";
import type { OS, OSDetectionResult } from "./os.types";

/**
 * Detect the visitor's OS and report when detection has completed.
 *
 * @returns `{ os, isLoading }` — `os` is `'unknown'` until the post-mount
 *   effect runs, at which point it reflects `parseUserAgent(navigator.userAgent)`.
 *   `isLoading` mirrors that transition (`true` → `false`).
 */
export function useOSDetection(): OSDetectionResult {
  const [os, setOS] = useState<OS>("unknown");
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    // Defensive `typeof` guard: even though `useEffect` only runs in the
    // browser, exotic test environments (or future SSR rehydration tweaks)
    // might run effects without a `navigator`. Skip parsing in that case
    // and leave `os` at its 'unknown' default — but still flip
    // `isLoading` to false so consumers don't spin forever.
    if (typeof navigator !== "undefined" && navigator.userAgent) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- SSR-safe: navigator.userAgent read only inside useEffect (browser-only), setState is synchronous and intentional
      setOS(parseUserAgent(navigator.userAgent));
    }
    setIsLoading(false);
  }, []);

  return { os, isLoading };
}
