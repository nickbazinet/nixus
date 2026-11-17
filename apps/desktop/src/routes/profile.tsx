import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Card, CardContent, Skeleton } from "@nixus/shared";
import { PageHeader } from "@/components/shared/PageHeader";
import { SignInRequired } from "@/components/profile/SignInRequired";
import { ProfileAvatarField } from "@/components/profile/ProfileAvatarField";
import { ProfileForm } from "@/components/profile/ProfileForm";
import { useAuthSession } from "@/hooks/useAuth";
import { useProfileSource } from "@/hooks/useProfile";

export const Route = createFileRoute("/profile")({
  component: ProfilePage,
});

/**
 * The profile surface, branching on the active dataset's KIND first (AD-6).
 *
 * A local profile keeps its demographics on this computer and has no account, so that branch reads
 * no session at all — reading one would open the OS secure store and could POST a Cognito refresh
 * for a profile that has no account. Only the cloud-linked branch is session-gated, and it is
 * unchanged: `SignInRequired` still covers signed-out, expired and unreadable sessions.
 *
 * Avatars are Nixus Cloud-only, so the local branch renders no picture control.
 */
function ProfilePage() {
  const { t } = useTranslation();
  // The resolver's own answer is what the branch is taken on: it carries the dataset's kind
  // already, so the surface needs no second source of truth for it — and the session is not read
  // at all until that answer is in, which is what keeps a local profile from touching the keyring.
  const source = useProfileSource();
  const isLocal = source.data?.kind === "local";
  const session = useAuthSession({ enabled: !isLocal && !source.isLoading });

  // Ordered, not a lookup table, and it fails closed: the loading arms are tested first so no
  // state can flash, and `local`/`logged-in` are the only positively-matched arms, so an errored
  // or unrecognised payload lands on the guard rather than on profile content.
  const status = session.data?.status;
  const guard = source.isLoading
    ? "loading"
    : isLocal
      ? "local"
      : session.isLoading
        ? "loading"
        : status === "LoggedIn"
          ? "logged-in"
          : status === "SessionExpired"
            ? "session-expired"
            : status === "LoggedOut"
              ? "logged-out"
              : "unavailable";

  const account = session.data?.status === "LoggedIn" ? session.data : null;
  const sourceKey = source.data?.source_key ?? null;

  return (
    <div
      data-testid="profile-page"
      data-auth-state={guard}
      data-profile-source={source.data?.kind ?? "pending"}
    >
      {/* Rendered in every branch: `PageHeader` owns `SURFACE_HEADING_ID`, which the shell's
       * skip link and its route-change focus move both target. */}
      <PageHeader title={t("profile.title")} />

      <div className="mx-auto max-w-2xl">
        {guard === "loading" && (
          <Card>
            <CardContent>
              <Skeleton rows={2} data-testid="profile-skeleton" />
            </CardContent>
          </Card>
        )}

        {guard === "local" && (
          <Card>
            <CardContent>
              <p
                className="text-caption text-ink-dim"
                data-testid="profile-local-description"
              >
                {t("profile.localDescription")}
              </p>

              <div className="mt-4">
                <ProfileForm sourceKey={sourceKey} />
              </div>
            </CardContent>
          </Card>
        )}

        {guard === "logged-in" && account && (
          <Card>
            <CardContent>
              <div className="mb-4">
                <ProfileAvatarField sourceKey={sourceKey} />
              </div>

              <div className="space-y-1">
                <p className="text-caption text-ink-dim">{t("profile.email")}</p>
                {/* Read text, not a control: a `Label` with no `htmlFor` target is an a11y defect,
                 * and the `title` carries the full address the truncation hides. */}
                <p
                  className="truncate text-body text-ink"
                  title={account.email}
                  data-testid="profile-email"
                >
                  {account.email}
                </p>
              </div>

              <div className="mt-4">
                <ProfileForm sourceKey={sourceKey} />
              </div>
            </CardContent>
          </Card>
        )}

        {guard === "session-expired" && (
          <SignInRequired
            authState="session-expired"
            actionLabel={t("profile.sessionExpiredAction")}
          />
        )}

        {(guard === "logged-out" || guard === "unavailable") && (
          <SignInRequired authState={guard} actionLabel={t("datasets.signInWithCloud")} />
        )}
      </div>
    </div>
  );
}
