import type { ComponentProps } from "react";
import { Button, cn } from "@nixus/shared";

import { trackEvent } from "@/lib/analytics";

import { release } from "./release.gen";
import { useOptionalDownloadState } from "./DownloadStateContext";

/** Sizes correspond to the shared Button's size variants. */
export type DownloadCTASize = "sm" | "default" | "lg";

export type DesktopOS = "macos" | "windows";

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

export function urlForOS(osKey: DesktopOS): string {
  return release.assets[osKey].url;
}

type ButtonSize = NonNullable<ComponentProps<typeof Button>["size"]>;

/**
 * The DownloadCTA's outer button-size and the alt-OS / both-options
 * button-sizes don't necessarily match. The primary CTA uses whatever the
 * caller asked for; secondary affordances are always one step smaller so
 * they read as secondary.
 */
export function secondarySize(size: DownloadCTASize): ButtonSize {
  if (size === "lg") return "default";
  if (size === "default") return "sm";
  return "sm";
}

/**
 * Every real download control shares one click contract: mark the shared
 * download state so sibling reveals (the post-download banner) see the click
 * immediately, then beacon. It never `preventDefault`s — navigation is the
 * anchor's job, and React batches the state update while the browser still
 * completes the native download.
 */
export function useDownloadClick(): (os: DesktopOS) => () => void {
  // Returns `null` when no provider is present (tests, ad-hoc renders), so the
  // handler simply skips the state mutation rather than throwing.
  const downloadState = useOptionalDownloadState();

  return (os: DesktopOS) => () => {
    downloadState?.setClicked(os);
    trackEvent({
      name: "download.clicked",
      properties: { os, version: release.version },
    });
  };
}

/**
 * Container element wrapping the CTA. Stack vertically (CTA + version /
 * alt link below) and let the caller override layout via `className`.
 */
export function CTAContainer({
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
