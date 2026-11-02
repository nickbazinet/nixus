import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, CircleCheck } from "lucide-react";
import {
  AttentionRow,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Skeleton,
  buttonVariants,
} from "@nixus/shared";
import { cn } from "@/lib/utils";
import { Link } from "@tanstack/react-router";
import type { AttentionItem, Recommendation } from "@/hooks/useHomeOverview";

/** Home's "alerts" list: what is over, due or going stale, worst first. Each row opens where it's fixed. */
export function NeedsAttentionCard({
  items,
  loading,
}: {
  items: AttentionItem[];
  loading: boolean;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <Card id="home-attention" className="scroll-mt-4" data-testid="home-attention">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {t("home.attention.title")}
          {!loading && items.length > 0 && (
            <Badge variant="caution" data-testid="home-attention-count">
              {items.length}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton rows={4} />
        ) : items.length === 0 ? (
          <div className="flex items-center gap-3 py-4" data-testid="home-attention-clear">
            <CircleCheck className="size-5 shrink-0 text-good" aria-hidden="true" />
            <div>
              <p className="text-label text-ink">{t("home.attention.clearTitle")}</p>
              <p className="text-caption text-ink-dim">{t("home.attention.clearBody")}</p>
            </div>
          </div>
        ) : (
          <div className="max-h-64 overflow-y-auto pr-1">
            {items.map((item) => (
              <AttentionRow
                key={item.id}
                status={item.status}
                name={item.name}
                figure={item.detail}
                accessibleName={`${item.name}, ${item.detail}`}
                onActivate={() => void navigate({ to: item.to })}
                data-testid="home-attention-item"
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** One suggested next move at a time, paged — a stack of five nudges reads as nagging. */
export function RecommendedCard({
  recommendations,
  loading,
  onOpenComposer,
}: {
  recommendations: Recommendation[];
  loading: boolean;
  onOpenComposer: () => void;
}) {
  const { t } = useTranslation();
  const [index, setIndex] = useState(0);
  const count = recommendations.length;
  const current = recommendations[Math.min(index, Math.max(count - 1, 0))];

  return (
    <Card className="border-l-[3px] border-l-brand" data-testid="home-recommended">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>{t("home.recommend.title")}</CardTitle>
        {count > 1 && (
          <div className="flex items-center gap-1">
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={t("home.recommend.previous")}
              onClick={() => setIndex((i) => (i - 1 + count) % count)}
            >
              <ChevronLeft aria-hidden="true" />
            </Button>
            <span className="text-caption text-ink-dim" aria-live="polite">
              {t("home.recommend.position", { current: index + 1, total: count })}
            </span>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={t("home.recommend.next")}
              onClick={() => setIndex((i) => (i + 1) % count)}
              data-testid="home-recommended-next"
            >
              <ChevronRight aria-hidden="true" />
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {loading ? (
          <Skeleton rows={3} />
        ) : !current ? (
          <p className="py-4 text-caption text-ink-dim">{t("home.recommend.none")}</p>
        ) : (
          <>
            <Badge variant="brand" className="w-fit">
              {t("home.recommend.badge")}
            </Badge>
            <p className="text-h2 text-ink" data-testid="home-recommended-title">
              {current.title}
            </p>
            <p className="text-caption text-ink-dim">{current.body}</p>
            {current.to === "composer" ? (
              <Button className="w-fit" onClick={onOpenComposer}>
                {current.ctaLabel}
                <ChevronRight aria-hidden="true" />
              </Button>
            ) : (
              <Link to={current.to} className={cn(buttonVariants(), "w-fit")}>
                {current.ctaLabel}
                <ChevronRight aria-hidden="true" />
              </Link>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
