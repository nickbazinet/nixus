import type { ReactNode } from "react";
import { cn } from "@nixus/shared";

/** The five parts of the account page, in menu order. Each is also its URL hash. */
export const ACCOUNT_SECTIONS = ["personal", "subscription", "payment", "invoices", "signin"] as const;

export type AccountSectionId = (typeof ACCOUNT_SECTIONS)[number];

export function sectionFromHash(hash: string): AccountSectionId | null {
  const value = hash.replace(/^#/, "");
  return (ACCOUNT_SECTIONS as readonly string[]).includes(value)
    ? (value as AccountSectionId)
    : null;
}

/**
 * One white card on the account page. Every section is rendered and the
 * inactive ones are `hidden`, so an unsaved draft or a status message survives
 * a trip to another section and back.
 *
 * The element id is prefixed so a `#subscription` hash never matches it: the
 * browser would otherwise scroll the page to the card on load.
 */
export function AccountSection({
  id,
  active,
  title,
  description,
  children,
}: {
  readonly id: AccountSectionId;
  readonly active: boolean;
  readonly title: string;
  readonly description?: string;
  readonly children: ReactNode;
}) {
  return (
    <section
      id={`section-${id}`}
      data-testid={`section-${id}`}
      aria-labelledby={`section-${id}-title`}
      hidden={!active}
      className="rounded-2xl border border-line bg-card p-5 shadow-[0_1px_2px_rgba(18,18,42,0.04)] sm:p-8"
    >
      <h2
        id={`section-${id}-title`}
        className="font-display text-xl font-semibold tracking-[-0.015em] text-ink"
      >
        {title}
      </h2>
      {description ? <p className="mt-1.5 text-body text-ink-dim">{description}</p> : null}
      <div className="mt-6">{children}</div>
    </section>
  );
}

/** A label-and-detail row with its action on the right, separated by a hairline. */
export function SectionRow({
  title,
  detail,
  action,
  className,
  children,
}: {
  readonly title?: ReactNode;
  readonly detail?: ReactNode;
  readonly action?: ReactNode;
  readonly className?: string;
  readonly children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 border-t border-line py-5 first:border-t-0 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-6",
        className,
      )}
    >
      <div className="min-w-0">
        {title ? <p className="text-body font-semibold text-ink">{title}</p> : null}
        {detail ? <div className="mt-0.5 text-caption text-ink-dim">{detail}</div> : null}
        {children}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/** The pill-shaped outline button the account page uses for every secondary action. */
export const PILL_BUTTON_CLASS = "mkt-tap h-10 rounded-full px-5 font-semibold";
