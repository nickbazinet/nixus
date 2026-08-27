/**
 * Isolation matters here: React emits its unknown-DOM-prop warning once per
 * prop-and-component pair per module realm. Vitest gives each test FILE a fresh
 * realm, so this lives apart from `DownloadBanner.test.tsx` — inside that file
 * an earlier render consumes the warning and this assertion passes while the bug
 * is still present.
 *
 * The bug it guards: the localized bodies embed `<strong>` markup, so they must
 * be rendered through a translation component. The `<Trans components={{ strong:
 * <strong /> }}>` form made react-i18next forward its internal
 * `i18nIsDynamicList` bookkeeping prop onto the `<strong>`, which React rejects
 * as an unknown DOM property. React strips unknown props in production builds,
 * so the dev-mode diagnostic is the only signal — hence asserting on the console
 * and not only on the DOM.
 */

import { screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DownloadStateProvider,
  useDownloadState,
} from "@/features/download/DownloadStateContext";
import type { OS } from "@/features/download/os.types";
import {
  captureConsoleErrors,
  type ConsoleCapture,
} from "@/lib/hydration-test-utils";
import { renderWithProviders } from "@/lib/test-utils";

vi.mock("@tanstack/react-router", () => ({
  useLocation: () => ({ pathname: "/" }),
}));

import { DownloadBanner } from "./DownloadBanner";

function Seeder({ os }: { os: OS }) {
  const { setClicked } = useDownloadState();
  useEffect(() => {
    setClicked(os);
  }, [os, setClicked]);
  return null;
}

let capture: ConsoleCapture;

beforeEach(() => {
  capture = captureConsoleErrors();
});

afterEach(() => {
  capture.restore();
});

describe("<DownloadBanner /> localized markup", () => {
  it("renders real <strong> emphasis without leaking library props to the DOM", () => {
    renderWithProviders(
      <DownloadStateProvider>
        <Seeder os="macos" />
        <DownloadBanner />
      </DownloadStateProvider>,
    );

    const banner = screen.getByTestId("download-banner");
    const emphasis = Array.from(banner.querySelectorAll("strong"));

    expect(emphasis.length).toBeGreaterThan(0);
    for (const node of emphasis) {
      expect(node.textContent?.trim()).not.toBe("");
      expect(
        node.getAttributeNames().filter((name) => /i18n/i.test(name)),
      ).toEqual([]);
    }

    expect(
      capture.messages.filter((message) => /i18nIsDynamicList/i.test(message)),
    ).toEqual([]);
  });
});
