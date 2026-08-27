/**
 * SEO + social meta helper for the Nixus marketing site.
 *
 * Story 4.2 introduced this helper. Story 4 (web-marketing-polish) extends
 * it to emit per-locale `<title>`/description (resolved through i18n),
 * locale-aware `og:locale`, and `<link rel="alternate" hreflang>` tags so
 * search engines correctly serve `/` to English visitors and `/fr/` to
 * French visitors.
 *
 * Every absolute URL it emits goes through `absoluteUrl()` on `SITE.url`, so
 * canonical, og:url, hreflang and JSON-LD can never disagree on host or on
 * root trailing slash.
 */

import i18n from "./i18n";
import { jsonLdScript } from "./jsonLd";
import { LOCALE_PATH, SITE, absoluteUrl } from "./site";
import type { Locale } from "./site";

export type { Locale };
export { SITE };

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
  /** Per-locale alternate paths for hreflang. Defaults to home EN/FR. */
  alternates?: Partial<Record<Locale, string>>;
  /** Keep this page out of the index. Only for pages that must never rank. */
  noindex?: boolean;
};

const OG_LOCALE: Record<Locale, string> = {
  en: "en_US",
  fr: "fr_CA",
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
  const url = absoluteUrl(path);
  const ogImage = input.ogImage ?? SITE.ogImage;

  const altSummary = description.split(".")[0]?.trim() ?? SITE.name;
  const otherLocale: Locale = locale === "en" ? "fr" : "en";
  const enAlternatePath = input.alternates?.en ?? LOCALE_PATH.en;
  const frAlternatePath = input.alternates?.fr ?? LOCALE_PATH.fr;

  return {
    meta: [
      { title },
      { name: "description", content: description },
      { name: "application-name", content: SITE.name },
      { name: "theme-color", content: "#FFFFFF" },
      ...(input.noindex
        ? [{ name: "robots", content: "noindex, follow" }]
        : []),

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
      { rel: "alternate", hrefLang: "en", href: absoluteUrl(enAlternatePath) },
      { rel: "alternate", hrefLang: "fr", href: absoluteUrl(frAlternatePath) },
      {
        rel: "alternate",
        hrefLang: "x-default",
        href: absoluteUrl(enAlternatePath),
      },
    ],
    scripts: [jsonLdScript(locale)],
  };
}
