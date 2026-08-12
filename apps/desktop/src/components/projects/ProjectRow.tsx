import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  MoreHorizontal,
  Pencil,
  Archive,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Meter,
  Money,
} from "@nixus/shared";
import { ProjectDetail } from "@/components/projects/ProjectDetail";
import { useProjectPace } from "@/hooks/useProjects";
import { useFormatCurrency } from "@/hooks/useFormatCurrency";
import {
  useMaskProps,
  useValuesHidden,
} from "@/contexts/ValuesVisibilityContext";
import { cn } from "@/lib/utils";
import type { Project, ProjectPace } from "@/lib/types";

// The status word leads every string so colour is never the only carrier of meaning.
const PACE_BADGE_KEYS: Record<
  Exclude<ProjectPace["status"], "neutral">,
  string
> = {
  good: "projects.paceBadgeGood",
  caution: "projects.paceBadgeCaution",
  over: "projects.paceBadgeOver",
};

interface ProjectRowProps {
  project: Project;
  savedCents: number;
  striped?: boolean;
  onEdit: (project: Project) => void;
  onArchive: (project: Project) => void;
  onMoveUp?: (project: Project) => void;
  onMoveDown?: (project: Project) => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
}

type MoveDirection = "up" | "down";

export function ProjectRow({
  project,
  savedCents,
  striped = false,
  onEdit,
  onArchive,
  onMoveUp,
  onMoveDown,
  canMoveUp = false,
  canMoveDown = false,
}: ProjectRowProps) {
  const { t, i18n } = useTranslation();
  const formatCurrency = useFormatCurrency();
  const maskProps = useMaskProps();
  const { hidden } = useValuesHidden();
  const [expanded, setExpanded] = useState(false);
  const moveUpRef = useRef<HTMLButtonElement | null>(null);
  const moveDownRef = useRef<HTMLButtonElement | null>(null);
  const pendingMoveFocus = useRef<MoveDirection | null>(null);

  // A keyboard move re-renders the row at a new index, where the control just pressed may have
  // become disabled (first/last row). Without this, focus falls back to <body> and the next
  // keypress does nothing, so repeated moves would need a fresh Tab each time.
  useEffect(() => {
    const direction = pendingMoveFocus.current;
    if (direction === null) return;
    pendingMoveFocus.current = null;
    const preferred = direction === "up" ? moveUpRef.current : moveDownRef.current;
    const fallback = direction === "up" ? moveDownRef.current : moveUpRef.current;
    const target = preferred?.disabled === false ? preferred : fallback;
    target?.focus();
  });

  const move = (direction: MoveDirection) => {
    pendingMoveFocus.current = direction;
    if (direction === "up") {
      onMoveUp?.(project);
      return;
    }
    onMoveDown?.(project);
  };

  const remainingCents = project.target_cents - savedCents;
  const reached = remainingCents <= 0;

  const { data: paces = [] } = useProjectPace();
  const pace = paces.find((entry) => entry.project_id === project.id);
  // A pace badge replaces the "to go" badge only when it can say something the amount cannot: the
  // goal is still open, it has a deadline, and Rust returned a rate. `neutral` keeps the plain
  // remaining badge rather than adding a second uninformative pill.
  const paceBadge =
    !reached &&
    project.target_date !== null &&
    pace !== undefined &&
    pace.status !== "neutral" &&
    pace.required_monthly_cents !== null
      ? {
          variant: pace.status,
          text: t(PACE_BADGE_KEYS[pace.status], {
            amount: formatCurrency(pace.required_monthly_cents),
          }),
        }
      : null;

  const progressSentence = t("projects.savedOfTarget", {
    saved: formatCurrency(savedCents),
    target: formatCurrency(project.target_cents),
  });

  return (
    <div
      className={cn("rounded-md px-2 py-2", striped && "bg-hover")}
      data-testid="project-row"
    >
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-1.5">
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => setExpanded(!expanded)}
            aria-label={
              expanded
                ? t("projects.collapseProject", { name: project.name })
                : t("projects.expandProject", { name: project.name })
            }
            aria-expanded={expanded}
            data-testid="project-expand-toggle"
          >
            {expanded ? (
              <ChevronDown className="text-ink-dim" aria-hidden="true" />
            ) : (
              <ChevronRight className="text-ink-dim" aria-hidden="true" />
            )}
          </Button>
          <span className="truncate text-label text-ink" data-testid="project-name">
            {project.name}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {onMoveUp && onMoveDown && (
            <div className="flex items-center">
              <Button
                ref={moveUpRef}
                variant="ghost"
                size="icon-sm"
                disabled={!canMoveUp}
                onClick={() => move("up")}
                className="text-ink-faint hover:text-ink"
                aria-label={t("projects.moveUp", { name: project.name })}
                data-testid="project-move-up"
              >
                <ArrowUp aria-hidden="true" />
              </Button>
              <Button
                ref={moveDownRef}
                variant="ghost"
                size="icon-sm"
                disabled={!canMoveDown}
                onClick={() => move("down")}
                className="text-ink-faint hover:text-ink"
                aria-label={t("projects.moveDown", { name: project.name })}
                data-testid="project-move-down"
              >
                <ArrowDown aria-hidden="true" />
              </Button>
            </div>
          )}
          <span className="text-label text-ink" data-testid="project-saved-target">
            <Money cents={savedCents} locale={i18n.language} {...maskProps} />
            <span aria-hidden="true"> / </span>
            <Money
              cents={project.target_cents}
              locale={i18n.language}
              {...maskProps}
            />
          </span>
          {paceBadge ? (
            <Badge variant={paceBadge.variant} data-testid="project-status-badge">
              {paceBadge.text}
            </Badge>
          ) : (
            <Badge
              variant={reached ? "good" : "neutral"}
              data-testid="project-status-badge"
            >
              {reached
                ? t("projects.reachedBadge")
                : t("projects.remainingBadge", {
                    amount: formatCurrency(remainingCents),
                  })}
            </Badge>
          )}
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
        </div>
      </div>
      {project.target_cents > 0 && (
        <Meter
          value={savedCents}
          max={project.target_cents}
          label={t("projects.meterLabel", { name: project.name })}
          valueText={hidden ? t("common.amountHidden") : progressSentence}
          data-testid="project-progress-bar"
        />
      )}
      {expanded && <ProjectDetail project={project} savedCents={savedCents} />}
    </div>
  );
}
