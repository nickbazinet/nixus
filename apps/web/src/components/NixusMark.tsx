import { useId } from "react";

import { cn } from "@/lib/cn";

/** The Nixus mark, same geometry as `public/favicon.svg`. */
export function NixusMark({ className }: { className?: string }) {
  const gradientId = useId();
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn("size-8", className)}>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#5E78ED" />
          <stop offset="50%" stopColor="#9978ED" />
          <stop offset="100%" stopColor="#DE50A4" />
        </linearGradient>
      </defs>
      <rect x="3" y="3" width="7" height="26" rx="2" fill="#5E78ED" />
      <rect x="22" y="3" width="7" height="26" rx="2" fill="#DE50A4" />
      <polygon points="3,29 10,29 29,3 22,3" fill={`url(#${gradientId})`} />
    </svg>
  );
}
