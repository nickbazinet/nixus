import { ButtonLink } from "@/components/ui";
import { copyFor } from "@/content/index";
import type { Locale } from "@/lib/locale";
import { pagePath } from "@/lib/routes";

/**
 * One 404 page per language, so a French visitor who mistypes a French URL gets
 * a French answer. The edge rewrite resolves `/fr/<unknown>` to an object that
 * does not exist, which is what makes CloudFront serve a real 404 status rather
 * than this page at 200.
 */
export function NotFoundPage({ locale }: { locale: Locale }) {
  const copy = copyFor(locale).notFound;
  return (
    <section className="nx-container nx-section flex min-h-[60vh] flex-col items-center justify-center text-center">
      <p className="nx-gradient-text font-display text-7xl font-semibold">404</p>
      <h1 className="mt-4 text-display-s font-semibold">{copy.heading}</h1>
      <p className="mt-3 text-ink-soft">{copy.body}</p>
      <ButtonLink to={pagePath("home", locale)} className="mt-8">
        {copy.cta}
      </ButtonLink>
    </section>
  );
}
