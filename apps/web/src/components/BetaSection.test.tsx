import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import en from "@/locales/en.json";
import { renderWithProviders } from "@/lib/test-utils";

import { BetaSection } from "./BetaSection";

const enKeys = en as Record<string, string>;

describe("<BetaSection />", () => {
  it("renders limitations and beta invite copy", () => {
    renderWithProviders(<BetaSection />);

    expect(screen.getByTestId("beta-section")).toHaveAttribute("id", "beta");
    expect(
      screen.getByRole("heading", { name: enKeys["beta.limitations.heading"]! }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(enKeys["beta.invite.body"]!),
    ).toBeInTheDocument();
  });

  it("lists every configured limitation", () => {
    renderWithProviders(<BetaSection />);
    const items = screen.getByTestId("beta-limitations-list").querySelectorAll("li");
    expect(items.length).toBe(6);
  });

  it("links the beta CTA to mailto with a subject", () => {
    renderWithProviders(<BetaSection />);
    const cta = screen.getByTestId("beta-invite-cta");
    expect(cta.getAttribute("href")).toMatch(
      /^mailto:support@nixus\.nicolasbazinet\.net\?subject=/,
    );
  });

  it("links to the full beta guide page", () => {
    renderWithProviders(<BetaSection />);
    expect(screen.getByTestId("beta-full-guide-link")).toHaveAttribute(
      "href",
      "/beta",
    );
  });
});
