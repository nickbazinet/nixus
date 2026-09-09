import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CHAT_ACTION_TYPES,
  chatActionInvalidationKeys,
  hasValidChatActionParams,
  isChatActionType,
} from "@/lib/chatActions";

const RUST_COMMANDS = resolve(process.cwd(), "src-tauri/src/commands/chat.rs");

/**
 * The `ACTION_TYPES` array `commands/chat.rs` enforces against. Parsed rather than duplicated: a
 * hand-copied list is exactly what drifts, and both directions of drift are a real bug — a type the
 * backend runs but the frontend refuses to draw is a feature the user cannot reach, and a type the
 * frontend draws but the backend rejects is the dead card this whole guard exists to prevent.
 */
function rustActionTypes(): string[] {
  const source = readFileSync(RUST_COMMANDS, "utf8");
  const block = source.match(/const ACTION_TYPES: \[&str; \d+\] = \[([\s\S]*?)\];/);
  if (block === null) throw new Error("ACTION_TYPES not found in commands/chat.rs");
  return [...block[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
}

describe("chat action source of truth", () => {
  it("matches the backend's enforced action types exactly", () => {
    expect([...CHAT_ACTION_TYPES].sort()).toEqual(rustActionTypes().sort());
  });

  it("includes create_budget_category", () => {
    expect(CHAT_ACTION_TYPES).toContain("create_budget_category");
  });

  it("declares invalidation keys for every action type", () => {
    for (const type of CHAT_ACTION_TYPES) {
      expect(chatActionInvalidationKeys(type).length, type).toBeGreaterThan(0);
    }
  });

  /* Invalidating a category creation without touching the group list or the month-scoped views
   * leaves the new row invisible until a manual refetch — the symptom is "the AI said it worked
   * and nothing appeared". */
  it("refreshes group, category and month-scoped budget reads after a category is created", () => {
    const prefixes = chatActionInvalidationKeys("create_budget_category").map(
      (key) => key[0]
    );
    expect(prefixes).toEqual(
      expect.arrayContaining([
        "budget-groups",
        "budget-categories",
        "all-budget-categories",
        "budget-status",
        "budget-summary",
      ])
    );
  });

  /* Only the category and batch action types carry a param guard in this patch. Pinning that
   * the others still pass anything is what stops a later edit from quietly broadening the gate
   * and killing cards that were working. */
  it("leaves the unguarded action types accepting any params", () => {
    const guarded = ["create_budget_category", "batch_actions"];
    for (const type of CHAT_ACTION_TYPES) {
      if (guarded.includes(type)) continue;
      expect(hasValidChatActionParams(type, {}), type).toBe(true);
      expect(hasValidChatActionParams(type, { anything: "at all" }), type).toBe(true);
    }
  });

  it("accepts category params the backend can act on", () => {
    expect(
      hasValidChatActionParams("create_budget_category", {
        category_name: "House",
        group_name: "Needs",
      })
    ).toBe(true);
    expect(
      hasValidChatActionParams("create_budget_category", {
        category_name: "House",
        group_name: "Needs",
        target_cents: 1,
      })
    ).toBe(true);
  });

  it("rejects category params the backend would refuse", () => {
    const refused: Record<string, unknown>[] = [
      {},
      { category_name: "House" },
      { group_name: "Needs" },
      { category_name: " ", group_name: "Needs" },
      { category_name: "House", group_name: "" },
      { category_name: "House", group_name: "Needs", target_cents: 0 },
      { category_name: "House", group_name: "Needs", target_cents: -100 },
      { category_name: "House", group_name: "Needs", target_cents: 0.5 },
      { category_name: "House", group_name: "Needs", target_cents: "100" },
    ];
    for (const params of refused) {
      expect(
        hasValidChatActionParams("create_budget_category", params),
        JSON.stringify(params)
      ).toBe(false);
    }
  });

  it("rejects anything outside the closed set", () => {
    expect(isChatActionType("create_expense")).toBe(true);
    expect(isChatActionType("create_category")).toBe(false);
    expect(isChatActionType("")).toBe(false);
    expect(isChatActionType(undefined)).toBe(false);
    expect(isChatActionType(null)).toBe(false);
    expect(isChatActionType(42)).toBe(false);
  });

  it("accepts a batch of actions the backend can act on", () => {
    expect(
      hasValidChatActionParams("batch_actions", {
        actions: [
          {
            action_type: "create_budget_category",
            params: { category_name: "House Related", group_name: "Housing" },
          },
          {
            action_type: "create_expense",
            params: { merchant: "Costco", amount_cents: 4500, category_name: "Groceries", date: "2026-03-14" },
          },
        ],
      })
    ).toBe(true);
  });

  it("rejects a batch the backend would refuse", () => {
    const refused: Record<string, unknown>[] = [
      {},
      { actions: [] },
      { actions: "not-an-array" },
      { actions: [{ params: { category_name: "House", group_name: "Needs" } }] },
      { actions: [{ action_type: "create_category", params: {} }] },
      { actions: [{ action_type: "batch_actions", params: { actions: [] } }] },
      {
        actions: [
          { action_type: "create_budget_category", params: { category_name: "House" } },
        ],
      },
    ];
    for (const params of refused) {
      expect(
        hasValidChatActionParams("batch_actions", params),
        JSON.stringify(params)
      ).toBe(false);
    }
  });
});
