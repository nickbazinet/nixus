import {
  ArrowLeftRight,
  Car,
  Hourglass,
  Landmark,
  PiggyBank,
  Shield,
  Sparkles,
  TrendingUp,
  Wrench,
} from "lucide-react";
import type { ReactNode } from "react";

import {
  Bullets,
  ButtonLink,
  ClosingBand,
  GradientText,
  IconChip,
  Kicker,
  Section,
  TextLink,
  cardClass,
} from "@/components/ui";
import {
  ImportMock,
  MinusGlyph,
  NetWorthChartMock,
  NextActionsMock,
  PlusGlyph,
  RegisteredAccountsMock,
} from "@/components/visuals";
import { copyFor } from "@/content/index";
import { cn } from "@/lib/cn";
import type { Locale } from "@/lib/locale";
import { pagePath } from "@/lib/routes";

/** Illustration for each feature row, in row order. */
function rowVisuals(locale: Locale): readonly ReactNode[] {
  return [
    <ImportMock locale={locale} />,
    <NextActionsMock />,
    <RegisteredAccountsMock locale={locale} />,
    <NetWorthChartMock />,
  ];
}

/** Icon for each toolbox card, in card order. */
const TOOLBOX_ICONS = [
  ArrowLeftRight,
  Landmark,
  PiggyBank,
  TrendingUp,
  Hourglass,
  Car,
  Sparkles,
  Wrench,
  Shield,
];

/** The privacy card is the only one that links on. */
const PRIVACY_CARD_INDEX = TOOLBOX_ICONS.length - 1;

export function FeaturesPage({ locale }: { locale: Locale }) {
  const copy = copyFor(locale).features;
  const visuals = rowVisuals(locale);

  return (
    <>
      <Section bg="page" className="pt-12 sm:pt-16">
        <Kicker>{copy.kicker}</Kicker>
        <h1 className="mt-6 text-display-xl font-semibold">
          {copy.heading.first}
          <br />
          <GradientText>{copy.heading.accent}</GradientText>
          {copy.heading.tail}
        </h1>
        <p className="mt-6 max-w-2xl text-lead text-ink-soft">{copy.lead}</p>

        <div className="mt-10 grid max-w-3xl gap-5 sm:grid-cols-2">
          <div className={cn(cardClass(), "p-6")}>
            <div className="flex items-center gap-3">
              <MinusGlyph className="h-2 w-7" />
              <h2 className="text-lg font-semibold">{copy.subtractTitle}</h2>
            </div>
            <Bullets className="mt-5 text-[0.95rem]" items={copy.subtractItems} />
          </div>
          <div className={cn(cardClass(), "p-6")}>
            <div className="flex items-center gap-3">
              <PlusGlyph className="size-7" />
              <h2 className="text-lg font-semibold">{copy.addTitle}</h2>
            </div>
            <Bullets className="mt-5 text-[0.95rem]" items={copy.addItems} />
          </div>
        </div>

        <div className="mt-10 flex flex-wrap gap-3">
          <ButtonLink to={pagePath("download", locale)}>{copy.ctaDownload}</ButtonLink>
          <ButtonLink to={pagePath("pricing", locale)} variant="outline">
            {copy.ctaPricing}
          </ButtonLink>
        </div>
      </Section>

      <Section bg="white">
        <div className="space-y-20 lg:space-y-28">
          {copy.rows.map((row, index) => (
            <div key={row.heading} className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
              <div className={cn(index % 2 === 1 && "lg:order-2")}>
                <h2 className="text-display-s font-semibold">{row.heading}</h2>
                <p className="mt-5 text-ink-soft">{row.body}</p>
                <Bullets className="mt-6 text-[0.95rem]" items={row.points} />
              </div>
              <div className={cn(index % 2 === 1 && "lg:order-1")}>{visuals[index]}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section bg="page" labelledBy="toolbox">
        <Kicker>{copy.toolbox.kicker}</Kicker>
        <h2 id="toolbox" className="mt-5 text-display-m font-semibold">
          {copy.toolbox.heading}
        </h2>
        <p className="mt-4 text-ink-soft">{copy.toolbox.body}</p>
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {copy.toolbox.items.map((item, index) => (
            <div key={item.title} className={cn(cardClass(), "p-6")}>
              <IconChip icon={TOOLBOX_ICONS[index] ?? Shield} />
              <h3 className="mt-5 text-lg font-semibold">{item.title}</h3>
              <p className="mt-2 text-[0.95rem] text-ink-muted">{item.body}</p>
              {index === PRIVACY_CARD_INDEX ? (
                <TextLink
                  to={pagePath("privacy", locale)}
                  className="mt-4 inline-block text-[0.95rem]"
                >
                  {copy.toolbox.privacyLink}
                </TextLink>
              ) : null}
            </div>
          ))}
        </div>
      </Section>

      <Section bg="white" labelledBy="why-nixus">
        <Kicker>{copy.why.kicker}</Kicker>
        <h2 id="why-nixus" className="mt-5 text-display-m font-semibold">
          {copy.why.heading}
        </h2>
        <p className="mt-4 text-ink-soft">{copy.why.lead}</p>
        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {copy.why.cards.map((card, index) => {
            // The last column is Nixus itself, so it is the one that is filled.
            const isNixus = index === copy.why.cards.length - 1;
            return (
              <div
                key={card.title}
                className={cn(
                  isNixus
                    ? "nx-gradient-card rounded-2xl p-6 text-white shadow-[0_24px_40px_-24px_rgba(90,70,200,0.8)]"
                    : cn(cardClass(true), "p-6"),
                )}
              >
                <h3 className="text-lg font-semibold">{card.title}</h3>
                <p
                  className={cn(
                    "mt-3 text-[0.95rem]",
                    isNixus ? "text-white/90" : "text-ink-muted",
                  )}
                >
                  {card.body}
                </p>
              </div>
            );
          })}
        </div>
      </Section>

      <ClosingBand heading={copy.closing.heading} body={copy.closing.body}>
        <ButtonLink to={pagePath("download", locale)}>{copy.closing.cta}</ButtonLink>
      </ClosingBand>
    </>
  );
}
