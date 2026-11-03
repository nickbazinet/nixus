import { useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Sparkles } from "lucide-react";
import {
  Alert,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Skeleton,
} from "@nixus/shared";
import { CatalogNode } from "@/components/home/CatalogNode";
import { HOME_COMPOSER_PANEL_ID, HomeComposerPanel } from "@/components/home/HomeComposerPanel";
import { HomeGreeting } from "@/components/home/HomeGreeting";
import { AskHero } from "@/components/home/AskHero";
import { NeedsAttentionCard, RecommendedCard } from "@/components/home/HomeOverviewCards";
import { AtAGlance, QuickActions } from "@/components/home/AtAGlance";
import { useHomeComposer, useHomeComposerAccess, useHomeSurface } from "@/hooks/useHome";
import { useHomeAttention, useHomeRecommendations } from "@/hooks/useHomeOverview";
import { HOME_STARTER_KEYS } from "@/components/home/starters";
import type { HomeWidget } from "@/lib/types";

const MAX_WIDGETS = 12;

function WidgetCard({ widget }: { widget: HomeWidget }) {
  // The widget title is the card's heading; a root Card would only repeat it, so its children
  // render straight into this one.
  const root =
    widget.root.component === "Card" && !widget.root.unsupported
      ? { ...widget.root, component: "Column", title: null }
      : { ...widget.root, title: null };

  return (
    <Card data-testid="home-widget" data-widget-id={widget.id}>
      <CardHeader>
        <CardTitle>{widget.title}</CardTitle>
      </CardHeader>
      <CardContent>
        <CatalogNode node={root} fallbackLabel={widget.title} />
      </CardContent>
    </Card>
  );
}

function Section({
  title,
  aside,
  children,
  testId,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <section className="mt-section-gap" data-testid={testId}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-h3 text-ink">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** What fills "Your personalized insights" before anything is built: the shape of what is possible, not a void. */
function WidgetInvitation({ canAsk, onAsk }: { canAsk: boolean; onAsk: (text: string) => void }) {
  const { t } = useTranslation();
  return (
    <div
      className="grid gap-4 rounded-lg border border-dashed border-line-strong p-card-pad @3xl:grid-cols-[1fr_auto] @3xl:items-center"
      data-testid="home-empty"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand-ink"
        >
          <Sparkles className="size-4" />
        </span>
        <div>
          <p className="text-label text-ink">{t("home.empty.title")}</p>
          <p className="mt-0.5 text-caption text-ink-dim">{t("home.empty.body")}</p>
        </div>
      </div>
      {canAsk && (
        <div className="flex flex-wrap gap-2">
          {HOME_STARTER_KEYS.slice(0, 2).map((key) => (
            <Button key={key} size="sm" variant="outline" onClick={() => onAsk(t(key))}>
              {t(key)}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Home: AI first, but never only AI. The prompt sits on top; under it, the pre-built sections
 * answer the three questions a returning user brings — does anything need me, what should I do
 * next, how am I doing — and the widgets they asked for come last, as their own section. The
 * composer docks beside all of it: open is chat mode, closed is view mode.
 */
export function HomePage() {
  const { t } = useTranslation();
  const surface = useHomeSurface();
  const access = useHomeComposerAccess();
  // Owned here, not by the panel, so closing the panel keeps the conversation and any card still
  // waiting for a decision exactly where it was.
  const composer = useHomeComposer();
  // Always view mode on landing: Home opens on the dashboard, and chat mode is one click or one ask
  // away. Deliberately not remembered across visits.
  const [open, setOpenState] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);

  const widgets = surface.data ?? [];
  const accessState = access.isLoading ? undefined : (access.data ?? "unavailable");
  const canAsk = accessState === "available";
  const attention = useHomeAttention();
  const recommendations = useHomeRecommendations({
    canBuild: canAsk,
    widgetCount: surface.isSuccess ? widgets.length : -1,
  });

  const setOpen = (next: boolean) => {
    setOpenState(next);
    if (!next) toggleRef.current?.focus();
  };

  const ask = (text: string) => {
    setOpen(true);
    void composer.send(text);
  };

  return (
    <div className="flex h-full overflow-hidden">
      <div
        className="@container min-w-0 flex-1 overflow-y-auto overscroll-contain"
        data-testid="home-view"
      >
        <div className="mx-auto w-full max-w-[1280px] px-page-x py-page-y">
          <HomeGreeting attentionCount={attention.items.length} loading={attention.isLoading} />
          <AskHero access={accessState} busy={composer.busy} onAsk={ask} />
          <QuickActions />

          <div className="grid grid-cols-1 gap-4 @4xl:grid-cols-5">
            <div className="@4xl:col-span-3">
              <NeedsAttentionCard items={attention.items} loading={attention.isLoading} />
            </div>
            <div className="@4xl:col-span-2">
              <RecommendedCard
                recommendations={recommendations.recommendations}
                loading={recommendations.isLoading}
                onOpenComposer={() => setOpen(true)}
              />
            </div>
          </div>

          <Section title={t("home.glance.title")}>
            <AtAGlance />
          </Section>

          <Section
            title={t("home.widgets.title")}
            testId="home-widgets"
            aside={
              <div className="flex items-center gap-3">
                {widgets.length > 0 && (
                  <span className="text-caption text-ink-dim">
                    {t("home.widgets.count", { count: widgets.length, max: MAX_WIDGETS })}
                  </span>
                )}
                <Button
                  ref={toggleRef}
                  size="sm"
                  variant="outline"
                  aria-pressed={open}
                  aria-controls={HOME_COMPOSER_PANEL_ID}
                  onClick={() => setOpen(!open)}
                  className="aria-pressed:border-brand aria-pressed:bg-brand-soft aria-pressed:text-brand-ink"
                  data-testid="home-composer-toggle"
                >
                  <Sparkles aria-hidden="true" />
                  {t("home.panel.toggle")}
                </Button>
              </div>
            }
          >
            {surface.isLoading ? (
              <Skeleton rows={6} data-testid="home-surface-loading" />
            ) : surface.isError ? (
              <Alert variant="caution" data-testid="home-surface-error">
                <AlertTitle>{t("home.surface.loadFailed")}</AlertTitle>
              </Alert>
            ) : widgets.length === 0 ? (
              <WidgetInvitation canAsk={canAsk} onAsk={ask} />
            ) : (
              <div className="grid grid-cols-1 gap-4 @3xl:grid-cols-2" data-testid="home-surface">
                {widgets.map((widget) => (
                  <WidgetCard key={widget.id} widget={widget} />
                ))}
              </div>
            )}
          </Section>
        </div>
      </div>

      {open && <HomeComposerPanel composer={composer} onClose={() => setOpen(false)} />}
    </div>
  );
}
