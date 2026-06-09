import type { Locale } from "@/lib/meta";

/** Return the locale-aware path prefix for marketing routes. */
export function localePrefix(locale: Locale): string {
  return locale === "fr" ? "/fr" : "";
}

/** Beta program page path for the given locale. */
export function betaPagePath(locale: Locale): string {
  return locale === "fr" ? "/fr/beta" : "/beta";
}

/** Home path for the given locale. */
export function homePath(locale: Locale): string {
  return locale === "fr" ? "/fr/" : "/";
}

/** Resolve locale from i18n language tag. */
export function localeFromLanguage(language: string | undefined): Locale {
  return language?.startsWith("fr") ? "fr" : "en";
}
