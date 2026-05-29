import { useState, useEffect, useCallback } from "react";
import { createRootRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { AppSidebar } from "../components/shared/AppSidebar";
import { TopBar } from "../components/shared/TopBar";
import { InnerTabNav } from "../components/shared/InnerTabNav";
import { FloatingChatBar } from "../components/chat/FloatingChatBar";
import { UpdateChecker } from "../components/shared/UpdateChecker";
import { RecurringApplyListener } from "../components/shared/RecurringApplyListener";
import { ValuesVisibilityProvider } from "../contexts/ValuesVisibilityContext";

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  const [chatOpen, setChatOpen] = useState(false);

  const handleClose = useCallback(() => setChatOpen(false), []);

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

  return (
    <ValuesVisibilityProvider>
      <div className="flex h-screen overflow-hidden bg-background text-foreground">
        <AppSidebar />
        <div className="flex-1 min-w-0 flex flex-col bg-sidebar">
          <TopBar onSearchClick={() => setChatOpen(true)} />
          <div className="flex-1 min-w-0 flex flex-col rounded-tl-lg overflow-hidden bg-background">
            <InnerTabNav />
            <main className="flex-1 min-w-0 overflow-hidden bg-muted/50 flex flex-col">
              {isAiChat ? (
                <Outlet />
              ) : (
                <div className="flex-1 overflow-y-auto max-w-[1280px] w-full mx-auto p-6">
                  <Outlet />
                </div>
              )}
            </main>
          </div>
        </div>
        <FloatingChatBar open={chatOpen} onClose={handleClose} />
        <UpdateChecker />
        <RecurringApplyListener />
      </div>
    </ValuesVisibilityProvider>
  );
}
