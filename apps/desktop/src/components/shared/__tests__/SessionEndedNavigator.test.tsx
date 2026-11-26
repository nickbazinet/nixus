import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SESSION_RECHECK_INTERVAL_MS,
  SessionEndedNavigator,
} from "@/components/shared/SessionEndedNavigator";
import { queryKeys } from "@/lib/constants";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const listenMock = vi.fn();
const unlistenMock = vi.fn();
const navigateMock = vi.fn();
const toastErrorMock = vi.fn();

vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => listenMock(...args),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("sonner", () => ({
  toast: { error: (...args: unknown[]) => toastErrorMock(...args) },
}));

describe("SessionEndedNavigator", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  async function mount() {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <SessionEndedNavigator />
        </QueryClientProvider>,
      );
    });
  }

  function endedHandler() {
    const call = listenMock.mock.calls.find(
      ([name]) => name === "auth:session-ended",
    ) as [string, () => void] | undefined;
    if (call === undefined) {
      throw new Error("No listener was registered for auth:session-ended");
    }
    return call[1];
  }

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    listenMock.mockReset();
    unlistenMock.mockReset();
    navigateMock.mockReset();
    toastErrorMock.mockReset();
    listenMock.mockResolvedValue(unlistenMock);
    queryClient = new QueryClient();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it("sweeps the account's state, says why, and lands on the picker when the session ends", async () => {
    await mount();
    queryClient.setQueryData(queryKeys.auth.session, {
      status: "LoggedIn",
      email: "a@b.c",
      name: null,
    });

    await act(async () => endedHandler()());

    expect(queryClient.getQueryData(queryKeys.auth.session)).toBeUndefined();
    expect(toastErrorMock).toHaveBeenCalledWith("profile.sessionEnded");
    expect(navigateMock).toHaveBeenCalledWith({ to: "/picker" });
  });

  it("does nothing until Rust says the session ended", async () => {
    await mount();

    expect(navigateMock).not.toHaveBeenCalled();
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it("re-reads the session on an interval and on window focus, so a dead login ends without a restart", async () => {
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await mount();

    await act(async () => {
      vi.advanceTimersByTime(SESSION_RECHECK_INTERVAL_MS);
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: queryKeys.auth.session,
    });

    invalidate.mockClear();
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("stops listening and re-checking once it unmounts", async () => {
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await mount();

    await act(async () => root.render(<div />));
    invalidate.mockClear();
    await act(async () => {
      vi.advanceTimersByTime(SESSION_RECHECK_INTERVAL_MS * 2);
      window.dispatchEvent(new Event("focus"));
    });

    expect(unlistenMock).toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
  });
});
