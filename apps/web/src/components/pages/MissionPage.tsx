import { Car, CodeXml, Sparkles, Target } from "lucide-react";

import {
  Bullets,
  ButtonLink,
  ClosingBand,
  GradientText,
  IconChip,
  Kicker,
  Section,
  cardClass,
} from "@/components/ui";
import { copyFor } from "@/content/index";
import { cn } from "@/lib/cn";
import type { Locale } from "@/lib/locale";
import { pagePath } from "@/lib/routes";

/** Icon for each goal card, in card order. */
const GOAL_ICONS = [Sparkles, Target, Car, CodeXml];

export function MissionPage({ locale }: { locale: Locale }) {
  const copy = copyFor(locale).mission;

  return (
    <>
      <Section bg="page" className="pt-12 sm:pt-16">
        <Kicker>{copy.kicker}</Kicker>
        <h1 className="mt-6 max-w-4xl text-display-xl font-semibold">
          {copy.heading.lead}
          <GradientText>{copy.heading.accent}</GradientText>
          {copy.heading.tail}
        </h1>
        <p className="mt-8 max-w-2xl text-lead text-ink-soft">{copy.lead}</p>
      </Section>

      <Section bg="white" labelledBy="goals">
        <Kicker>{copy.goals.kicker}</Kicker>
        <h2 id="goals" className="mt-5 text-display-m font-semibold">
          {copy.goals.heading}
        </h2>
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {copy.goals.items.map((goal, index) => (
            <div key={goal.title} className={cn(cardClass(true), "p-6")}>
              <IconChip icon={GOAL_ICONS[index] ?? Sparkles} />
              <h3 className="mt-5 text-lg font-semibold">{goal.title}</h3>
              <p className="mt-3 text-[0.95rem] text-ink-muted">{goal.body}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section bg="page" labelledBy="why-building">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,2fr)] lg:gap-14">
          <figure>
            <img
              src="/team/nick.jpg"
              alt={copy.founder.photoAlt}
              width={720}
              height={720}
              loading="lazy"
              className="aspect-square w-full max-w-[22rem] rounded-3xl object-cover"
            />
            <figcaption className="mt-4">
              <p className="font-bold text-ink">{copy.founder.name}</p>
              <p className="text-sm text-ink-muted">{copy.founder.role}</p>
            </figcaption>
          </figure>
          <div>
            <Kicker>{copy.founder.kicker}</Kicker>
            <h2 id="why-building" className="mt-5 text-display-m font-semibold">
              {copy.founder.heading}
            </h2>
            <div className="mt-6 space-y-5 text-ink-soft">
              {copy.founder.paragraphs.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </div>
          </div>
        </div>
      </Section>

      <Section bg="white" labelledBy="promises">
        <Kicker>{copy.promises.kicker}</Kicker>
        <h2 id="promises" className="mt-5 text-display-m font-semibold">
          {copy.promises.heading}
        </h2>
        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {copy.promises.items.map((promise) => (
            <div key={promise.title} className={cn(cardClass(true), "p-6")}>
              <h3 className="text-lg font-semibold">{promise.title}</h3>
              <p className="mt-3 text-[0.95rem] text-ink-muted">{promise.body}</p>
            </div>
          ))}
        </div>
        <div className="mt-8 grid gap-5 md:grid-cols-2">
          <div className={cn(cardClass(), "p-6")}>
            <h3 className="text-lg font-semibold text-brand">{copy.promises.worksTitle}</h3>
            <Bullets
              marker="plus"
              className="mt-4 text-[0.95rem]"
              items={copy.promises.worksItems}
            />
          </div>
          <div className={cn(cardClass(), "p-6")}>
            <h3 className="text-lg font-semibold text-amber-ink">{copy.promises.isntTitle}</h3>
            <Bullets className="mt-4 text-[0.95rem]" items={copy.promises.isntItems} />
          </div>
        </div>
      </Section>

      <ClosingBand heading={copy.closing.heading} body={copy.closing.body}>
        <ButtonLink to={pagePath("foundingUsers", locale)}>{copy.closing.cta}</ButtonLink>
      </ClosingBand>
    </>
  );
}
