import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { format, parseISO } from "date-fns";
import { ImageOff, ImagePlus, MoreHorizontal, Trash2 } from "lucide-react";
import {
  Alert,
  Button,
  Card,
  CardContent,
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
  Skeleton,
} from "@nixus/shared";
import {
  useProjectImage,
  useRemoveProjectImage,
  useSetProjectImage,
} from "@/hooks/useProjects";
import { useProjectImagePicker } from "@/hooks/useProjectImagePicker";
import { projectImageMessageKey } from "@/lib/appError";
import type { Project } from "@/lib/types";

/**
 * The only generic key among the twenty shipped. Used when a rejection carries no field this build
 * recognizes, because naming a specific cause the backend did not report — "that file could not be
 * read" about a file that read fine — sends the user to fix the wrong thing.
 */
const SAVE_FAILED_KEY = "projects.image.saveFailed";

/** One bar, matching the single meta line the resolved card actually shows. */
const IMAGE_SKELETON_ROWS = 1;

interface ProjectImageCardProps {
  project: Project;
}

/**
 * The one picture a savings project may hold, inside the expanded row.
 *
 * Four states are distinct on purpose. `useProjectImage` runs with `retry: false`, so a rejected
 * read settles immediately with `data === undefined` — indistinguishable from the pending state by
 * `data` alone, and indistinguishable from "no picture yet" if `isError` is checked after the null
 * test. `isError` is therefore checked FIRST: telling someone a project with a picture has none is
 * the failure this ordering exists to prevent.
 *
 * The card carries no shadow. Elevation on a static container is a rule violation here, not a
 * styling preference — `DESIGN.md` permits shadow only on the floating layers (slide-over, dialog,
 * toast, popover), and this is an inline container inside a list row.
 */
export function ProjectImageCard({ project }: ProjectImageCardProps) {
  const { t } = useTranslation();
  const query = useProjectImage(project.id);
  const setImage = useSetProjectImage();
  const removeImage = useRemoveProjectImage();
  const { picked, errorKey: pickErrorKey, picking, pick, reset } =
    useProjectImagePicker();
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [writeErrorKey, setWriteErrorKey] = useState<string | null>(null);
  // The exact data URL that failed to decode, rather than a boolean: a replacement produces a new
  // URL, so the fallback clears itself without an effect or a remount key.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  const image = query.data ?? null;
  // Paired with its data URL rather than kept as two nullable locals: the URL is only meaningful
  // when there is an image, and one null test then narrows both without a non-null assertion.
  const shown =
    image === null
      ? null
      : {
          image,
          src: `data:${image.mime_type};base64,${image.image_base64}`,
        };
  const decodeFailed = shown !== null && shown.src === failedSrc;

  // `pick()` resolves after its own `setPicked`, so the path is not readable from the click handler
  // that awaited it — this render is the first place it exists. The selection is consumed once and
  // cleared, which is why a second pass over the same value cannot re-send it.
  useEffect(() => {
    if (picked === null) return;
    const filePath = picked.path;
    reset();
    setImage.mutate(
      { project_id: project.id, file_path: filePath },
      {
        onError: (error: unknown) => {
          setWriteErrorKey(projectImageMessageKey(error) ?? SAVE_FAILED_KEY);
        },
      }
    );
  }, [picked, reset, setImage.mutate, project.id]);

  const handlePick = () => {
    setWriteErrorKey(null);
    void pick();
  };

  const handleRemove = () => {
    removeImage.mutate(project.id, {
      onSuccess: () => setConfirmingRemove(false),
      onError: (error: unknown) => {
        setWriteErrorKey(projectImageMessageKey(error) ?? SAVE_FAILED_KEY);
        setConfirmingRemove(false);
      },
    });
  };

  // The picker owns refusals that happened before any write; this component owns the ones that came
  // back from a write. Either way the message is inline and the existing image stays on screen.
  const errorKey = writeErrorKey ?? pickErrorKey;
  const busy = picking || setImage.isPending || removeImage.isPending;

  return (
    <div className="space-y-2" data-testid="project-image-card">
      {query.isPending ? (
        <Skeleton
          rows={IMAGE_SKELETON_ROWS}
          className="h-40 sm:h-48"
          data-testid="project-image-skeleton"
        />
      ) : query.isError ? (
        <p className="text-caption text-ink-dim" data-testid="project-image-load-failed">
          {t("projects.image.loadFailed")}
        </p>
      ) : shown === null ? (
        <div
          className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
          data-testid="project-image-empty"
        >
          <p className="flex min-w-0 items-center gap-1.5 text-caption text-ink-dim">
            <ImagePlus className="size-4 shrink-0 text-ink-faint" aria-hidden="true" />
            <span className="text-label text-ink">
              {t("projects.image.emptyTitle")}
            </span>{" "}
            {t("projects.image.emptyDescription")}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            disabled={busy}
            onClick={handlePick}
            data-testid="project-image-add-button"
          >
            <ImagePlus aria-hidden="true" />
            {t("projects.image.addAction")}
          </Button>
        </div>
      ) : (
        <Card size="sm">
          {decodeFailed ? (
            // Deliberately not an <img> with a caption: a src the browser refused draws the broken
            // -image glyph, which reads as a rendering bug rather than an explanation.
            <CardContent
              className="flex h-40 flex-col items-center justify-center gap-1.5 rounded-md bg-track text-caption text-ink-dim sm:h-48"
              data-testid="project-image-unavailable"
            >
              <ImageOff className="size-5 text-ink-faint" aria-hidden="true" />
              {t("projects.image.unavailable")}
            </CardContent>
          ) : (
            // First child on purpose: `card.tsx` rounds the top corners of a leading image and drops
            // the card's top padding only for `>img:first-child`, so the picture meets the hairline.
            <img
              src={shown.src}
              alt={t("projects.image.alt", { name: project.name })}
              className="w-full h-40 sm:h-48 object-contain bg-track"
              onError={() => setFailedSrc(shown.src)}
              data-testid="project-image"
            />
          )}
          <CardContent className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p
              className="min-w-0 truncate text-caption text-ink-dim"
              data-testid="project-image-meta"
            >
              {t("projects.image.metaLine", {
                filename: shown.image.original_filename,
                date: format(parseISO(shown.image.uploaded_at), "MMM d, yyyy"),
              })}
            </p>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={handlePick}
                data-testid="project-image-replace-button"
              >
                {t("projects.image.replaceAction")}
              </Button>
              {/* Removal is demoted into the overflow menu behind a confirm, never a styled peer of
                  Replace. The trigger reuses the row-actions name because the twenty shipped keys
                  carry no overflow label, and naming it after the destructive item would make the
                  demotion cosmetic. */}
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-ink-faint hover:text-ink"
                      disabled={busy}
                      aria-label={t("projects.rowActions", { name: project.name })}
                      data-testid="project-image-menu"
                    />
                  }
                >
                  <MoreHorizontal aria-hidden="true" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => setConfirmingRemove(true)}
                    data-testid="remove-project-image-button"
                  >
                    <Trash2 aria-hidden="true" />
                    {t("projects.image.removeAction")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </CardContent>
        </Card>
      )}

      {errorKey !== null && (
        <Alert
          variant="over"
          icon={<ImageOff />}
          data-testid="project-image-error"
        >
          {t(errorKey)}
        </Alert>
      )}

      <Dialog
        open={confirmingRemove}
        onOpenChange={(open) => {
          if (!open) setConfirmingRemove(false);
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
            <Button variant="outline" onClick={() => setConfirmingRemove(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={removeImage.isPending}
              onClick={handleRemove}
              data-testid="confirm-remove-project-image-button"
            >
              {t("projects.image.removeAction")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
