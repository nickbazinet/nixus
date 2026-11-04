import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useReorderHomeWidgets } from "@/hooks/useHome";
import type { HomeWidget } from "@/lib/types";

function moveId(ids: string[], from: number, to: number): string[] {
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

/**
 * Drag-to-reorder for the Home widget grid, on the same pointer-event basis as
 * `useCategoryReorder`. Two things differ from that hook, both because of the shape of what is
 * being dragged: the ids are opaque `widget_key` strings rather than row numbers, and the cards
 * sit in a two-column grid, so the drop target is resolved in x AND y.
 */
export function useHomeWidgetReorder(widgets: HomeWidget[] | undefined) {
  const { t } = useTranslation();
  const [orderedIds, setOrderedIds] = useState<string[]>([]);
  const [drag, setDrag] = useState<DragState | null>(null);
  const cardRefs = useRef<Array<HTMLElement | null>>([]);
  const reorderWidgets = useReorderHomeWidgets();

  const serverIds = useMemo(() => widgets?.map((widget) => widget.id) ?? [], [widgets]);

  // While a reorder is in flight the optimistic order is the truth; re-seeding from the server
  // mid-flight would snap the cards back to the pre-move order and then forward again.
  useEffect(() => {
    if (reorderWidgets.isPending) return;
    setOrderedIds(serverIds);
  }, [serverIds, reorderWidgets.isPending]);

  const orderedWidgets = useMemo<HomeWidget[]>(() => {
    if (!widgets) return [];
    if (orderedIds.length !== widgets.length) return widgets;
    const byId = new Map(widgets.map((widget) => [widget.id, widget]));
    const mapped = orderedIds.map((id) => byId.get(id));
    return mapped.every((widget) => widget !== undefined) ? (mapped as HomeWidget[]) : widgets;
  }, [widgets, orderedIds]);

  const commitOrder = useCallback(
    (from: number, to: number) => {
      const currentIds = orderedWidgets.map((widget) => widget.id);
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
      reorderWidgets.mutate(
        { widget_ids: nextIds },
        {
          onError: () => {
            setOrderedIds(serverIds);
            toast.error(t("home.customize.reorderFailed"));
          },
        }
      );
    },
    [orderedWidgets, reorderWidgets, serverIds, t]
  );

  const setCardRef = useCallback(
    (index: number) => (el: HTMLElement | null) => {
      cardRefs.current[index] = el;
    },
    []
  );

  /**
   * The card the pointer is over. A y-only midpoint scan — what a vertical list can get away with
   * — would resolve the wrong column here, so a containing rect wins outright and anything in a
   * gutter, in the grid's padding, or past the last row falls back to the nearest card centre by
   * squared distance (no `sqrt`: only the ordering matters).
   */
  const indexAtPoint = (clientX: number, clientY: number): number => {
    const rects = cardRefs.current.map((el) => el?.getBoundingClientRect() ?? null);

    for (let i = 0; i < rects.length; i++) {
      const rect = rects[i];
      if (!rect) continue;
      if (
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
      ) {
        return i;
      }
    }

    let nearest = -1;
    let shortest = Number.POSITIVE_INFINITY;
    for (let i = 0; i < rects.length; i++) {
      const rect = rects[i];
      if (!rect) continue;
      const dx = clientX - (rect.left + rect.width / 2);
      const dy = clientY - (rect.top + rect.height / 2);
      const distance = dx * dx + dy * dy;
      if (distance < shortest) {
        shortest = distance;
        nearest = i;
      }
    }
    return nearest;
  };

  // Tauri's macOS webview (WKWebView) never reliably fires the native `drop` event for in-page
  // HTML5 drag-and-drop — the drag starts, but releasing does nothing. Pointer events sidestep
  // the browser's drag API entirely and behave identically on every platform.
  const beginPointerDrag = useCallback(
    (index: number) => (event: React.PointerEvent) => {
      event.preventDefault();
      setDrag({ from: index, over: index });

      const handleMove = (moveEvent: PointerEvent) => {
        const over = indexAtPoint(moveEvent.clientX, moveEvent.clientY);
        if (over < 0) return;
        setDrag((current) => (current ? { ...current, over } : current));
      };

      const handleUp = (upEvent: PointerEvent) => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
        window.removeEventListener("pointercancel", handleUp);
        const over = indexAtPoint(upEvent.clientX, upEvent.clientY);
        setDrag(null);
        commitOrder(index, over);
      };

      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
      window.addEventListener("pointercancel", handleUp);
    },
    [commitOrder]
  );

  /** The keyboard's equivalent of a drag: one position earlier or later in the grid. */
  const moveBy = useCallback(
    (index: number, delta: number) => commitOrder(index, index + delta),
    [commitOrder]
  );

  return { orderedWidgets, drag, setCardRef, beginPointerDrag, moveBy };
}
