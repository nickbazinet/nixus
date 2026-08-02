import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/wealth/")({
  beforeLoad: () => {
    throw redirect({ to: "/wealth/accounts" });
  },
});
