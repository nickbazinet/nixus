/**
 * Tests for `<DownloadBanner />`.
 *
 * Strategy: drive the component through the *real* `DownloadStateProvider`
 * using a tiny seed helper that fires the provider's setter directly via a
 * captured ref — the same pattern used by the old InstallInstructions tests.
 *
 * The banner is always in the DOM (never conditionally null), so we assert
 * on the `inert` attribute to distinguish interactive vs. collapsed state.
 */

import { act, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DownloadStateProvider,
  useDownloadState,
} from "@/features/download/DownloadStateContext";
import type { OS } from "@/features/download/os.types";
import i18n from "@/lib/i18n";

import { renderWithProviders } from "@/lib/test-utils";

vi.mock("@tanstack/react-router", () => ({
  useLocation: () => ({ pathname: "/" }),
}));

import { DownloadBanner } from "./DownloadBanner";

/**
 * Seeds the download-state context by calling `setClicked(os)` from inside
 * a child component. We do this in `useEffect` so the call lands after
 * mount — calling it during render would warn about updating a parent
 * during a child's render.
 */
function Seeder({ os }: { os: OS | null }) {
  const { setClicked } = useDownloadState();
  useEffect(() => {
    if (os) setClicked(os);
  }, [os, setClicked]);
  return null;
}

function renderWithSeed(seed: OS | null = null) {
  return renderWithProviders(
    <DownloadStateProvider>
      <Seeder os={seed} />
      <DownloadBanner />
    </DownloadStateProvider>,
  );
}

describe("<DownloadBanner /> — pre-click state", () => {
  it("renders the wrapper in the DOM but inert when hasClicked=false", () => {
    renderWithSeed(null);
    const banner = screen.getByTestId("download-banner");
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveAttribute("inert");
  });
});

describe("<DownloadBanner /> — macOS post-click", () => {
  it("removes inert when hasClicked=true with clickedOS=macos", () => {
    renderWithSeed("macos");
    const banner = screen.getByTestId("download-banner");
    expect(banner).not.toHaveAttribute("inert");
  });

  it("shows the heading 'Download started'", () => {
    renderWithSeed("macos");
    expect(screen.getByText(/Download started/i)).toBeInTheDocument();
  });

  it("shows macOS Gatekeeper instructions", () => {
    renderWithSeed("macos");
    const banner = screen.getByTestId("download-banner");
    expect(banner.textContent).toMatch(/System Settings/i);
    expect(banner.textContent).toMatch(/Open Anyway/i);
  });
});

describe("<DownloadBanner /> — Windows post-click", () => {
  it("shows Windows SmartScreen instructions with .exe", () => {
    renderWithSeed("windows");
    const banner = screen.getByTestId("download-banner");
    expect(banner.textContent).toMatch(/SmartScreen/i);
    expect(banner.textContent).toMatch(/More info/i);
    expect(banner.textContent).toMatch(/\.exe/);
  });
});

describe("<DownloadBanner /> — OS switch", () => {
  it("updates banner body when clickedOS changes from macOS to Windows", () => {
    const capture: { setClicked: ((os: OS) => void) | null } = { setClicked: null };

    function TestHarness() {
      const { setClicked } = useDownloadState();
      useEffect(() => {
        capture.setClicked = setClicked;
      }, [setClicked]);
      return <DownloadBanner />;
    }

    renderWithProviders(
      <DownloadStateProvider>
        <TestHarness />
      </DownloadStateProvider>,
    );

    act(() => { capture.setClicked!("macos"); });
    expect(screen.getByTestId("download-banner").textContent).toMatch(/System Settings/i);

    act(() => { capture.setClicked!("windows"); });
    expect(screen.getByTestId("download-banner").textContent).toMatch(/SmartScreen/i);
  });
});

describe("<DownloadBanner /> — French locale", () => {
  beforeEach(() => i18n.changeLanguage("fr"));
  afterEach(() => i18n.changeLanguage("en"));

  it("shows French Windows instruction containing .exe", () => {
    renderWithSeed("windows");
    const banner = screen.getByTestId("download-banner");
    expect(banner.textContent).toMatch(/\.exe/);
  });
});

describe("<DownloadBanner /> — help link", () => {
  it("renders a mailto help link to the support address", () => {
    renderWithSeed("macos");
    const help = screen.getByTestId("download-banner-help");
    expect(help.tagName).toBe("A");
    expect(help).toHaveAttribute(
      "href",
      "mailto:support@nixus.nicolasbazinet.net",
    );
  });
});
