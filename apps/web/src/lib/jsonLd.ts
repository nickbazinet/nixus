/**
 * Entity structured data for the marketing site.
 *
 * Emits exactly two schema.org nodes — `WebSite` and `Organization` — built
 * only from facts this repository can verify: the site name, the canonical
 * origin, the UI languages that ship, the committed logo asset, the public
 * support mailbox and the public repository URL. No ratings, reviews,
 * unowned social profiles or app-store metadata: unverifiable entity claims
 * are worse than none.
 *
 * `inLanguage` is the page's own language, not the list of languages the site
 * happens to ship: the graph is embedded in one prerendered document, and
 * claiming a French page is also English contradicts its own `<html lang>` and
 * its `hreflang` cluster.
 */

import { CONTACT_EMAIL } from "@/content/contact";
import { copyFor } from "@/content/index";
import { LANG_TAG, type Locale } from "@/lib/locale";
import { SITE, absoluteUrl } from "@/lib/site";

const WEBSITE_ID = absoluteUrl("/#website");
const ORGANIZATION_ID = absoluteUrl("/#organization");

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
  inLanguage: string;
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
  return {
    "@type": "WebSite",
    "@id": WEBSITE_ID,
    url: absoluteUrl("/"),
    name: SITE.name,
    description: copyFor(locale).meta.siteDescription,
    inLanguage: LANG_TAG[locale],
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

/** The `WebSite` + `Organization` graph shared by every page of one language. */
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
