import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@nixus/shared";
import { AccountAvatar } from "@/components/auth/AccountAvatar";
import { usePremiumEntitlement } from "@/hooks/useAuth";
import { useSetUserAvatar, useUserAvatar } from "@/hooks/useProfile";
import { useProjectImagePicker } from "@/hooks/useProjectImagePicker";
import { userAvatarMessageKey } from "@/lib/appError";

const GENERIC_FAILURE_KEY = "profile.avatar.saveFailed";

// The shared picker with profile copy: same native dialog, same header validation, same
// re-entrancy guard, different nouns and a different refusal map.
const PICKER_OPTIONS = {
  filterNameKey: "profile.avatar.filterName",
  messageKey: userAvatarMessageKey,
  genericFailureKey: GENERIC_FAILURE_KEY,
} as const;

/**
 * The one control that adds or replaces the signed-in account's profile picture.
 *
 * A labelled button beside the picture rather than the picture-as-button pattern the 56px project
 * row uses: this surface has the room for a visible action name, and an 80px face carrying no
 * affordance of its own is not discoverable. There is deliberately no removal, no cropping and no
 * editing — replacing is the whole vocabulary.
 *
 * A refusal never destroys what is already stored. Validation runs in the picker before any write,
 * and the write itself refuses ahead of the upsert, so the previous face survives every failure
 * path and the page stays usable.
 */
export function ProfileAvatarField() {
  const { t } = useTranslation();
  const avatar = useUserAvatar();
  const isPremium = usePremiumEntitlement();
  const setAvatar = useSetUserAvatar();
  const {
    picked,
    errorKey: pickErrorKey,
    picking,
    pick,
    reset,
  } = useProjectImagePicker(PICKER_OPTIONS);
  const [writeErrorKey, setWriteErrorKey] = useState<string | null>(null);
  const hintId = useId();
  const errorId = useId();

  // `pick()` resolves after its own `setPicked`, so the path is not readable from the click handler
  // that awaited it — this render is the first place it exists. The selection is consumed once and
  // cleared, which is why a second pass over the same value cannot re-send it.
  useEffect(() => {
    if (picked === null) return;
    const filePath = picked.path;
    reset();
    setAvatar.mutate(filePath, {
      onError: (error: unknown) => {
        setWriteErrorKey(userAvatarMessageKey(error) ?? GENERIC_FAILURE_KEY);
      },
    });
  }, [picked, reset, setAvatar.mutate]);

  const handleClick = () => {
    setWriteErrorKey(null);
    reset();
    void pick();
  };

  const errorKey = pickErrorKey ?? writeErrorKey;
  const busy = picking || setAvatar.isPending;

  return (
    <div className="flex items-start gap-4" data-testid="profile-avatar">
      <AccountAvatar
        avatar={avatar.data}
        premium={isPremium}
        sizeClassName="size-20"
        alt={t("profile.avatar.alt")}
        imageTestId="profile-avatar-image"
        placeholderTestId="profile-avatar-placeholder"
      />

      <div className="space-y-1">
        <p className="text-caption text-ink-dim">{t("profile.avatar.label")}</p>

        <Button
          variant="secondary"
          size="sm"
          disabled={busy}
          onClick={handleClick}
          aria-describedby={errorKey === null ? hintId : `${hintId} ${errorId}`}
          data-testid="profile-avatar-upload"
        >
          {setAvatar.isPending
            ? t("profile.avatar.uploading")
            : t(
                avatar.data === null || avatar.data === undefined
                  ? "profile.avatar.addAction"
                  : "profile.avatar.replaceAction",
              )}
        </Button>

        <p id={hintId} className="text-caption text-ink-dim">
          {t("profile.avatar.hint")}
        </p>

        {errorKey !== null && (
          <p
            id={errorId}
            role="alert"
            className="text-caption text-over-ink"
            data-testid="profile-avatar-error"
          >
            {t(errorKey)}
          </p>
        )}
      </div>
    </div>
  );
}
