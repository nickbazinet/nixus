import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useReorderBudgetCategories } from "@/hooks/useBudget";
import type { BudgetCategory } from "@/lib/types";

function moveId(ids: number[], from: number, to: number): number[] {
  const next = [...ids];
  const moved = next[from];
  if (moved === undefined) return ids;
  next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

interface DragState {
  from: number;
  over: number;
}

export function useCategoryReorder(
  groupId: number,
  categories: BudgetCategory[] | undefined
) {
  const { t } = useTranslation();
  const [orderedIds, setOrderedIds] = useState<number[]>([]);
  const [drag, setDrag] = useState<DragState | null>(null);
  const rowRefs = useRef<Array<HTMLElement | null>>([]);
  const reorderCategories = useReorderBudgetCategories();

  const serverIds = useMemo(
    () => categories?.map((category) => category.id) ?? [],
    [categories]
  );

  // While a reorder is in flight the optimistic order is the truth; re-seeding from the server
  // mid-flight would snap the rows back to the pre-move order and then forward again.
  useEffect(() => {
    if (reorderCategories.isPending) return;
    setOrderedIds(serverIds);
  }, [serverIds, reorderCategories.isPending]);

  const orderedCategories = useMemo<BudgetCategory[]>(() => {
    if (!categories) return [];
    if (orderedIds.length !== categories.length) return categories;
    const byId = new Map(categories.map((category) => [category.id, category]));
    const mapped = orderedIds.map((id) => byId.get(id));
    return mapped.every((category) => category !== undefined)
      ? (mapped as BudgetCategory[])
      : categories;
  }, [categories, orderedIds]);

  const commitOrder = useCallback(
    (from: number, to: number) => {
      const currentIds = orderedCategories.map((category) => category.id);
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
      reorderCategories.mutate(
        { group_id: groupId, category_ids: nextIds },
        {
          onError: () => {
            setOrderedIds(serverIds);
            toast.error(t("budget.reorderFailed"));
          },
        }
      );
    },
    [orderedCategories, groupId, reorderCategories, serverIds, t]
  );

  const setRowRef = useCallback(
    (index: number) => (el: HTMLElement | null) => {
      rowRefs.current[index] = el;
    },
    []
  );

  const indexAtClientY = (clientY: number): number => {
    const rects = rowRefs.current.map((el) => el?.getBoundingClientRect() ?? null);
    for (let i = 0; i < rects.length; i++) {
      const rect = rects[i];
      if (rect && clientY < rect.top + rect.height / 2) return i;
    }
    return Math.max(rects.length - 1, 0);
  };

  // Tauri's macOS webview (WKWebView) never reliably fires the native `drop` event for in-page
  // HTML5 drag-and-drop — the drag starts, but releasing does nothing. Pointer events sidestep
  // the browser's drag API entirely and behave identically on every platform.
  const beginPointerDrag = useCallback(
    (index: number) => (event: React.PointerEvent) => {
      event.preventDefault();
      setDrag({ from: index, over: index });

      const handleMove = (moveEvent: PointerEvent) => {
        const over = indexAtClientY(moveEvent.clientY);
        setDrag((current) => (current ? { ...current, over } : current));
      };

      const handleUp = (upEvent: PointerEvent) => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
        window.removeEventListener("pointercancel", handleUp);
        const over = indexAtClientY(upEvent.clientY);
        setDrag(null);
        commitOrder(index, over);
      };

      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
      window.addEventListener("pointercancel", handleUp);
    },
    [commitOrder]
  );

  return { orderedCategories, drag, setRowRef, beginPointerDrag };
}

