import { Info } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  focusRing,
} from "@nixus/shared";
import { cn } from "@/lib/utils";

interface MetricInfoTooltipProps {
  /** Accessible name for the info button (e.g. "How savings rate is calculated"). */
  ariaLabel: string;
  /** Tooltip body copy. Plain language — the arithmetic lives here, never on the surface. */
  content: string;
  /** Widens or otherwise adjusts the popup for copy the default `max-w-xs` would make a column of. */
  contentClassName?: string;
  testId?: string;
}

export function MetricInfoTooltip({
  ariaLabel,
  content,
  contentClassName,
  testId = "metric-info-trigger",
}: MetricInfoTooltipProps) {
  return (
    <TooltipProvider delay={0}>
      <Tooltip>
        <TooltipTrigger
          type="button"
          className={cn(
            "inline-flex min-h-target-min min-w-target-min shrink-0 items-center justify-center rounded-sm text-ink-faint hover:text-ink",
            focusRing,
          )}
          aria-label={ariaLabel}
          data-testid={testId}
        >
          <Info className="size-3.5" aria-hidden="true" />
        </TooltipTrigger>
        <TooltipContent
          side="top"
          className={cn("max-w-xs text-caption", contentClassName)}
        >
          {content}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
