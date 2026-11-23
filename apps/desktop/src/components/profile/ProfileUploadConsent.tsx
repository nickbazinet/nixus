import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CloudUpload } from "lucide-react";
import { Button } from "@nixus/shared";
import { InsightCallout } from "@/components/shared/InsightCallout";
import { useAnswerProfileUpload } from "@/hooks/useProfile";
import { cloudProfileMessageKey, isCloudProfileError, parseAppError } from "@/lib/appError";

/**
 * AD-8's consent, asked once, only after a `GET` answered that the account has no profile yet.
 *
 * A card above the form rather than a modal dialog: the demographics it is asking about are on
 * screen directly below it, and a prompt that hides the thing it describes asks the user to consent
 * to something they cannot see. Declining is a first-class button, not a dismissal, because a
 * closed dialog would have to be re-asked and AD-8 forbids re-asking.
 *
 * The copy names no provider and no region (AD-16): "your Nixus Cloud account" is the whole claim
 * the in-app surface may make, and the policies carry the rest.
 */
interface ProfileUploadConsentProps {
  sourceKey: string | null;
}

export function ProfileUploadConsent({ sourceKey }: ProfileUploadConsentProps) {
  const { t } = useTranslation();
  const answer = useAnswerProfileUpload(sourceKey);

  const respond = (accept: boolean) => {
    answer.mutate(accept, {
      onError: (error: unknown) => {
        const parsed = parseAppError(error);
        toast.error(
          t(
            isCloudProfileError(parsed)
              ? cloudProfileMessageKey(parsed)
              : "profile.consent.failed",
          ),
        );
      },
    });
  };

  return (
    <InsightCallout
      icon={CloudUpload}
      eyebrow={t("profile.v2.consentEyebrow")}
      title={t("profile.consent.title")}
      actions={
        <>
          <Button
            disabled={answer.isPending}
            onClick={() => respond(true)}
            data-testid="profile-upload-consent-accept"
          >
            {answer.isPending
              ? t("profile.consent.pending")
              : t("profile.consent.accept")}
          </Button>
          <Button
            variant="outline"
            disabled={answer.isPending}
            onClick={() => respond(false)}
            data-testid="profile-upload-consent-decline"
          >
            {t("profile.consent.decline")}
          </Button>
        </>
      }
      data-testid="profile-upload-consent"
    >
      {t("profile.consent.body")}
    </InsightCallout>
  );
}
