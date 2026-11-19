import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HomeAccessNotice, homeAccessOffersUpgrade } from "@/components/home/HomeAccessNotice";
import { ADVANCE_PLAN_LOOKUP_KEY } from "@/lib/billing";
import en from "@/locales/en.json";
import type { HomeComposerAccess } from "@/lib/types";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...props }: Record<string, unknown> & { children?: React.ReactNode }) => (
    <a {...props}>{children}</a>
  ),
}));

const EN = en as Record<string, string>;

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => EN[key] ?? key,
    i18n: { language: "en" },
  }),
}));

// The UI primitives are stubbed, but `@nixus/shared` is also the home of the billing and
// account CONTRACTS that `appError.ts` narrows with, and those are the real thing under test —
// stubbing them would make this suite agree with itself rather than with the contract.
vi.mock("@nixus/shared", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();

  const passthrough =
    (tag: "div" | "p") =>
    ({
      children,
      icon: _icon,
      variant: _variant,
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

const UPGRADE = "home-locked-upgrade";

describe("HomeAccessNotice", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  const mount = (state: HomeComposerAccess) => {
    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <HomeAccessNotice state={state} onRetry={() => {}} />
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

  const click = async (testId: string) => {
    await act(async () => {
      container.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)?.click();
    });
    await settle();
  };

  const checkoutCalls = () =>
    invokeMock.mock.calls.filter((call) => call[0] === "open_billing_checkout");

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
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

  /* AD-12: the refusal copy promises an upgrade, so the upgrade has to be there to click. */
  it("offers the upgrade on a plan refusal and names the capability, not a tier", async () => {
    mount("not_premium");
    await settle();

    const action = at(UPGRADE);
    expect(action).not.toBeNull();
    expect(action?.textContent).toBe(EN["home.locked.upgradeAction"]);
    expect(action?.textContent?.toLowerCase()).not.toContain("premium");
    expect(action?.textContent?.toLowerCase()).not.toContain("advance");
    expect(action?.textContent?.toLowerCase()).not.toContain("classic");
  });

  /* The whole point of the "beside, not instead" placement: a user who would rather bring their
   * own key must still be told they can, in the same breath as the paid route. */
  it("keeps the bring-your-own-key advice alongside the upgrade", async () => {
    mount("not_premium");
    await settle();

    expect(container.textContent).toContain(EN["home.locked.setupAction"]);
    expect(container.textContent).toContain(EN["home.locked.premiumBody"]);
  });

  it("opens Checkout for the one lookup key the catalog carries, and returns no URL", async () => {
    mount("not_premium");
    await settle();
    await click(UPGRADE);

    expect(checkoutCalls()).toEqual([
      ["open_billing_checkout", { plan_lookup_key: ADVANCE_PLAN_LOOKUP_KEY }],
    ]);
    expect(ADVANCE_PLAN_LOOKUP_KEY).toBe("advance_monthly_cad");
  });

  /* Launching the system browser is slow enough to invite a second click, and two clicks would
   * open two Checkout sessions. */
  it("shows a pending state and refuses to fire twice", async () => {
    let release: (() => void) | null = null;
    invokeMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = () => resolve();
        })
    );

    mount("not_premium");
    await settle();

    await act(async () => {
      container.querySelector<HTMLButtonElement>(`[data-testid="${UPGRADE}"]`)?.click();
    });
    await tick();

    const action = at(UPGRADE);
    expect(action?.getAttribute("data-pending")).toBe("true");
    expect(action?.textContent).toBe(EN["billing.opening"]);
    expect((action as HTMLButtonElement | null)?.disabled).toBe(true);

    await act(async () => {
      container.querySelector<HTMLButtonElement>(`[data-testid="${UPGRADE}"]`)?.click();
      container.querySelector<HTMLButtonElement>(`[data-testid="${UPGRADE}"]`)?.click();
    });
    await tick();

    expect(checkoutCalls()).toHaveLength(1);

    await act(async () => {
      release?.();
    });
    await settle();
  });

  it("reports a refusal in the surface rather than silently doing nothing", async () => {
    invokeMock.mockRejectedValue({
      type: "billing",
      code: "client_too_old",
      message: "This version of Nixus is too old for Nixus Cloud plans.",
      recoverable: false,
    });

    mount("not_premium");
    await settle();
    await click(UPGRADE);

    expect(at(`${UPGRADE}-error`)?.textContent).toBe(EN["billing.errorClientTooOld"]);
  });

  /* A user with their own AI provider key already has the capability by another route, so they
   * must never be pushed to pay for it. The other four exclusions each have their own reason:
   * no account to attach a plan to, or an account that already holds the capability.
   *
   * The gate is asserted directly as well as through the render. Through the render alone this
   * would pass for the wrong reason: `available_byo` carries no locked-state entry, so it takes
   * the transient branch and renders no action whatever the gate says — which means widening
   * the gate to BYO would go unnoticed here and then ship the moment a BYO state grew a locked
   * entry. */
  it("offers no upgrade to a bring-your-own-key user, or to any state a purchase cannot fix", async () => {
    for (const state of [
      "available_byo",
      "available",
      "local_profile",
      "signed_out",
      "quota_exhausted",
      "reauthentication_required",
      "unavailable",
    ] satisfies HomeComposerAccess[]) {
      expect(homeAccessOffersUpgrade(state), state).toBe(false);

      mount(state);
      await settle();

      expect(at(UPGRADE), state).toBeNull();
      expect(checkoutCalls(), state).toHaveLength(0);
    }

    expect(homeAccessOffersUpgrade("not_premium")).toBe(true);
  });

  /* The notice is rendered on page load, so an upgrade that fired on mount would both charge a
   * decision to a render and put every E2E spec's Tauri mock one command short. */
  it("invokes nothing at all until the action is clicked", async () => {
    mount("not_premium");
    await settle();

    expect(invokeMock).not.toHaveBeenCalled();
  });
});
