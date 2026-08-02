import type { ReactNode } from "react";
import { focusRing } from "@nixus/shared";
import { cn } from "@/lib/utils";

/** The shell's skip link and its route-change focus move both target this id. */
export const SURFACE_HEADING_ID = "surface-heading";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}

export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <div className="mb-section-gap flex items-start justify-between gap-4">
      <div className="min-w-0">
        {/* tabIndex -1 makes the heading a programmatic focus target: the shell persists across
         * navigation, so without this a keyboard user who activates a nav item stays on the nav
         * and has to tab through the whole chrome to reach content. */}
        <h1
          id={SURFACE_HEADING_ID}
          data-surface-heading=""
          tabIndex={-1}
          className={cn("text-h1 text-ink", focusRing)}
        >
          {title}
        </h1>
        {subtitle && <p className="mt-1 text-caption text-ink-dim">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
