import { act, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import i18n from "@/lib/i18n";
import en from "@/locales/en.json";
import fr from "@/locales/fr.json";
import { renderWithProviders } from "@/lib/test-utils";

import { BetaPage } from "./BetaPage";

const enKeys = en as Record<string, string>;

/**
 * Warm Editorial contract for the beta page.
 *
 * Product imagery is never cropped, so any class that could clip or re-frame a
 * screenshot is a failure — `overflow-hidden` included, which is what the
 * pre-recomposition figure used to carry.
 */
const CROP_CLASS =
  /object-cover|object-fill|object-none|\baspect-|overflow-hidden|overflow-clip/;

/** Sections the beta page itself composes. FoundingPitch is owned elsewhere. */
const EDITORIAL_SECTION_IDS = [
  "beta-screenshots-heading",
  "beta-expect-heading",
  "beta-start-heading",
  "beta-feedback-heading",
  "beta-faq-heading",
] as const;

function sectionFor(headingId: string): HTMLElement {
  const section = document
    .getElementById(headingId)
    ?.closest<HTMLElement>("section");
  expect(section, `no <section> owns #${headingId}`).not.toBeNull();
  return section as HTMLElement;
}

describe("<BetaPage />", () => {
  it("renders the beta page hero and primary sections", () => {
    renderWithProviders(<BetaPage />);

    expect(screen.getByTestId("beta-page")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: enKeys["betaPage.hero.heading"]!,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Looking for founding users" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: enKeys["betaPage.feedback.heading"]!,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "What Nixus is — and isn't" }),
    ).toBeInTheDocument();
  });

  it("groups the founding-user qualification into one block", () => {
    renderWithProviders(<BetaPage />);

    expect(screen.getByTestId("founding-pitch")).toBeInTheDocument();
    expect(
      screen.getByTestId("founding-pitch-focus").querySelectorAll("li"),
    ).toHaveLength(5);
    expect(screen.queryByTestId("beta-fit-good")).not.toBeInTheDocument();
    expect(screen.queryByTestId("beta-fit-bad")).not.toBeInTheDocument();
  });

  it("invites qualified visitors to become Founding Users", () => {
    renderWithProviders(<BetaPage />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Help shape Nixus" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Excel or Google Sheets/i)).toBeInTheDocument();
    expect(screen.getByText(/candid feedback/i)).toBeInTheDocument();
  });

  it("links both program CTAs to the canonical address and subject", () => {
    renderWithProviders(<BetaPage />);
    const expected =
      "mailto:nixus@gmail.com?subject=Nixus%20Founding%20User%20Program";

    expect(screen.getByTestId("beta-hero-cta")).toHaveAttribute("href", expected);
    expect(screen.getByTestId("beta-feedback-cta")).toHaveAttribute(
      "href",
      expected,
    );
    expect(
      screen.getAllByRole("link", { name: "Join the Founding Users Program" }),
    ).toHaveLength(2);
  });

  it("renders the Founding Users program in French", async () => {
    await act(async () => {
      await i18n.changeLanguage("fr");
    });
    try {
      renderWithProviders(<BetaPage />);
      expect(
        screen.getByRole("heading", {
          level: 1,
          name: "Aidez à façonner Nixus",
        }),
      ).toBeInTheDocument();
      expect(screen.getByText(/Excel ou Google Sheets/i)).toBeInTheDocument();
      expect(
        screen.getByRole("heading", {
          name: "Ce que Nixus est — et n'est pas",
        }),
      ).toBeInTheDocument();
      expect(screen.getByTestId("beta-hero-cta")).toHaveAttribute(
        "href",
        "mailto:nixus@gmail.com?subject=Programme%20des%20utilisateurs%20fondateurs%20Nixus",
      );
    } finally {
      await act(async () => {
        await i18n.changeLanguage("en");
      });
    }
  });

  it("renders product screenshots from public assets", () => {
    renderWithProviders(<BetaPage />);
    expect(screen.getByTestId("beta-screenshot-budget")).toBeInTheDocument();
    expect(screen.getByTestId("beta-screenshot-aiImport")).toBeInTheDocument();
    expect(screen.getByTestId("beta-screenshot-netWorth")).toBeInTheDocument();
    expect(
      screen.getByAltText(enKeys["betaPage.screenshots.budget.alt"]!),
    ).toHaveAttribute("src", "/beta/budget.png");
    expect(
      screen.getByAltText(enKeys["betaPage.screenshots.aiImport.alt"]!),
    ).toHaveAttribute("src", "/beta/ai-chat.png");
    expect(
      screen.getByAltText("Nixus accounts and allocation by type"),
    ).toHaveAttribute("src", "/beta/accounts.png");
    for (const image of screen.getAllByRole("img")) {
      expect(image).toHaveClass("h-auto", "w-full");
      expect(image).not.toHaveClass("object-cover", "aspect-[16/10]");
      expect(image).not.toHaveAttribute("height");
      expect(image).not.toHaveAttribute("width");
    }
  });

  it("frames every screenshot in ProductFrame with no crop or placeholder", () => {
    renderWithProviders(<BetaPage />);

    for (const id of ["budget", "aiImport", "netWorth"] as const) {
      const frame = screen.getByTestId(`beta-screenshot-${id}`);
      expect(frame.tagName.toLowerCase()).toBe("figure");
      expect(frame).toHaveClass("mkt-product-frame");
      expect(frame.outerHTML).not.toMatch(CROP_CLASS);
      expect(frame.outerHTML).not.toMatch(/shadow-sm|shadow-\[|bg-gradient-to-/);
      expect(frame.querySelector("img")).not.toBeNull();
      expect(
        screen.queryByText(enKeys[`betaPage.screenshots.${id}.placeholder`]!),
      ).not.toBeInTheDocument();
    }
  });

  it("keeps each screenshot caption visible and naming its figure", () => {
    renderWithProviders(<BetaPage />);

    for (const id of ["budget", "aiImport", "netWorth"] as const) {
      const caption = enKeys[`betaPage.screenshots.${id}.caption`]!;
      const frame = screen.getByRole("figure", { name: caption });
      expect(frame).toBe(screen.getByTestId(`beta-screenshot-${id}`));
      expect(frame.querySelector("figcaption")).toHaveTextContent(caption);
    }
  });

  it("leads with a left-aligned editorial heading block", () => {
    renderWithProviders(<BetaPage />);

    const block = screen.getAllByTestId("editorial-heading")[0]!;
    expect(block).toHaveAttribute("data-align", "left");
    expect(block).not.toHaveClass("text-center");
    expect(block).toContainElement(
      screen.getByRole("heading", {
        level: 1,
        name: enKeys["betaPage.hero.heading"]!,
      }),
    );
    expect(block).toHaveTextContent(enKeys["betaPage.eyebrow"]!);
    expect(block).toHaveTextContent(enKeys["betaPage.hero.lead"]!);
  });

  it("marks every page-owned section with a thin editorial rule", () => {
    renderWithProviders(<BetaPage />);

    for (const headingId of EDITORIAL_SECTION_IDS) {
      const section = sectionFor(headingId);
      expect(
        section.querySelector(".mkt-rule"),
        `#${headingId} has no .mkt-rule`,
      ).not.toBeNull();
    }
  });

  it("widens the imagery band while prose stays on the narrow measure", () => {
    renderWithProviders(<BetaPage />);

    const screenshots = sectionFor("beta-screenshots-heading");
    expect(screenshots).not.toHaveClass("mkt-measure-prose");
    expect(
      screenshots.closest(".mkt-measure-prose"),
      "the imagery band must not inherit the prose measure",
    ).toBeNull();

    for (const headingId of [
      "beta-expect-heading",
      "beta-start-heading",
      "beta-feedback-heading",
      "beta-faq-heading",
    ] as const) {
      expect(sectionFor(headingId)).toHaveClass("mkt-measure-prose");
    }
  });

  it("keeps the founding pitch and limitations call sites rendering", () => {
    renderWithProviders(<BetaPage />);

    expect(screen.getByTestId("founding-pitch")).toBeInTheDocument();
    expect(screen.getByTestId("beta-limitations-list")).toBeInTheDocument();
    expect(
      screen.getByTestId("beta-limitations-list").querySelectorAll("li"),
    ).toHaveLength(6);
    expect(screen.queryByTestId("founding-pitch-cta")).not.toBeInTheDocument();
  });

  it("keeps the quick FAQ questions and the homepage FAQ link", () => {
    renderWithProviders(<BetaPage />);

    for (const id of ["bankConnection", "dataStorage", "isItFree"] as const) {
      expect(
        screen.getByText(enKeys[`faq.${id}.question`]!),
      ).toBeInTheDocument();
    }
    expect(
      screen.getByRole("link", { name: enKeys["betaPage.faq.moreLink"]! }),
    ).toHaveAttribute("href", "/#faq");
    expect(
      screen.getByRole("link", {
        name: enKeys["betaPage.getStarted.installHelpLink"]!,
      }),
    ).toHaveAttribute("href", "/#faq");
  });

  it("survives French expansion with framing and links intact", async () => {
    await act(async () => {
      await i18n.changeLanguage("fr");
    });
    try {
      renderWithProviders(<BetaPage />);
      const frKeys = fr as Record<string, string>;

      for (const id of ["budget", "aiImport", "netWorth"] as const) {
        const frame = screen.getByRole("figure", {
          name: frKeys[`betaPage.screenshots.${id}.caption`]!,
        });
        expect(frame).toHaveClass("mkt-product-frame");
        expect(frame.outerHTML).not.toMatch(CROP_CLASS);
        expect(
          screen.getByAltText(frKeys[`betaPage.screenshots.${id}.alt`]!),
        ).toHaveClass("h-auto", "w-full");
      }

      expect(screen.getAllByTestId("editorial-heading")[0]).toHaveAttribute(
        "data-align",
        "left",
      );
      expect(
        screen.getByRole("link", { name: frKeys["betaPage.faq.moreLink"]! }),
      ).toHaveAttribute("href", "/fr/#faq");
    } finally {
      await act(async () => {
        await i18n.changeLanguage("en");
      });
    }
  });
});
