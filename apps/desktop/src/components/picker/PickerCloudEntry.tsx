import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@nixus/shared";
import { useSignIn, type AuthorizeEntry } from "@/hooks/useAuth";

// The browser-return note is the description of both cloud entries, not loose prose beside them: the
// flow leaves the app, and a screen-reader user who never reaches the paragraph would otherwise
// activate either control with no idea a browser is about to take over.
const CLOUD_NOTE_ID = "picker-cloud-note";

interface PickerCloudEntryProps {
  /**
   * Whether a registry rewrite or a modal panel is in flight in the surrounding surface. Both cloud
   * entries are inert then, for the same reason the local controls disable each other: the callback's
   * own branch rewrites the same registry.
   */
  disabled: boolean;
}

/**
 * The launch screen's two Nixus Cloud entry points, and the one note that describes both.
 *
 * Sign in and create an account are the *same* flow: one `start_login`, one PKCE attempt, one
 * loopback listener, one callback. They differ only in which Hosted UI page the browser opens on, so
 * the entry is the whole difference between these two controls — and neither click sends anything
 * about any profile, because the dataset is resolved Rust-side after the callback (NFR1).
 */
export function PickerCloudEntry({ disabled }: PickerCloudEntryProps) {
  const { t } = useTranslation();
  const signIn = useSignIn();

  // No navigation on purpose: the browser round-trip outlives this click, and the callback's own
  // branch selects the profile it resolved. `CloudSignInNavigator` is what carries the user into it,
  // so this handler's only job is starting the flow and reporting a start that failed.
  const startCloudFlow = async (entry: AuthorizeEntry) => {
    try {
      await signIn.mutateAsync({ intent: { kind: "Login" }, entry });
    } catch {
      toast.error(t("datasets.cloudFailed"));
    }
  };

  const busy = signIn.isPending || disabled;

  return (
    <>
      {/* The one primary action on this screen, and the only brand fill on it. */}
      <Button
        size="lg"
        className="mt-6"
        aria-describedby={CLOUD_NOTE_ID}
        disabled={busy}
        aria-disabled={busy || undefined}
        onClick={() => void startCloudFlow("SignIn")}
        data-testid="picker-login-cloud-button"
      >
        {t("datasets.loginWithCloud")}
      </Button>

      {/* `variant="link"` so the second cloud entry never reads as a peer of the primary above it:
        * a user without an account still needs a way in, but the screen leads with signing in.
        * Sized to the caption beneath it rather than to the CTA, and left-aligned so the centred
        * primary keeps the focus — `px-0` because the size's own padding would otherwise indent the
        * text out of alignment with the heading, statement and note that share this column's edge. */}
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
  );
}
