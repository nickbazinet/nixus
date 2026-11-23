import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, Link } from "@tanstack/react-router";
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Landmark,
  Lightbulb,
  TriangleAlert,
  Upload,
  Wallet,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
  IconChip,
  Skeleton,
  focusRing,
} from "@nixus/shared";
import { cn } from "@/lib/utils";
import type { AttentionItem, HomeRoute, Recommendation } from "@/hooks/useHomeOverview";

/**
 * Which door a row opens, said in the words of that door. Nothing here invents an action the app
 * cannot perform — "Mark as paid" would be a button with nothing behind it — so every row's label
 * names the screen where the thing is actually fixed.
 */
const ROUTE_PRESENTATION: Record<HomeRoute, { icon: LucideIcon; labelKey: string }> = {
  "/spending/budget": { icon: Wallet, labelKey: "home.v2.review" },
  "/car/garage": { icon: Wrench, labelKey: "home.glance.openCar" },
  "/car": { icon: Wrench, labelKey: "home.glance.openCar" },
  "/wealth/accounts": { icon: Landmark, labelKey: "home.recommend.netWorthCta" },
  "/wealth/where-to-put-your-money": {
    icon: Lightbulb,
    labelKey: "financialHealth.card.seeThePlan",
  },
  "/import": { icon: Upload, labelKey: "home.quick.import" },
};

/**
 * One thing that needs the user. The whole row is the single activation target — the pill at its
 * end is painted, not clickable, because a button nested inside a button is two targets for one
 * outcome and a keyboard user has to discover which of them does the thing.
 */
function AttentionItemRow({ item }: { item: AttentionItem }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const presentation = ROUTE_PRESENTATION[item.to];
  const Icon = item.status === "over" ? TriangleAlert : (presentation?.icon ?? Calendar);

  return (
    <button
      type="button"
      onClick={() => void navigate({ to: item.to })}
      aria-label={`${item.name}, ${item.detail}`}
      className={cn(
        "flex w-full items-center gap-3 border-b border-line py-3.5 text-left last:border-b-0 hover:bg-hover",
        focusRing
      )}
      data-testid="home-attention-item"
    >
      <span aria-hidden="true" className="contents">
        <IconChip icon={Icon} size="sm" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-label text-ink">{item.name}</span>
          <span
            className={cn(
              "block truncate text-caption",
              item.status === "over" ? "text-over-ink" : "text-ink-dim"
            )}
          >
            {item.detail}
          </span>
        </span>
        <span className="shrink-0 rounded-full border border-line-strong px-3 py-1 text-caption text-ink">
          {t(presentation?.labelKey ?? "home.v2.review")}
        </span>
      </span>
    </button>
  );
}

/** Home's "alerts" list: what is over, due or going stale, worst first. Each row opens where it's fixed. */
export function NeedsAttentionCard({
  items,
  loading,
}: {
  items: AttentionItem[];
  loading: boolean;
}) {
  const { t } = useTranslation();

  return (
    <Card id="home-attention" className="h-full scroll-mt-4" data-testid="home-attention">
      <CardHeader>
        <CardTitle icon={TriangleAlert}>{t("home.attention.title")}</CardTitle>
        {!loading && items.length > 0 && (
          <CardAction>
            <Badge variant="caution" data-testid="home-attention-count">
              {t("home.v2.things", { count: items.length })}
            </Badge>
          </CardAction>
        )}
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
          <div className="max-h-80 overflow-y-auto">
            {items.map((item) => (
              <AttentionItemRow key={item.id} item={item} />
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
  const icon = current && current.to !== "composer" ? ROUTE_PRESENTATION[current.to]?.icon : undefined;

  return (
    <Card className="h-full" data-testid="home-recommended">
      <CardHeader>
        <CardTitle icon={Lightbulb}>{t("home.recommend.title")}</CardTitle>
        <CardAction>
          <Badge variant="brand">{t("home.v2.basedOnYourNumbers")}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="flex h-full flex-col gap-4">
        {loading ? (
          <Skeleton rows={3} />
        ) : !current ? (
          <p className="py-4 text-caption text-ink-dim">{t("home.recommend.none")}</p>
        ) : (
          <>
            <div className="flex items-start gap-3">
              <IconChip icon={icon ?? Lightbulb} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="text-label text-ink" data-testid="home-recommended-title">
                  {current.title}
                </p>
                <p className="mt-1 text-caption text-ink-dim">{current.body}</p>
              </div>
            </div>
            {current.to === "composer" ? (
              <Button className="mt-auto w-fit" onClick={onOpenComposer}>
                {current.ctaLabel}
                <ChevronRight data-icon="inline-end" aria-hidden="true" />
              </Button>
            ) : (
              <Button className="mt-auto w-fit" render={<Link to={current.to} />}>
                {current.ctaLabel}
                <ChevronRight data-icon="inline-end" aria-hidden="true" />
              </Button>
            )}
          </>
        )}
      </CardContent>
      {count > 1 && (
        <CardContent className="flex items-center gap-1 border-t border-line pt-4">
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
        </CardContent>
      )}
    </Card>
  );
}
