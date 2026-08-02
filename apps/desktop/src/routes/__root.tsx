import { useState, useEffect, useCallback, useRef } from "react";
import {
  createRootRoute,
  Outlet,
  retainSearchParams,
  useRouterState,
} from "@tanstack/react-router";
import { AppSidebar } from "../components/shared/AppSidebar";
import { TopBar } from "../components/shared/TopBar";
import { DestinationNav } from "../components/shared/DestinationNav";
import { FloatingChatBar } from "../components/chat/FloatingChatBar";
import { UpdateChecker } from "../components/shared/UpdateChecker";
import { RecurringApplyListener } from "../components/shared/RecurringApplyListener";
import { ValuesVisibilityProvider } from "../contexts/ValuesVisibilityContext";
import { SURFACE_HEADING_ID } from "../components/shared/PageHeader";
import { normalizePeriodParam } from "../hooks/usePeriod";
import { useTranslation } from "react-i18next";
import { focusRing } from "@nixus/shared";
import { cn } from "@/lib/utils";

// The key must be OMITTED rather than set to undefined when absent: retainSearchParams restores a
// param only `if (!(key in search))`, so returning `{ period: undefined }` looks present and the
// selected month silently resets on every destination change.
export const Route = createRootRoute({
  validateSearch: (search: Record<string, unknown>): { period?: string } => {
    const period = normalizePeriodParam(search.period);
    return period ? { period } : {};
  },
  search: {
    middlewares: [retainSearchParams(["period"])],
  },
  component: RootLayout,
});

const MAIN_ID = "surface-main";

// The shell persists across navigation, so the heading has to be focused explicitly. Falls back to
// the main column when a surface renders no PageHeader (the AI chat owns its own header).
function focusSurfaceHeading() {
  const target =
    document.querySelector<HTMLElement>("[data-surface-heading]") ??
    document.getElementById(MAIN_ID);
  target?.focus();
}

// WebKit treats a scripted focus() as focus-visible, so moving focus after a *mouse* navigation
// painted a focus ring around the surface title. Only keyboard navigation needs the focus move, so
// track the modality of the interaction that caused the route change and skip the rest.
let lastInteractionWasKeyboard = false;

function trackInteractionModality() {
  const onKeyDown = () => {
    lastInteractionWasKeyboard = true;
  };
  const onPointerDown = () => {
    lastInteractionWasKeyboard = false;
  };
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("pointerdown", onPointerDown, true);
  return () => {
    document.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("pointerdown", onPointerDown, true);
  };
}

function RootLayout() {
  const { t } = useTranslation();
  const [chatOpen, setChatOpen] = useState(false);

  const handleClose = useCallback(() => setChatOpen(false), []);

  useEffect(trackInteractionModality, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setChatOpen((prev) => !prev);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isAiChat = pathname.startsWith("/ai/");

  // Route change moves focus to the new surface's <h1>. Deliberately skipped on first paint —
  // stealing focus at launch would announce the heading before the user has asked for anything.
  // rAF lets the new surface commit before we look for its heading. The guard compares pathnames
  // rather than using a first-render ref, which StrictMode's double-invoked effect defeats in dev.
  const previousPathname = useRef(pathname);
  useEffect(() => {
    if (previousPathname.current === pathname) return;
    previousPathname.current = pathname;
    if (!lastInteractionWasKeyboard) return;
    const frame = requestAnimationFrame(focusSurfaceHeading);
    return () => cancelAnimationFrame(frame);
  }, [pathname]);

  const handleSkip = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    focusSurfaceHeading();
  };

  return (
    <ValuesVisibilityProvider>
      <div className="flex h-full overflow-hidden bg-page text-ink">
        {/* First tab stop in the document, ahead of the rail. Visually hidden until focused. */}
        <a
          href={`#${SURFACE_HEADING_ID}`}
          onClick={handleSkip}
          className={cn(
            "sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:inline-flex focus:min-h-target-min focus:items-center focus:rounded-md focus:border focus:border-line-strong focus:bg-card focus:px-3 focus:py-1.5 focus:text-label focus:text-ink",
            focusRing
          )}
          data-testid="skip-to-content"
        >
          {t("shell.skipToContent")}
        </a>
        <AppSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar onSearchClick={() => setChatOpen(true)} />
          <DestinationNav />
          {/* The scroll container is the main column, never the centred measure below it —
           * scrolling the centred wrapper puts the scrollbar inside the content. */}
          <main
            id={MAIN_ID}
            tabIndex={-1}
            className={cn(
              "flex min-h-0 min-w-0 flex-1 flex-col overscroll-contain bg-page",
              isAiChat ? "overflow-hidden" : "overflow-y-auto"
            )}
          >
            {/* Same centred measure on every surface, except AI chat: its two-pane layout
             * (history rail + conversation) needs the full main-column width to lay out its
             * own panels edge-to-edge, and it scrolls internally, so it gets no page padding
             * or max-width of its own. */}
            <div
              className={cn(
                "flex w-full flex-col",
                isAiChat
                  ? "min-h-0 flex-1 overflow-hidden"
                  : "mx-auto max-w-[1280px] px-page-x py-page-y"
              )}
            >
              <Outlet />
            </div>
          </main>
        </div>
        <FloatingChatBar open={chatOpen} onClose={handleClose} />
        <UpdateChecker />
        <RecurringApplyListener />
      </div>
    </ValuesVisibilityProvider>
  );
}
