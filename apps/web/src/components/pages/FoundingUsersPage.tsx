import { ChevronDown, MessageSquare, Sparkles, TrendingUp } from "lucide-react";
import { useId, useState, type FormEvent } from "react";

import {
  ButtonLink,
  GradientText,
  IconChip,
  Kicker,
  NumberBadge,
  Section,
  buttonClass,
  cardClass,
} from "@/components/ui";
import { PillDecoration } from "@/components/visuals";
import { CONTACT_EMAIL } from "@/content/contact";
import { cn } from "@/lib/cn";

const BENEFITS = [
  {
    icon: Sparkles,
    title: "Early access",
    body: "Use the platform before everyone else, including new features as they land.",
  },
  {
    icon: TrendingUp,
    title: "A discounted price, forever",
    body: "[DISCOUNT: for example X% off every NixusCloud plan, for as long as you stay.]",
  },
  {
    icon: MessageSquare,
    title: "A direct line to me",
    body: "I read every message. You talk to the person building it, not a support queue.",
  },
];

const STEPS = [
  { title: "Apply", body: "Tell me a bit about how you manage money today." },
  { title: "Get access", body: "I send your invitation and lock in your price. [Reply time.]" },
  { title: "Talk to me", body: "Use it, tell me what you think, and watch it change." },
];

const MONEY_TODAY = [
  "A spreadsheet",
  "A bank-connected app",
  "Pen and paper",
  "In my head",
  "Something else",
];

export function FoundingUsersPage() {
  return (
    <>
      <Section bg="page" className="overflow-hidden pt-12 sm:pt-16">
        <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_auto]">
          <div>
            <Kicker>Founding Users</Kicker>
            <h1 className="mt-6 max-w-4xl text-display-l font-semibold">
              Help build Nixus. Get it first, and{" "}
              <GradientText>pay less, forever</GradientText>.
            </h1>
            <div className="mt-6 flex items-center gap-3">
              <span
                aria-hidden="true"
                className="nx-gradient-card grid size-10 place-items-center rounded-full font-display font-semibold text-white"
              >
                N
              </span>
              <div className="text-sm">
                <p className="font-bold text-ink">A note from Nick</p>
                <p className="text-ink-muted">Founder of Nixus. On this page, &ldquo;I&rdquo; is me.</p>
              </div>
            </div>
            <p className="mt-6 max-w-2xl text-lead text-ink-soft">
              Founding Users get early access to the platform at a discounted price for good, in
              exchange for honest feedback and regular conversations with me.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3">
              <ButtonLink to="/founding-users" hash="apply">
                Apply to be a Founding User
              </ButtonLink>
              <span className="text-sm text-ink-muted">[N] spots, [N] left.</span>
            </div>
          </div>
          <PillDecoration className="mr-6 hidden lg:block" />
        </div>
      </Section>

      <Section bg="white" labelledBy="what-you-get">
        <Kicker>What you get</Kicker>
        <h2 id="what-you-get" className="mt-5 text-display-m font-semibold">
          Three things, for good
        </h2>
        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {BENEFITS.map((item) => (
            <div key={item.title} className={cn(cardClass(true), "p-6")}>
              <IconChip icon={item.icon} />
              <h3 className="mt-5 text-lg font-semibold">{item.title}</h3>
              <p className="mt-3 text-[0.95rem] text-ink-muted">{item.body}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section bg="page" labelledBy="what-i-ask">
        <div className="grid gap-10 lg:grid-cols-2 lg:gap-16">
          <div>
            <Kicker>What I ask in return</Kicker>
            <h2 id="what-i-ask" className="mt-5 text-display-s font-semibold">
              Honest feedback, and real conversations
            </h2>
            <p className="mt-5 text-ink-soft">
              This only works if you tell me the truth about what is good, what is bad, and what
              could be better.
            </p>
          </div>
          <ul className="space-y-4 lg:pt-2">
            {[
              "Share what works and what does not, the good and the bad",
              "Suggest improvements, big or small",
              "Talk with me frequently about how to make Nixus better [cadence: for example a short call each month]",
            ].map((item) => (
              <li key={item} className="flex items-start gap-3 text-ink-soft">
                <span
                  aria-hidden="true"
                  className="nx-gradient-pill mt-[0.6em] h-1.5 w-4 flex-none rounded-full"
                />
                {item}
              </li>
            ))}
          </ul>
        </div>
      </Section>

      <Section bg="white" labelledBy="how-it-works">
        <Kicker>How it works</Kicker>
        <h2 id="how-it-works" className="mt-5 text-display-m font-semibold">
          From application to first call
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

      <Section bg="page" id="apply" labelledBy="apply-heading">
        <div className="grid gap-10 rounded-3xl bg-glass p-6 sm:p-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-14 lg:p-12">
          <div>
            <Kicker>Apply</Kicker>
            <h2 id="apply-heading" className="mt-5 text-display-s font-semibold">
              I read every application myself
            </h2>
            <p className="mt-4 text-ink-soft">
              Tell me a little about you. There are no wrong answers.
            </p>
          </div>
          <ApplicationForm />
        </div>
      </Section>
    </>
  );
}

const fieldClass =
  "nx-focus mt-2 block w-full rounded-xl border border-line-strong bg-white px-4 py-3 text-ink placeholder:text-ink-muted/70";

/**
 * No backend: submitting opens the visitor's mail app with the answers in the
 * body, addressed to the public contact mailbox.
 */
function ApplicationForm() {
  const id = useId();
  const [sent, setSent] = useState(false);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = String(data.get("name") ?? "").trim();
    const body = [
      `Name: ${name}`,
      `Email: ${String(data.get("email") ?? "").trim()}`,
      `How I manage my money today: ${String(data.get("today") ?? "")}`,
      "",
      "What would make Nixus a no-brainer for me:",
      String(data.get("noBrainer") ?? "").trim(),
    ].join("\n");
    const subject = `Founding User application${name ? ` — ${name}` : ""}`;
    window.location.href = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    setSent(true);
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-2xl bg-page p-6 shadow-[0_24px_50px_-30px_rgba(20,40,80,0.45)] sm:p-8"
    >
      <div className="space-y-5 text-sm">
        <div>
          <label htmlFor={`${id}-name`} className="font-bold text-ink">
            Name
          </label>
          <input id={`${id}-name`} name="name" required autoComplete="name" className={fieldClass} />
        </div>
        <div>
          <label htmlFor={`${id}-email`} className="font-bold text-ink">
            Email
          </label>
          <input
            id={`${id}-email`}
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@example.com"
            className={fieldClass}
          />
        </div>
        <div>
          <label htmlFor={`${id}-today`} className="font-bold text-ink">
            How do you manage your money today?
          </label>
          <div className="relative">
            <select
              id={`${id}-today`}
              name="today"
              className={cn(fieldClass, "appearance-none pr-10")}
              defaultValue={MONEY_TODAY[0]}
            >
              {MONEY_TODAY.map((option) => (
                <option key={option}>{option}</option>
              ))}
            </select>
            <ChevronDown
              aria-hidden="true"
              className="pointer-events-none absolute right-4 top-1/2 size-4 -translate-y-1/2 text-ink-soft"
            />
          </div>
        </div>
        <div>
          <label htmlFor={`${id}-nobrainer`} className="font-bold text-ink">
            What would make Nixus a no-brainer for you?
          </label>
          <textarea id={`${id}-nobrainer`} name="noBrainer" rows={4} className={fieldClass} />
        </div>
      </div>
      <button type="submit" className={cn(buttonClass("primary"), "mt-6 w-full")}>
        Apply to be a Founding User
      </button>
      <p className="mt-4 text-xs text-ink-muted" aria-live="polite">
        {sent
          ? `Your email app should open with your answers. If it does not, write to ${CONTACT_EMAIL}.`
          : "[Reply time, and what happens to your answers.]"}
      </p>
    </form>
  );
}
