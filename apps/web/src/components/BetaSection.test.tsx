import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithProviders } from "@/lib/test-utils";

import { BetaSection } from "./BetaSection";

describe("<BetaSection />", () => {
  it("presents the Founding Users invitation", () => {
    renderWithProviders(<BetaSection />);

    expect(screen.getByTestId("beta-section")).toHaveAttribute("id", "beta");
    expect(
      screen.getByRole("heading", { name: "What Nixus is — and isn't" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Become a Nixus Founding User" }),
    ).toBeInTheDocument();
  });

  it("lists every configured limitation", () => {
    renderWithProviders(<BetaSection />);
    const items = screen.getByTestId("beta-limitations-list").querySelectorAll("li");
    expect(items.length).toBe(6);
  });

  it("links the program CTA to the canonical address and subject", () => {
    renderWithProviders(<BetaSection />);
    const cta = screen.getByTestId("beta-invite-cta");
    expect(cta).toHaveAttribute(
      "href",
      "mailto:nixus@gmail.com?subject=Nixus%20Founding%20User%20Program",
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
