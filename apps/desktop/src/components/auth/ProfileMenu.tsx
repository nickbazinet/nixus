import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ArrowLeftRight, CircleUser, LogIn, LogOut, User } from "lucide-react";
import {
  Badge,
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
  usePremiumEntitlement,
  useSignIn,
  useSignOut,
} from "@/hooks/useAuth";
import { useActiveProfile } from "@/hooks/useDatasets";

type SessionState =
  | "loading"
  | "logged-out"
  | "logged-in"
  | "session-expired"
  | "unavailable";

const TRIGGER_TESTID = "profile-menu-trigger";

/**
 * Reached only for a confirmed `cloud-linked` profile — the caller gates the session query on that,
 * so every row here describes an account that exists.
 *
 * `unavailable` is still a live path, not defensive padding: `get_auth_session` rejects when the
 * keyring entry cannot be decoded, and a cloud-linked profile whose payload carries no recognised
 * `status` lands here too. That row must render a silent, benign affordance — a toast or an error
 * surface would fire on a header that is mounted on every screen, and Base UI's focus trap would
 * aria-hide the app if it were ever promoted to a dialog.
 */
function deriveState(
  isLoading: boolean,
  isError: boolean,
  status: "LoggedOut" | "LoggedIn" | "SessionExpired" | undefined,
): SessionState {
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
 * Top-right header entry point for the Nixus account: identity when signed in, a way in when not.
 * Propless and self-contained, mirroring UpdateChecker — the header mounts it unconditionally and
 * the component decides what it has to show.
 *
 * `get_active_profile` is the profile-kind authority and it is read *first*: a local profile is a
 * purely local concept (NFR7), so this menu is wholly auth-unaware while one is open — no keyring
 * read, no Cognito refresh, no identity, no expiry. Only a confirmed `cloud-linked` profile has an
 * account to show, and only it enables the session query.
 *
 * It owns no auth state of its own: every reader of the account goes through the same
 * `["auth", "session"]` cache entry, so no two surfaces can drift from each other. The signed-in
 * badge is likewise not computed here — Rust compares the session's subject to the profile's own
 * and answers with a boolean (AD-10).
 */
export function ProfileMenu() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const activeProfile = useActiveProfile();
  const signIn = useSignIn();
  const signOut = useSignOut();
  const [open, setOpen] = useState(false);
  const expiredNotifiedRef = useRef(false);

  const cloudProfile =
    activeProfile.data?.kind === "cloud-linked" ? activeProfile.data : null;
  const session = useAuthSession({ enabled: cloudProfile !== null });

  // Read through the gate, never straight off the query: a disabled useQuery still serves whatever
  // `/profile` or the retirement hooks have already written into the shared `["auth", "session"]`
  // entry, so an ungated read would let a local profile inherit — and announce — a SessionExpired it
  // is not allowed to know about.
  const state =
    cloudProfile === null
      ? null
      : deriveState(session.isLoading, session.isError, session.data?.status);
  const account =
    cloudProfile !== null && session.data?.status === "LoggedIn"
      ? session.data
      : null;

  // Shared with the rail label rather than derived here, so the two surfaces cannot disagree about
  // which account is entitled. It does its own gating and costs no extra IPC.
  const isPremium = usePremiumEntitlement();

  const startCloudFlow = () => {
    signIn.mutate(
      { intent: { kind: "Login" }, entry: "SignIn" },
      { onError: () => toast.error(t("datasets.cloudFailed")) },
    );
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
  if (cloudProfile !== null) {
    const displayName = account?.name?.trim() ?? "";
    const menuEmail = account?.email ?? cloudProfile.label;

    return (
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              className={cn(state === "session-expired" && "text-caution-ink")}
              aria-label={t("profile.accountMenu", { email: menuEmail })}
              data-testid={TRIGGER_TESTID}
              data-auth-state={state}
              data-cloud-status={
                cloudProfile.is_signed_in ? "signed-in" : "signed-out"
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
            {!cloudProfile.is_signed_in ? (
              // Read, never actuated, so a plain element for the same reason the address below is
              // one: a menu item here would take roving focus for a label.
              <div
                className="px-1.5 py-1 text-caption text-ink-dim"
                data-testid="profile-menu-cloud-status"
              >
                {t("datasets.signedOut")}
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
                {/* A plain element for the same reason the identity rows above are — and `neutral`,
                 * never `good` or `caution`: this is a durable entitlement, not a state that went
                 * well or needs attention. The word carries it, so forced colors lose nothing.
                 *
                 * The rail's label is the same fact in `premium-ink`; this badge is the account-
                 * scoped one, which is why the two use different treatments rather than one token. */}
                {isPremium ? (
                  <div
                    className="flex items-center px-1.5 pb-1"
                    data-testid="profile-menu-premium"
                  >
                    <Badge variant="neutral">{t("profile.premiumBadge")}</Badge>
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

          {/* Sign-in, never migrate: this profile is already linked, so migrating it again would
           * only produce a second copy. Reattaching the account is the one cloud action left. */}
          {!cloudProfile.is_signed_in ? (
            <DropdownMenuItem
              onClick={() => {
                startCloudFlow();
                setOpen(false);
              }}
              data-testid="profile-menu-cloud-action"
            >
              <LogIn aria-hidden="true" />
              {t("datasets.signInWithCloud")}
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
  // trigger on every launch. Inert on purpose — the action below switches the active profile, and
  // offering it before the open profile's kind is known is offering it about nothing.
  if (activeProfile.isPending) {
    return (
      <Button
        variant="ghost"
        size="icon"
        disabled
        aria-label={t("profile.loading")}
        data-testid={TRIGGER_TESTID}
        data-profile-kind="pending"
      >
        <User aria-hidden="true" className="size-5" />
      </Button>
    );
  }

  // A local profile, or one whose kind could not be read. Neither has an account, so neither gets
  // an account panel — and a single header click may not start a cloud flow either: completing one
  // creates or reopens a cloud dataset and switches the active profile away from this one, taking
  // any in-progress work on it along. The trigger offers the one reversible thing it can offer, and
  // the picker is where a deliberate cloud sign-in lives.
  //
  // `from: "switch"` is the arrival context, not a preference: a user who came here to change
  // profiles lands with the local list already open instead of having to ask for it again.
  return (
    <Button
      variant="ghost"
      aria-label={t("datasets.switchProfile")}
      onClick={() => void navigate({ to: "/picker", search: { from: "switch" } })}
      data-testid={TRIGGER_TESTID}
      data-profile-kind={activeProfile.data?.kind ?? "unknown"}
    >
      <ArrowLeftRight aria-hidden="true" />
      {t("datasets.switchProfile")}
    </Button>
  );
}
