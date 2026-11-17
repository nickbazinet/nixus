import { useTranslation } from "react-i18next";
import { Button } from "@nixus/shared";

import { homePath, otherLocale, profileDestinationKey, type Locale } from "@/lib/i18n";

/**
 * The signed-out landing page.
 *
 * Sign-in is a plain link, not a fetch: the flow is a 302 to Managed Login, and a
 * link works with no JavaScript. `next` carries the destination KEY, so the only
 * thing the request can influence is which of two allow-listed paths it lands on.
 */
export function SignInPanel({ locale }: { locale: Locale }) {
  const { t } = useTranslation();
  const swap = otherLocale(locale);

  return (
    <main
      id="main"
      className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-6 px-6 py-16"
    >
      <h1 className="text-3xl font-semibold tracking-tight">{t("landing.heading")}</h1>
      <p className="text-muted-foreground">{t("landing.lead")}</p>

      <div className="flex flex-wrap items-center gap-4">
        <Button
          size="lg"
          render={
            <a
              data-testid="sign-in"
              href={`/auth/login?next=${profileDestinationKey(locale)}&lang=${locale}`}
            >
              {t("landing.signIn")}
            </a>
          }
        />
        <a
          data-testid="language-toggle"
          href={homePath(swap)}
          className="text-sm font-medium underline underline-offset-4"
          hrefLang={swap}
        >
          {t("language.toggle")}
        </a>
      </div>

      <a
        href="https://nixusapp.com"
        className="text-sm text-muted-foreground underline underline-offset-4"
      >
        {t("landing.marketingLink")}
      </a>
    </main>
  );
}
