import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useMoveBudgetCategory, useReorderBudgetCategories } from "@/hooks/useBudget";
import type { BudgetCategory } from "@/lib/types";

function moveId(ids: number[], from: number, to: number): number[] {
  const next = [...ids];
  const moved = next[from];
  if (moved === undefined) return ids;
  next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

// Group cards mark themselves with this attribute so a drag started in one card can find the card
// the pointer is released over. Archived groups never carry it: nothing can be moved into them.
const GROUP_ATTR = "data-budget-group-id";
const DROP_TARGET_ATTR = "data-drop-target";
const ARCHIVED_ROW = '[data-testid="archived-budget-category-row"]';

function groupCardAt(clientX: number, clientY: number): HTMLElement | null {
  return document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>(`[${GROUP_ATTR}]`) ?? null;
}

// Where a row dropped at `clientY` lands among the target group's active rows.
function insertionIndexIn(card: HTMLElement, clientY: number): number {
  const rows = Array.from(
    card.querySelectorAll<HTMLElement>('[data-testid="budget-status-row"]')
  ).filter((row) => !row.closest(ARCHIVED_ROW));
  const index = rows.findIndex((row) => {
    const rect = row.getBoundingClientRect();
    return clientY < rect.top + rect.height / 2;
  });
  return index === -1 ? rows.length : index;
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
  const moveCategory = useMoveBudgetCategory();

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

  const commitMove = useCallback(
    (index: number, targetGroupId: number, position: number) => {
      const category = orderedCategories[index];
      if (!category) return;
      moveCategory.mutate(
        {
          id: category.id,
          source_group_id: groupId,
          target_group_id: targetGroupId,
          position,
        },
        { onError: () => toast.error(t("budget.moveFailed")) }
      );
    },
    [orderedCategories, groupId, moveCategory, t]
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

      let highlighted: HTMLElement | null = null;
      const setHighlight = (card: HTMLElement | null) => {
        if (card === highlighted) return;
        highlighted?.removeAttribute(DROP_TARGET_ATTR);
        card?.setAttribute(DROP_TARGET_ATTR, "true");
        highlighted = card;
      };
      // A card other than the one the drag started in, or null while the pointer is over this group.
      const foreignCardAt = (x: number, y: number): HTMLElement | null => {
        const card = groupCardAt(x, y);
        return card && Number(card.getAttribute(GROUP_ATTR)) !== groupId ? card : null;
      };

      const handleMove = (moveEvent: PointerEvent) => {
        const foreign = foreignCardAt(moveEvent.clientX, moveEvent.clientY);
        setHighlight(foreign);
        const over = foreign ? index : indexAtClientY(moveEvent.clientY);
        setDrag((current) => (current ? { ...current, over } : current));
      };

      const handleUp = (upEvent: PointerEvent) => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
        window.removeEventListener("pointercancel", handleUp);
        const foreign =
          upEvent.type === "pointercancel" ? null : foreignCardAt(upEvent.clientX, upEvent.clientY);
        setHighlight(null);
        setDrag(null);
        if (foreign) {
          commitMove(
            index,
            Number(foreign.getAttribute(GROUP_ATTR)),
            insertionIndexIn(foreign, upEvent.clientY)
          );
          return;
        }
        commitOrder(index, indexAtClientY(upEvent.clientY));
      };

      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
      window.addEventListener("pointercancel", handleUp);
    },
    [commitOrder, commitMove, groupId]
  );

  return { orderedCategories, drag, setRowRef, beginPointerDrag };
}

