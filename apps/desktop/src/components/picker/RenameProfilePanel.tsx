import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button, Input, Label, SlideOver } from "@nixus/shared";
import { useRenameDataset, type Dataset } from "@/hooks/useDatasets";

/**
 * The same ceiling `parse_dataset_label` enforces Rust-side, restated here only so the field can
 * refuse an over-long name before an IPC round-trip and interpolate the number into the message.
 * Rust stays the authority: a client that drifted would still be rejected there.
 */
export const MAX_PROFILE_NAME_LENGTH = 80;

interface RenameProfilePanelProps {
  entry: Dataset;
  onClose: () => void;
}

interface RenameProfileFormData {
  label: string;
}

/**
 * `SlideOver`, not `Dialog`: this design system reserves Dialog for destructive confirms and routes
 * every create and edit flow through the off-canvas panel, which also supplies the labelled
 * `role="dialog"`, the escape handler and focus return to the row's rename button.
 *
 * Mounted only while a rename is open and keyed by the profile's id by its caller, so the field's
 * `defaultValues` are the entry's current label on every open — a persistently-mounted form would
 * keep the first profile's name after the second row was picked.
 */
export function RenameProfilePanel({ entry, onClose }: RenameProfilePanelProps) {
  const { t } = useTranslation();
  const renameDataset = useRenameDataset();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RenameProfileFormData>({
    defaultValues: { label: entry.label },
    mode: "onSubmit",
  });

  // Counted in code points, matching Rust's `chars().count()`, so a name the field accepts is never
  // one the registry then refuses.
  const validateLabel = (value: string) => {
    const trimmed = value.trim();
    if (trimmed.length === 0) return t("datasets.nameRequired");
    if (Array.from(trimmed).length > MAX_PROFILE_NAME_LENGTH) {
      return t("datasets.nameTooLong", { max: MAX_PROFILE_NAME_LENGTH });
    }
    return true;
  };

  // Closing only on success is what leaves the typed name on screen for a second attempt: a
  // rejected rename has to keep both the panel and the previous label.
  const submit = async (data: RenameProfileFormData) => {
    try {
      await renameDataset.mutateAsync({ datasetId: entry.id, label: data.label });
      onClose();
    } catch {
      toast.error(t("datasets.renameFailed"));
    }
  };

  // Every user-initiated way out funnels through here, because a rename in flight must not be
  // abandoned: the registry write is already committed or about to be, and unmounting would drop the
  // panel that reports its outcome. Escape and the backdrop are SlideOver's own, so they cannot be
  // covered by a `disabled` attribute — refusing the request is the only guard that reaches them.
  // The success path calls `onClose` directly instead, so a completed rename closes as normal.
  const requestClose = () => {
    if (renameDataset.isPending) return;
    onClose();
  };

  return (
    <SlideOver
      open
      onClose={requestClose}
      title={t("datasets.renameProfile")}
      description={t("datasets.renameProfileDescription")}
      data-testid="picker-rename-panel"
    >
      <form
        onSubmit={(event) => void handleSubmit(submit)(event)}
        className="space-y-3"
        data-testid="picker-rename-form"
      >
        <div className="space-y-1.5">
          <Label htmlFor="picker-rename-label" required>
            {t("datasets.profileName")}
          </Label>
          <Input
            id="picker-rename-label"
            autoFocus
            aria-required="true"
            aria-invalid={!!errors.label}
            aria-describedby={errors.label ? "picker-rename-label-error" : undefined}
            data-testid="picker-rename-input"
            {...register("label", { validate: validateLabel })}
          />
          {errors.label && (
            <p
              id="picker-rename-label-error"
              className="text-caption text-over"
              data-testid="picker-rename-error"
            >
              {errors.label.message}
            </p>
          )}
        </div>

        <div className="flex gap-2">
          <Button
            type="submit"
            size="sm"
            disabled={renameDataset.isPending}
            aria-disabled={renameDataset.isPending || undefined}
            data-testid="picker-rename-save"
          >
            {t("common.save")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={renameDataset.isPending}
            aria-disabled={renameDataset.isPending || undefined}
            onClick={requestClose}
            data-testid="picker-rename-cancel"
          >
            {t("common.cancel")}
          </Button>
        </div>
      </form>
    </SlideOver>
  );
}
