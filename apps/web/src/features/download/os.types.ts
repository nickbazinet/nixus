/**
 * Type contracts for OS detection (Story 2.2).
 *
 * The marketing site needs a single source of truth for "what OS is this
 * visitor on?" so the Download CTA, install instructions, and any other
 * OS-aware UI can branch on the same classification. Types live in their
 * own module so both the pure parser (`parseUserAgent`) and the React
 * hook (`useOSDetection`) can import them without circular dependencies.
 *
 * Lowercase string literals are used intentionally — they pair cleanly with
 * the snake_case-ish style the architecture uses for JSON contracts (see
 * `release.types.ts`) and keep equality checks simple. Display labels like
 * "macOS" or "Windows" are a presentation-layer concern handled by
 * downstream components, not by the OS type itself.
 */

/**
 * The set of operating-system buckets the marketing site distinguishes.
 *
 * - `'macos'` — Mac desktop browsers (Safari, Chrome, Firefox, etc.)
 * - `'windows'` — Windows desktop browsers
 * - `'linux'` — Linux desktop browsers (X11 / Wayland)
 * - `'mobile'` — iOS, iPadOS, Android — the desktop app isn't available here
 * - `'unknown'` — UA didn't match any of the above, or we're rendering on
 *   the server / before hydration. Components should treat this as a
 *   neutral fallback ("Choose your platform") rather than an error.
 */
export type OS = "macos" | "windows" | "linux" | "mobile" | "unknown";

/**
 * Return shape of the `useOSDetection` hook.
 *
 * `isLoading` is `true` during SSR/prerender and on the very first client
 * render before `useEffect` fires. Once the effect runs, `os` reflects the
 * parsed UA and `isLoading` flips to `false`. Components can either gate
 * their rendering on `isLoading` (to avoid hydration mismatch flashes) or
 * render an `'unknown'` neutral variant and let it upgrade in place.
 */
export type OSDetectionResult = {
  os: OS;
  isLoading: boolean;
};
