import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
} from "@tanstack/react-router";
import { useEffect } from "react";
import { I18nextProvider, useTranslation } from "react-i18next";
import { ThemeProvider } from "next-themes";

import appCss from "../styles/main.css?url";
import { PreAlphaBanner } from "../components/PreAlphaBanner";
import { SiteFooter } from "../components/SiteFooter";
import { SiteHeader } from "../components/SiteHeader";
import { DownloadStateProvider } from "../features/download/DownloadStateContext";
import i18n from "@/lib/i18n";

// Inline script that runs synchronously before React hydrates so the
// `dark` class is on `<html>` on first paint. Without this, returning
// visitors with `localStorage.theme === 'dark'` see a brief light flash
// while the React tree mounts and `next-themes` reads localStorage.
// Also applies `data-pre-alpha-dismissed` so the pre-alpha banner stays
// hidden via CSS for returning dismissed visitors (no flash).
const FLASH_MITIGATION = `(function(){try{var t=localStorage.getItem('theme');var dark=t==='dark'||((t==='system'||!t)&&window.matchMedia('(prefers-color-scheme: dark)').matches);if(dark){document.documentElement.classList.add('dark');}document.documentElement.style.colorScheme=dark?'dark':'light';}catch(e){}try{if(localStorage.getItem('nixus.preAlphaDismissed')==='1'){document.documentElement.setAttribute('data-pre-alpha-dismissed','1');}}catch(e){}})();`;

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "icon", type: "image/x-icon", href: "/favicon.ico" },
      { rel: "apple-touch-icon", sizes: "180x180", href: "/apple-touch-icon.png" },
    ],
    scripts: [
      // No `defer` / `async`: must run before React hydration.
      { children: FLASH_MITIGATION },
    ],
  }),
  shellComponent: RootDocument,
});

function useCloudflareAnalytics(): void {
  useEffect(() => {
    if (!import.meta.env.PROD) return;
    const token = import.meta.env.VITE_CLOUDFLARE_ANALYTICS_TOKEN;
    if (!token) return;
    if (document.querySelector("script[data-nixus-analytics]")) return;
    const script = document.createElement("script");
    script.defer = true;
    script.src = "https://static.cloudflareinsights.com/beacon.min.js";
    script.setAttribute("data-cf-beacon", JSON.stringify({ token }));
    script.setAttribute("data-nixus-analytics", "true");
    document.head.appendChild(script);
  }, []);
}

// Inner shell — split out so it can call `useTranslation()` from inside
// the `<I18nextProvider>` tree. The provider must wrap any consumer.
function ShellInner() {
  const { t, i18n: i18nInstance } = useTranslation();
  const lang = i18nInstance.language?.split("-")[0] || "en";
  useCloudflareAnalytics();
  return (
    <html lang={lang}>
      <head>
        <HeadContent />
      </head>
      <body className="font-sans antialiased">
        <a
          href="#main-content"
          className="absolute left-2 top-2 z-[100] -translate-y-16 rounded-md bg-background px-3 py-2 text-sm font-medium text-foreground shadow outline-none focus-visible:translate-y-0 focus-visible:ring-3 focus-visible:ring-ring/50 motion-safe:transition-transform"
        >
          {t("skipToMain")}
        </a>
        <DownloadStateProvider>
          <PreAlphaBanner />
          <SiteHeader />
          <main
            id="main-content"
            tabIndex={-1}
            className="min-h-[calc(100dvh-4rem)] outline-none"
          >
            <Outlet />
          </main>
          <SiteFooter />
        </DownloadStateProvider>
        <Scripts />
      </body>
    </html>
  );
}

function RootDocument() {
  return (
    <I18nextProvider i18n={i18n}>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        <ShellInner />
      </ThemeProvider>
    </I18nextProvider>
  );
}
