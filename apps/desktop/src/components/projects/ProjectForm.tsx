import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button, DatePicker, Input, Label } from "@nixus/shared";
import { MoneyInput } from "@/components/shared/MoneyInput";
import { useCreateProject, useUpdateProject } from "@/hooks/useProjects";
import type { Project } from "@/lib/types";

interface ProjectFormData {
  name: string;
  target_cents: number;
  target_date: string;
  priority: string;
}

interface ProjectFormProps {
  project?: Project;
  onClose: () => void;
}

export function ProjectForm({ project, onClose }: ProjectFormProps) {
  const { t } = useTranslation();
  const createProject = useCreateProject();
  const updateProject = useUpdateProject();

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<ProjectFormData>({
    defaultValues: {
      name: project?.name ?? "",
      target_cents: project?.target_cents ?? 0,
      target_date: project?.target_date ?? "",
      priority: project ? String(project.priority) : "",
    },
    mode: "onBlur",
  });

  const onSubmit = (data: ProjectFormData) => {
    const handlers = {
      onSuccess: () => {
        toast.success(t("toast.saveSuccess"));
        onClose();
      },
      onError: () => {
        toast.error(t("toast.saveFailed"));
      },
    };

    const fields = {
      name: data.name,
      target_cents: data.target_cents,
      target_date: data.target_date ? data.target_date : null,
      priority: data.priority === "" ? null : Number(data.priority),
      // Both columns exist in the schema for Epic 32; this story ships no picker for either.
      icon: project?.icon ?? null,
      color: project?.color ?? null,
    };

    if (project) {
      updateProject.mutate({ id: project.id, ...fields }, handlers);
      return;
    }

    createProject.mutate(fields, handlers);
  };

  return (
    // `noValidate` hands validation to the form layer instead of the browser. Native constraint
    // checking aborts submit before it fires, so the styled inline error, `aria-invalid` and
    // `aria-describedby` never activate — the user gets an unstyled bubble and AT gets nothing.
    <form
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      className="space-y-4"
      data-testid="project-form"
    >
      <div className="space-y-1.5">
        <Label htmlFor="project-name" required>
          {t("common.name")}
        </Label>
        <Input
          id="project-name"
          placeholder={t("projects.namePlaceholder")}
          autoFocus
          required
          aria-required="true"
          aria-invalid={!!errors.name}
          aria-describedby={errors.name ? "project-name-error" : undefined}
          {...register("name", { required: t("projects.nameRequired") })}
        />
        {errors.name && (
          <p id="project-name-error" className="text-caption text-over-ink">
            {errors.name.message}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="project-target" required>
          {t("projects.targetAmount")}
        </Label>
        <Controller
          name="target_cents"
          control={control}
          rules={{ validate: (v) => v > 0 || t("validation.amountPositive") }}
          render={({ field }) => (
            <MoneyInput
              id="project-target"
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              aria-invalid={!!errors.target_cents}
            />
          )}
        />
        {errors.target_cents && (
          <p id="project-target-error" className="text-caption text-over-ink">
            {errors.target_cents.message}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="project-target-date">{t("projects.targetDate")}</Label>
        <Controller
          name="target_date"
          control={control}
          render={({ field }) => (
            <DatePicker
              id="project-target-date"
              value={field.value}
              onChange={field.onChange}
            />
          )}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="project-priority">{t("projects.priority")}</Label>
        <Input
          id="project-priority"
          type="number"
          min={0}
          {...register("priority")}
        />
      </div>

      <p className="text-caption text-ink-dim" data-testid="project-no-money-moved">
        {t("projects.noMoneyMovedNote")}
      </p>

      <div className="flex gap-2">
        <Button type="submit" size="sm">
          {t("projects.saveProject")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onClose}
          data-testid="cancel-project-form"
        >
          {t("common.cancel")}
        </Button>
      </div>
    </form>
  );
}
