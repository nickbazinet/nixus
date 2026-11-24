/**
 * SEO + social meta helper for the Nixus marketing site.
 *
 * A route names the page and its locale; everything else is derived. That is
 * deliberate: canonical, `og:url`, the `hreflang` cluster, `og:locale`, the
 * title, the description and the JSON-LD graph all have to agree about which
 * page in which language this is, and the only way to guarantee that is to
 * compute them from one pair of inputs.
 *
 * Every absolute URL it emits goes through `absoluteUrl()` on `SITE.url`, so
 * canonical, og:url, hreflang, sitemap and JSON-LD can never disagree on host
 * or on root trailing slash.
 */

import { copyFor } from "@/content/index";
import { jsonLdScript } from "./jsonLd";
import { LANG_TAG, LOCALES, OG_LOCALE, otherLocale, type Locale } from "./locale";
import { canonicalAlternates, canonicalPath, isNoindex, type PageId } from "./routes";
import { SITE, absoluteUrl } from "./site";

export { SITE };

type MetaInput = {
  /** Which page this is. Drives canonical, og:url and the hreflang cluster. */
  page: PageId;
  /** Which language this page is. Drives `<title>`, og:locale and hreflang. */
  locale: Locale;
  /** Absolute URL for an OG image override. Defaults to `SITE.ogImage`. */
  ogImage?: string;
};

/** Return type of `buildMeta`. Matches TanStack Start's head-config shape. */
export type SiteMeta = ReturnType<typeof buildMeta>;

export function buildMeta(input: MetaInput) {
  const copy = copyFor(input.locale);
  const { title, description } = copy.meta.pages[input.page];
  const url = absoluteUrl(canonicalPath(input.page, input.locale));
  const ogImage = input.ogImage ?? SITE.ogImage;
  const alternates = canonicalAlternates(input.page);

  return {
    meta: [
      { title },
      { name: "description", content: description },
      { name: "application-name", content: SITE.name },
      { name: "theme-color", content: "#F8FBFF" },
      ...(isNoindex(input.page) ? [{ name: "robots", content: "noindex, follow" }] : []),

      // Open Graph
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: SITE.name },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:url", content: url },
      { property: "og:image", content: ogImage },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:image:alt", content: copy.meta.ogImageAlt },
      { property: "og:locale", content: OG_LOCALE[input.locale] },
      {
        property: "og:locale:alternate",
        content: OG_LOCALE[otherLocale(input.locale)],
      },

      // Twitter
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: title },
      { name: "twitter:description", content: description },
      { name: "twitter:image", content: ogImage },
    ],
    links: [
      { rel: "canonical", href: url },
      // The full cluster on BOTH pages, including a self-reference: an
      // alternate set that is not reciprocal is one Google discards.
      ...LOCALES.map((locale) => ({
        rel: "alternate",
        hrefLang: LANG_TAG[locale],
        href: absoluteUrl(alternates[locale]),
      })),
      // English is what an unmatched visitor gets, which is what x-default means.
      { rel: "alternate", hrefLang: "x-default", href: absoluteUrl(alternates.en) },
    ],
    scripts: [jsonLdScript(input.locale)],
  };
}
