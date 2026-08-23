/** Minimal tag/attribute reader for the site's own prerendered HTML. */

export type Attributes = Readonly<Record<string, string>>;

const ATTRIBUTE = /([a-zA-Z][a-zA-Z0-9-]*)="([^"]*)"/g;

function parseAttributes(tag: string): Attributes {
  const attributes: Record<string, string> = {};
  for (const match of tag.matchAll(ATTRIBUTE)) {
    attributes[match[1].toLowerCase()] = match[2];
  }
  return attributes;
}

function tags(html: string, name: string): Attributes[] {
  const pattern = new RegExp(`<${name}\\b[^>]*>`, "gi");
  return (html.match(pattern) ?? []).map(parseAttributes);
}

export function htmlLang(html: string): string | undefined {
  return tags(html, "html")[0]?.lang;
}

export function linkHrefs(html: string, rel: string): string[] {
  return tags(html, "link")
    .filter((attributes) => attributes.rel === rel)
    .map((attributes) => attributes.href ?? "");
}

export function alternateHrefs(html: string): Map<string, string> {
  const alternates = new Map<string, string>();
  for (const attributes of tags(html, "link")) {
    if (attributes.rel !== "alternate") continue;
    const hrefLang = attributes.hreflang;
    if (!hrefLang) continue;
    alternates.set(hrefLang, attributes.href ?? "");
  }
  return alternates;
}

export function metaContent(
  html: string,
  selector: { name?: string; property?: string },
): string | undefined {
  const key = selector.name ? "name" : "property";
  const wanted = selector.name ?? selector.property;
  return tags(html, "meta").find(
    (attributes) => attributes[key] === wanted,
  )?.content;
}

const JSON_LD =
  /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;

export function jsonLdPayloads(html: string): string[] {
  return Array.from(html.matchAll(JSON_LD), (match) => match[1]);
}

/** Visible text, with tags and script/style bodies removed. */
export function visibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
}
