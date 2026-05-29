import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@nixus/shared";

type ThemeOption = "light" | "dark" | "system";

const ICONS: Record<ThemeOption, typeof Sun> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
};

export function ThemeToggle() {
  const { t } = useTranslation();
  const { theme, setTheme, resolvedTheme } = useTheme();

  // next-themes returns `undefined` for `theme` until it has read
  // localStorage on the client. Render a Sun icon as a stable placeholder
  // so the prerendered HTML and the first client paint match.
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- standard mounted pattern to prevent SSR/hydration flash with next-themes
  useEffect(() => setMounted(true), []);

  const current: ThemeOption = (theme as ThemeOption) ?? "system";
  const TriggerIcon =
    !mounted
      ? Sun
      : current === "system"
        ? ICONS.system
        : (resolvedTheme as ThemeOption) === "dark"
          ? ICONS.dark
          : ICONS.light;

  const options: { value: ThemeOption; labelKey: string }[] = [
    { value: "light", labelKey: "header.themeLight" },
    { value: "dark", labelKey: "header.themeDark" },
    { value: "system", labelKey: "header.themeSystem" },
  ];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("header.themeToggle")}
            data-testid="theme-toggle"
          >
            <TriggerIcon className="size-4" aria-hidden="true" />
          </Button>
        }
      />
      <DropdownMenuContent align="end">
        {options.map((opt) => {
          const Icon = ICONS[opt.value];
          const isActive = current === opt.value;
          return (
            <DropdownMenuItem
              key={opt.value}
              onClick={() => setTheme(opt.value)}
              data-testid={`theme-toggle-option-${opt.value}`}
              data-active={isActive ? "true" : undefined}
              className={isActive ? "font-medium" : undefined}
            >
              <Icon className="size-4" aria-hidden="true" />
              {t(opt.labelKey)}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
