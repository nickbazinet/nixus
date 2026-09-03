import { screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@/lib/test-utils";
import { AIDemoFigure } from "./AIDemo";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("<AIDemoFigure />", () => {
  it("renders as a self-contained figure with the translated summary label", () => {
    renderWithProviders(<AIDemoFigure />);
    const fig = screen.getByLabelText(/AI parsing demo:/i);
    expect(fig.tagName.toLowerCase()).toBe("figure");
    expect(fig).toBe(screen.getByTestId("ai-demo-figure"));
  });

  it("carries no heading of its own, so the embedding hero owns the copy", () => {
    renderWithProviders(<AIDemoFigure />);
    expect(screen.queryAllByRole("heading")).toEqual([]);
  });

  it("renders the statement column with five real Canadian merchants", () => {
    renderWithProviders(<AIDemoFigure />);
    const statement = screen.getByTestId("ai-demo-statement");
    const lines = within(statement).getAllByTestId("ai-demo-statement-line");
    expect(lines).toHaveLength(5);
    expect(within(statement).getByText(/COSTCO/)).toBeInTheDocument();
    expect(within(statement).getByText(/TIM HORTONS/)).toBeInTheDocument();
    expect(within(statement).getByText(/PETRO-CANADA/)).toBeInTheDocument();
  });

  it("renders the categorized column with five rows and translated category badges", () => {
    renderWithProviders(<AIDemoFigure />);
    const categorized = screen.getByTestId("ai-demo-categorized");
    const rows = within(categorized).getAllByTestId("ai-demo-categorized-row");
    expect(rows).toHaveLength(5);
    expect(within(categorized).getByText("Groceries")).toBeInTheDocument();
    expect(within(categorized).getByText("Dining Out")).toBeInTheDocument();
    expect(within(categorized).getByText("Gas")).toBeInTheDocument();
    expect(within(categorized).getByText("Subscriptions")).toBeInTheDocument();
    expect(within(categorized).getByText("Investing")).toBeInTheDocument();
  });

  it("renders the summary banner with the punchline copy", () => {
    renderWithProviders(<AIDemoFigure />);
    const summary = screen.getByTestId("ai-demo-summary");
    expect(summary).toHaveTextContent(
      /5 transactions categorized in 2\.4 seconds/i,
    );
  });

  it("does not place any focusable elements inside the demo", () => {
    renderWithProviders(<AIDemoFigure />);
    const demo = screen.getByTestId("ai-demo");
    const focusable = demo.querySelectorAll(
      'a, button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    expect(focusable.length).toBe(0);
  });

  it("keeps the animated scan line for the IntersectionObserver to reveal", () => {
    renderWithProviders(<AIDemoFigure />);
    expect(screen.getByTestId("ai-demo-scan-line")).toBeInTheDocument();
  });

  it("uses the IntersectionObserver-less fallback path under jsdom", () => {
    renderWithProviders(<AIDemoFigure />);
    expect(screen.getByTestId("ai-demo").className).toMatch(
      /ai-demo--animated/,
    );
  });

  it("sets both columns' money in tabular Inter, never a mono face", () => {
    renderWithProviders(<AIDemoFigure />);
    const amounts = screen.getAllByTestId("ai-demo-amount");
    expect(amounts).toHaveLength(10);
    for (const amount of amounts) {
      expect(amount).toHaveClass("tabular-nums");
      expect(amount.className).not.toMatch(/font-mono/);
    }
    expect(
      screen.getByTestId("ai-demo").querySelectorAll(".font-mono"),
    ).toHaveLength(0);
  });

  it("delegates its elevation to ProductFrame instead of a local shadow", () => {
    renderWithProviders(<AIDemoFigure />);
    const figure = screen.getByTestId("ai-demo-figure");
    expect(figure).toHaveClass("mkt-product-frame");
    // The frame owns the recipe; a call-site override is what the single-recipe
    // contract exists to prevent.
    expect(figure.getAttribute("style")).toBeNull();
  });
});
