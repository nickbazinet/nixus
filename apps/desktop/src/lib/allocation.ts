// Summing and one inclusive comparison — nothing else. Every cent of the *suggestion* is weighted in
// Rust (`projects/allocation.rs`); duplicating any of that math here would let the two sides drift.
export function sumAllocationCents(drafts: Record<number, number>): number {
  return Object.values(drafts).reduce((total, cents) => total + cents, 0);
}

// FR7 blocks confirm only when the edited total *exceeds* the surplus, so an exact match passes.
export function validateAllocationTotal(
  totalCents: number,
  availableSurplusCents: number
): { ok: boolean; overageCents: number } {
  if (totalCents <= availableSurplusCents) {
    return { ok: true, overageCents: 0 };
  }
  return { ok: false, overageCents: totalCents - availableSurplusCents };
}
