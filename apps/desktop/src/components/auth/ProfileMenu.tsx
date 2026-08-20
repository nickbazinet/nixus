import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  ArrowLeftRight,
  CircleUser,
  CloudUpload,
  LogIn,
  LogOut,
  User,
} from "lucide-react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@nixus/shared";
import { cn } from "@/lib/utils";
import {
  useAuthSession,
  useSignIn,
  useSignOut,
  type LoginIntent,
} from "@/hooks/useAuth";
import { useActiveProfile } from "@/hooks/useDatasets";

type ProfileState =
  | "loading"
  | "logged-out"
  | "logged-in"
  | "session-expired"
  | "unavailable";

const TRIGGER_TESTID = "profile-menu-trigger";

/**
 * `unavailable` is a live path, not defensive padding: this component sits in the always-rendered
 * header, so it runs under every Playwright spec, where `get_auth_session` either rejects or
 * resolves a payload with no `status`. That row must render a silent, benign affordance — a toast or
 * an error surface here would float over 23 unrelated specs, and Base UI's focus trap would
 * aria-hide the app if it were ever promoted to a dialog.
 */
function deriveState(
  isLoading: boolean,
  isError: boolean,
  status: "LoggedOut" | "LoggedIn" | "SessionExpired" | undefined,
): ProfileState {
  if (isLoading) {
    return "loading";
  }
  if (isError) {
    return "unavailable";
  }
  switch (status) {
    case "LoggedOut":
      return "logged-out";
    case "LoggedIn":
      return "logged-in";
    case "SessionExpired":
      return "session-expired";
    default:
      return "unavailable";
  }
}

/**
 * The cloud entry point this menu offers, decided by the *active profile* rather than by the
 * machine-wide auth state (UX-DR3).
 *
 * A local profile always offers migration, whatever the global session says — migrating produces a
 * new, separate profile, so being signed in already changes nothing about the offer. Anything else,
 * including a profile whose kind is not known yet, offers plain sign-in: a Migrate intent needs a
 * concrete source id, and inventing one is how the wrong profile would get copied.
 */
function cloudAction(
  kind: "local" | "cloud-linked" | undefined,
  datasetId: string | undefined,
): { intent: LoginIntent; labelKey: string } {
  if (kind === "local" && datasetId !== undefined) {
    return {
      intent: { kind: "Migrate", source_dataset_id: datasetId },
      labelKey: "datasets.migrateToCloud",
    };
  }
  return { intent: { kind: "Login" }, labelKey: "datasets.signInWithCloud" };
}

/**
 * Top-right header entry point for the Nixus account: identity when signed in, a way in when not.
 * Propless and self-contained, mirroring UpdateChecker — the header mounts it unconditionally and
 * the component decides what it has to show.
 *
 * It owns no auth state of its own: every reader of the account goes through the same
 * `["auth", "session"]` cache entry, so no two surfaces can drift from each other. The signed-in
 * badge is likewise not computed here — Rust compares the session's subject to the profile's own
 * and answers with a boolean (AD-10).
 */
export function ProfileMenu() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const session = useAuthSession();
  const activeProfile = useActiveProfile();
  const signIn = useSignIn();
  const signOut = useSignOut();
  const [open, setOpen] = useState(false);
  const expiredNotifiedRef = useRef(false);

  const state = deriveState(
    session.isLoading,
    session.isError,
    session.data?.status,
  );
  const account = session.data?.status === "LoggedIn" ? session.data : null;
  const cloudProfile =
    activeProfile.data?.kind === "cloud-linked" ? activeProfile.data : null;
  const cloud = cloudAction(
    activeProfile.data?.kind,
    activeProfile.data?.dataset_id,
  );

  const startCloudFlow = () => {
    signIn.mutate(cloud.intent, {
      onError: () => toast.error(t("datasets.cloudFailed")),
    });
  };

  // Keyed on the derived status rather than on the query result: a refetch that returns the same
  // SessionExpired state must not re-announce it, or a user with a dead refresh token collects a
  // toast per window focus. The ref re-arms only once the session is something else again.
  useEffect(() => {
    if (state !== "session-expired") {
      expiredNotifiedRef.current = false;
      return;
    }
    if (!expiredNotifiedRef.current) {
      expiredNotifiedRef.current = true;
      toast.error(t("profile.sessionExpired"));
    }
  }, [state, t]);

  // A cloud-linked profile renders the panel even while signed out: the badge is the whole point of
  // Story 35.4, and it has to be readable in exactly the state where signing back in is the answer.
  const showPanel = (state === "logged-in" && account !== null) || cloudProfile !== null;

  if (showPanel) {
    const displayName = account?.name?.trim() ?? "";
    const menuEmail = account?.email ?? cloudProfile?.label ?? "";

    return (
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("profile.accountMenu", { email: menuEmail })}
              data-testid={TRIGGER_TESTID}
              data-auth-state={state}
              data-cloud-status={
                cloudProfile === null
                  ? undefined
                  : cloudProfile.is_signed_in
                    ? "signed-in"
                    : "signed-out"
              }
            />
          }
        >
          <CircleUser aria-hidden="true" className="size-5" />
        </DropdownMenuTrigger>

        {/* The explicit width is load-bearing: DropdownMenuContent is `w-(--anchor-width) min-w-32`,
         * so anchored to a 32px icon button it collapses to the 128px floor and truncates every
         * address the panel exists to show. */}
        <DropdownMenuContent
          align="end"
          className="w-64"
          data-testid="profile-menu-panel"
        >
          <DropdownMenuGroup>
            {cloudProfile !== null ? (
              // Read, never actuated, so a plain element for the same reason the address below is
              // one: a menu item here would take roving focus for a label.
              <div
                className="px-1.5 py-1 text-caption text-ink-dim"
                data-testid="profile-menu-cloud-status"
              >
                {cloudProfile.is_signed_in
                  ? t("datasets.signedIn")
                  : t("datasets.signedOut")}
              </div>
            ) : null}

            {account !== null ? (
              <>
                <DropdownMenuLabel>{t("profile.signedInAs")}</DropdownMenuLabel>
                {/* Plain elements, not DropdownMenuItems: identity is read, never actuated, and menu
                 * items take roving focus and typeahead that would strand the keyboard here. */}
                <div
                  className="truncate px-1.5 py-1 text-body text-ink"
                  title={account.email}
                  data-testid="profile-menu-email"
                >
                  {account.email}
                </div>
                {displayName ? (
                  <div
                    className="truncate px-1.5 pb-1 text-caption text-ink-dim"
                    title={displayName}
                    data-testid="profile-menu-name"
                  >
                    {displayName}
                  </div>
                ) : null}
              </>
            ) : null}
          </DropdownMenuGroup>

          <DropdownMenuSeparator />

          {account !== null ? (
            // `render` rather than a nested anchor: Base UI's menu item owns roving focus and
            // typeahead, and an anchor child would take the tab stop away from it.
            <DropdownMenuItem
              render={<Link to="/profile" data-testid="profile-menu-profile" />}
            >
              <User aria-hidden="true" />
              {t("profile.menuItem")}
            </DropdownMenuItem>
          ) : null}

          {/* A local profile's panel carries the migrate action; a cloud-linked one carries sign-in
           * or sign-out, never migrate — it is already linked. Withheld entirely while the active
           * profile's kind is unknown: `cloudAction` falls back to plain sign-in for an undefined
           * kind, so rendering it then would flash — or worse, commit — the wrong action. Gated on
           * the data being *there*, not on `!isPending`: a query that settles into an error is no
           * longer pending either, so pending-only would render the ambiguous fallback whenever
           * `get_active_profile` rejects, and one click would silently switch the active profile. */}
          {activeProfile.data !== undefined &&
          (cloudProfile === null || !cloudProfile.is_signed_in) ? (
            <DropdownMenuItem
              onClick={() => {
                startCloudFlow();
                setOpen(false);
              }}
              data-testid="profile-menu-cloud-action"
            >
              {cloud.labelKey === "datasets.migrateToCloud" ? (
                <CloudUpload aria-hidden="true" />
              ) : (
                <LogIn aria-hidden="true" />
              )}
              {t(cloud.labelKey)}
            </DropdownMenuItem>
          ) : null}

          {account !== null ? (
            <DropdownMenuItem
              // Closed unconditionally rather than in onSuccess: sign-out can fail, and a panel
              // pinned open behind a failed request reads as a frozen app.
              onClick={() => {
                signOut.mutate();
                setOpen(false);
              }}
              data-testid="profile-menu-sign-out"
            >
              <LogOut aria-hidden="true" />
              {t("profile.signOut")}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  // Icon-only and disabled, and only in this state: rendering "Loading account…" would resize the
  // trigger on every launch.
  if (state === "loading") {
    return (
      <Button
        variant="ghost"
        size="icon"
        disabled
        aria-label={t("profile.loading")}
        data-testid={TRIGGER_TESTID}
        data-auth-state={state}
      >
        <User aria-hidden="true" className="size-5" />
      </Button>
    );
  }

  // Every remaining state — logged out, session expired, active profile not yet known, session
  // unreadable — reaches here with a *local* profile open, and none of them may start a cloud flow
  // from a single header click: signing in creates or reopens a cloud dataset and switches the
  // active profile away from the local one, taking any in-progress work on it with it. So the
  // trigger offers the one reversible thing it can offer, and the picker is where a deliberate
  // cloud sign-in lives.
  return (
    <Button
      variant="ghost"
      className={cn(state === "session-expired" && "text-caution-ink")}
      aria-label={t("datasets.switchProfile")}
      onClick={() => void navigate({ to: "/picker" })}
      data-testid={TRIGGER_TESTID}
      data-auth-state={state}
    >
      <ArrowLeftRight aria-hidden="true" />
      {t("datasets.switchProfile")}
    </Button>
  );
}
