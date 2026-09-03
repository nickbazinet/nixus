import { readFileSync } from "node:fs";

import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@/lib/test-utils";
import { DownloadStateProvider } from "@/features/download/DownloadStateContext";

vi.mock("@tanstack/react-router", () => ({
  useLocation: () => ({ pathname: "/" }),
}));

import { HERO_BACKDROP_PRELOADS, Hero } from "./Hero";

const HEADLINE = "Stay on top of your money — not buried in spreadsheets.";

/**
 * Raw palette values, mono money, and ad-hoc shadows — the four things the Warm
 * Editorial marketing contract replaces with named tokens. Asserted against the
 * source rather than the DOM because the category badge colours live in
 * `content/aiDemo.ts`, which is deliberately outside this composition's scope.
 */
const BANNED_SOURCE = /\bslate-|\bemerald-|font-mono|shadow-\[/g;

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

function renderHero(props: Partial<Parameters<typeof Hero>[0]> = {}) {
  return renderWithProviders(
    <DownloadStateProvider>
      <Hero {...props} />
    </DownloadStateProvider>,
  );
}

describe("<Hero />", () => {
  it("renders the translated headline as the only <h1>", () => {
    renderHero();
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1).toHaveTextContent(HEADLINE);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("renders the translated subhead text", () => {
    renderHero();
    expect(
      screen.getByText(/upload a credit card statement/i),
    ).toBeInTheDocument();
  });

  it("renders the marketing eyebrow from i18n by default", () => {
    renderHero();
    expect(screen.getByTestId("hero-eyebrow")).toHaveTextContent(
      /Local-first · No bank passwords/i,
    );
  });

  it("prefers an explicit eyebrow prop over the i18n default", () => {
    renderHero({ eyebrow: "The pitch" });
    expect(screen.getByTestId("hero-eyebrow")).toHaveTextContent("The pitch");
  });

  it("omits the eyebrow when the prop is an empty string", () => {
    renderHero({ eyebrow: "" });
    expect(screen.queryByTestId("hero-eyebrow")).not.toBeInTheDocument();
  });

  it("mounts a DownloadCTA inside the hero", () => {
    renderHero();
    expect(screen.getByTestId("download-cta")).toBeInTheDocument();
  });

  it("keeps the headline ahead of the CTA in DOM reading order", () => {
    renderHero();
    const position = screen
      .getByRole("heading", { level: 1 })
      .compareDocumentPosition(screen.getByTestId("download-cta"));

    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("<Hero /> product demo", () => {
  it("embeds exactly one accessible AI demo figure", () => {
    renderHero();

    const figure = screen.getByTestId("ai-demo-figure");
    expect(figure.tagName.toLowerCase()).toBe("figure");
    expect(figure).toHaveAccessibleName(/AI parsing demo:/i);
    // One proof, not two: the standalone section is gone, so a second demo in
    // the hero would mean the figure was copied rather than moved.
    expect(screen.getAllByTestId("ai-demo")).toHaveLength(1);
    expect(figure).toContainElement(screen.getByTestId("ai-demo"));
  });

  it("splits the text column and the demo into the asymmetric hero grid", () => {
    renderHero();

    const hero = screen.getByTestId("hero");
    const grids = hero.querySelectorAll(".mkt-asym-hero");
    expect(grids).toHaveLength(1);
    const grid = grids[0];

    const text = hero.querySelector(".mkt-measure-lead");
    expect(text?.parentElement).toBe(grid);
    expect(text).toContainElement(screen.getByRole("heading", { level: 1 }));
    expect(text).toContainElement(screen.getByTestId("download-cta"));

    // The demo is the grid's own second track, not something nested inside the
    // prose measure — that is what makes the composition asymmetric instead of
    // a narrow column with a picture in it.
    const visual = screen.getByTestId("ai-demo-figure").parentElement;
    expect(visual?.parentElement).toBe(grid);
    expect(text).not.toContainElement(screen.getByTestId("ai-demo-figure"));
  });

  it("pulls the demo over the hero's lower boundary and lights it from behind", () => {
    renderHero();

    const visual = screen.getByTestId("ai-demo-figure").parentElement;
    expect(visual).toHaveClass("mkt-hero-overlap");
    expect(visual).toHaveClass("mkt-ambient-light");
    // The ambient glow is a negative-inset pseudo-element, so without a
    // one-axis clip it grows past the page gutter and adds horizontal document
    // scroll at 640px — measured as 5px of WCAG 1.4.10 failure.
    expect(screen.getByTestId("hero")).toHaveClass("overflow-x-clip");
  });

  it("frames the demo with the one permitted warm elevation", () => {
    renderHero();

    expect(screen.getByTestId("ai-demo-figure")).toHaveClass(
      "mkt-product-frame",
    );
  });

  it("sets every money cell in tabular Inter rather than a mono face", () => {
    renderHero();

    const amounts = screen.getAllByTestId("ai-demo-amount");
    expect(amounts).toHaveLength(10);
    for (const amount of amounts) {
      expect(amount).toHaveClass("tabular-nums");
      expect(amount.className).not.toMatch(/font-mono/);
    }
  });
});

describe("hero backdrop preloads", () => {
  it("preloads one backdrop per colour scheme, each media-scoped", () => {
    expect(HERO_BACKDROP_PRELOADS).toEqual([
      {
        rel: "preload",
        as: "image",
        href: "/hero-bg-light.webp",
        media: "(prefers-color-scheme: light)",
        fetchPriority: "high",
      },
      {
        rel: "preload",
        as: "image",
        href: "/hero-bg-dark.webp",
        media: "(prefers-color-scheme: dark)",
        fetchPriority: "high",
      },
    ]);
  });

  it("scopes each declared asset to exactly one scheme, so only one can match", () => {
    const media = HERO_BACKDROP_PRELOADS.map((link) => link.media);
    expect(new Set(media).size).toBe(HERO_BACKDROP_PRELOADS.length);
  });

  it("paints the light backdrop ungated and the dark one behind the dark variant", () => {
    renderHero();
    const hero = screen.getByTestId("hero");

    // The base layer is the light atmosphere; `dark:` swaps the asset rather than
    // introducing a second layer, which is what keeps one image per scheme.
    expect(hero.className).toContain("before:bg-[url('/hero-bg-light.webp')]");
    expect(hero.className).toContain(
      "dark:before:bg-[url('/hero-bg-dark.webp')]",
    );
    // Split so Tailwind's source scanner cannot read this forbidden combination as
    // a real candidate and emit dead CSS for it.
    const darkLight = `dark:before:bg-[url('/hero-bg-${"light"}.webp')]`;
    expect(hero.className).not.toContain(darkLight);
  });

  it("masks the light atmosphere away from the prose column", () => {
    renderHero();
    const hero = screen.getByTestId("hero");

    // Measured, not decorative: unmasked, the asset's left-edge violet band put
    // `--ink-dim` body text at 3.47:1 against a 4.5:1 requirement.
    expect(hero.className).toMatch(/before:\[mask-image:radial-gradient\(/);
    expect(hero.className).toMatch(/dark:before:\[mask-image:none]/);
  });

  it("fits the atmosphere to the width below the desktop tier", () => {
    renderHero();
    const hero = screen.getByTestId("hero");

    // `cover` on a 16:9 asset in a tall narrow hero scales it to ~2109px wide and
    // centre-crops, so a phone saw a slice of empty sky — the image was downloaded
    // and imperceptible. The fix is width-fit (`100% auto`, hence `no-repeat`)
    // bottom-anchored inside a layer capped above the body copy, so the skyline
    // itself lands on the page and the prose keeps clean paper.
    expect(hero.className).toContain("max-lg:before:bg-[length:100%_auto]");
    expect(hero.className).toContain("max-lg:before:bg-bottom");
    expect(hero.className).toContain("max-lg:before:bg-no-repeat");
    expect(hero.className).toContain("max-lg:before:bottom-auto");
    expect(hero.className).toMatch(/max-lg:before:top-\[\d+px]/);
    expect(hero.className).toMatch(/max-lg:before:h-\[\d+px]/);
    expect(hero.className).toMatch(
      /max-lg:before:\[mask-image:linear-gradient\(/,
    );

    // The desktop treatment is unchanged: cover, centred, radial mask.
    expect(hero.className).toContain("before:bg-cover");
    expect(hero.className).toContain("before:bg-center");
  });

  it("re-asserts the dark photograph's geometry so narrow widths cannot reshape it", () => {
    renderHero();
    const hero = screen.getByTestId("hero");

    // The narrow overrides above are light-only by intent; dark has to restate
    // cover/centre/repeat or a phone in dark mode inherits the light band geometry.
    expect(hero.className).toContain("dark:before:bg-cover");
    expect(hero.className).toContain("dark:before:bg-center");
    expect(hero.className).toContain("dark:before:bg-repeat");
    expect(hero.className).toContain("dark:before:top-0");
    expect(hero.className).toContain("dark:before:bottom-0");
    expect(hero.className).toContain("dark:before:h-auto");
  });

  it("holds the light atmosphere back further than the dark photograph", () => {
    renderHero();
    const hero = screen.getByTestId("hero");
    const light = /(?:^|\s)before:opacity-\[?([\d.]+)]?(?:\s|$)/.exec(
      hero.className,
    );
    const dark = /dark:before:opacity-\[?([\d.]+)]?(?:\s|$)/.exec(
      hero.className,
    );

    // Tailwind writes `opacity-90` as 90 and `opacity-[0.45]` as 0.45; normalise
    // both to a 0-1 alpha before comparing.
    const alpha = (value: string) =>
      Number(value) > 1 ? Number(value) / 100 : Number(value);
    expect(light).not.toBeNull();
    expect(dark).not.toBeNull();
    expect(alpha(light?.[1] ?? "1")).toBeLessThan(alpha(dark?.[1] ?? "0"));
  });
});

describe("Warm Editorial token discipline", () => {
  it.each(["./Hero.tsx", "./AIDemo.tsx"])(
    "leaves no raw palette, mono money, or arbitrary shadow in %s",
    (file) => {
      expect(source(file).match(BANNED_SOURCE) ?? []).toEqual([]);
    },
  );
});

describe("homepage composition", () => {
  it.each(["../routes/index.tsx", "../routes/fr/index.tsx"])(
    "mounts Hero once and no standalone AI demo section in %s",
    (route) => {
      const tree = source(route);

      expect(tree.match(/<Hero\b/g) ?? []).toHaveLength(1);
      expect(tree).not.toMatch(/AIDemo/);
    },
  );
});
