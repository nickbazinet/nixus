import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@nixus/shared";
import { AccountAvatar } from "@/components/auth/AccountAvatar";
import { usePremiumEntitlement } from "@/hooks/useAuth";
import { useSetUserAvatar, useUserAvatar, useUserProfile } from "@/hooks/useProfile";
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
interface ProfileAvatarFieldProps {
  /** The resolver's key for the Nixus Cloud home this picture belongs to (AD-6). */
  sourceKey: string | null;
}

export function ProfileAvatarField({ sourceKey }: ProfileAvatarFieldProps) {
  const { t } = useTranslation();
  const avatar = useUserAvatar({ sourceKey });
  const profile = useUserProfile(sourceKey);
  const isPremium = usePremiumEntitlement();
  const setAvatar = useSetUserAvatar(sourceKey);
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

  // The same query `ProfileForm` reads, so the monogram spells the name the fields below show
  // rather than a second source of truth for it. An empty name falls back to the person glyph.
  const fullName = [profile.data?.first_name, profile.data?.last_name]
    .filter((part): part is string => typeof part === "string" && part.trim() !== "")
    .join(" ");

  return (
    <div className="flex flex-wrap items-center gap-5" data-testid="profile-avatar">
      <AccountAvatar
        avatar={avatar.data}
        premium={isPremium}
        sizeClassName="size-20"
        alt={t("profile.avatar.alt")}
        imageTestId="profile-avatar-image"
        placeholderTestId="profile-avatar-placeholder"
        name={fullName === "" ? null : fullName}
      />

      <div className="min-w-0">
        <p className="text-label text-ink">{t("profile.avatar.label")}</p>
        <p id={hintId} className="mt-1 text-caption text-ink-dim">
          {t("profile.avatar.hint")}
        </p>

        <Button
          variant="outline"
          size="sm"
          className="mt-3"
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

        {errorKey !== null && (
          <p
            id={errorId}
            role="alert"
            className="mt-2 text-caption text-over-ink"
            data-testid="profile-avatar-error"
          >
            {t(errorKey)}
          </p>
        )}
      </div>
    </div>
  );
}
