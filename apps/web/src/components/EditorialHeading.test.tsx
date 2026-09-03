import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { EditorialHeading } from "./EditorialHeading";

/**
 * `EditorialHeading` is a presentational primitive: every string it renders
 * arrives through props, so these tests supply their own neutral fixtures
 * rather than importing locale copy. That is deliberate — the component must
 * never carry product/FAQ copy of its own.
 *
 * No provider wrapper is used because the component consumes no i18n, theme,
 * or router context.
 */
const FIXTURE = {
  id: "editorial-fixture-heading",
  eyebrow: "Fixture eyebrow",
  heading: "Fixture heading line",
  description: "Fixture description sentence.",
} as const;

const FOCUSABLE = "a,button,input,select,textarea,[tabindex],[contenteditable]";

describe("<EditorialHeading />", () => {
  it("renders the eyebrow and heading text supplied by the caller", () => {
    render(
      <EditorialHeading
        id={FIXTURE.id}
        eyebrow={FIXTURE.eyebrow}
        heading={FIXTURE.heading}
      />,
    );

    const block = screen.getByTestId("editorial-heading");
    expect(within(block).getByText(FIXTURE.eyebrow)).toBeInTheDocument();
    expect(
      within(block).getByRole("heading", { name: FIXTURE.heading }),
    ).toBeInTheDocument();
  });

  it("defaults to an h2 carrying the caller's id so aria-labelledby resolves", () => {
    render(
      <EditorialHeading
        id={FIXTURE.id}
        eyebrow={FIXTURE.eyebrow}
        heading={FIXTURE.heading}
      />,
    );

    const heading = screen.getByRole("heading", { level: 2 });
    expect(heading).toHaveAttribute("id", FIXTURE.id);
    expect(heading).toHaveTextContent(FIXTURE.heading);
  });

  it.each([
    ["h1", 1],
    ["h2", 2],
    ["h3", 3],
  ] as const)("renders %s when the caller selects that level", (level, rank) => {
    render(
      <EditorialHeading
        id={FIXTURE.id}
        eyebrow={FIXTURE.eyebrow}
        heading={FIXTURE.heading}
        level={level}
      />,
    );

    const heading = screen.getByRole("heading", { level: rank });
    expect(heading.tagName.toLowerCase()).toBe(level);
    expect(heading).toHaveAttribute("id", FIXTURE.id);
  });

  it("renders the description as its own paragraph when provided", () => {
    render(
      <EditorialHeading
        id={FIXTURE.id}
        eyebrow={FIXTURE.eyebrow}
        heading={FIXTURE.heading}
        description={FIXTURE.description}
      />,
    );

    const block = screen.getByTestId("editorial-heading");
    expect(within(block).getByText(FIXTURE.description)).toBeInTheDocument();
    expect(block.querySelectorAll("p")).toHaveLength(2);
  });

  it("omits the description element entirely when no description is given", () => {
    render(
      <EditorialHeading
        id={FIXTURE.id}
        eyebrow={FIXTURE.eyebrow}
        heading={FIXTURE.heading}
      />,
    );

    const block = screen.getByTestId("editorial-heading");
    const paragraphs = block.querySelectorAll("p");
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]).toHaveTextContent(FIXTURE.eyebrow);
    for (const paragraph of paragraphs) {
      expect(paragraph.textContent).not.toBe("");
    }
  });

  it("aligns left by default", () => {
    render(
      <EditorialHeading
        id={FIXTURE.id}
        eyebrow={FIXTURE.eyebrow}
        heading={FIXTURE.heading}
      />,
    );

    const block = screen.getByTestId("editorial-heading");
    expect(block).toHaveAttribute("data-align", "left");
    expect(block).toHaveClass("text-left");
    expect(block).not.toHaveClass("text-center");
  });

  it("centers the block and its rule when centered alignment is requested", () => {
    render(
      <EditorialHeading
        id={FIXTURE.id}
        eyebrow={FIXTURE.eyebrow}
        heading={FIXTURE.heading}
        description={FIXTURE.description}
        align="center"
      />,
    );

    const block = screen.getByTestId("editorial-heading");
    expect(block).toHaveAttribute("data-align", "center");
    expect(block).toHaveClass("text-center");
    expect(block).not.toHaveClass("text-left");
    expect(screen.getByTestId("editorial-heading-rule")).toHaveClass("mx-auto");
  });

  it("renders a decorative editorial rule by default", () => {
    render(
      <EditorialHeading
        id={FIXTURE.id}
        eyebrow={FIXTURE.eyebrow}
        heading={FIXTURE.heading}
      />,
    );

    const rule = screen.getByTestId("editorial-heading-rule");
    expect(rule).toHaveAttribute("aria-hidden", "true");
    expect(rule).not.toHaveClass("mx-auto");
  });

  it("omits the editorial rule when the caller opts out", () => {
    render(
      <EditorialHeading
        id={FIXTURE.id}
        eyebrow={FIXTURE.eyebrow}
        heading={FIXTURE.heading}
        rule={false}
      />,
    );

    expect(screen.queryByTestId("editorial-heading-rule")).toBeNull();
  });

  it("merges a caller class without dropping the alignment class", () => {
    render(
      <EditorialHeading
        id={FIXTURE.id}
        eyebrow={FIXTURE.eyebrow}
        heading={FIXTURE.heading}
        className="mkt-section-lead"
      />,
    );

    const block = screen.getByTestId("editorial-heading");
    expect(block).toHaveClass("mkt-section-lead");
    expect(block).toHaveClass("text-left");
  });

  it("introduces no focusable controls and exactly one heading", () => {
    const { container } = render(
      <EditorialHeading
        id={FIXTURE.id}
        eyebrow={FIXTURE.eyebrow}
        heading={FIXTURE.heading}
        description={FIXTURE.description}
      />,
    );

    expect(container.querySelectorAll(FOCUSABLE)).toHaveLength(0);
    expect(screen.getAllByRole("heading")).toHaveLength(1);
  });
});

/**
 * These className assertions look tautological but are not: tailwind-merge
 * classifies any `text-*` it cannot identify as a font size as a text COLOUR, and
 * the shared `cn` registers the desktop roles but not the web-only marketing
 * roles. So one `cn()` call holding a marketing role plus a colour silently
 * deleted the role, rendering real `/beta` headings at the inherited 16px:
 *
 *   cn("text-display-xl", "text-foreground")  ->  "text-foreground"
 *   cn("... text-lead text-muted-foreground") ->  "... text-muted-foreground"
 *
 * `text-xl` survives because tailwind-merge knows it natively, which is why h3
 * never regressed. Do not delete these as redundant.
 */
describe("<EditorialHeading /> type-role retention", () => {
  it.each([
    ["h1", ["text-display-xl", "text-foreground"]],
    ["h2", ["text-display-l", "text-foreground"]],
    ["h3", ["text-xl", "font-semibold", "text-foreground"]],
  ] as const)("keeps every %s type-role and colour class together", (level, expected) => {
    render(
      <EditorialHeading
        id={FIXTURE.id}
        eyebrow={FIXTURE.eyebrow}
        heading={FIXTURE.heading}
        level={level}
      />,
    );

    const heading = screen.getByRole("heading");
    for (const className of expected) {
      expect(heading).toHaveClass(className);
    }
  });

  it("keeps the description lead role and the muted colour class together", () => {
    render(
      <EditorialHeading
        id={FIXTURE.id}
        eyebrow={FIXTURE.eyebrow}
        heading={FIXTURE.heading}
        description={FIXTURE.description}
      />,
    );

    const description = screen.getByText(FIXTURE.description);
    expect(description).toHaveClass("text-lead");
    expect(description).toHaveClass("text-muted-foreground");
    expect(description).toHaveClass("mt-4");
    expect(description).toHaveClass("max-w-[540px]");
    expect(description).not.toHaveClass("mx-auto");
  });

  it("keeps the lead role, muted colour, and centering together when centered", () => {
    render(
      <EditorialHeading
        id={FIXTURE.id}
        eyebrow={FIXTURE.eyebrow}
        heading={FIXTURE.heading}
        description={FIXTURE.description}
        align="center"
      />,
    );

    const description = screen.getByText(FIXTURE.description);
    expect(description).toHaveClass("text-lead");
    expect(description).toHaveClass("text-muted-foreground");
    expect(description).toHaveClass("mx-auto");
  });

  it("keeps the eyebrow size, weight, and brand colour together", () => {
    render(
      <EditorialHeading
        id={FIXTURE.id}
        eyebrow={FIXTURE.eyebrow}
        heading={FIXTURE.heading}
      />,
    );

    const eyebrow = screen.getByText(FIXTURE.eyebrow);
    expect(eyebrow).toHaveClass("text-xs");
    expect(eyebrow).toHaveClass("font-semibold");
    expect(eyebrow).toHaveClass("text-primary");
  });

  it("keeps the rule's hairline background alongside its box metrics", () => {
    render(
      <EditorialHeading
        id={FIXTURE.id}
        eyebrow={FIXTURE.eyebrow}
        heading={FIXTURE.heading}
      />,
    );

    const rule = screen.getByTestId("editorial-heading-rule");
    expect(rule).toHaveClass("h-px");
    expect(rule).toHaveClass("w-16");
    expect(rule).toHaveClass("bg-border");
  });
});

