/**
 * Terms of Service and Privacy Policy, by locale.
 *
 * The documents themselves live in the copy dictionary (`legal.en.ts` /
 * `legal.fr.ts`) so that `SiteCopy` forces the French versions to exist; this
 * module is the accessor the two legal routes read.
 */

import { copyFor } from "@/content/index";
import type { LegalDocument } from "@/content/types";
import type { Locale } from "@/lib/locale";

export type { LegalDocument, LegalSection } from "@/content/types";

export function termsFor(locale: Locale): LegalDocument {
  return copyFor(locale).legal.terms;
}

export function privacyPolicyFor(locale: Locale): LegalDocument {
  return copyFor(locale).legal.privacyPolicy;
}
