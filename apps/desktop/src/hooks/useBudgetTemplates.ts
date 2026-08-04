import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { queryKeys } from "@/lib/constants";
import { invalidateTrendsQueries } from "@/hooks/useBudget";
import type {
  ApplyBudgetTemplateResult,
  SystemBudgetTemplateDetail,
  SystemBudgetTemplateSummary,
  TemplateTargetOverride,
} from "@/lib/types";

export interface ApplySystemTemplateVariables {
  templateId: string;
  overrides?: TemplateTargetOverride[];
}

// Shared so importing and applying a template can never drift: both create groups with
// targets, so they must refresh the same views.
function invalidateAppliedTemplateQueries(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: queryKeys.budgetGroups });
  // Prefix invalidation: an import cannot know the new group ids or the viewed month,
  // and queryKeys.budgetCategories/budgetStatus are per-id/per-month factories.
  queryClient.invalidateQueries({ queryKey: ["budget-categories"] });
  queryClient.invalidateQueries({ queryKey: ["budget-status"] });
  invalidateTrendsQueries(queryClient);
}

export function useImportBudgetTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    // The native open dialog lives in Rust (tauri-plugin-dialog), so the command takes no
    // arguments and returns null when the user cancels.
    mutationFn: () =>
      invoke<ApplyBudgetTemplateResult | null>("import_budget_template"),
    onSuccess: (data) => {
      if (!data) return;
      invalidateAppliedTemplateQueries(queryClient);
    },
  });
}

export function useExportBudgetTemplate() {
  // Export is read-only: nothing to invalidate.
  return useMutation({
    mutationFn: () =>
      invoke<{ path: string } | null>("export_budget_template"),
  });
}

export function useSystemTemplates() {
  return useQuery({
    queryKey: queryKeys.systemBudgetTemplates,
    queryFn: () =>
      invoke<SystemBudgetTemplateSummary[]>("list_system_templates"),
  });
}

export function useSystemTemplateDetail(templateId: string) {
  return useQuery({
    queryKey: queryKeys.systemBudgetTemplateDetail(templateId),
    queryFn: () =>
      invoke<SystemBudgetTemplateDetail>("get_system_template_detail", {
        template_id: templateId,
      }),
    // The caller may render before the template list resolves. Rust rejects an
    // unknown id, so an empty id must not become a request.
    enabled: templateId !== "",
  });
}

export function useApplySystemTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    // Compiled-const template: no dialog, so no Ok(None)/null branch here
    // (unlike the import/export mutations above).
    mutationFn: ({ templateId, overrides }: ApplySystemTemplateVariables) =>
      invoke<ApplyBudgetTemplateResult>("apply_system_template", {
        template_id: templateId,
        overrides: overrides?.map((entry) => ({
          group_name: entry.groupName,
          category_name: entry.categoryName,
          target_cents: entry.targetCents,
        })),
      }),
    onSuccess: () => {
      invalidateAppliedTemplateQueries(queryClient);
    },
  });
}
