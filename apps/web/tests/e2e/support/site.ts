import { expect, type Locator, type Page, type TestInfo } from "@playwright/test";

/** Every public route, in both locales. Mirrors `scripts/lib/site-contract.ts`. */
export const ROUTES = [
  "/",
  "/beta",
  "/terms",
  "/privacy",
  "/404",
  "/fr/",
  "/fr/beta",
  "/fr/terms",
  "/fr/privacy",
  "/fr/404",
] as const;

/** Chrome UA strings pinned per branch so OS detection never depends on the CI host. */
export const UA = {
  macos:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  linux:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
} as const;

/** DESIGN.md `{marketing-web.tap-min}`. */
export const TAP_MIN = 44;

/** The tier boundary: at and above this width the desktop composition applies. */
export const DESKTOP_MIN_WIDTH = 1024;

export function viewportWidth(page: Page): number {
  return page.viewportSize()?.width ?? 0;
}

export function isDesktopTier(page: Page): boolean {
  return viewportWidth(page) >= DESKTOP_MIN_WIDTH;
}

/** DESIGN.md `{marketing-web.header-h}`: 56 / 64 from 640px / 80 from 1024px. */
export function expectedHeaderHeight(width: number): number {
  if (width >= 1024) return 80;
  if (width >= 640) return 64;
  return 56;
}

export type ConsoleCapture = { readonly messages: string[] };

/**
 * Collect anything a visitor's devtools would show as a problem: console
 * errors/warnings, uncaught exceptions, and failed requests. Attach before the
 * first `goto` or hydration-time messages are missed.
 *
 * Nothing is filtered. An allowlist here would be the exact mechanism by which
 * a real hydration error survives the gate.
 */
export function captureConsole(page: Page): ConsoleCapture {
  const messages: string[] = [];
  page.on("console", (message) => {
    const type = message.type();
    if (type === "error" || type === "warning") {
      messages.push(`[console.${type}] ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    messages.push(`[pageerror] ${error.message}`);
  });
  page.on("requestfailed", (request) => {
    messages.push(
      `[requestfailed] ${request.url()} — ${request.failure()?.errorText ?? "unknown"}`,
    );
  });
  return { messages };
}

export type OverflowReport = {
  overflowPx: number;
  offenders: string[];
};

/**
 * Ground truth for "does this page scroll sideways": the document's own
 * scrollWidth. `offenders` is diagnostic only — it names the elements whose box
 * crosses the viewport edge and are not clipped by an ancestor, so a failure
 * reports the element rather than just the route.
 */
export async function overflowReport(page: Page): Promise<OverflowReport> {
  return page.evaluate(() => {
    const root = document.documentElement;
    const overflowPx = Math.max(0, root.scrollWidth - root.clientWidth);
    if (overflowPx === 0) return { overflowPx: 0, offenders: [] };

    const describe = (el: Element): string => {
      const id = el.id ? `#${el.id}` : "";
      const testId = el.getAttribute("data-testid");
      const cls = el.className
        .toString()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 4)
        .join(".");
      return `${el.tagName.toLowerCase()}${id}${testId ? `[${testId}]` : ""}${cls ? `.${cls}` : ""}`;
    };

    const isClipped = (el: Element): boolean => {
      let node = el.parentElement;
      while (node) {
        const overflow = getComputedStyle(node).overflowX;
        if (overflow === "hidden" || overflow === "clip") return true;
        node = node.parentElement;
      }
      return false;
    };

    const offenders: string[] = [];
    for (const el of Array.from(document.querySelectorAll("body *"))) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      if (getComputedStyle(el).position === "fixed") continue;
      if (rect.right <= root.clientWidth + 1 && rect.left >= -1) continue;
      if (isClipped(el)) continue;
      offenders.push(describe(el));
      if (offenders.length >= 10) break;
    }
    return { overflowPx, offenders };
  });
}

export type HeaderReport = {
  height: number;
  /** Descendants whose box escapes the header's own box — the overlap bug. */
  escaping: string[];
  /** True when the first element in `main` intersects the header at rest. */
  overlapsFirstContent: boolean;
};

export async function headerReport(page: Page): Promise<HeaderReport> {
  return page.evaluate(() => {
    const header = document.querySelector("header");
    const bar = header?.firstElementChild;
    const firstContent = document.querySelector("#main-content")
      ?.firstElementChild;
    if (!header || !bar) {
      return { height: 0, escaping: ["header missing"], overlapsFirstContent: false };
    }

    const headerRect = header.getBoundingClientRect();
    const escaping: string[] = [];
    for (const el of Array.from(header.querySelectorAll("*"))) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      if (rect.top >= headerRect.top - 1 && rect.bottom <= headerRect.bottom + 1) {
        continue;
      }
      const testId = el.getAttribute("data-testid");
      escaping.push(
        `${el.tagName.toLowerCase()}${testId ? `[${testId}]` : ""} ${Math.round(rect.height)}px`,
      );
      if (escaping.length >= 5) break;
    }

    const contentRect = firstContent?.getBoundingClientRect();
    const overlapsFirstContent =
      contentRect !== undefined && contentRect.top < headerRect.bottom - 1;

    return {
      height: Math.round(bar.getBoundingClientRect().height),
      escaping,
      overlapsFirstContent,
    };
  });
}

/** Headings whose text is cut off horizontally by their own box. */
export async function clippedHeadings(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll("h1, h2, h3"))
      .filter((el) => el.scrollWidth > el.clientWidth + 1)
      .map((el) => `${el.tagName.toLowerCase()}: ${el.textContent?.trim().slice(0, 40)}`)
      .slice(0, 10),
  );
}

/** Attach the HTML report artifact name so a failure is traceable to a viewport. */
export function scope(testInfo: TestInfo, route: string): string {
  return `${testInfo.project.name} ${route}`;
}

/**
 * Open a dropdown menu, waiting for its trigger to be wired first.
 *
 * The prerendered trigger carries no `aria-expanded`; Base UI adds it on mount.
 * Clicking before that lands on inert markup and the menu never opens — a race
 * that passes or fails purely on asset-transfer timing, so the attribute is the
 * hydration signal to wait on rather than a timeout.
 */
export async function openMenu(trigger: Locator): Promise<void> {
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
}
