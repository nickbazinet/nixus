import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Archive, ImageOff, MoreHorizontal, Pencil } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@nixus/shared";
import {
  useProjectThumbnails,
  useRemoveProjectImage,
} from "@/hooks/useProjects";
import { GENERIC_FAILURE_KEY } from "@/hooks/useProjectImagePicker";
import { projectImageMessageKey } from "@/lib/appError";
import type { Project } from "@/lib/types";

interface ProjectRowMenuProps {
  project: Project;
  onEdit: (project: Project) => void;
  onArchive: (project: Project) => void;
  onImageErrorKey: (key: string | null) => void;
}

/**
 * The row's overflow menu and the confirmations it opens.
 *
 * Image removal lives here rather than beside the thumbnail: adding and replacing are the everyday
 * actions and belong on the picture itself, while deleting is rare and destructive, so it is demoted
 * into the same menu that already holds Archive and stays behind a confirmation.
 *
 * The image entry is conditional on the shared thumbnail query — the same key the tile reads, so this
 * adds no IPC — because offering to remove a picture that does not exist is an action that can only
 * fail.
 */
export function ProjectRowMenu({
  project,
  onEdit,
  onArchive,
  onImageErrorKey,
}: ProjectRowMenuProps) {
  const { t } = useTranslation();
  const { data: thumbnails = [] } = useProjectThumbnails();
  const removeImage = useRemoveProjectImage();
  const [confirmingImageRemove, setConfirmingImageRemove] = useState(false);

  const hasImage = thumbnails.some((entry) => entry.project_id === project.id);

  const handleRemoveImage = () => {
    removeImage.mutate(project.id, {
      onSuccess: () => {
        // A standing refusal from an earlier add or replace describes a picture that is now gone, so
        // it goes with it rather than sitting beside an empty tile.
        onImageErrorKey(null);
        setConfirmingImageRemove(false);
      },
      onError: (error: unknown) => {
        onImageErrorKey(projectImageMessageKey(error) ?? GENERIC_FAILURE_KEY);
        setConfirmingImageRemove(false);
      },
    });
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("projects.rowActions", { name: project.name })}
              data-testid="project-row-menu"
            />
          }
        >
          <MoreHorizontal aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onClick={() => onEdit(project)}
            data-testid="edit-project-button"
          >
            <Pencil aria-hidden="true" />
            {t("projects.editProject")}
          </DropdownMenuItem>
          {hasImage && (
            <DropdownMenuItem
              variant="destructive"
              onClick={() => setConfirmingImageRemove(true)}
              data-testid="remove-project-image-button"
            >
              <ImageOff aria-hidden="true" />
              {t("projects.image.removeAction")}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            variant="destructive"
            onClick={() => onArchive(project)}
            data-testid="archive-project-button"
          >
            <Archive aria-hidden="true" />
            {t("projects.archive")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        open={confirmingImageRemove}
        onOpenChange={(open) => {
          if (!open) setConfirmingImageRemove(false);
        }}
      >
        <DialogContent data-testid="remove-project-image-dialog">
          <DialogHeader>
            <DialogTitle>{t("projects.image.removeTitle")}</DialogTitle>
            <DialogDescription>
              {t("projects.image.removeDescription")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmingImageRemove(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={removeImage.isPending}
              onClick={handleRemoveImage}
              data-testid="confirm-remove-project-image-button"
            >
              {t("projects.image.removeAction")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
