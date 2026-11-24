import {
  Bullets,
  ButtonAnchor,
  GradientText,
  Kicker,
  Section,
  TextAnchor,
  TextLink,
} from "@/components/ui";
import { copyFor } from "@/content/index";
import { advanceTrialFor } from "@/content/pricing";
import { cn } from "@/lib/cn";
import { accountAppUrl, billingPlanUrl } from "@/lib/links";
import type { Locale } from "@/lib/locale";
import { release } from "@/lib/release.gen";
import { pagePath } from "@/lib/routes";

/** Asset and button variant per platform, in the order the copy lists them. */
const PLATFORM_ASSETS = [
  { href: release.assets.macos.url, variant: "primary" as const },
  { href: release.assets.windows.url, variant: "dark" as const },
];

export function DownloadPage({ locale }: { locale: Locale }) {
  const copy = copyFor(locale).download;
  const trial = advanceTrialFor(locale);

  return (
    <>
      <Section bg="page" className="pt-12 sm:pt-16">
        <Kicker>{copy.kicker}</Kicker>
        <h1 className="mt-6 text-display-xl font-semibold">
          {copy.heading.lead}
          <GradientText>{copy.heading.accent}</GradientText>
          {copy.heading.tail}
        </h1>
        <p className="mt-6 max-w-2xl text-lead text-ink-soft">{copy.lead}</p>

        <div className="mt-12 grid gap-5 md:grid-cols-2">
          {copy.platforms.map((platform, index) => {
            const asset = PLATFORM_ASSETS[index];
            if (!asset) return null;
            return (
              <div
                key={platform.name}
                className="rounded-3xl border border-line bg-white p-7"
              >
                <h2 className="text-2xl font-semibold">{platform.name}</h2>
                <ButtonAnchor
                  href={asset.href}
                  variant={asset.variant}
                  size="lg"
                  className="mt-6 w-full"
                >
                  {platform.label}
                </ButtonAnchor>
              </div>
            );
          })}
        </div>
      </Section>

      <Section bg="white">
        <div className="grid gap-14 md:grid-cols-2 md:gap-12">
          <div>
            <Kicker>{copy.firstRun.kicker}</Kicker>
            <h2 className="mt-5 text-display-s font-semibold">{copy.firstRun.heading}</h2>
            <Bullets className="mt-6" items={copy.firstRun.items} />
          </div>
          <div>
            <Kicker>{copy.more.kicker}</Kicker>
            <h2 className="mt-5 text-display-s font-semibold">{copy.more.heading}</h2>
            <p className="mt-5 text-lead text-ink-soft">{copy.more.body}</p>
            <p className="mt-3 text-[0.95rem] text-ink-muted">{copy.more.trialNote}</p>
            <div className={cn("mt-6 flex flex-wrap gap-x-5 gap-y-3")}>
              <TextAnchor href={billingPlanUrl(locale, trial.lookupKey)}>{trial.cta}</TextAnchor>
              <TextLink to={pagePath("pricing", locale)}>{copy.more.plansLink}</TextLink>
              <TextAnchor href={accountAppUrl(locale)}>{copy.more.accountLink}</TextAnchor>
            </div>
          </div>
        </div>
      </Section>
    </>
  );
}
