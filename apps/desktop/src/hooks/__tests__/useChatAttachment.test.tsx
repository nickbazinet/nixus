import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useChatAttachment,
  type ChatAttachmentState,
  type ChatPickOutcome,
} from "@/hooks/useChatAttachment";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const invokeMock = vi.fn();
const openMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...args: unknown[]) => openMock(...args),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const PICKED = "/Users/tester/Documents/january.csv";

let state: ChatAttachmentState;

function Harness() {
  state = useChatAttachment();
  return null;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  invokeMock.mockReset();
  openMock.mockReset();
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

async function pick(): Promise<ChatPickOutcome> {
  let outcome: ChatPickOutcome = "cancelled";
  await act(async () => {
    outcome = await state.pick();
  });
  return outcome;
}

describe("useChatAttachment", () => {
  it("selects a validated file and reports its basename", async () => {
    openMock.mockResolvedValue(PICKED);
    invokeMock.mockResolvedValue({ file_name: "january.csv" });

    expect(await pick()).toBe("selected");

    expect(state.attachment).toEqual({ path: PICKED, name: "january.csv" });
    expect(state.errorKey).toBeNull();
  });

  /* The dialog plugin rejects when the native window cannot be opened or is torn down.
   * Swallowed, the attach button would look inert with nothing explaining why. */
  it("reports a rejected native dialog as an unreadable refusal", async () => {
    openMock.mockRejectedValue(new Error("dialog unavailable"));

    expect(await pick()).toBe("refused");

    expect(state.errorKey).toBe("chat.attachmentUnreadable");
    expect(state.attachment).toBeNull();
    // The rejection must not reach the validation command.
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("drops a previously selected file when a later dialog rejects", async () => {
    openMock.mockResolvedValue(PICKED);
    invokeMock.mockResolvedValue({ file_name: "january.csv" });
    await pick();

    openMock.mockRejectedValue(new Error("dialog unavailable"));
    expect(await pick()).toBe("refused");

    // A refusal always drops the selection, so the user is never shown a chip that the
    // failed attempt did not produce.
    expect(state.attachment).toBeNull();
    expect(state.errorKey).toBe("chat.attachmentUnreadable");
  });

  it("maps a validation refusal to its own localized key", async () => {
    openMock.mockResolvedValue(PICKED);
    invokeMock.mockRejectedValue({
      type: "validation",
      message: "refused",
      field: "attachment_too_large",
    });

    expect(await pick()).toBe("refused");

    expect(state.errorKey).toBe("chat.attachmentTooLarge");
    expect(state.attachment).toBeNull();
  });

  it("falls back to the unreadable key for an unrecognized rejection", async () => {
    openMock.mockResolvedValue(PICKED);
    invokeMock.mockRejectedValue({ type: "database", message: "locked" });

    expect(await pick()).toBe("refused");

    expect(state.errorKey).toBe("chat.attachmentUnreadable");
  });

  /* Approved matrix row "Picker cancelled: draft message remains unchanged, no error". */
  it("reports a cancelled picker and changes nothing", async () => {
    openMock.mockResolvedValue(PICKED);
    invokeMock.mockResolvedValue({ file_name: "january.csv" });
    await pick();

    openMock.mockResolvedValue(null);
    expect(await pick()).toBe("cancelled");

    expect(state.attachment).toEqual({ path: PICKED, name: "january.csv" });
    expect(state.errorKey).toBeNull();
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  /* A cancel must not clear a standing refusal either — that error explains a failure the
   * dismissed dialog did nothing about. The composer relies on the `cancelled` outcome to
   * leave the route's send-time error alone. */
  it("preserves a standing refusal across a cancelled picker", async () => {
    openMock.mockResolvedValue(PICKED);
    invokeMock.mockRejectedValue({
      type: "validation",
      message: "refused",
      field: "attachment_empty",
    });
    await pick();
    expect(state.errorKey).toBe("chat.attachmentEmpty");

    openMock.mockResolvedValue(null);
    expect(await pick()).toBe("cancelled");

    expect(state.errorKey).toBe("chat.attachmentEmpty");
  });

  /* Two clicks land in one tick, so both read the pre-update `picking` state: only the
   * synchronous ref guard stops a second native dialog from opening. */
  it("opens only one native dialog when pick is called twice concurrently", async () => {
    let release: (value: string) => void = () => {};
    openMock.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          release = resolve;
        })
    );
    invokeMock.mockResolvedValue({ file_name: "january.csv" });

    let first: Promise<ChatPickOutcome>;
    let second: Promise<ChatPickOutcome>;
    await act(async () => {
      first = state.pick();
      second = state.pick();
      release(PICKED);
      await Promise.all([first, second]);
    });

    expect(openMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(await second!).toBe("cancelled");
    expect(await first!).toBe("selected");
  });

  it("exposes picking while a dialog is open and clears it afterwards", async () => {
    let release: (value: string) => void = () => {};
    openMock.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          release = resolve;
        })
    );
    invokeMock.mockResolvedValue({ file_name: "january.csv" });

    let pending: Promise<ChatPickOutcome>;
    await act(async () => {
      pending = state.pick();
      await Promise.resolve();
    });
    expect(state.picking).toBe(true);

    await act(async () => {
      release(PICKED);
      await pending!;
    });
    expect(state.picking).toBe(false);
  });

  /* The flag has to come back down even when the dialog throws, or one failure disables the
   * attach button for the rest of the session. */
  it("clears picking after a rejected dialog", async () => {
    openMock.mockRejectedValue(new Error("dialog unavailable"));

    await pick();

    expect(state.picking).toBe(false);
  });

  it("clears picking after a validation refusal", async () => {
    openMock.mockResolvedValue(PICKED);
    invokeMock.mockRejectedValue({
      type: "validation",
      message: "refused",
      field: "attachment_empty",
    });

    await pick();

    expect(state.picking).toBe(false);
  });

  it("allows a new pick once the previous one settled", async () => {
    openMock.mockResolvedValue(PICKED);
    invokeMock.mockResolvedValue({ file_name: "january.csv" });

    await pick();
    await pick();

    expect(openMock).toHaveBeenCalledTimes(2);
  });

  it("remove drops both the selection and the refusal", async () => {
    openMock.mockResolvedValue(PICKED);
    invokeMock.mockRejectedValue({
      type: "validation",
      message: "refused",
      field: "attachment_empty",
    });
    await pick();

    act(() => {
      state.remove();
    });

    expect(state.attachment).toBeNull();
    expect(state.errorKey).toBeNull();
  });

  it("offers only the approved extensions to the native picker", async () => {
    openMock.mockResolvedValue(null);

    await pick();

    const [options] = openMock.mock.calls[0] as [
      { multiple: boolean; filters: { extensions: string[] }[] },
    ];
    expect(options.multiple).toBe(false);
    expect([...options.filters[0]!.extensions].sort()).toEqual(
      ["csv", "jpeg", "jpg", "pdf", "png", "txt", "xls", "xlsx"].sort()
    );
  });
});
