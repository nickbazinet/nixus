import { describe, expect, it } from "vitest";
import { parseActionFromContent } from "@/components/chat/ChatMessageBubble";

function actionBlock(payload: Record<string, unknown>): string {
  return "Here you go.\n```action\n" + JSON.stringify(payload) + "\n```";
}

const DISPLAY = {
  label: "Add Category",
  details: [{ field: "Category", value: "House" }],
};

describe("parseActionFromContent", () => {
  it("parses a supported action", () => {
    const parsed = parseActionFromContent(
      actionBlock({
        action: true,
        action_type: "create_budget_category",
        display: DISPLAY,
        params: { category_name: "House", group_name: "Housing" },
      })
    );

    expect(parsed?.action_type).toBe("create_budget_category");
    expect(parsed?.params).toEqual({ category_name: "House", group_name: "Housing" });
  });

  /* The reproduced bug: the model proposed a type the backend has no branch for, and the card
   * rendered anyway — so every Confirm returned an error and the same card kept coming back. */
  it("renders no card for an action type the backend cannot run", () => {
    const parsed = parseActionFromContent(
      actionBlock({
        action: true,
        action_type: "create_category",
        display: DISPLAY,
        params: { category_name: "House" },
      })
    );

    expect(parsed).toBeNull();
  });

  it("renders no card when the type is missing or not a string", () => {
    for (const actionType of [undefined, null, "", 7, {}]) {
      const parsed = parseActionFromContent(
        actionBlock({ action: true, action_type: actionType, display: DISPLAY, params: {} })
      );
      expect(parsed, JSON.stringify(actionType)).toBeNull();
    }
  });

  it("returns null for content with no action block, malformed JSON, or action !== true", () => {
    expect(parseActionFromContent("Your budget looks fine.")).toBeNull();
    expect(parseActionFromContent("```action\n{ not json\n```")).toBeNull();
    expect(
      parseActionFromContent(
        actionBlock({
          action: false,
          action_type: "create_expense",
          display: DISPLAY,
          params: {},
        })
      )
    ).toBeNull();
  });

  /* Legacy malformed category cards: shaped right, typed right, but carrying params the backend
   * rejects outright — so the card was live and its Confirm could only ever error. */
  describe("create_budget_category params", () => {
    function categoryCard(params: Record<string, unknown>): string {
      return actionBlock({
        action: true,
        action_type: "create_budget_category",
        display: DISPLAY,
        params,
      });
    }

    it("parses the supported valid card", () => {
      const parsed = parseActionFromContent(
        categoryCard({ category_name: "House", group_name: "Needs" })
      );
      expect(parsed?.action_type).toBe("create_budget_category");
      expect(parsed?.params).toEqual({ category_name: "House", group_name: "Needs" });
    });

    it("parses a valid card carrying a positive integer target", () => {
      const parsed = parseActionFromContent(
        categoryCard({ category_name: "House", group_name: "Needs", target_cents: 100 })
      );
      expect(parsed?.params.target_cents).toBe(100);
    });

    it("renders no card when group_name is missing", () => {
      expect(parseActionFromContent(categoryCard({ category_name: "House" }))).toBeNull();
    });

    it("renders no card when category_name is missing", () => {
      expect(parseActionFromContent(categoryCard({ group_name: "Needs" }))).toBeNull();
    });

    it("renders no card for blank or non-string names", () => {
      const blanks: Record<string, unknown>[] = [
        { category_name: "", group_name: "Needs" },
        { category_name: "   ", group_name: "Needs" },
        { category_name: "House", group_name: "" },
        { category_name: "House", group_name: "\t\n" },
        { category_name: null, group_name: "Needs" },
        { category_name: "House", group_name: 7 },
      ];
      for (const params of blanks) {
        expect(parseActionFromContent(categoryCard(params)), JSON.stringify(params)).toBeNull();
      }
    });

    /* The backend rejects `target_cents <= 0`, and a fractional cent is not a cent — either one
     * makes Confirm a guaranteed error. NaN is absent from this list on purpose: JSON.stringify
     * turns it into `null`, so it arrives as the legitimate "no target" case, not as a bad one. */
    it("renders no card for a non-positive, fractional or non-numeric target", () => {
      const targets: unknown[] = [0, -1, -250, 12.5, "100", true, [], {}];
      for (const target_cents of targets) {
        const parsed = parseActionFromContent(
          categoryCard({ category_name: "House", group_name: "Needs", target_cents })
        );
        expect(parsed, JSON.stringify(target_cents)).toBeNull();
      }
    });

    it("treats an absent or null target as the optional field it is", () => {
      expect(
        parseActionFromContent(
          categoryCard({ category_name: "House", group_name: "Needs", target_cents: null })
        )
      ).not.toBeNull();
    });
  });

  it("requires both display and params before offering a card", () => {
    expect(
      parseActionFromContent(
        actionBlock({ action: true, action_type: "create_expense", params: {} })
      )
    ).toBeNull();
    expect(
      parseActionFromContent(
        actionBlock({ action: true, action_type: "create_expense", display: DISPLAY })
      )
    ).toBeNull();
  });
});
