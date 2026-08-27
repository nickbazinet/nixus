import { useTranslation } from "react-i18next";
import { Button } from "@nixus/shared";

import {
  CTAContainer,
  urlForOS,
  useDownloadClick,
  type DesktopOS,
  type DownloadCTASize,
} from "./ctaShell";

/**
 * Single-OS variant: one primary button, optional alt-OS text link.
 *
 * A real `<a href>` so right-click "Copy Link" works, the browser's native
 * download semantics kick in, and JS-disabled visitors still get a working
 * download.
 */
export function SingleOSVariant({
  os,
  size,
  showAltOS,
  className,
}: {
  os: DesktopOS;
  size: DownloadCTASize;
  showAltOS: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const url = urlForOS(os);
  const label = t(`download.${os}`);
  const otherOS: DesktopOS = os === "macos" ? "windows" : "macos";
  const otherURL = urlForOS(otherOS);
  const otherLabel = t("download.altOsLink", { os: t(`header.${otherOS}`) });
  const onDownload = useDownloadClick();

  return (
    <CTAContainer className={className} data-os={os}>
      <Button
        nativeButton={false}
        size={size}
        className="mkt-tap-cta"
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
            onClick={onDownload(os)}
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
          onClick={onDownload(otherOS)}
          className="mkt-tap inline-flex items-center text-sm text-muted-foreground underline-offset-4 hover:underline lg:text-xs"
          data-testid="download-cta-alt"
        >
          {otherLabel}
        </a>
      ) : null}
    </CTAContainer>
  );
}
