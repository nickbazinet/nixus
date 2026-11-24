/**
 * The copy dictionary, keyed by locale.
 *
 * `satisfies Record<Locale, SiteCopy>` is the whole enforcement mechanism: a
 * string added to `en.ts` and forgotten in `fr.ts` fails `tsc`, and a locale
 * added to `LOCALES` without a dictionary fails here.
 */

import type { Locale } from "@/lib/locale";

import { EN } from "./en";
import { FR } from "./fr";
import type { SiteCopy } from "./types";

export const SITE_COPY = { en: EN, fr: FR } as const satisfies Record<Locale, SiteCopy>;

/** Every string for one language. The only way pages read copy. */
export function copyFor(locale: Locale): SiteCopy {
  return SITE_COPY[locale];
}

/**
 * Substitute `{name}` placeholders.
 *
 * The few strings that carry one are the ones whose value is resolved at
 * runtime — a live price, the contact mailbox, a plan's short name — so writing
 * the value into the copy would put it in two places at once.
 */
export function fill(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}

export type { SiteCopy } from "./types";
