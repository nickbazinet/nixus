/* eslint-disable no-console -- this module exists to intercept React's console
   diagnostics so tests can assert on them; `no-console` guards shipped code. */

/**
 * SSR-then-hydrate harness for jsdom, plus the console capture it needs.
 *
 * `@testing-library/react`'s `render` does a client-only mount, so it can never
 * observe a hydration mismatch — which is precisely the class of bug that ships
 * green and then breaks in a browser. This renders a component to SSR markup,
 * hydrates that exact markup, and collects every diagnostic React emits while
 * doing so.
 *
 * React reports attribute/markup mismatches through `console.error` and
 * recoverable render failures through `onRecoverableError`; both are captured
 * because either one alone misses real mismatches.
 */

import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import type { ReactElement } from "react";

function formatConsoleArgs(args: unknown[]): string {
  return args
    .map((arg) => (arg instanceof Error ? arg.message : String(arg)))
    .join(" ");
}

export type ConsoleCapture = {
  /** Every `console.error` seen since capture started. */
  readonly messages: string[];
  /** Restores the original `console.error`. Always call it in a `finally`. */
  restore: () => void;
};

/**
 * Start collecting `console.error` output.
 *
 * React de-duplicates each unknown-prop and mismatch warning per module realm,
 * so a test relying on this must be the first render of the offending component
 * in its file — otherwise the warning was already consumed and the assertion
 * passes while the bug is still there.
 */
export function captureConsoleErrors(): ConsoleCapture {
  const messages: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    messages.push(formatConsoleArgs(args));
  };
  return {
    messages,
    restore: () => {
      console.error = original;
    },
  };
}

export type HydrationResult = {
  /** The server-rendered HTML that was hydrated. */
  ssrHtml: string;
  /** Every `console.error` / `onRecoverableError` message React emitted. */
  diagnostics: string[];
};

/**
 * Render `ui` on the server, hydrate it, and report what React said about it.
 *
 * `wrapper` supplies the providers the component needs. It has to wrap BOTH the
 * server render and the hydration pass with the same tree, or the mismatch under
 * test would be the harness's own.
 */
export async function renderAndHydrate(
  ui: ReactElement,
  wrapper: (children: ReactElement) => ReactElement,
): Promise<HydrationResult> {
  const tree = wrapper(ui);
  const ssrHtml = renderToString(tree);

  const container = document.createElement("div");
  container.innerHTML = ssrHtml;
  document.body.appendChild(container);

  const capture = captureConsoleErrors();
  try {
    const root = await act(async () =>
      hydrateRoot(container, tree, {
        onRecoverableError: (error) => {
          capture.messages.push(
            error instanceof Error ? error.message : String(error),
          );
        },
      }),
    );
    await act(async () => root.unmount());
    return { ssrHtml, diagnostics: [...capture.messages] };
  } finally {
    capture.restore();
    container.remove();
  }
}

/** Diagnostics that indicate a server/client markup disagreement. */
export function hydrationMismatches(result: HydrationResult): string[] {
  return result.diagnostics.filter((message) =>
    /hydrat|did ?n[o']t match|server rendered/i.test(message),
  );
}

