import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ImageIcon, ImagePlus } from "lucide-react";
import { Button } from "@nixus/shared";
import { useProjectThumbnails, useSetProjectImage } from "@/hooks/useProjects";
import {
  GENERIC_FAILURE_KEY,
  useProjectImagePicker,
} from "@/hooks/useProjectImagePicker";
import { projectImageMessageKey } from "@/lib/appError";
import { cn } from "@/lib/utils";
import type { Project } from "@/lib/types";

interface ProjectRowThumbnailProps {
  project: Project;
  /**
   * Where a refusal goes. The row owns the message because a 56px tile has no room for a sentence,
   * and because removal — which lives in the row's own menu — has to report through the same slot;
   * two independent alerts inside one row would let a stale one sit beside a fresh one.
   */
  onImageErrorKey: (key: string | null) => void;
}

/**
 * One project's picture at row scale, and the only control that adds or replaces it.
 *
 * The tile IS the upload affordance rather than a preview beside one: a second mechanism in the
 * expanded detail would mean two ways to do one thing, and the picture the user is about to change
 * is the most obvious thing to aim at. Removal is deliberately NOT here — it stays demoted in the
 * row's overflow menu, because a destructive action as a peer of the thumbnail is the pattern
 * `EXPERIENCE.md` bans.
 *
 * The read is the shared list-wide query, the same way `ProjectRow` uses `useProjectPace`: every row
 * calls it and react-query collapses them onto one key, so a page of ten rows costs ONE IPC round
 * trip. The full-size payload is never read here — the row must not pay ~4 MiB of base64 to draw a
 * 56px tile, and after this component became the editor there is no surface left that wants it.
 */
export function ProjectRowThumbnail({
  project,
  onImageErrorKey,
}: ProjectRowThumbnailProps) {
  const { t } = useTranslation();
  const { data: thumbnails = [] } = useProjectThumbnails();
  const setImage = useSetProjectImage();
  const { picked, errorKey: pickErrorKey, picking, pick, reset } =
    useProjectImagePicker();

  const thumbnail = thumbnails.find((entry) => entry.project_id === project.id);

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
          onImageErrorKey(projectImageMessageKey(error) ?? GENERIC_FAILURE_KEY);
        },
      }
    );
  }, [picked, reset, setImage.mutate, project.id, onImageErrorKey]);

  // The `reset()` in `handleClick` is what makes this fire twice for the same rejected file: without
  // it `pickErrorKey` keeps its previous value, React bails out of the identical setState, and the
  // second refusal never reappears.
  useEffect(() => {
    if (pickErrorKey === null) return;
    onImageErrorKey(pickErrorKey);
  }, [pickErrorKey, onImageErrorKey]);

  const handleClick = () => {
    onImageErrorKey(null);
    reset();
    void pick();
  };

  return (
    <Button
      variant="secondary"
      size="icon"
      // The row's geometry is unchanged from when the tile was presentational: hover and focus are
      // the only things that changed, and they say "interactive" without moving anything.
      className={cn(
        "group/tile relative size-14 overflow-hidden rounded-md bg-track p-0",
        "hover:border-line-strong"
      )}
      disabled={picking || setImage.isPending}
      onClick={handleClick}
      aria-label={t(
        thumbnail === undefined
          ? "projects.image.addLabel"
          : "projects.image.replaceLabel",
        { name: project.name }
      )}
      data-testid="project-thumbnail-button"
    >
      {thumbnail === undefined ? (
        <ImageIcon
          className="size-5 text-ink-faint"
          aria-hidden="true"
          data-testid="project-thumbnail-empty"
        />
      ) : (
        <>
          <img
            src={`data:${thumbnail.mime_type};base64,${thumbnail.image_base64}`}
            // Decorative: the button's own name already says whose picture this is and what
            // activating it does, so an alt here would only repeat it.
            alt=""
            className="size-full object-cover"
            data-testid="project-thumbnail"
          />
          {/* The hover bg the empty tile relies on is invisible under a photograph, so a populated
              tile states its affordance over the picture instead. */}
          <span className="pointer-events-none absolute inset-0 hidden items-center justify-center bg-ink/45 group-hover/tile:flex group-focus-visible/tile:flex">
            <ImagePlus className="size-4 text-brand-on" aria-hidden="true" />
          </span>
        </>
      )}
    </Button>
  );
}
