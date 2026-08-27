/**
 * AIDemo (Story 3.2) — the defining marketing experience.
 *
 * A visitor scrolls past the hero and sees a Tangerine-style credit-card
 * statement on the left get parsed and re-laid-out as categorized
 * transactions on the right in ~3 seconds. No copy required: the visual
 * carries the AI auto-import promise.
 *
 * Architecture decisions baked in here:
 *   - Animation tech is **CSS keyframes on real DOM** (architecture step
 *     4). No Lottie, no MP4, no GIF: smaller payload, fully styleable,
 *     accessible by default, and the reduced-motion fallback is one
 *     `@media (prefers-reduced-motion: reduce)` block away. Keyframes
 *     live in the co-located `AIDemo.css` (kept under ~5 KB target).
 *   - The animation is gated on `ai-demo--animated`, set by an
 *     IntersectionObserver in this component. The static composition
 *     renders on first paint, so the demo is instantly meaningful even
 *     to no-JS visitors and to anyone whose IO never fires (e.g. some
 *     test environments). The motion is a *bonus* on top of a complete
 *     static "before/after".
 *   - The first render is identical on the server and in the browser
 *     (un-animated) so hydration cannot mismatch on the gating class;
 *     the effect below turns the animation on after mount.
 *   - Skeleton state intentionally omitted: this is a pure-React
 *     component with no async data, so the static "after" composition
 *     IS its skeleton — no layout shift can happen because we never
 *     swap content in.
 *
 * Accessibility:
 *   - Wrapped in a `<figure>` with a descriptive `aria-label` so screen
 *     readers get a single, summary-style announcement instead of
 *     trying to read every transaction line.
 *   - Nothing inside is keyboard-focusable. There are no anchors,
 *     buttons, or `tabIndex` attributes, so a `Tab` press passes
 *     through the demo without snagging.
 *   - The reduced-motion fallback is enforced by CSS (see `AIDemo.css`).
 *     The component itself doesn't read `matchMedia` — the OS/browser
 *     does, which means the user's preference is always respected even
 *     if our JS never runs.
 */

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Badge } from "@nixus/shared";

import { categorizedRows, statementLines } from "@/content/aiDemo";

import "./AIDemo.css";

/**
 * Format a CAD amount with two decimals and a `$` prefix. The statement
 * column right-aligns these so the decimals stack visually like a real
 * bank export.
 */
function formatCAD(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

/**
 * Animation gating.
 *
 * The first render — server AND browser — must agree that it should not, or
 * React reports an attribute mismatch on the gating class and refuses to patch
 * it, which silently kills the animation in a real browser. So the state starts
 * `false` everywhere and only the post-mount effect turns it on: via
 * IntersectionObserver where it exists, immediately where it does not (jsdom,
 * older browsers). The static composition is complete without the class, so
 * no-JS visitors lose nothing but the motion.
 */
export function AIDemo() {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const [isAnimated, setIsAnimated] = useState(false);

  useEffect(() => {
    if (isAnimated) return;
    const node = ref.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- no observer to wait on; start the animation immediately so the motion is not lost
      setIsAnimated(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setIsAnimated(true);
          // Once we've started, we never stop. The CSS animation loops
          // by itself; observing further would just churn callbacks for
          // no behavioral change.
          observer.unobserve(node);
        }
      },
      // 0.3 means "once 30% of the demo is on screen", which lines up
      // with the visitor having scrolled past the hero and committed
      // to looking at this section.
      { threshold: 0.3 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [isAnimated]);

  return (
    <section
      data-testid="ai-demo-section"
      className="mkt-section-y bg-background"
    >
      <div className="mkt-page-x mkt-section-lead mx-auto max-w-[1024px] text-center">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-primary">
          {t("aiDemo.eyebrow")}
        </p>
        <h2 className="text-display-l text-foreground">{t("aiDemo.heading")}</h2>
        <p className="mx-auto mt-4 max-w-[540px] text-lead text-muted-foreground">
          {t("aiDemo.subhead")}
        </p>
      </div>
      <figure
        aria-label={t("aiDemo.figureAria")}
        // Width capped at 1024px (a touch narrower than the page max of
        // 1280px) so the demo feels deliberate, not edge-bleeding. Mac
        // window UIs at this scale read as a "screenshot of the app",
        // which is the metaphor we want.
        className="mkt-page-x mx-auto max-w-[1024px]"
      >
        <div
          ref={ref}
          data-testid="ai-demo"
          aria-hidden="true"
          className={`ai-demo overflow-hidden rounded-xl border border-border bg-background shadow-[0_1px_3px_rgba(15,23,42,0.06),0_8px_24px_rgba(15,23,42,0.08)] ${
            isAnimated ? "ai-demo--animated" : ""
          }`}
        >
          {/* Mac-style title bar.
            *
            * Three traffic-light dots (red/yellow/green) plus a centered
            * window title. The dots are decorative — `aria-hidden` so
            * the screen reader's `<figure>` summary isn't polluted. */}
          <div className="flex items-center gap-2 border-b border-border bg-slate-50 px-3 py-2 dark:bg-card sm:gap-2.5 sm:px-3.5 sm:py-2.5">
            <span
              className="size-2.5 rounded-full bg-[#ff5f57]"
              aria-hidden="true"
            />
            <span
              className="size-2.5 rounded-full bg-[#ffbd2e]"
              aria-hidden="true"
            />
            <span
              className="size-2.5 rounded-full bg-[#28c840]"
              aria-hidden="true"
            />
            <span className="ml-1 truncate text-xs text-muted-foreground sm:ml-2">
              {t("aiDemo.titlebarLabel")}
            </span>
          </div>

          {/* Body grid.
            *
            * Stacks on mobile (single column), splits into 1fr / 1.4fr
            * on md+. The right column is wider because categorized rows
            * carry a category badge that needs breathing room. */}
          <div className="grid grid-cols-1 md:grid-cols-[1fr_1.4fr]">
            {/* Statement column ("before").
              *
              * Mono font + uppercase merchants + right-aligned amounts
              * mimic a real Canadian bank statement export. The
              * `relative` positioning hosts the absolute scan-line. */}
            <div
              data-testid="ai-demo-statement"
              className="relative border-b border-border bg-slate-50/60 p-4 dark:bg-card sm:p-5 md:border-b-0 md:border-r"
            >
              <div className="mb-4 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t("aiDemo.statementHeading")}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {t("aiDemo.statementDateRange")}
                </span>
              </div>

              <ul className="space-y-2 font-mono text-xs sm:text-sm">
                {statementLines.map((line) => (
                  <li
                    key={line.merchant}
                    data-testid="ai-demo-statement-line"
                    className="flex items-center justify-between gap-2 text-foreground"
                  >
                    <span className="truncate font-semibold">
                      {line.merchant}
                    </span>
                    <span className="shrink-0">{formatCAD(line.amount)}</span>
                  </li>
                ))}
              </ul>

              {/* Scan line.
                *
                * Absolutely positioned, 2px tall, full-width inside the
                * column. CSS animates `top` from 0 → 100% to "read"
                * each row. Decorative — `aria-hidden`. */}
              <span
                aria-hidden="true"
                data-testid="ai-demo-scan-line"
                className="ai-demo__scan-line pointer-events-none absolute inset-x-0 h-0.5 bg-emerald-400/70"
              />
            </div>

            {/* Categorized column ("after").
              *
              * Same five transactions but now with normalized merchant
              * names and a colored category Badge. Each row staggers in
              * via `animation-delay` so the eye reads them in the same
              * order the scan moves down the left column. */}
            <div
              data-testid="ai-demo-categorized"
              className="bg-background p-4 sm:p-5"
            >
              <div className="mb-4 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t("aiDemo.categorizedHeading")}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {t("aiDemo.transactionCount", {
                    count: categorizedRows.length,
                  })}
                </span>
              </div>

              <ul className="space-y-2 text-xs sm:text-sm">
                {categorizedRows.map((row, i) => (
                  <li
                    key={row.merchant}
                    data-testid="ai-demo-categorized-row"
                    // Stagger: each row delays its fade-in by 400ms so
                    // the five together fan out across ~2s, matching
                    // the scan-line traversal in the left column.
                    style={{ animationDelay: `${0.5 + i * 0.4}s` }}
                    className="ai-demo__txn flex items-center justify-between gap-2 rounded-md border border-border/60 bg-slate-50/40 px-2.5 py-2 dark:bg-card sm:gap-3 sm:px-3"
                  >
                    <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                      <span className="truncate font-medium text-foreground">
                        {row.merchant}
                      </span>
                      <Badge
                        variant="secondary"
                        className={`shrink-0 ${row.badgeClass}`}
                      >
                        {t(`aiDemo.category.${row.categoryKey}`)}
                      </Badge>
                    </div>
                    <span className="shrink-0 font-mono text-foreground">
                      {formatCAD(row.amount)}
                    </span>
                  </li>
                ))}
              </ul>

              {/* Summary banner — the punchline.
                *
                * Appears at the end of the animation cycle. The copy is
                * the AC: "5 transactions categorized in 2.4 seconds". */}
              <div
                data-testid="ai-demo-summary"
                className="ai-demo__summary mt-4 rounded-md bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800"
              >
                <span aria-hidden="true">✓ </span>
                {t("aiDemo.summary", { count: 5, seconds: 2.4 })}
              </div>
            </div>
          </div>
        </div>
      </figure>
    </section>
  );
}
