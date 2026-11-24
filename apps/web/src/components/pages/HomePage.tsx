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
import { PLANS } from "@/content/pricing";
import { cn } from "@/lib/cn";
import { usePlanPrices } from "@/lib/planPrices";

const SUBTRACTED = [
  "the headache",
  "the chaos",
  "the spreadsheets",
  "the complexity",
  "the overwhelm",
  "the confusion",
  "the worries",
];

const HIGHLIGHTS = [
  {
    icon: Target,
    title: "Next actions",
    body: "A chart tells you what happened. Nixus tells you what to do now.",
  },
  {
    icon: Wallet,
    title: "TFSA, RRSP and FHSA",
    body: "Registered accounts are first-class, not an afterthought.",
  },
  {
    icon: TrendingUp,
    title: "Net worth over time",
    body: "Assets and liabilities in one history, so you see the direction.",
  },
];

const STEPS = [
  { title: "Download Nixus", body: "Install Nixus on macOS or Windows. No account needed." },
  { title: "Drop in a statement", body: "A PDF or screenshot from your credit card. Nixus sorts it." },
  { title: "See where you stand", body: "Budgets, net worth and your next actions, ready to go." },
];

export function HomePage() {
  return (
    <>
      <Hero />
      <MinusTheAdmin />
      <FeaturesTeaser />
      <HowItWorks />
      <MissionBand />
      <PricingTeaser />
      <FoundingTeaser />
      <Closing />
    </>
  );
}

function Hero() {
  return (
    <section className="overflow-hidden bg-page">
      <div className="nx-container grid items-center gap-14 pb-20 pt-12 sm:pt-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] lg:pb-24 lg:pt-20">
        <div>
          <Kicker>Personal finance for Canadians</Kicker>
          <h1 className="mt-6 text-display-xl font-semibold">
            Minus the <GradientText>admin</GradientText>.
          </h1>
          <p className="mt-6 max-w-xl text-lead text-ink-soft">
            Nixus subtracts the spreadsheets, the chaos and the stress. You get a clear picture of
            where you stand and what to do next. Drop in a credit card statement to start.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonLink to="/download">
              <Download className="size-4" aria-hidden="true" />
              Download Nixus
            </ButtonLink>
            <ButtonLink to="/features" variant="outline">
              See the features
            </ButtonLink>
          </div>
          <p className="mt-5 text-sm text-ink-muted">
            macOS and Windows. Free on your computer, no account needed. No bank logins.
          </p>
          {/* The hero promises a statement drop-in, and AI statement reading is
              an Advance capability, so the trial is named here rather than left
              for the pricing page to explain. Secondary by design: the free
              download stays the primary action. */}
          <p className="mt-2 text-sm text-ink-muted">
            AI statement reading comes with NixusCloud Advance.{" "}
            <TextLink to="/pricing" className="text-sm">
              Try it free for 7 days
            </TextLink>
            .
          </p>
        </div>
        <HomeHeroVisual />
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

function MinusTheAdmin() {
  return (
    <Section bg="white">
      <div className="grid gap-14 lg:grid-cols-2 lg:gap-10">
        {/* Two-column grid so every "the" starts under the heading's "the". */}
        <div className="grid grid-cols-[auto_minmax(0,1fr)] content-start">
          <h2 className="contents text-display-m font-semibold">
            <span className="pr-[0.28em]">Minus</span>
            <span>
              the <GradientText>admin</GradientText>
            </span>
          </h2>
          <SubtractedList items={SUBTRACTED} />
        </div>
        <div className="lg:pt-6">
          <div className="flex items-center gap-4">
            <MinusGlyph />
            <PlusGlyph />
          </div>
          <h2 className="mt-6 text-display-s font-semibold">
            We subtract the busywork. You add the decisions.
          </h2>
          <p className="mt-5 max-w-lg text-ink-soft">
            Nixus sorts your transactions, tracks your budgets and keeps your net worth up to date.
            You spend your time on the choices that actually move your money.
          </p>
          <TextLink to="/mission" className="mt-6 inline-block">
            Read our mission
          </TextLink>
        </div>
      </div>
    </Section>
  );
}

function FeaturesTeaser() {
  return (
    <Section bg="page" labelledBy="home-features">
      <Kicker>Features</Kicker>
      <h2 id="home-features" className="mt-5 text-display-m font-semibold">
        From statement to sorted in seconds
      </h2>
      <p className="mt-5 max-w-2xl text-ink-soft">
        Drop in a credit card statement as a PDF or a screenshot. Nixus reads every transaction and
        puts it in a category.
      </p>
      <p className="mt-3 max-w-2xl text-[0.95rem] text-ink-muted">
        Reading statements with AI is part of NixusCloud Advance, which starts with 7 days free. A
        card is required and you can cancel before the trial ends.
      </p>

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
          aria-label="Nixus importing a statement and sorting it into categories"
        />
      </div>

      <div className="mt-8 grid gap-5 md:grid-cols-3">
        {HIGHLIGHTS.map((item) => (
          <div key={item.title} className={cn(cardClass(), "p-6")}>
            <IconChip icon={item.icon} />
            <h3 className="mt-5 text-lg font-semibold">{item.title}</h3>
            <p className="mt-2 text-[0.95rem] text-ink-muted">{item.body}</p>
          </div>
        ))}
      </div>

      <TextLink to="/features" className="mt-10 inline-block">
        Explore every feature
      </TextLink>
    </Section>
  );
}

function HowItWorks() {
  return (
    <Section bg="white" labelledBy="home-how">
      <Kicker>How it works</Kicker>
      <h2 id="home-how" className="mt-5 text-display-m font-semibold">
        Up and running in three steps
      </h2>
      <ol className="mt-12 grid gap-5 md:grid-cols-3">
        {STEPS.map((step, index) => (
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

function MissionBand() {
  return (
    <Section bg="night" labelledBy="home-mission">
      <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-16">
        <div>
          <Kicker tone="dark">Our mission</Kicker>
          <h2 id="home-mission" className="mt-5 text-display-m font-semibold">
            Improve the financial stability of the average Canadian.
          </h2>
        </div>
        <div>
          <p className="text-lead text-white/80">
            Knowledge and guidance for everyday people, with the routine decisions automated. Built
            by one person who wanted this to exist.
          </p>
          <ButtonLink to="/mission" variant="light" className="mt-6">
            Read the story
          </ButtonLink>
        </div>
      </div>
    </Section>
  );
}

function PricingTeaser() {
  const prices = usePlanPrices(PLANS);
  return (
    <Section bg="page" labelledBy="home-pricing">
      <Kicker>Pricing</Kicker>
      <h2 id="home-pricing" className="mt-5 text-display-m font-semibold">
        Free on your computer.
        <br />
        Cloud when you want it.
      </h2>
      <div className="mt-12 grid gap-5 md:grid-cols-3">
        {PLANS.map((plan, index) => (
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
                {plan.trial.badge}, then the monthly price.
              </p>
            ) : null}
          </div>
        ))}
      </div>
      <TextLink to="/pricing" hash="compare" className="mt-10 inline-block">
        Compare the plans
      </TextLink>
    </Section>
  );
}

function FoundingTeaser() {
  return (
    <Section bg="white">
      <div className="grid items-center gap-8 rounded-3xl bg-glass p-8 sm:p-12 lg:grid-cols-[minmax(0,1.4fr)_auto] lg:gap-14">
        <div>
          <Kicker>Founding Users</Kicker>
          <h2 className="mt-5 text-display-s font-semibold">
            Help build Nixus. Get it first, and pay less, forever.
          </h2>
          <p className="mt-4 max-w-xl text-ink-soft">
            Early access to the platform at a discounted price for good, in exchange for honest
            feedback and regular conversations with me.
          </p>
        </div>
        <ButtonLink to="/founding-users" variant="dark" className="justify-self-start">
          Become a Founding User
        </ButtonLink>
      </div>
    </Section>
  );
}

function Closing() {
  return (
    <Section bg="night" containerClassName="flex flex-col items-center text-center">
      <Kicker tone="dark">We subtract. You add.</Kicker>
      <h2 className="mt-6 max-w-3xl text-display-l font-semibold">
        Stop running a spreadsheet. <GradientText>Start running your money.</GradientText>
      </h2>
      <div className="mt-12 grid w-full max-w-3xl gap-5 text-left md:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6">
          <div className="flex items-center gap-3">
            <MinusGlyph className="h-2 w-7" />
            <h3 className="text-lg font-semibold">We subtract</h3>
          </div>
          <Bullets
            tone="dark"
            className="mt-5 text-[0.95rem]"
            items={[
              "The spreadsheet you rebuild every month",
              "Sorting every transaction by hand",
              "Guessing what to do with what is left",
            ]}
          />
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6">
          <div className="flex items-center gap-3">
            <PlusGlyph className="size-7" />
            <h3 className="text-lg font-semibold">You add</h3>
          </div>
          <Bullets
            tone="dark"
            className="mt-5 text-[0.95rem]"
            items={[
              "A clear view of where you stand",
              "A next step every time you open it",
              "Confidence in your money decisions",
            ]}
          />
        </div>
      </div>
      <p className="mt-10 text-white/80">Free on your computer. No account and no bank login.</p>
      <p className="mt-2 text-sm text-white/60">
        Want the AI statement import? NixusCloud Advance is free for your first 7 days.
      </p>
      <ButtonLink to="/download" className="mt-6">
        Download Nixus
      </ButtonLink>
    </Section>
  );
}
