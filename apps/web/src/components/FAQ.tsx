import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@nixus/shared";

import { CONTACT_EMAIL, contactMailto } from "@/content/contact";
import { faqEntries } from "@/content/faq";
import { trackEvent } from "@/lib/analytics";

const PRE_ALPHA_HASH = "#faq-pre-alpha";

export function FAQ() {
  const { t } = useTranslation();
  // Track previous open-set so we detect *expand* transitions vs collapses.
  const previousOpenIdsRef = useRef<readonly string[]>([]);
  // Controlled value so we can auto-open `preAlpha` post-mount in response
  // to `#faq-pre-alpha` — both on initial load and on in-session navigation
  // from the pre-alpha banner's "Learn more" link. SSR/initial render is
  // always `[]` (no hash check during render), which keeps hydration clean.
  const [openIds, setOpenIds] = useState<string[]>([]);

  useEffect(() => {
    function openPreAlphaIfHashMatches() {
      if (typeof window === "undefined") return;
      if (window.location.hash !== PRE_ALPHA_HASH) return;
      setOpenIds((prev) =>
        prev.includes("preAlpha") ? prev : [...prev, "preAlpha"],
      );
    }
    openPreAlphaIfHashMatches();
    window.addEventListener("hashchange", openPreAlphaIfHashMatches);
    return () =>
      window.removeEventListener("hashchange", openPreAlphaIfHashMatches);
  }, []);

  return (
    <section
      id="faq"
      data-testid="faq"
      aria-labelledby="faq-heading"
      className="mkt-band-paper mkt-wash mkt-wash-brand mkt-section-y"
    >
      <div className="mkt-page-x mx-auto max-w-[720px]">
        <div className="mkt-section-lead text-center">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-brand-ink">
            {t("faq.eyebrow")}
          </p>
          <h2 id="faq-heading" className="text-display-l text-foreground">
            {t("faq.heading")}
          </h2>
        </div>

        <div
          data-testid="faq-surface"
          data-reveal-item=""
          className="mkt-card mkt-panel border border-border bg-card px-5 py-2 sm:px-7 sm:py-3"
        >
        <Accordion
          value={openIds}
          onValueChange={(value) => {
            const next: string[] = Array.isArray(value)
              ? value.filter((v): v is string => typeof v === "string")
              : [];
            const previous = previousOpenIdsRef.current;
            for (const id of next) {
              if (!previous.includes(id)) {
                const entry = faqEntries.find((e) => e.id === id);
                if (entry) {
                  // Fire the analytics event with the question text resolved
                  // through i18n in the visitor's current locale.
                  trackEvent({
                    name: "faq.expanded",
                    properties: { question: t(`faq.${entry.id}.question`) },
                  });
                }
              }
            }
            previousOpenIdsRef.current = next;
            setOpenIds(next);
          }}
        >
          {faqEntries.map((entry) => (
            <AccordionItem
              key={entry.id}
              value={entry.id}
              id={entry.id === "preAlpha" ? "faq-pre-alpha" : undefined}
            >
              <AccordionTrigger className="mkt-tap items-center">
                <span className="pr-4 text-base font-medium">
                  {t(`faq.${entry.id}.question`)}
                </span>
              </AccordionTrigger>
              <AccordionContent>
                <p className="text-muted-foreground">
                  {t(`faq.${entry.id}.answer`)}
                </p>
                {entry.links && entry.links.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                    {entry.links.map((link) => (
                      <a
                        key={link.href}
                        href={link.href}
                        className="mkt-tap inline-flex items-center text-brand-ink underline-offset-4 hover:underline"
                        target={link.external ? "_blank" : undefined}
                        rel={link.external ? "noreferrer" : undefined}
                      >
                        {t(link.labelKey)}
                      </a>
                    ))}
                  </div>
                ) : null}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
        </div>

        <p className="mt-8 text-center text-sm break-words text-muted-foreground md:mt-12">
          {t("faq.stillHaveQuestions")}{" "}
          <a
            href={contactMailto()}
            className="text-brand-ink underline-offset-4 hover:underline"
          >
            {CONTACT_EMAIL}
          </a>
        </p>
      </div>
    </section>
  );
}
