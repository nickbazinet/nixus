/**
 * Download CTA (Stories 2.3 + 2.4).
 *
 * The marketing site's primary call-to-action: "Download for <OS>". Renders
 * a real `<a href>` so right-click "Copy Link" works, the browser's native
 * download semantics kick in, and JS-disabled visitors still get a working
 * download. Click events ALSO fire an analytics beacon, but they never
 * `preventDefault` — navigation is the anchor's job, not ours.
 *
 * SSR / hydration model:
 *   - The prerender pass and the very first client render both see
 *     `useOSDetection() => { os: 'unknown', isLoading: true }`. To avoid a
 *     hydration mismatch, the rendered HTML must be identical in both
 *     phases until React's `useEffect` runs. We achieve this by rendering
 *     the "Choose your platform" two-button variant whenever `isLoading`
 *     is true, which is exactly the same shape the `linux | unknown`
 *     branch produces post-hydration. No layout shift, no flash.
 *   - After hydration, if the parsed OS is `macos` or `windows`, the CTA
 *     upgrades in place to the single-button OS-specific variant. If it's
 *     `mobile`, it swaps to a "Visit on a Mac or PC to download" message
 *     with a small "Send to my computer" affordance (Story 2.4).
 *
 * Story 2.4 additions:
 *   - Mobile-specific variant: doesn't pretend a phone can run the desktop
 *     binary. Instead, asks the visitor to come back from a desktop and
 *     gives them a Copy/Email-the-link affordance so they actually do.
 *   - Linux variant: same two-button "Choose your platform" shape as
 *     before, plus a small text note pointing toward future FAQ context.
 *   - One-time-per-session message-shown analytics for both branches so
 *     we can measure how often these branches are hit. Dedup is module-
 *     level (a `Set<string>`) so multiple `<DownloadCTA />` instances on
 *     the same page (header + hero + sticky) don't double-fire.
 */

import { useEffect, useRef, useState, type ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import { Button, cn } from "@nixus/shared";

import { trackEvent } from "@/lib/analytics";
import { SITE } from "@/lib/meta";

import { release } from "./release.gen";
import { useOptionalDownloadState } from "./DownloadStateContext";
import { useOSDetection } from "./useOSDetection";

/** Sizes correspond to the shared Button's size variants. */
type DownloadCTASize = "sm" | "default" | "lg";

export type DownloadCTAProps = {
  /** Visual size — sticky header uses 'sm', mid-page 'default', hero 'lg'. */
  size?: DownloadCTASize;
  /**
   * When true and the OS-specific (macos/windows) variant is rendered,
   * show a small text link to the *other* OS's download below the CTA.
   * Ignored for the "Choose your platform" variant (which already shows
   * both options inline).
   */
  showAltOS?: boolean;
  /** Layout overrides at the call site (e.g., spacing in the hero). */
  className?: string;
};

// OS labels are translation keys (`header.macos`, `header.windows`) so the
// label is consistent everywhere they're surfaced — single-OS button, alt-OS
// secondary link, and the choose-platform variant.

/** Resolve the download URL for a given OS. */
function urlForOS(osKey: "macos" | "windows"): string {
  return release.assets[osKey].url;
}

type ButtonSize = NonNullable<ComponentProps<typeof Button>["size"]>;

/**
 * The DownloadCTA's outer button-size and the alt-OS / both-options
 * button-sizes don't necessarily match. The primary CTA uses whatever the
 * caller asked for; secondary affordances are always one step smaller so
 * they read as secondary.
 */
function secondarySize(size: DownloadCTASize): ButtonSize {
  if (size === "lg") return "default";
  if (size === "default") return "sm";
  return "sm";
}

/**
 * Module-level dedupe for "shown" analytics events.
 *
 * Why module-level rather than per-instance: `<DownloadCTA />` may render
 * in multiple slots on a single page (header + hero + sticky footer). A
 * `useRef`-based dedupe would let each instance fire once, which would
 * over-count by 2-3x. A module-level Set survives across all instances
 * within the SPA session — the store resets on full reload, which is the
 * right granularity for "per session".
 *
 * This is local module state and intentionally not cleared between
 * renders. Tests that need a fresh state should `vi.resetModules()`.
 */
const sessionShownEvents = new Set<string>();

/**
 * Public API: clear the in-memory "shown events" dedup set.
 *
 * Exposed solely for tests so they can verify the dedupe behavior without
 * juggling `vi.resetModules()` for every assertion. App code should never
 * call this — the natural session boundary is a page reload.
 */
export function _resetSessionShownEventsForTests(): void {
  sessionShownEvents.clear();
}

/**
 * Container element wrapping the CTA. Stack vertically (CTA + version /
 * alt link below) and let the caller override layout via `className`.
 */
function CTAContainer({
  className,
  children,
  ...rest
}: {
  className?: string;
  children: React.ReactNode;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-testid="download-cta"
      className={cn("inline-flex flex-col items-start gap-1.5", className)}
      {...rest}
    >
      {children}
    </div>
  );
}

/**
 * Render the single-OS variant: one big primary button, optional version
 * subtitle, optional alt-OS text link.
 */
function SingleOSVariant({
  os,
  size,
  showAltOS,
  className,
}: {
  os: "macos" | "windows";
  size: DownloadCTASize;
  showAltOS: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const url = urlForOS(os);
  const label = t(`download.${os}`);
  const otherOS: "macos" | "windows" = os === "macos" ? "windows" : "macos";
  const otherURL = urlForOS(otherOS);
  const otherLabel = t("download.altOsLink", { os: t(`header.${otherOS}`) });

  // `useOptionalDownloadState` returns `null` when no provider is present
  // (tests, ad-hoc renders), so the click handler simply skips the state
  // mutation in that case rather than throwing. In the running app the
  // root layout always provides one.
  const downloadState = useOptionalDownloadState();

  const handleClick = () => {
    // Setting state synchronously inside the click handler is safe: React
    // batches the state update and the browser still completes native
    // anchor navigation. We deliberately do NOT preventDefault — the
    // download must continue. Marking state first means any sibling CTA
    // (or the InstallInstructions reveal) sees the click immediately.
    downloadState?.setClicked(os);
    trackEvent({
      name: "download.clicked",
      properties: { os, version: release.version },
    });
  };

  const handleAltClick = () => {
    downloadState?.setClicked(otherOS);
    trackEvent({
      name: "download.clicked",
      properties: { os: otherOS, version: release.version },
    });
  };

  return (
    <CTAContainer className={className} data-os={os}>
      <Button
        nativeButton={false}
        size={size}
        render={
          <a
            href={url}
            // `download` is a hint — browsers may ignore it for
            // cross-origin URLs, but it's still the right semantic
            // signal for "this is a file, not a navigation target".
            download
            // No `target=_blank`: starting a download in the current
            // tab is the conventional behavior; opening a new tab
            // would just leave a stray empty window behind.
            rel="noopener"
            onClick={handleClick}
            data-testid="download-cta-primary"
          >
            {label}
          </a>
        }
      />
      {showAltOS ? (
        <a
          href={otherURL}
          download
          rel="noopener"
          onClick={handleAltClick}
          className="text-xs text-muted-foreground underline-offset-4 hover:underline"
          data-testid="download-cta-alt"
        >
          {otherLabel}
        </a>
      ) : null}
    </CTAContainer>
  );
}

/**
 * Render the "Choose your platform" variant: two side-by-side (or stacked
 * on small screens) buttons, one per OS. This is also the SSR / prerender
 * shape so the prerendered HTML always contains a working `<a href>` for
 * the no-JS fallback (NFR-W7).
 *
 * `showLinuxNote` (Story 2.4): when true, append a small text note that
 * acknowledges Linux visitors specifically. Kept opt-in so the unknown-UA
 * branch (which uses the same variant) doesn't get a Linux-flavored note.
 */
function ChoosePlatformVariant({
  size,
  showLinuxNote = false,
  className,
}: {
  size: DownloadCTASize;
  showLinuxNote?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const buttonSize = secondarySize(size);

  const downloadState = useOptionalDownloadState();

  const renderOption = (osKey: "macos" | "windows") => {
    const url = urlForOS(osKey);
    const handleClick = () => {
      downloadState?.setClicked(osKey);
      trackEvent({
        name: "download.clicked",
        properties: { os: osKey, version: release.version },
      });
    };
    return (
      <Button
        key={osKey}
        nativeButton={false}
        size={buttonSize}
        render={
          <a
            href={url}
            download
            rel="noopener"
            onClick={handleClick}
            data-testid={`download-cta-${osKey}`}
          >
            {t(`download.${osKey}`)}
          </a>
        }
      />
    );
  };

  return (
    <CTAContainer
      className={className}
      data-os={showLinuxNote ? "linux" : "choose"}
    >
      <div className="text-xs font-medium text-muted-foreground">
        {t("download.choosePlatform")}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        {renderOption("macos")}
        {renderOption("windows")}
      </div>
      {showLinuxNote ? (
        <div
          className="text-xs text-muted-foreground"
          data-testid="download-cta-linux-note"
        >
          {t("download.linuxNote")}{" "}
          <a
            href="#faq"
            className="underline-offset-4 hover:underline"
            data-testid="download-cta-linux-note-link"
          >
            {t("download.linuxNoteLink")}
          </a>
        </div>
      ) : null}
    </CTAContainer>
  );
}

/**
 * Mobile variant (Story 2.4): the visitor is on a phone or tablet, so a
 * desktop binary download is meaningless. Instead, deliver the pitch
 * ("come back from a Mac or PC") and give them a frictionless way to do
 * exactly that — Copy link or Email-yourself-a-link.
 *
 * Tone: informational and friendly, not apologetic. We're not blocking
 * them; we're acknowledging that this is the wrong device and offering
 * the bridge.
 */
function MobileVariant({
  className,
}: {
  className?: string;
}) {
  const { t } = useTranslation();
  // `Copied!` confirmation feedback. Reverts after a short delay so the
  // button doesn't get stuck in the post-success state if the visitor
  // doesn't press it again.
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Always clean up the timer on unmount so we don't update state on a
  // detached component.
  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  // Build the URL/mailto on every render rather than memoizing — these
  // are cheap reads, and grabbing them at render time means tests that
  // tweak `window.location` between renders see the updated value.
  // SSR-guarded `window` access: in the prerender pass, fall back to the
  // production placeholder domain.
  const pageURL =
    typeof window !== "undefined" ? window.location.href : SITE.url;

  // Use the production site URL in the mailto body — the copy reads
  // naturally regardless of which path the visitor took to get here, and
  // it works during SSR too.
  const mailtoHref = `mailto:?subject=${encodeURIComponent(
    t("download.emailSubject"),
  )}&body=${encodeURIComponent(SITE.url)}`;

  const handleCopy = async () => {
    try {
      // `navigator.clipboard` is undefined in older browsers and in some
      // test environments. The try/catch + the explicit guard ensure we
      // never throw past the click handler — at worst, the visitor sees
      // no confirmation and can fall back to the email button.
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(pageURL);
        setCopied(true);
        if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
        copyTimerRef.current = setTimeout(() => setCopied(false), 1500);
      }
    } catch {
      // Swallow — clipboard write can reject if the document isn't
      // focused or permissions deny. The email button remains as a
      // fallback so the visitor isn't stranded.
    }
  };

  return (
    <CTAContainer className={className} data-os="mobile">
      <div
        className="text-base font-medium text-foreground"
        data-testid="download-cta-mobile-headline"
      >
        {t("download.visitOnDesktop")}
      </div>
      <div
        className="mt-2 flex flex-col gap-1.5 text-xs text-muted-foreground"
        data-testid="download-cta-mobile-affordance"
      >
        <div>{t("download.sendToComputer")}</div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopy}
            data-testid="download-cta-mobile-copy"
          >
            {copied ? t("download.copied") : t("download.copyLink")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={
              <a
                href={mailtoHref}
                data-testid="download-cta-mobile-email"
              >
                {t("download.emailMeLink")}
              </a>
            }
          />
        </div>
      </div>
    </CTAContainer>
  );
}

/**
 * Public component — the call site rarely cares which variant rendered.
 * Just drop `<DownloadCTA />` into a layout and it does the right thing.
 */
export function DownloadCTA({
  size = "default",
  showAltOS = false,
  className,
}: DownloadCTAProps) {
  const { os, isLoading } = useOSDetection();

  // One-time-per-session "message shown" analytics for the mobile and
  // Linux branches. Fires post-hydration only (so the SSR pass doesn't
  // attempt to dispatch a beacon) and is deduped at module scope so
  // multiple instances of `<DownloadCTA />` on the same page count as a
  // single impression.
  useEffect(() => {
    if (isLoading) return;
    const eventName: "os.mobile_message_shown" | "os.linux_message_shown" | null =
      os === "mobile"
        ? "os.mobile_message_shown"
        : os === "linux"
          ? "os.linux_message_shown"
          : null;
    if (!eventName) return;
    if (sessionShownEvents.has(eventName)) return;
    sessionShownEvents.add(eventName);
    trackEvent({ name: eventName });
  }, [os, isLoading]);

  // SSR / first-client-render and the unknown branch: render the
  // choose-platform shape so the HTML is OS-neutral, hydration matches,
  // and the no-JS fallback already has both download links present.
  if (isLoading || os === "unknown") {
    return <ChoosePlatformVariant size={size} className={className} />;
  }

  // Linux: same shape as the unknown branch, plus a Linux-specific note.
  if (os === "linux") {
    return (
      <ChoosePlatformVariant size={size} showLinuxNote className={className} />
    );
  }

  // Mobile: replace the CTA wholesale with the "come back from a desktop"
  // affordance. We deliberately do NOT render macOS/Windows download
  // buttons here — they would just confuse a phone visitor.
  if (os === "mobile") {
    return <MobileVariant className={className} />;
  }

  // Detected macOS or Windows — upgrade to the single-OS CTA.
  return (
    <SingleOSVariant
      os={os}
      size={size}
      showAltOS={showAltOS}
      className={className}
    />
  );
}
