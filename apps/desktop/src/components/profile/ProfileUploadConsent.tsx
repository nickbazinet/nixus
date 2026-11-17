import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button, Card, CardContent } from "@nixus/shared";
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
    <Card data-testid="profile-upload-consent">
      <CardContent>
        <p className="text-body text-ink">{t("profile.consent.title")}</p>
        <p className="mt-1.5 text-caption text-ink-dim">
          {t("profile.consent.body")}
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={answer.isPending}
            onClick={() => respond(true)}
            data-testid="profile-upload-consent-accept"
          >
            {answer.isPending
              ? t("profile.consent.pending")
              : t("profile.consent.accept")}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={answer.isPending}
            onClick={() => respond(false)}
            data-testid="profile-upload-consent-decline"
          >
            {t("profile.consent.decline")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
