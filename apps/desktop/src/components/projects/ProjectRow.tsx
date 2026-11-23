import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { format, parseISO } from "date-fns";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ImageOff,
} from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardFooter,
  Money,
  SlideOver,
} from "@nixus/shared";
import { ProjectContributionForm } from "@/components/projects/ProjectContributionForm";
import { ProjectDetail } from "@/components/projects/ProjectDetail";
import { ProjectRowMenu } from "@/components/projects/ProjectRowMenu";
import { ProjectRowThumbnail } from "@/components/projects/ProjectRowThumbnail";
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
  onEdit: (project: Project) => void;
  onArchive: (project: Project) => void;
  onMoveUp?: (project: Project) => void;
  onMoveDown?: (project: Project) => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
}

type MoveDirection = "up" | "down";

const RING_SIZE = 110;
const RING_STROKE = 9;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/**
 * The goal's progress as a dial rather than a bar: a project is one reading on its own card, and a
 * ring puts the share and the figure it refers to in the same glance. Still a `progressbar` to
 * assistive tech, with the same name and spoken value the bar carried.
 */
function ProgressRing({
  percent,
  label,
  valueText,
}: {
  percent: number;
  label: string;
  valueText: string;
}) {
  const clamped = Math.min(100, Math.max(0, percent));

  return (
    <div
      className="relative shrink-0"
      style={{ width: RING_SIZE, height: RING_SIZE }}
      role="progressbar"
      aria-label={label}
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuetext={valueText}
      data-testid="project-progress-bar"
    >
      <svg
        viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
        className="size-full -rotate-90"
        aria-hidden="true"
      >
        <circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          fill="none"
          stroke="var(--track)"
          strokeWidth={RING_STROKE}
        />
        {clamped > 0 && (
          <circle
            cx={RING_SIZE / 2}
            cy={RING_SIZE / 2}
            r={RING_RADIUS}
            fill="none"
            stroke="var(--chart-2)"
            strokeWidth={RING_STROKE}
            strokeLinecap="round"
            strokeDasharray={RING_CIRCUMFERENCE}
            strokeDashoffset={RING_CIRCUMFERENCE * (1 - clamped / 100)}
          />
        )}
      </svg>
      <span className="absolute inset-0 grid place-items-center text-h1 text-ink">
        {Math.round(clamped)}%
      </span>
    </div>
  );
}

export function ProjectRow({
  project,
  savedCents,
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
  const [showContributionForm, setShowContributionForm] = useState(false);
  // Shared by the tile (add/replace) and the menu (remove): neither has room for a sentence, and two
  // independent alerts in one row would let a stale refusal sit beside a fresh one.
  const [imageErrorKey, setImageErrorKey] = useState<string | null>(null);
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
  // Display-only division on integer cents; no percentage is ever stored or transmitted.
  const percentComplete =
    project.target_cents > 0 ? (savedCents / project.target_cents) * 100 : 0;

  const { data: paces = [] } = useProjectPace();
  const pace = paces.find((entry) => entry.project_id === project.id);
  const requiredMonthlyCents = pace?.required_monthly_cents ?? null;
  const actualMonthlyCents = pace?.actual_monthly_cents ?? null;
  // A pace badge replaces the "to go" badge only when it can say something the amount cannot: the
  // goal is still open, it has a deadline, and Rust returned a required rate. A verdict always shows
  // the actual average beside the required one, so the status is never contradicted by the number
  // next to it. A project too new to judge (`neutral` with a rate) shows only what it needs.
  const hasPlan =
    !reached &&
    project.target_date !== null &&
    pace !== undefined &&
    requiredMonthlyCents !== null;
  const paceBadge = !hasPlan
    ? null
    : pace.status === "neutral" || actualMonthlyCents === null
      ? {
          variant: pace.status,
          text: t("projects.paceBadgeNeeded", {
            amount: formatCurrency(requiredMonthlyCents),
          }),
        }
      : {
          variant: pace.status,
          text: t(PACE_BADGE_KEYS[pace.status], {
            actual: formatCurrency(actualMonthlyCents),
            required: formatCurrency(requiredMonthlyCents),
          }),
        };

  const progressSentence = t("projects.savedOfTarget", {
    saved: formatCurrency(savedCents),
    target: formatCurrency(project.target_cents),
  });

  return (
    <Card className="h-full gap-0" data-testid="project-row">
      <div className="flex items-start gap-3 px-card-pad">
        <ProjectRowThumbnail
          project={project}
          onImageErrorKey={setImageErrorKey}
        />
        <h3
          className="min-w-0 flex-1 truncate pt-2 text-h1 text-ink"
          data-testid="project-name"
        >
          {project.name}
        </h3>
        <div className="-mr-2 shrink-0 pt-1">
          <ProjectRowMenu
            project={project}
            reached={reached}
            onEdit={onEdit}
            onArchive={onArchive}
            onImageErrorKey={setImageErrorKey}
          />
        </div>
      </div>

      <div className="mt-2.5 px-card-pad">
        {paceBadge ? (
          <Badge
            variant={paceBadge.variant}
            className="whitespace-normal text-left"
            data-testid="project-status-badge"
          >
            {paceBadge.text}
          </Badge>
        ) : (
          <Badge
            variant={reached ? "good" : "brand"}
            className="whitespace-normal text-left"
            data-testid="project-status-badge"
          >
            {reached
              ? t("projects.reachedBadge")
              : t("projects.remainingBadge", {
                  amount: formatCurrency(remainingCents),
                })}
          </Badge>
        )}
      </div>

      <div className="mt-5 flex items-center gap-5 px-card-pad">
        {project.target_cents > 0 && (
          <ProgressRing
            percent={percentComplete}
            label={t("projects.meterLabel", { name: project.name })}
            valueText={hidden ? t("common.amountHidden") : progressSentence}
          />
        )}
        <div className="min-w-0" data-testid="project-saved-target">
          <p className="money text-stat text-ink">
            <Money cents={savedCents} locale={i18n.language} {...maskProps} />
          </p>
          <p className="money text-caption text-ink-dim">
            {t("wealth.v2.projects.ofTarget", {
              amount: formatCurrency(project.target_cents),
            })}
          </p>
        </div>
      </div>

      <dl className="mt-5 px-card-pad">
        <div className="flex items-center justify-between gap-3 border-b border-line py-3">
          <dt className="text-caption text-ink-dim">
            {t("wealth.v2.projects.targetDate")}
          </dt>
          <dd className="text-label font-bold text-ink">
            {project.target_date
              ? format(parseISO(project.target_date), "MMM yyyy")
              : t("wealth.v2.projects.noTargetDate")}
          </dd>
        </div>
        {requiredMonthlyCents !== null && (
          <div className="flex items-center justify-between gap-3 py-3">
            <dt className="text-caption text-ink-dim">
              {t("wealth.v2.projects.perMonth")}
            </dt>
            <dd className="money text-label font-bold text-ink">
              {formatCurrency(requiredMonthlyCents)}
            </dd>
          </div>
        )}
      </dl>

      <div className="mt-2 flex items-center justify-between gap-2 px-card-pad">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setExpanded(!expanded)}
          aria-label={
            expanded
              ? t("projects.collapseProject", { name: project.name })
              : t("projects.expandProject", { name: project.name })
          }
          aria-expanded={expanded}
          className="-ml-2 text-ink-dim"
          data-testid="project-expand-toggle"
        >
          {t("projects.detailsToggle")}
          <ChevronDown
            className={cn("transition-transform", expanded && "rotate-180")}
            aria-hidden="true"
          />
        </Button>
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
      </div>

      {imageErrorKey !== null && (
        <Alert
          variant="over"
          icon={<ImageOff />}
          className="mx-card-pad mt-3"
          data-testid="project-image-error"
        >
          {t(imageErrorKey)}
        </Alert>
      )}

      {expanded && (
        <div className="px-card-pad">
          <ProjectDetail project={project} savedCents={savedCents} />
        </div>
      )}

      <CardFooter className="mt-auto">
        <Button
          size="lg"
          variant={savedCents > 0 ? "default" : "outline"}
          className="w-full"
          onClick={() => setShowContributionForm(true)}
          data-testid="project-add-money"
        >
          {savedCents > 0
            ? t("wealth.v2.projects.addMoney")
            : t("wealth.v2.projects.startSaving")}
        </Button>
      </CardFooter>

      <SlideOver
        open={showContributionForm}
        onClose={() => setShowContributionForm(false)}
        title={t("projects.addContribution")}
        description={t("projects.addContributionDescription")}
        data-testid="contribution-slide-over"
      >
        <ProjectContributionForm
          projectId={project.id}
          onClose={() => setShowContributionForm(false)}
        />
      </SlideOver>
    </Card>
  );
}
