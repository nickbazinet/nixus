import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeftRight, LogIn } from "lucide-react";
import { Button, EmptyState } from "@nixus/shared";
import { useSignIn } from "@/hooks/useAuth";
import { useActiveProfile } from "@/hooks/useDatasets";

interface SignInRequiredProps {
  /** Resolved by the route, not derived here: the route owns the session branch. */
  actionLabel: string;
  /** QA/E2E hook only, mirroring `data-auth-state` on `profile-menu-trigger`. */
  authState: "logged-out" | "session-expired" | "unavailable";
}

/**
 * Session-blind by arrangement with the route, which owns that branch — but *not* profile-blind.
 *
 * Completing a Login find-or-creates a cloud dataset and activates it, so offering one click here
 * while a local profile is open would switch the user's active profile away from it with no warning.
 * Only a profile known to be cloud-linked may offer that; a local one — or one whose kind has not
 * answered yet — gets the reversible action instead, and the picker is where a deliberate cloud
 * sign-in lives. Same rule as `ProfileMenu`'s header trigger, so the two cannot disagree.
 */
export function SignInRequired({ actionLabel, authState }: SignInRequiredProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const signIn = useSignIn();
  const activeProfile = useActiveProfile();
  const isCloudLinked = activeProfile.data?.kind === "cloud-linked";

  return (
    <EmptyState
      icon={<LogIn />}
      title={t("profile.signInRequiredTitle")}
      description={t("profile.signInRequiredBody")}
      action={
        isCloudLinked ? (
          <Button
            size="sm"
            onClick={() => signIn.mutate({ kind: "Login" })}
            data-testid="profile-sign-in-action"
          >
            {actionLabel}
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={() => void navigate({ to: "/picker" })}
            data-testid="profile-switch-profile-action"
          >
            <ArrowLeftRight aria-hidden="true" />
            {t("datasets.switchProfile")}
          </Button>
        )
      }
      data-testid="profile-sign-in-required"
      data-auth-state={authState}
    />
  );
}
