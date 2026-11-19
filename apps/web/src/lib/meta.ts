/**
 * SEO + social meta helper for the Nixus marketing site.
 *
 * Every absolute URL it emits goes through `absoluteUrl()` on `SITE.url`, so
 * canonical, og:url and JSON-LD can never disagree on host or on root
 * trailing slash.
 */

import { jsonLdScript } from "./jsonLd";
import { SITE, absoluteUrl } from "./site";

export { SITE };

type MetaInput = {
  /** Path relative to the site root, e.g. "/" or "/pricing". Drives canonical and og:url. */
  path: string;
  /** Override the default page title. Used for `<title>`, og:title, twitter:title. */
  title?: string;
  /** Override the default description. */
  description?: string;
  /** Absolute URL for an OG image override. Defaults to `SITE.ogImage`. */
  ogImage?: string;
  /** Keep this page out of the index. Only for pages that must never rank. */
  noindex?: boolean;
};

/** Return type of `buildMeta`. Matches TanStack Start's head-config shape. */
export type SiteMeta = ReturnType<typeof buildMeta>;

export function buildMeta(input: MetaInput) {
  const title = input.title ?? SITE.defaultTitle;
  const description = input.description ?? SITE.defaultDescription;
  const url = absoluteUrl(input.path);
  const ogImage = input.ogImage ?? SITE.ogImage;

  return {
    meta: [
      { title },
      { name: "description", content: description },
      { name: "application-name", content: SITE.name },
      { name: "theme-color", content: "#F8FBFF" },
      ...(input.noindex ? [{ name: "robots", content: "noindex, follow" }] : []),

      // Open Graph
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: SITE.name },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:url", content: url },
      { property: "og:image", content: ogImage },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:image:alt", content: `${SITE.name} — personal finance, minus the admin.` },
      { property: "og:locale", content: "en_CA" },

      // Twitter
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: title },
      { name: "twitter:description", content: description },
      { name: "twitter:image", content: ogImage },
    ],
    links: [{ rel: "canonical", href: url }],
    scripts: [jsonLdScript()],
  };
}
