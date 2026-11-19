import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@nixus/shared";

import type { BillingView } from "@/actions/billing";
import type { AccountView } from "@/actions/gate";
import type { Locale } from "@/lib/i18n";
import { ACCOUNT_SECTIONS, sectionFromHash, type AccountSectionId } from "./AccountSection";
import { BillingPanel } from "./BillingPanel";
import { ProfilePanel } from "./ProfilePanel";
import { SignInSection } from "./SignInSection";

const NAV_LABEL_KEYS: Record<AccountSectionId, string> = {
  personal: "account.personal.title",
  subscription: "account.subscription.title",
  payment: "account.payment.title",
  invoices: "account.invoices.title",
  signin: "account.signin.title",
};

/**
 * The account page: a heading, a section menu on the left (a scrolling row of
 * pills on a phone), and one card at a time on the right.
 *
 * The menu items are plain `#hash` links, so the back button walks through the
 * sections and a link can name one. `/profile` opens on Personal information and
 * `/billing` on Subscription; a hash overrides either once the page is live.
 */
export function AccountPage({
  account,
  billing,
  locale,
  initialSection,
  planParam,
}: {
  readonly account: AccountView;
  readonly billing: BillingView;
  readonly locale: Locale;
  readonly initialSection: AccountSectionId;
  readonly planParam: string | null;
}) {
  const { t } = useTranslation();
  const [section, setSection] = useState<AccountSectionId>(initialSection);

  useEffect(() => {
    const sync = () => setSection(sectionFromHash(window.location.hash) ?? initialSection);
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [initialSection]);

  return (
    <main
      id="main"
      tabIndex={-1}
      className="mkt-page-x account-container pt-6 pb-4 outline-none md:pt-10"
    >
      <header className="max-w-3xl">
        <p className="flex items-center gap-2 text-micro font-bold tracking-[0.08em] text-brand-ink uppercase">
          <span aria-hidden="true" className="h-1.5 w-5 rounded-full bg-logo-gradient" />
          {t("account.eyebrow")}
        </p>
        <h1 className="mt-2.5 font-display text-[2rem] leading-[1.1] font-bold tracking-[-0.03em] text-ink sm:text-[2.5rem]">
          {t("account.headingLead")}{" "}
          <span className="bg-gradient-to-r from-[#DE50A4] via-[#B062D6] to-[#7E72EE] bg-clip-text text-transparent">
            {t("account.headingAccent")}
          </span>
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-ink-dim">{t("account.lead")}</p>
      </header>

      <div className="mt-8 grid gap-6 lg:mt-10 lg:grid-cols-[12rem_minmax(0,1fr)] lg:gap-8">
        <nav aria-label={t("account.navAria")} className="min-w-0 lg:sticky lg:top-24 lg:self-start">
          <ul
            role="list"
            className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0 lg:pb-0"
          >
            {ACCOUNT_SECTIONS.map((id) => {
              const current = id === section;
              return (
                <li key={id} className="shrink-0">
                  <a
                    href={`#${id}`}
                    data-testid={`account-nav-${id}`}
                    aria-current={current ? "page" : undefined}
                    className={cn(
                      "mkt-tap flex min-h-target-min items-center rounded-full px-3.5 py-2 text-sm whitespace-nowrap outline-none focus-visible:ring-3 focus-visible:ring-ring/50 lg:rounded-xl lg:px-3 lg:py-2.5",
                      current
                        ? "bg-brand-soft font-semibold text-brand-ink"
                        : "font-medium text-ink hover:bg-hover",
                    )}
                  >
                    {t(NAV_LABEL_KEYS[id])}
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="min-w-0">
          <ProfilePanel view={account} locale={locale} active={section === "personal"} />
          <BillingPanel
            view={billing}
            locale={locale}
            planParam={planParam}
            section={section}
          />
          <SignInSection email={account.email} active={section === "signin"} />
        </div>
      </div>
    </main>
  );
}
