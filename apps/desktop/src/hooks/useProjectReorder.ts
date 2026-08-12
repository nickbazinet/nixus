import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useReorderProjects } from "@/hooks/useProjects";
import type { Project } from "@/lib/types";

function moveId(ids: number[], from: number, to: number): number[] {
  const next = [...ids];
  const moved = next[from];
  if (moved === undefined) return ids;
  next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

export function useProjectReorder(projects: Project[] | undefined) {
  const { t } = useTranslation();
  const [orderedIds, setOrderedIds] = useState<number[]>([]);
  const dragSourceIndex = useRef<number | null>(null);
  const reorderProjects = useReorderProjects();

  const serverIds = useMemo(
    () => projects?.map((project) => project.id) ?? [],
    [projects]
  );

  // While a reorder is in flight the optimistic order is the truth; re-seeding from the server
  // mid-flight would snap the rows back to the pre-move order and then forward again.
  useEffect(() => {
    if (reorderProjects.isPending) return;
    setOrderedIds(serverIds);
  }, [serverIds, reorderProjects.isPending]);

  const orderedProjects = useMemo<Project[]>(() => {
    if (!projects) return [];
    if (orderedIds.length !== projects.length) return projects;
    const byId = new Map(projects.map((project) => [project.id, project]));
    const mapped = orderedIds.map((id) => byId.get(id));
    return mapped.every((project) => project !== undefined)
      ? (mapped as Project[])
      : projects;
  }, [projects, orderedIds]);

  const commitOrder = (from: number, to: number) => {
    const currentIds = orderedProjects.map((project) => project.id);
    if (
      from === to ||
      from < 0 ||
      to < 0 ||
      from >= currentIds.length ||
      to >= currentIds.length
    ) {
      return;
    }

    const nextIds = moveId(currentIds, from, to);
    setOrderedIds(nextIds);
    reorderProjects.mutate(nextIds, {
      onError: () => {
        setOrderedIds(serverIds);
        toast.error(t("projects.reorderFailed"));
      },
    });
  };

  const moveByOffset = (project: Project, offset: number) => {
    const from = orderedProjects.findIndex(
      (candidate) => candidate.id === project.id
    );
    commitOrder(from, from + offset);
  };

  const startDrag = (index: number) => {
    dragSourceIndex.current = index;
  };

  const dropOn = (targetIndex: number) => {
    const from = dragSourceIndex.current;
    dragSourceIndex.current = null;
    if (from === null) return;
    commitOrder(from, targetIndex);
  };

  return { orderedProjects, moveByOffset, startDrag, dropOn };
}
