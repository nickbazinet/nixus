import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Card, CardContent } from "@nixus/shared";
import type { ProfileFields } from "@nixus/shared";

import {
  loadSubdivisions,
  saveAvatar,
  saveProfile,
  type SaveProfileResponse,
} from "@/actions/account";
import type { AccountView } from "@/actions/gate";
import { profileDestinationKey, type Locale } from "@/lib/i18n";
import { billingDestination, destinationPath } from "@/server/destinations";
import { refusalText } from "@/lib/messages";
import type { AvatarDerivative } from "@/lib/avatar";
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
 * The profile surface, laid out as `apps/desktop/src/routes/profile.tsx` is: a
 * page title, then one `Card` holding the round picture, the read-only email,
 * and the form — inside a `max-w-2xl` column centred in the site's own
 * container. The shell above and below it is the marketing site's.
 */
export function ProfilePanel({ view, locale }: { view: AccountView; locale: Locale }) {
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
    <main id="main" tabIndex={-1} className="mkt-page-x mkt-container py-10 outline-none md:py-14">
      <div className="mx-auto max-w-2xl">
        <div className="mb-section-gap">
          <h1 className="text-h1 text-ink">{t("profile.heading")}</h1>
        </div>

        <div className="space-y-4">
          {status.kind === "message" ? (
            <Alert
              data-testid="profile-status"
              variant={status.tone === "ok" ? "info" : "over"}
              role={status.tone === "ok" ? "status" : "alert"}
              className="rounded-sm"
            >
              {status.text}
            </Alert>
          ) : null}

          <Card>
            <CardContent>
              <div className="mb-4">
                <AvatarField current={avatar} busy={busy} onPicked={onAvatarPicked} />
              </div>

              {view.email ? (
                <div className="space-y-1">
                  <p className="text-caption text-ink-dim">{t("profile.email")}</p>
                  {/* Read text, not a control: a `Label` with no `htmlFor`
                      target is an a11y defect, and `title` carries the full
                      address the truncation hides. */}
                  <p
                    data-testid="profile-email"
                    className="truncate text-body text-ink"
                    title={view.email}
                  >
                    {view.email}
                  </p>
                </div>
              ) : null}

              <div className="mt-4">
                <ProfileForm
                  // Keyed on the server-owned version: a conflict reload has to
                  // replace the draft the user is looking at, not merge into it.
                  key={profile?.version ?? 0}
                  initial={profile?.fields ?? EMPTY_FIELDS}
                  countries={view.countries}
                  subdivisions={subdivisions}
                  busy={busy}
                  refusal={refusal}
                  onCountryChange={onCountryChange}
                  onSave={onSave}
                />
              </div>
            </CardContent>
          </Card>

          {/* The only in-app way to reach billing. The header bar is deliberately
              not it: its own comment records that the French sign-out label
              already does not fit a 320px bar beside both toggles, so a third
              control there would overflow the geometry both origins share. */}
          <a
            data-testid="billing-link"
            href={destinationPath(billingDestination(locale))}
            className="mkt-tap inline-flex min-h-target-min items-center text-sm font-medium text-muted-foreground underline underline-offset-4 outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {t("profile.billingLink")}
          </a>

          {/* A session can end between the server render and a click, and the
              status banner then says so. This is the way back from there. */}
          {status.kind === "message" && status.text === t("profile.signedOut") ? (
            <Button
              size="sm"
              className="mkt-tap"
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
      </div>
    </main>
  );
}
