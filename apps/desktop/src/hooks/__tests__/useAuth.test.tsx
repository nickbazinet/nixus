import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
  type MockInstance,
} from "vitest";
import { useAuthSession, useSignIn, useSignOut } from "@/hooks/useAuth";

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

// The hook results have to escape the tree: this suite drives them directly instead of
// clicking a UI, and @testing-library/react is not a dependency of @nixus/desktop.
let signIn: ReturnType<typeof useSignIn>;
let signOut: ReturnType<typeof useSignOut>;
let authSession: ReturnType<typeof useAuthSession>;

function MutationsHarness() {
  signIn = useSignIn();
  signOut = useSignOut();
  return null;
}

// useAuthSession is a query that also registers the callback listener on mount. Keeping it
// out of the shared harness is what lets the mutation cases assert on mock.calls[0].
function SessionHarness() {
  authSession = useAuthSession();
  return null;
}

// The account menu's shape: a local profile is open, so the session must not be read at all.
function DisabledSessionHarness() {
  authSession = useAuthSession({ enabled: false });
  return null;
}

describe("useAuth", () => {
  let container: HTMLDivElement;
  let root: Root;
  let unmounted: boolean;
  let queryClient: QueryClient;
  let invalidateSpy: MockInstance<QueryClient["invalidateQueries"]>;
  let removeSpy: MockInstance<QueryClient["removeQueries"]>;
  let unlistenMocks: Mock[];

  function render(node: ReactNode) {
    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>,
      );
    });
  }

  function invalidatedKeys(): unknown[] {
    return invalidateSpy.mock.calls.map((call) => call[0]?.queryKey);
  }

  function removedKeys(): unknown[] {
    return removeSpy.mock.calls.map((call) => call[0]?.queryKey);
  }

  // React's scheduler can defer the re-render triggered by a resolved query across more
  // than one macrotask turn, so a single setTimeout(0) flush is not reliable (measured
  // ~50-65% failure rate in Story 25.2). Poll render-derived state, not the mock.
  async function settleQueries(
    isSettled: () => boolean = () =>
      authSession !== undefined && !authSession.isLoading,
  ) {
    for (let attempt = 0; attempt < 20; attempt++) {
      if (isSettled()) {
        return;
      }
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
  }

  function fireCallbackEvent() {
    const [, handler] = listenMock.mock.calls[0] as [string, () => void];
    handler();
  }

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    invokeMock.mockReset();
    listenMock.mockReset();
    unlistenMocks = [];
    // listen must resolve a Promise: the hook awaits it, and a synchronous return would
    // make the cleaned-flag branch unreachable.
    listenMock.mockImplementation(async () => {
      const unlisten = vi.fn();
      unlistenMocks.push(unlisten);
      return unlisten;
    });
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    removeSpy = vi.spyOn(queryClient, "removeQueries");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    unmounted = false;
    render(<MutationsHarness />);
  });

  afterEach(() => {
    if (!unmounted) {
      act(() => root.unmount());
    }
    container.remove();
    queryClient.clear();
    invalidateSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it("reads the session through the zero-arg command", async () => {
    // Given a machine with no stored session
    invokeMock.mockResolvedValue({ status: "LoggedOut" });

    // When something reads the session
    render(<SessionHarness />);
    await settleQueries();

    // Then the command carries no payload — AppHandle is Tauri-injected, never sent from JS
    expect(invokeMock.mock.calls[0]).toEqual(["get_auth_session"]);
    expect(authSession.data).toEqual({ status: "LoggedOut" });
  });

  it("caches the session under the shared auth query key", async () => {
    // Given a signed-in user whose Cognito profile carries no name claim
    const session = { status: "LoggedIn", email: "a@b.c", name: null };
    invokeMock.mockResolvedValue(session);

    render(<SessionHarness />);
    await settleQueries();

    // A wrong key literal in constants.ts is invisible to tsc; this is what catches it
    expect(queryClient.getQueryData(["auth", "session"])).toBeDefined();
    expect(queryClient.getQueryData(["auth", "session"])).toEqual(session);
  });

  it("reads no session at all while the query is disabled", async () => {
    // Given a stored session the caller is not allowed to look at
    invokeMock.mockResolvedValue({ status: "SessionExpired" });

    // When the account menu mounts with a local profile open
    render(<DisabledSessionHarness />);
    await settleQueries(() => listenMock.mock.calls.length > 0);

    // Then the keyring is never touched and no session state is exposed
    expect(invokeMock).not.toHaveBeenCalled();
    expect(authSession.data).toBeUndefined();
    expect(authSession.isError).toBe(false);
  });

  it("keeps the callback listener live while the query is disabled", async () => {
    // Given the same disabled reader
    invokeMock.mockResolvedValue({ status: "LoggedOut" });

    render(<DisabledSessionHarness />);
    await settleQueries(() => listenMock.mock.calls.length > 0);

    expect(listenMock.mock.calls[0][0]).toBe("auth:callback-received");

    // When a cloud sign-in completes and Rust stores the session
    act(() => {
      fireCallbackEvent();
    });

    // Then the caches this hook owns are still invalidated, so a surface that only started reading
    // after the callback gets the new account rather than the previous one's entry
    expect(invalidatedKeys()).toEqual([
      ["auth", "session"],
      ["active-profile"],
    ]);

    // And invalidation does not smuggle the read back in
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("starts login carrying the plain Login intent and nothing else", async () => {
    invokeMock.mockResolvedValue(null);

    await act(async () => {
      await signIn.mutateAsync({ kind: "Login" });
    });

    // start_login only opens the system browser, so the session is unchanged at that
    // moment; the auth:callback-received event is what reflects a completed sign-in.
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock.mock.calls[0]).toEqual([
      "start_login",
      { intent: { kind: "Login" } },
    ]);
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  // Story 35.6's frontend half: the two Cloud entry points differ by one local dataset id and
  // nothing else. Asserted as the whole argument object, so an added payload field fails here.
  it("sends only the intent — never any profile data — for either entry point", async () => {
    invokeMock.mockResolvedValue(null);

    await act(async () => {
      await signIn.mutateAsync({ kind: "Login" });
      await signIn.mutateAsync({
        kind: "Migrate",
        source_dataset_id: "local-1",
      });
    });

    expect(invokeMock.mock.calls).toEqual([
      ["start_login", { intent: { kind: "Login" } }],
      [
        "start_login",
        { intent: { kind: "Migrate", source_dataset_id: "local-1" } },
      ],
    ]);
  });

  it("invalidates the session after signing out", async () => {
    invokeMock.mockResolvedValue(null);

    await act(async () => {
      await signOut.mutateAsync();
    });

    // Then the auth key and the derived signed-in badge are refetched, and nothing else:
    // signing out of a cloud-linked profile changes the badge, never the dataset.
    expect(invokeMock.mock.calls[0]).toEqual(["sign_out"]);
    expect(invalidatedKeys()).toEqual([
      ["auth", "session"],
      ["active-profile"],
    ]);
  });

  it("invalidates the session when the deep-link callback event fires", async () => {
    invokeMock.mockResolvedValue({ status: "LoggedOut" });

    render(<SessionHarness />);
    await settleQueries(() => listenMock.mock.calls.length > 0);

    expect(listenMock.mock.calls[0][0]).toBe("auth:callback-received");

    // When the browser sign-in completes and Rust stores the session
    act(() => {
      fireCallbackEvent();
    });

    // Then the UI refreshes with no manual reload, including the profile the callback may have
    // just switched to (Stories 35.2/35.3)
    expect(invalidatedKeys()).toEqual([
      ["auth", "session"],
      ["active-profile"],
    ]);
  });

  // Row 10 of Story 30.2's degradation matrix, and the only test of it anywhere.
  // TanStack Query removes by key PREFIX, and ["tfsa-accumulated-limit"] shares no
  // prefix with ["profile"], so the Story 28.2 removal does not reach it. A dev
  // reasoning "the profile cache is cleared, so the derived figure is too" ships
  // the previous account's dollar amount — a wrong number and a privacy leak at once.
  it("removes the accumulated TFSA figure after signing out", async () => {
    invokeMock.mockResolvedValue(null);

    await act(async () => {
      await signOut.mutateAsync();
    });

    // removeQueries, never invalidateQueries: invalidation leaves the previous
    // account's figure rendered while the refetch is in flight.
    expect(removedKeys()).toContainEqual(["tfsa-accumulated-limit"]);
    expect(invalidatedKeys()).not.toContainEqual(["tfsa-accumulated-limit"]);
  });

  it("removes the accumulated TFSA figure when a different account signs in", async () => {
    invokeMock.mockResolvedValue({ status: "LoggedOut" });

    render(<SessionHarness />);
    await settleQueries(() => listenMock.mock.calls.length > 0);

    act(() => {
      fireCallbackEvent();
    });

    expect(removedKeys()).toContainEqual(["tfsa-accumulated-limit"]);
    expect(invalidatedKeys()).not.toContainEqual(["tfsa-accumulated-limit"]);
  });

  it("unsubscribes the callback listener on unmount", async () => {
    invokeMock.mockResolvedValue({ status: "LoggedOut" });

    render(<SessionHarness />);
    await settleQueries(() => listenMock.mock.calls.length > 0);

    expect(unlistenMocks.length).toBeGreaterThan(0);

    act(() => root.unmount());
    unmounted = true;

    // StrictMode double-invokes effects, so an unreleased channel leaks on every remount
    expect(unlistenMocks.every((unlisten) => unlisten.mock.calls.length > 0)).toBe(
      true,
    );
  });

  it("surfaces a rejected session read as query error state", async () => {
    // Given a keyring entry Rust cannot decode (Story 26.5 AC 12)
    invokeMock.mockRejectedValue({
      type: "auth",
      message: "Your stored session could not be read.",
      recoverable: true,
    });

    render(<SessionHarness />);
    await settleQueries();

    // Then the rejection lands in query state instead of throwing through render
    expect(authSession.isError).toBe(true);
    expect(authSession.error).toMatchObject({
      type: "auth",
      message: "Your stored session could not be read.",
      recoverable: true,
    });
  });

  it("never invokes the deep-link callback command from the frontend", async () => {
    invokeMock.mockResolvedValue({ status: "LoggedOut" });

    render(
      <>
        <MutationsHarness />
        <SessionHarness />
      </>,
    );
    await settleQueries();

    await act(async () => {
      await signIn.mutateAsync({ kind: "Login" });
      await signOut.mutateAsync();
    });

    // handle_auth_callback is reachable only through the Rust deep-link seam, which is
    // what enforces the state CSRF check and the pending-attempt lookup.
    expect(
      invokeMock.mock.calls.every((call) => call[0] !== "handle_auth_callback"),
    ).toBe(true);
  });
});
