import { useTranslation } from "react-i18next";
import { CloudOff, LogIn } from "lucide-react";
import { Button, Card, EmptyState } from "@nixus/shared";
import { useSignIn } from "@/hooks/useAuth";

/**
 * The two Nixus Cloud lifecycle states that replace the form rather than qualify it (AD-7).
 *
 * `reauthentication-required` is the one refresh outcome that is never silent: a Cognito refresh
 * grant cannot add a scope, so no retry and no waiting repairs it and the only way forward is a
 * fresh sign-in (adversary C1). It is safe to offer that here, unlike in `SignInRequired`, because
 * this state is only reachable for a dataset that is already cloud-linked and already signed in —
 * completing the Login reopens the same profile rather than switching away from one.
 *
 * `offline-no-copy` carries no action at all: there is nothing to retry from inside the app, and a
 * button that only ever reports the same failure is worse than the sentence that explains it.
 */
interface ProfileCloudStateProps {
  variant: "reauthentication-required" | "offline-no-copy";
}

export function ProfileCloudState({ variant }: ProfileCloudStateProps) {
  const { t } = useTranslation();
  const signIn = useSignIn();

  if (variant === "offline-no-copy") {
    return (
      <Card>
        <EmptyState
          icon={<CloudOff />}
          title={t("profile.cloud.offlineNoCopyTitle")}
          description={t("profile.cloud.offlineNoCopyBody")}
          data-testid="profile-cloud-state"
          data-cloud-state="offline-no-copy"
        />
      </Card>
    );
  }

  return (
    <Card>
      <EmptyState
        icon={<LogIn />}
        title={t("profile.cloud.reauthTitle")}
        description={t("profile.cloud.reauthBody")}
        action={
          <Button
            disabled={signIn.isPending}
            onClick={() =>
              signIn.mutate({ intent: { kind: "Login" }, entry: "SignIn" })
            }
            data-testid="profile-reauth-action"
          >
            {t("profile.cloud.reauthAction")}
          </Button>
        }
        data-testid="profile-cloud-state"
        data-cloud-state="reauthentication-required"
      />
    </Card>
  );
}
