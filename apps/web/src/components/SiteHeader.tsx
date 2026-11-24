import { Link } from "@tanstack/react-router";
import { Menu, X } from "lucide-react";
import { useState } from "react";

import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { NixusMark } from "@/components/NixusMark";
import { buttonClass } from "@/components/ui";
import { copyFor } from "@/content/index";
import { cn } from "@/lib/cn";
import { accountAppUrl } from "@/lib/links";
import type { Locale } from "@/lib/locale";
import { pagePath } from "@/lib/routes";

const navLinkClass =
  "nx-focus rounded-full px-3.5 py-2 text-[0.95rem] text-ink-soft transition-colors hover:text-ink hover:bg-white";
const navLinkActiveClass = "bg-brand-soft !text-brand hover:!bg-brand-soft";

export function SiteHeader({ locale, pathname }: { locale: Locale; pathname: string }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const copy = copyFor(locale).shell.header;

  const nav = [
    { to: pagePath("features", locale), label: copy.nav.features },
    { to: pagePath("pricing", locale), label: copy.nav.pricing },
    { to: pagePath("mission", locale), label: copy.nav.mission },
    { to: pagePath("privacy", locale), label: copy.nav.privacy },
    { to: pagePath("foundingUsers", locale), label: copy.nav.foundingUsers },
  ];

  return (
    <header className="sticky top-0 z-50 border-b border-transparent bg-page/85 backdrop-blur-md supports-[backdrop-filter]:bg-page/75">
      <div className="nx-container flex h-[4.5rem] items-center justify-between gap-6">
        <Link
          to={pagePath("home", locale)}
          className="nx-focus flex items-center gap-2.5 rounded-md"
          aria-label={copy.homeAria}
        >
          <NixusMark />
          <span className="font-display text-[1.375rem] font-bold tracking-tight text-ink">
            Nixus
          </span>
        </Link>

        <nav aria-label={copy.navAria} className="hidden items-center gap-1 lg:flex">
          {nav.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={navLinkClass}
              activeProps={{ className: navLinkActiveClass, "aria-current": "page" }}
            >
              {item.label}
            </Link>
          ))}
          <LanguageSwitcher locale={locale} pathname={pathname} className="ml-3" />
          <a href={accountAppUrl(locale)} className={cn(navLinkClass, "ml-1")}>
            {copy.logIn}
          </a>
          <Link to={pagePath("download", locale)} className={cn(buttonClass("primary"), "ml-1")}>
            {copy.getStarted}
          </Link>
        </nav>

        <div className="flex items-center gap-2 lg:hidden">
          <LanguageSwitcher locale={locale} pathname={pathname} />
          <button
            type="button"
            className="nx-focus grid size-11 place-items-center rounded-full text-ink hover:bg-white"
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label={open ? copy.closeMenu : copy.openMenu}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X className="size-6" /> : <Menu className="size-6" />}
          </button>
        </div>
      </div>

      {open ? (
        <nav
          id="mobile-nav"
          aria-label={copy.navAria}
          onClick={(event) => {
            if ((event.target as HTMLElement).closest("a")) close();
          }}
          className="border-t border-line bg-page px-5 pb-6 pt-3 shadow-[0_20px_30px_-20px_rgba(20,20,43,0.25)] lg:hidden"
        >
          <ul className="flex flex-col">
            {nav.map((item) => (
              <li key={item.to}>
                <Link
                  to={item.to}
                  className="nx-focus flex min-h-12 items-center rounded-xl px-3 text-lg text-ink-soft"
                  activeProps={{ className: "bg-brand-soft !text-brand", "aria-current": "page" }}
                >
                  {item.label}
                </Link>
              </li>
            ))}
            <li>
              <a
                href={accountAppUrl(locale)}
                className="nx-focus flex min-h-12 items-center rounded-xl px-3 text-lg text-ink-soft"
              >
                {copy.logIn}
              </a>
            </li>
          </ul>
          <Link
            to={pagePath("download", locale)}
            className={cn(buttonClass("primary", "lg"), "mt-4 w-full")}
          >
            {copy.getStarted}
          </Link>
        </nav>
      ) : null}
    </header>
  );
}
