/**
 * Download-state context (Story 2.5).
 *
 * Multiple `<DownloadCTA />` instances may render on the same page (sticky
 * header, hero, mid-page section). When *any* of them is clicked we want
 * the same `<InstallInstructions />` section to reveal — that requires a
 * shared piece of state that lives above all CTA call sites. React context
 * is the obvious fit: providers wrap the whole route tree (see
 * `__root.tsx`), and any descendant can read or mutate the state.
 *
 * Two consumer hooks intentionally:
 *
 *   - `useDownloadState()` throws if the provider is missing. The standard
 *     ergonomic — the consumer asserts "I expect to be inside the provider"
 *     and the type system gives us a non-null result.
 *   - `useOptionalDownloadState()` returns `null` when the provider is
 *     missing. `<DownloadCTA />` uses this so it remains usable in tests
 *     and ad-hoc render contexts (e.g., a Storybook story) that don't
 *     bother wiring the provider — the click handler simply skips the
 *     state mutation when there's nothing to mutate.
 *
 * The state itself is deliberately small: a single boolean ("has anyone
 * clicked Download yet?") plus the OS that was clicked (drives the default
 * tab in `<InstallInstructions />`). We don't track *when* the click
 * happened or *which* CTA fired it — those concerns belong to analytics,
 * not to UI state.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type { OS } from "./os.types";

export type DownloadState = {
  /** `true` once any DownloadCTA's macOS/Windows anchor has been clicked. */
  hasClicked: boolean;
  /**
   * The OS that was clicked. `null` until the first click. Drives the
   * default-selected tab in `<InstallInstructions />`.
   *
   * Narrowed to the buckets the install instructions actually cover:
   * `macos | windows`. Mobile, Linux, and unknown CTAs never call
   * `setClicked` (mobile has no real download anchor; the choose-platform
   * variant routes through `setClicked('macos' | 'windows')`).
   */
  clickedOS: OS | null;
  /**
   * Mark the download as clicked. Idempotent — calling it again with a
   * different OS updates `clickedOS` (e.g., the visitor came back and
   * clicked the *other* OS button to download for someone else).
   */
  setClicked: (os: OS) => void;
};

const DownloadStateContext = createContext<DownloadState | null>(null);

/**
 * Wrap the route tree (or any subtree that needs to share download state)
 * with this provider. The whole app is the natural scope — both header and
 * in-page CTAs participate.
 */
export function DownloadStateProvider({ children }: { children: ReactNode }) {
  const [hasClicked, setHasClicked] = useState(false);
  const [clickedOS, setClickedOS] = useState<OS | null>(null);

  // Memoize the setter so its identity is stable across renders — important
  // because consumers (e.g., the InstallInstructions effect) depend on it
  // and we don't want them re-running on every parent render.
  const setClicked = useCallback((os: OS) => {
    setHasClicked(true);
    setClickedOS(os);
  }, []);

  // Memoize the value object so context consumers don't re-render unless
  // one of the actual fields changed. Without this, every parent render
  // would create a fresh object identity and stampede every consumer.
  const value = useMemo<DownloadState>(
    () => ({ hasClicked, clickedOS, setClicked }),
    [hasClicked, clickedOS, setClicked],
  );

  return (
    <DownloadStateContext.Provider value={value}>
      {children}
    </DownloadStateContext.Provider>
  );
}

/**
 * Read the download state. Throws if used outside the provider — the
 * common case and the one we want to assert against.
 */
export function useDownloadState(): DownloadState {
  const ctx = useContext(DownloadStateContext);
  if (!ctx) {
    throw new Error(
      "useDownloadState must be used within a <DownloadStateProvider>",
    );
  }
  return ctx;
}

/**
 * Read the download state, or `null` when no provider is present. Used by
 * `<DownloadCTA />` so the component remains drop-in usable in tests and
 * miscellaneous render contexts that don't wrap with the provider.
 */
export function useOptionalDownloadState(): DownloadState | null {
  return useContext(DownloadStateContext);
}
