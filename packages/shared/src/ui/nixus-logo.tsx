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
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0", className)}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="nixus-grad" x1="0" y1="0" x2="1" y2="1">
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
      <polygon points="3,29 10,29 29,3 22,3" fill="url(#nixus-grad)" />
    </svg>
  );
}
