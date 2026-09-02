/** Stable ids for `founding.pitch.focus.<id>` i18n keys. */
export type FoundingFocusId =
  | "expenses"
  | "netWorth"
  | "investments"
  | "savings"
  | "goals";

export const foundingFocusIds: readonly FoundingFocusId[] = [
  "expenses",
  "netWorth",
  "investments",
  "savings",
  "goals",
] as const;
