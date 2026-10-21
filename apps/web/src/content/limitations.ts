/** Stable ids for `beta.limitations.items.<id>` i18n keys. */
export type LimitationId =
  | "noBankSync"
  | "desktopOnly"
  | "noHousehold"
  | "aiCredentials"
  | "preAlphaStability"
  | "notProfessionalAdvice";

export const limitationIds: readonly LimitationId[] = [
  "noBankSync",
  "desktopOnly",
  "noHousehold",
  "aiCredentials",
  "preAlphaStability",
  "notProfessionalAdvice",
] as const;
