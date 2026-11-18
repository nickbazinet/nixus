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

/** A refusal the profile API attributed to one field (AD-5, AD-12). */
export interface FieldRefusal {
  readonly field: string;
  readonly text: string;
}

export interface ProfileFormProps {
  readonly initial: ProfileFields;
  readonly countries: readonly LocationOption[];
  readonly subdivisions: readonly LocationOption[];
  readonly busy: boolean;
  readonly refusal: FieldRefusal | null;
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

/**
 * The profile fields, in the desktop app's order and grouping: the two names,
 * the date of birth, the income pair as one group, then the two location
 * controls. One column at every width, like `apps/desktop`'s own form — a
 * two-column grid is what made this page read as a different product.
 */
export function ProfileForm({
  initial,
  countries,
  subdivisions,
  busy,
  refusal,
  onCountryChange,
  onSave,
}: ProfileFormProps) {
  const { t } = useTranslation();
  const prefix = useId();
  const [draft, setDraft] = useState<Draft>(() => toDraft(initial));

  const id = (name: keyof Draft): string => `${prefix}-${name}`;
  const set = (name: keyof Draft, value: string): void =>
    setDraft((previous) => ({ ...previous, [name]: value }));

  /** The refusal names at most one field, so at most one control is invalid. */
  const errorFor = (name: keyof Draft): string | null =>
    refusal !== null && refusal.field === name ? refusal.text : null;

  /** Keeps `aria-invalid` and `aria-describedby` from drifting apart. */
  const invalid = (name: keyof Draft) =>
    errorFor(name) === null
      ? {}
      : { "aria-invalid": true, "aria-describedby": `${id(name)}-error` };

  const subdivisionHint =
    draft.country_code === ""
      ? t("reason.requires_country")
      : subdivisions.length === 0
        ? t("profile.noSubdivisions")
        : null;

  return (
    <form
      data-testid="profile-form"
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(toFields(draft));
      }}
    >
      <Field
        label={t("profile.firstName")}
        htmlFor={id("first_name")}
        error={errorFor("first_name")}
      >
        <Input
          id={id("first_name")}
          name="first_name"
          autoComplete="given-name"
          className="mkt-tap"
          value={draft.first_name}
          onChange={(event) => set("first_name", event.target.value)}
          {...invalid("first_name")}
        />
      </Field>

      <Field
        label={t("profile.lastName")}
        htmlFor={id("last_name")}
        error={errorFor("last_name")}
      >
        <Input
          id={id("last_name")}
          name="last_name"
          autoComplete="family-name"
          className="mkt-tap"
          value={draft.last_name}
          onChange={(event) => set("last_name", event.target.value)}
          {...invalid("last_name")}
        />
      </Field>

      <Field
        label={t("profile.birthDate")}
        htmlFor={id("birth_date")}
        error={errorFor("birth_date")}
      >
        {/* A native date input rather than the shared `DatePicker`: that one is
            portal-based and client-only, and this page is server-rendered. The
            surface is the shared `Input`, so the two read the same. */}
        <Input
          id={id("birth_date")}
          name="birth_date"
          type="date"
          className="mkt-tap"
          value={draft.birth_date}
          onChange={(event) => set("birth_date", event.target.value)}
          {...invalid("birth_date")}
        />
      </Field>

      {/* Both selects adjacent, as one group: a currency without a bracket is a
          permitted, inert state, so gating one on the other would make it
          unreachable. */}
      <div className="space-y-3" data-testid="profile-income">
        <Field
          label={t("profile.incomeBracket")}
          htmlFor={id("income_bracket")}
          error={errorFor("income_bracket")}
        >
          <NativeSelect
            id={id("income_bracket")}
            name="income_bracket"
            value={draft.income_bracket}
            onChange={(event) => set("income_bracket", event.target.value)}
            {...invalid("income_bracket")}
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
          error={errorFor("income_bracket_currency")}
        >
          <NativeSelect
            id={id("income_bracket_currency")}
            name="income_bracket_currency"
            value={draft.income_bracket_currency}
            onChange={(event) => set("income_bracket_currency", event.target.value)}
            {...invalid("income_bracket_currency")}
          >
            <option value="">{t("profile.unset")}</option>
            {INCOME_BRACKET_CURRENCIES.map((currency) => (
              <option key={currency} value={currency}>
                {currency}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>

      <Field
        label={t("profile.country")}
        htmlFor={id("country_code")}
        error={errorFor("country_code")}
      >
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
          {...invalid("country_code")}
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
        hint={subdivisionHint}
        error={errorFor("subdivision_code")}
      >
        <NativeSelect
          id={id("subdivision_code")}
          name="subdivision_code"
          disabled={subdivisions.length === 0}
          value={draft.subdivision_code}
          onChange={(event) => set("subdivision_code", event.target.value)}
          {...invalid("subdivision_code")}
        >
          <option value="">{t("profile.unset")}</option>
          {subdivisions.map((subdivision) => (
            <option key={subdivision.code} value={subdivision.code}>
              {subdivision.name}
            </option>
          ))}
        </NativeSelect>
      </Field>

      <Button type="submit" size="sm" className="mkt-tap" disabled={busy} data-testid="profile-save">
        {busy ? t("profile.saving") : t("profile.save")}
      </Button>
    </form>
  );
}
