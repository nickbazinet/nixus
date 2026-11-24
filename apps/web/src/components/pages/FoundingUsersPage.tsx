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
import { copyFor, fill } from "@/content/index";
import type { FoundingUsersCopy } from "@/content/types";
import { cn } from "@/lib/cn";
import type { Locale } from "@/lib/locale";
import { pagePath } from "@/lib/routes";

/** Icon for each benefit card, in card order. */
const BENEFIT_ICONS = [Sparkles, TrendingUp, MessageSquare];

export function FoundingUsersPage({ locale }: { locale: Locale }) {
  const copy = copyFor(locale).foundingUsers;

  return (
    <>
      <Section bg="page" className="overflow-hidden pt-12 sm:pt-16">
        <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_auto]">
          <div>
            <Kicker>{copy.kicker}</Kicker>
            <h1 className="mt-6 max-w-4xl text-display-l font-semibold">
              {copy.heading.lead}
              <GradientText>{copy.heading.accent}</GradientText>
              {copy.heading.tail}
            </h1>
            <div className="mt-6 flex items-center gap-3">
              <img
                src="/team/nick-small.jpg"
                alt=""
                width={160}
                height={160}
                className="size-10 rounded-full object-cover"
              />
              <div className="text-sm">
                <p className="font-bold text-ink">{copy.noteTitle}</p>
                <p className="text-ink-muted">{copy.noteBody}</p>
              </div>
            </div>
            <p className="mt-6 max-w-2xl text-lead text-ink-soft">{copy.lead}</p>
            <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3">
              <ButtonLink to={pagePath("foundingUsers", locale)} hash="apply">
                {copy.cta}
              </ButtonLink>
            </div>
          </div>
          <PillDecoration className="mr-6 hidden lg:block" />
        </div>
      </Section>

      <Section bg="white" labelledBy="what-you-get">
        <Kicker>{copy.benefits.kicker}</Kicker>
        <h2 id="what-you-get" className="mt-5 text-display-m font-semibold">
          {copy.benefits.heading}
        </h2>
        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {copy.benefits.items.map((item, index) => (
            <div key={item.title} className={cn(cardClass(true), "p-6")}>
              <IconChip icon={BENEFIT_ICONS[index] ?? Sparkles} />
              <h3 className="mt-5 text-lg font-semibold">{item.title}</h3>
              <p className="mt-3 text-[0.95rem] text-ink-muted">{item.body}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section bg="page" labelledBy="what-i-ask">
        <div className="grid gap-10 lg:grid-cols-2 lg:gap-16">
          <div>
            <Kicker>{copy.ask.kicker}</Kicker>
            <h2 id="what-i-ask" className="mt-5 text-display-s font-semibold">
              {copy.ask.heading}
            </h2>
            <p className="mt-5 text-ink-soft">{copy.ask.body}</p>
          </div>
          <ul className="space-y-4 lg:pt-2">
            {copy.ask.items.map((item) => (
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
        <Kicker>{copy.how.kicker}</Kicker>
        <h2 id="how-it-works" className="mt-5 text-display-m font-semibold">
          {copy.how.heading}
        </h2>
        <ol className="mt-12 grid gap-5 md:grid-cols-3">
          {copy.how.steps.map((step, index) => (
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
            <Kicker>{copy.apply.kicker}</Kicker>
            <h2 id="apply-heading" className="mt-5 text-display-s font-semibold">
              {copy.apply.heading}
            </h2>
            <p className="mt-4 text-ink-soft">{copy.apply.body}</p>
          </div>
          <ApplicationForm copy={copy.form} />
        </div>
      </Section>
    </>
  );
}

const fieldClass =
  "nx-focus mt-2 block w-full rounded-xl border border-line-strong bg-white px-4 py-3 text-ink placeholder:text-ink-muted/70";

/**
 * No backend: submitting opens the visitor's mail app with the answers in the
 * body, addressed to the public contact mailbox. The body is written in the
 * language the applicant was reading, so a French applicant's mail arrives
 * labelled the way they filled it in.
 */
function ApplicationForm({ copy }: { copy: FoundingUsersCopy["form"] }) {
  const id = useId();
  const [sent, setSent] = useState(false);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = String(data.get("name") ?? "").trim();
    const body = [
      `${copy.mailNameLabel}: ${name}`,
      `${copy.mailEmailLabel}: ${String(data.get("email") ?? "").trim()}`,
      `${copy.mailTodayLabel}: ${String(data.get("today") ?? "")}`,
      "",
      copy.mailNoBrainerLabel,
      String(data.get("noBrainer") ?? "").trim(),
    ].join("\n");
    const subject = name ? fill(copy.mailSubject, { name }) : copy.mailSubjectNoName;
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
            {copy.nameLabel}
          </label>
          <input id={`${id}-name`} name="name" required autoComplete="name" className={fieldClass} />
        </div>
        <div>
          <label htmlFor={`${id}-email`} className="font-bold text-ink">
            {copy.emailLabel}
          </label>
          <input
            id={`${id}-email`}
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder={copy.emailPlaceholder}
            className={fieldClass}
          />
        </div>
        <div>
          <label htmlFor={`${id}-today`} className="font-bold text-ink">
            {copy.todayLabel}
          </label>
          <div className="relative">
            <select
              id={`${id}-today`}
              name="today"
              className={cn(fieldClass, "appearance-none pr-10")}
              defaultValue={copy.todayOptions[0]}
            >
              {copy.todayOptions.map((option) => (
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
            {copy.noBrainerLabel}
          </label>
          <textarea id={`${id}-nobrainer`} name="noBrainer" rows={4} className={fieldClass} />
        </div>
      </div>
      <button type="submit" className={cn(buttonClass("primary"), "mt-6 w-full")}>
        {copy.submit}
      </button>
      <p className="mt-4 text-xs text-ink-muted" aria-live="polite">
        {sent ? fill(copy.sentNote, { email: CONTACT_EMAIL }) : copy.privacyNote}
      </p>
    </form>
  );
}
