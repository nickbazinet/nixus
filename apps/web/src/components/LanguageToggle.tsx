import { Globe } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useLocation } from "@tanstack/react-router";

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@nkbaz/shared";

type Locale = "en" | "fr";

// Strip the leading `/fr` (with or without trailing slash) so we can
// recompute the alt-locale path. Returns the path *without* a leading
// `/fr` prefix; the caller adds the desired locale prefix back on.
function stripFrPrefix(pathname: string): string {
  if (pathname === "/fr" || pathname === "/fr/") return "/";
  if (pathname.startsWith("/fr/")) return pathname.slice(3);
  return pathname;
}

function localizePath(pathname: string, target: Locale): string {
  const base = stripFrPrefix(pathname);
  if (target === "en") return base;
  // EN base "/" -> FR "/fr/". Anything else gets prefixed verbatim.
  if (base === "/") return "/fr/";
  return `/fr${base}`;
}

export function LanguageToggle() {
  const { t, i18n } = useTranslation();
  const { pathname } = useLocation();
  const current: Locale = i18n.language?.startsWith("fr") ? "fr" : "en";

  const options: { value: Locale; labelKey: string }[] = [
    { value: "en", labelKey: "header.languageEnglish" },
    { value: "fr", labelKey: "header.languageFrench" },
  ];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("header.languageToggle")}
            data-testid="language-toggle"
          >
            <Globe className="size-4" aria-hidden="true" />
          </Button>
        }
      />
      <DropdownMenuContent align="end">
        {options.map((opt) => {
          const href = localizePath(pathname, opt.value);
          const isActive = current === opt.value;
          // Real <a href> navigation so the URL is the source of truth and
          // crawlers see the locale-correct prerendered HTML at the new URL.
          return (
            <DropdownMenuItem
              key={opt.value}
              render={
                <a
                  href={href}
                  hrefLang={opt.value}
                  data-testid={`language-toggle-option-${opt.value}`}
                  data-active={isActive ? "true" : undefined}
                  className={isActive ? "font-medium" : undefined}
                >
                  {t(opt.labelKey)}
                </a>
              }
            />
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
