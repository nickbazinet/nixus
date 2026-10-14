import { useTranslation } from "react-i18next";
import { CloudDownload, TriangleAlertIcon } from "lucide-react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  Skeleton,
} from "@nixus/shared";
import { useFetchProjectImage, useProjectImage } from "@/hooks/useProjects";
import { isSyncError, parseAppError, syncMessageKey } from "@/lib/appError";
import type { Project } from "@/lib/types";

/** The picture and the one line of meta under it: the shape the loaded card actually has. */
const IMAGE_SKELETON_ROWS = 2;

interface ProjectImageCardProps {
  project: Project;
}

/**
 * This project's full-size picture, fetched from the cloud the first time it is asked for (AD-10,
 * CAP-6).
 *
 * The state that makes this component exist is `full_image_available: false`: the row arrived in a
 * snapshot carrying its thumbnail and its `image_sha256` but not its payload, so the picture
 * exists and this computer simply does not hold it yet. That is rendered as the preview plus an
 * explanation and ONE button, never as an error and never as a blank frame.
 *
 * The download is explicit rather than automatic on first view. Expanding a row is a cheap
 * gesture, and spending several megabytes of someone's connection on it — for every row they open
 * — is not something they asked for. A project with no picture at all renders nothing here: the
 * row's thumbnail tile is already the one place a picture is added.
 */
export function ProjectImageCard({ project }: ProjectImageCardProps) {
  const { t } = useTranslation();
  const image = useProjectImage(project.id);
  const fetchImage = useFetchProjectImage();

  if (image.isPending) {
    return (
      <Card data-testid="project-image-loading">
        <CardContent>
          <Skeleton rows={IMAGE_SKELETON_ROWS} data-testid="project-image-skeleton" />
        </CardContent>
      </Card>
    );
  }

  if (image.isError) {
    return (
      <Card flush data-testid="project-image-read-error">
        <Alert variant="over" icon={<TriangleAlertIcon />}>
          <AlertTitle>{t("projects.image.unavailable")}</AlertTitle>
        </Alert>
      </Card>
    );
  }

  const payload = image.data;
  if (!payload) return null;

  if (payload.full_image_available && payload.image_base64 !== null) {
    return (
      <Card data-testid="project-image-card">
        <CardContent>
          <img
            src={`data:${payload.mime_type};base64,${payload.image_base64}`}
            alt={t("projects.image.alt", { name: project.name })}
            className="max-h-80 w-full rounded-md object-contain"
            data-testid="project-image-full"
          />
        </CardContent>
      </Card>
    );
  }

  // A sync refusal has a stable code and its own sentence; anything else gets the one generic
  // line, because guessing at an unknown failure is worse than saying the download did not work.
  const parsed = parseAppError(fetchImage.error);
  const errorTitle = isSyncError(parsed)
    ? t(syncMessageKey(parsed.code))
    : t("projects.image.loadFailed");

  return (
    <Card data-testid="project-image-placeholder">
      <CardContent className="space-y-3">
        {payload.thumbnail_base64 !== null && payload.thumbnail_mime !== null && (
          <img
            src={`data:${payload.thumbnail_mime};base64,${payload.thumbnail_base64}`}
            alt={t("projects.image.alt", { name: project.name })}
            // Blurred on purpose: a 64 KiB preview stretched to card width would otherwise read as
            // "the picture loaded badly" rather than as "this is a preview of what is coming".
            className="max-h-56 w-full rounded-md object-contain blur-[1px]"
            data-testid="project-image-thumbnail-preview"
          />
        )}

        {fetchImage.isPending ? (
          <p className="text-caption text-ink-dim" data-testid="project-image-fetching">
            {t("projects.image.loadingFull")}
          </p>
        ) : fetchImage.isError ? (
          <Alert variant="over" icon={<TriangleAlertIcon />} data-testid="project-image-fetch-error">
            <AlertTitle>{errorTitle}</AlertTitle>
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => fetchImage.mutate(project.id)}
              data-testid="project-image-fetch-retry"
            >
              {t("projects.image.loadRetry")}
            </Button>
          </Alert>
        ) : (
          <Alert variant="info" icon={<CloudDownload />}>
            <AlertTitle>{t("projects.image.notOnThisComputer")}</AlertTitle>
            <AlertDescription>
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => fetchImage.mutate(project.id)}
                data-testid="project-image-fetch-button"
              >
                <CloudDownload aria-hidden="true" />
                {t("projects.image.loadFullAction")}
              </Button>
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
