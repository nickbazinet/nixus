import { act, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import i18n from "@/lib/i18n";

import { renderWithProviders } from "@/lib/test-utils";
import { SiteFooter } from "./SiteFooter";

const CONTACT_EMAIL = "nixus@gmail.com";

describe("SiteFooter", () => {
  it("renders a GitHub link pointing to the repo", () => {
    renderWithProviders(<SiteFooter />);
    const link = screen.getByRole("link", { name: /github/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute(
      "href",
      "https://github.com/nickbazinet/nixus",
    );
  });

  it("renders a mailto contact link to the new support address", () => {
    renderWithProviders(<SiteFooter />);
    const mail = screen.getByRole("link", {
      name: new RegExp(CONTACT_EMAIL.replace(/\./g, "\\."), "i"),
    });
    expect(mail).toHaveAttribute("href", `mailto:${CONTACT_EMAIL}`);
  });

  it("renders a Buy Me a Coffee link with the creator profile URL", () => {
    renderWithProviders(<SiteFooter />);
    const link = screen.getByRole("link", { name: /buy me a coffee/i });
    expect(link).toHaveAttribute("href", "https://buymeacoffee.com/nickbaz");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("renders the Pre-alpha label in the nav row", () => {
    renderWithProviders(<SiteFooter />);
    expect(screen.getByText("Pre-alpha")).toBeInTheDocument();
  });

  it("renders the new copyright line and drops the legacy attribution", () => {
    renderWithProviders(<SiteFooter />);
    expect(
      screen.getByText(/Copyright © Nixus 2026 — All rights reserved/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Built in Canada by Nbazinet/)).toBeNull();
  });

  it("renders the FR copyright line when the current locale is fr", async () => {
    await i18n.changeLanguage("fr");
    try {
      renderWithProviders(<SiteFooter />);
      expect(
        screen.getByText(/Copyright © Nixus 2026 — Tous droits réservés/),
      ).toBeInTheDocument();
    } finally {
      // The FR-rendered footer is still mounted here — Testing Library unmounts in
      // its own afterEach, which runs after this body. `useTranslation` subscribes
      // to `languageChanged`, so restoring the language IS a React update and has
      // to be wrapped or it lands outside act(...).
      await act(async () => {
        await i18n.changeLanguage("en");
      });
    }
  });

  // AD-13 makes Terms and Privacy the sole hosted-AI disclosure mechanism, so an
  // unreachable legal page is a rollout blocker, not a cosmetic gap.
  it("links to the Terms of Service", () => {
    renderWithProviders(<SiteFooter />);
    const link = screen.getByRole("link", { name: /^Terms$/i });
    expect(link).toHaveAttribute("href", "/terms");
  });

  it("links to the Privacy Policy", () => {
    renderWithProviders(<SiteFooter />);
    const link = screen.getByRole("link", { name: /^Privacy$/i });
    expect(link).toHaveAttribute("href", "/privacy");
  });

  it("keeps both legal links inside the labelled footer nav", () => {
    renderWithProviders(<SiteFooter />);
    const nav = screen.getByRole("navigation", { name: /footer/i });
    expect(nav).toContainElement(screen.getByRole("link", { name: /^Terms$/i }));
    expect(nav).toContainElement(
      screen.getByRole("link", { name: /^Privacy$/i }),
    );
  });

  /* A French visitor sent to /terms would silently read the English disclosure, and
   * AD-13 makes these documents the disclosure mechanism itself — so the locale of
   * the link is load-bearing, not cosmetic. */
  it("links to the French legal pages when the locale is fr", async () => {
    await act(async () => {
      await i18n.changeLanguage("fr");
    });
    try {
      renderWithProviders(<SiteFooter />);

      expect(
        screen.getByRole("link", { name: /^Conditions$/i }),
      ).toHaveAttribute("href", "/fr/terms");
      expect(
        screen.getByRole("link", { name: /^Confidentialité$/i }),
      ).toHaveAttribute("href", "/fr/privacy");
    } finally {
      await act(async () => {
        await i18n.changeLanguage("en");
      });
    }
  });

  it("never points a French visitor at the English disclosures", async () => {
    await act(async () => {
      await i18n.changeLanguage("fr");
    });
    try {
      renderWithProviders(<SiteFooter />);
      const hrefs = screen
        .getAllByRole("link")
        .map((link) => link.getAttribute("href"));

      expect(hrefs).not.toContain("/terms");
      expect(hrefs).not.toContain("/privacy");
    } finally {
      await act(async () => {
        await i18n.changeLanguage("en");
      });
    }
  });
});
