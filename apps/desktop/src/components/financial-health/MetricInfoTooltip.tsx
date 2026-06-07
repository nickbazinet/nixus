import { Info } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@nixus/shared";

interface MetricInfoTooltipProps {
  /** Accessible name for the info button (e.g. "How savings rate is calculated"). */
  ariaLabel: string;
  /** Tooltip body copy. */
  content: string;
  testId?: string;
}

export function MetricInfoTooltip({
  ariaLabel,
  content,
  testId = "metric-info-trigger",
}: MetricInfoTooltipProps) {
  return (
    <TooltipProvider delay={0}>
      <Tooltip>
        <TooltipTrigger
          type="button"
          className="inline-flex shrink-0 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-sm"
          aria-label={ariaLabel}
          data-testid={testId}
        >
          <Info className="h-3.5 w-3.5" aria-hidden="true" />
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs leading-relaxed">
          {content}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
