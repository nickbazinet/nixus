import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { copyFor } from "@/content/index";

/*
 * The switcher is the only way a visitor changes language — there is no
 * `Accept-Language` redirect anywhere, because every URL has to answer with the
 * language it advertises in `hreflang` and in its prerendered HTML.
 */

describe("LanguageSwitcher", () => {
  it("offers both languages, labelled in the page's own language", () => {
    render(<LanguageSwitcher locale="en" pathname="/pricing" />);

    const group = screen.getByRole("navigation", { name: copyFor("en").shell.language.label });
    expect(group).toBeInTheDocument();
    expect(screen.getByText("EN")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View this page in French" })).toBeInTheDocument();
  });

  it("links to the same page in the other language", () => {
    render(<LanguageSwitcher locale="en" pathname="/pricing" />);

    expect(screen.getByRole("link", { name: "View this page in French" })).toHaveAttribute(
      "href",
      "/fr/pricing",
    );
  });

  it("links back to the English twin from a French page", () => {
    render(<LanguageSwitcher locale="fr" pathname="/fr/founding-users" />);

    expect(screen.getByRole("navigation", { name: "Langue" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Voir cette page en anglais" })).toHaveAttribute(
      "href",
      "/founding-users",
    );
  });

  it("slashes a language root, matching the prerendered object", () => {
    render(<LanguageSwitcher locale="en" pathname="/" />);

    expect(screen.getByRole("link", { name: "View this page in French" })).toHaveAttribute(
      "href",
      "/fr/",
    );
  });

  it("marks the language already shown as current, and does not link away", () => {
    render(<LanguageSwitcher locale="fr" pathname="/fr/pricing" />);

    const current = screen.getByRole("link", { name: "français" });
    expect(current).toHaveAttribute("aria-current", "true");
    expect(current).toHaveAttribute("href", "/fr/pricing");
  });

  it("declares each option's language with hreflang, using regional tags", () => {
    render(<LanguageSwitcher locale="en" pathname="/" />);

    expect(screen.getByText("EN").closest("a")).toHaveAttribute("hreflang", "en-CA");
    expect(screen.getByText("FR").closest("a")).toHaveAttribute("hreflang", "fr-CA");
  });

  /*
   * A real `<a href>`, not a router Link: the two languages are two prerendered
   * documents, and only a full navigation fetches the other one.
   */
  it("is a plain anchor, so the browser loads the other document", () => {
    const { container } = render(<LanguageSwitcher locale="en" pathname="/mission" />);

    const links = container.querySelectorAll("a");
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link.getAttribute("href")).toMatch(/^\//);
    }
  });

  it("sends an unknown path to the other language's home rather than a dead URL", () => {
    render(<LanguageSwitcher locale="en" pathname="/retired-page" />);

    expect(screen.getByRole("link", { name: "View this page in French" })).toHaveAttribute(
      "href",
      "/fr/",
    );
  });
});
