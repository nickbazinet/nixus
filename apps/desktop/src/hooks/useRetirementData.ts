import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { queryKeys } from "@/lib/constants";
import type { RetirementInput, UserProfile } from "@/lib/types";
import { useAuthSession } from "@/hooks/useAuth";
import {
  CA_DEFAULT_PENSION_ANNUAL_CENTS,
  DEFAULT_EMPLOYER_PENSION_START_AGE,
  DEFAULT_PENSION_TAX_RATE_PERCENT,
} from "@/lib/retirement";
import type { RetirementTaxModel } from "@/lib/retirement";

function computeAgeFromBirthDate(birthDate: string): number {
  const birth = new Date(birthDate);
  const ageMs = Date.now() - birth.getTime();
  return Math.floor(ageMs / (365.25 * 24 * 60 * 60 * 1000));
}

export function useRetirementInput() {
  return useQuery({
    queryKey: queryKeys.retirementInput,
    queryFn: () => invoke<RetirementInput>("get_retirement_input"),
  });
}

export function useRetirementProfile() {
  const { data: session } = useAuthSession();
  const loggedIn = session?.status === "LoggedIn";

  return useQuery({
    queryKey: queryKeys.profile,
    queryFn: () => invoke<UserProfile | null>("get_user_profile"),
    enabled: loggedIn,
    retry: false,
  });
}

export function useRetirementPension() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.retirementPension,
    queryFn: () => invoke<number | null>("get_retirement_pension_cents"),
  });

  const mutation = useMutation({
    mutationFn: (cents: number) =>
      invoke<void>("set_retirement_pension_cents", { cents }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.retirementPension });
    },
  });

  return { ...query, save: mutation };
}

export function useRetirementEmployerPension() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.retirementEmployerPension,
    queryFn: () => invoke<number | null>("get_retirement_employer_pension_cents"),
  });

  const mutation = useMutation({
    mutationFn: (cents: number) =>
      invoke<void>("set_retirement_employer_pension_cents", { cents }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.retirementEmployerPension,
      });
    },
  });

  return { ...query, save: mutation };
}

export function useRetirementEmployerPensionStartAge() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.retirementEmployerPensionStartAge,
    queryFn: () =>
      invoke<number | null>("get_retirement_employer_pension_start_age"),
  });

  const mutation = useMutation({
    mutationFn: (years: number) =>
      invoke<void>("set_retirement_employer_pension_start_age", { years }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.retirementEmployerPensionStartAge,
      });
    },
  });

  return { ...query, save: mutation };
}

export function useRetirementPensionTaxRate() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.retirementPensionTaxRate,
    queryFn: () =>
      invoke<number | null>("get_retirement_pension_tax_rate_percent"),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({
      queryKey: queryKeys.retirementPensionTaxRate,
    });
  };

  const mutation = useMutation({
    mutationFn: (percent: number) =>
      invoke<void>("set_retirement_pension_tax_rate_percent", { percent }),
    onSuccess: invalidate,
  });

  const clearMutation = useMutation({
    mutationFn: () =>
      invoke<void>("clear_retirement_pension_tax_rate_percent"),
    onSuccess: invalidate,
  });

  return { ...query, save: mutation, clear: clearMutation };
}

export function useRetirementAgeOverride() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.retirementAgeOverride,
    queryFn: () => invoke<number | null>("get_retirement_age_override"),
  });

  const mutation = useMutation({
    mutationFn: (years: number) =>
      invoke<void>("set_retirement_age_override", { years }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.retirementAgeOverride,
      });
    },
  });

  return { ...query, save: mutation };
}

export interface RetirementSettings {
  input: RetirementInput | undefined;
  isPending: boolean;
  /** Resolved current age (profile > manual override > null). */
  currentAge: number | null;
  /** True when age came from the signed-in profile (read-only display). */
  ageFromProfile: boolean;
  governmentPensionAnnualCents: number;
  /** True when the government pension figure is an unsaved CA-default suggestion, not yet persisted. */
  governmentPensionIsUnsavedDefault: boolean;
  /** True when CPP/OAS eligibility ages apply, i.e. the profile's country is Canada. */
  gateGovernmentPensionByAge: boolean;
  employerPensionAnnualCents: number;
  /** Defaulted here, not in Rust — the getter returns null when never saved. */
  employerPensionStartAge: number;
  /** How the matrix taxes retirement income: the saved override if there is one, else the CA curve. */
  taxModel: RetirementTaxModel;
  /**
   * True when an estimate genuinely exists to offer, i.e. the country has a tax table. Gates every
   * estimate affordance and every word of estimate language: with no table, clearing an override
   * lands on a flat 0%, which is a default and not an estimate, so offering one would be a lie.
   */
  autoEstimateAvailable: boolean;
  /** True when a rate is actually persisted, i.e. there is something for the estimate to replace. */
  pensionTaxRateHasOverride: boolean;
  saveGovernmentPension: (cents: number) => void;
  saveEmployerPension: (cents: number) => void;
  saveEmployerPensionStartAge: (years: number) => void;
  savePensionTaxRate: (percent: number) => void;
  clearPensionTaxRate: () => void;
  saveAgeOverride: (years: number) => void;
}

/** Aggregates retirement input, profile, and the retirement-only settings into one view model. */
export function useRetirementSettings(): RetirementSettings {
  const { data: input, isPending: retirementInputPending } = useRetirementInput();
  const { data: profile } = useRetirementProfile();
  const governmentPension = useRetirementPension();
  const employerPension = useRetirementEmployerPension();
  const employerPensionStartAge = useRetirementEmployerPensionStartAge();
  const pensionTaxRate = useRetirementPensionTaxRate();
  const ageOverride = useRetirementAgeOverride();

  const profileAge = useMemo(() => {
    if (!profile?.birth_date) return null;
    return computeAgeFromBirthDate(profile.birth_date);
  }, [profile?.birth_date]);

  const currentAge = profileAge ?? ageOverride.data ?? null;
  const ageFromProfile = profileAge !== null;

  const isCanada = profile?.country_code === "CA";
  const governmentPensionIsUnsavedDefault =
    governmentPension.data == null && isCanada;
  const governmentPensionAnnualCents =
    governmentPension.data ?? (isCanada ? CA_DEFAULT_PENSION_ANNUAL_CENTS : 0);

  // A saved rate always wins, so the auto curve can never overwrite someone's own number. Absence is
  // what unlocks it, and only for Canada — the band table is Canadian, so there is nothing to
  // estimate from anywhere else and the historical flat 0% stays the honest answer there.
  const pensionTaxRateHasOverride = pensionTaxRate.data != null;
  const taxModel: RetirementTaxModel =
    pensionTaxRate.data != null
      ? { kind: "manual", ratePercent: pensionTaxRate.data }
      : isCanada
        ? { kind: "auto" }
        : { kind: "manual", ratePercent: DEFAULT_PENSION_TAX_RATE_PERCENT };

  return {
    input,
    // `profile` is intentionally excluded here: it's disabled when logged out, and a disabled
    // query's `isPending` never settles to false, which would make this page stay "loading"
    // forever for the app's default (signed-out) local-first path.
    isPending:
      retirementInputPending ||
      governmentPension.isPending ||
      employerPension.isPending ||
      employerPensionStartAge.isPending ||
      pensionTaxRate.isPending ||
      ageOverride.isPending,
    currentAge,
    ageFromProfile,
    governmentPensionAnnualCents,
    governmentPensionIsUnsavedDefault,
    gateGovernmentPensionByAge: isCanada,
    employerPensionAnnualCents: employerPension.data ?? 0,
    employerPensionStartAge:
      employerPensionStartAge.data ?? DEFAULT_EMPLOYER_PENSION_START_AGE,
    taxModel,
    autoEstimateAvailable: isCanada,
    pensionTaxRateHasOverride,
    saveGovernmentPension: (cents: number) =>
      governmentPension.save.mutate(cents),
    saveEmployerPension: (cents: number) => employerPension.save.mutate(cents),
    saveEmployerPensionStartAge: (years: number) =>
      employerPensionStartAge.save.mutate(years),
    savePensionTaxRate: (percent: number) =>
      pensionTaxRate.save.mutate(percent),
    clearPensionTaxRate: () => pensionTaxRate.clear.mutate(),
    saveAgeOverride: (years: number) => ageOverride.save.mutate(years),
  };
}
