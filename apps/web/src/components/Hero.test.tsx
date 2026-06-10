import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@/lib/test-utils";
import { DownloadStateProvider } from "@/features/download/DownloadStateContext";

vi.mock("@tanstack/react-router", () => ({
  useLocation: () => ({ pathname: "/" }),
}));

import { Hero } from "./Hero";

const HEADLINE = "Stay on top of your money — not buried in spreadsheets.";

function renderHero(props: Partial<Parameters<typeof Hero>[0]> = {}) {
  return renderWithProviders(
    <DownloadStateProvider>
      <Hero {...props} />
    </DownloadStateProvider>,
  );
}

describe("<Hero />", () => {
  it("renders the translated headline as the only <h1>", () => {
    renderHero();
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1).toHaveTextContent(HEADLINE);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("renders the translated subhead text", () => {
    renderHero();
    expect(
      screen.getByText(/upload a credit card statement/i),
    ).toBeInTheDocument();
  });

  it("renders the marketing eyebrow from i18n by default", () => {
    renderHero();
    expect(screen.getByTestId("hero-eyebrow")).toHaveTextContent(
      /Local-first · No bank passwords/i,
    );
  });

  it("prefers an explicit eyebrow prop over the i18n default", () => {
    renderHero({ eyebrow: "The pitch" });
    expect(screen.getByTestId("hero-eyebrow")).toHaveTextContent("The pitch");
  });

  it("omits the eyebrow when the prop is an empty string", () => {
    renderHero({ eyebrow: "" });
    expect(screen.queryByTestId("hero-eyebrow")).not.toBeInTheDocument();
  });

  it("mounts a DownloadCTA inside the hero", () => {
    renderHero();
    expect(screen.getByTestId("download-cta")).toBeInTheDocument();
  });
});
