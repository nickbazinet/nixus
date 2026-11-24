import { Download, Target, TrendingUp, Wallet } from "lucide-react";
import { useEffect, useRef, type CSSProperties } from "react";

import {
  Bullets,
  ButtonLink,
  GradientText,
  IconChip,
  Kicker,
  NumberBadge,
  Section,
  TextLink,
  cardClass,
} from "@/components/ui";
import { HomeHeroVisual, MinusGlyph, PlusGlyph } from "@/components/visuals";
import { copyFor } from "@/content/index";
import { plansFor } from "@/content/pricing";
import { cn } from "@/lib/cn";
import type { Locale } from "@/lib/locale";
import { usePlanPrices } from "@/lib/planPrices";
import { pagePath } from "@/lib/routes";

const HIGHLIGHT_ICONS = [Target, Wallet, TrendingUp];

export function HomePage({ locale }: { locale: Locale }) {
  return (
    <>
      <Hero locale={locale} />
      <MinusTheAdmin locale={locale} />
      <FeaturesTeaser locale={locale} />
      <HowItWorks locale={locale} />
      <MissionBand locale={locale} />
      <PricingTeaser locale={locale} />
      <FoundingTeaser locale={locale} />
      <Closing locale={locale} />
    </>
  );
}

function Hero({ locale }: { locale: Locale }) {
  const copy = copyFor(locale).home.hero;
  return (
    <section className="overflow-hidden bg-page">
      <div className="nx-container grid items-center gap-14 pb-20 pt-12 sm:pt-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] lg:pb-24 lg:pt-20">
        <div>
          <Kicker>{copy.kicker}</Kicker>
          <h1 className="mt-6 text-display-xl font-semibold">
            {copy.heading.lead}
            <GradientText>{copy.heading.accent}</GradientText>
            {copy.heading.tail}
          </h1>
          <p className="mt-6 max-w-xl text-lead text-ink-soft">{copy.lead}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonLink to={pagePath("download", locale)}>
              <Download className="size-4" aria-hidden="true" />
              {copy.ctaDownload}
            </ButtonLink>
            <ButtonLink to={pagePath("features", locale)} variant="outline">
              {copy.ctaFeatures}
            </ButtonLink>
          </div>
          <p className="mt-5 text-sm text-ink-muted">{copy.platforms}</p>
          {/* The hero promises a statement drop-in, and AI statement reading is
              an Advance capability, so the trial is named here rather than left
              for the pricing page to explain. Secondary by design: the free
              download stays the primary action. */}
          <p className="mt-2 text-sm text-ink-muted">
            {copy.trialLead}{" "}
            <TextLink to={pagePath("pricing", locale)} className="text-sm">
              {copy.trialLink}
            </TextLink>
            .
          </p>
        </div>
        <HomeHeroVisual locale={locale} />
      </div>
    </section>
  );
}

/** Items slide in one after another the first time the list scrolls into view. */
function SubtractedList({ items }: { items: readonly string[] }) {
  const ref = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const list = ref.current;
    if (!list) return;
    if (
      !("IntersectionObserver" in window) ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }
    // Armed only on the client, so the prerendered HTML stays fully visible.
    list.dataset.anim = "armed";
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        list.dataset.anim = "in";
        observer.disconnect();
      },
      { threshold: 0.35 },
    );
    observer.observe(list);
    return () => observer.disconnect();
  }, []);

  return (
    <ul
      ref={ref}
      className="nx-stagger col-start-2 mt-5 space-y-1.5 font-display text-xl text-ink-soft sm:text-2xl"
    >
      {items.map((item, index) => (
        <li key={item} style={{ "--i": index } as CSSProperties}>
          {item}
        </li>
      ))}
    </ul>
  );
}

function MinusTheAdmin({ locale }: { locale: Locale }) {
  const copy = copyFor(locale).home.minus;
  return (
    <Section bg="white">
      <div className="grid gap-14 lg:grid-cols-2 lg:gap-10">
        {/* Two-column grid so every list item starts under the heading's second word. */}
        <div className="grid grid-cols-[auto_minmax(0,1fr)] content-start">
          <h2 className="contents text-display-m font-semibold">
            <span className="pr-[0.28em]">{copy.heading.first}</span>
            <span>
              {copy.heading.rest}
              <GradientText>{copy.heading.accent}</GradientText>
            </span>
          </h2>
          <SubtractedList items={copy.subtracted} />
        </div>
        <div className="lg:pt-6">
          <div className="flex items-center gap-4">
            <MinusGlyph />
            <PlusGlyph />
          </div>
          <h2 className="mt-6 text-display-s font-semibold">{copy.pitchHeading}</h2>
          <p className="mt-5 max-w-lg text-ink-soft">{copy.pitchBody}</p>
          <TextLink to={pagePath("mission", locale)} className="mt-6 inline-block">
            {copy.missionLink}
          </TextLink>
        </div>
      </div>
    </Section>
  );
}

function FeaturesTeaser({ locale }: { locale: Locale }) {
  const copy = copyFor(locale).home.features;
  const visuals = copyFor(locale).visuals;
  return (
    <Section bg="page" labelledBy="home-features">
      <Kicker>{copy.kicker}</Kicker>
      <h2 id="home-features" className="mt-5 text-display-m font-semibold">
        {copy.heading}
      </h2>
      <p className="mt-5 max-w-2xl text-ink-soft">{copy.body}</p>
      <p className="mt-3 max-w-2xl text-[0.95rem] text-ink-muted">{copy.trialNote}</p>

      <div className="mt-12 rounded-3xl border border-line bg-white p-3 shadow-[0_24px_50px_-34px_rgba(20,40,80,0.4)] sm:p-5">
        <video
          className="aspect-[1546/1080] w-full rounded-2xl bg-glass object-cover"
          src="/product/tour-v1.mp4"
          poster="/product/tour-v1-poster.webp"
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          aria-label={visuals.tourVideoLabel}
        />
      </div>

      <div className="mt-8 grid gap-5 md:grid-cols-3">
        {copy.highlights.map((item, index) => (
          <div key={item.title} className={cn(cardClass(), "p-6")}>
            <IconChip icon={HIGHLIGHT_ICONS[index] ?? Target} />
            <h3 className="mt-5 text-lg font-semibold">{item.title}</h3>
            <p className="mt-2 text-[0.95rem] text-ink-muted">{item.body}</p>
          </div>
        ))}
      </div>

      <TextLink to={pagePath("features", locale)} className="mt-10 inline-block">
        {copy.link}
      </TextLink>
    </Section>
  );
}

function HowItWorks({ locale }: { locale: Locale }) {
  const copy = copyFor(locale).home.how;
  return (
    <Section bg="white" labelledBy="home-how">
      <Kicker>{copy.kicker}</Kicker>
      <h2 id="home-how" className="mt-5 text-display-m font-semibold">
        {copy.heading}
      </h2>
      <ol className="mt-12 grid gap-5 md:grid-cols-3">
        {copy.steps.map((step, index) => (
          <li key={step.title} className={cn(cardClass(true), "p-6")}>
            <NumberBadge n={index + 1} />
            <h3 className="mt-5 text-lg font-semibold">{step.title}</h3>
            <p className="mt-2 text-[0.95rem] text-ink-muted">{step.body}</p>
          </li>
        ))}
      </ol>
    </Section>
  );
}

function MissionBand({ locale }: { locale: Locale }) {
  const copy = copyFor(locale).home.mission;
  return (
    <Section bg="night" labelledBy="home-mission">
      <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-16">
        <div>
          <Kicker tone="dark">{copy.kicker}</Kicker>
          <h2 id="home-mission" className="mt-5 text-display-m font-semibold">
            {copy.heading}
          </h2>
        </div>
        <div>
          <p className="text-lead text-white/80">{copy.body}</p>
          <ButtonLink to={pagePath("mission", locale)} variant="light" className="mt-6">
            {copy.cta}
          </ButtonLink>
        </div>
      </div>
    </Section>
  );
}

function PricingTeaser({ locale }: { locale: Locale }) {
  const copy = copyFor(locale).home.pricing;
  const plans = plansFor(locale);
  const prices = usePlanPrices(plans, locale);
  return (
    <Section bg="page" labelledBy="home-pricing">
      <Kicker>{copy.kicker}</Kicker>
      <h2 id="home-pricing" className="mt-5 text-display-m font-semibold">
        {copy.headingLines.map((line) => (
          <span key={line} className="block">
            {line}
          </span>
        ))}
      </h2>
      <div className="mt-12 grid gap-5 md:grid-cols-3">
        {plans.map((plan, index) => (
          <div
            key={plan.id}
            className={cn(
              "rounded-2xl border bg-white p-6",
              plan.highlighted
                ? "border-violet shadow-[0_20px_40px_-28px_rgba(120,80,210,0.7)] ring-1 ring-violet"
                : "border-line",
            )}
          >
            <h3 className="text-lg font-semibold">{plan.name}</h3>
            <p className="mt-3 font-display text-3xl font-semibold">
              {prices[index].amount}
              {prices[index].interval ? (
                <span className="ml-1 font-sans text-sm font-normal text-ink-muted">
                  {prices[index].interval}
                </span>
              ) : null}
            </p>
            <p className="mt-3 text-[0.95rem] text-ink-muted">{plan.teaser}</p>
            {plan.trial ? (
              <p className="mt-3 text-[0.95rem] font-bold text-brand">
                {plan.trial.badge}
                {copy.trialThen}
              </p>
            ) : null}
          </div>
        ))}
      </div>
      <TextLink to={pagePath("pricing", locale)} hash="compare" className="mt-10 inline-block">
        {copy.compareLink}
      </TextLink>
    </Section>
  );
}

function FoundingTeaser({ locale }: { locale: Locale }) {
  const copy = copyFor(locale).home.founding;
  return (
    <Section bg="white">
      <div className="grid items-center gap-8 rounded-3xl bg-glass p-8 sm:p-12 lg:grid-cols-[minmax(0,1.4fr)_auto] lg:gap-14">
        <div>
          <Kicker>{copy.kicker}</Kicker>
          <h2 className="mt-5 text-display-s font-semibold">{copy.heading}</h2>
          <p className="mt-4 max-w-xl text-ink-soft">{copy.body}</p>
        </div>
        <ButtonLink
          to={pagePath("foundingUsers", locale)}
          variant="dark"
          className="justify-self-start"
        >
          {copy.cta}
        </ButtonLink>
      </div>
    </Section>
  );
}

function Closing({ locale }: { locale: Locale }) {
  const copy = copyFor(locale).home.closing;
  return (
    <Section bg="night" containerClassName="flex flex-col items-center text-center">
      <Kicker tone="dark">{copy.kicker}</Kicker>
      <h2 className="mt-6 max-w-3xl text-display-l font-semibold">
        {copy.heading.lead}
        <GradientText>{copy.heading.accent}</GradientText>
        {copy.heading.tail}
      </h2>
      <div className="mt-12 grid w-full max-w-3xl gap-5 text-left md:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6">
          <div className="flex items-center gap-3">
            <MinusGlyph className="h-2 w-7" />
            <h3 className="text-lg font-semibold">{copy.subtractTitle}</h3>
          </div>
          <Bullets tone="dark" className="mt-5 text-[0.95rem]" items={copy.subtractItems} />
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6">
          <div className="flex items-center gap-3">
            <PlusGlyph className="size-7" />
            <h3 className="text-lg font-semibold">{copy.addTitle}</h3>
          </div>
          <Bullets tone="dark" className="mt-5 text-[0.95rem]" items={copy.addItems} />
        </div>
      </div>
      <p className="mt-10 text-white/80">{copy.footnote}</p>
      <p className="mt-2 text-sm text-white/60">{copy.trialFootnote}</p>
      <ButtonLink to={pagePath("download", locale)} className="mt-6">
        {copy.cta}
      </ButtonLink>
    </Section>
  );
}
