/** Stable ids for `beta.limitations.items.<id>` i18n keys. */
export type LimitationId =
  | "noBankSync"
  | "desktopOnly"
  | "singleUser"
  | "aiCredentials"
  | "preAlphaStability"
  | "notProfessionalAdvice";

export const limitationIds: readonly LimitationId[] = [
  "noBankSync",
  "desktopOnly",
  "singleUser",
  "aiCredentials",
  "preAlphaStability",
  "notProfessionalAdvice",
] as const;

export const BETA_SUPPORT_EMAIL = "support@nixus.nicolasbazinet.net";
