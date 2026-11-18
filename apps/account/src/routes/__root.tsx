import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
  useLocation,
} from "@tanstack/react-router";
import { I18nextProvider, useTranslation } from "react-i18next";
import { ThemeProvider } from "next-themes";

import appCss from "../styles/main.css?url";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { i18nForLocale, localeFromPath, type Locale } from "@/lib/i18n";

/**
 * Inline script that runs synchronously before React hydrates, so the `dark`
 * class is on `<html>` on first paint. Copied from `apps/web`'s
 * `FLASH_MITIGATION` — same `localStorage.theme` key, same resolution order —
 * because without it a visitor whose stored choice is dark sees a light flash
 * while the tree mounts and `next-themes` reads localStorage.
 */
const FLASH_MITIGATION = `(function(){try{var t=localStorage.getItem('theme');var dark=t==='dark'||((t==='system'||!t)&&window.matchMedia('(prefers-color-scheme: dark)').matches);if(dark){document.documentElement.classList.add('dark');}document.documentElement.style.colorScheme=dark?'dark':'light';}catch(e){}})();`;

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      // Nothing here should ever be indexed: every page is behind a session.
      { name: "robots", content: "noindex, nofollow" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
    scripts: [
      // No `defer` / `async`: must run before React hydration.
      { children: FLASH_MITIGATION },
    ],
  }),
  shellComponent: RootDocument,
});

function ShellInner({ locale }: { readonly locale: Locale }) {
  const { t } = useTranslation();

  return (
    // `suppressHydrationWarning` covers the `class` and `style` that
    // FLASH_MITIGATION writes onto this element before React hydrates — the
    // documented next-themes pattern rather than a workaround.
    <html lang={locale} suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="font-sans antialiased">
        {/* Inside <body>, not around <html>: React 19 refuses to order a sync
            script outside the main document, which is what wrapping the
            document element would ask next-themes to do. Prepaint is
            unaffected — FLASH_MITIGATION has already resolved the theme. */}
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
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
        </ThemeProvider>
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
