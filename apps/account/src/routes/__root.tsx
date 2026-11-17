import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
  useLocation,
} from "@tanstack/react-router";
import { I18nextProvider } from "react-i18next";

import appCss from "../styles/main.css?url";
import { i18nForLocale, localeFromPath } from "@/lib/i18n";

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

function RootDocument() {
  const { pathname } = useLocation();
  const locale = localeFromPath(pathname);

  return (
    <html lang={locale}>
      <head>
        <HeadContent />
      </head>
      <body>
        <I18nextProvider i18n={i18nForLocale(locale)}>
          <Outlet />
        </I18nextProvider>
        <Scripts />
      </body>
    </html>
  );
}
