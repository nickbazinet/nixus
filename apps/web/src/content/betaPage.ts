/** Stable ids for `betaPage.fit.good.<id>` / `betaPage.fit.bad.<id>` i18n keys. */
export type BetaFitGoodId =
  | "spreadsheet"
  | "desktop"
  | "upload"
  | "roughEdges";

export type BetaFitBadId =
  | "bankSync"
  | "mobile"
  | "advice"
  | "polished";

export const betaFitGoodIds: readonly BetaFitGoodId[] = [
  "spreadsheet",
  "desktop",
  "upload",
  "roughEdges",
] as const;

export const betaFitBadIds: readonly BetaFitBadId[] = [
  "bankSync",
  "mobile",
  "advice",
  "polished",
] as const;

/** Screenshot slots — add `src` under public/beta/ when assets are ready. */
export type BetaScreenshotId = "budget" | "aiImport" | "netWorth";

export type BetaScreenshot = {
  id: BetaScreenshotId;
  /** Optional path under site root, e.g. `/beta/budget.webp`. */
  src?: string;
};

export const betaScreenshots: readonly BetaScreenshot[] = [
  { id: "budget", src: "/beta/budget.png" },
  { id: "aiImport", src: "/beta/ai-chat.png" },
  { id: "netWorth", src: "/beta/accounts.png" },
] as const;

export type BetaQuickFaqId = "bankConnection" | "dataStorage" | "isItFree";

export const betaQuickFaqIds: readonly BetaQuickFaqId[] = [
  "bankConnection",
  "dataStorage",
  "isItFree",
] as const;

export type BetaGetStartedStepId = "download" | "install" | "firstOpen";

export const betaGetStartedStepIds: readonly BetaGetStartedStepId[] = [
  "download",
  "install",
  "firstOpen",
] as const;
