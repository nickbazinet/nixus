import { useId } from "react";

import { cn } from "../lib/cn";

/**
 * Nixus logo mark — a stylized "N" built from two vertical strokes
 * connected by a diagonal, with the right stroke using the brand accent color.
 *
 * Canonical brand asset. Both `apps/desktop` and `apps/web` consume this
 * component so the visual identity stays in sync across surfaces. Do NOT
 * fork or wrap this component — extend via the `className` prop.
 */
export function NixusLogo({ className }: { className?: string }) {
  // The gradient id must be unique per instance, and several surfaces render more than one mark at
  // once (the picker draws one in the header and one in its illustration; the shell draws the rail
  // mark alongside them). A hardcoded id makes every `url(#…)` on the page resolve to whichever
  // `<defs>` parsed first, so removing one instance silently un-paints the others.
  //
  // `useId` rather than a counter or `Math.random`: it is stable across the SSR/hydration boundary,
  // which `apps/web` needs — a client-generated id would not match the server's markup. React
  // documents the returned format as opaque, so it is sanitized to characters that are safe both in
  // an `id` attribute and inside a `url(#…)` reference. Replaced rather than stripped, so the
  // per-instance counter can never be reduced away to a colliding empty string.
  const instanceId = useId().replace(/[^a-zA-Z0-9_-]/g, "-");
  const gradientId = `nixus-grad-${instanceId}`;

  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0", className)}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#818CF8" />
          <stop offset="50%" stopColor="#A78BFA" />
          <stop offset="100%" stopColor="#F472B6" />
        </linearGradient>
      </defs>
      {/* Left pillar */}
      <rect x="3" y="3" width="7" height="26" rx="2" fill="#818CF8" />
      {/* Right pillar */}
      <rect x="22" y="3" width="7" height="26" rx="2" fill="#F472B6" />
      {/* Diagonal bar */}
      <polygon points="3,29 10,29 29,3 22,3" fill={`url(#${gradientId})`} />
    </svg>
  );
}
