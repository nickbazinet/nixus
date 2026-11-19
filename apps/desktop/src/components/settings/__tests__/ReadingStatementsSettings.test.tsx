import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReadingStatementsSettings } from "@/components/settings/ReadingStatementsSettings";
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

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: async () => () => {},
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
    t: (key: string) => EN[key] ?? key,
    i18n: { language: "en" },
  }),
}));

// The key form is a whole surface of its own with its own IPC, and none of it is under test
// here: this suite is about which of the two notices the capability gate renders.
vi.mock("@/components/settings/CredentialsForm", () => ({
  CredentialsForm: () => <div data-testid="credentials-form" />,
}));

// The UI primitives are flattened so the notices are readable in the container, while the
// `@nixus/shared` billing CONTRACT stays real — the capability union is what the gate is
// asserted against, so stubbing it would make this suite agree with itself.
vi.mock("@nixus/shared", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();

  const passthrough =
    (tag: "div" | "p") =>
    ({
      children,
      variant: _variant,
      flush: _flush,
      ...props
    }: Record<string, unknown> & { children?: React.ReactNode }) => {
      const Tag = tag;
      return <Tag {...props}>{children}</Tag>;
    };

  return {
    ...actual,
    cn: (...parts: unknown[]) => parts.filter(Boolean).join(" "),
    Alert: passthrough("div"),
    AlertTitle: passthrough("p"),
    AlertDescription: passthrough("p"),
    Card: passthrough("div"),
    Button: ({
      children,
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

const UPGRADE = "settings-reading-upgrade";
const PREMIUM_BANNER = "settings-reading-premium-banner";

const CLASSIC: BillingCapability[] = ["household_net_worth", "multi_device_sync"];
const ADVANCE: BillingCapability[] = [
  "hosted_ai",
  "household_net_worth",
  "multi_device_sync",
];

const loggedIn = {
  status: "LoggedIn",
  email: "user@example.com",
  name: "Ada Lovelace",
} as AuthState;

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

describe("ReadingStatementsSettings upgrade invite", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  const mount = () => {
    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ReadingStatementsSettings />
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
    } while (queryClient.isFetching() > 0 && Date.now() < deadline);
    await tick();
  };

  const at = (testId: string) =>
    container.querySelector<HTMLElement>(`[data-testid="${testId}"]`);

  /**
   * `entitled` is the hosted-AI boolean the "included with your plan" banner still reads.
   * `capabilities` is the capability answer the upgrade invite reads. Omitting `capabilities`
   * leaves the answer UNESTABLISHED, which is what a flaky connection produces.
   */
  const seed = ({
    profile,
    session,
    entitled,
    capabilities,
  }: {
    profile: ActiveProfile;
    session?: AuthState;
    entitled?: boolean;
    capabilities?: BillingCapability[];
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
        tier: null,
        capabilities,
      } satisfies BillingEntitlement);
    }
  };

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    invokeMock.mockReset();
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

  /* The one state an upgrade repairs: an ESTABLISHED answer that does not include `hosted_ai`. */
  it("invites a verified free account to upgrade", async () => {
    seed({
      profile: cloudProfile(true),
      session: loggedIn,
      entitled: false,
      capabilities: [],
    });
    mount();
    await settle();

    expect(at(UPGRADE)).not.toBeNull();
    expect(at(PREMIUM_BANNER)).toBeNull();
  });

  /* A Classic subscriber genuinely lacks hosted reading, so the invite is correct for them — and
   * it has to be the capability that decides, because their tier is a paid one. */
  it("invites a Classic subscriber, who holds a plan but not hosted AI", async () => {
    seed({
      profile: cloudProfile(true),
      session: loggedIn,
      entitled: false,
      capabilities: CLASSIC,
    });
    mount();
    await settle();

    expect(at(UPGRADE)).not.toBeNull();
  });

  it("invites nobody who already holds hosted AI", async () => {
    seed({
      profile: cloudProfile(true),
      session: loggedIn,
      entitled: true,
      capabilities: ADVANCE,
    });
    mount();
    await settle();

    expect(at(UPGRADE)).toBeNull();
    expect(at(PREMIUM_BANNER)).not.toBeNull();
  });

  /* THE invariant. An entitlement that could not be established is not "not entitled": it is "we
   * do not know", and an upgrade cannot repair a bad connection. Offering to sell hosted reading
   * here sells it to a user who may already own it (AD-9).
   *
   * Both halves are asserted, because a notice in either direction is a claim this state has no
   * standing to make. */
  it("claims nothing at all while the entitlement is unestablished", async () => {
    seed({ profile: cloudProfile(true), session: loggedIn });
    mount();
    await settle();

    expect(at(UPGRADE)).toBeNull();
    expect(at(PREMIUM_BANNER)).toBeNull();
    expect(container.textContent).not.toContain(EN["settings.readingUpgradeTitle"]);
    expect(container.textContent).not.toContain(EN["settings.readingPremiumTitle"]);
  });

  /* The same non-answer, reached the way a user actually reaches it: the command rejects. Rust is
   * fail-closed and answers `established: false` rather than erroring, but a local IPC fault must
   * land in exactly the same silent state rather than in an upsell. */
  it("claims nothing when the capability read is rejected outright", async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "get_billing_entitlement") throw new Error("ipc failure");
      return null;
    });

    seed({ profile: cloudProfile(true), session: loggedIn });
    mount();
    await settle();

    expect(at(UPGRADE)).toBeNull();
    expect(at(PREMIUM_BANNER)).toBeNull();
  });

  /* No account means no plan to attach one to, so the first step is a sign-in rather than a
   * purchase — and a local profile must not reach the command at all (NFR7). */
  it("invites nobody on a signed-out cloud profile or a local one", async () => {
    seed({ profile: cloudProfile(false), capabilities: [] });
    mount();
    await settle();
    expect(at(UPGRADE)).toBeNull();

    act(() => root.unmount());
    queryClient.clear();
    act(() => {
      root = createRoot(container);
    });

    seed({ profile: localProfile(), capabilities: [] });
    mount();
    await settle();

    expect(at(UPGRADE)).toBeNull();
    expect(
      invokeMock.mock.calls.filter((call) => call[0] === "get_billing_entitlement")
    ).toHaveLength(0);
  });
});
