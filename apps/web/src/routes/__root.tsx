import {
  HeadContent,
  Link,
  Outlet,
  Scripts,
  createRootRoute,
  useRouterState,
} from "@tanstack/react-router";
import { useEffect } from "react";

import appCss from "../styles/main.css?url";
import { SiteFooter } from "../components/SiteFooter";
import { SiteHeader } from "../components/SiteHeader";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      // `?v=` is the artwork's revision: browsers cache a favicon by URL for a
      // long time and ignore a changed file at the same address, so a new mark
      // needs a new URL. The SVG is not linked: it only wraps a raster, so it
      // would add nothing over the PNG, and a browser that prefers SVG would
      // keep showing its cached copy of the old one.
      { rel: "icon", type: "image/x-icon", sizes: "32x32", href: "/favicon.ico?v=2" },
      { rel: "icon", type: "image/png", sizes: "192x192", href: "/icon-192.png?v=2" },
      { rel: "apple-touch-icon", sizes: "180x180", href: "/apple-touch-icon.png?v=2" },
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

/** Home-only strip above the header. */
function AnnouncementBar() {
  return (
    <div className="bg-night px-4 py-2.5 text-center text-sm text-white/90">
      Alpha: Founding Users get early access and a discounted price, forever.{" "}
      <Link
        to="/founding-users"
        className="nx-focus rounded-sm font-bold text-white underline underline-offset-4"
      >
        See the program
      </Link>
    </div>
  );
}

/** Gradient referenced by `.nx-icon-gradient` line icons. */
function IconGradientDefs() {
  return (
    <svg width="0" height="0" aria-hidden="true" focusable="false" className="absolute">
      <defs>
        <linearGradient
          id="nx-icon-gradient"
          gradientUnits="userSpaceOnUse"
          x1="2"
          y1="2"
          x2="22"
          y2="22"
        >
          <stop offset="0%" stopColor="#5E78ED" />
          <stop offset="55%" stopColor="#9978ED" />
          <stop offset="100%" stopColor="#DE50A4" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function RootDocument() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  useCloudflareAnalytics();

  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body className="bg-page font-sans text-ink antialiased">
        <IconGradientDefs />
        <a
          href="#main-content"
          className="absolute left-2 top-2 z-[100] -translate-y-16 rounded-md bg-white px-3 py-2 text-sm font-bold text-ink shadow focus-visible:translate-y-0 motion-safe:transition-transform"
        >
          Skip to main content
        </a>
        {pathname === "/" ? <AnnouncementBar /> : null}
        <SiteHeader />
        <main id="main-content" tabIndex={-1} className="outline-none">
          <Outlet />
        </main>
        <SiteFooter />
        <Scripts />
      </body>
    </html>
  );
}
