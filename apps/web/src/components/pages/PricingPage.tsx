import { Check, Plus } from "lucide-react";

import {
  Bullets,
  ButtonAnchor,
  ButtonLink,
  GradientText,
  Kicker,
  Section,
  TextAnchor,
} from "@/components/ui";
import { copyFor, fill } from "@/content/index";
import { compareGroupsFor, plansFor, pricingFaqFor, type Plan } from "@/content/pricing";
import { cn } from "@/lib/cn";
import { billingPlanUrl } from "@/lib/links";
import type { Locale } from "@/lib/locale";
import { trialMicrocopy, usePlanPrices, type DisplayPrice } from "@/lib/planPrices";
import { pagePath } from "@/lib/routes";

export function PricingPage({ locale }: { locale: Locale }) {
  const copy = copyFor(locale).pricing;
  const plans = plansFor(locale);
  const prices = usePlanPrices(plans, locale);

  return (
    <>
      <Section bg="page" className="pt-12 sm:pt-16">
        <Kicker>{copy.kicker}</Kicker>
        <h1 className="mt-6 text-display-l font-semibold">
          {copy.heading.first}
          <br />
          <GradientText>{copy.heading.accent}</GradientText>
          {copy.heading.tail}
        </h1>
        <p className="mt-6 max-w-2xl text-lead text-ink-soft">{copy.lead}</p>

        <div className="mt-12 grid items-start gap-5 md:grid-cols-3">
          {plans.map((plan, index) => (
            <PlanCard key={plan.id} plan={plan} price={prices[index]} locale={locale} />
          ))}
        </div>
        <p className="mt-6 max-w-2xl text-sm text-ink-muted">{copy.taxNote}</p>
      </Section>

      <Section bg="white" id="compare" labelledBy="compare-heading">
        <h2 id="compare-heading" className="text-display-m font-semibold">
          {copy.compare.heading}
        </h2>
        <p className="mt-4 max-w-2xl text-ink-soft">{copy.compare.lead}</p>
        <div className="mt-10 overflow-x-auto">
          <table className="w-full min-w-[36rem] border-collapse text-left text-[0.95rem]">
            <caption className="sr-only">{copy.compare.caption}</caption>
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className="py-4 pl-2 font-normal">
                  <span className="sr-only">{copy.compare.featureColumn}</span>
                </th>
                {plans.map((plan) => (
                  <th
                    key={plan.id}
                    scope="col"
                    className={cn(
                      "w-[16%] py-4 text-center font-bold",
                      plan.highlighted && "rounded-t-xl bg-violet-soft/40",
                    )}
                  >
                    {plan.shortName}
                  </th>
                ))}
              </tr>
            </thead>
            {compareGroupsFor(locale).map((group) => (
              <tbody key={group.rows[0].label}>
                {group.rows.map((row) => (
                  <tr key={row.label} className="border-b border-line">
                    <th scope="row" className="py-4 pl-2 pr-4 font-normal text-ink-soft">
                      <span className="block font-semibold text-ink">{row.label}</span>
                      {row.hint ? (
                        <span className="mt-0.5 block text-sm text-ink-muted">{row.hint}</span>
                      ) : null}
                    </th>
                    {plans.map((plan) => {
                      const value = row.values[plan.id];
                      return (
                        <td
                          key={plan.id}
                          className={cn("py-4 text-center", plan.highlighted && "bg-violet-soft/40")}
                        >
                          {typeof value === "string" ? (
                            value
                          ) : value ? (
                            <>
                              <Check className="mx-auto size-4 text-brand" aria-hidden="true" />
                              <span className="sr-only">{copy.compare.included}</span>
                            </>
                          ) : (
                            <>
                              <span aria-hidden="true" className="text-ink-muted/60">
                                —
                              </span>
                              <span className="sr-only">{copy.compare.notIncluded}</span>
                            </>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      </Section>

      <Section bg="page">
        <div className="grid items-center gap-8 rounded-3xl bg-glass p-8 sm:p-12 lg:grid-cols-[minmax(0,1.4fr)_auto] lg:gap-14">
          <div>
            <Kicker>{copy.founding.kicker}</Kicker>
            <h2 className="mt-5 text-display-s font-semibold">{copy.founding.heading}</h2>
            <p className="mt-4 max-w-xl text-ink-soft">{copy.founding.body}</p>
          </div>
          <ButtonLink
            to={pagePath("foundingUsers", locale)}
            variant="dark"
            className="justify-self-start"
          >
            {copy.founding.cta}
          </ButtonLink>
        </div>
      </Section>

      <Section bg="white" labelledBy="faq-heading" containerClassName="max-w-[48rem]">
        <h2 id="faq-heading" className="text-display-m font-semibold">
          {copy.faqHeading}
        </h2>
        <div className="mt-10 border-t border-line">
          {pricingFaqFor(locale).map((item) => (
            <details key={item.question} className="nx-faq group border-b border-line">
              <summary className="nx-focus flex cursor-pointer items-center justify-between gap-6 rounded-sm py-5 font-bold text-ink">
                {item.question}
                <Plus
                  aria-hidden="true"
                  className="nx-faq-icon size-5 flex-none text-ink-soft transition-transform"
                />
              </summary>
              <p className="pb-6 pr-10 text-ink-soft">{item.answer}</p>
            </details>
          ))}
        </div>
      </Section>
    </>
  );
}

function PlanCard({
  plan,
  price,
  locale,
}: {
  plan: Plan;
  price: DisplayPrice;
  locale: Locale;
}) {
  const copy = copyFor(locale).pricing;
  const trial = plan.trial;
  return (
    <div
      className={cn(
        "flex h-full flex-col rounded-2xl border bg-white p-6",
        plan.highlighted
          ? "border-violet shadow-[0_24px_48px_-28px_rgba(120,80,210,0.75)] ring-1 ring-violet"
          : "border-line",
      )}
    >
      <h2 className="text-xl font-semibold">{plan.name}</h2>
      {plan.badge || trial ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {plan.badge ? (
            <span className="self-start rounded-full bg-violet-soft px-3 py-0.5 text-xs font-bold text-[#7a3fb8]">
              {plan.badge}
            </span>
          ) : null}
          {trial ? (
            <span className="self-start rounded-full bg-violet-soft px-3 py-0.5 text-xs font-bold text-[#7a3fb8]">
              {trial.badge}
            </span>
          ) : null}
        </div>
      ) : null}
      <p className="mt-3 text-[0.95rem] text-ink-muted">{plan.tagline}</p>
      <p className="mt-6 font-display text-[2.5rem] font-semibold leading-none">
        {price.amount}
        {price.interval ? (
          <span className="ml-1 font-sans text-sm font-normal text-ink-muted">{price.interval}</span>
        ) : null}
      </p>
      <Bullets className="mt-6 flex-1 text-[0.95rem]" items={plan.features} />
      <div className="mt-8">
        {plan.lookupKey === null ? (
          <ButtonLink to={pagePath("download", locale)} variant="dark" className="w-full">
            {copy.downloadCta}
          </ButtonLink>
        ) : trial ? (
          <>
            <ButtonAnchor
              href={billingPlanUrl(locale, trial.lookupKey)}
              variant={plan.highlighted ? "primary" : "outline"}
              className="w-full"
            >
              {trial.cta}
            </ButtonAnchor>
            {/* Directly under the button, before anyone commits: what happens
                after the trial, that a card is needed, and the way out. */}
            <p className="mt-3 text-sm text-ink-muted">{trialMicrocopy(trial, price)}</p>
            <TextAnchor
              href={billingPlanUrl(locale, plan.lookupKey)}
              className="mt-3 inline-block text-sm"
            >
              {trial.secondaryCta}
            </TextAnchor>
          </>
        ) : (
          <ButtonAnchor
            href={billingPlanUrl(locale, plan.lookupKey)}
            variant={plan.highlighted ? "primary" : "outline"}
            className="w-full"
          >
            {fill(copy.choosePlan, { plan: plan.shortName })}
          </ButtonAnchor>
        )}
      </div>
    </div>
  );
}
