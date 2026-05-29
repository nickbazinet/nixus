/**
 * Analytics wrapper for the Nixus marketing site.
 *
 * v1 strategy:
 * - **Page views**: tracked by Cloudflare Web Analytics. The beacon script is
 *   injected from `__root.tsx` only on production builds AND only when
 *   `VITE_CLOUDFLARE_ANALYTICS_TOKEN` is set. This is cookieless and requires
 *   no consent banner (NFR-W5).
 * - **Custom events**: typed pass-through that no-ops in production and
 *   `console.debug`s in dev. Cloudflare's basic Web Analytics does NOT
 *   support a documented custom-event API today; if/when `window.cfBeacon`
 *   exposes a `track` method at runtime, we forward to it defensively. A
 *   real custom-event backend (Plausible, Cloudflare Workers Analytics
 *   Engine, etc.) can replace the body of this file in v2 without changing
 *   the call-site contract.
 *
 * Discriminated-union event shape gives autocomplete on event names *and*
 * per-event property typing without needing a generic. New events get added
 * to the union as their owning stories land. Property keys are snake_case
 * to match the architecture's JSON-contract rule.
 */

export type AnalyticsEvent =
  | {
      name: "download.clicked";
      properties: { os: string; version: string };
    }
  | {
      name: "faq.expanded";
      properties: { question: string };
    }
  | { name: "os.linux_message_shown" }
  | { name: "os.mobile_message_shown" };

declare global {
  interface Window {
    /**
     * Cloudflare Web Analytics beacon. The script populates this lazily
     * after load; `track` is optional because Cloudflare's basic Web
     * Analytics product does not expose it today. We probe defensively so
     * a future API addition (or a swap to a different beacon) Just Works.
     */
    cfBeacon?: {
      track?: (name: string, properties?: Record<string, unknown>) => void;
    };
  }
}

/**
 * Fire an analytics event.
 *
 * Safe to call from any render path:
 *   - On the server (during prerender) it returns immediately — there's no
 *     beacon target and no `window`, so nothing to do.
 *   - In the browser, forwards to `window.cfBeacon.track` if present.
 *     Errors from the beacon are swallowed so analytics never breaks the
 *     user-visible app.
 *   - In dev, also logs to `console.debug` so calls are visible in devtools.
 */
export function trackEvent(event: AnalyticsEvent): void {
  // SSR / prerender guard: bail before touching any browser-only globals.
  if (typeof window === "undefined") return;

  // Forward to a runtime beacon if one is available. Cloudflare's basic
  // Web Analytics does not expose `track` today, but probing defensively
  // means a future API addition — or a swap-in alternative beacon — will
  // start receiving events with no code changes here.
  if (typeof window.cfBeacon?.track === "function") {
    const properties =
      "properties" in event
        ? (event.properties as Record<string, unknown>)
        : undefined;
    try {
      window.cfBeacon.track(event.name, properties);
    } catch {
      // Intentionally swallowed: analytics must never break user code.
    }
  }

  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console -- intentional debug log; gated on DEV
    console.debug("[analytics]", event);
  }
}
