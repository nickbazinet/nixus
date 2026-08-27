import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const TOKENS_CSS = readFileSync(
  fileURLToPath(new URL("../tokens.css", import.meta.url)),
  "utf8"
);

const SURFACES = ["card", "bg", "chrome", "rail"] as const;
const STATUS = ["good", "caution", "over"] as const;
const CHART_STEPS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

/* WCAG 2.1 relative luminance and contrast ratio. Verbatim from the spec —
 * the 0.03928 breakpoint and 2.4 exponent are the normative values, not
 * approximations to be tidied up. */
function relativeLuminance(hex: string): number {
  const int = Number.parseInt(hex.slice(1), 16);
  const channels = [(int >> 16) & 255, (int >> 8) & 255, int & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort(
    (x, y) => y - x
  );
  return (hi + 0.05) / (lo + 0.05);
}

function parseMode(selector: string): Record<string, string> {
  const selectorIndex = TOKENS_CSS.indexOf(selector);
  if (selectorIndex === -1) {
    throw new Error(`tokens.css no longer contains the ${selector} block`);
  }
  const open = TOKENS_CSS.indexOf("{", selectorIndex);
  const close = TOKENS_CSS.indexOf("}", open);
  const body = TOKENS_CSS.slice(open + 1, close);

  const tokens: Record<string, string> = {};
  for (const [, name, hex] of body.matchAll(
    /--([a-z0-9-]+):\s*(#[0-9A-Fa-f]{6})/g
  )) {
    tokens[name] = hex;
  }
  return tokens;
}

const MODES = {
  light: parseMode(":root {\n  /* Surfaces */"),
  dark: parseMode(".dark {"),
} as const;

function ratioTo(tokens: Record<string, string>, from: string, to: string) {
  const a = tokens[from];
  const b = tokens[to];
  if (!a || !b) throw new Error(`missing token: ${!a ? from : to}`);
  return contrast(a, b);
}

describe.each(Object.entries(MODES))("%s mode", (_mode, tokens) => {
  it("parses a complete palette", () => {
    expect(Object.keys(tokens).length).toBeGreaterThanOrEqual(40);
  });

  describe("text — 4.5:1", () => {
    it.each(["ink", "ink-dim"])(
      "%s clears 4.5:1 on card, page, chrome, and rail",
      (ink) => {
        for (const surface of SURFACES) {
          expect(ratioTo(tokens, ink, surface)).toBeGreaterThanOrEqual(4.5);
        }
      }
    );

    /* ink-faint is held to 4.6 rather than 4.5 because it carries column heads
     * and axis ticks — content, not decoration — and an earlier draft of the
     * spine verified it against card and page only, then failed on chrome and
     * rail at 4.06-4.29:1. The tighter floor is what keeps that from recurring. */
    it("ink-faint clears 4.6:1 on all four surfaces", () => {
      for (const surface of SURFACES) {
        expect(ratioTo(tokens, "ink-faint", surface)).toBeGreaterThanOrEqual(
          4.6
        );
      }
    });

    it.each(STATUS)("%s badge ink clears 4.5:1 on its own tint", (status) => {
      expect(
        ratioTo(tokens, `${status}-ink`, `${status}-bg`)
      ).toBeGreaterThanOrEqual(4.5);
    });

    it("neutral badge ink clears 4.5:1 on its own tint", () => {
      expect(ratioTo(tokens, "neutral-ink", "neutral-bg")).toBeGreaterThanOrEqual(
        4.5
      );
    });

    it("button fills carry legible labels", () => {
      expect(ratioTo(tokens, "brand-on", "brand")).toBeGreaterThanOrEqual(4.5);
      expect(ratioTo(tokens, "over-on", "over")).toBeGreaterThanOrEqual(4.5);
    });

    it("brand ink clears 4.5:1 on brand-soft", () => {
      expect(ratioTo(tokens, "brand-ink", "brand-soft")).toBeGreaterThanOrEqual(
        4.5
      );
    });

    /* The rail gets full text treatment rather than icon-level 3:1 because it
     * expands to 192px and renders real labels. rail-on is deliberately exempt:
     * it is a tint, verified as graphical, and the label on top of it is what
     * carries text contrast. */
    it("rail inks clear 4.5:1", () => {
      expect(ratioTo(tokens, "rail-ink", "rail")).toBeGreaterThanOrEqual(4.5);
      expect(ratioTo(tokens, "rail-on-ink", "rail-on")).toBeGreaterThanOrEqual(
        4.5
      );
    });

    /* premium-ink is real text on the rail beside the wordmark, so it is held to
     * the text floor on every surface rather than the 3:1 graphical one — and on
     * all four, because a token verified against one surface is how ink-faint
     * shipped failing on chrome and rail. */
    it("premium ink clears 4.5:1 on card, page, chrome, and rail", () => {
      for (const surface of SURFACES) {
        expect(ratioTo(tokens, "premium-ink", surface)).toBeGreaterThanOrEqual(
          4.5
        );
      }
    });
  });

  describe("graphical and state — 3:1", () => {
    it("a disabled control is perceivably disabled", () => {
      expect(ratioTo(tokens, "ink-disabled", "card")).toBeGreaterThanOrEqual(3);
    });

    it("the focus ring is visible on card and page", () => {
      expect(ratioTo(tokens, "focus-ring", "card")).toBeGreaterThanOrEqual(3);
      expect(ratioTo(tokens, "focus-ring", "bg")).toBeGreaterThanOrEqual(3);
    });

    it("brand is visible as a graphical fill on card", () => {
      expect(ratioTo(tokens, "brand", "card")).toBeGreaterThanOrEqual(3);
    });
  });

  describe("elevation", () => {
    /* The hairline measures 1.2-1.6:1 and is reinforcement only; the bg -> card
     * luminance step is the actual boundary. If this ever collapses to 1.0 the
     * system has no elevation at all, which is what shipped before. */
    it("card sits on a real tonal step above the page", () => {
      expect(ratioTo(tokens, "card", "bg")).toBeGreaterThan(1.03);
    });
  });

  describe("chart ramp", () => {
    it.each(CHART_STEPS)("chart-%i clears 3:1 on card", (step) => {
      expect(ratioTo(tokens, `chart-${step}`, "card")).toBeGreaterThanOrEqual(3);
    });

    /* The ramp alternates luminance bands so every ADJACENT pair separates.
     * All-pairs-distinct is mathematically impossible at n=8 with two bands —
     * chart-3/chart-7 sit at 1.00:1 to each other — which is why rank-order
     * assignment and the 1px card divider are binding rules rather than advice.
     * Asserting adjacency is therefore the correct and only meaningful guard. */
    it("every adjacent pair separates by at least 1.35:1", () => {
      for (let step = 1; step < 8; step += 1) {
        expect(
          ratioTo(tokens, `chart-${step}`, `chart-${step + 1}`)
        ).toBeGreaterThanOrEqual(1.35);
      }
    });
  });
});

describe("token layer integrity", () => {
  it("every light token has a dark counterpart", () => {
    const missing = Object.keys(MODES.light).filter(
      (name) => !(name in MODES.dark)
    );
    expect(missing).toEqual([]);
  });

  /* The entitlement is not a status, and the fastest way for that to stop being
   * true is someone "consolidating" premium onto the caution ramp because both
   * are goldish. Pinning them apart in both modes makes that a failing test
   * rather than a silent regression: a premium account would start reading as
   * something the user has to act on. */
  it.each(["caution", "caution-ink"])(
    "keeps premium-ink a separate value from %s in both modes",
    (statusToken) => {
      for (const [mode, tokens] of Object.entries(MODES)) {
        expect(
          tokens["premium-ink"],
          `premium-ink duplicates ${statusToken} in ${mode}`
        ).not.toBe(tokens[statusToken]);
      }
    }
  );

  it("ships no premium fill, because the entitlement is never a status pill", () => {
    expect(TOKENS_CSS).not.toContain("--premium-bg");
  });

  it("carries no raw JetBrains Mono reference", () => {
    expect(TOKENS_CSS).not.toMatch(/JetBrains/i);
  });

  it("handles Windows High Contrast Mode", () => {
    expect(TOKENS_CSS).toContain("forced-colors: active");
  });

  it("honours reduced motion with no carve-outs", () => {
    expect(TOKENS_CSS).toContain("prefers-reduced-motion: reduce");
  });

  it("keeps the shadow budget to the floating layers", () => {
    const shadowTokens = [...TOKENS_CSS.matchAll(/--shadow-[a-z-]+:/g)].map(
      (m) => m[0]
    );
    expect(new Set(shadowTokens)).toEqual(
      new Set(["--shadow-float-value:", "--shadow-float:"])
    );
  });
});
