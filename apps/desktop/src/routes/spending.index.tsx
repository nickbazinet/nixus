import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/spending/")({
  beforeLoad: () => {
    throw redirect({ to: "/spending/budget" });
  },
});
