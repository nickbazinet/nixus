import { useTranslation } from "react-i18next";
import { Eyebrow, focusRing, formatMoney } from "@nixus/shared";
import { cn } from "@/lib/utils";
import { SURFACE_HEADING_ID } from "@/components/shared/PageHeader";
import { useSignedInFirstName } from "@/hooks/useAuth";
import { useBudgetSummary } from "@/hooks/useDashboard";
import { useYearlySummary } from "@/hooks/useYearlySummary";
import { useValuesHidden } from "@/contexts/ValuesVisibilityContext";
import { currentMonth } from "@/hooks/useHomeOverview";
import { currencyLocale } from "@/lib/formatCurrency";

function partOfDay(hour: number): "morning" | "afternoon" | "evening" {
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

/** A sentinel that cannot occur in either locale's copy, so the split is unambiguous. */
const NAME_SLOT = "\u0000";

/**
 * The greeting with the user's own name painted in the brand gradient. The name is interpolated
 * into the localized sentence rather than concatenated onto it — French puts the comma and the
 * trailing period in different places — so the string is rendered once with a sentinel and split
 * on it. The heading's text is byte-for-byte what the single translation says.
 */
function Greeting({ part, name }: { part: string; name: string | null }) {
  const { t } = useTranslation();

  if (!name) return <>{t(`home.greeting.${part}`)}</>;

  const [before, after = ""] = t(`home.greeting.${part}Name`, { name: NAME_SLOT }).split(
    NAME_SLOT,
  );
  return (
    <>
      {before}
      <span className="text-gradient">{name}</span>
      {after}
    </>
  );
}

/**
 * Home's opening line: today's date as the kicker, the welcome in display type with the name in
 * the brand gradient, and one sentence of where the user actually stands. The status pill beside
 * it answers "is anything wrong?" before a single card is read, and jumps to the list that backs
 * it, so the count is never a dead number.
 */
export function HomeGreeting({
  attentionCount,
  loading,
}: {
  attentionCount: number;
  loading: boolean;
}) {
  const { t, i18n } = useTranslation();
  const name = useSignedInFirstName();
  const { hidden, maskProps } = useValuesHidden();
  const { year, month } = currentMonth();
  const budget = useBudgetSummary(year, month);
  const yearly = useYearlySummary(year);

  const now = new Date();
  const part = partOfDay(now.getHours());
  const date = new Intl.DateTimeFormat(i18n.language, {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(now);

  const locale = currencyLocale(i18n.language);
  const money = (cents: number, sign?: "always") =>
    hidden ? maskProps.maskedLabel : formatMoney({ cents, locale, sign });

  const summary = budget.data;
  // `??` rather than a truthiness check: the IPC layer answers `null` for a profile with no
  // budget at all, and `null.total_target_cents` is the crash that takes the whole greeting down.
  const hasBudget = (summary?.total_target_cents ?? 0) > 0;
  const remaining = summary?.remaining_cents ?? 0;
  const gain =
    yearly.data?.net_worth_gain_available && yearly.data.net_worth_gain_cents !== null
      ? yearly.data.net_worth_gain_cents
      : null;

  // Each branch states only what the data supports. No budget and no recorded gain leaves the
  // plain line rather than a sentence built from zeroes.
  const subtitle = (() => {
    if (hasBudget && remaining < 0) {
      return t("home.v2.subtitleOverBudget", { amount: money(Math.abs(remaining)) });
    }
    if (hasBudget && gain !== null) {
      return t("home.v2.subtitleBudgetAndGain", {
        remaining: money(remaining),
        gain: money(gain, "always"),
      });
    }
    if (hasBudget) return t("home.v2.subtitleBudgetOnly", { remaining: money(remaining) });
    if (gain !== null) return t("home.v2.subtitleGainOnly", { gain: money(gain, "always") });
    return t("home.v2.subtitlePlain");
  })();

  const allClear = attentionCount === 0;

  return (
    <div
      className="mb-section-gap flex flex-wrap items-start justify-between gap-x-6 gap-y-4"
      data-testid="home-greeting"
    >
      <div className="min-w-0">
        <Eyebrow className="mb-2.5">{date}</Eyebrow>
        <h1
          id={SURFACE_HEADING_ID}
          data-surface-heading=""
          tabIndex={-1}
          className={cn("text-display text-ink", focusRing)}
        >
          <Greeting part={part} name={name} />
        </h1>
        <p className="mt-2 max-w-3xl text-body text-ink-dim">{subtitle}</p>
      </div>
      {!loading && (
        <a
          href="#home-attention"
          className={cn(
            "inline-flex shrink-0 items-center gap-2 rounded-full border border-line bg-card px-3.5 py-2 text-caption text-ink no-underline hover:bg-hover",
            focusRing
          )}
          data-testid="home-status-pill"
        >
          <span
            aria-hidden="true"
            className={cn(
              "size-[7px] rounded-full",
              allClear ? "bg-good" : "border-[1.5px] border-caution"
            )}
          />
          {allClear ? t("home.status.allClear") : t("home.status.attention", { count: attentionCount })}
        </a>
      )}
    </div>
  );
}
