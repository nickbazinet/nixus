import { createFileRoute } from "@tanstack/react-router";

import { SignInPanel } from "@/components/SignInPanel";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [{ title: "Nixus Cloud account" }] }),
  component: () => <SignInPanel locale="en" />,
});
