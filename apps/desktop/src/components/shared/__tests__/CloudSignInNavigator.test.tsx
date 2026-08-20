import { StrictMode, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloudSignInNavigator } from "@/components/shared/CloudSignInNavigator";

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

/** The handler registered for `event`, which is also the assertion that it was registered at all. */
function handlerFor(event: string) {
  const call = listenMock.mock.calls.find(([name]) => name === event) as
    | [string, (payload: { payload: string }) => void]
    | undefined;
  if (call === undefined) {
    throw new Error(`No listener was registered for ${event}`);
  }
  return call[1];
}

function firedHandler() {
  // Keyed on the auth event, not on `dataset:switched`: the callback emits this one only after it
  // has selected the dataset and latched the picker gate, so navigating here cannot bounce back to
  // the picker — and the picker's own click path, which navigates itself, is left alone.
  const handler = handlerFor("auth:callback-received");
  return () => handler({ payload: "" });
}

describe("CloudSignInNavigator", () => {
  let container: HTMLDivElement;
  let root: Root;

  async function mount() {
    await act(async () => {
      root.render(<CloudSignInNavigator />);
    });
  }

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    listenMock.mockReset();
    unlistenMock.mockReset();
    navigateMock.mockReset();
    toastErrorMock.mockReset();
    listenMock.mockResolvedValue(unlistenMock);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    container.remove();
  });

  it("subscribes to the completed-callback event", async () => {
    await mount();

    expect(firedHandler()).toBeTypeOf("function");
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("lands the user on the newly active profile's own entry view", async () => {
    await mount();

    act(() => firedHandler()());

    // `/`, never a concrete surface: the root gate and `/`'s onboarding check are what decide
    // between an empty dashboard and the wizard, per the new profile's own state.
    expect(navigateMock).toHaveBeenCalledTimes(1);
    expect(navigateMock).toHaveBeenCalledWith({ to: "/" });
  });

  it("reports a sign-in whose profile could not be prepared", async () => {
    await mount();

    // The session is stored before the branch that failed, so the user is signed in and this toast
    // is the only thing that says why nothing else happened.
    act(() =>
      handlerFor("auth:cloud-link-failed")({
        payload: "The profile you started migrating is no longer open.",
      }),
    );

    expect(toastErrorMock).toHaveBeenCalledWith(
      "The profile you started migrating is no longer open.",
    );
  });

  it("reports a callback that failed before any session was stored", async () => {
    await mount();

    // A token exchange that could not reach Cognito: the same event, emitted from the same single
    // top-level site, with no `auth:callback-received` alongside it. Nothing may navigate — the user
    // is still exactly where they started, on the picker — but they must be told.
    act(() =>
      handlerFor("auth:cloud-link-failed")({
        payload:
          "Could not reach the sign-in service. Check your connection and try again.",
      }),
    );

    expect(toastErrorMock).toHaveBeenCalledWith(
      "Could not reach the sign-in service. Check your connection and try again.",
    );
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("falls back to the shipped cloud-failure copy when the event carries no message", async () => {
    await mount();

    act(() => handlerFor("auth:cloud-link-failed")({ payload: "" }));

    expect(toastErrorMock).toHaveBeenCalledWith("datasets.cloudFailed");
  });

  it("unlistens both subscriptions on unmount", async () => {
    await mount();

    await act(async () => root.unmount());

    expect(unlistenMock).toHaveBeenCalledTimes(2);
  });

  // Without the `cleaned` flag the first mount's listeners resolve after its cleanup and are never
  // torn down, leaving StrictMode with two live subscriptions that both navigate on one event.
  it("keeps exactly one subscription per event across StrictMode's double mount", async () => {
    await act(async () => {
      root.render(
        <StrictMode>
          <CloudSignInNavigator />
        </StrictMode>,
      );
    });

    expect(listenMock).toHaveBeenCalledTimes(4);
    expect(unlistenMock).toHaveBeenCalledTimes(2);

    await act(async () => root.unmount());

    expect(unlistenMock).toHaveBeenCalledTimes(4);
  });
});
