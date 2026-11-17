import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  INCOME_BRACKETS,
  INCOME_BRACKET_CURRENCIES,
  type ProfileFields,
} from "@nixus/shared";
import { Button, Input } from "@nixus/shared";

import { Field, NativeSelect } from "./NativeSelect";

export interface LocationOption {
  readonly code: string;
  readonly name: string;
}

export interface ProfileFormProps {
  readonly initial: ProfileFields;
  readonly countries: readonly LocationOption[];
  readonly subdivisions: readonly LocationOption[];
  readonly busy: boolean;
  readonly onCountryChange: (country: string | null) => void;
  readonly onSave: (fields: ProfileFields) => void;
}

type Draft = { [K in keyof ProfileFields]: string };

function toDraft(fields: ProfileFields): Draft {
  return {
    first_name: fields.first_name ?? "",
    last_name: fields.last_name ?? "",
    birth_date: fields.birth_date ?? "",
    income_bracket: fields.income_bracket ?? "",
    income_bracket_currency: fields.income_bracket_currency ?? "",
    country_code: fields.country_code ?? "",
    subdivision_code: fields.subdivision_code ?? "",
  };
}

function toFields(draft: Draft): ProfileFields {
  const blankToNull = (value: string): string | null => (value.trim() === "" ? null : value.trim());
  return {
    first_name: blankToNull(draft.first_name),
    last_name: blankToNull(draft.last_name),
    birth_date: blankToNull(draft.birth_date),
    income_bracket: blankToNull(draft.income_bracket),
    income_bracket_currency: blankToNull(draft.income_bracket_currency),
    country_code: blankToNull(draft.country_code),
    subdivision_code: blankToNull(draft.subdivision_code),
  } as ProfileFields;
}

export function ProfileForm({
  initial,
  countries,
  subdivisions,
  busy,
  onCountryChange,
  onSave,
}: ProfileFormProps) {
  const { t } = useTranslation();
  const prefix = useId();
  const [draft, setDraft] = useState<Draft>(() => toDraft(initial));

  const id = (name: keyof Draft): string => `${prefix}-${name}`;
  const set = (name: keyof Draft, value: string): void =>
    setDraft((previous) => ({ ...previous, [name]: value }));

  return (
    <form
      data-testid="profile-form"
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(toFields(draft));
      }}
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={t("profile.firstName")} htmlFor={id("first_name")}>
          <Input
            id={id("first_name")}
            name="first_name"
            autoComplete="given-name"
            value={draft.first_name}
            onChange={(event) => set("first_name", event.target.value)}
          />
        </Field>

        <Field label={t("profile.lastName")} htmlFor={id("last_name")}>
          <Input
            id={id("last_name")}
            name="last_name"
            autoComplete="family-name"
            value={draft.last_name}
            onChange={(event) => set("last_name", event.target.value)}
          />
        </Field>

        <Field label={t("profile.birthDate")} htmlFor={id("birth_date")}>
          <Input
            id={id("birth_date")}
            name="birth_date"
            type="date"
            value={draft.birth_date}
            onChange={(event) => set("birth_date", event.target.value)}
          />
        </Field>

        <Field label={t("profile.incomeBracket")} htmlFor={id("income_bracket")}>
          <NativeSelect
            id={id("income_bracket")}
            name="income_bracket"
            value={draft.income_bracket}
            onChange={(event) => set("income_bracket", event.target.value)}
          >
            <option value="">{t("profile.unset")}</option>
            {INCOME_BRACKETS.map((bracket) => (
              <option key={bracket} value={bracket}>
                {t(`bracket.${bracket}`)}
              </option>
            ))}
          </NativeSelect>
        </Field>

        <Field
          label={t("profile.incomeBracketCurrency")}
          htmlFor={id("income_bracket_currency")}
        >
          <NativeSelect
            id={id("income_bracket_currency")}
            name="income_bracket_currency"
            value={draft.income_bracket_currency}
            onChange={(event) => set("income_bracket_currency", event.target.value)}
          >
            <option value="">{t("profile.unset")}</option>
            {INCOME_BRACKET_CURRENCIES.map((currency) => (
              <option key={currency} value={currency}>
                {currency}
              </option>
            ))}
          </NativeSelect>
        </Field>

        <Field label={t("profile.country")} htmlFor={id("country_code")}>
          <NativeSelect
            id={id("country_code")}
            name="country_code"
            value={draft.country_code}
            onChange={(event) => {
              const country = event.target.value;
              // A subdivision only means anything inside its own country, so the
              // stale one is dropped at the same moment the list is refetched.
              setDraft((previous) => ({
                ...previous,
                country_code: country,
                subdivision_code: "",
              }));
              onCountryChange(country === "" ? null : country);
            }}
          >
            <option value="">{t("profile.unset")}</option>
            {countries.map((country) => (
              <option key={country.code} value={country.code}>
                {country.name}
              </option>
            ))}
          </NativeSelect>
        </Field>

        <Field
          label={t("profile.subdivision")}
          htmlFor={id("subdivision_code")}
          hint={
            draft.country_code !== "" && subdivisions.length === 0
              ? t("profile.noSubdivisions")
              : null
          }
        >
          <NativeSelect
            id={id("subdivision_code")}
            name="subdivision_code"
            disabled={subdivisions.length === 0}
            value={draft.subdivision_code}
            onChange={(event) => set("subdivision_code", event.target.value)}
          >
            <option value="">{t("profile.unset")}</option>
            {subdivisions.map((subdivision) => (
              <option key={subdivision.code} value={subdivision.code}>
                {subdivision.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>

      <div>
        <Button type="submit" disabled={busy} data-testid="profile-save">
          {busy ? t("profile.saving") : t("profile.save")}
        </Button>
      </div>
    </form>
  );
}
