import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Card, CardContent, Skeleton } from "@nixus/shared";
import { PageHeader } from "@/components/shared/PageHeader";
import { SignInRequired } from "@/components/profile/SignInRequired";
import { ProfileAvatarField } from "@/components/profile/ProfileAvatarField";
import { ProfileCloudState } from "@/components/profile/ProfileCloudState";
import { ProfileForm } from "@/components/profile/ProfileForm";
import { ProfileUploadConsent } from "@/components/profile/ProfileUploadConsent";
import { useAuthSession } from "@/hooks/useAuth";
import {
  useCloudProfileStatus,
  useProfileRefreshedListener,
  useProfileSource,
} from "@/hooks/useProfile";

export const Route = createFileRoute("/profile")({
  component: ProfilePage,
});

/**
 * The profile surface, branching on the active dataset's KIND first (AD-6), then — for a
 * cloud-linked one — on the Nixus Cloud lifecycle state Rust reports (AD-7).
 *
 * A local profile keeps its demographics on this computer and has no account, so that branch reads
 * no session at all — reading one would open the OS secure store and could POST a Cognito refresh
 * for a profile that has no account. Only the cloud-linked branch is session-gated, and it is
 * unchanged: `SignInRequired` still covers signed-out, expired and unreadable sessions.
 *
 * The cloud lifecycle sits INSIDE the signed-in branch rather than beside it, because every state
 * it reports is a fact about a live session's reach: a token that lacks the profile scope, an
 * unreachable API, a copy that was never downloaded. The refresh trigger and the `profile:refreshed`
 * listener are both mounted here and nowhere else — this route is the only surface that acts on
 * them, and a listener in the app shell would be an always-mounted subscriber (D11).
 *
 * Avatars are Nixus Cloud-only, so the local branch renders no picture control.
 */
function ProfilePage() {
  const { t } = useTranslation();
  useProfileRefreshedListener();

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

  // AD-7's "when the Profile page opens" trigger, gated on the branch that has a cloud profile to
  // refresh at all: a local source would answer instantly with nothing, and a refused source would
  // answer with a rejection the guard above has already handled.
  const cloud = useCloudProfileStatus(
    sourceKey,
    guard === "logged-in" && source.data?.kind === "cloud",
  );
  // `fetchStatus` and not `isPending` alone: a DISABLED query is pending forever in TanStack v5, so
  // a source that resolved to nothing — a cross-account dataset, say — would sit on a skeleton that
  // never resolves. Idle means "never asked", which is the pre-cloud behaviour this falls back to.
  const cloudPending = cloud.isPending && cloud.fetchStatus !== "idle";
  const cloudState = cloud.data?.state ?? null;
  const offlineWithCopy = cloudState === "offline_with_copy";
  const showsForm = cloudState === "ready" || offlineWithCopy || (!cloudPending && cloudState === null);

  return (
    <div
      data-testid="profile-page"
      data-auth-state={guard}
      data-profile-source={source.data?.kind ?? "pending"}
      data-cloud-state={cloudState ?? "pending"}
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
          <>
            {/* The refresh is in flight on first render, so without this the page would show the
             * form for a moment before replacing it with a re-sign-in or a connect state. */}
            {cloudPending && (
              <Card>
                <CardContent>
                  <Skeleton rows={2} data-testid="profile-cloud-skeleton" />
                </CardContent>
              </Card>
            )}

            {cloudState === "reauthentication_required" && (
              <ProfileCloudState variant="reauthentication-required" />
            )}

            {cloudState === "signed_out" && (
              <SignInRequired
                authState="logged-out"
                actionLabel={t("datasets.signInWithCloud")}
              />
            )}

            {cloudState === "offline_no_copy" && (
              <ProfileCloudState variant="offline-no-copy" />
            )}

            {showsForm && (
              <div className="space-y-4">
                {cloud.data?.consent_pending === true && (
                  <ProfileUploadConsent sourceKey={sourceKey} />
                )}

                <Card>
                  <CardContent>
                    <div className="mb-4">
                      <ProfileAvatarField sourceKey={sourceKey} />
                    </div>

                    <div className="space-y-1">
                      <p className="text-caption text-ink-dim">
                        {t("profile.email")}
                      </p>
                      {/* Read text, not a control: a `Label` with no `htmlFor` target is an a11y
                       * defect, and the `title` carries the full address the truncation hides. */}
                      <p
                        className="truncate text-body text-ink"
                        title={account.email}
                        data-testid="profile-email"
                      >
                        {account.email}
                      </p>
                    </div>

                    {offlineWithCopy && (
                      <p
                        className="mt-4 text-caption text-ink-dim"
                        data-testid="profile-offline-notice"
                      >
                        {t("profile.cloud.offlineNotice")}
                      </p>
                    )}

                    <div className="mt-4">
                      <ProfileForm
                        sourceKey={sourceKey}
                        saveDisabled={offlineWithCopy}
                      />
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
          </>
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
