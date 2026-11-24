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
import { cn } from "@/lib/cn";

const ROWS: ReadonlyArray<{
  heading: ReactNode;
  body: string;
  points: readonly string[];
  visual: ReactNode;
}> = [
  {
    heading: "From statement to sorted in seconds",
    body: "Drop in a credit card statement as a PDF or a screenshot. Nixus reads every transaction and puts it in a category, so the typing is gone.",
    points: [
      "PDF and screenshot import",
      "Automatic categories you can correct",
      "Statements kept private, never used to train AI",
      "Part of NixusCloud Advance, free for your first 7 days",
    ],
    visual: <ImportMock />,
  },
  {
    heading: "A chart tells you what happened. Nixus tells you what to do.",
    body: "Every time you open the app you get a short list of next actions, from a budget that is slipping to contribution room you have not used.",
    points: ["Prioritized, short, specific", "Based on your own numbers", "Plain language, no jargon"],
    visual: <NextActionsMock />,
  },
  {
    heading: "TFSA, RRSP and FHSA as first-class citizens",
    body: "Track your registered accounts next to everything else, so the accounts that matter most to Canadians are not an afterthought.",
    points: [
      "Balances for each registered account",
      "Contribution room at a glance",
      "Included in your net worth",
    ],
    visual: <RegisteredAccountsMock />,
  },
  {
    heading: "Budgets and net worth, month after month",
    body: "See each category against its limit, and watch assets and liabilities settle into one timeline you can trust.",
    points: [
      "Category budgets with clear over and under",
      "Net worth history from 1M to all time",
      "Everything computed on your computer",
    ],
    visual: <NetWorthChartMock />,
  },
];

const TOOLBOX = [
  {
    icon: ArrowLeftRight,
    title: "Cash flow, clearly",
    body: "Track every expense and income so you always know what came in, what went out and what is left.",
  },
  {
    icon: Landmark,
    title: "Every account, CAD and USD",
    body: "Banks, cards, investments, real estate and more, in Canadian and US dollars, in one place.",
  },
  {
    icon: PiggyBank,
    title: "Savings goals",
    body: "Plan the things you are saving for, fund them over time and see how close you are.",
  },
  {
    icon: TrendingUp,
    title: "Trends and year in review",
    body: "Spot spending trends as they form, then look back on the whole year at a glance.",
  },
  {
    icon: Hourglass,
    title: "Forecasts and retirement",
    body: "Project your net worth forward and test your retirement plan before you commit to it.",
  },
  {
    icon: Car,
    title: "A garage for every vehicle",
    body: "Keep several vehicles, with service schedules, full history and alerts before maintenance is due.",
  },
  {
    icon: Sparkles,
    title: "Ask about your money",
    body: "Ask questions in plain language, like where last month went, and get an answer from your own numbers.",
  },
  {
    icon: Wrench,
    title: "Ask about your car",
    body: "Wondering when the next oil change is due? Ask, and the answer comes from your service history.",
  },
  {
    icon: Shield,
    title: "Private by design",
    body: "No bank logins and no bank connection. Your records stay on your computer.",
    link: true,
  },
];

export function FeaturesPage() {
  return (
    <>
      <Section bg="page" className="pt-12 sm:pt-16">
        <Kicker>Features</Kicker>
        <h1 className="mt-6 text-display-xl font-semibold">
          Less busywork.
          <br />
          <GradientText>More clarity</GradientText>.
        </h1>
        <p className="mt-6 max-w-2xl text-lead text-ink-soft">
          Nixus takes the busywork out of money, so what is left is the part that matters: knowing
          where you stand and deciding what to do next.
        </p>

        <div className="mt-10 grid max-w-3xl gap-5 sm:grid-cols-2">
          <div className={cn(cardClass(), "p-6")}>
            <div className="flex items-center gap-3">
              <MinusGlyph className="h-2 w-7" />
              <h2 className="text-lg font-semibold">We subtract</h2>
            </div>
            <Bullets
              className="mt-5 text-[0.95rem]"
              items={[
                "Typing in transactions by hand",
                "Sorting every purchase into a category",
                "Wondering what to do next",
                "Juggling separate sheets for each account",
              ]}
            />
          </div>
          <div className={cn(cardClass(), "p-6")}>
            <div className="flex items-center gap-3">
              <PlusGlyph className="size-7" />
              <h2 className="text-lg font-semibold">You add</h2>
            </div>
            <Bullets
              className="mt-5 text-[0.95rem]"
              items={[
                "A clear view of your net worth and budgets",
                "A short list of next actions each time you open it",
                "TFSA, RRSP and FHSA tracked next to everything else",
                "Confidence in your money decisions",
              ]}
            />
          </div>
        </div>

        <div className="mt-10 flex flex-wrap gap-3">
          <ButtonLink to="/download">Download Nixus</ButtonLink>
          <ButtonLink to="/pricing" variant="outline">
            See the plans
          </ButtonLink>
        </div>
      </Section>

      <Section bg="white">
        <div className="space-y-20 lg:space-y-28">
          {ROWS.map((row, index) => (
            <div
              key={index}
              className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16"
            >
              <div className={cn(index % 2 === 1 && "lg:order-2")}>
                <h2 className="text-display-s font-semibold">{row.heading}</h2>
                <p className="mt-5 text-ink-soft">{row.body}</p>
                <Bullets className="mt-6 text-[0.95rem]" items={row.points} />
              </div>
              <div className={cn(index % 2 === 1 && "lg:order-1")}>{row.visual}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section bg="page" labelledBy="toolbox">
        <Kicker>And more</Kicker>
        <h2 id="toolbox" className="mt-5 text-display-m font-semibold">
          The rest of the toolbox
        </h2>
        <p className="mt-4 text-ink-soft">
          From daily cash flow to retirement, and even your car: everything else Nixus keeps organized for you.
        </p>
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {TOOLBOX.map((item) => (
            <div key={item.title} className={cn(cardClass(), "p-6")}>
              <IconChip icon={item.icon} />
              <h3 className="mt-5 text-lg font-semibold">{item.title}</h3>
              <p className="mt-2 text-[0.95rem] text-ink-muted">{item.body}</p>
              {item.link ? (
                <TextLink to="/privacy" className="mt-4 inline-block text-[0.95rem]">
                  How we protect your data
                </TextLink>
              ) : null}
            </div>
          ))}
        </div>
      </Section>

      <Section bg="white" labelledBy="why-nixus">
        <Kicker>Why Nixus</Kicker>
        <h2 id="why-nixus" className="mt-5 text-display-m font-semibold">
          Most people choose between work and trust
        </h2>
        <p className="mt-4 text-ink-soft">Nixus is the third option.</p>
        <div className="mt-12 grid gap-5 md:grid-cols-3">
          <div className={cn(cardClass(true), "p-6")}>
            <h3 className="text-lg font-semibold">A spreadsheet</h3>
            <p className="mt-3 text-[0.95rem] text-ink-muted">
              You stay in control, and you do all the typing. It tells you what happened only if
              you build it to.
            </p>
          </div>
          <div className={cn(cardClass(true), "p-6")}>
            <h3 className="text-lg font-semibold">Bank-connected apps</h3>
            <p className="mt-3 text-[0.95rem] text-ink-muted">
              Automatic, but they typically want your bank credentials and keep your data on their
              servers.
            </p>
          </div>
          <div className="nx-gradient-card rounded-2xl p-6 text-white shadow-[0_24px_40px_-24px_rgba(90,70,200,0.8)]">
            <h3 className="text-lg font-semibold">Nixus</h3>
            <p className="mt-3 text-[0.95rem] text-white/90">
              Import a statement in seconds. Your records stay on your computer. You get told what
              to do next.
            </p>
          </div>
        </div>
      </Section>

      <ClosingBand
        heading="Try it on your own statement"
        body="Free on your computer, no account needed. AI statement import is part of NixusCloud Advance, which starts with 7 days free — a card is required, and you can cancel before the trial ends."
      >
        <ButtonLink to="/download">Download Nixus</ButtonLink>
      </ClosingBand>
    </>
  );
}
