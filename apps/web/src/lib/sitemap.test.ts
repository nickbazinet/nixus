import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("sitemap.xml", () => {
  const sitemapPath = path.resolve(__dirname, "../../public/sitemap.xml");
  const sitemap = fs.readFileSync(sitemapPath, "utf8");

  it("declares the sitemap.org namespace", () => {
    expect(sitemap).toContain("http://www.sitemaps.org/schemas/sitemap/0.9");
  });

  it("contains the homepage URL with lastmod", () => {
    expect(sitemap).toMatch(/<loc>https:\/\/nixus\.app\/?<\/loc>/);
    expect(sitemap).toMatch(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);
  });

  it("parses as valid XML", () => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(sitemap, "application/xml");
    const parserError = doc.querySelector("parsererror");
    expect(parserError).toBeNull();
  });

  it("contains a urlset element with at least one url child", () => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(sitemap, "application/xml");
    const urlset = doc.getElementsByTagName("urlset")[0];
    expect(urlset).toBeTruthy();
    const urls = doc.getElementsByTagName("url");
    expect(urls.length).toBeGreaterThanOrEqual(1);
    const firstUrl = urls[0];
    expect(firstUrl.getElementsByTagName("loc").length).toBe(1);
    expect(firstUrl.getElementsByTagName("lastmod").length).toBe(1);
  });
});
