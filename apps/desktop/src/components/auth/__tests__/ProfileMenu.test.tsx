import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProfileMenu } from "@/components/auth/ProfileMenu";
import { queryKeys } from "@/lib/constants";
import en from "@/locales/en.json";
import type { BillingCapability } from "@nixus/shared";
import type { BillingEntitlement } from "@/lib/billing";
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

  /**
   * Seeds the shared caches this menu derives everything from.
   *
   * `entitled` is the HOSTED-AI boolean, which still drives the gold icon and the Premium badge.
   * `capabilities` is the capability answer, which is what plan management is gated on — a
   * different question, and the reason both are settable independently here. Omitting
   * `capabilities` leaves the answer UNESTABLISHED, which is the state a flaky connection
   * produces and the one no surface may act on.
   */
  const seed = ({
    profile,
    session,
    entitled,
    capabilities,
    tier,
  }: {
    profile: ActiveProfile;
    session?: AuthState;
    entitled?: boolean;
    capabilities?: BillingCapability[];
    tier?: string;
  }) => {
    queryClient.setQueryData(queryKeys.activeProfile, profile);
    if (session !== undefined) {
      queryClient.setQueryData(queryKeys.auth.session, session);
    }
    if (entitled !== undefined) {
      queryClient.setQueryData(queryKeys.cloudAiPremium, entitled);
    }
    if (capabilities !== undefined) {
      queryClient.setQueryData(queryKeys.billingEntitlement, {
        established: true,
        tier: tier ?? null,
        capabilities,
      } satisfies BillingEntitlement);
    }
  };

  const CLASSIC: BillingCapability[] = ["household_net_worth", "multi_device_sync"];
  const ADVANCE: BillingCapability[] = [
    "hosted_ai",
    "household_net_worth",
    "multi_device_sync",
  ];

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
    seed({
      profile: cloudProfile(true),
      session: loggedIn,
      entitled: true,
      capabilities: ADVANCE,
      tier: "advance",
    });
    mount();
    await settle();

    expect(at(MANAGE)?.textContent).toBe(EN["billing.managePlan"]);
  });

  /* The regression this gate change exists for. Classic grants `multi_device_sync` and
   * `household_net_worth` and never `hosted_ai`, so the hosted-AI boolean reported this paying
   * subscriber as entitled to nothing and removed their only route to cancelling. */
  it("offers plan management to a Classic subscriber who holds no hosted AI", async () => {
    seed({
      profile: cloudProfile(true),
      session: loggedIn,
      entitled: false,
      capabilities: CLASSIC,
      tier: "classic",
    });
    mount();
    await settle();

    expect(at(MANAGE)?.textContent).toBe(EN["billing.managePlan"]);
  });

  /* The gate is the capability LIST, never a tier and never the hosted-AI boolean: a verified
   * account that holds nothing has no plan to manage and the Portal would refuse it, so offering
   * the row would be a dead end. */
  it("offers nothing to manage to a verified account with no granted capability", async () => {
    seed({
      profile: cloudProfile(true),
      session: loggedIn,
      entitled: false,
      capabilities: [],
      tier: "free",
    });
    mount();
    await settle();

    expect(at(MANAGE)).toBeNull();
  });

  /* An answer that was never established is not "no plan" — it is "we do not know", and a Portal
   * session cannot be minted against an unknown entitlement (AD-9). */
  it("offers nothing to manage while the entitlement is unestablished", async () => {
    seed({ profile: cloudProfile(true), session: loggedIn });
    mount();
    await settle();

    expect(at(MANAGE)).toBeNull();
  });

  /* The `established` half of the gate, made observable.
   *
   * Written against an INCONSISTENT payload — not an answer, yet carrying capabilities — because
   * a consistent unestablished answer always has an empty list, so "no row" is then true for two
   * different reasons and the test cannot tell which one held. Rust makes this payload
   * unconstructible (`SurfaceEntitlement::new` drops the label and the view flattens the list),
   * so this asserts the frontend does not become the layer that trusts it if that ever changes. */
  it("offers nothing to manage when an answer that was never established claims capabilities", async () => {
    queryClient.setQueryData(queryKeys.activeProfile, cloudProfile(true));
    queryClient.setQueryData(queryKeys.auth.session, loggedIn);
    queryClient.setQueryData(queryKeys.billingEntitlement, {
      established: false,
      tier: "advance",
      capabilities: ADVANCE,
    } satisfies BillingEntitlement);
    mount();
    await settle();

    expect(at(MANAGE)).toBeNull();
  });

  /* The hosted-AI boolean must not be able to open this row on its own any more: it is a claim
   * about a different capability, and on a Classic account it is false while a plan exists. */
  it("never opens the row on the hosted-AI boolean alone", async () => {
    seed({ profile: cloudProfile(true), session: loggedIn, entitled: true });
    mount();
    await settle();

    expect(at(MANAGE)).toBeNull();
  });

  it("offers nothing to manage on a signed-out cloud profile or a local one", async () => {
    seed({ profile: cloudProfile(false), entitled: true, capabilities: ADVANCE });
    mount();
    await settle();
    expect(at(MANAGE)).toBeNull();

    queryClient.clear();
    seed({ profile: localProfile(), entitled: true, capabilities: ADVANCE });
    mount();
    await settle();
    expect(at(MANAGE)).toBeNull();
  });

  /* An opaque label may be carried and displayed; it may never be compared, and nothing in this
   * menu reads it. Pinned so a future edit cannot start printing the raw code. */
  it("renders the opaque tier code nowhere", async () => {
    seed({
      profile: cloudProfile(true),
      session: loggedIn,
      entitled: false,
      capabilities: CLASSIC,
      tier: "classic",
    });
    mount();
    await settle();

    expect(at(MANAGE)).not.toBeNull();
    expect(container.textContent).not.toContain("classic");
  });

  it("opens the Portal with no argument at all, and gets no URL back", async () => {
    seed({
      profile: cloudProfile(true),
      session: loggedIn,
      entitled: true,
      capabilities: ADVANCE,
    });
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

    seed({
      profile: cloudProfile(true),
      session: loggedIn,
      entitled: true,
      capabilities: ADVANCE,
    });
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

    seed({
      profile: cloudProfile(true),
      session: loggedIn,
      entitled: true,
      capabilities: ADVANCE,
    });
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

    seed({
      profile: cloudProfile(true),
      session: loggedIn,
      entitled: true,
      capabilities: ADVANCE,
    });
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

  /* The header is mounted on every screen, so no COMMERCE command may be reached on load: one
   * would open a browser or mint a Stripe session during a page paint.
   *
   * The capability READ is a different matter and is expected — it is the one new `invoke()` this
   * change adds to an always-mounted surface, which is why every Playwright spec's Tauri mock now
   * carries a `get_billing_entitlement` case (D11). Asserted positively here so that fact stays
   * visible rather than being rediscovered as 40 broken specs. */
  it("reaches no commerce command on load, and only the capability read", async () => {
    seed({
      profile: cloudProfile(true),
      session: loggedIn,
      entitled: true,
      capabilities: ADVANCE,
    });
    mount();
    await settle();

    expect(portalCalls()).toHaveLength(0);
    expect(
      invokeMock.mock.calls.filter((call) => String(call[0]).startsWith("open_billing"))
    ).toHaveLength(0);
  });

  /* A local profile is a purely local concept (NFR7) and this command resolves a call-time
   * Cognito token, so the gate must hold before any IPC is reached at all. */
  it("never reaches the capability read under a local profile", async () => {
    seed({ profile: localProfile() });
    mount();
    await settle();

    expect(
      invokeMock.mock.calls.filter((call) => call[0] === "get_billing_entitlement")
    ).toHaveLength(0);
  });
});
