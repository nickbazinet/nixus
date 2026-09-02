/**
 * Entity structured data for the marketing site.
 *
 * Emits exactly two schema.org nodes — `WebSite` and `Organization` — built
 * only from facts this repository can verify: the site name, the canonical
 * origin, the UI languages that ship, the committed logo asset, the public
 * support mailbox and the public repository URL. No ratings, reviews,
 * unowned social profiles or app-store metadata: unverifiable entity claims
 * are worse than none.
 */

import { CONTACT_EMAIL } from "@/content/contact";
import i18n from "@/lib/i18n";
import { SITE, absoluteUrl, type Locale } from "@/lib/site";

const WEBSITE_ID = absoluteUrl("/#website");
const ORGANIZATION_ID = absoluteUrl("/#organization");

/** Both UI languages the site actually ships, as IETF tags. */
const SITE_LANGUAGES = ["en-CA", "fr-CA"] as const;

// public/icon-512.png, committed at these dimensions.
const LOGO = {
  path: "/icon-512.png",
  size: 512,
} as const;

type ImageObjectNode = {
  "@type": "ImageObject";
  url: string;
  width: number;
  height: number;
};

type WebSiteNode = {
  "@type": "WebSite";
  "@id": string;
  url: string;
  name: string;
  description: string;
  inLanguage: readonly string[];
  publisher: { "@id": string };
};

type OrganizationNode = {
  "@type": "Organization";
  "@id": string;
  name: string;
  url: string;
  email: string;
  sameAs: readonly string[];
  logo: ImageObjectNode;
};

export type SiteGraph = {
  "@context": "https://schema.org";
  "@graph": readonly [WebSiteNode, OrganizationNode];
};

function websiteNode(locale: Locale): WebSiteNode {
  const t = i18n.getFixedT(locale);
  const description =
    (t("meta.home.description") as string) || SITE.defaultDescription;

  return {
    "@type": "WebSite",
    "@id": WEBSITE_ID,
    url: absoluteUrl("/"),
    name: SITE.name,
    description,
    inLanguage: SITE_LANGUAGES,
    publisher: { "@id": ORGANIZATION_ID },
  };
}

function organizationNode(): OrganizationNode {
  return {
    "@type": "Organization",
    "@id": ORGANIZATION_ID,
    name: SITE.name,
    url: absoluteUrl("/"),
    email: CONTACT_EMAIL,
    // The public repository is the only off-site profile this project owns.
    sameAs: [SITE.repositoryUrl],
    logo: {
      "@type": "ImageObject",
      url: absoluteUrl(LOGO.path),
      width: LOGO.size,
      height: LOGO.size,
    },
  };
}

/** The `WebSite` + `Organization` graph for a page in `locale`. */
export function siteGraph(locale: Locale): SiteGraph {
  return {
    "@context": "https://schema.org",
    "@graph": [websiteNode(locale), organizationNode()],
  };
}

/**
 * Serialize for embedding in a `<script>` body.
 *
 * A raw `<` inside script content can terminate the element early, so it is
 * escaped to its JSON unicode form — still valid JSON to every parser.
 */
export function serializeJsonLd(graph: SiteGraph): string {
  return JSON.stringify(graph).replace(/</g, "\\u003c");
}

/** Head-script descriptor consumed by TanStack Start's `head()`. */
export function jsonLdScript(locale: Locale): {
  type: string;
  children: string;
} {
  return {
    type: "application/ld+json",
    children: serializeJsonLd(siteGraph(locale)),
  };
}
