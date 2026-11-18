import { createFileRoute, redirect } from "@tanstack/react-router";

import { loadAccountView } from "@/actions/account";
import { ProfilePanel } from "@/components/ProfilePanel";
import { loginLocation } from "@/server/destinations";

export const Route = createFileRoute("/profile")({
  loader: async () => {
    const view = await loadAccountView({ data: { locale: "en" } });
    // A signed-out or expired visitor gets sign-in, not a profile page in an
    // error state. Thrown from the loader, so SSR answers with a 302 and the
    // browser never renders a shell it would immediately replace.
    if (!view.signedIn) throw redirect({ href: loginLocation("en") });
    return view;
  },
  head: () => ({ meta: [{ title: "Profile — Nixus Cloud account" }] }),
  component: EnglishProfile,
});

function EnglishProfile() {
  return <ProfilePanel view={Route.useLoaderData()} locale="en" />;
}
