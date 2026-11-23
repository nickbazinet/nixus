import { House, Monitor, Sparkles } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

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
import { cn } from "@/lib/cn";
import { GITHUB_URL } from "@/lib/links";

const LAYERS: ReadonlyArray<{
  icon: LucideIcon;
  badge: string;
  badgeTone: "blue" | "violet";
  title: string;
  body: ReactNode;
}> = [
  {
    icon: Monitor,
    badge: "Always on",
    badgeTone: "blue",
    title: "On your computer",
    body: (
      <>
        <p className="font-bold text-ink">Saved on your computer, not on our servers.</p>
        <p className="mt-3">
          Your transactions, budgets and accounts live in a file on your own computer, a bit like a
          document. Nothing is sent to us, so there is no account to create.
        </p>
        <Bullets
          className="mt-5"
          items={[
            "No one else holds your financial data",
            "Nothing to leak from a company database",
            "You keep it, and you can delete it any time",
          ]}
        />
      </>
    ),
  },
  {
    icon: House,
    badge: "Opt-in · Classic",
    badgeTone: "blue",
    title: "Cloud sync",
    body: (
      <>
        <p className="font-bold text-ink">Protected, and only yours.</p>
        <p className="mt-3">
          If you turn it on, a copy of your records is kept on secure servers, in a space that belongs
          only to your account. Nixus does not read your records.
        </p>
        <Bullets
          className="mt-5"
          items={[
            "Encrypted while it travels and while it is stored",
            "Off until you turn it on",
            "Your AI credentials are never uploaded",
            "Deletion on request, by email",
          ]}
        />
      </>
    ),
  },
  {
    icon: Sparkles,
    badge: "Opt-in · Advance",
    badgeTone: "violet",
    title: "AI requests",
    body: (
      <>
        <p className="font-bold text-ink">Only what you ask, only when you ask.</p>
        <p className="mt-3">
          Nothing is sent until you import a statement or ask the assistant something. Nixus does not
          keep it.
        </p>
        <Bullets
          className="mt-5"
          items={[
            "Your statement stays private",
            "Never used or shared by the AI service",
            "Prefer to skip our servers? Use your own AI provider",
          ]}
        />
      </>
    ),
  },
];

const FLOWS: ReadonlyArray<{
  situation: ReactNode;
  sent: string;
  control: string;
}> = [
  {
    situation: (
      <>
        On your computer
        <span className="block text-xs font-normal text-ink-muted">your Nixus profile</span>
      </>
    ),
    sent: "Nothing.",
    control: "No account, nothing to turn off.",
  },
  {
    situation: "Your bank",
    sent: "Nothing from your bank. Nixus never asks for your bank login. You import statements yourself, and when AI reads one, that statement is sent as an AI request (below).",
    control: "You choose which statements to import, and you can delete them any time.",
  },
  {
    situation: "Cloud sync",
    sent: "An encrypted copy of your records: budgets, transactions, accounts and net worth history. Kept on secure servers.",
    control: "Off until you turn it on. Turning it off stops transfers, and you can ask us by email to delete the stored copy.",
  },
  {
    situation: "Nixus Cloud account",
    sent: "Your profile: name, date of birth, income bracket, location and an optional picture. Kept on secure servers in the United States.",
    control: "Only with a Nixus Cloud account. A local-only profile never uploads it. Ask us by email to delete it.",
  },
  {
    situation: "AI requests",
    sent: "Only the one request you make, such as a statement or a question. It is kept private, and Nixus does not store it, only how many requests you have made.",
    control: "Only when you start a request. Use your own AI provider and it goes straight there, never through Nixus.",
  },
];

export function PrivacyPage() {
  return (
    <>
      <section className="bg-night text-white">
        <div className="nx-container grid items-center gap-12 py-16 sm:py-20 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:py-24">
          <div>
            <Kicker tone="dark">Privacy</Kicker>
            <h1 className="mt-6 text-display-xl font-semibold">
              Your data stays <GradientText>where you put it</GradientText>.
            </h1>
            <p className="mt-6 max-w-xl text-lead text-white/80">
              No bank logins. Your records live on your computer. Cloud features reach beyond it,
              and they are off until you turn them on.
            </p>
          </div>
          <LaptopLock className="mx-auto w-full max-w-[16rem] lg:max-w-[18rem]" />
        </div>
      </section>

      <Section bg="white" labelledBy="layers">
        <Kicker>Three layers</Kicker>
        <h2 id="layers" className="mt-5 max-w-xl text-display-m font-semibold">
          What stays, and what can leave
        </h2>
        <p className="mt-5 max-w-2xl text-ink-soft">
          Most of Nixus runs on your own computer, not on ours, and anything that goes further is
          optional.
        </p>
        <div className="mt-12 grid items-start gap-5 md:grid-cols-3">
          {LAYERS.map((layer) => (
            <div key={layer.title} className={cn(cardClass(true), "h-full p-6")}>
              <IconChip icon={layer.icon} />
              <span
                className={cn(
                  "mt-5 inline-block rounded-full px-3 py-0.5 text-xs font-bold",
                  layer.badgeTone === "blue"
                    ? "bg-brand-soft text-brand"
                    : "bg-violet-soft text-[#7a3fb8]",
                )}
              >
                {layer.badge}
              </span>
              <h3 className="mt-3 text-xl font-semibold">{layer.title}</h3>
              <div className="mt-4 text-[0.95rem] text-ink-muted">{layer.body}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section bg="page" labelledBy="what-leaves">
        <h2 id="what-leaves" className="text-display-m font-semibold">
          Exactly what leaves your computer
        </h2>
        <div className="mt-10 overflow-x-auto rounded-2xl border border-line bg-white">
          <table className="w-full min-w-[40rem] border-collapse text-left text-[0.95rem]">
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className="w-[16%] px-5 py-4 font-bold">
                  Situation
                </th>
                <th scope="col" className="px-5 py-4 font-bold">
                  What is sent
                </th>
                <th scope="col" className="w-[32%] px-5 py-4 font-bold">
                  Your control
                </th>
              </tr>
            </thead>
            <tbody>
              {FLOWS.map((flow, index) => (
                <tr key={index} className="border-b border-line last:border-b-0">
                  <th scope="row" className="px-5 py-5 align-top font-bold">
                    {flow.situation}
                  </th>
                  <td className="px-5 py-5 align-top text-ink-soft">{flow.sent}</td>
                  <td className="px-5 py-5 align-top text-ink-soft">{flow.control}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-6 text-sm text-ink-muted">
          The full legal text is in our{" "}
          <TextLink to="/privacy-policy" className="text-sm">
            privacy policy
          </TextLink>
          .
        </p>
      </Section>

      <Section bg="white">
        <div className="grid gap-14 md:grid-cols-2 md:gap-12">
          <div>
            <Kicker>No bank logins</Kicker>
            <h2 className="mt-5 text-display-s font-semibold">
              Why you upload statements instead
            </h2>
            <p className="mt-5 text-ink-soft">
              Connecting a bank means handing over your credentials, or trusting a third party with
              them. Uploading a statement gives Nixus only what it needs, and keeps the rest of your
              banking out of it.
            </p>
          </div>
          <div>
            <Kicker>Open source</Kicker>
            <h2 className="mt-5 text-display-s font-semibold">
              Read the code, not just the promise
            </h2>
            <p className="mt-5 text-ink-soft">
              Nixus is open source, so anyone can check what it does with your data.
            </p>
            <TextAnchor href={GITHUB_URL} className="mt-6 inline-block">
              View the source on GitHub
            </TextAnchor>
          </div>
        </div>
      </Section>

      <ClosingBand heading="Try it with nothing leaving your computer">
        <ButtonLink to="/download">Download Nixus</ButtonLink>
      </ClosingBand>
    </>
  );
}
