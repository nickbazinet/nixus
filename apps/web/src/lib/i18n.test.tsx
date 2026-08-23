import { render, screen } from "@testing-library/react";
import { I18nextProvider, useTranslation } from "react-i18next";
import { afterEach, describe, expect, it } from "vitest";

import en from "@/locales/en.json";
import fr from "@/locales/fr.json";

import i18next, { applyRouteLocale, i18nForLocale } from "./i18n";

const COPY = { en: en.skipToMain, fr: fr.skipToMain } as const;

function ShellCopy() {
  const { t } = useTranslation();
  return <span data-testid="shell-copy">{t("skipToMain")}</span>;
}

function renderUnderLocale(locale: "en" | "fr") {
  return render(
    <I18nextProvider i18n={i18nForLocale(locale)}>
      <ShellCopy />
    </I18nextProvider>,
  );
}

afterEach(async () => {
  await applyRouteLocale("en");
});

describe("i18nForLocale", () => {
  it("resolves copy in its own locale without awaiting a language change", () => {
    expect(i18nForLocale("en").t("skipToMain")).toBe(COPY.en);
    expect(i18nForLocale("fr").t("skipToMain")).toBe(COPY.fr);
  });

  it("returns a stable instance per locale", () => {
    expect(i18nForLocale("fr")).toBe(i18nForLocale("fr"));
    expect(i18nForLocale("en")).not.toBe(i18nForLocale("fr"));
  });

  it("renders English copy after the singleton was switched to French", async () => {
    // Reproduces the prerender defect: a French page had already moved the
    // shared singleton to "fr", so the next English page rendered in French.
    await applyRouteLocale("fr");

    renderUnderLocale("en");

    expect(screen.getByTestId("shell-copy")).toHaveTextContent(COPY.en);
  });

  it("renders French copy after the singleton was switched to English", async () => {
    await applyRouteLocale("en");

    renderUnderLocale("fr");

    expect(screen.getByTestId("shell-copy")).toHaveTextContent(COPY.fr);
  });

  it("keeps a pinned instance on its own locale when the singleton moves", async () => {
    const frenchInstance = i18nForLocale("fr");

    await applyRouteLocale("en");

    expect(frenchInstance.language).toBe("fr");
    expect(frenchInstance.t("skipToMain")).toBe(COPY.fr);
  });
});

describe("applyRouteLocale", () => {
  it("moves the shared singleton onto the route's locale in both directions", async () => {
    await applyRouteLocale("fr");
    expect(i18next.language).toBe("fr");

    await applyRouteLocale("en");
    expect(i18next.language).toBe("en");
  });
});
