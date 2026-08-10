import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useRouterState } from "@tanstack/react-router";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nixus/shared";
import { Button } from "@nixus/shared";
import { toast } from "sonner";
import { useAuthSession, useSignIn } from "@/hooks/useAuth";

// The shell's main column, `<main id="surface-main" tabIndex={-1}>` in routes/__root.tsx. Kept as a
// literal because that id is module-private to the route file, which this story may not re-export.
const MAIN_ID = "surface-main";

/**
 * Launch-time invitation to create an account, shown on every launch until one exists. Propless and
 * self-gating, mirroring UpdateChecker: the shell mounts it unconditionally and the component
 * decides whether it has anything to show.
 *
 * Dismissal lives in component state and nowhere else — no flag is persisted, so a relaunch shows
 * the prompt again while the user still has no account. That cadence is a fixed architectural
 * decision, not an oversight.
 */
export function AccountPromptDialog() {
  const { t } = useTranslation();
  const session = useAuthSession();
  const signIn = useSignIn();
  const [dismissed, setDismissed] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  // A strict positive match on a *resolved* LoggedOut session, and nothing looser. This one
  // condition carries four ACs: no flash while the query is pending, nothing on `isError`, nothing
  // for LoggedIn, and nothing for SessionExpired (the user already has an account — communicating
  // expiry belongs to the profile menu, not to an invitation).
  //
  // It is also what keeps the existing Playwright suite green: every spec stubs
  // `__TAURI_INTERNALS__.invoke` with `default: Promise.reject(...)`, so `get_auth_session` rejects
  // and this query sits in `isError` throughout. A looser guard would open a *modal* dialog in all
  // of them, and Base UI's focus trap aria-hides the rest of the app — which silently breaks every
  // unrelated getByRole/getByTestId query in the suite rather than failing one assertion.
  //
  // `/onboarding` is suppressed for the same reason: aria-hiding first-run onboarding would make an
  // existing feature unreachable. Pathname rather than useOnboardingStatus() — that hook adds a
  // second async dependency whose error fallback is `needs_onboarding: false`.
  if (
    !session.isSuccess ||
    session.data?.status !== "LoggedOut" ||
    dismissed ||
    pathname === "/onboarding"
  ) {
    return null;
  }

  const handleCreateAccount = async () => {
    try {
      await signIn.mutateAsync();
      // Closing on success rather than on click is what makes the pending state observable, and it
      // keeps `dismissed` sticky for the rest of the session so a later sign-out does not pop the
      // invitation back up mid-session.
      setDismissed(true);
    } catch {
      // Mandatory: start_login returns Result<(), AppError> and can fail (e.g. the system opener).
      // Without this the rejection becomes an unhandled promise rejection and the button looks dead.
      toast.error(t("auth.signInFailed"));
    }
  };

  return (
    <Dialog open onOpenChange={() => setDismissed(true)}>
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-md"
        // This dialog auto-opens and has no trigger, so Base UI's default `returnFocus` resolves to
        // nothing at launch (`domReference` is null and the previously-focused-element list skips
        // <body>) and focus is left orphaned on <body> after dismissal. Hand it the shell's main
        // column instead of weakening the focus trap.
        finalFocus={() => document.getElementById(MAIN_ID)}
        data-testid="account-prompt-dialog"
      >
        <DialogHeader>
          <DialogTitle>{t("auth.promptTitle")}</DialogTitle>
          <DialogDescription>{t("auth.promptBody")}</DialogDescription>
        </DialogHeader>

        <p className="text-caption text-ink-dim">
          {t("auth.promptFutureFeatures")}
        </p>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setDismissed(true)}
            disabled={signIn.isPending}
            aria-disabled={signIn.isPending || undefined}
            data-testid="continue-offline-button"
          >
            {t("auth.continueOffline")}
          </Button>
          {/* Default variant, not destructive: every other Dialog in this app is a delete confirm,
           * and this one is an invitation. */}
          <Button
            onClick={handleCreateAccount}
            disabled={signIn.isPending}
            aria-disabled={signIn.isPending || undefined}
            data-testid="create-account-button"
          >
            {signIn.isPending
              ? t("auth.openingBrowser")
              : t("auth.createAccount")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
