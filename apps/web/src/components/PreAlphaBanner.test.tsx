import { fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import i18n from "@/lib/i18n";
import { renderWithProviders } from "@/lib/test-utils";

import { PreAlphaBanner } from "./PreAlphaBanner";

const STORAGE_KEY = "nixus.preAlphaDismissed";

// jsdom's `window.localStorage` exposes a bare object with no prototype methods,
// so we install a minimal in-memory shim per test that the component can call.
function installLocalStorage(impl?: Partial<Storage>) {
  const store = new Map<string, string>();
  const ls: Storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => void store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
    ...impl,
  };
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: ls,
  });
  return ls;
}

describe("<PreAlphaBanner />", () => {
  beforeEach(() => {
    installLocalStorage();
    document.documentElement.removeAttribute("data-pre-alpha-dismissed");
  });

  afterEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("renders the EN message and dismiss button with translated aria-label", () => {
    renderWithProviders(<PreAlphaBanner />);
    expect(screen.getByTestId("pre-alpha-banner")).toBeInTheDocument();
    expect(
      screen.getByText(
        /Nixus is in pre-alpha — the product is still maturing/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Dismiss pre-alpha notice" }),
    ).toBeInTheDocument();
  });

  it("renders a Learn more anchor pointing to /beta (route-aware)", () => {
    renderWithProviders(<PreAlphaBanner />);
    const link = screen.getByRole("link", { name: /Learn more/i });
    expect(link).toHaveAttribute("href", "/beta");
  });

  /* "Learn more" on its own is the generic link text Lighthouse's `link-text`
   * audit flags, and a screen-reader user tabbing a link list gets nothing from
   * it. The audit and crawlers read the link's TEXT, not `aria-label`, so the
   * description has to be content — carried in an out-of-flow `sr-only` node so
   * the visible copy is byte-identical to what it always was. */
  it("describes the link in text that is accessible-only, leaving visible copy intact", () => {
    renderWithProviders(<PreAlphaBanner />);
    const link = screen.getByRole("link", { name: /Learn more/i });
    const srSuffix = link.querySelector(".sr-only")?.textContent ?? "";

    expect(srSuffix.trim().length).toBeGreaterThan(0);
    expect(link.textContent).toBe(`Learn more${srSuffix}`);
    expect(link).not.toHaveAttribute("aria-label");
  });

  it("has data-pre-alpha-banner on the root element", () => {
    renderWithProviders(<PreAlphaBanner />);
    expect(screen.getByTestId("pre-alpha-banner")).toHaveAttribute(
      "data-pre-alpha-banner",
    );
  });

  it("dismisses, persists to localStorage, and sets the html attribute", () => {
    renderWithProviders(<PreAlphaBanner />);
    fireEvent.click(
      screen.getByRole("button", { name: "Dismiss pre-alpha notice" }),
    );
    expect(screen.queryByTestId("pre-alpha-banner")).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("1");
    expect(
      document.documentElement.getAttribute("data-pre-alpha-dismissed"),
    ).toBe("1");
  });

  it("still hides for the session when localStorage throws", () => {
    installLocalStorage({
      setItem: () => {
        throw new Error("denied");
      },
    });
    renderWithProviders(<PreAlphaBanner />);
    expect(() =>
      fireEvent.click(
        screen.getByRole("button", { name: "Dismiss pre-alpha notice" }),
      ),
    ).not.toThrow();
    expect(screen.queryByTestId("pre-alpha-banner")).toBeNull();
  });

  /* Warm Editorial (DESIGN.md "Marketing — Warm Editorial") repaints the web
   * light mode through the shared spine variables. The status family is
   * explicitly excluded from that override — `main.css` never redeclares
   * `--caution*` — so a notice that hand-rolls raw `amber-*` is the one surface
   * that cannot follow the palette and cannot follow dark mode either. These
   * tests pin the semantic alias instead of the hex, and pin the *absence* of
   * raw palette so the clash cannot come back. Rendered colour is proven
   * separately in `tests/e2e/chrome-notices.spec.ts`; jsdom computes no theme. */
  describe("Warm Editorial notice palette", () => {
    function noticeClasses() {
      const root = screen.getByTestId("pre-alpha-banner");
      return {
        root: root.className,
        link: screen.getByRole("link", { name: /Learn more/i }).className,
        dismiss: screen.getByRole("button", {
          name: "Dismiss pre-alpha notice",
        }).className,
      };
    }

    it("paints the notice surface with the semantic caution aliases", () => {
      renderWithProviders(<PreAlphaBanner />);
      const { root } = noticeClasses();

      expect(root).toContain("bg-caution-bg");
      expect(root).toContain("text-caution-ink");
      expect(root).toContain("border-caution/25");
    });

    it("carries no raw Tailwind palette class on the notice or its controls", () => {
      renderWithProviders(<PreAlphaBanner />);
      const { root, link, dismiss } = noticeClasses();

      /* tokens.css rule 5: "No raw Tailwind palette classes anywhere in the
       * product. If you need a colour and it is not here, the answer is a
       * token." `amber` is called out by name in DESIGN.md's Do-Not table. */
      const RAW_PALETTE =
        /\b(?:amber|slate|zinc|gray|neutral|stone|emerald|teal|rose|sky|indigo|violet|fuchsia|pink)-\d{2,3}\b/;

      for (const [where, classes] of Object.entries({ root, link, dismiss })) {
        expect(classes, `${where} carries a raw palette class`).not.toMatch(
          RAW_PALETTE,
        );
      }
    });

    it("needs no dark: colour variant because the caution aliases are mode-aware", () => {
      renderWithProviders(<PreAlphaBanner />);
      const { root, link, dismiss } = noticeClasses();

      /* `--caution*` already resolves per mode in tokens.css, so a hand-written
       * `dark:` colour override on this surface is a second source of truth and
       * the exact thing that let light and dark drift apart. */
      const DARK_COLOUR_VARIANT = /dark:(?:hover:)?(?:bg|text|border|ring)-/;

      for (const [where, classes] of Object.entries({ root, link, dismiss })) {
        expect(classes, `${where} still overrides colour in dark`).not.toMatch(
          DARK_COLOUR_VARIANT,
        );
      }
    });

    it("uses the one global focus ring rather than a per-surface ring colour", () => {
      renderWithProviders(<PreAlphaBanner />);
      const { link, dismiss } = noticeClasses();

      /* DESIGN.md: "{components.focus-ring} — ring plus surface-colored offset,
       * on every interactive element." One ring token for the whole product;
       * SiteFooter and the skip link already use exactly this pair. */
      for (const [where, classes] of Object.entries({ link, dismiss })) {
        expect(classes, `${where} focus ring`).toContain(
          "focus-visible:ring-ring/50",
        );
        expect(classes, `${where} focus ring width`).toContain(
          "focus-visible:ring-3",
        );
      }
    });

    it("preserves the banner geometry, anchor and dismiss target the palette must not disturb", () => {
      renderWithProviders(<PreAlphaBanner />);
      const root = screen.getByTestId("pre-alpha-banner");
      const bar = root.firstElementChild;
      const dismiss = screen.getByRole("button", {
        name: "Dismiss pre-alpha notice",
      });

      // Full-bleed band above the sticky header, not inside it: `headerReport()`
      // in the E2E suite measures `header > :first-child` as the bar.
      expect(root.className).toContain("w-full");
      expect(root.className).toContain("border-b");
      expect(root).toHaveAttribute("role", "region");

      expect(bar?.className).toContain("mkt-page-x");
      expect(bar?.className).toContain("max-w-[1280px]");
      expect(bar?.className).toContain("py-2");

      // The 44px floor below 1024px comes from `mkt-tap`; `size-7` is the
      // visual box inside it. Losing either regresses touch-targets.spec.ts.
      expect(dismiss.className).toContain("mkt-tap");
      expect(dismiss.className).toContain("size-7");

      // WCAG 2.5.8 exempts a link inside running text, which is why this link
      // is inline in the sentence and not a third flex item.
      const link = screen.getByRole("link", { name: /Learn more/i });
      expect(link.closest("p")).not.toBeNull();
    });
  });

  it("renders the FR copy under the fr locale", async () => {
    await i18n.changeLanguage("fr");
    renderWithProviders(<PreAlphaBanner />);
    expect(
      screen.getByText(
        /Nixus est en pré-alpha — le produit évolue encore/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Fermer l'avis pré-alpha" }),
    ).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /En savoir plus/i });
    expect(link).toHaveAttribute("href", "/fr/beta");
    const srSuffix = link.querySelector(".sr-only")?.textContent ?? "";
    expect(srSuffix.trim().length).toBeGreaterThan(0);
    expect(link.textContent).toBe(`En savoir plus${srSuffix}`);
  });
});
