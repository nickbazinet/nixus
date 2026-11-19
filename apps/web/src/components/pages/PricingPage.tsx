import { Check, Plus } from "lucide-react";

import {
  Bullets,
  ButtonAnchor,
  ButtonLink,
  GradientText,
  Kicker,
  Section,
} from "@/components/ui";
import { COMPARE_ROWS, PLANS, PRICING_FAQ, type Plan } from "@/content/pricing";
import { cn } from "@/lib/cn";
import { billingPlanUrl } from "@/lib/links";
import { usePlanPrices, type DisplayPrice } from "@/lib/planPrices";

export function PricingPage() {
  const prices = usePlanPrices(PLANS);
  return (
    <>
      <Section bg="page" className="pt-12 sm:pt-16">
        <Kicker>Pricing</Kicker>
        <h1 className="mt-6 text-display-l font-semibold">
          Free on your computer.
          <br />
          <GradientText>Cloud Capabilities</GradientText> when you want it.
        </h1>
        <p className="mt-6 max-w-2xl text-lead text-ink-soft">
          Using Nixus on your computer costs nothing and needs no account. NixusCloud adds
          household views and AI.
        </p>

        <div className="mt-12 grid items-start gap-5 md:grid-cols-3">
          {PLANS.map((plan, index) => (
            <PlanCard key={plan.id} plan={plan} price={prices[index]} />
          ))}
        </div>

        <p className="mt-10 text-sm text-ink-muted">
          [CONFIRM: prices in CAD, taxes extra, annual option, cancel anytime.]
        </p>
      </Section>

      <Section bg="white" id="compare" labelledBy="compare-heading">
        <h2 id="compare-heading" className="text-display-m font-semibold">
          Compare the plans
        </h2>
        <div className="mt-10 overflow-x-auto">
          <table className="w-full min-w-[36rem] border-collapse text-left text-[0.95rem]">
            <caption className="sr-only">Features included in each Nixus plan</caption>
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className="py-4 pl-2 font-normal">
                  <span className="sr-only">Feature</span>
                </th>
                {PLANS.map((plan) => (
                  <th key={plan.id} scope="col" className="w-[16%] py-4 text-center font-bold">
                    {plan.shortName}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COMPARE_ROWS.map((row) => (
                <tr key={row.label} className="border-b border-line">
                  <th scope="row" className="py-4 pl-2 font-normal text-ink-soft">
                    {row.label}
                  </th>
                  {PLANS.map((plan) => {
                    const value = row.values[plan.id];
                    return (
                      <td key={plan.id} className="py-4 text-center">
                        {typeof value === "string" ? (
                          value
                        ) : value ? (
                          <>
                            <Check className="mx-auto size-4 text-brand" aria-hidden="true" />
                            <span className="sr-only">Included</span>
                          </>
                        ) : (
                          <>
                            <span aria-hidden="true" className="text-ink-muted/60">
                              —
                            </span>
                            <span className="sr-only">Not included</span>
                          </>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section bg="page">
        <div className="grid items-center gap-8 rounded-3xl bg-glass p-8 sm:p-12 lg:grid-cols-[minmax(0,1.4fr)_auto] lg:gap-14">
          <div>
            <Kicker>Founding Users</Kicker>
            <h2 className="mt-5 text-display-s font-semibold">
              Early access, at a discounted price, forever.
            </h2>
            <p className="mt-4 max-w-xl text-ink-soft">
              Join the alpha early, share what works and what does not, and keep a lower price for
              good.
            </p>
          </div>
          <ButtonLink to="/founding-users" variant="dark" className="justify-self-start">
            See the program
          </ButtonLink>
        </div>
      </Section>

      <Section bg="white" labelledBy="faq-heading" containerClassName="max-w-[48rem]">
        <h2 id="faq-heading" className="text-display-m font-semibold">
          Pricing questions
        </h2>
        <div className="mt-10 border-t border-line">
          {PRICING_FAQ.map((item) => (
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

function PlanCard({ plan, price }: { plan: Plan; price: DisplayPrice }) {
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
      {plan.badge ? (
        <span className="mt-3 self-start rounded-full bg-violet-soft px-3 py-0.5 text-xs font-bold text-[#7a3fb8]">
          {plan.badge}
        </span>
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
          <ButtonLink to="/download" variant="dark" className="w-full">
            Download Nixus
          </ButtonLink>
        ) : (
          <ButtonAnchor
            href={billingPlanUrl(plan.lookupKey)}
            variant={plan.highlighted ? "primary" : "outline"}
            className="w-full"
          >
            Choose {plan.shortName}
          </ButtonAnchor>
        )}
      </div>
    </div>
  );
}
