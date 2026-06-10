import { Car, Compass, FileUp, type LucideIcon } from "lucide-react";

/** Stable ids for `pillars.<id>.title` / `pillars.<id>.description` i18n keys. */
export type PillarId = "automation" | "nextAction" | "lifeUpkeep";

export type Pillar = {
  id: PillarId;
  icon: LucideIcon;
};

export const pillars: readonly Pillar[] = [
  { id: "automation", icon: FileUp },
  { id: "nextAction", icon: Compass },
  { id: "lifeUpkeep", icon: Car },
] as const;
