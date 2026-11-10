import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
} from "@nixus/shared";
import { MoneyInput } from "@/components/shared/MoneyInput";
import {
  useAddProjectToBudget,
  useRemoveProjectFromBudget,
} from "@/hooks/useProjects";
import type { Project } from "@/lib/types";

interface MonthlyAmountFormData {
  monthly_cents: number;
}

// Shared by the project detail and the row menu, which trigger the same two actions from different
// controls. A dated project goes straight in (its target is calculated); an undated one first asks
// for the monthly amount. Removal always asks first, because it reads as destructive even though the
// project and its contributions are kept.
export function useProjectBudgetActions(project: Project) {
  const { t } = useTranslation();
  const addToBudget = useAddProjectToBudget();
  const removeFromBudget = useRemoveProjectFromBudget();
  const [askingAmount, setAskingAmount] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<MonthlyAmountFormData>({
    defaultValues: { monthly_cents: 0 },
    mode: "onSubmit",
  });

  const add = (monthlyCents: number | null) => {
    addToBudget.mutate(
      { project_id: project.id, monthly_cents: monthlyCents },
      {
        onSuccess: () => {
          toast.success(t("projects.addedToBudget", { name: project.name }));
          setAskingAmount(false);
          reset();
        },
        onError: () => {
          toast.error(t("projects.addToBudgetFailed"));
        },
      }
    );
  };

  const startAdd = () => {
    if (project.target_date !== null) {
      add(null);
      return;
    }
    setAskingAmount(true);
  };

  const confirmRemove = () => {
    removeFromBudget.mutate(project.id, {
      onSuccess: () => {
        toast.success(t("projects.removedFromBudget", { name: project.name }));
        setConfirmingRemove(false);
      },
      onError: () => {
        toast.error(t("projects.removeFromBudgetFailed"));
        setConfirmingRemove(false);
      },
    });
  };

  const amountFieldId = `project-budget-amount-${project.id}`;

  const dialogs = (
    <>
      <Dialog
        open={askingAmount}
        onOpenChange={(open) => {
          if (!open) {
            setAskingAmount(false);
            reset();
          }
        }}
      >
        <DialogContent data-testid="project-budget-amount-dialog">
          <form onSubmit={handleSubmit((data) => add(data.monthly_cents))}>
            <DialogHeader>
              <DialogTitle>{t("projects.budgetMonthlyTitle")}</DialogTitle>
              <DialogDescription>
                {t("projects.budgetMonthlyDescription")}
              </DialogDescription>
            </DialogHeader>
            <div className="my-4 space-y-1.5">
              <Label htmlFor={amountFieldId} required>
                {t("projects.budgetMonthlyLabel")}
              </Label>
              <Controller
                name="monthly_cents"
                control={control}
                rules={{ validate: (v) => v > 0 || t("validation.amountPositive") }}
                render={({ field }) => (
                  <MoneyInput
                    id={amountFieldId}
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    aria-invalid={!!errors.monthly_cents}
                  />
                )}
              />
              {errors.monthly_cents && (
                <p
                  className="text-caption text-over-ink"
                  data-testid="project-budget-amount-error"
                >
                  {errors.monthly_cents.message}
                </p>
              )}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setAskingAmount(false);
                  reset();
                }}
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="submit"
                disabled={addToBudget.isPending}
                data-testid="confirm-project-budget-amount"
              >
                {t("projects.addToBudget")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirmingRemove}
        onOpenChange={(open) => {
          if (!open) setConfirmingRemove(false);
        }}
      >
        <DialogContent data-testid="remove-from-budget-dialog">
          <DialogHeader>
            <DialogTitle>{t("projects.removeFromBudgetTitle")}</DialogTitle>
            <DialogDescription>
              {t("projects.removeFromBudgetDescription", { name: project.name })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmingRemove(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={removeFromBudget.isPending}
              onClick={confirmRemove}
              data-testid="confirm-remove-from-budget"
            >
              {t("projects.removeFromBudget")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );

  return {
    startAdd,
    startRemove: () => setConfirmingRemove(true),
    addPending: addToBudget.isPending,
    dialogs,
  };
}
