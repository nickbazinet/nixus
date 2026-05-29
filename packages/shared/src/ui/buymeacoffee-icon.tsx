import { Coffee } from "lucide-react";
import { cn } from "../lib/cn";

export const BUY_ME_A_COFFEE_URL = "https://buymeacoffee.com/nickbaz";

/**
 * Buy Me a Coffee cup mark — shared across web footer and desktop sidebar
 * so the support link stays visually consistent.
 */
export function BuyMeACoffeeIcon({ className }: { className?: string }) {
  return (
    <Coffee
      className={cn("shrink-0 text-[#FFDD00]", className)}
      aria-hidden="true"
    />
  );
}
