import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChat } from "@/hooks/useChat";
import type { ActionPayload } from "@/components/chat/ChatMessageBubble";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const invokeMock = vi.fn();
const invalidateQueries = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: () => Promise.resolve(() => {}),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries }),
}));

const CANCEL_COMMAND = "record_chat_action_cancelled";

const CATEGORY_ACTION: ActionPayload = {
  action: true,
  action_type: "create_budget_category",
  display: { label: "Add Category", details: [{ field: "Category", value: "House" }] },
  params: { category_name: "House", group_name: "Housing" },
};

type Chat = ReturnType<typeof useChat>;

let chat: Chat;

function Harness() {
  chat = useChat({ agentId: "budget-helper" });
  return null;
}

let container: HTMLDivElement;
let root: Root;

/** Calls of one command, so an assertion never depends on the order of unrelated IPC. */
function callsOf(command: string): Record<string, unknown>[] {
  return invokeMock.mock.calls
    .filter((call) => call[0] === command)
    .map((call) => (call[1] ?? {}) as Record<string, unknown>);
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  invokeMock.mockReset();
  invalidateQueries.mockReset();
  invokeMock.mockResolvedValue({});
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(<Harness />);
  });
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

describe("useChat action cancellation", () => {
  it("records the cancellation through the backend command", async () => {
    await act(async () => {
      await chat.cancelAction(0, CATEGORY_ACTION);
    });

    const calls = callsOf(CANCEL_COMMAND);
    expect(calls).toHaveLength(1);
    expect(calls[0].action_type).toBe("create_budget_category");
  });

  /* The persisted note is server-generated. Anything the frontend adds to this payload becomes
   * text the model reads as instruction next turn, so the argument list stays closed. */
  it("sends only the conversation and the action type, never free text", async () => {
    await act(async () => {
      await chat.cancelAction(0, CATEGORY_ACTION);
    });

    expect(Object.keys(callsOf(CANCEL_COMMAND)[0]).sort()).toEqual([
      "action_type",
      "conversation_id",
    ]);
  });

  it("cancels against the conversation the send established", async () => {
    invokeMock.mockResolvedValue({ conversation_id: 7 });
    await act(async () => {
      await chat.sendMessage("Add House to Housing");
    });

    await act(async () => {
      await chat.cancelAction(0, CATEGORY_ACTION);
    });

    expect(callsOf(CANCEL_COMMAND)[0].conversation_id).toBe(7);
  });

  it("marks the card handled so the buttons cannot be pressed twice", async () => {
    invokeMock.mockResolvedValue({ conversation_id: 7 });
    await act(async () => {
      await chat.sendMessage("Add House to Housing");
    });

    await act(async () => {
      await chat.cancelAction(0, CATEGORY_ACTION);
    });

    expect(chat.messages[0].actionHandled).toBe(true);
  });

  /* A cancel the user already saw succeed must not silently un-cancel: the card stays handled and
   * the failure is reported, rather than leaving a live card whose cancellation was never stored. */
  it("keeps the card handled and reports the failure when recording fails", async () => {
    invokeMock.mockResolvedValue({ conversation_id: 7 });
    await act(async () => {
      await chat.sendMessage("Add House to Housing");
    });
    invokeMock.mockRejectedValue({ message: "database is locked" });

    await act(async () => {
      await chat.cancelAction(0, CATEGORY_ACTION);
    });

    expect(chat.messages[0].actionHandled).toBe(true);
    expect(chat.messages[chat.messages.length - 1].content).toContain("database is locked");
  });
});

describe("useChat action confirmation", () => {
  it("refreshes budget group and category reads after a category is created", async () => {
    invokeMock.mockResolvedValue({ message: "Done. House added to Housing." });

    await act(async () => {
      await chat.confirmAction(0, CATEGORY_ACTION);
    });

    const invalidated = invalidateQueries.mock.calls.map(
      (call) => (call[0] as { queryKey: string[] }).queryKey[0]
    );
    expect(invalidated).toEqual(
      expect.arrayContaining([
        "budget-groups",
        "budget-categories",
        "all-budget-categories",
        "budget-status",
        "budget-summary",
      ])
    );
  });
});
