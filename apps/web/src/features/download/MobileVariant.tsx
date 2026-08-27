import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@nixus/shared";

import { SITE } from "@/lib/meta";

import { CTAContainer } from "./ctaShell";

/**
 * Mobile variant: the visitor is on a phone or tablet, so a desktop binary
 * download is meaningless. Deliver the pitch ("come back from a Mac or PC")
 * and give them a frictionless way to do exactly that — Copy link or
 * Email-yourself-a-link.
 *
 * This is the single full conversion affordance on a phone page, and per
 * DESIGN.md it renders in page content only — never in sticky chrome.
 */
export function MobileVariant({ className }: { className?: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  // Read at render rather than memoizing — cheap, and it means tests that
  // tweak `window.location` between renders see the updated value. Falls back
  // to the production domain during the prerender pass.
  const pageURL =
    typeof window !== "undefined" ? window.location.href : SITE.url;

  const mailtoHref = `mailto:?subject=${encodeURIComponent(
    t("download.emailSubject"),
  )}&body=${encodeURIComponent(SITE.url)}`;

  const handleCopy = async () => {
    try {
      // `navigator.clipboard` is undefined in older browsers and in some test
      // environments; the guard plus catch mean a rejection (unfocused
      // document, denied permission) never escapes the handler — the visitor
      // just gets no confirmation and falls back to the email button.
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(pageURL);
        setCopied(true);
        if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
        copyTimerRef.current = setTimeout(() => setCopied(false), 1500);
      }
    } catch {
      // Intentionally silent — see the guard comment above.
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
        className="mt-2 flex w-full flex-col gap-2 text-sm text-muted-foreground"
        data-testid="download-cta-mobile-affordance"
      >
        <div>{t("download.sendToComputer")}</div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-center">
          <Button
            variant="outline"
            size="sm"
            className="mkt-tap-cta"
            onClick={handleCopy}
            data-testid="download-cta-mobile-copy"
          >
            {copied ? t("download.copied") : t("download.copyLink")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="mkt-tap-cta"
            nativeButton={false}
            render={
              <a href={mailtoHref} data-testid="download-cta-mobile-email">
                {t("download.emailMeLink")}
              </a>
            }
          />
        </div>
      </div>
    </CTAContainer>
  );
}
