import { useEffect } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

/**
 * Carries the user into the profile a completed Cloud sign-in landed on — and says so when it could
 * not land on one.
 *
 * Every dataset switch a *click* starts already navigates itself, but the Cloud sign-in and Migrate
 * flows resolve minutes later, from a browser round-trip that outlived the click, so nothing in the
 * UI is left holding the promise that would have navigated (Stories 35.2/35.3).
 *
 * Keyed on `auth:callback-received` rather than on `dataset:switched`, and that is load-bearing:
 * the callback emits it *after* its branch has selected the dataset and latched the launch-picker
 * gate, whereas `dataset:switched` fires mid-flight, when the gate would still bounce a navigation
 * straight back to the picker. It also leaves the picker's own click path alone, which navigates on
 * its own and would otherwise race this.
 *
 * `auth:cloud-link-failed` is the other half of that pair, and Rust emits it for *any* stage of the
 * callback that failed — a rejected CSRF state, a token exchange that could not reach Cognito, an
 * incomplete session, or the post-callback branch that could not prepare the profile. There is
 * exactly one emission site for it, at the top of the callback dispatcher, because a failure
 * upstream of the session store is just as silent to the user as one after it: either way the
 * browser round-trip ended and nothing moved. Rust chooses the message — it is the only side that
 * knows which stage failed, and the specific cases (the migrating profile is no longer open, the
 * sign-in link expired) are worth more than a generic line. A failure carries no
 * `auth:callback-received`, so nothing navigates: the user stays where they started, told why.
 *
 * Lives inside the router, unlike `DatasetSwitchListener`, which is mounted above `RouterProvider`
 * and therefore cannot navigate at all.
 */
export function CloudSignInNavigator() {
  const navigate = useNavigate();
  const { t } = useTranslation();

  useEffect(() => {
    let cleaned = false;
    const unlisteners: UnlistenFn[] = [];

    const setup = async () => {
      // `/` rather than a concrete surface: the root's beforeLoad re-asks the picker gate and `/`'s
      // asks the newly active profile's own onboarding state, so the destination is that profile's
      // own entry view — an empty dashboard or the wizard, per its own state.
      const landed = await listen("auth:callback-received", () => {
        void navigate({ to: "/" });
      });

      const failed = await listen<string>("auth:cloud-link-failed", (event) => {
        toast.error(event.payload || t("datasets.cloudFailed"));
      });

      // StrictMode unmounts and remounts before these promises resolve, so listeners that land
      // after cleanup must tear themselves down instead of leaking a second subscription.
      if (cleaned) {
        landed();
        failed();
      } else {
        unlisteners.push(landed, failed);
      }
    };

    setup();

    return () => {
      cleaned = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [navigate, t]);

  return null;
}
