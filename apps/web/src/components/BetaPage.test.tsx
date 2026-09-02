import { act, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import i18n from "@/lib/i18n";
import en from "@/locales/en.json";
import { renderWithProviders } from "@/lib/test-utils";

import { BetaPage } from "./BetaPage";

const enKeys = en as Record<string, string>;

describe("<BetaPage />", () => {
  it("renders the beta page hero and primary sections", () => {
    renderWithProviders(<BetaPage />);

    expect(screen.getByTestId("beta-page")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: enKeys["betaPage.hero.heading"]!,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Looking for founding users" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: enKeys["betaPage.feedback.heading"]!,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "What Nixus is — and isn't" }),
    ).toBeInTheDocument();
  });

  it("groups the founding-user qualification into one block", () => {
    renderWithProviders(<BetaPage />);

    expect(screen.getByTestId("founding-pitch")).toBeInTheDocument();
    expect(
      screen.getByTestId("founding-pitch-focus").querySelectorAll("li"),
    ).toHaveLength(5);
    expect(screen.queryByTestId("beta-fit-good")).not.toBeInTheDocument();
    expect(screen.queryByTestId("beta-fit-bad")).not.toBeInTheDocument();
  });

  it("invites qualified visitors to become Founding Users", () => {
    renderWithProviders(<BetaPage />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Help shape Nixus" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Excel or Google Sheets/i)).toBeInTheDocument();
    expect(screen.getByText(/candid feedback/i)).toBeInTheDocument();
  });

  it("links both program CTAs to the canonical address and subject", () => {
    renderWithProviders(<BetaPage />);
    const expected =
      "mailto:nixus@gmail.com?subject=Nixus%20Founding%20User%20Program";

    expect(screen.getByTestId("beta-hero-cta")).toHaveAttribute("href", expected);
    expect(screen.getByTestId("beta-feedback-cta")).toHaveAttribute(
      "href",
      expected,
    );
    expect(
      screen.getAllByRole("link", { name: "Join the Founding Users Program" }),
    ).toHaveLength(2);
  });

  it("renders the Founding Users program in French", async () => {
    await act(async () => {
      await i18n.changeLanguage("fr");
    });
    try {
      renderWithProviders(<BetaPage />);
      expect(
        screen.getByRole("heading", {
          level: 1,
          name: "Aidez à façonner Nixus",
        }),
      ).toBeInTheDocument();
      expect(screen.getByText(/Excel ou Google Sheets/i)).toBeInTheDocument();
      expect(
        screen.getByRole("heading", {
          name: "Ce que Nixus est — et n'est pas",
        }),
      ).toBeInTheDocument();
      expect(screen.getByTestId("beta-hero-cta")).toHaveAttribute(
        "href",
        "mailto:nixus@gmail.com?subject=Programme%20des%20utilisateurs%20fondateurs%20Nixus",
      );
    } finally {
      await act(async () => {
        await i18n.changeLanguage("en");
      });
    }
  });

  it("renders product screenshots from public assets", () => {
    renderWithProviders(<BetaPage />);
    expect(screen.getByTestId("beta-screenshot-budget")).toBeInTheDocument();
    expect(screen.getByTestId("beta-screenshot-aiImport")).toBeInTheDocument();
    expect(screen.getByTestId("beta-screenshot-netWorth")).toBeInTheDocument();
    expect(
      screen.getByAltText(enKeys["betaPage.screenshots.budget.alt"]!),
    ).toHaveAttribute("src", "/beta/budget.png");
    expect(
      screen.getByAltText(enKeys["betaPage.screenshots.aiImport.alt"]!),
    ).toHaveAttribute("src", "/beta/ai-chat.png");
    expect(
      screen.getByAltText("Nixus accounts and allocation by type"),
    ).toHaveAttribute("src", "/beta/accounts.png");
    for (const image of screen.getAllByRole("img")) {
      expect(image).toHaveClass("h-auto", "w-full");
      expect(image).not.toHaveClass("object-cover", "aspect-[16/10]");
    }
  });
});
