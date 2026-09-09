import { useTranslation } from "react-i18next";
import { ImageIcon } from "lucide-react";
import { useProjectThumbnails } from "@/hooks/useProjects";
import type { Project } from "@/lib/types";

// The tile geometry both states share, so a placeholder can never disagree with a picture about
// how much room the row gives it.
const TILE_CLASSES = "size-14 shrink-0 rounded-md bg-track";

/**
 * One project's picture at row scale, or a neutral placeholder when it has none.
 *
 * PRESENTATIONAL ONLY. Adding, replacing and removing all stay in the expanded detail's
 * `ProjectImageCard`, because a file picker plus a destructive action inside a dense list row is
 * the destructive-as-peer pattern `EXPERIENCE.md` bans. Nothing here is focusable or clickable.
 *
 * The read is the shared list-wide query, the same way `ProjectRow` uses `useProjectPace`: every
 * row calls it and react-query collapses them onto one key, so a page of ten rows costs ONE IPC
 * round trip. The full-size payload is deliberately never read here — it stays behind
 * `ProjectDetail`, which exists only while a row is expanded.
 */
export function ProjectRowThumbnail({ project }: { project: Project }) {
  const { t } = useTranslation();
  const { data: thumbnails = [] } = useProjectThumbnails();
  const thumbnail = thumbnails.find((entry) => entry.project_id === project.id);

  if (thumbnail === undefined) {
    return (
      <div
        role="img"
        aria-label={t("projects.image.thumbnailEmpty")}
        className={`flex items-center justify-center ${TILE_CLASSES}`}
        data-testid="project-thumbnail-empty"
      >
        <ImageIcon className="size-5 text-ink-faint" aria-hidden="true" />
      </div>
    );
  }

  return (
    <img
      src={`data:${thumbnail.mime_type};base64,${thumbnail.image_base64}`}
      alt={t("projects.image.thumbnailAlt", { name: project.name })}
      className={`object-cover ${TILE_CLASSES}`}
      data-testid="project-thumbnail"
    />
  );
}
