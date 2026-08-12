import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import {
  differenceInCalendarDays,
  differenceInCalendarMonths,
  format,
  parseISO,
} from "date-fns";
import {
  InfoIcon,
  Plus,
  Sparkles,
  Trash2,
  TriangleAlertIcon,
} from "lucide-react";
import { toast } from "sonner";
import {
  Alert,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardHeader,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Money,
  Skeleton,
  SlideOver,
} from "@nixus/shared";
import { ProjectContributionForm } from "@/components/projects/ProjectContributionForm";
import { MetricInfoTooltip } from "@/components/financial-health/MetricInfoTooltip";
import {
  useDeleteProjectContribution,
  useProjectContributions,
  useProjectPace,
} from "@/hooks/useProjects";
import { useProjectAdvice } from "@/hooks/useProjectAdvice";
import { useAiConfig } from "@/hooks/useAiConfig";
import { useAccounts } from "@/hooks/useAccounts";
import { useFormatCurrency } from "@/hooks/useFormatCurrency";
import { useMaskProps } from "@/contexts/ValuesVisibilityContext";
import type { Project, ProjectAdviceResponse, ProjectContribution } from "@/lib/types";

// Below this many days out, a monthly figure is no longer actionable — nobody plans "$400 this month"
// when the deadline is five weeks away — so the weekly restatement appears only inside the window.
const WEEKLY_RESTATEMENT_MAX_DAYS = 56;
const WEEKS_PER_YEAR = 52;
const MONTHS_PER_YEAR = 12;

/** Headline plus two body lines — the shape the resolved advice actually has. */
const ADVICE_SKELETON_ROWS = 3;

const TONE_VARIANT: Record<
  ProjectAdviceResponse["tone"],
  "good" | "caution" | "neutral"
> = {
  positive: "good",
  caution: "caution",
  calm: "neutral",
};


interface ProjectDetailProps {
  project: Project;
  savedCents: number;
}

export function ProjectDetail({ project, savedCents }: ProjectDetailProps) {
  const { t, i18n } = useTranslation();
  const maskProps = useMaskProps();
  const formatCurrency = useFormatCurrency();
  const [showContributionForm, setShowContributionForm] = useState(false);
  const [deletingContribution, setDeletingContribution] =
    useState<ProjectContribution | null>(null);
  const [adviceRequested, setAdviceRequested] = useState(false);
  const { data: contributions = [] } = useProjectContributions(project.id);
  const { data: accounts = [] } = useAccounts();
  const { data: paces = [] } = useProjectPace();
  const { data: aiConfig } = useAiConfig();
  const deleteContribution = useDeleteProjectContribution();

  const remainingCents = Math.max(0, project.target_cents - savedCents);
  // Display-only division on integer cents; no percentage is ever stored or transmitted.
  const percentComplete =
    project.target_cents > 0
      ? Math.round((savedCents / project.target_cents) * 100)
      : 0;

  const pace = paces.find((entry) => entry.project_id === project.id);
  const requiredMonthlyCents = pace?.required_monthly_cents ?? null;
  const targetDate = project.target_date;
  // The line is only honest when Rust actually produced a rate against a real date: a `neutral`
  // project has no required pace, and inventing one from the remaining amount is exactly the
  // frontend arithmetic this feature exists to avoid.
  const showPaceLine = requiredMonthlyCents !== null && targetDate !== null;
  const daysToTarget =
    targetDate === null
      ? null
      : differenceInCalendarDays(parseISO(targetDate), new Date());
  const showWeeklyRestatement =
    showPaceLine &&
    daysToTarget !== null &&
    daysToTarget >= 0 &&
    daysToTarget <= WEEKLY_RESTATEMENT_MAX_DAYS;

  const accountLabel = (accountId: number) =>
    accounts.find((account) => account.id === accountId)?.name ??
    String(accountId);

  const aiConfigured = aiConfig?.configured ?? false;
  // Only a project the backend itself judged behind may ask. `good`, `neutral`, a reached goal and a
  // project with no required rate all fail this, so the button cannot appear where there is no
  // grounded shortfall to explain.
  const canAskForAdvice =
    (pace?.status === "caution" || pace?.status === "over") &&
    requiredMonthlyCents !== null &&
    remainingCents > 0;
  const monthsToTarget =
    targetDate === null
      ? null
      : differenceInCalendarMonths(parseISO(targetDate), new Date());

  // Built every render, not inside the click handler: the query reads these as `queryFn` input on
  // every (re)fetch, so a stale-captured object would let a re-click send figures the row no longer
  // shows. The `?? 0` is unreachable — a null required rate renders no button and short-circuits
  // `handleAskForAdvice`, so no request is ever sent with the fallback.
  const advice = useProjectAdvice(project.id, {
    projectName: project.name,
    remainingCents,
    requiredMonthlyCents: requiredMonthlyCents ?? 0,
    actualMonthlyCents: pace?.actual_monthly_cents ?? null,
    monthsToTarget,
  });

  // The provider is never touched until this runs, and it is only reachable from onClick. An
  // unconfigured provider stops here rather than firing a call that would fail by construction.
  const handleAskForAdvice = () => {
    setAdviceRequested(true);
    if (!aiConfigured || requiredMonthlyCents === null) return;

    advice.refetch();
  };

  const handleDelete = () => {
    if (!deletingContribution) return;
    deleteContribution.mutate(deletingContribution.id, {
      onSuccess: () => {
        toast.success(t("toast.deleteSuccess"));
        setDeletingContribution(null);
      },
      onError: () => {
        toast.error(t("toast.deleteFailed"));
        setDeletingContribution(null);
      },
    });
  };

  return (
    <div className="mt-2.5 space-y-3" data-testid="project-detail">
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
        <span className="text-caption text-ink-dim">
          {t("projects.savedLabel")}{" "}
          <span className="text-label text-ink" data-testid="project-saved-amount">
            <Money cents={savedCents} locale={i18n.language} {...maskProps} />
          </span>
        </span>
        <span className="text-caption text-ink-dim">
          {t("projects.remainingLabel")}{" "}
          <span
            className="text-label text-ink"
            data-testid="project-remaining-amount"
          >
            <Money
              cents={remainingCents}
              locale={i18n.language}
              {...maskProps}
            />
          </span>
        </span>
        {project.target_cents > 0 && (
          <span className="text-caption text-ink-dim" data-testid="project-percent">
            {t("projects.percentComplete", { percent: percentComplete })}
          </span>
        )}
      </div>

      {showPaceLine && requiredMonthlyCents !== null && targetDate !== null && (
        <div className="space-y-0.5" data-testid="project-pace-line">
          <p className="flex items-center gap-1 text-caption text-ink-dim">
            {t("projects.paceLine", {
              amount: formatCurrency(requiredMonthlyCents),
              target: formatCurrency(project.target_cents),
              date: format(parseISO(targetDate), "MMM d, yyyy"),
            })}
            <MetricInfoTooltip
              ariaLabel={t("projects.paceMathInfoAria")}
              content={t("projects.paceMathInfo")}
              testId="project-pace-info"
            />
          </p>
          {showWeeklyRestatement && (
            <p
              className="text-caption text-ink-faint"
              data-testid="project-pace-weekly"
            >
              {t("projects.paceWeeklyLine", {
                amount: formatCurrency(
                  Math.round(
                    (requiredMonthlyCents * MONTHS_PER_YEAR) / WEEKS_PER_YEAR
                  )
                ),
              })}
            </p>
          )}
        </div>
      )}

      {canAskForAdvice && (
        <div className="space-y-2" data-testid="project-advice">
          <Button
            size="sm"
            variant="outline"
            onClick={handleAskForAdvice}
            disabled={advice.isFetching}
            data-testid="project-advice-button"
          >
            <Sparkles aria-hidden="true" />
            {t("projects.paceAdviceAction")}
          </Button>

          {adviceRequested && !aiConfigured ? (
            <Card flush data-testid="project-advice-not-configured">
              <Alert variant="info" icon={<InfoIcon />}>
                <AlertTitle>{t("projects.adviceNotConfigured")}</AlertTitle>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  render={<Link to="/settings" />}
                  data-testid="project-advice-settings-link"
                >
                  {t("settings.openSettings")}
                </Button>
              </Alert>
            </Card>
          ) : advice.isFetching ? (
            <Card data-testid="project-advice-loading">
              <CardContent>
                <p className="mb-3 text-caption text-ink-dim">
                  {t("projects.adviceSkeleton")}
                </p>
                <Skeleton
                  rows={ADVICE_SKELETON_ROWS}
                  data-testid="project-advice-skeleton"
                />
              </CardContent>
            </Card>
          ) : advice.isError ? (
            <Card flush data-testid="project-advice-error">
              <Alert variant="over" icon={<TriangleAlertIcon />}>
                <AlertTitle>{t("projects.adviceError")}</AlertTitle>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={handleAskForAdvice}
                  data-testid="project-advice-retry"
                >
                  {t("projects.adviceRetry")}
                </Button>
              </Alert>
            </Card>
          ) : advice.isSuccess ? (
            <Card data-testid="project-advice-panel">
              <CardHeader>
                <h3 className="text-h2 text-ink" data-testid="project-advice-headline">
                  {advice.data.headline}
                </h3>
                <CardAction>
                  <Badge
                    variant={TONE_VARIANT[advice.data.tone]}
                    data-testid="project-advice-tone"
                  >
                    {advice.data.project_name}
                  </Badge>
                </CardAction>
              </CardHeader>
              <CardContent>
                <p className="text-body text-ink-dim" data-testid="project-advice-body">
                  {advice.data.body}
                </p>
              </CardContent>
            </Card>
          ) : null}
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <span className="text-label text-ink">
          {t("projects.contributionHistory")}
        </span>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setShowContributionForm(true)}
          data-testid="add-contribution-button"
        >
          <Plus aria-hidden="true" />
          {t("projects.addContribution")}
        </Button>
      </div>

      {contributions.length === 0 ? (
        <p
          className="text-caption text-ink-dim"
          data-testid="contribution-history-empty"
        >
          {t("projects.contributionHistoryEmpty")}
        </p>
      ) : (
        <ul className="space-y-1" data-testid="contribution-history">
          <li
            className="flex items-center justify-between gap-3 text-caption text-ink-faint"
            aria-hidden="true"
          >
            <span className="w-20 shrink-0">
              {t("projects.contributionColDate")}
            </span>
            <span className="min-w-0 flex-1 truncate">
              {t("projects.contributionColAccount")}
            </span>
            <span>{t("projects.contributionColAmount")}</span>
            <span className="size-7" />
          </li>
          {contributions.map((contribution) => (
            <li
              key={contribution.id}
              className="flex items-center justify-between gap-3 text-caption"
              data-testid="contribution-row"
            >
              <span className="w-20 shrink-0 text-ink-dim">
                {contribution.date}
              </span>
              <span className="min-w-0 flex-1 truncate text-ink-dim">
                {accountLabel(contribution.account_id)}
              </span>
              <span className="text-label text-ink">
                <Money
                  cents={contribution.amount_cents}
                  locale={i18n.language}
                  {...maskProps}
                />
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-ink-faint hover:text-over"
                onClick={() => setDeletingContribution(contribution)}
                aria-label={t("projects.deleteContribution")}
                data-testid="delete-contribution-button"
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}

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

      <Dialog
        open={deletingContribution !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingContribution(null);
        }}
      >
        <DialogContent data-testid="delete-contribution-dialog">
          <DialogHeader>
            <DialogTitle>{t("projects.deleteContributionTitle")}</DialogTitle>
            <DialogDescription>
              {t("projects.deleteContributionDescription")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeletingContribution(null)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              data-testid="confirm-delete-contribution-button"
            >
              {t("common.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
