/**
 * SSR/hydration contract for `<AIDemoFigure />`.
 *
 * The component gates its CSS animation on a class it decides at first render.
 * If that decision differs between the server and the browser's first client
 * render, React reports an attribute mismatch and refuses to patch it — the
 * animation silently never starts on a real browser even though jsdom tests
 * pass. These tests pin the parity, not the class value.
 */

import { screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it } from "vitest";
import type { ReactElement } from "react";

import i18n from "@/lib/i18n";
import {
  hydrationMismatches,
  renderAndHydrate,
} from "@/lib/hydration-test-utils";
import { renderWithProviders } from "@/lib/test-utils";

import { AIDemoFigure } from "./AIDemo";

const ANIMATED = "ai-demo--animated";

function withI18n(children: ReactElement) {
  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}

describe("<AIDemoFigure /> SSR parity", () => {
  it("hydrates a server render without a single mismatch", async () => {
    const result = await renderAndHydrate(<AIDemoFigure />, withI18n);

    expect(hydrationMismatches(result)).toEqual([]);
  });

  /* A real browser has `IntersectionObserver`, so the first client render must
   * agree with the server that the animation has NOT started yet. jsdom lacks
   * the observer, which is exactly why the previous jsdom-only assertion passed
   * while Chromium reported a mismatch. */
  it("server-renders the demo un-animated so the first client render can match", async () => {
    const { ssrHtml } = await renderAndHydrate(<AIDemoFigure />, withI18n);

    expect(ssrHtml).toContain("ai-demo");
    expect(ssrHtml).not.toContain(ANIMATED);
  });

  it("still delivers the complete static composition on the server", async () => {
    const { ssrHtml } = await renderAndHydrate(<AIDemoFigure />, withI18n);

    expect(ssrHtml).toContain("ai-demo-summary");
    expect(
      ssrHtml.match(/data-testid="ai-demo-categorized-row"/g) ?? [],
    ).toHaveLength(5);
  });

  it("turns the animation on after mount once the effect runs", () => {
    renderWithProviders(<AIDemoFigure />);

    expect(screen.getByTestId("ai-demo").className).toMatch(/ai-demo--animated/);
  });
});
