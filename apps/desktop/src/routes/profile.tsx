import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Card, CardContent, Skeleton } from "@nixus/shared";
import { PageHeader } from "@/components/shared/PageHeader";
import { SignInRequired } from "@/components/profile/SignInRequired";
import { ProfileForm } from "@/components/profile/ProfileForm";
import { useAuthSession } from "@/hooks/useAuth";

export const Route = createFileRoute("/profile")({
  component: ProfilePage,
});

function ProfilePage() {
  const { t } = useTranslation();
  const session = useAuthSession();

  // Ordered, not a lookup table, and it fails closed: `isLoading` is tested first so the
  // signed-out state can never flash, and `logged-in` is the only positively-matched arm, so an
  // errored or unrecognised payload lands on the guard rather than on profile content.
  const status = session.data?.status;
  const guard = session.isLoading
    ? "loading"
    : status === "LoggedIn"
      ? "logged-in"
      : status === "SessionExpired"
        ? "session-expired"
        : status === "LoggedOut"
          ? "logged-out"
          : "unavailable";

  const account = session.data?.status === "LoggedIn" ? session.data : null;

  return (
    <div data-testid="profile-page" data-auth-state={guard}>
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

        {guard === "logged-in" && account && (
          <Card>
            <CardContent>
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
                <ProfileForm />
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
          <SignInRequired authState={guard} actionLabel={t("profile.signIn")} />
        )}
      </div>
    </div>
  );
}
