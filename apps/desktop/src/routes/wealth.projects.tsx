import { useState } from "react";
import { useTranslation } from "react-i18next";
import { createFileRoute } from "@tanstack/react-router";
import { format, parseISO } from "date-fns";
import { Plus, Target } from "lucide-react";
import { toast } from "sonner";
import {
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Skeleton,
  SlideOver,
} from "@nixus/shared";
import { PageHeader } from "@/components/shared/PageHeader";
import { ProjectForm } from "@/components/projects/ProjectForm";
import { ProjectRow } from "@/components/projects/ProjectRow";
import { SettledAllocationCard } from "@/components/projects/SettledAllocationCard";
import {
  SuggestedAllocationPanel,
  type SuggestedAllocationDraft,
} from "@/components/projects/SuggestedAllocationPanel";
import { useProjectReorder } from "@/hooks/useProjectReorder";
import { useFinancialHealthSummary } from "@/hooks/useFinancialHealth";
import {
  useArchiveProject,
  useClearSuggestedAllocationSkip,
  useConfirmProjectAllocations,
  useProjects,
  useProjectSavedTotals,
  useSkipSuggestedAllocation,
  useSuggestedAllocation,
} from "@/hooks/useProjects";
import type { Project } from "@/lib/types";

export const Route = createFileRoute("/wealth/projects")({
  component: ProjectsPage,
});

const FALLBACK_SKELETON_ROWS = 3;

function ProjectsPage() {
  const { t } = useTranslation();
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [archivingProject, setArchivingProject] = useState<Project | null>(null);
  // Purely "the user asked to see the panel again", never "the month is unsettled": the settlement
  // itself is derived server-side, so this toggle can only ever widen what is shown, and a reload
  // returns to the real state.
  const [reopenedSettlement, setReopenedSettlement] = useState(false);
  const { data: projects, isLoading } = useProjects();
  const { data: savedTotals = [] } = useProjectSavedTotals();
  const { data: suggestion, isLoading: suggestionsLoading } =
    useSuggestedAllocation();
  const { data: healthSummary, isLoading: healthLoading } =
    useFinancialHealthSummary();
  const archiveProject = useArchiveProject();
  const confirmAllocations = useConfirmProjectAllocations();
  const skipSuggestion = useSkipSuggestedAllocation();
  const clearSuggestionSkip = useClearSuggestedAllocationSkip();
  const { orderedProjects, moveByOffset, startDrag, dropOn } =
    useProjectReorder(projects);

  const suggestions = suggestion?.suggestions ?? [];
  const settlement = suggestion?.settlement ?? null;
  // Both levels are optional: `savings` is absent without sufficient history and the surplus itself
  // is absent with no income months. Zero keeps confirm disabled instead of inventing a cap.
  const availableSurplusCents =
    healthSummary?.savings?.avg_monthly_surplus_cents ?? 0;
  const suggestionLoaded = !suggestionsLoading && !healthLoading && !!suggestion;
  // The settled card is deliberately NOT gated on `suggestions.length`: a confirmation that fully
  // funded every goal returns an empty list on the next read, and that user still deserves to see
  // their receipt rather than a surface that silently forgets what they did.
  const showSettledCard =
    suggestionLoaded && settlement !== null && !reopenedSettlement;
  const showActivePanel =
    suggestionLoaded && (settlement === null || reopenedSettlement);

  const savedCentsFor = (projectId: number) =>
    savedTotals.find((total) => total.project_id === projectId)?.saved_cents ??
    0;

  // Skipping writes exactly one `config` key and never touches `project_contributions`: at the
  // ledger level it must stay indistinguishable from never opening the panel (FR8). What changed
  // from the local-dismissal version is only that the decision now survives a reload.
  const skipSuggestionForMonth = () => {
    skipSuggestion.mutate(undefined, {
      onSuccess: (month) => {
        setReopenedSettlement(false);
        toast.success(
          t("projects.suggestionSkipped", {
            month: format(parseISO(`${month}-01`), "MMMM yyyy"),
          })
        );
      },
      onError: () => {
        toast.error(t("toast.saveFailed"));
      },
    });
  };

  // Re-opening a *skipped* month has to clear the stored marker, otherwise the next read would settle
  // it again the moment anything refetches. Re-opening a *confirmed* month has nothing to unwind: the
  // contributions are real and stay, so the panel is shown by local toggle alone.
  const reopenSettlement = () => {
    setReopenedSettlement(true);
    if (settlement?.settled_by === "skip") {
      clearSuggestionSkip.mutate(undefined, {
        onError: () => {
          toast.error(t("toast.saveFailed"));
        },
      });
    }
  };

  const confirmSuggestion = (allocations: SuggestedAllocationDraft[]) => {
    const date = format(new Date(), "yyyy-MM-dd");
    confirmAllocations.mutate(
      allocations.map((allocation) => ({ ...allocation, date })),
      {
        onSuccess: (created) => {
          setReopenedSettlement(false);
          toast.success(
            t("projects.suggestionConfirmed", { count: created.length })
          );
        },
        // The panel stays mounted with the drafts intact so an over-cap or stale-gate rejection can
        // be corrected rather than retyped.
        onError: (error) => {
          const { message } = error as { message?: string };
          toast.error(
            t("projects.suggestionConfirmFailed", {
              message: message ?? t("toast.saveFailed"),
            })
          );
        },
      }
    );
  };

  const handleArchive = () => {
    if (!archivingProject) return;
    archiveProject.mutate(archivingProject.id, {
      onSuccess: () => {
        toast.success(t("toast.saveSuccess"));
        setArchivingProject(null);
      },
      onError: () => {
        toast.error(t("toast.saveFailed"));
        setArchivingProject(null);
      },
    });
  };

  return (
    <div>
      <PageHeader
        title={t("nav.projects")}
        subtitle={t("projects.subtitle")}
        actions={
          <Button
            size="sm"
            onClick={() => setShowAddForm(true)}
            data-testid="add-project-button"
          >
            <Plus aria-hidden="true" />
            {t("projects.addProject")}
          </Button>
        }
      />

      {showSettledCard && settlement && suggestion && (
        <SettledAllocationCard
          settlement={settlement}
          remainingSurplusCents={suggestion.remaining_surplus_cents}
          nextSuggestionDate={suggestion.next_suggestion_date}
          hasOpenSuggestions={suggestions.length > 0}
          onReopen={reopenSettlement}
        />
      )}

      {showActivePanel && suggestion && (
        <SuggestedAllocationPanel
          suggestions={suggestions}
          availableSurplusCents={availableSurplusCents}
          nextSuggestionDate={suggestion.next_suggestion_date}
          onConfirm={confirmSuggestion}
          onSkip={skipSuggestionForMonth}
          isSubmitting={confirmAllocations.isPending}
        />
      )}

      {isLoading && (
        <Card data-testid="projects-skeleton">
          <CardContent>
            <Skeleton rows={FALLBACK_SKELETON_ROWS} />
          </CardContent>
        </Card>
      )}

      {!isLoading && projects && projects.length === 0 && (
        <Card data-testid="projects-empty-state">
          <CardContent>
            <EmptyState
              icon={<Target />}
              title={t("projects.emptyTitle")}
              description={t("projects.emptyDescription")}
              action={
                <Button size="sm" onClick={() => setShowAddForm(true)}>
                  <Plus aria-hidden="true" />
                  {t("projects.addProject")}
                </Button>
              }
            />
          </CardContent>
        </Card>
      )}

      {!isLoading && projects && projects.length > 0 && (
        <Card data-testid="projects-list">
          <CardContent>
            {orderedProjects.length > 1 && (
              <p
                className="mb-2 text-caption text-ink-dim"
                data-testid="projects-reorder-hint"
              >
                {t("projects.reorderHint")}
              </p>
            )}
            {orderedProjects.map((project, index) => (
              <div
                key={project.id}
                draggable={orderedProjects.length > 1}
                onDragStart={() => startDrag(index)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  dropOn(index);
                }}
                data-testid="project-row-drag-handle"
              >
                <ProjectRow
                  project={project}
                  savedCents={savedCentsFor(project.id)}
                  striped={index % 2 === 1}
                  onEdit={setEditingProject}
                  onArchive={setArchivingProject}
                  onMoveUp={(target) => moveByOffset(target, -1)}
                  onMoveDown={(target) => moveByOffset(target, 1)}
                  canMoveUp={index > 0}
                  canMoveDown={index < orderedProjects.length - 1}
                />
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <SlideOver
        open={showAddForm}
        onClose={() => setShowAddForm(false)}
        title={t("projects.addProject")}
        description={t("projects.addProjectDescription")}
        data-testid="project-slide-over"
      >
        <ProjectForm onClose={() => setShowAddForm(false)} />
      </SlideOver>

      <SlideOver
        open={editingProject !== null}
        onClose={() => setEditingProject(null)}
        title={t("projects.editProject")}
        description={t("projects.editProjectDescription")}
        data-testid="edit-project-slide-over"
      >
        {editingProject && (
          <ProjectForm
            project={editingProject}
            onClose={() => setEditingProject(null)}
          />
        )}
      </SlideOver>

      <Dialog
        open={archivingProject !== null}
        onOpenChange={(open) => {
          if (!open) setArchivingProject(null);
        }}
      >
        <DialogContent data-testid="archive-project-dialog">
          <DialogHeader>
            <DialogTitle>{t("projects.archiveTitle")}</DialogTitle>
            <DialogDescription>
              {t("projects.archiveDescription")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setArchivingProject(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={handleArchive}
              data-testid="confirm-archive-project-button"
            >
              {t("projects.archive")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
