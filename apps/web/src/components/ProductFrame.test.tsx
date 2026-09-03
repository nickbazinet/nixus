import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ProductFrame } from "./ProductFrame";

/**
 * `ProductFrame` is a presentational primitive: all copy and asset paths are
 * caller-supplied, so these tests use neutral fixtures instead of real product
 * screenshots or locale copy.
 *
 * The frame owns the one permitted warm elevation recipe (`mkt-product-frame`)
 * and must never crop product imagery, so the crop/overflow assertions below
 * are the load-bearing part of this suite.
 */
const IMAGE_FIXTURE = {
  id: "product-frame-image-fixture",
  src: "/fixtures/wide-product.png",
  alt: "Fixture product image alternative text",
  caption: "Fixture product caption.",
} as const;

const TALL_FIXTURE = {
  id: "product-frame-tall-fixture",
  src: "/fixtures/tall-product.png",
  alt: "Fixture tall product image alternative text",
  caption: "Fixture tall product caption.",
} as const;

const CONTENT_FIXTURE = {
  id: "product-frame-content-fixture",
  label: "Fixture framed product demonstration",
} as const;

const FOCUSABLE = "a,button,input,select,textarea,[tabindex],[contenteditable]";
const CROP_CLASS = /object-cover|object-fill|object-none|\baspect-|overflow-hidden|overflow-clip/;

describe("<ProductFrame /> image variant", () => {
  it("renders a figure named by its own visible caption", () => {
    render(
      <ProductFrame
        kind="image"
        id={IMAGE_FIXTURE.id}
        src={IMAGE_FIXTURE.src}
        alt={IMAGE_FIXTURE.alt}
        caption={IMAGE_FIXTURE.caption}
      />,
    );

    const figure = screen.getByRole("figure", { name: IMAGE_FIXTURE.caption });
    const caption = figure.querySelector("figcaption");
    expect(caption).not.toBeNull();
    expect(caption).toHaveTextContent(IMAGE_FIXTURE.caption);
    expect(figure).toHaveAttribute("aria-labelledby", caption?.id ?? "");
  });

  it("preserves the caller's src and alt on a real img element", () => {
    render(
      <ProductFrame
        kind="image"
        id={IMAGE_FIXTURE.id}
        src={IMAGE_FIXTURE.src}
        alt={IMAGE_FIXTURE.alt}
        caption={IMAGE_FIXTURE.caption}
      />,
    );

    const image = screen.getByRole("img", { name: IMAGE_FIXTURE.alt });
    expect(image.tagName.toLowerCase()).toBe("img");
    expect(image).toHaveAttribute("src", IMAGE_FIXTURE.src);
  });

  it("sizes the image naturally with h-auto and w-full", () => {
    render(
      <ProductFrame
        kind="image"
        id={IMAGE_FIXTURE.id}
        src={IMAGE_FIXTURE.src}
        alt={IMAGE_FIXTURE.alt}
        caption={IMAGE_FIXTURE.caption}
      />,
    );

    const image = screen.getByRole("img", { name: IMAGE_FIXTURE.alt });
    expect(image).toHaveClass("h-auto");
    expect(image).toHaveClass("w-full");
  });

  it("owns the single warm elevation class internally", () => {
    render(
      <ProductFrame
        kind="image"
        id={IMAGE_FIXTURE.id}
        src={IMAGE_FIXTURE.src}
        alt={IMAGE_FIXTURE.alt}
        caption={IMAGE_FIXTURE.caption}
      />,
    );

    const figure = screen.getByRole("figure", { name: IMAGE_FIXTURE.caption });
    expect(figure).toHaveClass("mkt-product-frame");
    expect(figure.outerHTML).not.toMatch(/shadow-\[/);
  });

  it("never crops or clips the image", () => {
    render(
      <ProductFrame
        kind="image"
        id={IMAGE_FIXTURE.id}
        src={IMAGE_FIXTURE.src}
        alt={IMAGE_FIXTURE.alt}
        caption={IMAGE_FIXTURE.caption}
      />,
    );

    const figure = screen.getByRole("figure", { name: IMAGE_FIXTURE.caption });
    expect(figure.outerHTML).not.toMatch(CROP_CLASS);
  });

  it("keeps a tall portrait image at natural aspect with no crop classes", () => {
    render(
      <ProductFrame
        kind="image"
        id={TALL_FIXTURE.id}
        src={TALL_FIXTURE.src}
        alt={TALL_FIXTURE.alt}
        caption={TALL_FIXTURE.caption}
      />,
    );

    const figure = screen.getByRole("figure", { name: TALL_FIXTURE.caption });
    const image = screen.getByRole("img", { name: TALL_FIXTURE.alt });
    expect(image).toHaveClass("h-auto");
    expect(image).toHaveClass("w-full");
    expect(image).not.toHaveAttribute("height");
    expect(figure.outerHTML).not.toMatch(CROP_CLASS);
  });

  it("introduces no focusable controls of its own", () => {
    const { container } = render(
      <ProductFrame
        kind="image"
        id={IMAGE_FIXTURE.id}
        src={IMAGE_FIXTURE.src}
        alt={IMAGE_FIXTURE.alt}
        caption={IMAGE_FIXTURE.caption}
      />,
    );

    expect(container.querySelectorAll(FOCUSABLE)).toHaveLength(0);
  });
});

describe("<ProductFrame /> content variant", () => {
  it("renders caller children inside a figure labelled by the caller", () => {
    render(
      <ProductFrame
        kind="content"
        id={CONTENT_FIXTURE.id}
        label={CONTENT_FIXTURE.label}
      >
        <div data-testid="framed-child">Fixture framed child content</div>
      </ProductFrame>,
    );

    const figure = screen.getByRole("figure", { name: CONTENT_FIXTURE.label });
    expect(figure).toHaveAttribute("aria-label", CONTENT_FIXTURE.label);
    expect(figure).toContainElement(screen.getByTestId("framed-child"));
  });

  it("owns the same warm elevation class and renders no image or caption", () => {
    render(
      <ProductFrame
        kind="content"
        id={CONTENT_FIXTURE.id}
        label={CONTENT_FIXTURE.label}
      >
        <div>Fixture framed child content</div>
      </ProductFrame>,
    );

    const figure = screen.getByRole("figure", { name: CONTENT_FIXTURE.label });
    expect(figure).toHaveClass("mkt-product-frame");
    expect(figure.querySelector("img")).toBeNull();
    expect(figure.querySelector("figcaption")).toBeNull();
    expect(figure.outerHTML).not.toMatch(CROP_CLASS);
  });

  it("introduces no focusable controls of its own around inert children", () => {
    const { container } = render(
      <ProductFrame
        kind="content"
        id={CONTENT_FIXTURE.id}
        label={CONTENT_FIXTURE.label}
      >
        <span>Fixture inert child</span>
      </ProductFrame>,
    );

    expect(container.querySelectorAll(FOCUSABLE)).toHaveLength(0);
  });
});
