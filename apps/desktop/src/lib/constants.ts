export const queryKeys = {
  budgetGroups: ["budget-groups"] as const,
  budgetCategories: (groupId: number) =>
    ["budget-categories", groupId] as const,
  budgetStatus: (year: number, month: number) =>
    ["budget-status", year, month] as const,
  allBudgetCategories: ["all-budget-categories"] as const,
  systemBudgetTemplates: ["system-budget-templates"] as const,
  systemBudgetTemplateDetail: (templateId: string) =>
    ["system-budget-templates", templateId] as const,
  expenses: ["expenses"] as const,
  latestExpense: ["expenses", "latest"] as const,
  expensesByMonth: (year: number, month: number) =>
    ["expenses", year, month] as const,
  accounts: ["accounts"] as const,
  assets: ["assets"] as const,
  budgetSummary: (year: number, month: number) =>
    ["budget-summary", year, month] as const,
  topBudgetCategories: (year: number, month: number) =>
    ["top-budget-categories", year, month] as const,
  netWorthCurrent: ["net-worth-current"] as const,
  netWorthSnapshotsRecent: ["net-worth-snapshots-recent"] as const,
  spendingBreakdown: (year: number, month: number) =>
    ["spending-breakdown", year, month] as const,
  netWorthHistory: (period: string) =>
    ["net-worth-history", period] as const,
  netWorthChange: (period: string) =>
    ["net-worth-change", period] as const,
  onboardingStatus: ["onboarding-status"] as const,
  datasets: ["datasets"] as const,
  activeProfile: ["active-profile"] as const,
  activeDatasetId: ["active-dataset-id"] as const,
  incomeSources: ["income-sources"] as const,
  incomeEntries: (sourceId?: number) =>
    sourceId !== undefined
      ? (["income-entries", sourceId] as const)
      : (["income-entries"] as const),
  incomeEntriesByMonth: (year: number, month: number) =>
    ["income-entries-by-month", year, month] as const,
  incomeTotal: (year: number, month: number) =>
    ["income-total", year, month] as const,
  spendingTrends: (months: number) =>
    ["spending-trends", months] as const,
  trendsInsight: (months: number, locale: string) =>
    ["trends-insight", months, locale] as const,
  yearlySummary: (year: number) => ["yearly-summary", year] as const,
  projectionInput: ["projection-input"] as const,
  recurringTemplates: ["recurring-templates"] as const,
  recurringIncomeTemplates: ["recurring-income-templates"] as const,
  chatConversations: (agentId: string) =>
    ["chat-conversations", agentId] as const,
  maintenance: ["maintenance"] as const,
  maintenanceVehicle: (vehicleId: number) =>
    ["maintenance", vehicleId] as const,
  maintenanceHistory: (vehicleId: number) =>
    ["maintenance-history", vehicleId] as const,
  maintenanceTaskBaselines: ["maintenance-task-baselines"] as const,
  vehicleCatalog: ["vehicle-catalog"] as const,
  vehicleMakes: ["vehicle-catalog", "makes"] as const,
  vehicleModels: (make: string, year: number) =>
    ["vehicle-catalog", "models", make, year] as const,
  financialHealth: ["financial-health"] as const,
  financialHealthSummary: ["financial-health", "summary"] as const,
  financialHealthDetail: ["financial-health", "detail"] as const,
  retirementPension: ["retirement-pension"] as const,
  retirementEmployerPension: ["retirement-employer-pension"] as const,
  retirementEmployerPensionStartAge: [
    "retirement-employer-pension-start-age",
  ] as const,
  retirementPensionTaxRate: ["retirement-pension-tax-rate"] as const,
  retirementAgeOverride: ["retirement-age-override"] as const,
  retirementInput: ["retirement-input"] as const,
  auth: {
    session: ["auth", "session"] as const,
  },
  cloudAiPremium: ["cloud-ai-premium"] as const,
  profile: ["profile"] as const,
  countries: ["countries"] as const,
  subdivisions: (countryCode: string) =>
    ["subdivisions", countryCode] as const,
  tfsaAccumulatedLimit: ["tfsa-accumulated-limit"] as const,
  projects: ["projects"] as const,
  project: (id: number) => ["projects", id] as const,
  projectContributions: (projectId: number) =>
    ["project-contributions", projectId] as const,
  projectAdvice: (projectId: number) =>
    ["project-advice", projectId] as const,
  projectSavedTotals: ["project-saved-totals"] as const,
  accountEarmarks: (accountId: number) =>
    ["account-earmarks", accountId] as const,
  savingsProjectsSummary: ["savings-projects-summary"] as const,
  suggestedAllocation: ["suggested-allocation"] as const,
  projectPace: ["project-pace"] as const,
};
