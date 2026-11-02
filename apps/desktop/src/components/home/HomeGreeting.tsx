import { useTranslation } from "react-i18next";
import { focusRing } from "@nixus/shared";
import { cn } from "@/lib/utils";
import { SURFACE_HEADING_ID } from "@/components/shared/PageHeader";
import { useSignedInFirstName } from "@/hooks/useAuth";

function partOfDay(hour: number): "morning" | "afternoon" | "evening" {
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

/**
 * The welcome line and the one status pill that answers "is anything wrong?" before the user reads
 * a single card. The pill jumps to the list that backs it, so the count is never a dead number.
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
  const now = new Date();
  const part = partOfDay(now.getHours());
  const date = new Intl.DateTimeFormat(i18n.language, {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(now);

  const allClear = attentionCount === 0;

  return (
    <div className="mb-5 flex items-start justify-between gap-4" data-testid="home-greeting">
      <div className="min-w-0">
        <h1
          id={SURFACE_HEADING_ID}
          data-surface-heading=""
          tabIndex={-1}
          className={cn("text-h1 text-ink", focusRing)}
        >
          {name
            ? t(`home.greeting.${part}Name`, { name })
            : t(`home.greeting.${part}`)}
        </h1>
        <p className="mt-1 text-caption text-ink-dim">{t("home.greeting.subtitle", { date })}</p>
      </div>
      {!loading && (
        <a
          href="#home-attention"
          className={cn(
            "inline-flex shrink-0 items-center gap-2 rounded-md border border-line bg-card px-3 py-1.5 text-caption text-ink hover:bg-hover",
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
