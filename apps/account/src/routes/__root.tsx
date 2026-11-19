import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
  useLocation,
} from "@tanstack/react-router";
import { I18nextProvider, useTranslation } from "react-i18next";

import appCss from "../styles/main.css?url";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { i18nForLocale, localeFromPath, type Locale } from "@/lib/i18n";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      // Nothing here should ever be indexed: every page is behind a session.
      { name: "robots", content: "noindex, nofollow" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  shellComponent: RootDocument,
});

function ShellInner({ locale }: { readonly locale: Locale }) {
  const { t } = useTranslation();

  return (
    // Light only: the account surface is drawn on one palette.
    <html lang={locale} style={{ colorScheme: "light" }}>
      <head>
        <HeadContent />
      </head>
      <body className="font-sans antialiased">
        <a
          href="#main"
          className="absolute top-2 left-2 z-100 -translate-y-16 rounded-md bg-background px-3 py-2 text-sm font-medium text-foreground shadow outline-none focus-visible:translate-y-0 focus-visible:ring-3 focus-visible:ring-ring/50 motion-safe:transition-transform"
        >
          {t("skipToMain")}
        </a>
        <div className="flex min-h-dvh flex-col">
          <SiteHeader locale={locale} />
          <div className="flex-1">
            <Outlet />
          </div>
          <SiteFooter locale={locale} />
        </div>
        <Scripts />
      </body>
    </html>
  );
}

function RootDocument() {
  const { pathname } = useLocation();
  const locale = localeFromPath(pathname);

  return (
    <I18nextProvider i18n={i18nForLocale(locale)}>
      <ShellInner locale={locale} />
    </I18nextProvider>
  );
}
