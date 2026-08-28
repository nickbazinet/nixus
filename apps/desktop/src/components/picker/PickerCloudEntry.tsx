import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@nixus/shared";
import { parseAppError } from "@/lib/appError";
import {
  useAuthSession,
  useContinueCloudSession,
  useSignIn,
  type AuthorizeEntry,
} from "@/hooks/useAuth";

// The browser-return note is the description of both cloud entries, not loose prose beside them: the
// flow leaves the app, and a screen-reader user who never reaches the paragraph would otherwise
// activate either control with no idea a browser is about to take over.
const CLOUD_NOTE_ID = "picker-cloud-note";

/**
 * Which cloud entry the screen is offering, and the attribute a test reads instead of the copy.
 *
 * A tagged union rather than a bare string union so the email exists exactly where it means
 * something: a plain `"continue"` state would leave the label interpolating a `string | null` that
 * only a comment promises is set, and "Continue as " with the account missing is precisely the
 * failure this screen cannot afford.
 *
 * `resolving` is its own state rather than folded into `sign-in`: the two render the same
 * composition but mean different things, and a test that could not tell them apart could not prove
 * the screen stayed inert while the session was still being resolved.
 */
type CloudEntry =
  | { state: "resolving" }
  | { state: "sign-in" }
  | { state: "continue"; email: string };

interface PickerCloudEntryProps {
  /**
   * Whether a registry rewrite or a modal panel is in flight in the surrounding surface. Both cloud
   * entries are inert then, for the same reason the local controls disable each other: the callback's
   * own branch rewrites the same registry.
   */
  disabled: boolean;
}

/**
 * The launch screen's Nixus Cloud entry point — Continue for a session that survived the last run,
 * sign in and create an account for one that did not.
 *
 * One filled primary in every state, which is what keeps this a change of copy and behaviour rather
 * than of composition: the session either identifies an account, in which case the primary opens
 * that account's own profile without leaving the app, or it does not, in which case the primary is
 * the unchanged browser sign-in with account creation and the browser-return note beneath it.
 *
 * Sign in and create an account are the *same* flow: one `start_login`, one PKCE attempt, one
 * loopback listener, one callback. They differ only in which Hosted UI page the browser opens on, so
 * the entry is the whole difference between those two controls — and no click here sends anything
 * about any profile or account, because the dataset is resolved Rust-side, from the token, in every
 * branch (NFR1).
 */
export function PickerCloudEntry({ disabled }: PickerCloudEntryProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const session = useAuthSession();
  const signIn = useSignIn();
  const continueSession = useContinueCloudSession();

  // `isPending` is the one window where no answer exists yet. A settled error is a *decided* answer
  // — the stored session could not be read, which is the signed-out composition — so it deliberately
  // falls through to `sign-in` rather than stranding the user on an inert screen. Any future state
  // falls the same way, and that direction is the safe one: the browser sign-in claims no identity
  // and continues as nobody.
  //
  // Read from the session query rather than from any registry or dataset read: the subject that
  // actually selects the profile is resolved from the id token Rust-side and never crosses IPC.
  const entry: CloudEntry = session.isPending
    ? { state: "resolving" }
    : session.data?.status === "LoggedIn"
      ? { state: "continue", email: session.data.email }
      : { state: "sign-in" };

  // The one place the branch is discriminated, so the label, the geometry and the composition below
  // cannot disagree about which entry the screen is offering.
  const continuation = entry.state === "continue" ? entry : null;

  // Only a *settled* signed-out or expired answer earns the browser composition. While the session
  // is unresolved nothing about a browser is known to be true, and rendering the login label, the
  // account-creation link and the browser-return note there was the misleading part: an already
  // signed-in user was told a browser was about to open, and the whole block was then swapped out
  // from under them. Withholding it also makes the inert state exactly as tall as the Continue state
  // it usually becomes, so a signed-in launch no longer reflows.
  const browserSignIn = entry.state === "sign-in";

  // Anything that is neither of the two decided answers is still resolving, and is therefore inert
  // and labelled as a status rather than as an action. That is the fail-safe direction for a state
  // nobody has mapped: it claims nothing and does nothing, where the previous fall-through would
  // have offered a live OAuth round-trip.
  const resolving = !browserSignIn && continuation === null;

  const busy =
    disabled || resolving || signIn.isPending || continueSession.isPending;

  // No navigation on purpose: the browser round-trip outlives this click, and the callback's own
  // branch selects the profile it resolved. `CloudSignInNavigator` is what carries the user into it,
  // so this handler's only job is starting the flow and reporting a start that failed.
  const startCloudFlow = async (authorizeEntry: AuthorizeEntry) => {
    try {
      await signIn.mutateAsync({
        intent: { kind: "Login" },
        entry: authorizeEntry,
      });
    } catch {
      toast.error(t("datasets.cloudFailed"));
    }
  };

  // This one *does* navigate, and that is the whole difference: the activation completes inside the
  // click, so there is no browser round-trip for `CloudSignInNavigator` to carry the user across.
  // `/` rather than a concrete surface, exactly as a profile row click does — the root's gate and
  // `/`'s onboarding check decide the destination, so the dashboard-vs-wizard choice stays where it
  // already lives.
  //
  // The two failures need different copy because the user's next action differs. An `auth`-typed
  // rejection means the session stopped being usable between render and click, so the mutation has
  // already reset the session query and this screen is about to become the browser sign-in: the
  // generic "could not be reached" would invite a retry of an action that can no longer succeed.
  // Anything else is a local fault with the profile, which the Cloud-failure line describes and
  // which Continue can genuinely be retried against.
  //
  // `parseAppError`, not an inline `{ type?: string }` cast: that module exists precisely so a
  // variant nobody branched on cannot fall through to a generic message, and it is the same reader
  // the mutation itself uses to decide whether to reset — one parse, one vocabulary.
  const continueAsRestored = async () => {
    try {
      await continueSession.mutateAsync();
      // Awaited inside the try: `navigate` rejects if the target route's loaders fail, and outside it
      // that becomes an unhandled rejection with the button still spinning. The user is left on the
      // picker either way, so one toast covers both.
      await navigate({ to: "/" });
    } catch (error) {
      toast.error(
        parseAppError(error).type === "auth"
          ? t("profile.sessionExpired")
          : t("datasets.cloudFailed")
      );
    }
  };

  return (
    <>
      {/* The one primary action on this screen, and the only brand fill on it, in every state. The
        * label is wrapped and truncating because an email is unbounded: the button's own
        * `whitespace-nowrap` would otherwise push a long address past the action column and force
        * the sideways scroll this composition forbids. `title` is what keeps a truncated address
        * recoverable for a sighted pointer user — the accessible name already carries it whole. */}
      <Button
        size="lg"
        className="mt-6"
        aria-describedby={browserSignIn ? CLOUD_NOTE_ID : undefined}
        disabled={busy}
        aria-disabled={busy || undefined}
        data-cloud-entry={entry.state}
        onClick={() =>
          void (continuation === null
            ? startCloudFlow("SignIn")
            : continueAsRestored())
        }
        data-testid="picker-login-cloud-button"
      >
        <span className="min-w-0 truncate" title={continuation?.email}>
          {continuation !== null
            ? t("datasets.continueAs", { email: continuation.email })
            : browserSignIn
              ? t("datasets.loginWithCloud")
              : t("datasets.checkingCloud")}
        </span>
      </Button>

      {/* Rendered only for a settled signed-out or expired session, and absent rather than disabled
        * everywhere else. Continue never leaves the app, so the browser-return note would describe
        * something that is not about to happen and account creation is not the alternative offered to
        * someone already signed in; while the session is unresolved neither is known to apply yet.
        * The single filled primary and its placement are identical in all three states, which is what
        * keeps this the launch surface DESIGN.md describes rather than a hierarchy change. */}
      {browserSignIn ? (
        <>
          {/* `variant="link"` so the second cloud entry never reads as a peer of the primary above
            * it: a user without an account still needs a way in, but the screen leads with signing
            * in. Sized to the caption beneath it rather than to the CTA, and left-aligned so the
            * centred primary keeps the focus — `px-0` because the size's own padding would otherwise
            * indent the text out of alignment with the heading, statement and note that share this
            * column's edge. */}
          <Button
            variant="link"
            size="sm"
            className="mt-1 self-start px-0"
            aria-describedby={CLOUD_NOTE_ID}
            disabled={busy}
            aria-disabled={busy || undefined}
            onClick={() => void startCloudFlow("SignUp")}
            data-testid="picker-create-account-link"
          >
            {t("datasets.createAccount")}
          </Button>

          <p
            id={CLOUD_NOTE_ID}
            className="mt-2 text-caption text-ink-dim"
            data-testid="picker-cloud-browser-note"
          >
            {t("datasets.cloudBrowserNote")}
          </p>
        </>
      ) : null}
    </>
  );
}
