import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import type { InternalPath } from "@/components/ui";
import { FACEBOOK_URL, GITHUB_URL, INSTAGRAM_URL } from "@/lib/links";

type FooterLink = { label: string } & ({ to: InternalPath } | { href: string });

const COLUMNS: ReadonlyArray<{ heading: string; links: readonly FooterLink[] }> = [
  {
    heading: "Product",
    links: [
      { label: "Features", to: "/features" },
      { label: "Pricing", to: "/pricing" },
      { label: "Download", to: "/download" },
    ],
  },
  {
    heading: "Company",
    links: [
      { label: "Our mission", to: "/mission" },
      { label: "Founding Users", to: "/founding-users" },
      { label: "GitHub", href: GITHUB_URL },
    ],
  },
  {
    heading: "Follow",
    links: [
      { label: "Instagram", href: INSTAGRAM_URL },
      { label: "Facebook", href: FACEBOOK_URL },
    ],
  },
  {
    heading: "Legal",
    links: [
      { label: "Privacy", to: "/privacy" },
      { label: "Privacy policy", to: "/privacy-policy" },
      { label: "Terms", to: "/terms" },
    ],
  },
];

const linkClass = "nx-focus rounded-sm text-[0.95rem] text-white/70 transition-colors hover:text-white";

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

export function SiteFooter() {
  return (
    <footer className="bg-abyss text-white">
      <div className="nx-container grid gap-12 py-16 md:grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)] md:gap-8">
        <div>
          <p className="font-display text-xl font-bold">Nixus</p>
          <p className="mt-4 max-w-[17rem] text-[0.95rem] leading-relaxed text-white/70">
            Minus the admin. Personal finance for Canadians.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-10 sm:grid-cols-4 sm:gap-6">
          {COLUMNS.map((column) => (
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
