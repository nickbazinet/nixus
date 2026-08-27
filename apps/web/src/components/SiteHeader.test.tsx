import { screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

import { renderWithProviders } from "@/lib/test-utils";

vi.mock("@tanstack/react-router", () => ({
  useLocation: () => ({ pathname: "/" }),
}));

import { SiteHeader } from "./SiteHeader";

describe("SiteHeader", () => {
  it("renders the Nixus wordmark", () => {
    renderWithProviders(<SiteHeader />);
    expect(screen.getByText("ixus")).toBeInTheDocument();
  });

  it("renders the Beta nav link", () => {
    renderWithProviders(<SiteHeader />);
    expect(screen.getByTestId("header-beta-link")).toHaveAttribute(
      "href",
      "/beta",
    );
    expect(screen.getByTestId("header-beta-link")).toHaveTextContent("Beta");
  });

  it("renders the DownloadCTA", () => {
    renderWithProviders(<SiteHeader />);
    expect(screen.getByTestId("download-cta")).toBeInTheDocument();
    expect(screen.getByText("Choose your platform")).toBeInTheDocument();
    expect(screen.getByTestId("download-cta-macos")).toBeInTheDocument();
    expect(screen.getByTestId("download-cta-windows")).toBeInTheDocument();
  });

  it("renders the theme toggle with translated aria-label", () => {
    renderWithProviders(<SiteHeader />);
    expect(screen.getByTestId("theme-toggle")).toHaveAttribute(
      "aria-label",
      "Toggle theme",
    );
  });

  it("renders the language toggle with translated aria-label", () => {
    renderWithProviders(<SiteHeader />);
    expect(screen.getByTestId("language-toggle")).toHaveAttribute(
      "aria-label",
      "Toggle language",
    );
  });

  /* jsdom applies no stylesheet, so these three assert the responsive contract
   * at the class level. The measured behaviour — 56/64/80px bar, 44px targets,
   * no overlap — is locked in `tests/e2e/responsive.spec.ts`, which runs a real
   * browser at 320/375/390/430/768/1280px. */
  it("steps the header height down for phone and tablet chrome", () => {
    const { container } = renderWithProviders(<SiteHeader />);
    const bar = container.querySelector("header > div");
    expect(bar).toHaveClass("h-14", "sm:h-16", "lg:h-20");
  });

  it("keeps the Beta destination reachable on a phone", () => {
    renderWithProviders(<SiteHeader />);
    // It used to be `hidden sm:inline-flex`, which deleted the destination for
    // exactly the visitors who cannot reach it any other way.
    expect(screen.getByTestId("header-beta-link")).not.toHaveClass("hidden");
  });

  it("keeps the full download affordance out of phone sticky chrome", () => {
    renderWithProviders(<SiteHeader />);
    const ctaSlot = screen.getByTestId("download-cta").parentElement;
    expect(ctaSlot).toHaveClass("hidden", "lg:block");
  });
});
