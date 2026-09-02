import { Trans, useTranslation } from "react-i18next";

import { cn } from "@nixus/shared";

import { CONTACT_EMAIL, contactMailto } from "@/content/contact";
import { useDownloadState } from "@/features/download/DownloadStateContext";

export function DownloadBanner() {
  const { t } = useTranslation();
  const { hasClicked, clickedOS } = useDownloadState();

  const effectiveOS = clickedOS ?? "macos";

  return (
    <div
      data-testid="download-banner"
      inert={!hasClicked}
      className={cn(
        "grid transition-[grid-template-rows] duration-500 ease-out",
        hasClicked ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
      )}
    >
      <div className="overflow-hidden">
        <div className="border-y bg-muted/50">
          <div className="mkt-page-x mx-auto max-w-[960px] py-4 md:py-5">
            <p className="font-bold">{t("downloadBanner.heading")}</p>
            <p className="mt-1 max-w-prose text-base leading-relaxed text-foreground">
              {/* No `components` mapping: `strong` is one of react-i18next's
                  default `transKeepBasicHtmlNodesFor` tags, so it renders the
                  tag natively from the localized string. Mapping it to an
                  element made react-i18next clone that element and forward its
                  internal `i18nIsDynamicList` bookkeeping prop onto the DOM
                  node, which React rejects as an unknown property. */}
              <Trans i18nKey={`downloadBanner.${effectiveOS}Body`} />
            </p>
            <p className="mt-3 text-sm break-words text-muted-foreground">
              {t("downloadBanner.needHelp")}{" "}
              <a
                href={contactMailto()}
                className="font-medium text-foreground underline-offset-4 hover:underline"
                data-testid="download-banner-help"
              >
                {CONTACT_EMAIL}
              </a>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
