import type { ProjectionPoint } from "@/lib/projection";

/**
 * Round net-worth figures worth naming, in cents. Deliberately coarse: a milestone is a number a
 * person already has in their head ("a million"), not an evenly spaced tick.
 */
const THRESHOLDS_CENTS = [
  100_000_00,
  250_000_00,
  500_000_00,
  750_000_00,
  1_000_000_00,
  1_500_000_00,
  2_000_000_00,
  2_500_000_00,
  3_000_000_00,
  4_000_000_00,
  5_000_000_00,
  7_500_000_00,
  10_000_000_00,
] as const;

export interface ProjectionMilestone {
  thresholdCents: number;
  /** Calendar year of the first projected month at or above the threshold. */
  year: number;
  monthOffset: number;
}

/** Calendar year the horizon ends in — what "In 2046" in the figures above the chart refers to. */
export function projectionEndYear(
  points: readonly ProjectionPoint[],
  now: Date = new Date(),
): number {
  const lastOffset = points[points.length - 1]?.month ?? 0;
  return new Date(now.getFullYear(), now.getMonth() + lastOffset, 1).getFullYear();
}

/**
 * The next few round numbers this projection crosses, and when. Read off the series itself rather
 * than solved for, so a milestone can never disagree with the line the user is looking at.
 *
 * Thresholds already passed are skipped (they are not ahead of you), and nothing is extrapolated
 * past the chosen horizon — an empty list means "no round number inside this window", which is an
 * honest answer and renders as no card at all.
 */
export function projectionMilestones(
  points: readonly ProjectionPoint[],
  now: Date = new Date(),
  limit = 3,
): ProjectionMilestone[] {
  const start = points[0]?.total_cents;
  if (points.length === 0 || !Number.isFinite(start)) return [];

  const milestones: ProjectionMilestone[] = [];

  for (const thresholdCents of THRESHOLDS_CENTS) {
    if (thresholdCents <= (start as number)) continue;

    const crossing = points.find(
      (point) =>
        Number.isFinite(point.total_cents) && point.total_cents >= thresholdCents,
    );
    if (!crossing) break;

    milestones.push({
      thresholdCents,
      monthOffset: crossing.month,
      year: new Date(
        now.getFullYear(),
        now.getMonth() + crossing.month,
        1,
      ).getFullYear(),
    });

    if (milestones.length === limit) break;
  }

  return milestones;
}
