import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import type { InternalPath } from "@/components/ui";
import { copyFor } from "@/content/index";
import { FACEBOOK_URL, GITHUB_URL, INSTAGRAM_URL } from "@/lib/links";
import type { Locale } from "@/lib/locale";
import { pagePath } from "@/lib/routes";

type FooterLink = { label: string } & ({ to: InternalPath } | { href: string });

const linkClass =
  "nx-focus rounded-sm text-[0.95rem] text-white/70 transition-colors hover:text-white";

function FooterItem({ link }: { link: FooterLink }): ReactNode {
  if ("to" in link) {
    return (
      <Link to={link.to} className={linkClass}>
        {link.label}
      </Link>
    );
  }
  return (
    <a href={link.href} className={linkClass} rel="noopener noreferrer">
      {link.label}
    </a>
  );
}

export function SiteFooter({ locale, pathname }: { locale: Locale; pathname: string }) {
  const copy = copyFor(locale).shell.footer;

  const columns: ReadonlyArray<{ heading: string; links: readonly FooterLink[] }> = [
    {
      heading: copy.columns.product,
      links: [
        { label: copy.links.features, to: pagePath("features", locale) },
        { label: copy.links.pricing, to: pagePath("pricing", locale) },
        { label: copy.links.download, to: pagePath("download", locale) },
      ],
    },
    {
      heading: copy.columns.company,
      links: [
        { label: copy.links.mission, to: pagePath("mission", locale) },
        { label: copy.links.foundingUsers, to: pagePath("foundingUsers", locale) },
        { label: copy.links.github, href: GITHUB_URL },
      ],
    },
    {
      heading: copy.columns.follow,
      links: [
        { label: copy.links.instagram, href: INSTAGRAM_URL },
        { label: copy.links.facebook, href: FACEBOOK_URL },
      ],
    },
    {
      heading: copy.columns.legal,
      links: [
        { label: copy.links.privacy, to: pagePath("privacy", locale) },
        { label: copy.links.privacyPolicy, to: pagePath("privacyPolicy", locale) },
        { label: copy.links.terms, to: pagePath("terms", locale) },
      ],
    },
  ];

  return (
    <footer className="bg-abyss text-white">
      <div className="nx-container grid gap-12 py-16 md:grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)] md:gap-8">
        <div>
          <p className="font-display text-xl font-bold">Nixus</p>
          <p className="mt-4 max-w-[17rem] text-[0.95rem] leading-relaxed text-white/70">
            {copy.tagline}
          </p>
          <LanguageSwitcher locale={locale} pathname={pathname} className="mt-6 w-fit" />
        </div>
        <div className="grid grid-cols-2 gap-10 sm:grid-cols-4 sm:gap-6">
          {columns.map((column) => (
            <div key={column.heading}>
              <h2 className="font-sans text-base font-bold text-white">{column.heading}</h2>
              <ul className="mt-4 space-y-3">
                {column.links.map((link) => (
                  <li key={link.label}>
                    <FooterItem link={link} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </footer>
  );
}
