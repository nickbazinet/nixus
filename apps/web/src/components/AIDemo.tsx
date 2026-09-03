/**
 * AI import demo (Story 3.2, recomposed for Warm Editorial).
 *
 * A Tangerine-style credit-card statement on the left is parsed and re-laid-out
 * as categorized transactions on the right in ~3 seconds. No copy required: the
 * visual carries the AI auto-import promise, which is why it now sits inside the
 * hero as the proof beside the headline rather than as its own section.
 *
 * Architecture decisions baked in here:
 *   - Animation tech is **CSS keyframes on real DOM** (architecture step 4). No
 *     Lottie, no MP4, no GIF: smaller payload, fully styleable, accessible by
 *     default, and the reduced-motion fallback is one
 *     `@media (prefers-reduced-motion: reduce)` block away. Keyframes live in
 *     the co-located `AIDemo.css` (kept under ~5 KB target).
 *   - The animation is gated on `ai-demo--animated`, set by an
 *     IntersectionObserver below. The static composition renders on first paint,
 *     so the demo is instantly meaningful to no-JS visitors and to anyone whose
 *     IO never fires (e.g. some test environments). The motion is a *bonus* on
 *     top of a complete static "before/after".
 *   - The first render is identical on the server and in the browser
 *     (un-animated) so hydration cannot mismatch on the gating class; the effect
 *     below turns the animation on after mount.
 *   - Skeleton state intentionally omitted: no async data, so the static "after"
 *     composition IS its skeleton — no content swap, no layout shift.
 *
 * Accessibility:
 *   - `ProductFrame` wraps it in a `<figure>` with a descriptive `aria-label`, so
 *     screen readers get a single summary-style announcement instead of reading
 *     every transaction line.
 *   - Nothing inside is keyboard-focusable. There are no anchors, buttons, or
 *     `tabIndex` attributes, so a `Tab` press passes through without snagging.
 *   - The reduced-motion fallback is enforced by CSS (see `AIDemo.css`). The
 *     component never reads `matchMedia` — the OS/browser does, so the
 *     preference is respected even if our JS never runs.
 */

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Badge } from "@nixus/shared";

import { categorizedRows, statementLines } from "@/content/aiDemo";

import { ProductFrame } from "./ProductFrame";

import "./AIDemo.css";

/**
 * Money is set in Inter with `tabular-nums` rather than a mono face: the decimal
 * columns still stack like a bank export, and the demo keeps the site's one
 * typeface instead of introducing a second.
 */
const MONEY_CLASS = "shrink-0 tabular-nums";

const COLUMN_LABEL_CLASS =
  "text-xs font-semibold uppercase tracking-wider text-muted-foreground";

function formatCAD(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

/**
 * Animation gating.
 *
 * The first render — server AND browser — must agree that it should not animate,
 * or React reports an attribute mismatch on the gating class and refuses to
 * patch it, which silently kills the animation in a real browser. So the state
 * starts `false` everywhere and only the post-mount effect turns it on: via
 * IntersectionObserver where it exists, immediately where it does not (jsdom,
 * older browsers). The static composition is complete without the class, so
 * no-JS visitors lose nothing but the motion.
 */
export function AIDemoFigure() {
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
          // Once we've started, we never stop. The CSS animation loops by
          // itself; observing further would churn callbacks for no behavioral
          // change.
          observer.unobserve(node);
        }
      },
      // 0.3 means "once 30% of the demo is on screen", which in the hero
      // composition is true on load at desktop and after a short scroll on a
      // phone — either way the motion starts when the visitor can see it.
      { threshold: 0.3 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [isAnimated]);

  return (
    <ProductFrame
      kind="content"
      id="ai-demo-figure"
      label={t("aiDemo.figureAria")}
    >
      <div
        ref={ref}
        data-testid="ai-demo"
        aria-hidden="true"
        className={`ai-demo overflow-hidden rounded-lg border border-border bg-background ${
          isAnimated ? "ai-demo--animated" : ""
        }`}
      >
        {/* App window chrome: three quiet dots and the window title. Inked
          * hairline dots rather than macOS traffic lights — the frame is warm
          * editorial, and three saturated primaries would be the loudest colour
          * on the page. Decorative either way. */}
        <div className="flex items-center gap-2 border-b border-border bg-chrome px-3 py-2 sm:gap-2.5 sm:px-3.5 sm:py-2.5">
          <span className="size-2.5 rounded-full bg-line-strong" />
          <span className="size-2.5 rounded-full bg-line-strong" />
          <span className="size-2.5 rounded-full bg-line-strong" />
          <span className="ml-1 truncate text-xs text-muted-foreground sm:ml-2">
            {t("aiDemo.titlebarLabel")}
          </span>
        </div>

        {/* Stacks on mobile, splits 1fr / 1.4fr on md+. The right column is
          * wider because categorized rows carry a category badge. */}
        <div className="grid grid-cols-1 md:grid-cols-[1fr_1.4fr]">
          <div
            data-testid="ai-demo-statement"
            className="relative border-b border-border bg-chrome/60 p-4 sm:p-5 md:border-b-0 md:border-r"
          >
            <div className="mb-4 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
              <span className={COLUMN_LABEL_CLASS}>
                {t("aiDemo.statementHeading")}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {t("aiDemo.statementDateRange")}
              </span>
            </div>

            <ul className="space-y-2 text-xs sm:text-sm">
              {statementLines.map((line) => (
                <li
                  key={line.merchant}
                  data-testid="ai-demo-statement-line"
                  className="flex items-center justify-between gap-2 text-foreground"
                >
                  {/* Wide tracking is what carries the "raw bank export" read
                    * now that the mono face is gone. */}
                  <span className="truncate font-semibold tracking-wide">
                    {line.merchant}
                  </span>
                  <span data-testid="ai-demo-amount" className={MONEY_CLASS}>
                    {formatCAD(line.amount)}
                  </span>
                </li>
              ))}
            </ul>

            {/* Scan line: 2px tall, full-width inside the column. CSS animates
              * `top` from 0 → 100% to "read" each row. */}
            <span
              data-testid="ai-demo-scan-line"
              className="ai-demo__scan-line pointer-events-none absolute inset-x-0 h-0.5 bg-brand/70"
            />
          </div>

          <div
            data-testid="ai-demo-categorized"
            className="bg-background p-4 sm:p-5"
          >
            <div className="mb-4 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
              <span className={COLUMN_LABEL_CLASS}>
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
                  // Stagger: each row delays its fade-in by 400ms so the five
                  // together fan out across ~2s, matching the scan-line
                  // traversal in the left column.
                  style={{ animationDelay: `${0.5 + i * 0.4}s` }}
                  className="ai-demo__txn flex items-center justify-between gap-2 rounded-md border border-border/60 bg-chrome/40 px-2.5 py-2 sm:gap-3 sm:px-3"
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
                  <span
                    data-testid="ai-demo-amount"
                    className={`${MONEY_CLASS} text-foreground`}
                  >
                    {formatCAD(row.amount)}
                  </span>
                </li>
              ))}
            </ul>

            {/* Summary banner — the punchline, on the shared success tokens
              * because that is exactly what it reports. */}
            <div
              data-testid="ai-demo-summary"
              className="ai-demo__summary mt-4 rounded-md bg-good-bg px-3 py-2 text-sm font-medium text-good-ink"
            >
              <span>✓ </span>
              {t("aiDemo.summary", { count: 5, seconds: 2.4 })}
            </div>
          </div>
        </div>
      </div>
    </ProductFrame>
  );
}
