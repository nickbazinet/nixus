import { screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@/lib/test-utils";
import { AIDemo } from "./AIDemo";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("<AIDemo />", () => {
  it("renders the section heading above the demo figure", () => {
    renderWithProviders(<AIDemo />);
    expect(
      screen.getByRole("heading", { level: 2, name: /Statement in\. Categorized out\./i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/No bank login required/i)).toBeInTheDocument();
  });

  it("renders the figure with the translated aria-label", () => {
    renderWithProviders(<AIDemo />);
    const fig = screen.getByLabelText(/AI parsing demo:/i);
    expect(fig.tagName.toLowerCase()).toBe("figure");
  });

  it("renders the statement column with five real Canadian merchants", () => {
    renderWithProviders(<AIDemo />);
    const statement = screen.getByTestId("ai-demo-statement");
    const lines = within(statement).getAllByTestId("ai-demo-statement-line");
    expect(lines).toHaveLength(5);
    expect(within(statement).getByText(/COSTCO/)).toBeInTheDocument();
    expect(within(statement).getByText(/TIM HORTONS/)).toBeInTheDocument();
    expect(within(statement).getByText(/PETRO-CANADA/)).toBeInTheDocument();
  });

  it("renders the categorized column with five rows and translated category badges", () => {
    renderWithProviders(<AIDemo />);
    const categorized = screen.getByTestId("ai-demo-categorized");
    const rows = within(categorized).getAllByTestId(
      "ai-demo-categorized-row",
    );
    expect(rows).toHaveLength(5);
    expect(within(categorized).getByText("Groceries")).toBeInTheDocument();
    expect(within(categorized).getByText("Dining Out")).toBeInTheDocument();
    expect(within(categorized).getByText("Gas")).toBeInTheDocument();
    expect(within(categorized).getByText("Subscriptions")).toBeInTheDocument();
    expect(within(categorized).getByText("Investing")).toBeInTheDocument();
  });

  it("renders the summary banner with the punchline copy", () => {
    renderWithProviders(<AIDemo />);
    const summary = screen.getByTestId("ai-demo-summary");
    expect(summary).toHaveTextContent(
      /5 transactions categorized in 2\.4 seconds/i,
    );
  });

  it("does not place any focusable elements inside the demo", () => {
    renderWithProviders(<AIDemo />);
    const demo = screen.getByTestId("ai-demo");
    const focusable = demo.querySelectorAll(
      'a, button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    expect(focusable.length).toBe(0);
  });

  it("uses the IntersectionObserver-less fallback path under jsdom", () => {
    renderWithProviders(<AIDemo />);
    expect(screen.getByTestId("ai-demo").className).toMatch(
      /ai-demo--animated/,
    );
  });
});
