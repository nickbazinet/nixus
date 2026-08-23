import i18next, { type i18n as I18nInstance } from "i18next";
import { initReactI18next } from "react-i18next";

import en from "@/locales/en.json";
import fr from "@/locales/fr.json";
import { localeFromPath } from "@/lib/localePaths";
import type { Locale } from "@/lib/site";

// URL is the source of truth for locale on the marketing site: `/` is EN,
// anything under `/fr` is FR. Picking the initial language from the path
// (instead of localStorage) keeps the singleton's language aligned with the
// prerendered HTML the browser already painted, so React hydrates without a
// flash back to the default locale.
function detectInitialLanguage(): Locale {
  if (typeof window === "undefined") return "en";
  return localeFromPath(window.location.pathname);
}

i18next.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    fr: { translation: fr },
  },
  lng: detectInitialLanguage(),
  fallbackLng: "en",
  load: "languageOnly",
  interpolation: {
    escapeValue: false,
  },
});

// Locale-pinned clones of the singleton, created on first use.
//
// The build prerenders every route through this one module with a concurrency
// pool, so a render that reads the singleton's mutable `language` can pick up
// a sibling page's locale — that is how an English page ends up serving French
// HTML. A clone's language never changes, so the rendered tree depends only on
// the route. `initAsync: false` keeps creation synchronous; the resources are
// already in memory, there is no backend to await.
const pinnedInstances = new Map<Locale, I18nInstance>();

/** i18next instance permanently fixed to `locale`. Safe to render with. */
export function i18nForLocale(locale: Locale): I18nInstance {
  const cached = pinnedInstances.get(locale);
  if (cached) return cached;
  const pinned = i18next.cloneInstance({ lng: locale, initAsync: false });
  pinnedInstances.set(locale, pinned);
  return pinned;
}

/**
 * Align the shared singleton with the route being entered.
 *
 * Routes render through one shared instance, so a route that only switches the
 * language *into* its own locale leaks that locale into whichever route runs
 * next. Every route declares its own locale instead of assuming a default.
 */
export async function applyRouteLocale(locale: Locale): Promise<void> {
  if (i18next.language === locale) return;
  await i18next.changeLanguage(locale);
}

export default i18next;
