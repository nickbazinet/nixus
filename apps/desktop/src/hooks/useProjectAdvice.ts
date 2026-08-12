import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { queryKeys } from "@/lib/constants";
import type { ProjectAdviceResponse } from "@/lib/types";

export interface ProjectAdviceInput {
  projectName: string;
  remainingCents: number;
  requiredMonthlyCents: number;
  actualMonthlyCents: number | null;
  monthsToTarget: number | null;
}

// A query keyed per project, because the row unmounts its detail on collapse: a mutation lost the
// answer the user already paid a provider call for, so re-expanding re-asked. The cache is now the
// whole lifecycle of the feature:
//   - `enabled: false` — this never fires on mount. The button's `refetch()` is the only trigger, so
//     expanding a row still costs zero provider calls.
//   - `refetch()` is both "generate" and "regenerate": an explicit re-click is still a deliberate
//     user action, it is just never automatic.
//   - `staleTime: Infinity` — a cached answer never ages out on its own. The only eviction is the
//     explicit `projectAdvice(projectId)` invalidation wherever `projectPace` is invalidated, which
//     is precisely when a real pace change makes the stored answer wrong.
//   - `retry: false` — matches `useTrendsInsight`; a failed provider call surfaces its error and the
//     retry is the user's re-click.
// `input` is read fresh on every call rather than captured once, so a re-click after the pace figures
// changed sends the current numbers.
export function useProjectAdvice(projectId: number, input: ProjectAdviceInput) {
  const { i18n } = useTranslation();

  return useQuery({
    queryKey: queryKeys.projectAdvice(projectId),
    queryFn: () =>
      invoke<ProjectAdviceResponse>("generate_project_advice", {
        project_name: input.projectName,
        remaining_cents: input.remainingCents,
        required_monthly_cents: input.requiredMonthlyCents,
        actual_monthly_cents: input.actualMonthlyCents,
        months_to_target: input.monthsToTarget,
        locale: i18n.language.startsWith("fr") ? "fr" : "en",
      }),
    enabled: false,
    staleTime: Infinity,
    retry: false,
  });
}
