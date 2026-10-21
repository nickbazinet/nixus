import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { foundingFocusIds } from "@/content/foundingPitch";
import { renderWithProviders } from "@/lib/test-utils";

import { BetaSection } from "./BetaSection";

describe("<BetaSection />", () => {
  it("presents the Founding Users invitation", () => {
    renderWithProviders(<BetaSection />);

    expect(screen.getByTestId("beta-section")).toHaveAttribute("id", "beta");
    expect(
      screen.getByRole("heading", { name: "Become a Nixus Founding User" }),
    ).toBeInTheDocument();
  });

  // The limitations list moved to `<IsIsnt />`. Asserting its absence here is
  // what keeps the duplication from coming back: this section led with the same
  // six items before the redesign, and re-adding them would restore a founding
  // invitation buried under a disclaimer list.
  it("no longer restates the limitations that <IsIsnt /> owns", () => {
    renderWithProviders(<BetaSection />);
    expect(screen.queryByTestId("beta-limitations-list")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /What Nixus is — and isn't/ }),
    ).not.toBeInTheDocument();
  });

  it("qualifies the reader with the spreadsheet focus list", () => {
    renderWithProviders(<BetaSection />);
    const items = screen.getByTestId("beta-focus-list").querySelectorAll("li");
    expect(items).toHaveLength(foundingFocusIds.length);
  });

  // Downloading is the page's primary action; a second brand fill two sections
  // above the closing band gave the page two conclusions.
  it("renders the program CTA at ghost emphasis, not brand fill", () => {
    renderWithProviders(<BetaSection />);
    const cta = screen.getByTestId("beta-invite-cta");
    expect(cta.className).toContain("bg-card");
    expect(cta.className).not.toContain("bg-primary");
  });

  it("links the program CTA to the canonical address and subject", () => {
    renderWithProviders(<BetaSection />);
    const cta = screen.getByTestId("beta-invite-cta");
    expect(cta).toHaveAttribute(
      "href",
      "mailto:nixusapp@gmail.com?subject=Nixus%20Founding%20User%20Program",
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
