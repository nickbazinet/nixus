import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  MutationObserver,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
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
import {
  continueCloudSessionMutationOptions,
  useAuthSession,
  useCloudAiPremium,
  useSignIn,
  useSignOut,
} from "@/hooks/useAuth";
import { queryKeys } from "@/lib/constants";
import { IMPORT_DRAFT_STORAGE_KEY } from "@/lib/datasetSwitch";
import { installLocalStorageMock } from "@/test/localStorageMock";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const invokeMock = vi.fn();
const listenMock = vi.fn();
const navigateMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => listenMock(...args),
}));

// Sign-out now leaves the route it was triggered from, so the hook reads the router. Mocked rather
// than wrapped in a real router: this suite drives hooks directly and mounts no route tree.
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
}));

// The hook results have to escape the tree: this suite drives them directly instead of
// clicking a UI, and @testing-library/react is not a dependency of @nixus/desktop.
let signIn: ReturnType<typeof useSignIn>;
let signOut: ReturnType<typeof useSignOut>;
let authSession: ReturnType<typeof useAuthSession>;
let cloudAiPremium: ReturnType<typeof useCloudAiPremium>;

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

// The entitlement is read on its own, with an explicit gate, because the two states that matter are
// "an account is resolved" and "there is nothing to ask about".
function PremiumHarness({ enabled }: { enabled: boolean }) {
  cloudAiPremium = useCloudAiPremium({ enabled });
  return null;
}

// jsdom's own localStorage is a method-less stub, so the sweep's storage half needs the in-memory
// Storage every other suite here installs.
const localStorageMock = installLocalStorageMock();

describe("useAuth", () => {
  let container: HTMLDivElement;
  let root: Root;
  let unmounted: boolean;
  let queryClient: QueryClient;
  let invalidateSpy: MockInstance<QueryClient["invalidateQueries"]>;
  let removeSpy: MockInstance<QueryClient["removeQueries"]>;
  let clearSpy: MockInstance<QueryClient["clear"]>;
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
    navigateMock.mockReset();
    navigateMock.mockResolvedValue(undefined);
    localStorageMock.clear();
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
    clearSpy = vi.spyOn(queryClient, "clear");
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
    clearSpy.mockRestore();
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

  it("reads no entitlement at all while the gate is closed", async () => {
    // Given an account whose entitlement the caller has no business asking about
    invokeMock.mockResolvedValue(true);

    // When a surface with no resolved account mounts the hook
    render(<PremiumHarness enabled={false} />);
    await settleQueries(() => cloudAiPremium !== undefined);

    // Then nothing is invoked, so no keyring read and no /v1/ai/status request happen
    expect(invokeMock).not.toHaveBeenCalled();
    expect(cloudAiPremium.data).toBeUndefined();
    expect(cloudAiPremium.isError).toBe(false);
  });

  it("reads the entitlement through the zero-arg command once an account is resolved", async () => {
    // Given a signed-in premium account
    invokeMock.mockResolvedValue(true);

    render(<PremiumHarness enabled />);
    await settleQueries(() => cloudAiPremium?.data !== undefined);

    // The command carries no payload: the subject is resolved Rust-side and never sent from JS
    expect(invokeMock.mock.calls[0]).toEqual(["get_cloud_ai_premium"]);
    expect(cloudAiPremium.data).toBe(true);
    // A wrong key literal in constants.ts is invisible to tsc; this is what catches it
    expect(queryClient.getQueryData(["cloud-ai-premium"])).toBe(true);
  });

  it("keeps a rejected entitlement read out of every premium-claiming state", async () => {
    // Given a command that somehow rejects despite Rust answering fail-closed
    invokeMock.mockRejectedValue({ type: "auth", message: "x", recoverable: true });

    render(<PremiumHarness enabled />);
    await settleQueries(() => cloudAiPremium?.isError === true);

    // Then the value stays absent, so `data === true` — the only premium claim — is unreachable
    expect(cloudAiPremium.data).toBeUndefined();
  });

  it("invokes the entitlement command once on rejection, never retrying it", async () => {
    // Given a client that WOULD retry — the shared harness client disables retries globally, so
    // asserting against it would pass whether or not the hook opts out, proving nothing.
    const retryingClient = new QueryClient({
      defaultOptions: { queries: { retry: 2, retryDelay: 0 } },
    });
    invokeMock.mockRejectedValue({ type: "auth", message: "x", recoverable: true });

    act(() => {
      root.render(
        <QueryClientProvider client={retryingClient}>
          <PremiumHarness enabled />
        </QueryClientProvider>,
      );
    });
    await settleQueries(() => cloudAiPremium?.isError === true);

    // Then exactly one attempt: each retry would re-open the OS secure store for an answer Rust
    // has already resolved fail-closed.
    expect(invokeMock).toHaveBeenCalledTimes(1);
    retryingClient.clear();
  });

  // The cross-account leak this feature could ship: TanStack Query serves a stale entry while
  // refetching, so an invalidated `true` renders a Premium badge under the account that just
  // signed in — one that may hold no entitlement at all.
  it("removes the entitlement when a different account signs in", async () => {
    invokeMock.mockResolvedValue({ status: "LoggedOut" });

    render(<SessionHarness />);
    await settleQueries(() => listenMock.mock.calls.length > 0);
    queryClient.setQueryData(queryKeys.cloudAiPremium, true);

    act(() => {
      fireCallbackEvent();
    });

    expect(removedKeys()).toContainEqual(["cloud-ai-premium"]);
    expect(invalidatedKeys()).not.toContainEqual(["cloud-ai-premium"]);
    expect(queryClient.getQueryData(queryKeys.cloudAiPremium)).toBeUndefined();
  });

  it("sweeps the entitlement away with the rest of the account on sign-out", async () => {
    invokeMock.mockResolvedValue(null);
    queryClient.setQueryData(queryKeys.cloudAiPremium, true);

    await act(async () => {
      await signOut.mutateAsync();
    });

    expect(queryClient.getQueryData(queryKeys.cloudAiPremium)).toBeUndefined();
  });

  it("starts login carrying the plain Login intent, the sign-in entry, and nothing else", async () => {
    invokeMock.mockResolvedValue(null);

    await act(async () => {
      await signIn.mutateAsync({ intent: { kind: "Login" }, entry: "SignIn" });
    });

    // start_login only opens the system browser, so the session is unchanged at that
    // moment; the auth:callback-received event is what reflects a completed sign-in.
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock.mock.calls[0]).toEqual([
      "start_login",
      { intent: { kind: "Login" }, entry: "SignIn" },
    ]);
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  // Story 35.6's frontend half: the two Cloud entry points differ by one local dataset id and
  // nothing else. Asserted as the whole argument object, so an added payload field fails here.
  it("sends only the intent and the entry — never any profile data — for every entry point", async () => {
    invokeMock.mockResolvedValue(null);

    await act(async () => {
      await signIn.mutateAsync({ intent: { kind: "Login" }, entry: "SignIn" });
      await signIn.mutateAsync({
        intent: { kind: "Migrate", source_dataset_id: "local-1" },
        entry: "SignIn",
      });
      await signIn.mutateAsync({ intent: { kind: "Login" }, entry: "SignUp" });
    });

    expect(invokeMock.mock.calls).toEqual([
      ["start_login", { intent: { kind: "Login" }, entry: "SignIn" }],
      [
        "start_login",
        {
          intent: { kind: "Migrate", source_dataset_id: "local-1" },
          entry: "SignIn",
        },
      ],
      ["start_login", { intent: { kind: "Login" }, entry: "SignUp" }],
    ]);
  });

  // Creating an account is one authorize-URL variant of the same flow, so it runs the SAME command:
  // a second command — or a second listener — would be a second attempt racing the first.
  it("reaches the signup entry through the one start_login command", async () => {
    invokeMock.mockResolvedValue(null);

    await act(async () => {
      await signIn.mutateAsync({ intent: { kind: "Login" }, entry: "SignUp" });
    });

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock.mock.calls[0][0]).toBe("start_login");
    // The local instruction is unchanged: a new account still lands on the plain Login branch, which
    // find-or-creates its cloud profile.
    expect(invokeMock.mock.calls[0][1]).toEqual({
      intent: { kind: "Login" },
      entry: "SignUp",
    });
  });

  it("sweeps every profile-scoped cache and storage key after signing out", async () => {
    // Given a signed-in account whose profile has cached rows and a resumable import draft
    invokeMock.mockResolvedValue(null);
    queryClient.setQueryData(queryKeys.profile, { email: "a@b.c" });
    queryClient.setQueryData(queryKeys.tfsaAccumulatedLimit, 95000);
    localStorage.setItem(IMPORT_DRAFT_STORAGE_KEY, "{}");

    // When the account signs out
    await act(async () => {
      await signOut.mutateAsync();
    });

    // Then nothing of that account survives — the whole cache, not a hand-listed subset, because a
    // key nobody remembered to list is exactly how the previous account's figures stay on screen
    expect(invokeMock.mock.calls[0]).toEqual(["sign_out"]);
    expect(clearSpy).toHaveBeenCalled();
    expect(queryClient.getQueryData(queryKeys.profile)).toBeUndefined();
    expect(queryClient.getQueryData(queryKeys.tfsaAccumulatedLimit)).toBeUndefined();
    // The canonical sweep, not a bare `queryClient.clear()`: the draft belongs to the profile too,
    // and only `clearProfileScopedState` reaches it.
    expect(localStorage.getItem(IMPORT_DRAFT_STORAGE_KEY)).toBeNull();
  });

  it("leaves for the picker only after the sweep has run", async () => {
    invokeMock.mockResolvedValue(null);

    await act(async () => {
      await signOut.mutateAsync();
    });

    // Rust re-arms the launch-picker gate on sign-out, so `/picker` is the one destination the root
    // beforeLoad will hold — landing anywhere else bounces straight back here anyway.
    expect(navigateMock).toHaveBeenCalledTimes(1);
    expect(navigateMock.mock.calls[0]).toEqual([{ to: "/picker" }]);

    // Ordering, not merely both-happened: a navigation that rendered before the sweep would paint
    // the signed-out account's cached rows on the way out.
    expect(clearSpy.mock.invocationCallOrder[0]).toBeLessThan(
      navigateMock.mock.invocationCallOrder[0],
    );
  });

  it("neither sweeps nor navigates when sign-out itself fails", async () => {
    // Given a keyring that refuses to clear
    invokeMock.mockRejectedValue({
      type: "auth",
      message: "Your session could not be cleared.",
      recoverable: true,
    });
    queryClient.setQueryData(queryKeys.profile, { email: "a@b.c" });

    await act(async () => {
      await signOut.mutateAsync().catch(() => undefined);
    });

    // Then the user stays signed in, in place: a swept cache plus a live session would read as
    // signed out while the account is still stored.
    expect(clearSpy).not.toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(queryKeys.profile)).toEqual({ email: "a@b.c" });
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

  // Row 10 of Story 30.2's degradation matrix. TanStack Query removes by key PREFIX, and
  // ["tfsa-accumulated-limit"] shares no prefix with ["profile"], so the Story 28.2 removal does not
  // reach it. A dev reasoning "the profile cache is cleared, so the derived figure is too" ships the
  // previous account's dollar amount — a wrong number and a privacy leak at once. Sign-out now sweeps
  // wholesale, so the surviving prefix hazard is the *sign-in* path, which still removes key by key.
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
      await signIn.mutateAsync({ intent: { kind: "Login" }, entry: "SignIn" });
      await signOut.mutateAsync();
    });

    // handle_auth_callback is reachable only through the Rust deep-link seam, which is
    // what enforces the state CSRF check and the pending-attempt lookup.
    expect(
      invokeMock.mock.calls.every((call) => call[0] !== "handle_auth_callback"),
    ).toBe(true);
  });
});

/**
 * Drives the mutation options directly, with no component. The sweep is the contract here, not
 * markup — and the picker unmounts on navigation, so an E2E test cannot observe it at all.
 */
function runContinuation(queryClient: QueryClient) {
  return new MutationObserver(
    queryClient,
    continueCloudSessionMutationOptions(queryClient),
  ).mutate();
}

/** A client holding entries that demonstrably belong to whichever profile was open before. */
function seedPreviousProfile(queryClient: QueryClient) {
  queryClient.setQueryData(queryKeys.profile, { cognito_sub: "previous" });
  queryClient.setQueryData(queryKeys.cloudAiPremium, true);
}

/**
 * The state the picker is in when it offers Continue: a resolved, signed-in session sitting in the
 * shared cache, which is what the CTA's identity claim is derived from.
 */
function seedSignedInSession(queryClient: QueryClient) {
  queryClient.setQueryData(queryKeys.auth.session, {
    status: "LoggedIn",
    email: "user@example.com",
    name: null,
  });
}

/**
 * `AppError::Auth` exactly as `error.rs` serialises it — lowercase tag, which is what
 * `parseAppError` matches on. Rust answers this shape when the stored session stopped being usable
 * between the picker's render and the click: expired past refresh, revoked, or belonging to a
 * different account than the profile it resolved.
 */
const CONTINUE_SESSION_INVALID = {
  type: "auth",
  message: "Your Nixus Cloud session is no longer valid. Please sign in again.",
  recoverable: true,
} as const;

/**
 * A local activation failure: the session was fine and the profile could not be opened. Deliberately
 * a different `type` from the one above rather than a different message — the branch is on the typed
 * envelope, so a fixture that varied only the prose would exercise the same path twice.
 */
const CONTINUE_ACTIVATION_FAILED = {
  type: "database",
  message: "the active dataset could not be opened",
} as const;

describe("continueCloudSessionMutationOptions", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
    localStorageMock.clear();
  });

  it("continues through one zero-argument command and never starts a browser sign-in", async () => {
    // Given a stored session Rust has already judged usable
    // When the picker's Continue is activated
    await runContinuation(
      new QueryClient({ defaultOptions: { mutations: { retry: false } } }),
    );

    // Then the subject, the email and the dataset id are all resolved Rust-side: nothing about the
    // account crosses IPC, and no OAuth round-trip is started
    expect(invokeMock.mock.calls).toEqual([["continue_cloud_session"]]);
  });

  it("drops every cached entry and stored draft once the activation succeeds", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    seedPreviousProfile(queryClient);
    localStorage.setItem(IMPORT_DRAFT_STORAGE_KEY, "{}");

    await runContinuation(queryClient);

    // The whole cache, not a hand-listed subset: the profile that was open belongs to a different
    // account than the one being continued as, and a key nobody remembered to list is exactly how
    // its rows stay on screen under the new identity.
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(queryClient.getQueryData(queryKeys.cloudAiPremium)).toBeUndefined();
    // The canonical sweep, not a bare `queryClient.clear()`: the draft belongs to the profile too,
    // and only `clearProfileScopedState` reaches it.
    expect(localStorage.getItem(IMPORT_DRAFT_STORAGE_KEY)).toBeNull();
  });

  it("leaves the previous profile's cache intact when the activation fails", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    seedPreviousProfile(queryClient);
    invokeMock.mockRejectedValueOnce(CONTINUE_ACTIVATION_FAILED);

    // The exact rejected value, not merely "something threw": an unrelated TypeError from a
    // refactored mutationFn would otherwise satisfy this test while breaking the caller's toast.
    await expect(runContinuation(queryClient)).rejects.toEqual(
      CONTINUE_ACTIVATION_FAILED,
    );

    // Nothing was opened, so the user is still in the profile they were in — sweeping here would
    // blank a surface that never changed.
    expect(queryClient.getQueryData(queryKeys.profile)).toEqual({
      cognito_sub: "previous",
    });
  });

  it("drops the cached session when the continuation fails because the session is no longer valid", async () => {
    // Given a picker that resolved a signed-in session and is offering Continue
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    seedSignedInSession(queryClient);

    // When the session turns out to have expired or been revoked since that render
    invokeMock.mockRejectedValueOnce(CONTINUE_SESSION_INVALID);
    await expect(runContinuation(queryClient)).rejects.toEqual(
      CONTINUE_SESSION_INVALID,
    );

    // Then the stale identity is gone, which is what lets the CTA stop offering an account that
    // cannot be continued as. Keeping it would leave the one filled primary on the launch screen
    // permanently pointed at an action Rust has just refused.
    expect(queryClient.getQueryData(queryKeys.auth.session)).toBeUndefined();
  });

  it("keeps the cached session when the continuation fails locally, so Continue stays retryable", async () => {
    // Given the same picker offering Continue
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    seedSignedInSession(queryClient);

    // When the profile itself could not be opened — the session was never in question
    invokeMock.mockRejectedValueOnce(CONTINUE_ACTIVATION_FAILED);
    await expect(runContinuation(queryClient)).rejects.toEqual(
      CONTINUE_ACTIVATION_FAILED,
    );

    // Then the identity survives, so the spec's failed-activation row holds: the user stays on the
    // picker with Continue still offering the same action rather than being demoted to a browser
    // sign-in they do not need.
    expect(queryClient.getQueryData(queryKeys.auth.session)).toEqual({
      status: "LoggedIn",
      email: "user@example.com",
      name: null,
    });
  });
});
