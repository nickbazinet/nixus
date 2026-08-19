import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CircleUser, LogIn, LogOut, User } from "lucide-react";
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
import { useAuthSession, useSignIn, useSignOut } from "@/hooks/useAuth";

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
 * Top-right header entry point for the Nixus account: identity when signed in, a way in when not.
 * Propless and self-contained, mirroring UpdateChecker — the header mounts it unconditionally and
 * the component decides what it has to show.
 *
 * It owns no auth state of its own: every reader of the account goes through the same
 * `["auth", "session"]` cache entry, so no two surfaces can drift from each other.
 */
export function ProfileMenu() {
  const { t } = useTranslation();
  const session = useAuthSession();
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

  if (state === "logged-in" && account) {
    const displayName = account.name?.trim() ?? "";

    return (
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("profile.accountMenu", { email: account.email })}
              data-testid={TRIGGER_TESTID}
              data-auth-state="logged-in"
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
          </DropdownMenuGroup>

          <DropdownMenuSeparator />

          {/* `render` rather than a nested anchor: Base UI's menu item owns roving focus and
           * typeahead, and an anchor child would take the tab stop away from it. */}
          <DropdownMenuItem
            render={<Link to="/profile" data-testid="profile-menu-profile" />}
          >
            <User aria-hidden="true" />
            {t("profile.menuItem")}
          </DropdownMenuItem>

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
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  const isLoadingState = state === "loading";
  const label = isLoadingState
    ? t("profile.loading")
    : state === "session-expired"
      ? t("profile.sessionExpiredAction")
      : t("profile.signIn");

  // Label every actuable state. Only `loading` is disabled, and only it stays icon-only: rendering
  // "Loading account…" would resize the trigger on every launch. `unavailable` IS clickable and
  // signs in like the rest, so it must not ship as a bare glyph.
  const showLabel = !isLoadingState;

  // No DropdownMenu wrapper in these states: there is no identity to show, so the trigger is the
  // whole affordance and pressing it goes straight to the Hosted UI.
  return (
    <Button
      variant="ghost"
      size={showLabel ? "default" : "icon"}
      disabled={isLoadingState}
      className={cn(state === "session-expired" && "text-caution-ink")}
      aria-label={label}
      onClick={() => signIn.mutate()}
      data-testid={TRIGGER_TESTID}
      data-auth-state={state}
    >
      {isLoadingState ? (
        <User aria-hidden="true" className="size-5" />
      ) : (
        <LogIn aria-hidden="true" className={cn(!showLabel && "size-5")} />
      )}
      {showLabel && t("profile.signIn")}
    </Button>
  );
}
