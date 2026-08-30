import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useImport } from "@/hooks/useImport";
import {
  hostedAiMessageKey,
  isHostedAiError,
  parseAppError,
} from "@/lib/appError";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const invokeMock = vi.fn();
const listenMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => listenMock(...args),
}));

let hook: ReturnType<typeof useImport>;

function Harness() {
  hook = useImport();
  return null;
}

type EventHandler = (event: { payload: unknown }) => void;

describe("useImport", () => {
  let container: HTMLDivElement;
  let root: Root;
  let handlers: Map<string, EventHandler>;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    invokeMock.mockReset();
    listenMock.mockReset();
    handlers = new Map();
    listenMock.mockImplementation(async (event: string, handler: EventHandler) => {
      handlers.set(event, handler);
      return vi.fn();
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<Harness />));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function startImport() {
    await act(async () => {
      await hook.startImport("/tmp/statement.pdf");
    });
  }

  it("preserves a hosted-AI code so the parser selects its own localized message", async () => {
    // Given a hosted attempt the gateway refused for an exhausted monthly quota
    invokeMock.mockRejectedValue({
      type: "hosted_ai",
      code: "quota_exhausted",
      message: "Monthly request limit reached.",
      recoverable: true,
    });

    // When the import is started
    await startImport();

    // Then the rejection reaches React with its own code, and the shared parser resolves the
    // quota wording rather than the generic hosted-unavailable fallback
    const parsed = parseAppError(hook.error);
    expect(isHostedAiError(parsed) && parsed.code).toBe("quota_exhausted");
    expect(isHostedAiError(parsed) && hostedAiMessageKey(parsed.code)).toBe(
      "hostedAi.quotaExhausted",
    );
    expect(hook.status).toBe("error");
  });

  it("preserves each of the four hosted refusals whose remedy differs", async () => {
    // Given each hosted code the import surface can actually receive, whose remedy differs from
    // every other. Not all eight: the closed table's validation, size, encoding and
    // reauthentication classes are covered by their own cases rather than this loop.
    for (const code of [
      "premium_required",
      "quota_exhausted",
      "unauthorized",
      "hosted_unavailable",
    ] as const) {
      invokeMock.mockRejectedValue({
        type: "hosted_ai",
        code,
        message: "stub",
        recoverable: true,
      });

      // When the import fails with it
      await startImport();

      // Then that exact code survives — never collapsed into a shared "unavailable"
      const parsed = parseAppError(hook.error);
      expect(isHostedAiError(parsed) && parsed.code).toBe(code);
    }
  });

  it("preserves the unrecoverable flag so an oversized file is not offered a pointless retry", async () => {
    // Given a payload the hosted service will reject identically on every attempt
    invokeMock.mockRejectedValue({
      type: "hosted_ai",
      code: "payload_too_large",
      message: "Too large.",
      recoverable: false,
    });

    await startImport();

    const parsed = parseAppError(hook.error);
    expect(isHostedAiError(parsed) && parsed.recoverable).toBe(false);
  });

  it("still reports a non-hosted rejection under its own type", async () => {
    // Given the local machine has no provider at all
    invokeMock.mockRejectedValue({
      type: "not_configured",
      message: "AI provider not configured",
    });

    await startImport();

    expect(hook.error?.type).toBe("not_configured");
    expect(parseAppError(hook.error).type).toBe("not_configured");
  });

  it("keeps the emitted progress event's recoverable flag", async () => {
    // Given a failure the backend reported over the event channel
    invokeMock.mockResolvedValue(null);
    await startImport();

    // When the error event lands
    act(() => {
      handlers.get("import:error")?.({
        payload: { message: "Import failed", recoverable: false },
      });
    });

    // Then the flag the backend sent is what React holds
    expect(hook.status).toBe("error");
    expect(hook.error?.recoverable).toBe(false);
  });

  it("lets a typed rejection win over a code-less event that lands after it", async () => {
    // Given the invoke rejection carries a hosted code and is NOT retryable, while the event that
    // follows carries neither a code nor that verdict. Both halves differ from the event's values
    // on purpose: identical fixtures would pass whether or not the merge preserved anything.
    invokeMock.mockRejectedValue({
      type: "hosted_ai",
      code: "payload_too_large",
      message: "Too large.",
      recoverable: false,
    });
    await startImport();

    // When the code-less event arrives last, as it can under a different IPC delivery order
    act(() => {
      handlers.get("import:error")?.({
        payload: { message: "Import failed", recoverable: true },
      });
    });

    // Then the held typed rejection is untouched: the code still selects its own wording, and the
    // original unrecoverable verdict still suppresses a pointless retry
    const parsed = parseAppError(hook.error);
    expect(isHostedAiError(parsed) && parsed.code).toBe("payload_too_large");
    expect(isHostedAiError(parsed) && hostedAiMessageKey(parsed.code)).toBe(
      "hostedAi.payloadTooLarge",
    );
    expect(hook.error?.recoverable).toBe(false);
    expect(hook.error?.type).toBe("hosted_ai");
  });

  it("still reports a code-less event when no typed rejection was ever held", async () => {
    // Given nothing rejected — the command resolved and only the event reported the failure
    invokeMock.mockResolvedValue(null);
    await startImport();

    act(() => {
      handlers.get("import:error")?.({
        payload: { message: "Bedrock unavailable", recoverable: true },
      });
    });

    // Then the event's own message and recoverability are what surface
    expect(hook.error?.message).toBe("Bedrock unavailable");
    expect(hook.error?.recoverable).toBe(true);
    expect(hook.error?.type).toBeUndefined();
  });

  it("clears a held typed rejection so the next attempt's event is not shadowed", async () => {
    // Given a first attempt that failed with a typed hosted rejection
    invokeMock.mockRejectedValue({
      type: "hosted_ai",
      code: "quota_exhausted",
      message: "No quota.",
      recoverable: true,
    });
    await startImport();
    expect(hook.error?.type).toBe("hosted_ai");

    // When a second attempt succeeds at the command boundary but fails over the event channel
    invokeMock.mockResolvedValue(null);
    await startImport();
    act(() => {
      handlers.get("import:error")?.({
        payload: { message: "Something else broke", recoverable: true },
      });
    });

    // Then the new failure is reported, not the previous attempt's stale hosted code
    expect(hook.error?.message).toBe("Something else broke");
    expect(hook.error?.type).toBeUndefined();
  });
});
