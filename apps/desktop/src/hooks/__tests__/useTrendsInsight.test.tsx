import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTrendsInsight } from "@/hooks/useTrendsInsight";
import type { CategoryCompareRow } from "@/lib/types";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "en" } }),
}));

const POPULATED: CategoryCompareRow[] = [
  {
    category_id: 1,
    category_name: "Groceries",
    avg_cents: 50_000,
    target_cents: 40_000,
    delta_pct: 25,
    status: "over",
  },
];

function Harness({
  categoryCompare,
  gatePassed,
}: {
  categoryCompare: CategoryCompareRow[];
  gatePassed: boolean;
}) {
  useTrendsInsight({
    months: 6,
    windowLabel: "6 months",
    categoryCompare,
    aiConfigured: true,
    gatePassed,
  });
  return null;
}

describe("useTrendsInsight", () => {
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

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    invokeMock.mockReset();
    invokeMock.mockResolvedValue({
      headline: "ok",
      body: "ok",
      tone: "calm",
      window_label: "6 months",
    });
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
    vi.useRealTimers();
  });

  it("never requests an insight before the debounced categories catch up", () => {
    // Given the page mounts while spending trends are still loading
    render(<Harness categoryCompare={[]} gatePassed={false} />);

    // When the trends data lands and the live gate opens
    render(<Harness categoryCompare={POPULATED} gatePassed={true} />);

    // Then no request fires yet, because the debounced payload is still empty
    expect(invokeMock).not.toHaveBeenCalled();

    // When the debounce settles
    act(() => {
      vi.advanceTimersByTime(500);
    });

    // Then exactly one request fires, carrying the populated categories
    expect(invokeMock).toHaveBeenCalledTimes(1);
    const [command, payload] = invokeMock.mock.calls[0] as [
      string,
      { categories: CategoryCompareRow[] },
    ];
    expect(command).toBe("generate_trends_insight");
    expect(payload.categories).toEqual(POPULATED);
  });
});
