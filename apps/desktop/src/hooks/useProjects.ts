import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { queryKeys } from "@/lib/constants";
import type {
  AccountEarmarkBreakdown,
  CreateProjectContributionInput,
  CreateProjectInput,
  Project,
  ProjectAllocationInput,
  ProjectContribution,
  ProjectPace,
  ProjectSavedTotal,
  SavingsProjectsSummary,
  SuggestedAllocationResponse,
  UpdateProjectInput,
} from "@/lib/types";

export function useProjects() {
  return useQuery({
    queryKey: queryKeys.projects,
    queryFn: () => invoke<Project[]>("get_projects"),
  });
}

export function useCreateProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateProjectInput) =>
      invoke<Project>("create_project", {
        name: input.name,
        target_cents: input.target_cents,
        target_date: input.target_date,
        priority: input.priority,
        icon: input.icon,
        color: input.color,
      }),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.projects });
      queryClient.invalidateQueries({
        queryKey: queryKeys.savingsProjectsSummary,
      });
      // A new or edited target amount or target date changes the required monthly rate, which is the
      // one figure on this surface that is neither stored nor derivable from the project row alone.
      queryClient.invalidateQueries({ queryKey: queryKeys.projectPace });
      // Cached advice was reasoned against the old rate, so it goes stale with the pace it explains.
      queryClient.invalidateQueries({
        queryKey: queryKeys.projectAdvice(created.id),
      });
    },
  });
}

export function useUpdateProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpdateProjectInput) =>
      invoke<Project>("update_project", {
        id: input.id,
        name: input.name,
        target_cents: input.target_cents,
        target_date: input.target_date,
        priority: input.priority,
        icon: input.icon,
        color: input.color,
      }),
    onSuccess: (_updated, input) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.projects });
      queryClient.invalidateQueries({
        queryKey: queryKeys.savingsProjectsSummary,
      });
      // A new or edited target amount or target date changes the required monthly rate, which is the
      // one figure on this surface that is neither stored nor derivable from the project row alone.
      queryClient.invalidateQueries({ queryKey: queryKeys.projectPace });
      // Cached advice was reasoned against the old rate, so it goes stale with the pace it explains.
      queryClient.invalidateQueries({
        queryKey: queryKeys.projectAdvice(input.id),
      });
    },
  });
}

// Only the list order and the suggested split depend on priority. Saved totals, earmarks, the
// dashboard rollup and every financial-health figure are untouched by a reorder, so invalidating
// them here would assert a data dependency that does not exist.
export function useReorderProjects() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (projectIds: number[]) =>
      invoke<Project[]>("reorder_projects", { project_ids: projectIds }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.projects });
      queryClient.invalidateQueries({
        queryKey: queryKeys.suggestedAllocation,
      });
    },
  });
}

export function useArchiveProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) => invoke<Project>("archive_project", { id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.projects });
      // Prefix form, not `accountEarmarks(id)`: archiving relabels a segment on every account that
      // funded the project, and the mutation only knows the project id.
      queryClient.invalidateQueries({ queryKey: ["account-earmarks"] });
      queryClient.invalidateQueries({
        queryKey: queryKeys.savingsProjectsSummary,
      });
    },
  });
}

export function useProjectContributions(projectId: number, enabled = true) {
  return useQuery({
    queryKey: queryKeys.projectContributions(projectId),
    queryFn: () =>
      invoke<ProjectContribution[]>("get_project_contributions", {
        project_id: projectId,
      }),
    enabled,
  });
}

export function useProjectSavedTotals() {
  return useQuery({
    queryKey: queryKeys.projectSavedTotals,
    queryFn: () => invoke<ProjectSavedTotal[]>("get_project_saved_totals"),
  });
}

export function useSavingsProjectsSummary() {
  return useQuery({
    queryKey: queryKeys.savingsProjectsSummary,
    queryFn: () =>
      invoke<SavingsProjectsSummary>("get_savings_projects_summary"),
  });
}

// Deliberately no arithmetic, gating or weighting here: every cent of the split is computed in Rust
// so the two sides cannot drift apart. The settled state travels on the same read for the same
// reason — the cadence ("has this month been answered?") is derived in Rust from the ledger and the
// config marker, never recomputed from what the UI happens to remember.
export function useSuggestedAllocation() {
  return useQuery({
    queryKey: queryKeys.suggestedAllocation,
    queryFn: () =>
      invoke<SuggestedAllocationResponse>("get_suggested_allocation"),
  });
}

// One query for every active project rather than one per row: the rate depends on the trailing
// contribution window, so a per-row read would hit SQLite once per project for data one grouped
// query already answers. No arithmetic here either — the status and both rates arrive computed.
export function useProjectPace() {
  return useQuery({
    queryKey: queryKeys.projectPace,
    queryFn: () => invoke<ProjectPace[]>("get_project_pace"),
  });
}

// Writes one `config` key and nothing else — no contribution row, no audit entry. Only the
// suggestion query goes stale: a skip changes no saved total, no earmark and no balance, so
// invalidating anything else would assert a data dependency that does not exist.
export function useSkipSuggestedAllocation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => invoke<string>("skip_suggested_allocation_for_month"),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.suggestedAllocation,
      });
    },
  });
}

export function useClearSuggestedAllocationSkip() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => invoke<void>("clear_suggested_allocation_skip"),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.suggestedAllocation,
      });
    },
  });
}

export function useAccountEarmarkBreakdown(accountId: number) {
  return useQuery({
    queryKey: queryKeys.accountEarmarks(accountId),
    queryFn: () =>
      invoke<AccountEarmarkBreakdown>("get_account_earmark_breakdown", {
        account_id: accountId,
      }),
  });
}

// Contributions never touch an account balance, a net worth figure or a health input, so the
// accounts/net-worth/health keys are deliberately absent: invalidating them would assert in code
// that this feature moves money. The earmark split is different — it is derived from the
// contribution rows themselves, so it goes stale on every write. Takes a list because a confirmed
// suggestion writes across many projects and possibly several accounts, while the manual paths
// write one row; the shared keys are still invalidated once per mutation, not once per row.
function invalidateContributionKeys(
  queryClient: ReturnType<typeof useQueryClient>,
  contributions: Pick<ProjectContribution, "project_id" | "account_id">[]
) {
  queryClient.invalidateQueries({ queryKey: queryKeys.projects });
  queryClient.invalidateQueries({ queryKey: queryKeys.projectSavedTotals });
  queryClient.invalidateQueries({
    queryKey: queryKeys.savingsProjectsSummary,
  });
  queryClient.invalidateQueries({ queryKey: queryKeys.projectPace });

  for (const projectId of new Set(contributions.map((c) => c.project_id))) {
    queryClient.invalidateQueries({
      queryKey: queryKeys.projectContributions(projectId),
    });
    // Per project id, not once globally: a contribution moves only this project's pace, and the
    // cached advice explains a pace that no longer holds.
    queryClient.invalidateQueries({
      queryKey: queryKeys.projectAdvice(projectId),
    });
  }
  for (const accountId of new Set(contributions.map((c) => c.account_id))) {
    queryClient.invalidateQueries({
      queryKey: queryKeys.accountEarmarks(accountId),
    });
  }
}

export function useCreateProjectContribution() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateProjectContributionInput) =>
      invoke<ProjectContribution>("create_project_contribution", {
        project_id: input.project_id,
        account_id: input.account_id,
        amount_cents: input.amount_cents,
        date: input.date,
      }),
    onSuccess: (_contribution, input) => {
      invalidateContributionKeys(queryClient, [input]);
    },
  });
}

// The one write path for suggested allocations: no `source` is sent, and the returned rows drive
// invalidation because only the server knows which projects and accounts actually got a row.
// `suggestedAllocation` is added on top of the manual set because new saved totals shrink
// `remaining_cents` and therefore change the next suggestion.
export function useConfirmProjectAllocations() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (allocations: ProjectAllocationInput[]) =>
      invoke<ProjectContribution[]>("confirm_project_allocations", {
        allocations,
      }),
    onSuccess: (created) => {
      invalidateContributionKeys(queryClient, created);
      queryClient.invalidateQueries({
        queryKey: queryKeys.suggestedAllocation,
      });
    },
  });
}

export function useDeleteProjectContribution() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) =>
      invoke<ProjectContribution>("delete_project_contribution", { id }),
    onSuccess: (deleted) => {
      invalidateContributionKeys(queryClient, [deleted]);
    },
  });
}
