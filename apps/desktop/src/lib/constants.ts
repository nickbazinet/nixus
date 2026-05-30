export const queryKeys = {
  budgetGroups: ["budget-groups"] as const,
  budgetCategories: (groupId: number) =>
    ["budget-categories", groupId] as const,
  budgetStatus: (year: number, month: number) =>
    ["budget-status", year, month] as const,
  allBudgetCategories: ["all-budget-categories"] as const,
  expenses: ["expenses"] as const,
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
  yearlySummary: (year: number) => ["yearly-summary", year] as const,
  projectionInput: ["projection-input"] as const,
  recurringTemplates: ["recurring-templates"] as const,
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
};
