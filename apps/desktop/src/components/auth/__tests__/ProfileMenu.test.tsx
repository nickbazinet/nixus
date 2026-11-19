import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProfileMenu } from "@/components/auth/ProfileMenu";
import { queryKeys } from "@/lib/constants";
import en from "@/locales/en.json";
import type { ActiveProfile } from "@/hooks/useDatasets";
import type { AuthState } from "@/lib/types";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const invokeMock = vi.fn();
const toastError = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: async () => () => {},
}));

vi.mock("sonner", () => ({
  toast: { error: (...args: unknown[]) => toastError(...args) },
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...props }: Record<string, unknown> & { children?: React.ReactNode }) => (
    <a {...props}>{children}</a>
  ),
  useNavigate: () => async () => {},
}));

const EN = en as Record<string, string>;

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => {
      const template = EN[key] ?? key;
      if (vars === undefined) return template;
      return Object.entries(vars).reduce(
        (acc, [name, value]) => acc.split(`{{${name}}}`).join(String(value)),
        template
      );
    },
    i18n: { language: "en" },
  }),
}));

// Base UI's menu renders through a portal and only on open, which would make every assertion
// here a test of the popover rather than of the gate. The primitives are flattened to plain
// elements so the item set is readable in the container; the shared billing and account
// CONTRACTS are kept real, because those are what the gate is asserted against.
vi.mock("@nixus/shared", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();

  const passthrough =
    (tag: "div" | "p" | "span") =>
    ({
      children,
      open: _open,
      onOpenChange: _onOpenChange,
      align: _align,
      variant: _variant,
      ...props
    }: Record<string, unknown> & { children?: React.ReactNode }) => {
      const Tag = tag;
      return <Tag {...props}>{children}</Tag>;
    };

  const item = ({
    children,
    render,
    closeOnClick: _closeOnClick,
    ...props
  }: Record<string, unknown> & { children?: React.ReactNode; render?: unknown }) => {
    const anchorProps =
      render !== undefined && typeof render === "object" && render !== null
        ? ((render as { props?: Record<string, unknown> }).props ?? {})
        : {};
    return (
      <button type="button" {...anchorProps} {...props}>
        {children}
      </button>
    );
  };

  return {
    ...actual,
    cn: (...parts: unknown[]) => parts.filter(Boolean).join(" "),
    Badge: passthrough("span"),
    DropdownMenu: passthrough("div"),
    DropdownMenuContent: passthrough("div"),
    DropdownMenuGroup: passthrough("div"),
    DropdownMenuItem: item,
    DropdownMenuLabel: passthrough("p"),
    DropdownMenuSeparator: passthrough("div"),
    DropdownMenuTrigger: ({
      children,
      render: _render,
      ...props
    }: Record<string, unknown> & { children?: React.ReactNode }) => (
      <button type="button" {...props}>
        {children}
      </button>
    ),
    Button: ({
      children,
      render: _render,
      variant: _variant,
      size: _size,
      ...props
    }: Record<string, unknown> & { children?: React.ReactNode }) => (
      <button type="button" {...props}>
        {children}
      </button>
    ),
  };
});

const MANAGE = "profile-menu-manage-plan";

function cloudProfile(isSignedIn: boolean): ActiveProfile {
  return {
    dataset_id: "cloud-1",
    kind: "cloud-linked",
    label: "user@example.com",
    is_signed_in: isSignedIn,
  };
}

function localProfile(): ActiveProfile {
  return {
    dataset_id: "default",
    kind: "local",
    label: "My profile",
    is_signed_in: false,
  };
}

const loggedIn: AuthState = {
  status: "LoggedIn",
  email: "user@example.com",
  name: "Ada Lovelace",
} as AuthState;

describe("ProfileMenu plan management", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  const mount = () => {
    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ProfileMenu />
        </QueryClientProvider>
      );
    });
  };

  const tick = async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };

  const settle = async () => {
    const deadline = Date.now() + 2_000;
    do {
      await tick();
    } while (
      (queryClient.isFetching() > 0 || queryClient.isMutating() > 0) &&
      Date.now() < deadline
    );
    await tick();
  };

  const at = (testId: string) =>
    container.querySelector<HTMLElement>(`[data-testid="${testId}"]`);

  const portalCalls = () =>
    invokeMock.mock.calls.filter((call) => call[0] === "open_billing_portal");

  /** Seeds the three existing shared caches this menu derives everything from. */
  const seed = ({
    profile,
    session,
    entitled,
  }: {
    profile: ActiveProfile;
    session?: AuthState;
    entitled?: boolean;
  }) => {
    queryClient.setQueryData(queryKeys.activeProfile, profile);
    if (session !== undefined) {
      queryClient.setQueryData(queryKeys.auth.session, session);
    }
    if (entitled !== undefined) {
      queryClient.setQueryData(queryKeys.cloudAiPremium, entitled);
    }
  };

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    invokeMock.mockReset();
    toastError.mockReset();
    invokeMock.mockResolvedValue(null);
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Infinity },
        mutations: { retry: false },
      },
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    act(() => {
      root = createRoot(container);
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    queryClient.clear();
  });

  it("offers plan management to an account whose entitlement grants a capability", async () => {
    seed({ profile: cloudProfile(true), session: loggedIn, entitled: true });
    mount();
    await settle();

    expect(at(MANAGE)?.textContent).toBe(EN["billing.managePlan"]);
  });

  /* The gate is the capability answer, never a tier: an account that holds nothing has no plan
   * to manage and the Portal would refuse it, so offering the row would be a dead end. */
  it("offers nothing to manage to an account with no granted capability", async () => {
    seed({ profile: cloudProfile(true), session: loggedIn, entitled: false });
    mount();
    await settle();

    expect(at(MANAGE)).toBeNull();
  });

  it("offers nothing to manage while the entitlement is still unresolved", async () => {
    seed({ profile: cloudProfile(true), session: loggedIn });
    mount();
    await settle();

    expect(at(MANAGE)).toBeNull();
  });

  it("offers nothing to manage on a signed-out cloud profile or a local one", async () => {
    seed({ profile: cloudProfile(false), entitled: true });
    mount();
    await settle();
    expect(at(MANAGE)).toBeNull();

    queryClient.clear();
    seed({ profile: localProfile(), entitled: true });
    mount();
    await settle();
    expect(at(MANAGE)).toBeNull();
  });

  it("opens the Portal with no argument at all, and gets no URL back", async () => {
    seed({ profile: cloudProfile(true), session: loggedIn, entitled: true });
    mount();
    await settle();

    await act(async () => {
      container.querySelector<HTMLButtonElement>(`[data-testid="${MANAGE}"]`)?.click();
    });
    await settle();

    expect(portalCalls()).toEqual([["open_billing_portal"]]);
  });

  /* Opening a browser is slow enough to invite a second click; two clicks would mint two Portal
   * sessions. */
  it("shows a pending state and refuses to fire twice", async () => {
    let release: (() => void) | null = null;
    invokeMock.mockImplementation(async (command: string) => {
      if (command !== "open_billing_portal") return null;
      return new Promise<void>((resolve) => {
        release = () => resolve();
      });
    });

    seed({ profile: cloudProfile(true), session: loggedIn, entitled: true });
    mount();
    await settle();

    await act(async () => {
      container.querySelector<HTMLButtonElement>(`[data-testid="${MANAGE}"]`)?.click();
    });
    await tick();

    expect(at(MANAGE)?.getAttribute("data-pending")).toBe("true");
    expect(at(MANAGE)?.textContent).toBe(EN["billing.opening"]);

    await act(async () => {
      container.querySelector<HTMLButtonElement>(`[data-testid="${MANAGE}"]`)?.click();
      container.querySelector<HTMLButtonElement>(`[data-testid="${MANAGE}"]`)?.click();
    });
    await tick();

    expect(portalCalls()).toHaveLength(1);

    await act(async () => {
      release?.();
    });
    await settle();
  });

  /* A build below the server's floor is repaired by installing a newer Nixus. It must be
   * reported, and it must NOT be routed into the sign-in recovery (AD-12). */
  it("reports a forced upgrade without touching the session", async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command !== "open_billing_portal") return null;
      throw {
        type: "billing",
        code: "client_too_old",
        message: "too old",
        recoverable: false,
      };
    });

    seed({ profile: cloudProfile(true), session: loggedIn, entitled: true });
    mount();
    await settle();

    await act(async () => {
      container.querySelector<HTMLButtonElement>(`[data-testid="${MANAGE}"]`)?.click();
    });
    await settle();

    expect(toastError).toHaveBeenCalledWith(EN["billing.errorClientTooOld"]);
    expect(queryClient.getQueryData(queryKeys.auth.session)).toEqual(loggedIn);
  });

  /* A sign-in refusal goes back to the account layer rather than to a toast: the cached identity
   * is what is wrong, so it is dropped and the menu re-derives into the sign-in offer. */
  it("routes a sign-in refusal into the auth recovery instead of an error toast", async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command !== "open_billing_portal") return null;
      throw {
        type: "billing",
        code: "reauthentication_required",
        message: "sign in again",
        recoverable: true,
      };
    });

    seed({ profile: cloudProfile(true), session: loggedIn, entitled: true });
    mount();
    await settle();

    await act(async () => {
      container.querySelector<HTMLButtonElement>(`[data-testid="${MANAGE}"]`)?.click();
    });
    await settle();

    expect(toastError).not.toHaveBeenCalledWith(
      EN["billing.errorReauthenticationRequired"]
    );
    expect(queryClient.getQueryData(queryKeys.auth.session)).not.toEqual(loggedIn);
  });

  /* The whole header is mounted on every screen, so a billing command reached on load would put
   * every existing E2E spec's Tauri mock one command short (D11). */
  it("reaches no billing command on load", async () => {
    seed({ profile: cloudProfile(true), session: loggedIn, entitled: true });
    mount();
    await settle();

    expect(portalCalls()).toHaveLength(0);
    expect(
      invokeMock.mock.calls.filter((call) => String(call[0]).startsWith("open_billing"))
    ).toHaveLength(0);
  });
});
