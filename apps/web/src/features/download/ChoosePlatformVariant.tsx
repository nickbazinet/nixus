import { useTranslation } from "react-i18next";
import { Button } from "@nixus/shared";

import {
  CTAContainer,
  secondarySize,
  urlForOS,
  useDownloadClick,
  type DesktopOS,
  type DownloadCTASize,
} from "./ctaShell";

/**
 * "Choose your platform" variant: one button per OS. This is also the SSR /
 * prerender shape, so the prerendered HTML always contains a working
 * `<a href>` for the no-JS fallback (NFR-W7).
 *
 * `showLinuxNote`: when true, append a small note that acknowledges Linux
 * visitors specifically. Kept opt-in so the unknown-UA branch (which uses the
 * same variant) doesn't get a Linux-flavored note.
 */
export function ChoosePlatformVariant({
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
  const onDownload = useDownloadClick();

  const renderOption = (osKey: DesktopOS) => (
    <Button
      key={osKey}
      nativeButton={false}
      size={buttonSize}
      className="mkt-tap-cta"
      render={
        <a
          href={urlForOS(osKey)}
          download
          rel="noopener"
          onClick={onDownload(osKey)}
          data-testid={`download-cta-${osKey}`}
        >
          {t(`download.${osKey}`)}
        </a>
      }
    />
  );

  return (
    <CTAContainer
      className={className}
      data-os={showLinuxNote ? "linux" : "choose"}
    >
      <div className="text-sm font-medium text-muted-foreground lg:text-xs">
        {t("download.choosePlatform")}
      </div>
      <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
        {renderOption("macos")}
        {renderOption("windows")}
      </div>
      {showLinuxNote ? (
        <div
          className="text-sm text-muted-foreground lg:text-xs"
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
