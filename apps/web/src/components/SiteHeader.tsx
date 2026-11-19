import { Link } from "@tanstack/react-router";
import { Menu, X } from "lucide-react";
import { useState } from "react";

import { NixusMark } from "@/components/NixusMark";
import { buttonClass, type InternalPath } from "@/components/ui";
import { cn } from "@/lib/cn";
import { ACCOUNT_APP_URL } from "@/lib/links";

const NAV: ReadonlyArray<{ to: InternalPath; label: string }> = [
  { to: "/features", label: "Features" },
  { to: "/pricing", label: "Pricing" },
  { to: "/mission", label: "Our mission" },
  { to: "/privacy", label: "Privacy" },
  { to: "/founding-users", label: "Founding Users" },
];

const navLinkClass =
  "nx-focus rounded-full px-3.5 py-2 text-[0.95rem] text-ink-soft transition-colors hover:text-ink hover:bg-white";
const navLinkActiveClass = "bg-brand-soft !text-brand hover:!bg-brand-soft";

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <header className="sticky top-0 z-50 border-b border-transparent bg-page/85 backdrop-blur-md supports-[backdrop-filter]:bg-page/75">
      <div className="nx-container flex h-[4.5rem] items-center justify-between gap-6">
        <Link
          to="/"
          className="nx-focus flex items-center gap-2.5 rounded-md"
          aria-label="Nixus home"
        >
          <NixusMark />
          <span className="font-display text-[1.375rem] font-bold tracking-tight text-ink">
            Nixus
          </span>
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-1 lg:flex">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={navLinkClass}
              activeProps={{ className: navLinkActiveClass, "aria-current": "page" }}
            >
              {item.label}
            </Link>
          ))}
          <a href={ACCOUNT_APP_URL} className={cn(navLinkClass, "ml-4")}>
            Log in
          </a>
          <Link to="/download" className={cn(buttonClass("primary"), "ml-1")}>
            Get started
          </Link>
        </nav>

        <button
          type="button"
          className="nx-focus grid size-11 place-items-center rounded-full text-ink hover:bg-white lg:hidden"
          aria-expanded={open}
          aria-controls="mobile-nav"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X className="size-6" /> : <Menu className="size-6" />}
        </button>
      </div>

      {open ? (
        <nav
          id="mobile-nav"
          aria-label="Main"
          onClick={(event) => {
            if ((event.target as HTMLElement).closest("a")) close();
          }}
          className="border-t border-line bg-page px-5 pb-6 pt-3 shadow-[0_20px_30px_-20px_rgba(20,20,43,0.25)] lg:hidden"
        >
          <ul className="flex flex-col">
            {NAV.map((item) => (
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
                href={ACCOUNT_APP_URL}
                className="nx-focus flex min-h-12 items-center rounded-xl px-3 text-lg text-ink-soft"
              >
                Log in
              </a>
            </li>
          </ul>
          <Link to="/download" className={cn(buttonClass("primary", "lg"), "mt-4 w-full")}>
            Get started
          </Link>
        </nav>
      ) : null}
    </header>
  );
}
