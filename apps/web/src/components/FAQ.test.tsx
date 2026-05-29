import { fireEvent, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { faqEntries } from "@/content/faq";
import en from "@/locales/en.json";
import { renderWithProviders } from "@/lib/test-utils";

vi.mock("@/lib/analytics", () => ({
  trackEvent: vi.fn(),
}));

import { FAQ } from "./FAQ";
import { trackEvent } from "@/lib/analytics";

const mockedTrackEvent = vi.mocked(trackEvent);
const enKeys = en as Record<string, string>;
const SUPPORT_EMAIL = "support@nixus.nicolasbazinet.net";

const questionFor = (id: string) => enKeys[`faq.${id}.question`]!;

describe("<FAQ />", () => {
  beforeEach(() => {
    mockedTrackEvent.mockClear();
  });

  it("renders all 8 v1 questions from `content/faq`", () => {
    renderWithProviders(<FAQ />);
    expect(faqEntries.length).toBeGreaterThanOrEqual(8);
    for (const entry of faqEntries) {
      expect(screen.getByText(questionFor(entry.id))).toBeInTheDocument();
    }
  });

  it("renders the preAlpha entry first with id=faq-pre-alpha on its item", () => {
    const { container } = renderWithProviders(<FAQ />);
    expect(faqEntries[0]?.id).toBe("preAlpha");
    expect(screen.getByText(questionFor("preAlpha"))).toBeInTheDocument();
    expect(container.querySelector("#faq-pre-alpha")).not.toBeNull();
  });

  it("uses an accessible section labelled by the h2", () => {
    renderWithProviders(<FAQ />);
    const section = screen.getByTestId("faq");
    expect(section.tagName.toLowerCase()).toBe("section");
    expect(section).toHaveAttribute("aria-labelledby", "faq-heading");
    expect(section).toHaveAttribute("id", "faq");

    const h2 = within(section).getByRole("heading", { level: 2 });
    expect(h2).toHaveAttribute("id", "faq-heading");
    expect(h2).toHaveTextContent(/Frequently asked/i);
  });

  it("starts with every panel closed (aria-expanded=false on triggers)", () => {
    renderWithProviders(<FAQ />);
    const triggers = screen.getAllByRole("button");
    for (const trigger of triggers) {
      expect(trigger).toHaveAttribute("aria-expanded", "false");
    }
  });

  it("opens a panel when its trigger is clicked", () => {
    renderWithProviders(<FAQ />);
    const trigger = screen.getByRole("button", {
      name: questionFor(faqEntries[0]!.id),
    });
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });

  it("enforces single-open mode (opening one closes the other)", () => {
    renderWithProviders(<FAQ />);
    const firstTrigger = screen.getByRole("button", {
      name: questionFor(faqEntries[0]!.id),
    });
    const secondTrigger = screen.getByRole("button", {
      name: questionFor(faqEntries[1]!.id),
    });

    fireEvent.click(firstTrigger);
    expect(firstTrigger).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(secondTrigger);
    expect(secondTrigger).toHaveAttribute("aria-expanded", "true");
    expect(firstTrigger).toHaveAttribute("aria-expanded", "false");
  });

  it("fires `faq.expanded` on expand with the question text in properties", () => {
    renderWithProviders(<FAQ />);
    const entry = faqEntries[0]!;
    const trigger = screen.getByRole("button", { name: questionFor(entry.id) });
    fireEvent.click(trigger);

    expect(mockedTrackEvent).toHaveBeenCalledWith({
      name: "faq.expanded",
      properties: { question: questionFor(entry.id) },
    });
  });

  it("does not fire `faq.expanded` when collapsing (only on expand)", () => {
    renderWithProviders(<FAQ />);
    const entry = faqEntries[0]!;
    const trigger = screen.getByRole("button", { name: questionFor(entry.id) });

    fireEvent.click(trigger);
    expect(mockedTrackEvent).toHaveBeenCalledTimes(1);

    fireEvent.click(trigger);
    expect(mockedTrackEvent).toHaveBeenCalledTimes(1);
  });

  it("fires once per expand transition when opening multiple questions", () => {
    renderWithProviders(<FAQ />);
    const first = faqEntries[0]!;
    const second = faqEntries[1]!;
    fireEvent.click(
      screen.getByRole("button", { name: questionFor(first.id) }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: questionFor(second.id) }),
    );

    expect(mockedTrackEvent).toHaveBeenCalledTimes(2);
    expect(mockedTrackEvent).toHaveBeenNthCalledWith(1, {
      name: "faq.expanded",
      properties: { question: questionFor(first.id) },
    });
    expect(mockedTrackEvent).toHaveBeenNthCalledWith(2, {
      name: "faq.expanded",
      properties: { question: questionFor(second.id) },
    });
  });

  it("renders the mailto escape hatch below the accordion", () => {
    renderWithProviders(<FAQ />);
    const link = screen.getByRole("link", {
      name: new RegExp(SUPPORT_EMAIL.replace(/\./g, "\\."), "i"),
    });
    expect(link).toHaveAttribute("href", `mailto:${SUPPORT_EMAIL}`);
  });

  it("renders inline external links with target=_blank rel=noreferrer", () => {
    renderWithProviders(<FAQ />);
    const safetyEntry = faqEntries.find((e) => e.id === "installSafety");
    expect(safetyEntry).toBeDefined();
    expect(safetyEntry?.links?.[0]?.external).toBe(true);
    fireEvent.click(
      screen.getByRole("button", { name: questionFor(safetyEntry!.id) }),
    );

    const githubLink = screen.getByRole("link", { name: /Inspect on GitHub/i });
    expect(githubLink).toHaveAttribute(
      "href",
      "https://github.com/nickbazinet/nixus",
    );
    expect(githubLink).toHaveAttribute("target", "_blank");
    expect(githubLink).toHaveAttribute("rel", "noreferrer");
  });

  it("renders inline mailto links without target/rel", () => {
    renderWithProviders(<FAQ />);
    const whoEntry = faqEntries.find((e) => e.id === "whoBuilt");
    expect(whoEntry).toBeDefined();
    fireEvent.click(
      screen.getByRole("button", { name: questionFor(whoEntry!.id) }),
    );

    const mailtoLinks = screen
      .getAllByRole("link")
      .filter((a) => a.getAttribute("href") === `mailto:${SUPPORT_EMAIL}`);
    expect(mailtoLinks.length).toBeGreaterThanOrEqual(2);
    for (const link of mailtoLinks) {
      expect(link).not.toHaveAttribute("target");
    }
  });
});
