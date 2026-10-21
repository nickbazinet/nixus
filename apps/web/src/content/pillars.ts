/** Stable ids for `pillars.<id>.*` i18n keys. */
export type PillarId = "automation" | "nextAction" | "lifeUpkeep";

export type Pillar = {
  readonly id: PillarId;
};

/**
 * Icons were dropped with the editorial restyle: the pillars now sit under a
 * rule rather than a tinted icon square, because three icon-square grids in a
 * row (trust band, pillars, capability cards) is what made three structurally
 * different sections read as one repeated template.
 */
export const pillars: readonly Pillar[] = [
  { id: "automation" },
  { id: "nextAction" },
  { id: "lifeUpkeep" },
] as const;
