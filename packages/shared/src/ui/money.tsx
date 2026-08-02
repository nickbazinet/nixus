import * as React from "react"

import { cn } from "../lib/cn"

type MoneySign = "auto" | "never" | "always"

interface FormatMoneyOptions {
  cents: number
  /** ISO code only. CAD and USD coexist unconverted — there is no FX anywhere in this product. */
  currency?: string
  locale?: string
  /** `never` renders the absolute value: a liability always shows as a positive amount owed. */
  sign?: MoneySign
  showCurrencyCode?: boolean
}

// Amounts are stored as integer cents and formatted only here, at the render edge. Signing lives in
// this one function so the future unified Transactions view (income and expenses in one list) is a
// data change rather than a redesign.
//
// Liability balances pass `sign: "never"`: the internal sign convention is an implementation
// detail, and a mortgage rendered as -$284,000 reads as a loss rather than as what is owed.
function formatMoney({
  cents,
  currency = "CAD",
  locale,
  sign = "auto",
  showCurrencyCode = false,
}: FormatMoneyOptions): string {
  const signed = sign === "never" ? Math.abs(cents) : cents
  const formatted = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    signDisplay: sign === "always" ? "exceptZero" : "auto",
  }).format(signed / 100)
  return showCurrencyCode ? `${formatted} ${currency}` : formatted
}

interface MaskedFigureProps extends React.ComponentProps<"span"> {
  /** The real, formatted figure. Used for its shape only — it is never written to the DOM. */
  value: string
  /** Localized "Amount hidden". The masked element's entire accessible name. */
  label: string
}

// The mask has to hold in the accessible tree, not just on screen. A CSS blur or an overlay leaves
// the true amount readable by a screen reader — the exact opposite of the feature's purpose, and
// worst in the public-space scenario the toggle exists for. So the real value never reaches the
// DOM: only a localized label and bullets do.
//
// Each bullet is boxed to `1ch`, which with tabular figures is exactly one digit's advance, so the
// layout does not reflow when values are hidden and shown.
function MaskedFigure({
  value,
  label,
  className,
  ...props
}: MaskedFigureProps) {
  return (
    <span data-slot="masked-figure" className={cn("money", className)} {...props}>
      <span className="sr-only">{label}</span>
      <span aria-hidden="true">
        {Array.from(value, (char, index) =>
          /\d/.test(char) ? (
            <span
              key={index}
              className="inline-block w-[1ch] text-center align-baseline"
            >
              &bull;
            </span>
          ) : (
            <React.Fragment key={index}>{char}</React.Fragment>
          )
        )}
      </span>
    </span>
  )
}

interface MoneyProps
  extends Omit<React.ComponentProps<"span">, "children">,
    Omit<FormatMoneyOptions, "cents"> {
  cents: number
  masked?: boolean
  /** Localized "Amount hidden". Required whenever `masked` can become true. */
  maskedLabel?: string
}

function Money({
  cents,
  currency,
  locale,
  sign,
  showCurrencyCode,
  masked = false,
  maskedLabel = "Amount hidden",
  className,
  ...props
}: MoneyProps) {
  const formatted = formatMoney({
    cents,
    currency,
    locale,
    sign,
    showCurrencyCode,
  })

  if (masked) {
    return (
      <MaskedFigure
        value={formatted}
        label={maskedLabel}
        className={className}
        {...props}
      />
    )
  }

  return (
    <span data-slot="money" className={cn("money", className)} {...props}>
      {formatted}
    </span>
  )
}

export { Money, MaskedFigure, formatMoney }
export type { MoneyProps, MaskedFigureProps, FormatMoneyOptions, MoneySign }
