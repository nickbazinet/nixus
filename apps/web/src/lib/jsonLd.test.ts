import { describe, expect, it } from "vitest";

import "./i18n";
import {
  jsonLdScript,
  serializeJsonLd,
  siteGraph,
  type SiteGraph,
} from "./jsonLd";
import { SITE } from "./site";

function allStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(allStrings);
  if (value && typeof value === "object") {
    return Object.values(value).flatMap(allStrings);
  }
  return [];
}

describe("siteGraph", () => {
  it("emits exactly a WebSite and an Organization node", () => {
    const graph = siteGraph("en");

    expect(graph["@context"]).toBe("https://schema.org");
    expect(graph["@graph"].map((node) => node["@type"])).toEqual([
      "WebSite",
      "Organization",
    ]);
  });

  it("cross-references the Organization as the WebSite publisher", () => {
    const [website, organization] = siteGraph("en")["@graph"];

    expect(website.publisher["@id"]).toBe(organization["@id"]);
    expect(website["@id"]).not.toBe(organization["@id"]);
  });

  it("anchors both nodes on the canonical site root", () => {
    const [website, organization] = siteGraph("en")["@graph"];

    expect(website.url).toBe(`${SITE.url}/`);
    expect(organization.url).toBe(`${SITE.url}/`);
  });

  it("declares both shipped UI languages", () => {
    expect(siteGraph("en")["@graph"][0].inLanguage).toEqual(["en-CA", "fr-CA"]);
  });

  it("describes the site in the page's own language", () => {
    const english = siteGraph("en")["@graph"][0].description;
    const french = siteGraph("fr")["@graph"][0].description;

    expect(english).toBe(SITE.defaultDescription);
    expect(french).not.toBe(english);
    expect(french.length).toBeGreaterThan(0);
  });

  it("points the logo at a committed 512px asset", () => {
    const logo = siteGraph("en")["@graph"][1].logo;

    expect(logo).toEqual({
      "@type": "ImageObject",
      url: `${SITE.url}/icon-512.png`,
      width: 512,
      height: 512,
    });
  });

  it("keeps every absolute URL on the canonical host or owned repository", () => {
    const urls = allStrings(siteGraph("fr")["@graph"]).filter((value) =>
      value.startsWith("http"),
    );

    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(
        url.startsWith(`${SITE.url}/`) || url === SITE.repositoryUrl,
      ).toBe(true);
    }
  });

  it("claims only the owned repository as a social profile", () => {
    // Structured data this repository cannot verify is a manual-action risk,
    // not an SEO win.
    const graph = siteGraph("en");
    const serialized = serializeJsonLd(graph);

    expect(graph["@graph"][1].sameAs).toEqual([SITE.repositoryUrl]);

    for (const unverifiable of [
      "aggregateRating",
      "ratingValue",
      "review",
      "SoftwareApplication",
      "offers",
      "price",
    ]) {
      expect(serialized).not.toContain(unverifiable);
    }
  });

  it("publishes the canonical contact address", () => {
    expect(siteGraph("en")["@graph"][1].email).toBe("nixus@gmail.com");
  });
});

describe("jsonLdScript", () => {
  it("produces a parseable ld+json head script for the page's locale", () => {
    const script = jsonLdScript("fr");

    expect(script.type).toBe("application/ld+json");
    expect(JSON.parse(script.children)).toEqual(siteGraph("fr"));
  });

  it("escapes < so a payload cannot terminate the script element", () => {
    const [website, organization] = siteGraph("en")["@graph"];
    const risky = "Nixus <script>alert(1)</script>";
    const graph: SiteGraph = {
      "@context": "https://schema.org",
      "@graph": [{ ...website, description: risky }, organization],
    };

    const serialized = serializeJsonLd(graph);

    expect(serialized).not.toContain("<");
    expect(JSON.parse(serialized)["@graph"][0].description).toBe(risky);
  });
});
