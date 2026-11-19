import { createFileRoute, redirect } from "@tanstack/react-router";

import { loadAccountPage } from "@/actions/page";
import { AccountPage } from "@/components/AccountPage";
import { loginLocation } from "@/server/destinations";

export const Route = createFileRoute("/profile")({
  loader: async () => {
    const data = await loadAccountPage("en");
    // A signed-out or expired visitor gets sign-in, not a profile page in an
    // error state. Thrown from the loader, so SSR answers with a 302 and the
    // browser never renders a shell it would immediately replace.
    if (!data.account.signedIn) throw redirect({ href: loginLocation("en") });
    return data;
  },
  // The only client-side navigations here are the section menu's hash changes,
  // which must not re-read the account.
  staleTime: Infinity,
  head: () => ({ meta: [{ title: "Profile — Nixus Cloud account" }] }),
  component: EnglishProfile,
});

function EnglishProfile() {
  const { account, billing } = Route.useLoaderData();
  return (
    <AccountPage
      account={account}
      billing={billing}
      locale="en"
      initialSection="personal"
      planParam={null}
    />
  );
}
