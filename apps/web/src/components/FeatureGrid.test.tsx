import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { features } from "@/content/features";
import en from "@/locales/en.json";

import { renderWithProviders } from "@/lib/test-utils";
import { FeatureGrid } from "./FeatureGrid";

const enKeys = en as Record<string, string>;

describe("<FeatureGrid />", () => {
  it("renders one card per feature in `features` content", () => {
    renderWithProviders(<FeatureGrid />);
    const cards = screen.getAllByTestId("feature-card");
    expect(cards).toHaveLength(features.length);
    expect(cards).toHaveLength(6);
  });

  it("uses an accessible section labelled by the h2", () => {
    renderWithProviders(<FeatureGrid />);
    const section = screen.getByTestId("feature-grid");
    expect(section.tagName.toLowerCase()).toBe("section");
    expect(section).toHaveAttribute("aria-labelledby", "features-heading");

    const h2 = within(section).getByRole("heading", { level: 2 });
    expect(h2).toHaveAttribute("id", "features-heading");
    expect(h2).toHaveTextContent(/Everything tracked\. Nothing manual\./);
  });

  it("renders each feature's translated title and description", () => {
    renderWithProviders(<FeatureGrid />);
    for (const feature of features) {
      const title = enKeys[`features.${feature.id}.title`];
      const description = enKeys[`features.${feature.id}.description`];
      expect(title).toBeTruthy();
      expect(description).toBeTruthy();
      expect(
        screen.getByRole("heading", { level: 3, name: title }),
      ).toBeInTheDocument();
      expect(screen.getByText(description)).toBeInTheDocument();
    }
  });

  it("renders exactly one <h3> per feature card", () => {
    renderWithProviders(<FeatureGrid />);
    const h3s = screen.getAllByRole("heading", { level: 3 });
    expect(h3s).toHaveLength(features.length);
  });

  it("contains no focusable/interactive elements inside any card", () => {
    renderWithProviders(<FeatureGrid />);
    const cards = screen.getAllByTestId("feature-card");
    for (const card of cards) {
      const focusable = card.querySelectorAll(
        'a, button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      expect(focusable.length).toBe(0);
    }
  });

  it("keeps every description under the 100-character limit (EN)", () => {
    for (const feature of features) {
      const description = enKeys[`features.${feature.id}.description`];
      expect(description.length).toBeLessThanOrEqual(100);
    }
  });

  it("keeps every title to four words or fewer (EN)", () => {
    for (const feature of features) {
      const title = enKeys[`features.${feature.id}.title`];
      const wordCount = title.trim().split(/\s+/).length;
      expect(wordCount).toBeLessThanOrEqual(4);
    }
  });
});
