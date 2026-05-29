import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import en from "@/locales/en.json";
import fr from "@/locales/fr.json";

// URL is the source of truth for locale on the marketing site: `/` is EN,
// anything under `/fr` is FR. Picking the initial language from the path
// (instead of localStorage) keeps the singleton's language aligned with the
// prerendered HTML the browser already painted, so React hydrates without a
// flash back to the default locale.
function detectInitialLanguage(): "en" | "fr" {
  if (typeof window === "undefined") return "en";
  return window.location.pathname.startsWith("/fr") ? "fr" : "en";
}

i18n.use(initReactI18next).init({
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

export default i18n;
