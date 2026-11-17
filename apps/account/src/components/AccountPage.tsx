import type { AccountView } from "@/actions/gate";
import type { Locale } from "@/lib/i18n";
import { ProfilePanel } from "./ProfilePanel";
import { SignInPanel } from "./SignInPanel";

/**
 * One branch, in one place: a signed-out visitor — including one whose session
 * had expired and was just rejected — gets the sign-in panel, never a profile
 * page in an error state.
 */
export function AccountPage({ view, locale }: { view: AccountView; locale: Locale }) {
  return view.signedIn ? (
    <ProfilePanel view={view} locale={locale} />
  ) : (
    <SignInPanel locale={locale} />
  );
}
