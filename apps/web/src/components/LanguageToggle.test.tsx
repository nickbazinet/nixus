import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, act } from "@testing-library/react";

import { renderWithProviders } from "@/lib/test-utils";

const useLocationMock = vi.fn(() => ({ pathname: "/" }));
vi.mock("@tanstack/react-router", () => ({
  useLocation: () => useLocationMock(),
}));

// Imported AFTER the mock so the component picks up the mocked hook.
import { LanguageToggle } from "./LanguageToggle";

describe("LanguageToggle", () => {
  it("links EN to / and FR to /fr/ when current path is /", async () => {
    useLocationMock.mockReturnValue({ pathname: "/" });
    renderWithProviders(<LanguageToggle />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("language-toggle"));
    });
    expect(
      screen.getByTestId("language-toggle-option-en"),
    ).toHaveAttribute("href", "/");
    expect(
      screen.getByTestId("language-toggle-option-fr"),
    ).toHaveAttribute("href", "/fr/");
  });

  it("links EN to / and FR to /fr/ when current path is /fr/", async () => {
    useLocationMock.mockReturnValue({ pathname: "/fr/" });
    renderWithProviders(<LanguageToggle />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("language-toggle"));
    });
    expect(
      screen.getByTestId("language-toggle-option-en"),
    ).toHaveAttribute("href", "/");
    expect(
      screen.getByTestId("language-toggle-option-fr"),
    ).toHaveAttribute("href", "/fr/");
  });
});
