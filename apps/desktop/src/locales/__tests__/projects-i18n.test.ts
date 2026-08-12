import { describe, expect, it } from "vitest";
import enLocale from "../en.json";
import frLocale from "../fr.json";

const en = enLocale as Record<string, string>;
const fr = frLocale as Record<string, string>;

const PROJECTS_PREFIX = "projects.";

// Keys the projects surface, its row and its form read directly. Listed explicitly so a rename in
// the components cannot quietly leave the page rendering raw key names.
const REQUIRED_KEYS = [
  "projects.subtitle",
  "projects.addProject",
  "projects.addProjectDescription",
  "projects.editProject",
  "projects.editProjectDescription",
  "projects.emptyTitle",
  "projects.emptyDescription",
  "projects.namePlaceholder",
  "projects.nameRequired",
  "projects.targetAmount",
  "projects.targetDate",
  "projects.priority",
  "projects.saveProject",
  "projects.archive",
  "projects.archiveTitle",
  "projects.archiveDescription",
  "projects.savedOfTarget",
  "projects.meterLabel",
  "projects.remainingBadge",
  "projects.reachedBadge",
  "projects.noMoneyMovedNote",
  "projects.rowActions",
  "projects.addContribution",
  "projects.addContributionDescription",
  "projects.sourceAccount",
  "projects.sourceAccountRequired",
  "projects.saveContribution",
  "projects.savedLabel",
  "projects.remainingLabel",
  "projects.percentComplete",
  "projects.contributionHistory",
  "projects.contributionHistoryEmpty",
  "projects.deleteContribution",
  "projects.deleteContributionTitle",
  "projects.deleteContributionDescription",
  "projects.contributionColDate",
  "projects.contributionColAccount",
  "projects.contributionColAmount",
  "projects.expandProject",
  "projects.collapseProject",
  "projects.accountEarmarkSetAsideSuffix",
  "projects.accountEarmarkUnallocatedLabel",
  "projects.accountEarmarkShareTooltipLabel",
  "projects.accountEarmarkShareTooltip",
  "projects.expandAccountBreakdown",
  "projects.collapseAccountBreakdown",
  "projects.dashboardMeterLabel",
  "projects.dashboardMeterValue",
  "projects.moveUp",
  "projects.moveDown",
  "projects.reorderHint",
  "projects.reorderFailed",
  "projects.suggestionTitle",
  "projects.suggestionIntro",
  "projects.suggestionAmountLabel",
  "projects.suggestionSurplus",
  "projects.suggestionSurplusInfoAria",
  "projects.suggestionSurplusInfoPlain",
  "projects.suggestionTotal",
  "projects.suggestionRemainder",
  "projects.suggestionOverBy",
  "projects.suggestionExceedsRemaining",
  "projects.suggestionMonthsToTarget",
  "projects.suggestionConfirm",
  "projects.suggestionSkip",
  "projects.suggestionAccountLabel",
  "projects.suggestionAccountRequired",
  "projects.suggestionConfirmed",
  "projects.suggestionConfirmFailed",
  "projects.suggestionSkipped",
  "projects.suggestionCadenceNote",
  "projects.suggestionSettledConfirmedTitle",
  "projects.suggestionSettledConfirmedBody",
  "projects.suggestionSettledFullyAllocated",
  "projects.suggestionSettledRemainder",
  "projects.suggestionSettledSkippedTitle",
  "projects.suggestionSettledSkippedBody",
  "projects.suggestionSettledNext",
  "projects.suggestionSettledNewGoals",
  "projects.suggestionSettledAdjust",
  "projects.suggestionSettledShow",
  "projects.paceBadgeGood",
  "projects.paceBadgeCaution",
  "projects.paceBadgeOver",
  "projects.paceLine",
  "projects.paceWeeklyLine",
  "projects.paceMathInfo",
  "projects.paceMathInfoAria",
  "projects.paceAdviceAction",
  "projects.adviceNotConfigured",
  "projects.adviceError",
  "projects.adviceRetry",
  "projects.adviceSkeleton",
] as const;

// Keys outside the `projects.` namespace that the surface renders. The prefix-based parity checks
// below cannot see these, so they are asserted by name.
const REQUIRED_FOREIGN_KEYS = [
  "nav.projects",
  "dashboard.savingsProjects",
  "common.name",
  "common.cancel",
  "common.amountHidden",
  "budget.ofSeparator",
  "toast.saveSuccess",
  "toast.saveFailed",
  "toast.deleteSuccess",
  "toast.deleteFailed",
  "common.date",
  "common.amount",
  "common.delete",
  "validation.amountPositive",
  "validation.dateRequired",
  "netWorth.breakdown.orderNote",
  "netWorth.breakdown.tableCaption",
  "netWorth.breakdown.colType",
  "netWorth.breakdown.colAmount",
  "netWorth.breakdown.colShare",
] as const;

function collectProjectsKeys(locale: Record<string, string>): string[] {
  return Object.keys(locale).filter((key) => key.startsWith(PROJECTS_PREFIX));
}

describe("projects i18n parity", () => {
  it("includes every projects EN key in FR", () => {
    const frKeys = new Set(collectProjectsKeys(fr));
    const missingInFr = collectProjectsKeys(en).filter((key) => !frKeys.has(key));

    expect(missingInFr, `Missing FR keys: ${missingInFr.join(", ")}`).toEqual([]);
  });

  it("includes every projects FR key in EN", () => {
    const enKeys = new Set(collectProjectsKeys(en));
    const missingInEn = collectProjectsKeys(fr).filter((key) => !enKeys.has(key));

    expect(missingInEn, `Missing EN keys: ${missingInEn.join(", ")}`).toEqual([]);
  });

  it("defines every key the projects surface renders in both locales", () => {
    for (const key of REQUIRED_KEYS) {
      expect(en[key], `Missing EN key ${key}`).toBeTruthy();
      expect(fr[key], `Missing FR key ${key}`).toBeTruthy();
    }
  });

  it("defines the shared keys the projects surface borrows, in both locales", () => {
    for (const key of REQUIRED_FOREIGN_KEYS) {
      expect(en[key], `Missing EN key ${key}`).toBeTruthy();
      expect(fr[key], `Missing FR key ${key}`).toBeTruthy();
    }
  });

  it("keeps the interpolation placeholders identical across locales", () => {
    for (const key of ["projects.savedOfTarget", "projects.meterLabel", "projects.remainingBadge", "projects.rowActions", "projects.percentComplete", "projects.expandProject", "projects.collapseProject", "projects.dashboardMeterValue", "projects.moveUp", "projects.moveDown", "projects.suggestionAmountLabel", "projects.suggestionRemainder", "projects.suggestionOverBy", "projects.suggestionMonthsToTarget", "projects.suggestionConfirmed", "projects.suggestionConfirmFailed", "projects.suggestionSkipped", "projects.suggestionCadenceNote", "projects.suggestionSettledConfirmedBody", "projects.suggestionSettledRemainder", "projects.suggestionSettledSkippedBody", "projects.suggestionSettledNext", "projects.paceBadgeGood", "projects.paceBadgeCaution", "projects.paceBadgeOver", "projects.paceLine", "projects.paceWeeklyLine"]) {
      const placeholders = (value: string) =>
        [...value.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
      expect(placeholders(fr[key]), `Placeholder drift on ${key}`).toEqual(
        placeholders(en[key])
      );
    }
  });
});
