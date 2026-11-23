import type { BudgetCategoryStatus } from "@/lib/types";

export type GroupFilter = "all" | "over" | "onTrack" | "notStarted";

export interface GroupStats {
  spentCents: number;
  targetCents: number;
  /** Active (not archived) categories in the group this month. */
  categoryCount: number;
  /** Categories past their target. A savings line is never "over": setting more aside is not overspending. */
  overCount: number;
  status: Exclude<GroupFilter, "all">;
}

export function isCategoryOver(status: BudgetCategoryStatus): boolean {
  return (
    status.project_id == null &&
    status.target_cents > 0 &&
    status.spent_cents > status.target_cents
  );
}

/**
 * Each group's month, summed from the status rows: what it planned, what it spent, and how many of
 * its categories went over. Archived categories still count toward what was spent — the money left
 * either way — but not toward the plan or the category count.
 */
export function groupStatsFrom(statuses: BudgetCategoryStatus[]): Map<number, GroupStats> {
  const stats = new Map<number, GroupStats>();
  for (const status of statuses) {
    const entry = stats.get(status.group_id) ?? {
      spentCents: 0,
      targetCents: 0,
      categoryCount: 0,
      overCount: 0,
      status: "notStarted" as const,
    };
    entry.spentCents += status.spent_cents;
    if (!status.is_deleted) {
      entry.targetCents += status.target_cents;
      entry.categoryCount += 1;
      if (isCategoryOver(status)) entry.overCount += 1;
    }
    stats.set(status.group_id, entry);
  }
  for (const entry of stats.values()) {
    entry.status = entry.overCount > 0 ? "over" : entry.spentCents > 0 ? "onTrack" : "notStarted";
  }
  return stats;
}

/** Groups ranked by what they spent, largest first — the rank that picks each group's colour. */
export function groupRanks(stats: Map<number, GroupStats>): Map<number, number> {
  const ranks = new Map<number, number>();
  [...stats.entries()]
    .sort(([, a], [, b]) => b.spentCents - a.spentCents)
    .forEach(([groupId], rank) => ranks.set(groupId, rank));
  return ranks;
}
