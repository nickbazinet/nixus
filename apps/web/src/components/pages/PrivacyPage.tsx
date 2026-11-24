import { House, Monitor, Sparkles } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import {
  Bullets,
  ButtonLink,
  ClosingBand,
  GradientText,
  IconChip,
  Kicker,
  Section,
  TextAnchor,
  TextLink,
  cardClass,
} from "@/components/ui";
import { LaptopLock } from "@/components/visuals";
import { copyFor } from "@/content/index";
import { cn } from "@/lib/cn";
import { GITHUB_URL } from "@/lib/links";
import type { Locale } from "@/lib/locale";
import { pagePath } from "@/lib/routes";

/** Icon and badge tone for each privacy layer, in layer order. */
const LAYER_STYLE: ReadonlyArray<{ icon: LucideIcon; tone: "blue" | "violet" }> = [
  { icon: Monitor, tone: "blue" },
  { icon: House, tone: "blue" },
  { icon: Sparkles, tone: "violet" },
];

export function PrivacyPage({ locale }: { locale: Locale }) {
  const copy = copyFor(locale).privacy;

  return (
    <>
      <section className="bg-night text-white">
        <div className="nx-container grid items-center gap-12 py-16 sm:py-20 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:py-24">
          <div>
            <Kicker tone="dark">{copy.kicker}</Kicker>
            <h1 className="mt-6 text-display-xl font-semibold">
              {copy.heading.lead}
              <GradientText>{copy.heading.accent}</GradientText>
              {copy.heading.tail}
            </h1>
            <p className="mt-6 max-w-xl text-lead text-white/80">{copy.lead}</p>
          </div>
          <LaptopLock className="mx-auto w-full max-w-[16rem] lg:max-w-[18rem]" />
        </div>
      </section>

      <Section bg="white" labelledBy="layers">
        <Kicker>{copy.layers.kicker}</Kicker>
        <h2 id="layers" className="mt-5 max-w-xl text-display-m font-semibold">
          {copy.layers.heading}
        </h2>
        <p className="mt-5 max-w-2xl text-ink-soft">{copy.layers.lead}</p>
        <div className="mt-12 grid items-start gap-5 md:grid-cols-3">
          {copy.layers.items.map((layer, index) => {
            const style = LAYER_STYLE[index] ?? LAYER_STYLE[0];
            return (
              <div key={layer.title} className={cn(cardClass(true), "h-full p-6")}>
                <IconChip icon={style.icon} />
                <span
                  className={cn(
                    "mt-5 inline-block rounded-full px-3 py-0.5 text-xs font-bold",
                    style.tone === "blue"
                      ? "bg-brand-soft text-brand"
                      : "bg-violet-soft text-[#7a3fb8]",
                  )}
                >
                  {layer.badge}
                </span>
                <h3 className="mt-3 text-xl font-semibold">{layer.title}</h3>
                <div className="mt-4 text-[0.95rem] text-ink-muted">
                  <p className="font-bold text-ink">{layer.lead}</p>
                  <p className="mt-3">{layer.body}</p>
                  <Bullets className="mt-5" items={layer.points} />
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      <Section bg="page" labelledBy="what-leaves">
        <h2 id="what-leaves" className="text-display-m font-semibold">
          {copy.flows.heading}
        </h2>
        <div className="mt-10 overflow-x-auto rounded-2xl border border-line bg-white">
          <table className="w-full min-w-[40rem] border-collapse text-left text-[0.95rem]">
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className="w-[16%] px-5 py-4 font-bold">
                  {copy.flows.columnSituation}
                </th>
                <th scope="col" className="px-5 py-4 font-bold">
                  {copy.flows.columnSent}
                </th>
                <th scope="col" className="w-[32%] px-5 py-4 font-bold">
                  {copy.flows.columnControl}
                </th>
              </tr>
            </thead>
            <tbody>
              {copy.flows.rows.map((flow) => (
                <tr key={flow.situation} className="border-b border-line last:border-b-0">
                  <th scope="row" className="px-5 py-5 align-top font-bold">
                    {flow.situation}
                    {flow.situationNote ? (
                      <span className="block text-xs font-normal text-ink-muted">
                        {flow.situationNote}
                      </span>
                    ) : null}
                  </th>
                  <td className="px-5 py-5 align-top text-ink-soft">{flow.sent}</td>
                  <td className="px-5 py-5 align-top text-ink-soft">{flow.control}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-6 text-sm text-ink-muted">
          {copy.flows.policyNoteLead}{" "}
          <TextLink to={pagePath("privacyPolicy", locale)} className="text-sm">
            {copy.flows.policyNoteLink}
          </TextLink>
          .
        </p>
      </Section>

      <Section bg="white">
        <div className="grid gap-14 md:grid-cols-2 md:gap-12">
          <div>
            <Kicker>{copy.noLogins.kicker}</Kicker>
            <h2 className="mt-5 text-display-s font-semibold">{copy.noLogins.heading}</h2>
            <p className="mt-5 text-ink-soft">{copy.noLogins.body}</p>
          </div>
          <div>
            <Kicker>{copy.openSource.kicker}</Kicker>
            <h2 className="mt-5 text-display-s font-semibold">{copy.openSource.heading}</h2>
            <p className="mt-5 text-ink-soft">{copy.openSource.body}</p>
            <TextAnchor href={GITHUB_URL} className="mt-6 inline-block">
              {copy.openSource.link}
            </TextAnchor>
          </div>
        </div>
      </Section>

      <ClosingBand heading={copy.closing.heading}>
        <ButtonLink to={pagePath("download", locale)}>{copy.closing.cta}</ButtonLink>
      </ClosingBand>
    </>
  );
}
