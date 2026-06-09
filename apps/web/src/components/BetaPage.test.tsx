import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

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
      screen.getByRole("heading", { name: enKeys["betaPage.fit.heading"]! }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: enKeys["betaPage.feedback.heading"]!,
      }),
    ).toBeInTheDocument();
  });

  it("lists good-fit and not-for-you criteria", () => {
    renderWithProviders(<BetaPage />);
    expect(screen.getByTestId("beta-fit-good")).toBeInTheDocument();
    expect(screen.getByTestId("beta-fit-bad")).toBeInTheDocument();
    expect(
      screen.getByText(enKeys["betaPage.fit.good.spreadsheet"]!),
    ).toBeInTheDocument();
    expect(
      screen.getByText(enKeys["betaPage.fit.bad.bankSync"]!),
    ).toBeInTheDocument();
  });

  it("links feedback CTA to mailto with a subject", () => {
    renderWithProviders(<BetaPage />);
    const cta = screen.getByTestId("beta-feedback-cta");
    expect(cta.getAttribute("href")).toMatch(
      /^mailto:support@nixus\.nicolasbazinet\.net\?subject=/,
    );
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
      screen.getByAltText(enKeys["betaPage.screenshots.netWorth.alt"]!),
    ).toHaveAttribute("src", "/beta/accounts.png");
  });
});
