/**
 * The closed set of actions the assistant may propose, and what each one invalidates.
 *
 * `commands/chat.rs` holds the enforcement copy in its own `ACTION_TYPES`; this is the frontend
 * mirror, and `chatActions.test.ts` fails if the two drift. Both halves are needed: the backend
 * refuses an unknown type, but only the frontend can decline to draw a confirmation card for one —
 * and a card whose Confirm can only ever fail is worse than no card, because the user cannot tell
 * the difference until they click it.
 */
export const CHAT_ACTION_TYPES = [
  "create_expense",
  "create_budget_category",
  "update_balance",
  "create_account",
  "update_asset_value",
] as const;

export type ChatActionType = (typeof CHAT_ACTION_TYPES)[number];

/**
 * Query key prefixes to invalidate after an action succeeds.
 *
 * Prefixes, not exact keys: month-scoped keys like `["budget-status", year, month]` are only
 * reachable by prefix, and an action confirmed in one month can change what a different month
 * reads. `Record<ChatActionType, ...>` is what makes adding a type to the tuple above a type
 * error until its invalidation is declared here.
 */
const CHAT_ACTION_INVALIDATION: Record<ChatActionType, readonly (readonly string[])[]> = {
  create_expense: [
    ["expenses"],
    ["dashboard"],
    ["budgets"],
    ["budget-status"],
    ["budget-summary"],
    ["spending-breakdown"],
  ],
  /* A new category changes the group it lands in, the all-categories list the pickers read, and
   * every month-scoped budget view that counts categories — the row is invisible until each of
   * those refetches. */
  create_budget_category: [
    ["budget-groups"],
    ["budget-categories"],
    ["all-budget-categories"],
    ["budget-status"],
    ["budget-summary"],
    ["top-budget-categories"],
    ["dashboard"],
  ],
  update_balance: [["accounts"], ["dashboard"], ["net-worth-current"]],
  create_account: [["accounts"], ["dashboard"]],
  update_asset_value: [["assets"], ["net-worth-current"]],
};

export function isChatActionType(value: unknown): value is ChatActionType {
  return typeof value === "string" && (CHAT_ACTION_TYPES as readonly string[]).includes(value);
}

export function chatActionInvalidationKeys(
  actionType: ChatActionType
): readonly (readonly string[])[] {
  return CHAT_ACTION_INVALIDATION[actionType];
}

function isNonBlankString(value: unknown): boolean {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * Whether `create_budget_category` params name a category the backend can actually create. Both
 * names are required and non-blank — it needs an existing group to file the category under — and
 * `target_cents`, when present, must be a positive integer because the backend rejects `<= 0`.
 */
function hasValidCategoryParams(params: Record<string, unknown>): boolean {
  if (!isNonBlankString(params.category_name)) return false;
  if (!isNonBlankString(params.group_name)) return false;

  const target = params.target_cents;
  if (target === undefined || target === null) return true;
  return typeof target === "number" && Number.isInteger(target) && target > 0;
}

/**
 * Param guards by action type. Partial on purpose: only `create_budget_category` is checked, since
 * it is the type whose malformed legacy cards reached the user. A type with no entry is accepted on
 * its type alone, exactly as before — do not fill these in without a reason to.
 */
const CHAT_ACTION_PARAM_GUARDS: Partial<
  Record<ChatActionType, (params: Record<string, unknown>) => boolean>
> = {
  create_budget_category: hasValidCategoryParams,
};

export function hasValidChatActionParams(
  actionType: ChatActionType,
  params: Record<string, unknown>
): boolean {
  return CHAT_ACTION_PARAM_GUARDS[actionType]?.(params) ?? true;
}
