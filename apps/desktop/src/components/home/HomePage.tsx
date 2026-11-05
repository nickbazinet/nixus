import { useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronLeft,
  ChevronRight,
  FoldHorizontal,
  GripVertical,
  Palette,
  RotateCcw,
  Sparkles,
  Trash2,
  UnfoldHorizontal,
} from "lucide-react";
import { toast } from "sonner";
import {
  Alert,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Skeleton,
  focusRing,
} from "@nixus/shared";
import { CatalogNode } from "@/components/home/CatalogNode";
import { HOME_COMPOSER_PANEL_ID, HomeComposerPanel } from "@/components/home/HomeComposerPanel";
import { HomeGreeting } from "@/components/home/HomeGreeting";
import { AskHero } from "@/components/home/AskHero";
import { NeedsAttentionCard, RecommendedCard } from "@/components/home/HomeOverviewCards";
import { AtAGlance, QuickActions } from "@/components/home/AtAGlance";
import {
  HOME_WIDGET_TITLE_MAX_LENGTH,
  useDeleteHomeWidget,
  useHomeComposer,
  useHomeComposerAccess,
  useHomeSurface,
  useRenameHomeWidget,
  useSetHomeWidgetAccent,
  useSetHomeWidgetSpan,
} from "@/hooks/useHome";
import { useHomeWidgetReorder } from "@/hooks/useHomeWidgetReorder";
import { useHomeAttention, useHomeRecommendations } from "@/hooks/useHomeOverview";
import { HOME_STARTER_KEYS } from "@/components/home/starters";
import { homeInsightsAllowed } from "@/lib/homeSurface";
import { CHART_RAMP } from "@/components/spending-trends/insights-chart";
import { cn } from "@/lib/utils";
import type { HomeWidget } from "@/lib/types";

const MAX_WIDGETS = 12;

const ACCENT_OFFSETS = CHART_RAMP.map((_, offset) => offset);

/**
 * The accent picker. Its copy is deliberately about where the palette STARTS rather than about
 * "the chart's colour": for a single series that is the same sentence, but for a pie or a
 * multi-series chart the offset only rotates the ramp, and promising per-series control would be
 * a lie the next chart breaks.
 */
function AccentPicker({
  accent,
  onPick,
}: {
  accent: number | null;
  onPick: (accent: number | null) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const pick = (next: number | null) => {
    setOpen(false);
    onPick(next);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={t("home.customize.accent")}
            data-testid="widget-accent-trigger"
          />
        }
      >
        <Palette aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3" data-testid="widget-accent-popover">
        <p className="text-label text-ink">{t("home.customize.accentTitle")}</p>
        <p className="mt-0.5 text-caption text-ink-dim">{t("home.customize.accentHelp")}</p>
        <div
          className="mt-2.5 grid grid-cols-8 gap-1"
          role="group"
          aria-label={t("home.customize.accentTitle")}
        >
          {ACCENT_OFFSETS.map((offset) => (
            <button
              key={offset}
              type="button"
              onClick={() => pick(offset)}
              aria-pressed={accent === offset}
              aria-label={t("home.customize.accentSwatch", { number: offset + 1 })}
              style={{ backgroundColor: CHART_RAMP[offset] }}
              className={cn(
                "size-6 rounded-md border",
                focusRing,
                accent === offset ? "border-ink" : "border-line"
              )}
              data-testid={`widget-accent-${offset}`}
            />
          ))}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="mt-2.5 w-full justify-start text-ink-dim"
          onClick={() => pick(null)}
          disabled={accent === null}
          aria-disabled={accent === null || undefined}
          data-testid="widget-accent-reset"
        >
          <RotateCcw aria-hidden="true" />
          {t("home.customize.accentReset")}
        </Button>
      </PopoverContent>
    </Popover>
  );
}

interface WidgetCardProps {
  widget: HomeWidget;
  index: number;
  count: number;
  isDragSource: boolean;
  isDragOver: boolean;
  cardRef: (el: HTMLElement | null) => void;
  onDragHandlePointerDown: (event: React.PointerEvent) => void;
  onMove: (delta: number) => void;
}

function WidgetCard({
  widget,
  index,
  count,
  isDragSource,
  isDragOver,
  cardRef,
  onDragHandlePointerDown,
  onMove,
}: WidgetCardProps) {
  const { t } = useTranslation();
  const [renaming, setRenaming] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [draft, setDraft] = useState(widget.title);
  const rename = useRenameHomeWidget();
  const setSpan = useSetHomeWidgetSpan();
  const setAccent = useSetHomeWidgetAccent();
  const deleteWidget = useDeleteHomeWidget();

  // The widget title is the card's heading; a root Card would only repeat it, so its children
  // render straight into this one.
  const root =
    widget.root.component === "Card" && !widget.root.unsupported
      ? { ...widget.root, component: "Column", title: null }
      : { ...widget.root, title: null };

  const full = widget.span === 2;

  const commitRename = (title: string | null) => {
    setRenaming(false);
    rename.mutate(
      { widget_id: widget.id, title },
      { onError: () => toast.error(t("home.customize.renameFailed")) }
    );
  };

  const saveRename = () => {
    const trimmed = draft.trim();
    const next = trimmed === "" ? null : trimmed.slice(0, HOME_WIDGET_TITLE_MAX_LENGTH);
    // Typing the title that is already showing is not an edit — neither spelling of it should cost
    // a write and a full surface re-resolve.
    if (next === null ? widget.title_override === null : next === widget.title) {
      setRenaming(false);
      return;
    }
    commitRename(next);
  };

  const startRename = () => {
    setDraft(widget.title);
    setRenaming(true);
  };

  return (
    <div
      ref={cardRef}
      // `@3xl:` only: below that breakpoint the grid is already one column, so a full-width widget
      // is indistinguishable from a half-width one and the span must not leak into the narrow
      // layout as a stray `col-span-2` against a single track.
      className={cn(
        "min-w-0 rounded-lg transition-opacity",
        full && "@3xl:col-span-2",
        isDragSource && "opacity-40",
        isDragOver && "ring-2 ring-brand"
      )}
      data-testid="home-widget-slot"
      data-widget-span={widget.span}
    >
      <Card
        className="group/widget h-full"
        data-testid="home-widget"
        data-widget-id={widget.id}
      >
        <CardHeader>
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
              {/* Hidden while renaming: the header grows to two rows, and a grab handle beside a
                * form it cannot act on only drags the layout out of alignment. */}
              {count > 1 && !renaming && (
                <span
                  onPointerDown={onDragHandlePointerDown}
                  className="shrink-0 touch-none cursor-grab select-none text-ink-faint opacity-0 transition-opacity group-hover/widget:opacity-100 group-focus-within/widget:opacity-100 hover:text-ink-dim active:cursor-grabbing"
                  aria-hidden="true"
                  data-testid="widget-drag-handle"
                >
                  <GripVertical className="size-4" aria-hidden="true" />
                </span>
              )}
              {renaming ? (
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <Input
                    autoFocus
                    value={draft}
                    maxLength={HOME_WIDGET_TITLE_MAX_LENGTH}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        saveRename();
                      } else if (event.key === "Escape") {
                        event.preventDefault();
                        setRenaming(false);
                      }
                    }}
                    aria-label={t("home.customize.titleLabel")}
                    className="h-7"
                    data-testid="widget-title-input"
                  />
                  <div className="flex flex-wrap items-center gap-1">
                    <Button size="xs" onClick={saveRename} data-testid="widget-title-save">
                      {t("common.save")}
                    </Button>
                    <Button size="xs" variant="ghost" onClick={() => setRenaming(false)}>
                      {t("common.cancel")}
                    </Button>
                    {/* Only offered once there is something to go back to. */}
                    {widget.title_override !== null && (
                      <Button
                        size="xs"
                        variant="ghost"
                        className="text-ink-dim"
                        onClick={() => commitRename(null)}
                        data-testid="widget-title-reset"
                      >
                        {t("home.customize.titleReset")}
                      </Button>
                    )}
                  </div>
                </div>
              ) : (
                <CardTitle className="min-w-0 flex-1">
                  {/* The dotted underline is the resting affordance, as everywhere else an inline
                    * edit is offered: a hover-only pencil never reaches a keyboard-only user. */}
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={startRename}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        startRename();
                      }
                    }}
                    aria-label={t("home.customize.renameWidget", { title: widget.title })}
                    className={cn(
                      "inline-flex max-w-full cursor-pointer items-center border-b border-dotted border-line-strong text-left transition-colors hover:text-ink-dim",
                      focusRing
                    )}
                    data-testid="widget-title"
                  >
                    {widget.title}
                  </span>
                </CardTitle>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover/widget:opacity-100 group-focus-within/widget:opacity-100">
              {count > 1 && (
                <div
                  className="flex items-center gap-0.5"
                  role="group"
                  aria-label={t("home.customize.reorderGroup")}
                >
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    disabled={index === 0}
                    aria-disabled={index === 0 || undefined}
                    onClick={() => onMove(-1)}
                    aria-label={t("home.customize.moveEarlier")}
                    data-testid="widget-move-earlier"
                  >
                    <ChevronLeft aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    disabled={index === count - 1}
                    aria-disabled={index === count - 1 || undefined}
                    onClick={() => onMove(1)}
                    aria-label={t("home.customize.moveLater")}
                    data-testid="widget-move-later"
                  >
                    <ChevronRight aria-hidden="true" />
                  </Button>
                </div>
              )}
              <Button
                variant="ghost"
                size="icon-xs"
                aria-pressed={full}
                onClick={() =>
                  setSpan.mutate(
                    { widget_id: widget.id, span: full ? 1 : 2 },
                    { onError: () => toast.error(t("home.customize.widthFailed")) }
                  )
                }
                aria-label={t("home.customize.fullWidth")}
                className="aria-pressed:bg-brand-soft aria-pressed:text-brand-ink"
                data-testid="widget-span-toggle"
              >
                {full ? (
                  <FoldHorizontal aria-hidden="true" />
                ) : (
                  <UnfoldHorizontal aria-hidden="true" />
                )}
              </Button>
              <AccentPicker
                accent={widget.accent}
                onPick={(accent) =>
                  setAccent.mutate(
                    { widget_id: widget.id, accent },
                    { onError: () => toast.error(t("home.customize.accentFailed")) }
                  )
                }
              />
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => setConfirmingDelete(true)}
                aria-label={t("home.customize.removeWidget", { title: widget.title })}
                className="text-ink-dim hover:text-over-ink"
                data-testid="widget-delete"
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <CatalogNode
            node={root}
            fallbackLabel={widget.title}
            accent={widget.accent ?? undefined}
          />
        </CardContent>
      </Card>

      <Dialog
        open={confirmingDelete}
        onOpenChange={(open) => {
          if (!open) setConfirmingDelete(false);
        }}
      >
        <DialogContent data-testid="widget-delete-dialog">
          <DialogHeader>
            <DialogTitle className="text-over-ink">
              {t("home.customize.deleteTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("home.customize.deleteBody", { title: widget.title })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmingDelete(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmingDelete(false);
                deleteWidget.mutate(
                  { widget_id: widget.id },
                  { onError: () => toast.error(t("home.customize.deleteFailed")) }
                );
              }}
              data-testid="widget-delete-confirm"
            >
              {t("common.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
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
  const { orderedWidgets, drag, setCardRef, beginPointerDrag, moveBy } =
    useHomeWidgetReorder(surface.data);
  const accessState = access.isLoading ? undefined : (access.data ?? "unavailable");
  const canAsk = accessState === "available" || accessState === "available_byo";
  const showInsights = homeInsightsAllowed(accessState);
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
          <AskHero
            access={accessState}
            busy={composer.busy}
            onAsk={ask}
            onRetry={() => void access.refetch()}
          />
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

          {showInsights && (
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
                  {orderedWidgets.map((widget, index) => (
                    <WidgetCard
                      key={widget.id}
                      widget={widget}
                      index={index}
                      count={orderedWidgets.length}
                      cardRef={setCardRef(index)}
                      onDragHandlePointerDown={beginPointerDrag(index)}
                      onMove={(delta) => moveBy(index, delta)}
                      isDragSource={drag?.from === index}
                      isDragOver={drag !== null && drag.over === index && drag.from !== index}
                    />
                  ))}
                </div>
              )}
            </Section>
          )}
        </div>
      </div>

      {open && showInsights && <HomeComposerPanel composer={composer} onClose={() => setOpen(false)} />}
    </div>
  );
}
