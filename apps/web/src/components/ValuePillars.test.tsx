import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { pillars } from "@/content/pillars";
import en from "@/locales/en.json";
import { renderWithProviders } from "@/lib/test-utils";

import { ValuePillars } from "./ValuePillars";

const enKeys = en as Record<string, string>;

describe("<ValuePillars />", () => {
  it("renders one card per pillar", () => {
    renderWithProviders(<ValuePillars />);
    expect(screen.getAllByTestId("pillar-card")).toHaveLength(pillars.length);
  });

  it("uses an accessible section labelled by the h2", () => {
    renderWithProviders(<ValuePillars />);
    const section = screen.getByTestId("value-pillars");
    expect(section).toHaveAttribute("aria-labelledby", "pillars-heading");
    expect(
      within(section).getByRole("heading", {
        level: 2,
        name: /Rearview apps show your money/i,
      }),
    ).toBeInTheDocument();
  });

  it("renders each pillar title and description from i18n", () => {
    renderWithProviders(<ValuePillars />);
    for (const pillar of pillars) {
      expect(screen.getByText(enKeys[`pillars.${pillar.id}.title`]!)).toBeInTheDocument();
      expect(
        screen.getByText(enKeys[`pillars.${pillar.id}.description`]!),
      ).toBeInTheDocument();
    }
  });
});
