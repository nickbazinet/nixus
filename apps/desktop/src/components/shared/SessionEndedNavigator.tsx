import { useEffect } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { queryKeys } from "@/lib/constants";
import { clearProfileScopedState } from "@/lib/datasetSwitch";

/** How often a signed-in account's session is re-checked while the window stays open. */
export const SESSION_RECHECK_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Takes the user to the sign-in screen when their Nixus Cloud session can no longer be used.
 *
 * Rust ends such a session itself - the same sign-out the menu performs - and emits
 * `auth:session-ended` only when a cloud profile was open. This is the other half: sweep what the
 * account left in memory, say why, and land on the picker, where signing in is the only way on.
 *
 * It also keeps the check from depending on a restart. The session read only touches the network
 * once the access token has expired, so re-reading it on an interval and on window focus is cheap,
 * and it is what makes a revoked or expired login end within minutes instead of at next launch.
 *
 * Lives inside the router, like `CloudSignInNavigator`, because it navigates.
 */
export function SessionEndedNavigator() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  useEffect(() => {
    let cleaned = false;
    const unlisteners: UnlistenFn[] = [];

    const setup = async () => {
      const ended = await listen("auth:session-ended", () => {
        clearProfileScopedState(queryClient);
        toast.error(t("profile.sessionEnded"));
        void navigate({ to: "/picker" });
      });

      // StrictMode unmounts and remounts before this resolves, so a listener that lands after
      // cleanup must tear itself down instead of leaking a second subscription.
      if (cleaned) {
        ended();
      } else {
        unlisteners.push(ended);
      }
    };

    setup();

    return () => {
      cleaned = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [navigate, queryClient, t]);

  useEffect(() => {
    const recheck = () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.auth.session });
    };

    const timer = window.setInterval(recheck, SESSION_RECHECK_INTERVAL_MS);
    window.addEventListener("focus", recheck);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", recheck);
    };
  }, [queryClient]);

  return null;
}
