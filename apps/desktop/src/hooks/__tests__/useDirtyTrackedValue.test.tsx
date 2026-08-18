import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useDirtyTrackedValue } from "@/hooks/useDirtyTrackedValue";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

// The hook result has to escape the tree: this suite drives it directly instead of clicking a
// UI, and @testing-library/react is not a dependency of @nixus/desktop (see useAuth.test.tsx /
// useProjects.test.tsx for the same pattern).
let result: ReturnType<typeof useDirtyTrackedValue<number>>;

function Harness({ derivedValue }: { derivedValue: number }) {
  result = useDirtyTrackedValue(derivedValue);
  return null;
}

describe("useDirtyTrackedValue", () => {
  let container: HTMLDivElement;
  let root: Root;

  function render(node: ReactNode) {
    act(() => {
      root.render(node);
    });
  }

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("tracks the derived value while untouched", () => {
    // Given the derived value settles from its initial 0 to a real figure
    render(<Harness derivedValue={0} />);
    expect(result.value).toBe(0);
    expect(result.dirty).toBe(false);

    render(<Harness derivedValue={500} />);

    // Then the tracked value follows it, because nothing has been set yet
    expect(result.value).toBe(500);
    expect(result.dirty).toBe(false);
  });

  // The I/O matrix's "Re-settle mid-explore" row: once the user has set their own value, a new
  // derived value arriving later (e.g. a query re-settling) must not yank it out from under them.
  it("does not overwrite the current value when the derived input changes while dirty", () => {
    render(<Harness derivedValue={500} />);

    // When the user drags to their own value
    act(() => {
      result.setValue(900);
    });
    expect(result.value).toBe(900);
    expect(result.dirty).toBe(true);

    // And the derived value re-settles to something else mid-exploration
    render(<Harness derivedValue={700} />);

    // Then the user's chosen value is left alone
    expect(result.value).toBe(900);
    expect(result.dirty).toBe(true);
  });

  it("restores the derived value and clears dirty on reset", () => {
    render(<Harness derivedValue={500} />);

    act(() => {
      result.setValue(900);
    });
    expect(result.dirty).toBe(true);

    act(() => {
      result.reset();
    });

    expect(result.value).toBe(500);
    expect(result.dirty).toBe(false);

    // And re-syncing resumes: a later derived change is once again tracked
    render(<Harness derivedValue={650} />);
    expect(result.value).toBe(650);
  });
});
