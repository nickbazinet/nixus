import { useEffect, useId, useMemo } from "react";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import {
  Button,
  DatePicker,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nixus/shared";
import { toast } from "sonner";
import {
  useCountries,
  useSaveUserProfile,
  useSubdivisions,
  useUserProfile,
} from "@/hooks/useProfile";

// Field names are the snake_case IPC parameter names, which is what lets an
// AppError::Validation { field } map straight onto setError with no translation
// table between naming conventions.
interface ProfileFormData {
  first_name: string;
  last_name: string;
  birth_date: string;
  income_bracket: string;
  income_bracket_currency: string;
  country_code: string;
  subdivision_code: string;
}

// Mirrors `VALID_INCOME_BRACKETS` in `src-tauri/src/profile_store.rs`, which is
// the validation authority: a code offered here that Rust does not allow-list is
// rejected on save rather than silently stored.
const INCOME_BRACKETS = [
  { value: "under_50k", labelKey: "profile.bracketUnder50k" },
  { value: "50k_99k", labelKey: "profile.bracket50k99k" },
  { value: "100k_149k", labelKey: "profile.bracket100k149k" },
  { value: "150k_249k", labelKey: "profile.bracket150k249k" },
  { value: "250k_plus", labelKey: "profile.bracket250kPlus" },
] as const;

// Mirrors `VALID_INCOME_BRACKET_CURRENCIES` in `profile_store.rs`. ISO 4217 codes
// are language-neutral tokens, so each renders verbatim in both locales and none
// of them carries an i18n key.
const INCOME_BRACKET_CURRENCIES = [
  "CAD",
  "USD",
  "EUR",
  "GBP",
  "AUD",
  "CHF",
  "JPY",
  "CNY",
  "INR",
  "MXN",
  "BRL",
  "SEK",
  "NOK",
  "DKK",
  "NZD",
  "SGD",
  "HKD",
  "ZAR",
  "KRW",
  "PLN",
] as const;

interface InvokeError {
  type?: string;
  message?: string;
  field?: string;
}

function readError(err: unknown): { type: string; message: string; field?: string } {
  const e = err as InvokeError;
  const message =
    e?.message ?? (typeof err === "string" ? err : JSON.stringify(err, null, 2));
  return {
    type: e?.type ?? "unknown",
    message: message ?? "An unexpected error occurred",
    field: e?.field,
  };
}

// A guard against setError being handed a key the form does not own, not a
// translation table: the field string is passed through unmodified.
function isProfileField(field: string | undefined): field is keyof ProfileFormData {
  return (
    field === "first_name" ||
    field === "last_name" ||
    field === "birth_date" ||
    field === "income_bracket" ||
    field === "income_bracket_currency" ||
    field === "country_code" ||
    field === "subdivision_code"
  );
}

const emptyToNull = (value: string) => {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
};

export function ProfileForm() {
  const { i18n, t } = useTranslation();
  const { data } = useUserProfile();
  const { data: countries } = useCountries();
  const saveProfile = useSaveUserProfile();
  const birthDateId = useId();
  const birthDateErrorId = useId();
  const countryId = useId();
  const countryErrorId = useId();
  const subdivisionId = useId();
  const subdivisionErrorId = useId();
  const incomeBracketId = useId();
  const incomeBracketErrorId = useId();
  const incomeCurrencyId = useId();
  const incomeCurrencyErrorId = useId();
  const incomeCurrencyHintId = useId();

  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    clearErrors,
    setValue,
    watch,
    formState: { errors },
  } = useForm<ProfileFormData>({
    defaultValues: {
      first_name: "",
      last_name: "",
      birth_date: "",
      income_bracket: "",
      income_bracket_currency: "",
      country_code: "",
      subdivision_code: "",
    },
  });

  const countryCode = watch("country_code");
  const incomeBracket = watch("income_bracket");
  const incomeBracketCurrency = watch("income_bracket_currency");
  const needsIncomeCurrency = incomeBracket !== "" && incomeBracketCurrency === "";
  const { data: subdivisions } = useSubdivisions(countryCode);
  // Gated on the dataset answer, so "no country selected" and "this country has
  // none" both resolve to the field not being offered at all.
  const hasSubdivisions = (subdivisions?.length ?? 0) > 0;

  // Display names come from the dataset rather than i18n keys, and are sorted in
  // the active locale — the dataset's own `code` ordering exists for diff
  // stability, not for humans.
  const countryOptions = useMemo(() => {
    const collator = new Intl.Collator(i18n.language);
    const speaksFrench = i18n.language.startsWith("fr");
    const options = (countries ?? []).map((c) => ({
      value: c.code,
      // G6: FR coverage is incomplete by design, so `??` resolves an absent
      // name_fr to the guaranteed-non-empty name_en rather than to a blank.
      label: speaksFrench ? (c.name_fr ?? c.name_en) : c.name_en,
    }));
    return options.sort((a, b) => collator.compare(a.label, b.label));
  }, [countries, i18n.language]);

  // The same fallback, collator and unset handling as the country select, so the
  // two location controls cannot drift apart.
  const subdivisionOptions = useMemo(() => {
    const collator = new Intl.Collator(i18n.language);
    const speaksFrench = i18n.language.startsWith("fr");
    const options = (subdivisions ?? []).map((s) => ({
      value: s.code,
      label: speaksFrench ? (s.name_fr ?? s.name_en) : s.name_en,
    }));
    return options.sort((a, b) => collator.compare(a.label, b.label));
  }, [subdivisions, i18n.language]);

  const incomeBracketOptions = useMemo(
    () =>
      INCOME_BRACKETS.map((bracket) => ({
        value: bracket.value as string,
        label: t(bracket.labelKey),
      })),
    [t],
  );

  // Not sorted and not localized: the codes are language-neutral tokens, and
  // alphabetical order would bury CAD/USD, the two currencies accounts already use.
  const incomeCurrencyOptions = useMemo(
    () => INCOME_BRACKET_CURRENCIES.map((code) => ({ value: code as string, label: code })),
    [],
  );

  // Allocated once: a fresh Date per render would remount the caption dropdowns.
  // The bounds mirror the 18-120 rule Rust enforces, so the picker cannot offer a
  // year the backend would reject. They are an affordance, not the authority.
  const { startMonth, endMonth } = useMemo(() => {
    const currentYear = new Date().getFullYear();
    return {
      startMonth: new Date(currentYear - 120, 0, 1),
      endMonth: new Date(currentYear - 18, 11, 31),
    };
  }, []);

  // The query is in flight on first render, so without this the inputs would
  // stay permanently empty once it resolves.
  useEffect(() => {
    reset({
      first_name: data?.first_name ?? "",
      last_name: data?.last_name ?? "",
      birth_date: data?.birth_date ?? "",
      income_bracket: data?.income_bracket ?? "",
      income_bracket_currency: data?.income_bracket_currency ?? "",
      country_code: data?.country_code ?? "",
      subdivision_code: data?.subdivision_code ?? "",
    });
  }, [data, reset]);

  const onSubmit = (form: ProfileFormData) => {
    saveProfile.mutate(
      {
        first_name: emptyToNull(form.first_name),
        last_name: emptyToNull(form.last_name),
        birth_date: emptyToNull(form.birth_date),
        income_bracket: emptyToNull(form.income_bracket),
        income_bracket_currency: emptyToNull(form.income_bracket_currency),
        country_code: emptyToNull(form.country_code),
        subdivision_code: emptyToNull(form.subdivision_code),
      },
      {
        onSuccess: () => {
          toast.success(t("toast.saveSuccess"));
        },
        onError: (err) => {
          const { type, message, field } = readError(err);
          if (type === "validation" && isProfileField(field)) {
            setError(field, { message });
            return;
          }
          toast.error(t("toast.saveFailed"));
        },
      },
    );
  };

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="space-y-3"
      data-testid="profile-form"
    >
      <div className="space-y-1.5">
        <Label htmlFor="profile-first-name">{t("profile.firstName")}</Label>
        <Input
          id="profile-first-name"
          aria-invalid={!!errors.first_name}
          aria-describedby={
            errors.first_name ? "profile-first-name-error" : undefined
          }
          data-testid="profile-first-name"
          {...register("first_name")}
        />
        {errors.first_name && (
          <p id="profile-first-name-error" className="text-caption text-over">
            {errors.first_name.message}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="profile-last-name">{t("profile.lastName")}</Label>
        <Input
          id="profile-last-name"
          aria-invalid={!!errors.last_name}
          aria-describedby={
            errors.last_name ? "profile-last-name-error" : undefined
          }
          data-testid="profile-last-name"
          {...register("last_name")}
        />
        {errors.last_name && (
          <p id="profile-last-name-error" className="text-caption text-over">
            {errors.last_name.message}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={birthDateId}>{t("profile.birthDate")}</Label>
        <Controller
          name="birth_date"
          control={control}
          render={({ field }) => (
            <div className="flex items-start gap-2">
              <div className="flex-1" data-testid="profile-birth-date">
                <DatePicker
                  id={birthDateId}
                  value={field.value}
                  onChange={field.onChange}
                  placeholder={t("profile.birthDatePlaceholder")}
                  captionLayout="dropdown"
                  startMonth={startMonth}
                  endMonth={endMonth}
                  aria-invalid={!!errors.birth_date}
                  aria-describedby={
                    errors.birth_date ? birthDateErrorId : undefined
                  }
                />
              </div>
              {/* The shared DatePicker's onSelect guard swallows a deselect, so it
                  can never emit an empty value; clearing needs its own control. */}
              {field.value && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  data-testid="profile-birth-date-clear"
                  onClick={() => field.onChange("")}
                >
                  {t("profile.birthDateClear")}
                </Button>
              )}
            </div>
          )}
        />
        {errors.birth_date && (
          <p id={birthDateErrorId} className="text-caption text-over-ink">
            {errors.birth_date.message}
          </p>
        )}
      </div>

      {/* Both selects render unconditionally and adjacent: a currency without a
          bracket is a permitted, inert state, so gating the currency on the
          bracket would make it unreachable from the UI. */}
      <div className="space-y-3" data-testid="profile-income">
        <div className="space-y-1.5">
          <Label htmlFor={incomeBracketId}>{t("profile.incomeBracket")}</Label>
          <Controller
            name="income_bracket"
            control={control}
            render={({ field }) => (
              <Select
                value={field.value === "" ? null : field.value}
                onValueChange={(value) => field.onChange(value ?? "")}
                items={incomeBracketOptions}
              >
                <SelectTrigger
                  id={incomeBracketId}
                  data-testid="profile-income-bracket"
                  aria-invalid={!!errors.income_bracket}
                  aria-describedby={
                    errors.income_bracket ? incomeBracketErrorId : undefined
                  }
                >
                  <SelectValue
                    placeholder={t("profile.incomeBracketPlaceholder")}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={null}>
                    {t("profile.incomeBracketUnset")}
                  </SelectItem>
                  {incomeBracketOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          {errors.income_bracket && (
            <p id={incomeBracketErrorId} className="text-caption text-over-ink">
              {errors.income_bracket.message}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={incomeCurrencyId}>
            {t("profile.incomeBracketCurrency")}
          </Label>
          <Controller
            name="income_bracket_currency"
            control={control}
            render={({ field }) => (
              <Select
                // No defaultValue and no derived guess: Nixus has no app-level
                // display currency to infer one from (G3).
                value={field.value === "" ? null : field.value}
                onValueChange={(value) => field.onChange(value ?? "")}
                items={incomeCurrencyOptions}
              >
                <SelectTrigger
                  id={incomeCurrencyId}
                  data-testid="profile-income-currency"
                  aria-invalid={!!errors.income_bracket_currency}
                  aria-describedby={
                    errors.income_bracket_currency
                      ? incomeCurrencyErrorId
                      : needsIncomeCurrency
                        ? incomeCurrencyHintId
                        : undefined
                  }
                >
                  <SelectValue
                    placeholder={t("profile.incomeBracketCurrencyPlaceholder")}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={null}>
                    {t("profile.incomeBracketCurrencyUnset")}
                  </SelectItem>
                  {incomeCurrencyOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          {/* A hint, not a second validation authority: Rust still decides, and
              this never blocks the submit. */}
          {needsIncomeCurrency && !errors.income_bracket_currency && (
            <p
              id={incomeCurrencyHintId}
              className="text-caption text-ink-dim"
              data-testid="profile-income-currency-hint"
            >
              {t("profile.incomeBracketCurrencyRequired")}
            </p>
          )}
          {errors.income_bracket_currency && (
            <p id={incomeCurrencyErrorId} className="text-caption text-over-ink">
              {errors.income_bracket_currency.message}
            </p>
          )}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={countryId}>{t("profile.country")}</Label>        <Controller
          name="country_code"
          control={control}
          render={({ field }) => (
            <Select
              value={field.value === "" ? null : field.value}
              // `""` is a control-local sentinel only; the stored value is a
              // code or null, so absent has exactly one representation.
              onValueChange={(value) => {
                field.onChange(value ?? "");
                // Cleared in the same form update, not in an effect: an effect
                // would run after a render in which the mismatched pair was
                // already submittable, and would also wipe a persisted
                // subdivision on the post-load reset.
                setValue("subdivision_code", "", { shouldDirty: true });
                clearErrors("subdivision_code");
              }}
              items={countryOptions}
            >
              <SelectTrigger
                id={countryId}
                data-testid="profile-country"
                aria-invalid={!!errors.country_code}
                aria-describedby={
                  errors.country_code ? countryErrorId : undefined
                }
              >
                <SelectValue placeholder={t("profile.countryPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={null}>{t("profile.countryUnset")}</SelectItem>
                {countryOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
        {errors.country_code && (
          <p id={countryErrorId} className="text-caption text-over-ink">
            {errors.country_code.message}
          </p>
        )}
      </div>

      {hasSubdivisions && (
        <div className="space-y-1.5" data-testid="profile-subdivision">
          <Label htmlFor={subdivisionId}>{t("profile.subdivision")}</Label>
          <Controller
            name="subdivision_code"
            control={control}
            render={({ field }) => (
              <Select
                value={field.value === "" ? null : field.value}
                onValueChange={(value) => field.onChange(value ?? "")}
                items={subdivisionOptions}
              >
                <SelectTrigger
                  id={subdivisionId}
                  data-testid="profile-subdivision-trigger"
                  aria-invalid={!!errors.subdivision_code}
                  aria-describedby={
                    errors.subdivision_code ? subdivisionErrorId : undefined
                  }
                >
                  <SelectValue
                    placeholder={t("profile.subdivisionPlaceholder")}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={null}>
                    {t("profile.subdivisionUnset")}
                  </SelectItem>
                  {subdivisionOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          {errors.subdivision_code && (
            <p id={subdivisionErrorId} className="text-caption text-over-ink">
              {errors.subdivision_code.message}
            </p>
          )}
        </div>
      )}

      <Button
        type="submit"
        size="sm"
        disabled={saveProfile.isPending}
        data-testid="profile-save"
      >
        {saveProfile.isPending ? t("profile.saving") : t("common.save")}
      </Button>
    </form>
  );
}
