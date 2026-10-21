import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";

import { ProductFrame } from "@/components/ProductFrame";
import { IconChip, rampStop } from "@/components/IconChip";
import { SectionIntro } from "@/components/SectionIntro";
import { stages } from "@/content/stages";

/**
 * The four-rung product ladder — one alternating showcase row per stage.
 *
 * Replaces the eight-card icon grid that carried this job before. That grid
 * claimed eight capabilities and proved one, and gave every claim the same
 * lavender icon square, so the page read as a spec sheet. Here each rung states
 * one question, answers it in prose, and shows the actual surface that answers
 * it — the proof arrives with the claim.
 *
 * The side swap is index-driven rather than a per-row prop so the alternation
 * cannot drift when a stage is inserted or reordered. `data-visual` drives both
 * halves of that swap — the flipped column template in `.mkt-showcase` and the
 * `lg:order-*` on the children — because flipping only one of them moves the
 * content without moving the track it sits in. Below the desktop tier every row
 * stacks to DOM order (text, then visual), which is why the order utilities are
 * `lg:`-gated.
 */
export function StageShowcase() {
  const { t } = useTranslation();

  return (
    <section
      id="how"
      data-testid="stage-showcase"
      aria-labelledby="stages-heading"
      className="mkt-band-paper mkt-wash mkt-wash-dual mkt-section-y"
    >
      <div className="mkt-page-x mkt-container">
        <SectionIntro
          id="stages-heading"
          eyebrow={t("stages.eyebrow")}
          heading={t("stages.heading")}
          lead={t("stages.subhead")}
          aside={
            <ol
              role="list"
              data-testid="stage-index"
              className="flex flex-col gap-0 border-t border-border"
            >
              {stages.map((stage, index) => (
                <li key={stage.id}>
                  <a
                    href={`#stage-${stage.id}`}
                    className="mkt-tap flex items-baseline gap-4 border-b border-border py-3 text-sm outline-none transition-colors hover:text-primary focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <span className="text-xs font-semibold text-ink-faint tabular-nums">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="font-semibold text-foreground">
                      {t(`stages.${stage.id}.stage`)}
                    </span>
                    <span className="ml-auto text-right text-muted-foreground">
                      {t(`stages.${stage.id}.question`)}
                    </span>
                  </a>
                </li>
              ))}
            </ol>
          }
        />

        <ol role="list" className="flex flex-col gap-16 md:gap-24 lg:gap-32">
          {stages.map((stage, index) => {
            const Icon = stage.icon;
            const visualFirst = index % 2 === 1;
            const headingId = `stage-${stage.id}-heading`;
            const ordinal = String(index + 1).padStart(2, "0");

            return (
              <li
                key={stage.id}
                id={`stage-${stage.id}`}
                data-testid="stage-row"
                data-stage={stage.id}
                aria-labelledby={headingId}
                data-visual={visualFirst ? "first" : "second"}
                className="mkt-showcase scroll-mt-24"
              >
                <div
                  data-reveal-item=""
                  className={
                    visualFirst
                      ? "lg:order-2 lg:pl-4 xl:pl-8"
                      : "lg:order-1 lg:pr-4 xl:pr-8"
                  }
                >
                  <div className="flex items-center gap-3">
                    <IconChip icon={Icon} stop={rampStop(index)} />
                    <p className="text-xs font-semibold tracking-wider text-primary uppercase">
                      <span className="text-ink-faint">{ordinal}</span>{" "}
                      {t(`stages.${stage.id}.stage`)}
                    </p>
                  </div>

                  <h3
                    id={headingId}
                    className="text-display-m mt-5 text-foreground"
                  >
                    {t(`stages.${stage.id}.heading`)}
                  </h3>
                  <p className="mt-4 text-base leading-relaxed text-muted-foreground">
                    {t(`stages.${stage.id}.body`)}
                  </p>

                  <ul
                    role="list"
                    data-testid="stage-points"
                    className="mt-6 flex flex-col gap-3 border-t border-border pt-6"
                  >
                    {stage.pointIds.map((pointId) => (
                      <li key={pointId} className="flex gap-3 text-sm">
                        <span
                          aria-hidden="true"
                          className="mt-[7px] size-1.5 shrink-0 rounded-full bg-primary"
                        />
                        <span className="text-foreground">
                          {t(`stages.${stage.id}.points.${pointId}`)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div
                  data-reveal-item=""
                  style={{ "--reveal-i": 1 } as CSSProperties}
                  className={visualFirst ? "lg:order-1" : "lg:order-2"}
                >
                  <ProductFrame
                    id={`stage-${stage.id}-frame`}
                    kind="image"
                    src={stage.image}
                    alt={t(`stages.${stage.id}.alt`)}
                    caption={t(`stages.${stage.id}.caption`)}
                  />
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
