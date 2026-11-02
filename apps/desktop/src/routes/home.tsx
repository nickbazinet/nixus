import { createFileRoute, redirect } from "@tanstack/react-router";
import { HomePage } from "@/components/home/HomePage";
import { fetchOnboardingStatus } from "@/hooks/useOnboardingStatus";

export const Route = createFileRoute("/home")({
  // Home is where the app lands, so it carries the same onboarding gate `/` does: a profile that
  // still needs setup goes to the wizard first. A failed check degrades to "no redirect".
  beforeLoad: async () => {
    const status = await fetchOnboardingStatus().catch(() => null);
    if (status?.needs_onboarding) {
      throw redirect({ to: "/onboarding" });
    }
  },
  component: HomePage,
});
