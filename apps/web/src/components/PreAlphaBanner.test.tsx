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
    expect(
      screen.getByRole("link", { name: /En savoir plus/i }),
    ).toHaveAttribute("href", "/fr/beta");
  });
});
