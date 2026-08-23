import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from "@nixus/shared";
import { useDeleteDataset, type Dataset } from "@/hooks/useDatasets";

interface DeleteProfilePanelProps {
  entry: Dataset;
  onClose: () => void;
}

/**
 * `Dialog`, not `SlideOver`: this design system reserves Dialog for destructive confirms and routes
 * every create and edit flow through the off-canvas panel — which is exactly why the rename sibling
 * uses the other one.
 *
 * The typed confirmation is the whole point. Deletion removes a profile's directory, its registry
 * row and its AI credentials with no export, backup or undo anywhere in this flow, so a single
 * mis-click must not be able to reach it. The word is *translated*, so a French user types
 * SUPPRIMER rather than an English token, and the prompt interpolates the same value the comparison
 * uses so the two cannot drift apart.
 *
 * The failure is inline rather than a toast: unlike a rename, the dialog stays open on rejection and
 * the message belongs beside the action that was refused — a toast would be dismissed while the
 * still-open dialog went on looking untouched.
 */
export function DeleteProfilePanel({ entry, onClose }: DeleteProfilePanelProps) {
  const { t } = useTranslation();
  const deleteDataset = useDeleteDataset();
  const [typed, setTyped] = useState("");
  const [failed, setFailed] = useState(false);

  const confirmWord = t("datasets.deleteConfirmWord");
  const pending = deleteDataset.isPending;
  const canDelete = typed.trim() === confirmWord && !pending;

  // Every user-initiated way out funnels through here, because a deletion in flight must not be
  // abandoned: the directory removal is already committed or about to be, and unmounting would drop
  // the surface that reports its outcome. Escape, the backdrop and the X are Base UI's own, so they
  // reach this through the controlled `onOpenChange` rather than through any `disabled` attribute.
  const requestClose = () => {
    if (pending) return;
    onClose();
  };

  // Closing only on success is what leaves the typed word and the failure on screen for a second
  // attempt — and a retry is the documented remedy when the registry write failed after the
  // directory was already removed.
  const confirmDelete = async () => {
    setFailed(false);
    try {
      await deleteDataset.mutateAsync(entry.id);
      // Announced, because the row it stood in has already disappeared: without this the only
      // feedback for an irreversible action is something silently vanishing.
      toast.success(t("datasets.profileDeleted", { name: entry.label }));
      onClose();
    } catch {
      setFailed(true);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(next: boolean) => {
        if (!next) requestClose();
      }}
    >
      <DialogContent data-testid="picker-delete-dialog">
        <DialogHeader>
          <DialogTitle className="text-over-ink">
            {t("datasets.deleteProfile")}
          </DialogTitle>
          <DialogDescription>
            {t("datasets.deleteProfileDescription", { name: entry.label })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="picker-delete-confirm" required>
            {t("datasets.deleteTypeToConfirm", { word: confirmWord })}
          </Label>
          <Input
            id="picker-delete-confirm"
            type="text"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder={confirmWord}
            autoComplete="off"
            autoFocus
            required
            aria-required="true"
            aria-describedby={failed ? "picker-delete-error" : undefined}
            disabled={pending}
            aria-disabled={pending || undefined}
            data-testid="picker-delete-confirm-input"
          />
        </div>

        {failed && (
          <Alert variant="over" id="picker-delete-error" data-testid="picker-delete-error">
            {t("datasets.deleteFailed")}
          </Alert>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={requestClose}
            disabled={pending}
            aria-disabled={pending || undefined}
            data-testid="picker-delete-cancel"
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => void confirmDelete()}
            disabled={!canDelete}
            aria-disabled={!canDelete || undefined}
            data-testid="picker-delete-confirm-button"
          >
            {pending ? t("datasets.deleting") : t("datasets.deleteProfile")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
