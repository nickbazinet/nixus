/**
 * Pure user-agent classifier for OS detection (Story 2.2).
 *
 * Given a browser UA string, return one of five OS buckets. This is the
 * *only* place in the marketing site that parses user agents — every
 * OS-aware UI element consumes the result via `useOSDetection`, never by
 * inlining UA logic. Keeping this pure (no side effects, deterministic)
 * makes it trivially testable and SSR-safe.
 *
 * Detection-order rationale: mobile is checked first because both iOS and
 * Android UAs notoriously contain desktop-OS substrings. iOS Safari ships
 * "like Mac OS X" in its UA — naively matching "Mac OS X" would tag every
 * iPhone as macOS. Android UAs include "Linux" because Android *is* a
 * Linux kernel — naively matching "Linux" would tag every Android phone
 * as a Linux desktop. Short-circuiting on mobile patterns first avoids
 * both traps without needing exclusion regexes downstream.
 */

import type { OS } from "./os.types";

/**
 * Mobile pattern. Matches iOS device markers ("iPhone", "iPad", "iPod"),
 * Android (any version), and the generic "Mobile"/"Mobi" tokens that most
 * mobile browsers append. Case-insensitive because some bot/crawler UAs
 * normalize casing.
 */
const MOBILE_RE = /iPhone|iPad|iPod|Android|Mobile|Mobi/i;

/**
 * macOS desktop pattern. "Mac OS X" is the modern canonical form; older
 * UAs and some crawlers use the bare "Macintosh" token. Both are checked
 * because we'd rather over-classify a fringe Mac than fall through to
 * 'unknown' and ship the neutral CTA to a real desktop user.
 */
const MACOS_RE = /Mac OS X|Macintosh/;

/**
 * Windows desktop pattern. Covers Windows NT (the "Windows NT 10.0" token
 * Edge/Chrome/Firefox emit) plus the legacy "Win64"/"Win32" tokens that
 * occasionally surface alone.
 */
const WINDOWS_RE = /Windows|Win64|Win32/;

/**
 * Linux desktop pattern. "X11" is the giveaway for traditional Linux
 * desktops (GNOME, KDE under X or XWayland) — it does *not* appear in
 * Android UAs, which is why we use it instead of the bare "Linux" token.
 * "Linux" alone is included as a secondary check for the (rare) Wayland-
 * native browsers that omit "X11"; mobile gets short-circuited above so
 * Android won't reach this branch.
 */
const LINUX_RE = /X11|Linux/;

/**
 * Classify a user-agent string into one of the five `OS` buckets.
 *
 * Pure function: same input always produces the same output, no I/O, no
 * globals touched. Defensive about empty strings (returns `'unknown'`),
 * but the type signature still requires a string — the hook is responsible
 * for checking `typeof navigator !== 'undefined'` before calling.
 *
 * @param ua - The raw `navigator.userAgent` value.
 * @returns The detected OS bucket, or `'unknown'` if no pattern matched.
 */
export function parseUserAgent(ua: string): OS {
  if (!ua) {
    return "unknown";
  }

  // Mobile first — see header comment for the "like Mac OS X" / "Linux
  // Android" traps this avoids.
  if (MOBILE_RE.test(ua)) {
    return "mobile";
  }

  if (MACOS_RE.test(ua)) {
    return "macos";
  }

  if (WINDOWS_RE.test(ua)) {
    return "windows";
  }

  if (LINUX_RE.test(ua)) {
    return "linux";
  }

  return "unknown";
}
