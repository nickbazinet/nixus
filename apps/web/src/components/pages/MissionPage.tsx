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
import { cn } from "@/lib/cn";

const GOALS = [
  {
    icon: Sparkles,
    title: "Knowledge and guidance",
    body: "Best practices for average people, in plain language. No finance degree needed.",
  },
  {
    icon: Target,
    title: "Automate financial decisions",
    body: "Let the app handle the routine choices, so good habits become the default.",
  },
  {
    icon: Car,
    title: "Automate the rest of life",
    body: "Money is the start. Garage already tracks vehicle upkeep, and more will follow.",
  },
  {
    icon: CodeXml,
    title: "Use technology to do it",
    body: "Your data stays on your computer, the code is open source, and AI is used only where it helps and you opt in.",
  },
];

const PROMISES = [
  {
    title: "Your records stay yours",
    body: "Your data stays on your computer by design. Cloud features are opt-in.",
  },
  { title: "Open source", body: "Read the code, not just the promise." },
  { title: "Plain about limits", body: "I will say what Nixus cannot do yet, before you find out." },
];

export function MissionPage() {
  return (
    <>
      <Section bg="page" className="pt-12 sm:pt-16">
        <Kicker>Our mission</Kicker>
        <h1 className="mt-6 max-w-4xl text-display-xl font-semibold">
          Improve the financial stability of the <GradientText>average Canadian</GradientText>.
        </h1>
        <p className="mt-8 max-w-2xl text-lead text-ink-soft">
          Not a finance expert. Not someone with a spare weekend. The average person, with a real
          life and a budget to run.
        </p>
      </Section>

      <Section bg="white" labelledBy="goals">
        <Kicker>How we get there</Kicker>
        <h2 id="goals" className="mt-5 text-display-m font-semibold">
          Four goals
        </h2>
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {GOALS.map((goal) => (
            <div key={goal.title} className={cn(cardClass(true), "p-6")}>
              <IconChip icon={goal.icon} />
              <h3 className="mt-5 text-lg font-semibold">{goal.title}</h3>
              <p className="mt-3 text-[0.95rem] text-ink-muted">{goal.body}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section bg="page" labelledBy="why-building">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,2fr)] lg:gap-14">
          <figure>
            <div className="grid aspect-square max-w-[22rem] place-items-center rounded-3xl bg-glass text-sm font-bold uppercase tracking-wide text-ink-soft">
              [Your photo]
            </div>
            <figcaption className="mt-4">
              <p className="font-bold text-ink">Nick</p>
              <p className="text-sm text-ink-muted">Founder, building Nixus on his own</p>
            </figcaption>
          </figure>
          <div>
            <Kicker>Why I&rsquo;m building this</Kicker>
            <h2 id="why-building" className="mt-5 text-display-m font-semibold">
              Built by one person who wanted this to exist
            </h2>
            <div className="mt-6 space-y-5 text-ink-soft">
              <p>
                I have built my own budget for years. Every time I talked money with the people
                around me, I found the same thing: we had all built it ourselves, one spreadsheet
                at a time.
              </p>
              <p>
                Getting financially responsible changed my life for the better. I want everyone
                around me to have that, without reinventing the wheel. So I am bringing automation
                and best practices to everybody, starting with Canadians.
              </p>
              <p>
                I wanted a tool that tells you what to do next, not just what happened, without
                handing a company your bank password. Nixus is in alpha, it is open source, and I
                will tell you plainly what it cannot do yet. If you try it, you get a direct line to
                me.
              </p>
            </div>
          </div>
        </div>
      </Section>

      <Section bg="white" labelledBy="promises">
        <Kicker>Promises</Kicker>
        <h2 id="promises" className="mt-5 text-display-m font-semibold">
          What you can hold me to
        </h2>
        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {PROMISES.map((promise) => (
            <div key={promise.title} className={cn(cardClass(true), "p-6")}>
              <h3 className="text-lg font-semibold">{promise.title}</h3>
              <p className="mt-3 text-[0.95rem] text-ink-muted">{promise.body}</p>
            </div>
          ))}
        </div>
        <div className="mt-8 grid gap-5 md:grid-cols-2">
          <div className={cn(cardClass(), "p-6")}>
            <h3 className="text-lg font-semibold text-brand">What works today</h3>
            <Bullets
              className="mt-4 text-[0.95rem]"
              items={[
                "Importing credit card statements",
                "Budgets and net worth history",
                "Registered account tracking",
              ]}
            />
          </div>
          <div className={cn(cardClass(), "p-6")}>
            <h3 className="text-lg font-semibold text-amber-ink">What it isn&rsquo;t, yet</h3>
            <Bullets
              className="mt-4 text-[0.95rem]"
              items={["No bank connection", "No mobile app", "Not professional financial advice"]}
            />
          </div>
        </div>
      </Section>

      <ClosingBand
        heading="Help me build it"
        body="Founding Users shape Nixus from the start, and keep a discounted price for good."
      >
        <ButtonLink to="/founding-users">Become a Founding User</ButtonLink>
      </ClosingBand>
    </>
  );
}
