import type { TFunction } from "i18next";

/** The Home Surface change ops a confirmation card can carry. */
export type HomeChangeOp = "add" | "modify" | "remove";

const OPS: readonly HomeChangeOp[] = ["add", "modify", "remove"];

/** The catalog, mirrored for labels only — the backend's `home_surface::catalog` is the authority. */
export const HOME_COMPONENTS = [
  "Metric",
  "LineChart",
  "BarChart",
  "AreaChart",
  "PieChart",
  "Table",
  "Card",
  "Row",
  "Column",
  "Grid",
] as const;

export const HOME_SOURCES = [
  "expenses_by_month",
  "expenses_by_category",
  "net_worth_history",
  "budget_vs_actual_by_category",
  "income_vs_expense_by_month",
  "recent_expenses",
  "account_balances",
  "asset_values",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function homeChangeOp(params: Record<string, unknown>): HomeChangeOp | null {
  return OPS.includes(params.op as HomeChangeOp) ? (params.op as HomeChangeOp) : null;
}

export function homeChangeTitle(params: Record<string, unknown>): string {
  if (isRecord(params.widget) && typeof params.widget.title === "string") {
    return params.widget.title;
  }
  return typeof params.title === "string" ? params.title : "";
}

/** Every display node in a spec, depth first: what the card lists under "Shows". */
interface ShownNode {
  component: string;
  source: string;
  params: Record<string, unknown>;
}

function displayNodes(node: unknown, found: ShownNode[]) {
  if (!isRecord(node)) return;
  const binding = node.dataBinding;
  if (typeof node.component === "string" && isRecord(binding) && typeof binding.source === "string") {
    found.push({
      component: node.component,
      source: binding.source,
      params: isRecord(binding.params) ? binding.params : {},
    });
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) displayNodes(child, found);
  }
}

function knownLabel(t: TFunction, prefix: string, name: string, known: readonly string[]) {
  return known.includes(name) ? t(`${prefix}.${name}`) : name;
}

/**
 * The period and filter a binding asks for, in words — "last month", "3 months to last month",
 * "Groceries". On the card so the user can see the AI understood WHICH period before confirming.
 */
export function describeBindingScope(params: Record<string, unknown>, t: TFunction): string[] {
  const parts: string[] = [];
  const months = typeof params.months === "number" ? params.months : null;
  const ago = typeof params.months_ago === "number" ? params.months_ago : 0;
  if (months !== null) {
    if (months === 1) {
      parts.push(
        ago === 0 ? t("home.scope.thisMonth") : ago === 1 ? t("home.scope.lastMonth") : t("home.scope.monthAgo", { count: ago })
      );
    } else {
      parts.push(ago === 0 ? t("home.scope.lastMonths", { count: months }) : t("home.scope.monthsEnding", { count: months, ago }));
    }
  } else if (typeof params.months_ago === "number") {
    parts.push(ago === 0 ? t("home.scope.thisMonth") : ago === 1 ? t("home.scope.lastMonth") : t("home.scope.monthAgo", { count: ago }));
  }
  if (typeof params.category === "string" && params.category.trim() !== "") {
    parts.push(params.category.trim());
  }
  return parts;
}

export interface HomeChangeDescription {
  label: string;
  details: { field: string; value: string }[];
  confirmLabel: string;
  hint: string;
}

/** The confirmation card's wording, built from the validated params rather than model prose. */
export function describeHomeChange(
  params: Record<string, unknown>,
  t: TFunction
): HomeChangeDescription {
  const op = homeChangeOp(params) ?? "add";
  const title = homeChangeTitle(params);
  const shown: ShownNode[] = [];
  displayNodes(params.widget, shown);

  return {
    label: t(`home.change.label.${op}`, { title }),
    details: shown.map(({ component, source, params }) => ({
      field: knownLabel(t, "home.component", component, HOME_COMPONENTS),
      value: [knownLabel(t, "home.source", source, HOME_SOURCES), ...describeBindingScope(params, t)].join(" · "),
    })),
    confirmLabel: t(`home.change.confirm.${op}`),
    hint: t("home.change.hint"),
  };
}
