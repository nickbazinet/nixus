import { useState, useEffect, useCallback, useRef } from "react";
import {
  createRootRoute,
  Outlet,
  redirect,
  retainSearchParams,
  useRouterState,
} from "@tanstack/react-router";
import { AppSidebar } from "../components/shared/AppSidebar";
import { TopBar } from "../components/shared/TopBar";
import { DestinationNav } from "../components/shared/DestinationNav";
import { FloatingChatBar } from "../components/chat/FloatingChatBar";
import { UpdateChecker } from "../components/shared/UpdateChecker";
import { RecurringApplyListener } from "../components/shared/RecurringApplyListener";
import { CloudSignInNavigator } from "../components/shared/CloudSignInNavigator";
import { SessionEndedNavigator } from "../components/shared/SessionEndedNavigator";
import { ValuesVisibilityProvider } from "../contexts/ValuesVisibilityContext";
import { SURFACE_HEADING_ID } from "../components/shared/PageHeader";
import { normalizePeriodParam } from "../hooks/usePeriod";
import { fetchPickerGateStatus } from "../hooks/useDatasets";
import { useTranslation } from "react-i18next";
import { IconGradientDefs, focusRing } from "@nixus/shared";
import { cn } from "@/lib/utils";

const PICKER_PATH = "/picker";

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
  // The gate lives here, not in `index.tsx`, because the root's beforeLoad runs ahead of every
  // child route's — including `/`'s own onboarding check — so the picker comes first without any
  // surface needing to know it exists.
  beforeLoad: async ({ location }) => {
    // Already on the picker: nothing to redirect to, and re-asking would put an IPC round-trip on
    // every navigation the picker itself makes.
    if (location.pathname === PICKER_PATH) return;

    // A failed call degrades to "no redirect", mirroring `fetchOnboardingStatus`'s own fallback in
    // `index.tsx`: a genuine IPC failure at launch must not strand the user on a picker they never
    // asked for. The fallback is also load-bearing for three Playwright specs — `navigation`,
    // `app-launch`, and `ai-navigation` — which deliberately mock no Tauri at all, so every invoke
    // rejects there. Every other spec answers `check_picker_gate` explicitly.
    const gate = await fetchPickerGateStatus().catch(() => null);
    if (gate?.needs_picker) {
      throw redirect({ to: PICKER_PATH });
    }
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

  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isAiChat = pathname.startsWith("/ai/");
  // The picker runs before the user has chosen which dataset the shell would even be showing, so
  // every shell affordance is omitted rather than rendered disabled.
  const isPicker = pathname === PICKER_PATH;
  // Home lays out its own dashboard column and docked composer panel, each scrolling on its own.
  const isHome = pathname === "/home" || pathname.startsWith("/home/");
  const isFullBleed = isAiChat || isPicker || isHome;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Inert on the picker, where FloatingChatBar is not mounted. Without this the shortcut would
      // still flip `chatOpen` in this persistent state with nothing there to consume it, and the
      // first surface the user reached afterwards would open with the chat bar already up.
      if (isPicker) return;
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setChatOpen((prev) => !prev);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isPicker]);

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
        {/* The gradient every brand line icon strokes with. Once per document, picker included. */}
        <IconGradientDefs />
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
        {!isPicker && <AppSidebar />}
        <div className="flex min-w-0 flex-1 flex-col">
          {!isPicker && <TopBar onSearchClick={() => setChatOpen(true)} />}
          {/* The scroll container is the main column, never the centred measure below it —
           * scrolling the centred wrapper puts the scrollbar inside the content. */}
          <main
            id={MAIN_ID}
            tabIndex={-1}
            className={cn(
              "flex min-h-0 min-w-0 flex-1 flex-col overscroll-contain bg-page",
              isFullBleed ? "overflow-hidden" : "overflow-y-auto"
            )}
          >
            {/* Same centred measure on every surface, shared with the top bar so the search field, the
             * destination pills and the content all start on one edge. AI chat, Home and the picker
             * are the exceptions: they lay out and scroll their own panels, so they get no page
             * padding or max-width — only the destination strip, kept on the same measure. */}
            {isFullBleed ? (
              <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
                {!isPicker && (
                  <div className="mx-auto w-full max-w-[1280px] px-page-x pt-2 empty:hidden">
                    <DestinationNav />
                  </div>
                )}
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                  <Outlet />
                </div>
              </div>
            ) : (
              <div className="mx-auto flex w-full max-w-[1280px] flex-col px-page-x pt-2 pb-12">
                {!isPicker && <DestinationNav />}
                <Outlet />
              </div>
            )}
          </main>
        </div>
        {!isPicker && <FloatingChatBar open={chatOpen} onClose={handleClose} />}
        {/* UpdateChecker is not the non-visual listener it looks like: it opens a modal Dialog when
          * an update is waiting, and Base UI's focus trap would aria-hide the picker underneath it.
          * RecurringApplyListener genuinely renders nothing, so it stays mounted. */}
        {!isPicker && <UpdateChecker />}
        <RecurringApplyListener />
        {/* Mounted on the picker too: a Cloud sign-in started there is switched by the OAuth callback,
          * so this is what leaves that screen for the profile it landed on. */}
        <CloudSignInNavigator />
        {/* Mounted on the picker too: its own session read can end a dead session, and the toast
          * is what tells the user why they are being asked to sign in. */}
        <SessionEndedNavigator />
      </div>
    </ValuesVisibilityProvider>
  );
}
