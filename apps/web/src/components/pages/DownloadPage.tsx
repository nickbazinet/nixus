import { Bullets, ButtonAnchor, GradientText, Kicker, Section, TextAnchor, TextLink } from "@/components/ui";
import { cn } from "@/lib/cn";
import { ACCOUNT_APP_URL } from "@/lib/links";
import { release } from "@/lib/release.gen";

const PLATFORMS = [
  {
    name: "macOS",
    label: "Download for macOS",
    href: release.assets.macos.url,
    variant: "primary" as const,
  },
  {
    name: "Windows",
    label: "Download for Windows",
    href: release.assets.windows.url,
    variant: "dark" as const,
  },
];

export function DownloadPage() {
  return (
    <>
      <Section bg="page" className="pt-12 sm:pt-16">
        <Kicker>Download</Kicker>
        <h1 className="mt-6 text-display-xl font-semibold">
          Get Nixus, <GradientText>minus the admin</GradientText>.
        </h1>
        <p className="mt-6 max-w-2xl text-lead text-ink-soft">
          Nixus runs on macOS and Windows. Nixus is free on your computer and needs no account.
        </p>

        <div className="mt-12 grid gap-5 md:grid-cols-2">
          {PLATFORMS.map((platform) => (
            <div key={platform.name} className="rounded-3xl border border-line bg-white p-7">
              <h2 className="text-2xl font-semibold">{platform.name}</h2>
              <ButtonAnchor
                href={platform.href}
                variant={platform.variant}
                size="lg"
                className="mt-6 w-full"
              >
                {platform.label}
              </ButtonAnchor>
            </div>
          ))}
        </div>
      </Section>

      <Section bg="white">
        <div className="grid gap-14 md:grid-cols-2 md:gap-12">
          <div>
            <Kicker>After you install</Kicker>
            <h2 className="mt-5 text-display-s font-semibold">Your first five minutes</h2>
            <Bullets
              className="mt-6"
              items={[
                "Create your free profile on your computer. No account.",
                "Drop in a credit card statement.",
                "Check the categories, then see your overview.",
              ]}
            />
          </div>
          <div>
            <Kicker>Want more?</Kicker>
            <h2 className="mt-5 text-display-s font-semibold">Household views and AI</h2>
            <p className="mt-5 text-lead text-ink-soft">
              Those come with NixusCloud, which needs an account.
            </p>
            <div className={cn("mt-6 flex flex-wrap gap-x-5 gap-y-3")}>
              <TextLink to="/pricing">See the plans</TextLink>
              <TextAnchor href={ACCOUNT_APP_URL}>Log in or create an account</TextAnchor>
            </div>
          </div>
        </div>
      </Section>
    </>
  );
}
