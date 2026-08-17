import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { queryKeys } from "@/lib/constants";
import type { RetirementInput, UserProfile } from "@/lib/types";
import { useAuthSession } from "@/hooks/useAuth";
import { CA_DEFAULT_PENSION_ANNUAL_CENTS } from "@/lib/retirement";

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
  pensionAnnualCents: number;
  /** True when the pension figure is an unsaved CA-default suggestion, not yet persisted. */
  pensionIsUnsavedDefault: boolean;
  savePension: (cents: number) => void;
  saveAgeOverride: (years: number) => void;
}

/** Aggregates retirement input, profile, and the two retirement-only settings into one view model. */
export function useRetirementSettings(): RetirementSettings {
  const { data: input, isPending: retirementInputPending } = useRetirementInput();
  const { data: profile } = useRetirementProfile();
  const pension = useRetirementPension();
  const ageOverride = useRetirementAgeOverride();

  const profileAge = useMemo(() => {
    if (!profile?.birth_date) return null;
    return computeAgeFromBirthDate(profile.birth_date);
  }, [profile?.birth_date]);

  const currentAge = profileAge ?? ageOverride.data ?? null;
  const ageFromProfile = profileAge !== null;

  const pensionIsUnsavedDefault =
    pension.data == null && profile?.country_code === "CA";
  const pensionAnnualCents =
    pension.data ??
    (profile?.country_code === "CA" ? CA_DEFAULT_PENSION_ANNUAL_CENTS : 0);

  return {
    input,
    // `profile` is intentionally excluded here: it's disabled when logged out, and a disabled
    // query's `isPending` never settles to false, which would make this page stay "loading"
    // forever for the app's default (signed-out) local-first path.
    isPending: retirementInputPending || pension.isPending || ageOverride.isPending,
    currentAge,
    ageFromProfile,
    pensionAnnualCents,
    pensionIsUnsavedDefault,
    savePension: (cents: number) => pension.save.mutate(cents),
    saveAgeOverride: (years: number) => ageOverride.save.mutate(years),
  };
}
