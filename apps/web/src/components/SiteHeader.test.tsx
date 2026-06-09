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

  it("uses the larger h-20 header height", () => {
    const { container } = renderWithProviders(<SiteHeader />);
    expect(container.querySelector(".h-20")).not.toBeNull();
  });
});
