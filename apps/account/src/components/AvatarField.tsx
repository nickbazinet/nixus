import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button } from "@nixus/shared";

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
 * derivative is ever uploaded — the original file and its name stay on the device.
 */
export function AvatarField({ current, busy, onPicked }: AvatarFieldProps) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<"unreadable" | "tooLarge" | null>(null);

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
    <section className="flex flex-col gap-3" aria-labelledby="avatar-heading">
      <h2 id="avatar-heading" className="text-label text-ink">
        {t("profile.avatar.heading")}
      </h2>

      <div className="flex items-center gap-4">
        {src ? (
          <img
            data-testid="avatar-preview"
            src={src}
            alt={t("profile.avatar.alt")}
            width={64}
            height={64}
            className="size-16 rounded-full border border-line object-cover"
          />
        ) : (
          <div
            data-testid="avatar-empty"
            className="grid size-16 place-items-center rounded-full border border-dashed border-line text-caption text-ink-faint"
          >
            {t("profile.avatar.empty")}
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => input.current?.click()}
            data-testid="avatar-choose"
          >
            {t("profile.avatar.choose")}
          </Button>
          <p className="text-caption text-ink-dim">{t("profile.avatar.hint")}</p>
        </div>
      </div>

      <input
        ref={input}
        data-testid="avatar-input"
        type="file"
        accept="image/png,image/jpeg"
        className="sr-only"
        onChange={handleChange}
      />

      {refusal ? (
        <Alert variant="over" data-testid="avatar-refusal">
          {t(`profile.avatar.${refusal}`)}
        </Alert>
      ) : null}
    </section>
  );
}
