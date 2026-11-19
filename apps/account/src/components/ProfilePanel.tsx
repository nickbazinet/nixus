import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button } from "@nixus/shared";
import type { ProfileFields } from "@nixus/shared";

import {
  loadSubdivisions,
  saveAvatar,
  saveProfile,
  type SaveProfileResponse,
} from "@/actions/account";
import type { AccountView } from "@/actions/gate";
import { profileDestinationKey, type Locale } from "@/lib/i18n";
import { refusalText } from "@/lib/messages";
import type { AvatarDerivative } from "@/lib/avatar";
import { AccountSection, PILL_BUTTON_CLASS } from "./AccountSection";
import { AvatarField } from "./AvatarField";
import { ProfileForm, type FieldRefusal, type LocationOption } from "./ProfileForm";

/** Shown for a brand-new account, where the cloud has no profile yet. */
const EMPTY_FIELDS: ProfileFields = {
  first_name: null,
  last_name: null,
  birth_date: null,
  income_bracket: null,
  income_bracket_currency: null,
  country_code: null,
  subdivision_code: null,
};

type Status =
  | { readonly kind: "idle" }
  | { readonly kind: "busy" }
  | { readonly kind: "message"; readonly tone: "ok" | "warn"; readonly text: string };

/**
 * The "Personal information" card: the picture, then the profile form with the
 * read-only email in its grid.
 */
export function ProfilePanel({
  view,
  locale,
  active,
}: {
  readonly view: AccountView;
  readonly locale: Locale;
  readonly active: boolean;
}) {
  const { t } = useTranslation();
  const [profile, setProfile] = useState(view.profile);
  const [avatar, setAvatar] = useState(view.avatar);
  const [subdivisions, setSubdivisions] = useState<readonly LocationOption[]>(
    view.subdivisions,
  );
  const [status, setStatus] = useState<Status>(
    view.error === null
      ? { kind: "idle" }
      : { kind: "message", tone: "warn", text: t(`error.${view.error}`) },
  );
  // Separate from `status` on purpose: a refusal the API attributed to one field
  // belongs next to that field, and the banner says only that the save failed.
  const [refusal, setRefusal] = useState<FieldRefusal | null>(null);

  function applySave(response: SaveProfileResponse): void {
    setRefusal(null);
    switch (response.kind) {
      case "saved":
        setProfile(response.profile);
        setStatus({ kind: "message", tone: "ok", text: t("profile.saved") });
        return;
      case "conflict":
        // The reloaded resource is shown and the user is told the page was behind
        // — never that somebody else changed their profile (AD-7 L1).
        if (response.profile) setProfile(response.profile);
        setStatus({ kind: "message", tone: "warn", text: t("profile.conflict") });
        return;
      case "rejected": {
        const text = refusalText(t, response);
        if (response.field !== null) setRefusal({ field: response.field, text });
        setStatus({ kind: "message", tone: "warn", text });
        return;
      }
      case "indeterminate":
        setStatus({ kind: "message", tone: "warn", text: t("profile.indeterminate") });
        return;
      case "signed_out":
        setStatus({ kind: "message", tone: "warn", text: t("profile.signedOut") });
        return;
    }
  }

  async function onSave(fields: ProfileFields): Promise<void> {
    setStatus({ kind: "busy" });
    applySave(
      await saveProfile({
        data: { ...fields, expected_version: profile?.version ?? null },
      }),
    );
  }

  async function onCountryChange(country: string | null): Promise<void> {
    const result = await loadSubdivisions({ data: { country, locale } });
    setSubdivisions(result.subdivisions);
  }

  async function onAvatarPicked(derivative: AvatarDerivative): Promise<void> {
    setStatus({ kind: "busy" });
    const result = await saveAvatar({
      data: {
        mime_type: derivative.mime_type,
        data: derivative.data,
        expected_version: profile?.avatar_version ?? null,
      },
    });

    if (result.kind === "saved") {
      setAvatar({ mime_type: derivative.mime_type, data: derivative.data });
      setStatus({ kind: "message", tone: "ok", text: t("profile.avatar.saved") });
      return;
    }
    setStatus({
      kind: "message",
      tone: "warn",
      text:
        result.kind === "signed_out"
          ? t("profile.signedOut")
          : refusalText(t, { code: result.code, field: null, reason: null }),
    });
  }

  const busy = status.kind === "busy";

  return (
    <AccountSection
      id="personal"
      active={active}
      title={t("account.personal.title")}
      description={t("account.personal.description")}
    >
      <div className="space-y-6">
        {status.kind === "message" ? (
          <div className="space-y-3">
            <Alert
              data-testid="profile-status"
              variant={status.tone === "ok" ? "info" : "over"}
              role={status.tone === "ok" ? "status" : "alert"}
              className="rounded-lg"
            >
              {status.text}
            </Alert>

            {/* A session can end between the server render and a click, and the
                status banner then says so. This is the way back from there. */}
            {status.text === t("profile.signedOut") ? (
              <Button
                className={PILL_BUTTON_CLASS}
                render={
                  <a
                    data-testid="sign-in-again"
                    href={`/auth/login?next=${profileDestinationKey(locale)}&lang=${locale}`}
                  >
                    {t("profile.signInAgain")}
                  </a>
                }
              />
            ) : null}
          </div>
        ) : null}

        <AvatarField current={avatar} busy={busy} onPicked={onAvatarPicked} />

        <ProfileForm
          // Keyed on the server-owned version: a conflict reload has to
          // replace the draft the user is looking at, not merge into it.
          key={profile?.version ?? 0}
          initial={profile?.fields ?? EMPTY_FIELDS}
          email={view.email}
          countries={view.countries}
          subdivisions={subdivisions}
          busy={busy}
          refusal={refusal}
          onCountryChange={onCountryChange}
          onSave={onSave}
        />
      </div>
    </AccountSection>
  );
}
