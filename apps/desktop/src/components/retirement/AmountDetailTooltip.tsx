import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  focusRing,
} from "@nixus/shared";
import { cn } from "@/lib/utils";

interface AmountDetailTooltipProps {
  /** The figure on the surface, already formatted and already privacy-masked. Doubles as the trigger. */
  amount: string;
  /**
   * The figure `amount` was derived from, formatted the same way. Only ever compared, never rendered
   * here — `detail` is what the popup says, and it is the caller's job to name this number in it.
   */
  derivedFrom: string;
  /** Horizon in years. Nothing was converted at 0, so there is no receipt to show. */
  years: number;
  /** Popup body: the conversion stated in full, so the surface figure never has to justify itself. */
  detail: string;
  /** Accessible name for the trigger — screen readers get the conversion, not a bare dollar figure. */
  ariaLabel: string;
  testId?: string;
}

/**
 * A "receipt" for a figure the app rewrote before showing it: the number itself is the trigger, and
 * the popup names what it was converted from. A dotted underline rather than an info icon, because a
 * second icon next to a row that already has one reads as a second, unrelated explanation.
 */
export function AmountDetailTooltip({
  amount,
  derivedFrom,
  years,
  detail,
  ariaLabel,
  testId,
}: AmountDetailTooltipProps) {
  // A conversion that changed nothing has nothing to disclose, and an affordance that opens an
  // "X, converted from X" popup is worse than no affordance. Equality is also how privacy masking
  // lands here: both figures mask to the same string, so the trigger disappears with the digits.
  if (years <= 0 || amount === derivedFrom) {
    return <span data-testid={testId}>{amount}</span>;
  }

  return (
    <TooltipProvider delay={150}>
      <Tooltip>
        <TooltipTrigger
          type="button"
          className={cn(
            "inline-flex min-h-target-min items-center justify-end rounded-sm underline decoration-ink-faint decoration-dotted underline-offset-4 hover:decoration-ink hover:text-ink",
            focusRing,
          )}
          aria-label={ariaLabel}
          data-testid={testId}
        >
          {amount}
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-caption">
          {detail}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
