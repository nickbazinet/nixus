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

  it("renders the Founding nav link at the existing beta path", () => {
    renderWithProviders(<SiteHeader />);
    const link = screen.getByTestId("header-beta-link");
    expect(link).toHaveAttribute("href", "/beta");
    expect(link).toHaveTextContent("Founding");
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

  it("keeps the Founding destination reachable on a phone", () => {
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

  /* Warm Editorial harmonises the marketing chrome palette, and this component
   * already inherits it: every surface decision here is a semantic alias
   * (`border-border`, `bg-background`, `text-muted-foreground`, `text-primary`,
   * `ring-ring`), so the warm `:root:not(.dark)` override reaches it with no
   * edit. These two tests exist to keep it that way and to pin the single
   * deliberate literal. */
  describe("Warm Editorial chrome palette", () => {
    /* The wordmark gradient is NOT a palette decision. `#A78BFA` and `#F472B6`
     * are `--logo-stop-2` and `--logo-stop-3`, declared in `:root` with no dark
     * override because brand identity is mode-independent, and DESIGN.md keeps
     * `{components.logo-gradient}` outside the palette entirely. Repainting it
     * warm would be an identity change, not a harmonisation — so it is the one
     * documented raw-value exception in the chrome. */
    it("preserves the Nixus identity gradient on the wordmark", () => {
      renderWithProviders(<SiteHeader />);
      expect(screen.getByText("ixus")).toHaveClass(
        "bg-gradient-to-r",
        "from-[#A78BFA]",
        "to-[#F472B6]",
        "bg-clip-text",
        "text-transparent",
      );
    });

    it("draws every surface it owns from a semantic alias", () => {
      const { container } = renderWithProviders(<SiteHeader />);
      const owned = {
        header: container.querySelector("header"),
        bar: container.querySelector("header > div"),
        brand: container.querySelector('header a[aria-label]'),
        founding: screen.getByTestId("header-beta-link"),
        ctaSlot: screen.getByTestId("download-cta").parentElement,
      };

      const RAW_VALUE =
        /\b(?:amber|slate|zinc|gray|neutral|stone|emerald|teal|rose|sky|indigo|violet|fuchsia|pink)-\d{2,3}\b|(?:bg|text|border|ring)-\[#/;

      for (const [where, el] of Object.entries(owned)) {
        expect(el, `${where} missing`).not.toBeNull();
        expect(el?.className ?? "", `${where} uses a raw value`).not.toMatch(
          RAW_VALUE,
        );
      }

      // The sticky surface at rest. The scrolled swap to `border-border` +
      // `bg-background/85` is measured for real in
      // `tests/e2e/chrome-notices.spec.ts`, where a stale cool hairline fails.
      expect(owned.header?.className).toContain("bg-background/0");
      expect(owned.header?.className).toContain("sticky");
    });
  });
});
