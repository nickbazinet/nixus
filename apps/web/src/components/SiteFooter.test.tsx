import { screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import i18n from "@/lib/i18n";

import { renderWithProviders } from "@/lib/test-utils";
import { SiteFooter } from "./SiteFooter";

const SUPPORT_EMAIL = "support@nixus.nicolasbazinet.net";

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
      name: new RegExp(SUPPORT_EMAIL.replace(/\./g, "\\."), "i"),
    });
    expect(mail).toHaveAttribute("href", `mailto:${SUPPORT_EMAIL}`);
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
      await i18n.changeLanguage("en");
    }
  });
});
