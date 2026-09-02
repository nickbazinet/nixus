import { act, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import i18n from "@/lib/i18n";
import { renderWithProviders } from "@/lib/test-utils";

import { FoundingPitch } from "./FoundingPitch";

describe("<FoundingPitch />", () => {
  it("states that Nixus is recruiting founding users", () => {
    renderWithProviders(<FoundingPitch />);

    expect(
      screen.getByRole("heading", { name: "Looking for founding users" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/actively manage their own finances/i)).toBeInTheDocument();
    expect(screen.getByText(/Excel or Google Sheets/i)).toBeInTheDocument();
  });

  it("lists the five financial areas the program cares about", () => {
    renderWithProviders(<FoundingPitch />);
    const items = screen
      .getByTestId("founding-pitch-focus")
      .querySelectorAll("li");

    expect([...items].map((item) => item.textContent)).toEqual([
      "Expenses and budgets",
      "Net worth",
      "Investments",
      "Savings",
      "Financial goals",
    ]);
  });

  it("promises early access and influence in exchange for candid feedback", () => {
    renderWithProviders(<FoundingPitch />);

    expect(screen.getByText(/early access/i)).toBeInTheDocument();
    expect(screen.getByText(/candid feedback/i)).toBeInTheDocument();
  });

  it("invites contact through the canonical program address", () => {
    renderWithProviders(<FoundingPitch />);

    expect(screen.getByTestId("founding-pitch-cta")).toHaveAttribute(
      "href",
      "mailto:nixus@gmail.com?subject=Nixus%20Founding%20User%20Program",
    );
    expect(
      screen.getByText(
        "Interested? Send a short email about how you track your finances today, or download the app now.",
      ),
    ).toBeInTheDocument();
  });

  it("renders the recruitment message in French", async () => {
    await act(async () => {
      await i18n.changeLanguage("fr");
    });
    try {
      renderWithProviders(<FoundingPitch />);

      expect(
        screen.getByRole("heading", {
          name: "À la recherche d'utilisateurs fondateurs",
        }),
      ).toBeInTheDocument();
      expect(screen.getByText(/Excel ou Google Sheets/i)).toBeInTheDocument();
      expect(screen.getByTestId("founding-pitch-cta")).toHaveAttribute(
        "href",
        "mailto:nixus@gmail.com?subject=Programme%20des%20utilisateurs%20fondateurs%20Nixus",
      );
    } finally {
      await act(async () => {
        await i18n.changeLanguage("en");
      });
    }
  });
});
