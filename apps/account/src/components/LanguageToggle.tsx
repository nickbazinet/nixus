import { Globe } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useLocation } from "@tanstack/react-router";

import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@nixus/shared";

import { localeFromPath, type Locale } from "@/lib/i18n";

/**
 * EN / FR, recreated verbatim from `apps/web/src/components/LanguageToggle.tsx`.
 *
 * The alternate href is computed from the CURRENT path rather than from a fixed
 * pair, so `/profile` swaps to `/fr/profile` and back without the component
 * knowing which routes exist. Real `<a href>` navigation, because the URL is
 * the only locale authority in both apps.
 */

function stripFrPrefix(pathname: string): string {
  if (pathname === "/fr" || pathname === "/fr/") return "/";
  if (pathname.startsWith("/fr/")) return pathname.slice(3);
  return pathname;
}

function localizePath(pathname: string, target: Locale): string {
  const base = stripFrPrefix(pathname);
  if (target === "en") return base;
  if (base === "/") return "/fr/";
  return `/fr${base}`;
}

export function LanguageToggle() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const current = localeFromPath(pathname);

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
            className="mkt-tap"
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
          return (
            <DropdownMenuItem
              key={opt.value}
              render={
                <a
                  href={href}
                  hrefLang={opt.value}
                  data-testid={`language-toggle-option-${opt.value}`}
                  data-active={isActive ? "true" : undefined}
                  className={cn(
                    "mkt-tap flex items-center px-2",
                    isActive && "font-medium",
                  )}
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
