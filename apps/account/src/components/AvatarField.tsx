import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CircleUser } from "lucide-react";
import { Button } from "@nixus/shared";

import {
  AvatarTooComplexError,
  AvatarUnreadableError,
  makeAvatarDerivative,
  type AvatarDerivative,
} from "@/lib/avatar";

export interface AvatarFieldProps {
  readonly current: { readonly mime_type: string; readonly data: string } | null;
  readonly busy: boolean;
  readonly onPicked: (derivative: AvatarDerivative) => void;
}

/**
 * Avatar picker. The derivative is produced here, in the browser, and only the
 * derivative is ever uploaded — the original file and its name stay on the
 * device.
 *
 * Laid out as `apps/desktop/src/components/profile/ProfileAvatarField.tsx`
 * does it: a round 80px face on the left, and a labelled button beside it with
 * the hint under that. An 80px picture carrying no affordance of its own is not
 * discoverable, which is why the action has a visible name rather than being
 * the picture itself. A missing picture gets the same round `CircleUser`
 * placeholder the desktop uses, not a dashed box.
 */
export function AvatarField({ current, busy, onPicked }: AvatarFieldProps) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<"unreadable" | "tooLarge" | null>(null);
  const hintId = useId();
  const errorId = useId();

  const src =
    preview ?? (current ? `data:${current.mime_type};base64,${current.data}` : null);

  async function handleChange(event: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    // The input is reset immediately so re-picking the same file fires `change`.
    event.target.value = "";
    if (!file) return;

    setRefusal(null);
    try {
      const derivative = await makeAvatarDerivative(file);
      setPreview((previous) => {
        if (previous) URL.revokeObjectURL(previous);
        return derivative.preview;
      });
      onPicked(derivative);
    } catch (error: unknown) {
      if (error instanceof AvatarTooComplexError) setRefusal("tooLarge");
      else if (error instanceof AvatarUnreadableError) setRefusal("unreadable");
      else throw error;
    }
  }

  return (
    <div className="flex items-start gap-4" data-testid="profile-avatar">
      {src ? (
        <img
          data-testid="avatar-preview"
          src={src}
          alt={t("profile.avatar.alt")}
          width={80}
          height={80}
          className="size-20 rounded-full border border-line object-cover"
        />
      ) : (
        <CircleUser
          aria-hidden="true"
          data-testid="avatar-empty"
          className="size-20 shrink-0 text-ink-faint"
        />
      )}

      <div className="space-y-1">
        <p className="text-caption text-ink-dim">{t("profile.avatar.heading")}</p>

        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="mkt-tap"
          disabled={busy}
          onClick={() => input.current?.click()}
          aria-describedby={refusal === null ? hintId : `${hintId} ${errorId}`}
          data-testid="avatar-choose"
        >
          {t("profile.avatar.choose")}
        </Button>

        <p id={hintId} className="text-caption text-ink-dim">
          {t("profile.avatar.hint")}
        </p>

        {refusal !== null && (
          <p
            id={errorId}
            role="alert"
            className="text-caption text-over-ink"
            data-testid="avatar-refusal"
          >
            {t(`profile.avatar.${refusal}`)}
          </p>
        )}
      </div>

      <input
        ref={input}
        data-testid="avatar-input"
        type="file"
        accept="image/png,image/jpeg"
        className="sr-only"
        onChange={handleChange}
      />
    </div>
  );
}
