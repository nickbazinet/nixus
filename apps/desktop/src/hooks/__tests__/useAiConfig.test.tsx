import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAiAvailability, type AiAvailability } from "@/hooks/useAiConfig";

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

// `usePremiumEntitlement` lives in the same module graph as sign-out, which reads the router. This
// suite drives hooks directly and mounts no route tree.
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

let availability: AiAvailability | undefined;

function Harness() {
  availability = useAiAvailability();
  return null;
}

/**
 * The four IPC reads the composition spans. `byoConfigured` is the BYO half; the other three are the
 * chain `usePremiumEntitlement` walks, and every one of them has to answer for the premium half to
 * resolve at all.
 */
interface MockState {
  byoConfigured: boolean;
  cloudLinkedAndSignedIn: boolean;
  loggedIn: boolean;
  premium: boolean;
  /** Holds `get_cloud_ai_premium` unresolved, which is the whole first-paint window. */
  holdPremium?: boolean;
}

function installIpc(state: MockState) {
  invokeMock.mockImplementation((command: string) => {
    switch (command) {
      case "get_ai_config":
        return Promise.resolve({
          provider: state.byoConfigured ? "bedrock" : null,
          configured: state.byoConfigured,
          region: "us-east-1",
        });
      case "get_active_profile":
        return Promise.resolve({
          dataset_id: "d1",
          kind: state.cloudLinkedAndSignedIn ? "cloud-linked" : "local",
          label: "Personal",
          is_signed_in: state.cloudLinkedAndSignedIn,
        });
      case "get_auth_session":
        return Promise.resolve(
          state.loggedIn
            ? { status: "LoggedIn", email: "a@b.c", name: null }
            : { status: "LoggedOut" },
        );
      case "get_cloud_ai_premium":
        return state.holdPremium === true
          ? new Promise(() => {})
          : Promise.resolve(state.premium);
      default:
        return Promise.reject(new Error(`Unknown command: ${command}`));
    }
  });
}

const PREMIUM_NO_BYO: MockState = {
  byoConfigured: false,
  cloudLinkedAndSignedIn: true,
  loggedIn: true,
  premium: true,
};

describe("useAiAvailability", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  function render(node: ReactNode) {
    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>,
      );
    });
  }

  // The composition spans three chained queries, so React's scheduler can defer the settling
  // re-render across several macrotask turns. Polling render-derived state is what the sibling
  // useAuth suite settled on for the same chain.
  async function settle(isSettled: () => boolean) {
    for (let attempt = 0; attempt < 30; attempt++) {
      if (isSettled()) return;
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
  }

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    invokeMock.mockReset();
    listenMock.mockReset();
    listenMock.mockImplementation(async () => vi.fn());
    availability = undefined;
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    queryClient.clear();
  });

  it("reports AI available for a premium account that configured no personal key", async () => {
    // Given a signed-in premium cloud account with no BYO credentials on the machine
    installIpc(PREMIUM_NO_BYO);

    // When a surface asks whether AI can serve it
    render(<Harness />);
    await settle(() => availability === "available");

    // Then it is available — the hosted-first backend needs no personal key
    expect(availability).toBe("available");
  });

  it("reports AI available for a non-premium account with BYO credentials", async () => {
    // Given BYO credentials configured and no premium entitlement at all
    installIpc({
      byoConfigured: true,
      cloudLinkedAndSignedIn: false,
      loggedIn: false,
      premium: false,
    });

    render(<Harness />);
    await settle(() => availability === "available");

    expect(availability).toBe("available");
  });

  it("reports AI unavailable with neither BYO credentials nor a premium entitlement", async () => {
    // Given a local profile and no configured provider
    installIpc({
      byoConfigured: false,
      cloudLinkedAndSignedIn: false,
      loggedIn: false,
      premium: false,
    });

    render(<Harness />);
    // Settling on the BYO read alone would pass while the premium half was still resolving, so this
    // waits for the whole chain to have DECIDED rather than merely to have been asked.
    await settle(() => availability === "unavailable");

    expect(availability).toBe("unavailable");
  });

  it("never claims availability from a premium answer belonging to a signed-out session", async () => {
    // Given a cloud-linked profile whose machine-wide session is not logged in
    installIpc({
      byoConfigured: false,
      cloudLinkedAndSignedIn: true,
      loggedIn: false,
      premium: true,
    });

    render(<Harness />);
    await settle(() => availability === "unavailable");

    // Then the entitlement is never read, so nothing can claim availability
    expect(availability).toBe("unavailable");
    expect(
      invokeMock.mock.calls.filter(([cmd]) => cmd === "get_cloud_ai_premium"),
    ).toHaveLength(0);
  });

  it("reports resolving, never unavailable, while a premium entitlement is still in flight", async () => {
    // Given a cloud-linked signed-in profile whose entitlement read has not answered yet, and no
    // BYO credentials to answer in its place
    installIpc({ ...PREMIUM_NO_BYO, holdPremium: true });

    // When the surface asks during that window
    render(<Harness />);
    // Settling on `resolving` alone would also pass while merely the PROFILE read was in flight, so
    // this waits until the entitlement read itself is the link that has not answered.
    await settle(
      () =>
        invokeMock.mock.calls.some(([cmd]) => cmd === "get_cloud_ai_premium") &&
        availability === "resolving",
    );

    // Then the answer is "not yet" — reporting "unavailable" here is what paints personal-key setup
    // UI at a premium user and lets a click be accepted and discarded
    expect(availability).toBe("resolving");
    expect(
      invokeMock.mock.calls.filter(([cmd]) => cmd === "get_cloud_ai_premium"),
    ).toHaveLength(1);
  });

  it("settles from resolving to available once the held entitlement answers", async () => {
    // Given the entitlement is still in flight
    let releasePremium: ((value: boolean) => void) | undefined;
    invokeMock.mockImplementation((command: string) => {
      switch (command) {
        case "get_ai_config":
          return Promise.resolve({
            provider: null,
            configured: false,
            region: "us-east-1",
          });
        case "get_active_profile":
          return Promise.resolve({
            dataset_id: "d1",
            kind: "cloud-linked",
            label: "Personal",
            is_signed_in: true,
          });
        case "get_auth_session":
          return Promise.resolve({
            status: "LoggedIn",
            email: "a@b.c",
            name: null,
          });
        case "get_cloud_ai_premium":
          return new Promise<boolean>((resolve) => {
            releasePremium = resolve;
          });
        default:
          return Promise.reject(new Error(`Unknown command: ${command}`));
      }
    });

    render(<Harness />);
    // `releasePremium` being set is what proves the chain actually reached the entitlement read;
    // releasing before then would resolve nothing and leave the query hung forever.
    await settle(
      () => releasePremium !== undefined && availability === "resolving",
    );
    expect(availability).toBe("resolving");

    // When it finally confirms premium
    await act(async () => {
      releasePremium?.(true);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await settle(() => availability === "available");

    // Then availability lands on available, unchanged from the already-resolved premium behavior
    expect(availability).toBe("available");
  });

  it("stays available throughout, never resolving, when BYO credentials already answer", async () => {
    // Given BYO credentials are configured and the entitlement read never answers at all
    installIpc({
      byoConfigured: true,
      cloudLinkedAndSignedIn: true,
      loggedIn: true,
      premium: false,
      holdPremium: true,
    });

    render(<Harness />);
    await settle(() => availability === "available");

    // Then a hung entitlement read cannot drag a working BYO surface into a pending state
    expect(availability).toBe("available");
  });
});
