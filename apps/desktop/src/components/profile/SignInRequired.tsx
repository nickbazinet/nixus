import { useTranslation } from "react-i18next";
import { LogIn } from "lucide-react";
import { Button, EmptyState } from "@nixus/shared";
import { useSignIn } from "@/hooks/useAuth";

interface SignInRequiredProps {
  /** Resolved by the route, not derived here: the route owns the session branch. */
  actionLabel: string;
  /** QA/E2E hook only, mirroring `data-auth-state` on `profile-menu-trigger`. */
  authState: "logged-out" | "session-expired" | "unavailable";
}

/**
 * Deliberately session-blind. The route is the single decision point, so this component cannot
 * disagree with it about whether the user is signed in.
 */
export function SignInRequired({ actionLabel, authState }: SignInRequiredProps) {
  const { t } = useTranslation();
  const signIn = useSignIn();

  return (
    <EmptyState
      icon={<LogIn />}
      title={t("profile.signInRequiredTitle")}
      description={t("profile.signInRequiredBody")}
      action={
        <Button
          size="sm"
          onClick={() => signIn.mutate()}
          data-testid="profile-sign-in-action"
        >
          {actionLabel}
        </Button>
      }
      data-testid="profile-sign-in-required"
      data-auth-state={authState}
    />
  );
}
