/**
 * Unit tests for the `DownloadCTA` component (Stories 2.3 + 2.4).
 *
 * Strategy: mock `useOSDetection` (so we control the OS branch without
 * juggling navigator UA strings) and mock `release.gen.ts` per-test where
 * we need stub-vs-real release data. The analytics module is replaced
 * with a vi.fn so we can assert on click tracking.
 *
 * What we explicitly DON'T test here:
 *   - `useOSDetection`'s own behavior — covered by `useOSDetection.test.ts`.
 *   - The shared `Button`'s rendering — covered by the @nixus/shared package.
 *   - Real network downloads — that's an e2e concern.
 */

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Initializes the singleton i18n instance (with EN+FR resources) before
// the component imports react-i18next's useTranslation hook. Without this,
// `t('download.macos')` returns the literal key rather than the EN value
// because no resources have been registered.
import "@/lib/i18n";

// Hoisted-mock pattern: vi.mock is hoisted, so we can't reference outer
// variables. Instead, we let the mock factory create the mock function
// and we grab a handle to it in each test via the mocked module.

vi.mock("./useOSDetection", () => ({
  useOSDetection: vi.fn(),
}));

vi.mock("@/lib/analytics", () => ({
  trackEvent: vi.fn(),
}));

vi.mock("./release.gen", () => ({
  release: {
    version: "latest",
    assets: {
      macos: { url: "https://example.com/nixus_universal.dmg" },
      windows: { url: "https://example.com/nixus_x64-setup.exe" },
    },
  },
}));

// Import AFTER vi.mock declarations so the mocks are in place.
import {
  DownloadCTA,
  _resetSessionShownEventsForTests,
} from "./DownloadCTA";
import {
  DownloadStateProvider,
  useDownloadState,
} from "./DownloadStateContext";
import { useOSDetection } from "./useOSDetection";
import { trackEvent } from "@/lib/analytics";

const mockedUseOS = vi.mocked(useOSDetection);
const mockedTrackEvent = vi.mocked(trackEvent);

beforeEach(() => {
  // Reset module-level session dedupe so each test starts from a clean
  // slate — otherwise the second test that asserts on the "shown" event
  // would see the dedupe trip from the first test's mount.
  _resetSessionShownEventsForTests();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("DownloadCTA — loading / SSR-equivalent state", () => {
  beforeEach(() => {
    mockedUseOS.mockReturnValue({ os: "unknown", isLoading: true });
  });

  it("renders the 'Choose your platform' variant", () => {
    render(<DownloadCTA />);
    expect(screen.getByText("Choose your platform")).toBeInTheDocument();
    // Both OS options must be present so the prerendered HTML has working
    // download links even before hydration / with JS disabled.
    expect(screen.getByTestId("download-cta-macos")).toBeInTheDocument();
    expect(screen.getByTestId("download-cta-windows")).toBeInTheDocument();
  });
});

describe("DownloadCTA — macOS hydrated", () => {
  beforeEach(() => {
    mockedUseOS.mockReturnValue({ os: "macos", isLoading: false });
  });

  it("renders 'Download for macOS' as an anchor pointing at the macOS asset", () => {
    render(<DownloadCTA />);
    const anchor = screen.getByTestId("download-cta-primary");
    expect(anchor.tagName).toBe("A");
    expect(anchor).toHaveAttribute(
      "href",
      "https://example.com/nixus_universal.dmg",
    );
    // The `download` attribute is the right-semantic signal even though
    // browsers may ignore it for cross-origin URLs.
    expect(anchor).toHaveAttribute("download");
    expect(anchor).toHaveTextContent(/Download for macOS/);
  });

  it("renders the alt-OS link when showAltOS is true", () => {
    render(<DownloadCTA showAltOS />);
    const alt = screen.getByTestId("download-cta-alt");
    expect(alt.tagName).toBe("A");
    expect(alt).toHaveAttribute(
      "href",
      "https://example.com/nixus_x64-setup.exe",
    );
    expect(alt).toHaveTextContent(/Or download for Windows/);
  });

  it("fires trackEvent on click without preventing default navigation", () => {
    render(<DownloadCTA />);
    const anchor = screen.getByTestId("download-cta-primary");
    fireEvent.click(anchor);
    expect(mockedTrackEvent).toHaveBeenCalledTimes(1);
    expect(mockedTrackEvent).toHaveBeenCalledWith({
      name: "download.clicked",
      properties: { os: "macos", version: "latest" },
    });
  });

  it("right-click compatibility: rendered element is a real <a> with the binary URL", () => {
    // We can't simulate the OS context menu in jsdom, but we CAN assert
    // the element shape that makes "Copy Link Address" return the right
    // value: it must be a plain anchor with `href` set to the asset URL,
    // with no client-side handler that would intercept native nav.
    render(<DownloadCTA />);
    const anchor = screen.getByTestId("download-cta-primary");
    expect(anchor.tagName).toBe("A");
    expect(anchor).toHaveAttribute(
      "href",
      "https://example.com/nixus_universal.dmg",
    );
  });
});

describe("DownloadCTA — Windows hydrated", () => {
  beforeEach(() => {
    mockedUseOS.mockReturnValue({ os: "windows", isLoading: false });
  });

  it("renders 'Download for Windows' as an anchor pointing at the Windows asset", () => {
    render(<DownloadCTA />);
    const anchor = screen.getByTestId("download-cta-primary");
    expect(anchor.tagName).toBe("A");
    expect(anchor).toHaveAttribute(
      "href",
      "https://example.com/nixus_x64-setup.exe",
    );
    expect(anchor).toHaveTextContent(/Download for Windows/);
  });

  it("alt-OS link points back at macOS when on Windows", () => {
    render(<DownloadCTA showAltOS />);
    const alt = screen.getByTestId("download-cta-alt");
    expect(alt).toHaveAttribute(
      "href",
      "https://example.com/nixus_universal.dmg",
    );
    expect(alt).toHaveTextContent(/Or download for macOS/);
  });

  it("tracks the right OS in the analytics payload", () => {
    render(<DownloadCTA />);
    fireEvent.click(screen.getByTestId("download-cta-primary"));
    expect(mockedTrackEvent).toHaveBeenCalledWith({
      name: "download.clicked",
      properties: { os: "windows", version: "latest" },
    });
  });
});

describe("DownloadCTA — Linux hydrated", () => {
  beforeEach(() => {
    mockedUseOS.mockReturnValue({ os: "linux", isLoading: false });
  });

  it("falls back to 'Choose your platform' with both options visible", () => {
    render(<DownloadCTA />);
    expect(screen.getByText("Choose your platform")).toBeInTheDocument();
    expect(screen.getByTestId("download-cta-macos")).toBeInTheDocument();
    expect(screen.getByTestId("download-cta-windows")).toBeInTheDocument();
  });

  it("appends a small Linux-specific note linking to the FAQ anchor (Story 2.4)", () => {
    render(<DownloadCTA />);
    const note = screen.getByTestId("download-cta-linux-note");
    expect(note).toHaveTextContent(/Looking for Linux\?/);
    const noteLink = screen.getByTestId("download-cta-linux-note-link");
    // Soft anchor that won't 404 even if the FAQ section isn't rendered;
    // Story 3.6 will fill in the actual FAQ entry.
    expect(noteLink).toHaveAttribute("href", "#faq");
  });

  it("fires `os.linux_message_shown` exactly once after hydration", () => {
    render(<DownloadCTA />);
    expect(mockedTrackEvent).toHaveBeenCalledWith({
      name: "os.linux_message_shown",
    });
    // Only that one event should have fired (no spurious download
    // events at mount time).
    const linuxEvents = mockedTrackEvent.mock.calls.filter(
      ([e]) => e.name === "os.linux_message_shown",
    );
    expect(linuxEvents).toHaveLength(1);
  });

  it("does NOT re-fire `os.linux_message_shown` for a second instance (module-level dedup)", () => {
    render(<DownloadCTA />);
    render(<DownloadCTA />);
    const linuxEvents = mockedTrackEvent.mock.calls.filter(
      ([e]) => e.name === "os.linux_message_shown",
    );
    expect(linuxEvents).toHaveLength(1);
  });
});

describe("DownloadCTA — mobile hydrated (Story 2.4)", () => {
  beforeEach(() => {
    mockedUseOS.mockReturnValue({ os: "mobile", isLoading: false });
  });

  it("renders the 'Visit on a Mac or PC to download' headline (no desktop binary buttons)", () => {
    render(<DownloadCTA />);
    expect(
      screen.getByTestId("download-cta-mobile-headline"),
    ).toHaveTextContent(/Visit on a Mac or PC to download/);
    // Explicitly NOT showing the desktop OS download buttons — a phone
    // visitor pressing those would just fail noisily.
    expect(
      screen.queryByTestId("download-cta-macos"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("download-cta-windows"),
    ).not.toBeInTheDocument();
  });

  it("shows the 'Send to my computer' affordance with Copy + Email actions", () => {
    render(<DownloadCTA />);
    expect(
      screen.getByTestId("download-cta-mobile-affordance"),
    ).toHaveTextContent(/Send to my computer/);
    expect(screen.getByTestId("download-cta-mobile-copy")).toBeInTheDocument();
    expect(screen.getByTestId("download-cta-mobile-email")).toBeInTheDocument();
  });

  it("Email-link is a real `<a>` with a `mailto:` href so right-click works", () => {
    render(<DownloadCTA />);
    const email = screen.getByTestId("download-cta-mobile-email");
    expect(email.tagName).toBe("A");
    expect(email.getAttribute("href")).toMatch(/^mailto:/);
    // Subject + body should both round-trip through encodeURIComponent.
    expect(email.getAttribute("href")).toContain(
      "subject=Try%20Nixus%20on%20your%20Mac%20or%20PC",
    );
    expect(email.getAttribute("href")).toContain(
      "body=https%3A%2F%2Fnixus.nicolasbazinet.net",
    );
  });

  it("Copy-link button writes the page URL to the clipboard and shows 'Copied!' briefly", async () => {
    // jsdom doesn't ship a real clipboard; we substitute a vi.fn that
    // resolves so the state update path runs to completion.
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(<DownloadCTA />);
    const copyBtn = screen.getByTestId("download-cta-mobile-copy");
    expect(copyBtn).toHaveTextContent("Copy link");

    await act(async () => {
      fireEvent.click(copyBtn);
    });

    // Verify the call shape — the page URL comes from
    // `window.location.href` which jsdom defaults to "http://localhost/".
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(window.location.href);

    // Label flips to "Copied!" after the promise resolves.
    await waitFor(() => {
      expect(copyBtn).toHaveTextContent("Copied!");
    });
  });

  it("fires `os.mobile_message_shown` exactly once after hydration", () => {
    render(<DownloadCTA />);
    expect(mockedTrackEvent).toHaveBeenCalledWith({
      name: "os.mobile_message_shown",
    });
    const events = mockedTrackEvent.mock.calls.filter(
      ([e]) => e.name === "os.mobile_message_shown",
    );
    expect(events).toHaveLength(1);
  });

  it("does NOT re-fire `os.mobile_message_shown` for a second instance (module-level dedup)", () => {
    render(<DownloadCTA />);
    render(<DownloadCTA />);
    const events = mockedTrackEvent.mock.calls.filter(
      ([e]) => e.name === "os.mobile_message_shown",
    );
    expect(events).toHaveLength(1);
  });
});

describe("DownloadCTA — unknown UA hydrated", () => {
  beforeEach(() => {
    mockedUseOS.mockReturnValue({ os: "unknown", isLoading: false });
  });

  it("falls back to 'Choose your platform' with no Linux note", () => {
    render(<DownloadCTA />);
    expect(screen.getByText("Choose your platform")).toBeInTheDocument();
    // The Linux note is opt-in: unknown-UA shouldn't get Linux-flavored
    // copy.
    expect(
      screen.queryByTestId("download-cta-linux-note"),
    ).not.toBeInTheDocument();
  });
});

/**
 * Story 2.5: clicking the CTA must propagate to the shared
 * `DownloadStateContext` so `<InstallInstructions />` reveals. We assert
 * this here by mounting the CTA inside the provider with a small consumer
 * that surfaces the context state to the DOM, then asserting the state
 * flips after the click.
 */
describe("DownloadCTA — DownloadStateContext propagation (Story 2.5)", () => {
  function StateProbe() {
    const { hasClicked, clickedOS } = useDownloadState();
    return (
      <div data-testid="state-probe">
        {String(hasClicked)}:{clickedOS ?? "none"}
      </div>
    );
  }

  beforeEach(() => {
    mockedUseOS.mockReturnValue({ os: "macos", isLoading: false });
  });

  it("flips hasClicked + records clickedOS when the macOS anchor is clicked", () => {
    render(
      <DownloadStateProvider>
        <DownloadCTA />
        <StateProbe />
      </DownloadStateProvider>,
    );

    // Pre-click baseline.
    expect(screen.getByTestId("state-probe")).toHaveTextContent(
      "false:none",
    );

    // The anchor's real href would trigger a jsdom navigation; suppress
    // it at the capture phase so the assertion can observe the click's
    // state-update side effect cleanly.
    const anchor = screen.getByTestId("download-cta-primary");
    anchor.addEventListener("click", (e) => e.preventDefault(), {
      capture: true,
    });
    act(() => {
      fireEvent.click(anchor);
    });

    expect(screen.getByTestId("state-probe")).toHaveTextContent(
      "true:macos",
    );
  });

  it("propagates the windows OS when the choose-platform Windows button is clicked", () => {
    mockedUseOS.mockReturnValue({ os: "linux", isLoading: false });
    render(
      <DownloadStateProvider>
        <DownloadCTA />
        <StateProbe />
      </DownloadStateProvider>,
    );

    const winBtn = screen.getByTestId("download-cta-windows");
    winBtn.addEventListener("click", (e) => e.preventDefault(), {
      capture: true,
    });
    act(() => {
      fireEvent.click(winBtn);
    });

    expect(screen.getByTestId("state-probe")).toHaveTextContent(
      "true:windows",
    );
  });

  it("mobile variant does NOT fire setClicked (no real download anchor)", () => {
    mockedUseOS.mockReturnValue({ os: "mobile", isLoading: false });
    render(
      <DownloadStateProvider>
        <DownloadCTA />
        <StateProbe />
      </DownloadStateProvider>,
    );

    // Mobile variant offers Copy + Email but no real binary anchor.
    // Clicking the Email link MUST NOT flip download state — emailing a
    // link to oneself isn't a download.
    const email = screen.getByTestId("download-cta-mobile-email");
    email.addEventListener("click", (e) => e.preventDefault(), {
      capture: true,
    });
    act(() => {
      fireEvent.click(email);
    });

    expect(screen.getByTestId("state-probe")).toHaveTextContent(
      "false:none",
    );
  });
});
