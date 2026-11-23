import logoUrl from "@/assets/nixus-logo.webp";
import { cn } from "@/lib/utils";

/**
 * The charte's glossy N — the same artwork nixusapp.com and the account site use. Decorative: the
 * control or heading around it carries the name.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <img
      src={logoUrl}
      alt=""
      width={32}
      height={32}
      decoding="async"
      className={cn("size-8 shrink-0 object-contain", className)}
    />
  );
}
