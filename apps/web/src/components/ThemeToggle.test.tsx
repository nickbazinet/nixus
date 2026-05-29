import { describe, expect, it } from "vitest";
import { fireEvent, screen, act } from "@testing-library/react";

import { renderWithProviders } from "@/lib/test-utils";
import { ThemeToggle } from "./ThemeToggle";

describe("ThemeToggle", () => {
  it("renders a trigger button with translated aria-label", () => {
    renderWithProviders(<ThemeToggle />);
    expect(screen.getByTestId("theme-toggle")).toHaveAttribute(
      "aria-label",
      "Toggle theme",
    );
  });

  it("opens a menu with three theme options", async () => {
    renderWithProviders(<ThemeToggle />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("theme-toggle"));
    });
    expect(screen.getByTestId("theme-toggle-option-light")).toHaveTextContent(
      "Light",
    );
    expect(screen.getByTestId("theme-toggle-option-dark")).toHaveTextContent(
      "Dark",
    );
    expect(screen.getByTestId("theme-toggle-option-system")).toHaveTextContent(
      "System",
    );
  });

  it("marks the active option with data-active", async () => {
    renderWithProviders(<ThemeToggle />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("theme-toggle"));
    });
    // Default theme in test wrapper is "light".
    expect(
      screen.getByTestId("theme-toggle-option-light"),
    ).toHaveAttribute("data-active", "true");
  });
});
