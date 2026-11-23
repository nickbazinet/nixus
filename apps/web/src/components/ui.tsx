import { Link, type LinkProps } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

/* Shared building blocks for every marketing page. */

export type InternalPath = NonNullable<LinkProps["to"]>;

type Tone = "light" | "dark";

export function Kicker({
  children,
  tone = "light",
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "flex items-center gap-3 text-xs font-bold uppercase tracking-[0.14em]",
        tone === "dark" ? "text-[#9aa8ff]" : "text-brand",
        className,
      )}
    >
      <span aria-hidden="true" className="nx-gradient-pill h-1.5 w-7 flex-none rounded-full" />
      {children}
    </p>
  );
}

export function GradientText({ children }: { children: ReactNode }) {
  return <span className="nx-gradient-text">{children}</span>;
}

export function Bullets({
  items,
  tone = "light",
  marker = "minus",
  className,
  itemClassName,
}: {
  items: readonly ReactNode[];
  tone?: Tone;
  marker?: "minus" | "plus";
  className?: string;
  itemClassName?: string;
}) {
  return (
    <ul className={cn("space-y-2.5", className)}>
      {items.map((item, index) => (
        <li
          key={index}
          className={cn(
            "flex items-start gap-3",
            tone === "dark" ? "text-white/80" : "text-ink-soft",
            itemClassName,
          )}
        >
          {marker === "plus" ? (
            <span aria-hidden="true" className="relative mt-[0.5em] size-4 flex-none">
              <span className="nx-gradient-pill absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full" />
              <span className="absolute inset-y-0 left-1/2 w-1.5 -translate-x-1/2 rounded-full bg-gradient-to-b from-[#c756b9] to-[#8a63e0]" />
            </span>
          ) : (
            <span
              aria-hidden="true"
              className="nx-gradient-pill mt-[0.6em] h-1.5 w-4 flex-none rounded-full"
            />
          )}
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export type ButtonVariant = "primary" | "dark" | "outline" | "light";
type ButtonSize = "md" | "lg";

export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md") {
  return cn(
    "nx-focus inline-flex items-center justify-center gap-2 rounded-full font-bold whitespace-nowrap transition-[filter,background-color,transform] duration-150 active:translate-y-px",
    size === "lg" ? "min-h-14 px-8 text-base" : "min-h-11 px-6 text-[0.95rem]",
    variant === "primary" && "nx-gradient-bg text-white shadow-[0_8px_20px_-10px_rgba(110,80,210,0.7)] hover:brightness-110",
    variant === "dark" && "bg-night text-white hover:bg-[#24244a]",
    variant === "outline" && "border border-ink/80 bg-white text-ink hover:bg-tint",
    variant === "light" && "bg-[#dcdce8] text-ink hover:bg-white",
  );
}

type ButtonCommon = {
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
};

export function ButtonLink({
  to,
  hash,
  children,
  variant,
  size,
  className,
}: ButtonCommon & { to: InternalPath; hash?: string }) {
  return (
    <Link to={to} hash={hash} className={cn(buttonClass(variant, size), className)}>
      {children}
    </Link>
  );
}

export function ButtonAnchor({
  href,
  children,
  variant,
  size,
  className,
}: ButtonCommon & { href: string }) {
  return (
    <a href={href} className={cn(buttonClass(variant, size), className)}>
      {children}
    </a>
  );
}

const textLinkClass =
  "nx-focus rounded-sm font-bold text-brand underline decoration-2 underline-offset-[6px] decoration-brand/40 hover:decoration-brand";

export function TextLink({
  to,
  hash,
  children,
  className,
}: {
  to: InternalPath;
  hash?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link to={to} hash={hash} className={cn(textLinkClass, className)}>
      {children}
    </Link>
  );
}

export function TextAnchor({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <a href={href} className={cn(textLinkClass, className)}>
      {children}
    </a>
  );
}

export function IconChip({ icon: Icon, className }: { icon: LucideIcon; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid size-10 place-items-center rounded-xl border border-[#e3e6fb] bg-[#eef1fe]",
        className,
      )}
    >
      <Icon className="nx-icon-gradient size-5" strokeWidth={1.75} />
    </span>
  );
}

type SectionBg = "page" | "white" | "night" | "glass";

const SECTION_BG: Record<SectionBg, string> = {
  page: "bg-page",
  white: "bg-white",
  night: "bg-night text-white",
  glass: "bg-glass",
};

export function Section({
  bg = "page",
  children,
  className,
  containerClassName,
  id,
  labelledBy,
}: {
  bg?: SectionBg;
  children: ReactNode;
  className?: string;
  containerClassName?: string;
  id?: string;
  labelledBy?: string;
}) {
  return (
    <section
      id={id}
      aria-labelledby={labelledBy}
      className={cn("nx-section scroll-mt-20", SECTION_BG[bg], className)}
    >
      <div className={cn("nx-container", containerClassName)}>{children}</div>
    </section>
  );
}

/** White card with a hairline border. `tinted` is the soft fill used on white bands. */
export function cardClass(tinted = false) {
  return cn(
    "rounded-2xl border border-line",
    tinted ? "bg-tint" : "bg-white",
  );
}

export function NumberBadge({ n }: { n: number }) {
  return (
    <span
      aria-hidden="true"
      className="nx-gradient-card grid size-8 place-items-center rounded-full font-display text-sm font-semibold text-white"
    >
      {n}
    </span>
  );
}

/** Centred dark closing band with a headline and one action. */
export function ClosingBand({
  heading,
  body,
  children,
}: {
  heading: ReactNode;
  body?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="nx-section bg-night text-white">
      <div className="nx-container flex flex-col items-center text-center">
        <h2 className="text-display-m font-semibold">{heading}</h2>
        {body ? <p className="mt-5 max-w-xl text-lead text-white/75">{body}</p> : null}
        <div className="mt-8">{children}</div>
      </div>
    </section>
  );
}
