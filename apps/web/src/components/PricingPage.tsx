import { Check, Minus } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Badge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
} from "@nixus/shared";

import { EditorialHeading } from "@/components/EditorialHeading";
import { PRIVACY_PAGE_PATHS, TERMS_PAGE_PATHS } from "@/components/LegalPage";
import { DownloadCTA } from "@/features/download/DownloadCTA";
import {
  PRICING_COLUMNS,
  PRICING_FEATURE_ROWS,
  rowIncludes,
  type PricingColumn,
  type PricingFeatureRow,
} from "@/content/pricing";
import { accountAppUrl, billingPlanUrl } from "@/lib/localePaths";
import type { LivePlanPrices } from "@/lib/planCatalog";
import { formatPlanAmount, resolvePlanPrice } from "@/lib/planPricing";
import { usePlanCatalog } from "@/lib/usePlanCatalog";
import type { Locale } from "@/lib/site";

/**
 * The pricing page.
 *
 * ## Baked first, live second
 *
 * Everything on this page renders from `content/pricing.ts` during prerender,
 * so the HTML a crawler and an offline visitor receive is complete and correct.
 * `usePlanCatalog` then replaces the amount, currency and interval of the two
 * Stripe-backed columns after hydration, which is what lets an operator move a
 * price in the Dashboard with no deploy (AD-6). Nothing else on the page is
 * live: the columns are fixed, and the checkmarks come from baked data so they
 * are right whether or not the API answers and so no checkmark can move under a
 * reader's cursor.
 *
 * ## Two presentations of one row set
 *
 * `PRICING_FEATURE_ROWS` is rendered twice — as a per-plan list inside each
 * card below the desktop tier, and as a comparison matrix at `lg` and up. Both
 * are always in the DOM and swapped with `hidden` / `lg:hidden` rather than
 * conditionally rendered, which is the pattern the header's download CTA
 * already uses: the prerendered markup is identical at every viewport, so
 * hydration sees the same tree, and `display: none` keeps the inactive one out
 * of the accessibility tree rather than read twice.
 *
 * A five-column matrix is unusable at 320px and a seven-row list per card is
 * noise next to a matrix, so each width gets the shape that works at that width
 * instead of one compromise that works at neither.
 */

const CTA_PRIMARY =
  "mkt-tap-cta inline-flex w-full items-center justify-center rounded-md bg-logo-gradient px-4 py-2 text-center text-sm font-medium text-primary-foreground outline-none transition-colors hover:brightness-110 focus-visible:ring-3 focus-visible:ring-primary/40";

const CTA_SECONDARY =
  "mkt-tap-cta inline-flex w-full items-center justify-center rounded-md border border-line-strong bg-card px-4 py-2 text-center text-sm font-medium text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50";

const LEGAL_LINK =
  "mkt-tap inline-flex items-center rounded-sm underline underline-offset-4 outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50";

/**
 * A checkmark or a dash, plus the word it stands for.
 *
 * The glyph is `aria-hidden` and the state travels as real text, because a
 * matrix whose only answer is an icon says nothing to a screen reader and
 * nothing under forced colors.
 */
function FeatureMark({ included }: { included: boolean }) {
  const { t } = useTranslation();
  const Glyph = included ? Check : Minus;

  return (
    <span className="inline-flex items-center justify-center">
      <Glyph
        aria-hidden="true"
        strokeWidth={included ? 2.25 : 2.5}
        className={cn(
          "size-4 shrink-0",
          included ? "text-brand-ink" : "text-muted-foreground",
        )}
      />
      <span className="sr-only">
        {t(included ? "pricing.compare.included" : "pricing.compare.notIncluded")}
      </span>
    </span>
  );
}

/** The site's existing marker for something advertised but not yet shipped. */
function ComingSoonBadge() {
  const { t } = useTranslation();
  return (
    <Badge variant="outline" className="px-2 font-medium">
      {t("pricing.compare.comingSoon")}
    </Badge>
  );
}

function FeatureLabel({
  row,
  withNote,
}: {
  row: PricingFeatureRow;
  withNote: boolean;
}) {
  const { t } = useTranslation();
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      {t(`pricing.row.${row.id}`)}
      {withNote && row.comingSoon === true ? <ComingSoonBadge /> : null}
    </span>
  );
}

function PlanCallToAction({
  column,
  locale,
}: {
  column: PricingColumn;
  locale: Locale;
}) {
  const { t } = useTranslation();

  if (column.callToAction === "download") {
    // The site's one download affordance, reused rather than restated: it owns
    // OS detection, the no-JS anchor fallback and the download analytics.
    return <DownloadCTA size="sm" variant="outline" className="w-full" />;
  }

  const href =
    column.callToAction === "signIn" || column.lookupKey === null
      ? accountAppUrl(locale)
      : billingPlanUrl(locale, column.lookupKey);

  return (
    <a
      href={href}
      data-testid="pricing-cta"
      data-plan={column.id}
      className={column.recommended ? CTA_PRIMARY : CTA_SECONDARY}
    >
      {t(`pricing.plan.${column.id}.cta`)}
    </a>
  );
}

function PlanPrice({
  column,
  locale,
  live,
}: {
  column: PricingColumn;
  locale: Locale;
  live: LivePlanPrices;
}) {
  const { t } = useTranslation();
  const price = resolvePlanPrice(column, live);

  // A column with no `lookup_key` has no Stripe Price and can never appear in
  // the catalog, so its figure is copy ("Free", "$0") rather than a formatted
  // amount. Only a column the catalog can actually move renders money.
  const isSubscription = column.lookupKey !== null;
  const figure = isSubscription
    ? formatPlanAmount(price, locale)
    : t(`pricing.plan.${column.id}.priceLabel`);
  const note = isSubscription
    ? price.interval === null
      ? ""
      : t(`pricing.interval.${price.interval}`)
    : t(`pricing.plan.${column.id}.priceNote`);

  return (
    <div className="mt-5">
      {/* `min-h` reserves the figure's line at every width, so replacing a baked
          amount with a live one cannot move anything below it. Not through
          `cn()`: tailwind-merge reads the unregistered `text-display-m` as a
          colour and would drop the type role. */}
      <p
        data-testid="pricing-amount"
        data-plan={column.id}
        className="text-display-m flex min-h-11 items-baseline text-foreground tabular-nums"
      >
        {figure}
      </p>
      <p
        data-testid="pricing-interval"
        className="min-h-5 text-sm text-muted-foreground"
      >
        {note}
      </p>
    </div>
  );
}

function PlanCard({
  column,
  locale,
  live,
}: {
  column: PricingColumn;
  locale: Locale;
  live: LivePlanPrices;
}) {
  const { t } = useTranslation();
  const headingId = `pricing-plan-${column.id}`;

  return (
    <article
      data-testid="pricing-plan"
      data-plan={column.id}
      data-recommended={column.recommended ? "true" : undefined}
      aria-labelledby={headingId}
      className={cn(
        // `w-full` is load-bearing: the `<li>` is a flex container, so without
        // it an article whose content is narrower than the track shrinks to its
        // content and the card ends up narrower than its siblings.
        "mkt-card flex h-full w-full flex-col border bg-card p-5 sm:p-6",
        column.recommended
          ? "mkt-rule-gradient border-primary/40 ring-1 ring-primary/25"
          : "border-border",
      )}
    >
      {/* Reserved on every card, not only the highlighted one, so the four plan
          names share one baseline across the row. */}
      <p className="flex min-h-6 items-start">
        {column.recommended ? (
          <Badge variant="brand" data-testid="pricing-recommended">
            {t("pricing.recommended")}
          </Badge>
        ) : null}
      </p>

      <h2 id={headingId} className="mt-2 text-lg font-semibold text-foreground">
        {t(`pricing.plan.${column.id}.name`)}
      </h2>
      {/* Reserved from the 2-up tier upward so the price figures share a
          baseline across the row. Two lines is the measured worst case in both
          locales at the narrowest 4-up card (286px); below `sm` the cards are
          stacked, where there is nothing to align to. */}
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground sm:min-h-[2.875rem]">
        {t(`pricing.plan.${column.id}.tagline`)}
      </p>

      <PlanPrice column={column} locale={locale} live={live} />

      <p
        data-testid="pricing-highlight"
        className="mt-4 text-sm leading-relaxed text-foreground sm:min-h-[2.875rem]"
      >
        {t(`pricing.plan.${column.id}.highlight`)}
      </p>

      <div className="mt-auto pt-6">
        <PlanCallToAction column={column} locale={locale} />
      </div>

      <ul
        role="list"
        aria-label={t("pricing.compare.planFeaturesAria")}
        className="mt-6 flex flex-col gap-2.5 border-t border-border pt-5 lg:hidden"
      >
        {PRICING_FEATURE_ROWS.map((row) => {
          const included = rowIncludes(row, column.id);
          return (
            <li key={row.id} className="flex items-start gap-2.5 text-sm">
              <span className="mt-0.5">
                <FeatureMark included={included} />
              </span>
              <span
                className={
                  included ? "text-foreground" : "text-muted-foreground"
                }
              >
                <FeatureLabel row={row} withNote={included} />
              </span>
            </li>
          );
        })}
      </ul>
    </article>
  );
}

function ComparisonTable() {
  const { t } = useTranslation();

  return (
    <Table data-testid="pricing-compare-table" className="text-sm">
      <caption className="sr-only">{t("pricing.compare.tableLabel")}</caption>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="w-[32%] text-foreground">
            {t("pricing.compare.featureColumn")}
          </TableHead>
          {PRICING_COLUMNS.map((column) => (
            <TableHead
              key={column.id}
              data-plan={column.id}
              className={cn(
                "w-[17%] text-center whitespace-normal text-foreground",
                column.recommended && "bg-accent/50",
              )}
            >
              <span className="block font-semibold">
                {t(`pricing.plan.${column.id}.name`)}
              </span>
              {/* The highlighted column is marked by words here as well as by
                  tint, so the distinction does not rest on colour alone. */}
              {column.recommended ? (
                <span className="mt-1 block text-xs font-medium text-brand-ink">
                  {t("pricing.recommended")}
                </span>
              ) : null}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {PRICING_FEATURE_ROWS.map((row) => (
          <TableRow key={row.id} data-row={row.id}>
            <TableHead
              scope="row"
              className="font-normal whitespace-normal text-foreground"
            >
              <FeatureLabel row={row} withNote />
            </TableHead>
            {PRICING_COLUMNS.map((column) => (
              <TableCell
                key={column.id}
                data-plan={column.id}
                className={cn(
                  "text-center",
                  column.recommended && "bg-accent/50",
                )}
              >
                <FeatureMark included={rowIncludes(row, column.id)} />
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function PricingPage({ locale }: { locale: Locale }) {
  const { t } = useTranslation();
  const { prices } = usePlanCatalog();

  return (
    <div data-testid="pricing-page" className="mkt-section-y bg-background">
      <div className="mkt-page-x mkt-container">
        <header className="mkt-section-lead mkt-measure-prose">
          <EditorialHeading
            id="pricing-heading"
            level="h1"
            align="left"
            rule={false}
            eyebrow={t("pricing.eyebrow")}
            heading={t("pricing.heading")}
            description={t("pricing.lead")}
          />
        </header>

        <section aria-label={t("pricing.plansAria")}>
          <ul
            role="list"
            className="grid grid-cols-1 gap-5 sm:grid-cols-2 sm:gap-6 xl:grid-cols-4"
          >
            {PRICING_COLUMNS.map((column) => (
              <li key={column.id} className="flex">
                <PlanCard column={column} locale={locale} live={prices} />
              </li>
            ))}
          </ul>
        </section>

        <section
          id="compare"
          aria-labelledby="pricing-compare-heading"
          className="mt-16 hidden md:mt-24 lg:block"
        >
          <div aria-hidden="true" className="mkt-rule" />
          <h2
            id="pricing-compare-heading"
            className="text-xl font-semibold text-foreground"
          >
            {t("pricing.compare.heading")}
          </h2>
          <p className="mkt-measure-prose mt-3 text-sm leading-relaxed text-muted-foreground">
            {t("pricing.compare.lead")}
          </p>
          <div className="mt-8">
            <ComparisonTable />
          </div>
        </section>

        <aside
          data-testid="pricing-footnote"
          aria-labelledby="pricing-footnote-heading"
          className="mkt-measure-prose mt-16 md:mt-20"
        >
          <div aria-hidden="true" className="mkt-rule" />
          <h2
            id="pricing-footnote-heading"
            className="text-lg font-semibold text-foreground"
          >
            {t("pricing.footnote.heading")}
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
            {t("pricing.footnote.currency")}
          </p>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
            {t("pricing.footnote.legalIntro")}
          </p>
          <p className="mt-2 flex flex-wrap items-center gap-x-6 text-sm text-muted-foreground">
            <a href={TERMS_PAGE_PATHS[locale]} className={LEGAL_LINK}>
              {t("footer.linkTerms")}
            </a>
            <a href={PRIVACY_PAGE_PATHS[locale]} className={LEGAL_LINK}>
              {t("footer.linkPrivacy")}
            </a>
          </p>
        </aside>
      </div>
    </div>
  );
}
