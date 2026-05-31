/**
 * SEO + social meta helper for the Nixus marketing site.
 *
 * Story 4.2 introduced this helper. Story 4 (web-marketing-polish) extends
 * it to emit per-locale `<title>`/description (resolved through i18n),
 * locale-aware `og:locale`, and `<link rel="alternate" hreflang>` tags so
 * search engines correctly serve `/` to English visitors and `/fr/` to
 * French visitors.
 */

import i18n from "./i18n";

export type Locale = "en" | "fr";

type MetaInput = {
  /** Override the default page title. Used for `<title>`, og:title, twitter:title. */
  title?: string;
  /** Override the default description. Used for description, og:description, twitter:description. */
  description?: string;
  /** Path relative to the site root, e.g. "/" or "/fr/". Drives canonical and og:url. */
  path?: string;
  /** Absolute URL for an OG image override. Defaults to `SITE.ogImage`. */
  ogImage?: string;
  /** Locale of THIS page. Defaults to "en". Drives og:locale + hreflang. */
  locale?: Locale;
};

export const SITE = {
  name: "Nixus",
  defaultTitle: "Nixus — Local-first personal finance app",
  defaultDescription:
    "Replace your personal finance spreadsheet with a local-first desktop app. Upload a credit card statement, AI categorizes it. Budget, accounts, net worth — data stays on your machine.",
  url: "https://nixus.app",
  ogImage: "https://nixus.app/og-image.png",
  twitterHandle: "",
} as const;

/** OG locale strings per supported language. */
const OG_LOCALE: Record<Locale, string> = {
  en: "en_US",
  fr: "fr_CA",
};

/** Path prefix for each locale. EN lives at the root; FR under /fr/. */
const LOCALE_PATH: Record<Locale, string> = {
  en: "/",
  fr: "/fr/",
};

/** Return type of `buildMeta`. Matches TanStack Start's head-config shape. */
export type SiteMeta = ReturnType<typeof buildMeta>;

/**
 * Build the standard set of meta tag descriptors for a given page + locale.
 *
 * The function reads from the singleton `i18n` instance using a locale-fixed
 * `t` so the title/description come from the correct language regardless of
 * the user's localStorage preference.
 */
export function buildMeta(input: MetaInput = {}) {
  const locale: Locale = input.locale ?? "en";
  // `getFixedT(locale)` returns a `t` bound to that specific locale and
  // doesn't mutate the global language — safe to call from a route loader
  // during prerender on either side of the EN/FR split.
  const t = i18n.getFixedT(locale);

  const defaultTitle = (t("meta.home.title") as string) || SITE.defaultTitle;
  const defaultDescription =
    (t("meta.home.description") as string) || SITE.defaultDescription;

  const title = input.title ?? defaultTitle;
  const description = input.description ?? defaultDescription;
  const path = input.path ?? LOCALE_PATH[locale];
  const url = path === "/" ? SITE.url : `${SITE.url}${path}`;
  const ogImage = input.ogImage ?? SITE.ogImage;

  const altSummary = description.split(".")[0]?.trim() ?? SITE.name;
  const otherLocale: Locale = locale === "en" ? "fr" : "en";

  return {
    meta: [
      { title },
      { name: "description", content: description },
      { name: "application-name", content: SITE.name },
      { name: "theme-color", content: "#FFFFFF" },

      // Open Graph
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: SITE.name },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:url", content: url },
      { property: "og:image", content: ogImage },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:image:alt", content: `${SITE.name} — ${altSummary}.` },
      { property: "og:locale", content: OG_LOCALE[locale] },
      { property: "og:locale:alternate", content: OG_LOCALE[otherLocale] },

      // Twitter
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: title },
      { name: "twitter:description", content: description },
      { name: "twitter:image", content: ogImage },
    ],
    links: [
      { rel: "canonical", href: url },
      // Per-locale alternates so crawlers serve the right URL by locale.
      { rel: "alternate", hrefLang: "en", href: `${SITE.url}/` },
      { rel: "alternate", hrefLang: "fr", href: `${SITE.url}/fr/` },
      { rel: "alternate", hrefLang: "x-default", href: `${SITE.url}/` },
    ],
  };
}
