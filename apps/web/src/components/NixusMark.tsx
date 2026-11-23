import logoUrl from "@/assets/nixus-logo.webp";
import { cn } from "@/lib/cn";

/**
 * The Nixus mark, from the same artwork as `public/favicon.svg` (see
 * `scripts/brand/nixus-logo.png`). Decorative: the link around it is named.
 */
export function NixusMark({ className }: { className?: string }) {
  return (
    <img
      src={logoUrl}
      alt=""
      width={32}
      height={32}
      decoding="async"
      className={cn("size-8 shrink-0", className)}
    />
  );
}
