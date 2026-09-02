import { useTranslation } from "react-i18next";

import { betaScreenshots } from "@/content/betaPage";

/** Product screenshots with captions. Placeholder panel when no asset exists. */
export function BetaScreenshots() {
  const { t } = useTranslation();

  return (
    <section
      aria-labelledby="beta-screenshots-heading"
      className="mkt-section-lead"
    >
      <h2
        id="beta-screenshots-heading"
        className="mb-6 text-xl font-semibold text-foreground"
      >
        {t("betaPage.screenshots.heading")}
      </h2>
      <div className="space-y-4 sm:space-y-5">
        {betaScreenshots.map((shot) => (
          <figure
            key={shot.id}
            data-testid={`beta-screenshot-${shot.id}`}
            className="overflow-hidden rounded-lg border border-border bg-card"
          >
            {shot.src ? (
              <img
                src={shot.src}
                alt={t(`betaPage.screenshots.${shot.id}.alt`)}
                className="h-auto w-full"
                loading="lazy"
              />
            ) : (
              <div
                aria-hidden="true"
                className="mkt-page-x flex aspect-[16/10] items-center justify-center bg-gradient-to-br from-muted to-accent text-center text-sm font-medium text-muted-foreground"
              >
                {t(`betaPage.screenshots.${shot.id}.placeholder`)}
              </div>
            )}
            <figcaption className="border-t border-border px-4 py-3 text-sm text-muted-foreground">
              {t(`betaPage.screenshots.${shot.id}.caption`)}
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}
