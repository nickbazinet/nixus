import i18next, { type i18n as I18nInstance } from "i18next";
import { initReactI18next } from "react-i18next";

import en from "@/locales/en.json";
import fr from "@/locales/fr.json";

/**
 * Locale handling, copied from `apps/web`'s pattern for the same reason.
 *
 * The URL is the only locale authority: `/` is EN, anything under `/fr` is FR.
 * SSR renders concurrent requests through one module, so a render that reads the
 * shared singleton's mutable `language` can pick up another request's locale —
 * which is how an English page serves French HTML. A clone pinned to one locale
 * cannot drift, so every route renders through `i18nForLocale(...)`.
 */

export type Locale = "en" | "fr";

const FR_ROUTE_PREFIX = /^\/fr(?=\/|$)/;

export function localeFromPath(pathname: string): Locale {
  return FR_ROUTE_PREFIX.test(pathname) ? "fr" : "en";
}

export function localePrefix(locale: Locale): string {
  return locale === "fr" ? "/fr" : "";
}

export function homePath(locale: Locale): string {
  return locale === "fr" ? "/fr" : "/";
}

export function profilePath(locale: Locale): string {
  return locale === "fr" ? "/fr/profile" : "/profile";
}

/** The destination KEY the login route accepts — never a path (AD-10). */
export function profileDestinationKey(locale: Locale): string {
  return locale === "fr" ? "profile-fr" : "profile";
}

export function otherLocale(locale: Locale): Locale {
  return locale === "fr" ? "en" : "fr";
}

i18next.use(initReactI18next).init({
  resources: { en: { translation: en }, fr: { translation: fr } },
  lng: "en",
  fallbackLng: "en",
  load: "languageOnly",
  interpolation: { escapeValue: false },
});

const pinned = new Map<Locale, I18nInstance>();

export function i18nForLocale(locale: Locale): I18nInstance {
  const cached = pinned.get(locale);
  if (cached) return cached;
  const instance = i18next.cloneInstance({ lng: locale, initAsync: false });
  pinned.set(locale, instance);
  return instance;
}

export default i18next;
