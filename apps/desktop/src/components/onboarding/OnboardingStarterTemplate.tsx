import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button, Card, CardContent, Label } from "@nixus/shared";
import { MoneyInput } from "@/components/shared/MoneyInput";
import { useApplySystemTemplate, useSystemTemplateDetail } from "@/hooks/useBudgetTemplates";
import { queryKeys } from "@/lib/constants";
import type { TemplateGroupDetail, TemplateTargetOverride } from "@/lib/types";

function getErrorMessage(err: unknown): string {
  const e = err as { message?: string };
  return e?.message ?? (typeof err === "string" ? err : "");
}

// Group and category names are the template's own identifiers on the Rust side, so the
// same pair is what addresses an edit back to the row it came from.
function editKey(groupName: string, categoryName: string): string {
  return `${groupName}\u0000${categoryName}`;
}

function authoredTarget(targetCents: number | null): number {
  return targetCents ?? 0;
}

function buildOverrides(
  groups: TemplateGroupDetail[],
  edits: Record<string, number>
): TemplateTargetOverride[] {
  return groups.flatMap((group) =>
    group.categories.flatMap((category) => {
      const edited = edits[editKey(group.name, category.name)];
      if (edited === undefined || edited === authoredTarget(category.target_cents)) {
        return [];
      }
      return [
        {
          groupName: group.name,
          categoryName: category.name,
          targetCents: edited,
        },
      ];
    })
  );
}

export function OnboardingStarterTemplate({ templateId }: { templateId: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const detail = useSystemTemplateDetail(templateId);
  const applyTemplate = useApplySystemTemplate();
  const [edits, setEdits] = useState<Record<string, number>>({});

  const groups = detail.data?.groups ?? [];

  if (detail.isPending) {
    return (
      <p className="text-caption text-ink-dim" data-testid="onboarding-starter-loading">
        {t("onboarding.starterTemplateLoading")}
      </p>
    );
  }

  // A first-run user must never be stuck here: an unreachable template degrades to a
  // note, leaving the manual path below as the way forward.
  if (detail.isError || groups.length === 0) {
    return (
      <p className="text-caption text-ink-dim" data-testid="onboarding-starter-unavailable">
        {t("onboarding.starterTemplateUnavailable")}
      </p>
    );
  }

  const handleConfirm = async () => {
    const overrides = buildOverrides(groups, edits);

    try {
      const result = await applyTemplate.mutateAsync({
        templateId,
        overrides: overrides.length > 0 ? overrides : undefined,
      });

      const skipped = result.skipped_groups.join(", ");
      // Checked first: every group collided, so "added 0 groups" would read as a success.
      if (result.groups_created === 0) {
        toast.info(t("onboarding.starterTemplateAllSkipped", { skipped }));
      } else if (result.skipped_groups.length > 0) {
        toast.success(
          t("onboarding.starterTemplateAppliedSkipped", {
            groups: result.groups_created,
            categories: result.categories_created,
            skipped,
          })
        );
      } else {
        toast.success(
          t("onboarding.starterTemplateApplied", {
            groups: result.groups_created,
            categories: result.categories_created,
          })
        );
      }

      // Story 25.2 keeps the shared hook free of onboarding concerns, so the redirect
      // gate's cached "needs onboarding" answer is this component's to refresh — before
      // navigating, or the guard on `/` sends the user straight back here.
      await queryClient.invalidateQueries({ queryKey: queryKeys.onboardingStatus });
      navigate({ to: "/" });
    } catch (err: unknown) {
      toast.error(
        getErrorMessage(err) || t("onboarding.starterTemplateApplyFailed")
      );
    }
  };

  return (
    <div className="space-y-3" data-testid="onboarding-starter-template">
      <div>
        <h3 className="text-h3 text-ink">{t("onboarding.starterTemplateTitle")}</h3>
        <p className="mt-1 text-caption text-ink-dim">
          {t("onboarding.starterTemplateDescription")}
        </p>
        <p className="mt-1 text-caption text-ink-faint">
          {t("onboarding.starterTemplateEditableNote")}
        </p>
      </div>

      {groups.map((group) => (
        <Card key={group.name}>
          <CardContent>
            <h4 className="text-label text-ink">{group.name}</h4>
            <p className="mb-2 text-caption text-ink-faint">
              {t("onboarding.starterTemplateTargetLabel")}
            </p>
            <div className="space-y-2">
              {group.categories.map((category) => {
                const key = editKey(group.name, category.name);
                const inputId = `starter-target-${group.name}-${category.name}`.replace(
                  /\s+/g,
                  "-"
                );
                return (
                  <div
                    key={category.name}
                    className="flex items-center justify-between gap-3"
                  >
                    <Label htmlFor={inputId} className="min-w-0 truncate">
                      {category.name}
                    </Label>
                    <div className="w-36 shrink-0">
                      <MoneyInput
                        id={inputId}
                        value={edits[key] ?? authoredTarget(category.target_cents)}
                        onChange={(cents) =>
                          setEdits((previous) => ({ ...previous, [key]: cents }))
                        }
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      ))}

      <Button
        onClick={handleConfirm}
        disabled={applyTemplate.isPending}
        aria-disabled={applyTemplate.isPending || undefined}
        data-testid="onboarding-starter-confirm"
      >
        {applyTemplate.isPending
          ? t("onboarding.starterTemplateConfirming")
          : t("onboarding.starterTemplateConfirmAction")}
      </Button>
    </div>
  );
}
