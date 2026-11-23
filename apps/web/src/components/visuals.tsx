import { ArrowRight, Sparkles, Target } from "lucide-react";
import { useId, type ReactNode } from "react";

import { cn } from "@/lib/cn";

/*
 * Illustrative stand-ins for product imagery. They carry demo values only and
 * are aria-hidden: each one sits next to prose that already says what it shows.
 * Swap any of them for a real capture without touching the surrounding page.
 */

/** The two brand glyphs: a minus pill and a plus made of two pills. */
export function MinusGlyph({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("nx-gradient-pill inline-block h-2.5 w-9 rounded-full", className)}
    />
  );
}

export function PlusGlyph({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" className={cn("relative inline-block size-9", className)}>
      <span className="nx-gradient-pill absolute inset-x-0 top-1/2 h-2.5 -translate-y-1/2 rounded-full" />
      <span className="absolute inset-y-0 left-1/2 w-2.5 -translate-x-1/2 rounded-full bg-gradient-to-b from-[#c756b9] to-[#8a63e0]" />
    </span>
  );
}

function Sparkline({ className, stroke = "white" }: { className?: string; stroke?: string }) {
  return (
    <svg viewBox="0 0 220 50" fill="none" className={className} aria-hidden="true">
      <path
        d="M2 38 C 22 30, 34 42, 54 34 S 86 18, 104 26 S 136 40, 156 24 S 192 8, 218 14"
        stroke={stroke}
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function HomeHeroVisual() {
  return (
    <div aria-hidden="true" className="relative mx-auto w-full max-w-[26rem] py-6 lg:mr-0">
      {/* Diagonal ribbon behind the cards. */}
      <div className="absolute -top-16 bottom-[-6rem] left-[48%] w-28 -skew-x-[14deg] rounded-[2rem] bg-gradient-to-b from-[#a45ad8] via-[#7d6ae6] to-[#4f80f0] opacity-90 sm:w-36" />

      <div className="relative space-y-4">
        <div className="nx-gradient-card rounded-2xl p-5 text-white shadow-[0_24px_40px_-20px_rgba(80,60,190,0.7)]">
          <div className="flex items-start justify-between">
            <p className="text-sm text-white/85">Spending this month</p>
            <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-bold">-6%</span>
          </div>
          <p className="mt-1 font-display text-3xl font-semibold">$3,480</p>
          <Sparkline className="mt-3 h-12 w-full" />
        </div>

        <div className="ml-auto w-[88%] rounded-2xl border border-line bg-white p-4 shadow-[0_20px_40px_-24px_rgba(20,20,43,0.35)]">
          <p className="text-sm font-bold text-ink">Breakdown</p>
          <div className="mt-3 flex items-center gap-5">
            <div
              className="relative size-16 flex-none rounded-full"
              style={{
                background:
                  "conic-gradient(#5e78ed 0 42%, #9978ed 42% 70%, #de50a4 70% 88%, #e8eeff 88% 100%)",
              }}
            >
              <div className="absolute inset-[9px] rounded-full bg-white" />
            </div>
            <ul className="flex-1 space-y-1.5 text-sm text-ink-soft">
              {[
                ["Housing", "#5e78ed", "42%"],
                ["Food", "#9978ed", "28%"],
                ["Transport", "#de50a4", "18%"],
              ].map(([label, color, pct]) => (
                <li key={label} className="flex items-center gap-2">
                  <span className="size-2 rounded-full" style={{ background: color }} />
                  <span className="flex-1">{label}</span>
                  <span className="font-bold text-ink">{pct}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="flex w-[92%] items-center gap-3 rounded-2xl border border-white/60 bg-white/80 p-3.5 shadow-[0_16px_36px_-24px_rgba(20,20,43,0.4)] backdrop-blur">
          <span className="grid size-9 flex-none place-items-center rounded-full bg-violet-soft">
            <Target className="nx-icon-gradient size-4.5" strokeWidth={2} />
          </span>
          <div className="flex-1 text-sm">
            <p className="font-bold text-ink">Quick reminder</p>
            <p className="text-ink-muted">You are at 68% of your goal.</p>
          </div>
          <span className="grid size-8 place-items-center rounded-full bg-white shadow-sm">
            <ArrowRight className="size-4 text-ink" />
          </span>
        </div>
      </div>
    </div>
  );
}

/** Glass-blue panel holding a white mock window, used by the feature rows. */
export function GlassPanel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div aria-hidden="true" className={cn("rounded-3xl bg-glass p-5 sm:p-8", className)}>
      <div className="rounded-2xl border border-white/70 bg-white/85 p-5 shadow-[0_18px_40px_-28px_rgba(20,40,80,0.45)] sm:p-6">
        {children}
      </div>
    </div>
  );
}

function SkeletonBar({ className }: { className?: string }) {
  return <span className={cn("block h-2.5 rounded-full bg-[#e4ebf4]", className)} />;
}

export function ImportMock() {
  return (
    <GlassPanel>
      <ul className="space-y-4">
        {[
          ["w-[46%]", "Groceries"],
          ["w-[38%]", "Dining out"],
          ["w-[52%]", "Transport"],
        ].map(([width, chip]) => (
          <li key={chip} className="flex items-center justify-between gap-4">
            <SkeletonBar className={width} />
            <span className="rounded-full bg-brand-soft px-3 py-1 text-xs font-bold text-brand">
              {chip}
            </span>
          </li>
        ))}
      </ul>
    </GlassPanel>
  );
}

export function NextActionsMock() {
  return (
    <GlassPanel>
      <ul className="space-y-5">
        {[Target, Sparkles].map((Icon, i) => (
          <li key={i} className="flex items-center gap-4">
            <span className="grid size-10 flex-none place-items-center rounded-full bg-violet-soft">
              <Icon className="nx-icon-gradient size-5" strokeWidth={1.75} />
            </span>
            <div className="flex-1 space-y-2">
              <SkeletonBar className={i === 0 ? "w-[62%]" : "w-[54%]"} />
              <SkeletonBar className={cn("h-2 bg-[#eef2f8]", i === 0 ? "w-[40%]" : "w-[34%]")} />
            </div>
          </li>
        ))}
      </ul>
    </GlassPanel>
  );
}

export function RegisteredAccountsMock() {
  return (
    <GlassPanel>
      <ul className="space-y-5">
        {[
          ["TFSA", "w-[72%]", "bg-gradient-to-r from-[#de50a4] to-[#c158c0]", "$46,100"],
          ["RRSP", "w-[58%]", "bg-gradient-to-r from-[#b165dc] to-[#9978ed]", "$37,100"],
          ["FHSA", "w-[30%]", "bg-gradient-to-r from-[#7d72ea] to-[#5e78ed]", "$19,200"],
        ].map(([label, width, fill, amount]) => (
          <li key={label}>
            <div className="flex items-center justify-between text-sm font-bold text-ink">
              <span>{label}</span>
              <span>{amount}</span>
            </div>
            <div className="mt-2 h-2 rounded-full bg-[#e8eef6]">
              <div className={cn("h-full rounded-full", width, fill)} />
            </div>
          </li>
        ))}
      </ul>
    </GlassPanel>
  );
}

export function NetWorthChartMock() {
  const gradientId = useId();
  return (
    <GlassPanel>
      <svg viewBox="0 0 320 130" className="h-auto w-full" fill="none">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#9978ed" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#9978ed" stopOpacity="0.08" />
          </linearGradient>
        </defs>
        <path
          d="M8 112 C 40 106, 60 104, 84 98 S 120 92, 140 86 S 170 76, 196 72 S 236 58, 258 48 S 296 28, 312 22 L 312 128 L 8 128 Z"
          fill={`url(#${gradientId})`}
        />
        <path
          d="M8 112 C 40 106, 60 104, 84 98 S 120 92, 140 86 S 170 76, 196 72 S 236 58, 258 48 S 296 28, 312 22"
          stroke="#6d5ce0"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      </svg>
    </GlassPanel>
  );
}

/** Line drawing of a laptop with a padlock, stroked pink to blue. */
export function LaptopLock({ className }: { className?: string }) {
  const gradientId = useId();
  return (
    <svg viewBox="0 0 240 170" fill="none" aria-hidden="true" className={className}>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="240" y2="170" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#de50a4" />
          <stop offset="55%" stopColor="#9978ed" />
          <stop offset="100%" stopColor="#5e78ed" />
        </linearGradient>
      </defs>
      <g stroke={`url(#${gradientId})`} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round">
        <rect x="42" y="12" width="156" height="104" rx="10" />
        <path d="M8 144 H232 L218 160 H22 Z" />
        <rect x="102" y="56" width="36" height="32" rx="6" />
        <path d="M108 56 V46 a12 12 0 0 1 24 0 V56" />
      </g>
    </svg>
  );
}

/** The big gradient plus on the Founding Users hero. */
export function PillDecoration({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn("relative size-72", className)}>
      <div className="absolute inset-y-0 left-1/2 w-20 -translate-x-1/2 rounded-full bg-gradient-to-b from-[#dc5aab] via-[#a679e6] to-[#6e86f0] shadow-[0_30px_60px_-30px_rgba(120,90,220,0.8)]" />
      <div className="absolute inset-x-0 top-1/2 h-20 -translate-y-1/2 rounded-full bg-gradient-to-r from-[#dc5aab] via-[#a679e6] to-[#6e86f0] shadow-[0_30px_60px_-30px_rgba(120,90,220,0.8)]" />
    </div>
  );
}
